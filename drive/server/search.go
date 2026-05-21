package drive

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

var fts5SpecialChars = regexp.MustCompile(`[":*^{}()\[\]~\-]`)

func sanitizeFTSQuery(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}

	cleaned := fts5SpecialChars.ReplaceAllString(input, " ")
	terms := strings.Fields(cleaned)
	if len(terms) == 0 {
		return ""
	}

	quoted := make([]string, len(terms))
	for i, term := range terms {
		term = strings.ReplaceAll(term, `"`, `""`)
		quoted[i] = `"` + term + `"`
	}

	return strings.Join(quoted, " ")
}

func syncDriveItemToFTS(app *pocketbase.PocketBase, record *core.Record, op string) {
	db := app.NonconcurrentDB()
	recordID := record.Id

	_, err := db.NewQuery("DELETE FROM fts_drive_items WHERE record_id = {:id}").
		Bind(map[string]any{"id": recordID}).Execute()
	if err != nil {
		app.Logger().Warn("FTS: failed to delete drive item from index",
			"id", recordID, "error", err)
	}

	if op == "delete" {
		return
	}

	_, err = db.NewQuery(`
		INSERT INTO fts_drive_items (record_id, name, description, content)
		VALUES ({:id}, {:name}, {:description}, {:content})
	`).Bind(map[string]any{
		"id":          recordID,
		"name":        record.GetString("name"),
		"description": record.GetString("description"),
		"content":     "",
	}).Execute()

	if err != nil {
		app.Logger().Warn("FTS: failed to index drive item",
			"id", recordID, "error", err)
	}
}

// updateFTSContent updates just the content field for async extraction results.
func updateFTSContent(app *pocketbase.PocketBase, recordID, content string) {
	db := app.NonconcurrentDB()

	// Re-read the record to get current name/description
	record, err := app.FindRecordById("drive_items", recordID)
	if err != nil {
		return
	}

	_, err = db.NewQuery("DELETE FROM fts_drive_items WHERE record_id = {:id}").
		Bind(map[string]any{"id": recordID}).Execute()
	if err != nil {
		app.Logger().Warn("FTS: failed to delete drive item for content update",
			"id", recordID, "error", err)
	}

	_, err = db.NewQuery(`
		INSERT INTO fts_drive_items (record_id, name, description, content)
		VALUES ({:id}, {:name}, {:description}, {:content})
	`).Bind(map[string]any{
		"id":          recordID,
		"name":        record.GetString("name"),
		"description": record.GetString("description"),
		"content":     content,
	}).Execute()

	if err != nil {
		app.Logger().Warn("FTS: failed to update drive item content",
			"id", recordID, "error", err)
	}
}

type driveSearchResultItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	IsFolder    bool   `json:"is_folder"`
	MimeType    string `json:"mime_type"`
	Size        int64  `json:"size"`
	Description string `json:"description"`
	Highlight   string `json:"highlight"`
}

type driveSearchResponse struct {
	Items []driveSearchResultItem `json:"items"`
	Total int                     `json:"total"`
}

func handleDriveSearch(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	userID := re.Auth.Id
	q := re.Request.URL.Query().Get("q")
	orgID := re.Request.URL.Query().Get("org")
	limitStr := re.Request.URL.Query().Get("limit")
	offsetStr := re.Request.URL.Query().Get("offset")

	limit := 25
	offset := 0
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
		limit = l
	}
	if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
		offset = o
	}

	emptyResponse := driveSearchResponse{Items: []driveSearchResultItem{}, Total: 0}

	if len(q) < 2 {
		return re.JSON(http.StatusOK, emptyResponse)
	}

	ftsQuery := sanitizeFTSQuery(q)
	if ftsQuery == "" {
		return re.JSON(http.StatusOK, emptyResponse)
	}

	// Get user's org memberships for authorization
	userOrgIDs, err := getUserOrgIDs(app, userID)
	if err != nil || len(userOrgIDs) == 0 {
		return re.JSON(http.StatusOK, emptyResponse)
	}

	// Build IN clause for share filtering
	shareParams := make(map[string]any)
	sharePlaceholders := make([]string, len(userOrgIDs))
	for i, id := range userOrgIDs {
		key := "uo" + strconv.Itoa(i)
		shareParams[key] = id
		sharePlaceholders[i] = "{:" + key + "}"
	}
	inClause := "(" + strings.Join(sharePlaceholders, ", ") + ")"

	orgFilter := ""
	if orgID != "" {
		orgFilter = " AND d.org = {:orgID}"
	}

	searchQuery := `
		SELECT DISTINCT
			d.id,
			d.name,
			d.is_folder,
			d.mime_type,
			d.size,
			d.description,
			snippet(fts_drive_items, -1, '<mark>', '</mark>', '...', 30) as highlight
		FROM fts_drive_items
		JOIN drive_items d ON d.id = fts_drive_items.record_id
		JOIN drive_shares ds ON ds.item = d.id
		WHERE fts_drive_items MATCH {:ftsQuery}
		AND ds.user_org IN ` + inClause + orgFilter + `
		ORDER BY fts_drive_items.rank
		LIMIT {:limit} OFFSET {:offset}
	`

	params := map[string]any{
		"ftsQuery": ftsQuery,
		"limit":    limit,
		"offset":   offset,
	}
	if orgID != "" {
		params["orgID"] = orgID
	}
	for k, v := range shareParams {
		params[k] = v
	}

	var results []struct {
		ID          string `db:"id"`
		Name        string `db:"name"`
		IsFolder    bool   `db:"is_folder"`
		MimeType    string `db:"mime_type"`
		Size        int64  `db:"size"`
		Description string `db:"description"`
		Highlight   string `db:"highlight"`
	}

	err = app.DB().NewQuery(searchQuery).Bind(dbx.Params(params)).All(&results)
	if err != nil {
		app.Logger().Warn("FTS: drive search query failed", "error", err, "query", q)
		return re.JSON(http.StatusOK, emptyResponse)
	}

	items := make([]driveSearchResultItem, len(results))
	for i, r := range results {
		items[i] = driveSearchResultItem{
			ID:          r.ID,
			Name:        r.Name,
			IsFolder:    r.IsFolder,
			MimeType:    r.MimeType,
			Size:        r.Size,
			Description: r.Description,
			Highlight:   r.Highlight,
		}
	}

	// Count total
	countQuery := `
		SELECT COUNT(DISTINCT d.id) as total
		FROM fts_drive_items
		JOIN drive_items d ON d.id = fts_drive_items.record_id
		JOIN drive_shares ds ON ds.item = d.id
		WHERE fts_drive_items MATCH {:ftsQuery}
		AND ds.user_org IN ` + inClause + orgFilter

	countParams := map[string]any{"ftsQuery": ftsQuery}
	if orgID != "" {
		countParams["orgID"] = orgID
	}
	for k, v := range shareParams {
		countParams[k] = v
	}

	var countResult struct {
		Total int `db:"total"`
	}
	if err := app.DB().NewQuery(countQuery).Bind(dbx.Params(countParams)).One(&countResult); err != nil {
		countResult.Total = len(items)
	}

	return re.JSON(http.StatusOK, driveSearchResponse{Items: items, Total: countResult.Total})
}

func getUserOrgIDs(app *pocketbase.PocketBase, userID string) ([]string, error) {
	userOrgs, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:user}",
		"",
		100,
		0,
		map[string]any{"user": userID},
	)
	if err != nil {
		return nil, err
	}

	ids := make([]string, len(userOrgs))
	for i, uo := range userOrgs {
		ids[i] = uo.Id
	}
	return ids, nil
}
