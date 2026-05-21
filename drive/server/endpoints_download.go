package drive

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

const (
	downloadTokenTTL   = 60 * time.Second
	maxDownloadFiles   = 10_000
	maxDownloadBytes   = 5 * 1024 * 1024 * 1024 // 5 GB
	tokenCleanupPeriod = 5 * time.Minute
)

type downloadToken struct {
	folderID  string
	orgID     string
	expiresAt time.Time
}

var (
	downloadTokens   = map[string]downloadToken{}
	downloadTokensMu sync.Mutex
)

func init() {
	go func() {
		for {
			time.Sleep(tokenCleanupPeriod)
			downloadTokensMu.Lock()
			now := time.Now()
			for k, v := range downloadTokens {
				if now.After(v.expiresAt) {
					delete(downloadTokens, k)
				}
			}
			downloadTokensMu.Unlock()
		}
	}()
}

func handleCreateDownloadToken(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	var body struct {
		Item string `json:"item"`
	}
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid request body", nil)
	}
	if body.Item == "" {
		return re.BadRequestError("missing item", nil)
	}

	item, _, err := resolveItemAndUserOrg(app, re, body.Item, false)
	if err != nil {
		return err
	}

	if !item.GetBool("is_folder") {
		return re.BadRequestError("item is not a folder", nil)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return re.InternalServerError("failed to generate token", nil)
	}
	token := hex.EncodeToString(tokenBytes)

	downloadTokensMu.Lock()
	downloadTokens[token] = downloadToken{
		folderID:  item.Id,
		orgID:     item.GetString("org"),
		expiresAt: time.Now().Add(downloadTokenTTL),
	}
	downloadTokensMu.Unlock()

	return re.JSON(http.StatusOK, map[string]any{
		"token": token,
		"url":   "/api/drive/download-folder?token=" + token,
	})
}

func handleDownloadFolder(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	token := re.Request.URL.Query().Get("token")
	if token == "" {
		return re.UnauthorizedError("missing token", nil)
	}

	downloadTokensMu.Lock()
	dt, ok := downloadTokens[token]
	if ok {
		delete(downloadTokens, token) // single-use
	}
	downloadTokensMu.Unlock()

	if !ok || time.Now().After(dt.expiresAt) {
		return re.UnauthorizedError("invalid or expired token", nil)
	}

	type descendant struct {
		ID       string
		Name     string
		IsFolder bool
		Parent   string
		File     string
		Size     int64
	}

	rows, err := app.DB().NewQuery(`
		WITH RECURSIVE descendants AS (
			SELECT id, name, is_folder, parent, file, size
			FROM drive_items WHERE id = {:rootId} AND org = {:orgId}
			UNION ALL
			SELECT di.id, di.name, di.is_folder, di.parent, di.file, di.size
			FROM drive_items di
			JOIN descendants d ON di.parent = d.id
			WHERE di.org = {:orgId}
		)
		SELECT * FROM descendants
	`).Bind(map[string]any{
		"rootId": dt.folderID,
		"orgId":  dt.orgID,
	}).Rows()
	if err != nil {
		return re.InternalServerError("query failed", nil)
	}
	defer rows.Close()

	var items []descendant
	for rows.Next() {
		var d descendant
		if err := rows.Scan(&d.ID, &d.Name, &d.IsFolder, &d.Parent, &d.File, &d.Size); err != nil {
			return re.InternalServerError("scan failed", nil)
		}
		items = append(items, d)
	}

	if len(items) == 0 {
		return re.NotFoundError("folder not found", nil)
	}

	// Check limits (exclude the root folder itself from file count)
	var fileCount int
	var totalSize int64
	for _, d := range items {
		if !d.IsFolder {
			fileCount++
			totalSize += d.Size
		}
	}
	if fileCount > maxDownloadFiles {
		return re.BadRequestError(fmt.Sprintf("too many files (%d, max %d)", fileCount, maxDownloadFiles), nil)
	}
	if totalSize > maxDownloadBytes {
		return re.BadRequestError(fmt.Sprintf("total size too large (%d bytes, max %d)", totalSize, maxDownloadBytes), nil)
	}

	// Build path map: id -> relative path from root
	byID := map[string]descendant{}
	for _, d := range items {
		byID[d.ID] = d
	}

	rootName := items[0].Name
	pathCache := map[string]string{items[0].ID: ""}

	var buildPath func(id string) string
	buildPath = func(id string) string {
		if p, ok := pathCache[id]; ok {
			return p
		}
		d := byID[id]
		parentPath := buildPath(d.Parent)
		var path string
		if parentPath == "" {
			path = d.Name
		} else {
			path = parentPath + "/" + d.Name
		}
		pathCache[id] = path
		return path
	}

	for _, d := range items {
		buildPath(d.ID)
	}

	// Stream zip response
	re.Response.Header().Set("Content-Type", "application/zip")
	re.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, sanitizeFilename(rootName)))

	zipWriter := zip.NewWriter(re.Response)
	var skippedFiles []string

	for _, d := range items {
		if d.ID == items[0].ID {
			continue // skip root folder entry
		}

		path := pathCache[d.ID]
		if d.IsFolder {
			// Add directory entry
			_, err := zipWriter.Create(path + "/")
			if err != nil {
				app.Logger().Warn("zip: failed to create dir entry", "path", path, "error", err)
			}
			continue
		}

		if d.File == "" {
			continue
		}

		// Look up the record to use readFileContent
		record, err := app.FindRecordById("drive_items", d.ID)
		if err != nil {
			skippedFiles = append(skippedFiles, fmt.Sprintf("%s: record lookup failed", path))
			continue
		}

		reader, err := readFileContent(app, record)
		if err != nil {
			skippedFiles = append(skippedFiles, fmt.Sprintf("%s: failed to read file", path))
			continue
		}

		header := &zip.FileHeader{
			Name:   path,
			Method: zip.Deflate,
		}
		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			reader.Close()
			skippedFiles = append(skippedFiles, fmt.Sprintf("%s: failed to create zip entry", path))
			continue
		}

		if _, err := io.Copy(writer, reader); err != nil {
			reader.Close()
			skippedFiles = append(skippedFiles, fmt.Sprintf("%s: copy error", path))
			continue
		}
		reader.Close()
	}

	if len(skippedFiles) > 0 {
		w, err := zipWriter.Create("_download_errors.txt")
		if err == nil {
			content := "The following files could not be included:\n\n" + strings.Join(skippedFiles, "\n") + "\n"
			w.Write([]byte(content))
		}
	}

	return zipWriter.Close()
}

func sanitizeFilename(name string) string {
	r := strings.NewReplacer(`"`, "", `\`, "", "/", "_")
	return r.Replace(name)
}
