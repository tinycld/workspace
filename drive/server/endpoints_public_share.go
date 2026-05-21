package drive

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// rateLimiter provides simple in-memory IP-based rate limiting for public endpoints.
type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	// Remove expired entries
	entries := rl.requests[ip]
	valid := entries[:0]
	for _, t := range entries {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.limit {
		rl.requests[ip] = valid
		return false
	}

	rl.requests[ip] = append(valid, now)
	return true
}

var publicShareLimiter = newRateLimiter(60, time.Minute)

func getClientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	return r.RemoteAddr
}

// findShareLinkByToken loads and validates a share link record.
// Returns the share link record and the associated drive_items record.
func findShareLinkByToken(app *pocketbase.PocketBase, token string) (*core.Record, *core.Record, int, string) {
	if len(token) != 64 {
		return nil, nil, http.StatusNotFound, "invalid token"
	}

	link, err := app.FindFirstRecordByFilter(
		"drive_share_links",
		"token = {:token}",
		map[string]any{"token": token},
	)
	if err != nil || link == nil {
		return nil, nil, http.StatusNotFound, "share link not found"
	}

	if !link.GetBool("is_active") {
		return nil, nil, http.StatusGone, "this share link has been revoked"
	}

	expiresAt := link.GetDateTime("expires_at")
	if !expiresAt.IsZero() && expiresAt.Time().Before(time.Now()) {
		return nil, nil, http.StatusGone, "this share link has expired"
	}

	itemID := link.GetString("item")
	item, err := app.FindRecordById("drive_items", itemID)
	if err != nil {
		return nil, nil, http.StatusNotFound, "file not found"
	}

	return link, item, 0, ""
}

func categorizeFromMime(mimeType string) string {
	switch {
	case mimeType == "application/pdf":
		return "pdf"
	case len(mimeType) > 6 && mimeType[:6] == "image/":
		return "image"
	case len(mimeType) > 6 && mimeType[:6] == "video/":
		return "video"
	case len(mimeType) > 6 && mimeType[:6] == "audio/":
		return "audio"
	default:
		return "unknown"
	}
}

