package contacts

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

type contactSearchResultItem struct {
	ID        string `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	Company   string `json:"company"`
	Phone     string `json:"phone"`
	Favorite  bool   `json:"favorite"`
	Highlight string `json:"highlight"`
}

type contactSearchResponse struct {
	Items []contactSearchResultItem `json:"items"`
	Total int                       `json:"total"`
}

func handleContactSearch(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	userID := re.Auth.Id
	q := re.Request.URL.Query().Get("q")
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

	emptyResponse := contactSearchResponse{Items: []contactSearchResultItem{}, Total: 0}

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

	// Build IN clause for owner filtering
	ownerParams := make(map[string]any)
	ownerPlaceholders := make([]string, len(userOrgIDs))
	for i, id := range userOrgIDs {
		key := "uo" + strconv.Itoa(i)
		ownerParams[key] = id
		ownerPlaceholders[i] = "{:" + key + "}"
	}
	inClause := "(" + strings.Join(ownerPlaceholders, ", ") + ")"

	searchQuery := `
		SELECT
			c.id,
			c.first_name,
			c.last_name,
			c.email,
			c.company,
			c.phone,
			c.favorite,
			snippet(fts_contacts, -1, '<mark>', '</mark>', '...', 30) as highlight
		FROM fts_contacts
		JOIN contacts c ON c.id = fts_contacts.record_id
		WHERE fts_contacts MATCH {:ftsQuery}
		AND c.owner IN ` + inClause + `
		AND c.deleted_at = ''
		ORDER BY fts_contacts.rank
		LIMIT {:limit} OFFSET {:offset}
	`

	params := map[string]any{
		"ftsQuery": ftsQuery,
		"limit":    limit,
		"offset":   offset,
	}
	for k, v := range ownerParams {
		params[k] = v
	}

	var results []struct {
		ID        string `db:"id"`
		FirstName string `db:"first_name"`
		LastName  string `db:"last_name"`
		Email     string `db:"email"`
		Company   string `db:"company"`
		Phone     string `db:"phone"`
		Favorite  bool   `db:"favorite"`
		Highlight string `db:"highlight"`
	}

	err = app.DB().NewQuery(searchQuery).Bind(dbx.Params(params)).All(&results)
	if err != nil {
		app.Logger().Warn("FTS: contact search query failed", "error", err, "query", q)
		return re.JSON(http.StatusOK, emptyResponse)
	}

	items := make([]contactSearchResultItem, len(results))
	for i, r := range results {
		items[i] = contactSearchResultItem{
			ID:        r.ID,
			FirstName: r.FirstName,
			LastName:  r.LastName,
			Email:     r.Email,
			Company:   r.Company,
			Phone:     r.Phone,
			Favorite:  r.Favorite,
			Highlight: r.Highlight,
		}
	}

	// Count total
	countQuery := `
		SELECT COUNT(*) as total
		FROM fts_contacts
		JOIN contacts c ON c.id = fts_contacts.record_id
		WHERE fts_contacts MATCH {:ftsQuery}
		AND c.owner IN ` + inClause + `
		AND c.deleted_at = ''`

	var countResult struct {
		Total int `db:"total"`
	}
	countParams := map[string]any{"ftsQuery": ftsQuery}
	for k, v := range ownerParams {
		countParams[k] = v
	}
	if err := app.DB().NewQuery(countQuery).Bind(dbx.Params(countParams)).One(&countResult); err != nil {
		countResult.Total = len(items)
	}

	return re.JSON(http.StatusOK, contactSearchResponse{Items: items, Total: countResult.Total})
}

// getUserOrgIDs returns all user_org IDs for a given user.
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