// handleGetShareLinkMetadata returns JSON metadata for a public share link.
func handleGetShareLinkMetadata(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	ip := getClientIP(re.Request)
	if !publicShareLimiter.allow(ip) {
		return re.JSON(http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
	}

	token := re.Request.PathValue("token")
	link, item, statusCode, errMsg := findShareLinkByToken(app, token)
	if link == nil {
		return re.JSON(statusCode, map[string]string{"error": errMsg})
	}

	// Update last_accessed_at
	link.Set("last_accessed_at", time.Now().UTC().Format(time.RFC3339))
	_ = app.Save(link)

	// Look up org name and slug for display and deep linking
	orgName := ""
	orgSlug := ""
	org, err := app.FindRecordById("orgs", item.GetString("org"))
	if err == nil {
		orgName = org.GetString("name")
		orgSlug = org.GetString("slug")
	}

	// Build proxy URLs
	baseURL := fmt.Sprintf("%s/api/drive/share-link/%s", app.Settings().Meta.AppURL, token)

	response := map[string]any{
		"name":          item.GetString("name"),
		"mime_type":     item.GetString("mime_type"),
		"size":          item.GetInt("size"),
		"category":      categorizeFromMime(item.GetString("mime_type")),
		"file_url":      baseURL + "/file",
		"thumbnail_url": baseURL + "/thumbnail",
		"updated":       item.GetString("updated"),
		"org_name":      orgName,
		"org_slug":      orgSlug,
		"item_id":       item.Id,
	}

	return re.JSON(http.StatusOK, response)
}

// handleGetShareLinkFile streams the file content for a public share link.
func handleGetShareLinkFile(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	ip := getClientIP(re.Request)
	if !publicShareLimiter.allow(ip) {
		return re.JSON(http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
	}

	token := re.Request.PathValue("token")
	link, item, statusCode, errMsg := findShareLinkByToken(app, token)
	if link == nil {
		return re.JSON(statusCode, map[string]string{"error": errMsg})
	}

	// Increment download_count
	link.Set("download_count", link.GetInt("download_count")+1)
	link.Set("last_accessed_at", time.Now().UTC().Format(time.RFC3339))
	_ = app.Save(link)

	reader, err := readFileContent(app, item)
	if err != nil {
		return re.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read file"})
	}
	defer reader.Close()

	mimeType := item.GetString("mime_type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	re.Response.Header().Set("Content-Type", mimeType)

	inline := re.Request.URL.Query().Get("inline") == "1"
	disposition := "attachment"
	if inline {
		disposition = "inline"
	}
	re.Response.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, item.GetString("name")))

	_, err = io.Copy(re.Response, reader)
	return err
}

// handleGetShareLinkThumbnail streams the thumbnail for a public share link.
func handleGetShareLinkThumbnail(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	ip := getClientIP(re.Request)
	if !publicShareLimiter.allow(ip) {
		return re.JSON(http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
	}

	token := re.Request.PathValue("token")
	link, item, statusCode, errMsg := findShareLinkByToken(app, token)
	if link == nil {
		return re.JSON(statusCode, map[string]string{"error": errMsg})
	}

	thumbnail := item.GetString("thumbnail")
	if thumbnail == "" {
		return re.JSON(http.StatusNotFound, map[string]string{"error": "no thumbnail available"})
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return re.JSON(http.StatusInternalServerError, map[string]string{"error": "filesystem error"})
	}
	defer fsys.Close()

	key := item.BaseFilesPath() + "/" + thumbnail
	reader, err := fsys.GetReader(key)
	if err != nil {
		return re.JSON(http.StatusNotFound, map[string]string{"error": "thumbnail not found"})
	}
	defer reader.Close()

	re.Response.Header().Set("Content-Type", "image/png")
	re.Response.Header().Set("Cache-Control", "public, max-age=3600")
	_, err = io.Copy(re.Response, reader)
	return err
}

// handleCreateShareLink creates a new public share link for a drive item.
func handleCreateShareLink(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	var body struct {
		ItemID    string `json:"item_id"`
		Role      string `json:"role"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid request body", nil)
	}

	if body.ItemID == "" {
		return re.BadRequestError("item_id is required", nil)
	}

	item, userOrgID, err := resolveItemAndUserOrg(app, re, body.ItemID, false)
	if err != nil {
		return err
	}

	// Verify caller is owner
	if err := checkDeletePermission(app, userOrgID, item.Id); err != nil {
		return re.ForbiddenError("only the owner can create share links", nil)
	}

	// Generate 64-char hex token (32 bytes of entropy)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return re.InternalServerError("failed to generate token", err)
	}
	token := hex.EncodeToString(tokenBytes)

	role := body.Role
	if role != "editor" && role != "viewer" {
		role = "viewer"
	}

	col, err := app.FindCollectionByNameOrId("drive_share_links")
	if err != nil {
		return re.InternalServerError("collection not found", err)
	}

	record := core.NewRecord(col)
	record.Set("item", item.Id)
	record.Set("token", token)
	record.Set("created_by", userOrgID)
	record.Set("role", role)
	record.Set("is_active", true)
	record.Set("download_count", 0)

	if body.ExpiresAt != "" {
		record.Set("expires_at", body.ExpiresAt)
	}

	if err := app.Save(record); err != nil {
		return re.InternalServerError("failed to create share link", err)
	}

	shareURL := fmt.Sprintf("%s/share/%s", app.Settings().Meta.AppURL, token)

	return re.JSON(http.StatusOK, map[string]any{
		"id":    record.Id,
		"token": token,
		"url":   shareURL,
	})
}

// handleDeleteShareLink revokes a share link by setting is_active to false.
func handleDeleteShareLink(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	linkID := re.Request.PathValue("id")
	if linkID == "" {
		return re.BadRequestError("missing share link id", nil)
	}

	link, err := app.FindRecordById("drive_share_links", linkID)
	if err != nil {
		return re.NotFoundError("share link not found", nil)
	}

	// Verify caller owns the item
	itemID := link.GetString("item")
	_, userOrgID, err := resolveItemAndUserOrg(app, re, itemID, false)
	if err != nil {
		return err
	}
	if err := checkDeletePermission(app, userOrgID, itemID); err != nil {
		return re.ForbiddenError("only the owner can revoke share links", nil)
	}

	link.Set("is_active", false)
	if err := app.Save(link); err != nil {
		return re.InternalServerError("failed to revoke share link", err)
	}

	return re.JSON(http.StatusOK, map[string]any{"success": true})
}

// handleListShareLinks returns all share links for a given item.
func handleListShareLinks(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	itemID := re.Request.URL.Query().Get("item_id")
	if itemID == "" {
		return re.BadRequestError("item_id query parameter is required", nil)
	}

	_, userOrgID, err := resolveItemAndUserOrg(app, re, itemID, false)
	if err != nil {
		return err
	}
	if err := checkDeletePermission(app, userOrgID, itemID); err != nil {
		return re.ForbiddenError("only the owner can view share links", nil)
	}

	links, err := app.FindRecordsByFilter(
		"drive_share_links",
		"item = {:item}",
		"-created", 0, 0,
		map[string]any{"item": itemID},
	)
	if err != nil {
		return re.InternalServerError("failed to load share links", err)
	}

	result := make([]map[string]any, 0, len(links))
	for _, l := range links {
		shareURL := fmt.Sprintf("%s/share/%s", app.Settings().Meta.AppURL, l.GetString("token"))
		result = append(result, map[string]any{
			"id":               l.Id,
			"token":            l.GetString("token"),
			"url":              shareURL,
			"role":             l.GetString("role"),
			"is_active":        l.GetBool("is_active"),
			"expires_at":       l.GetString("expires_at"),
			"download_count":   l.GetInt("download_count"),
			"last_accessed_at": l.GetString("last_accessed_at"),
			"created":          l.GetString("created"),
		})
	}

	return re.JSON(http.StatusOK, map[string]any{"links": result})
}
