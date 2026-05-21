package mail

import (
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

type searchResultItem struct {
	ThreadID         string `json:"thread_id"`
	Subject          string `json:"subject"`
	SubjectHighlight string `json:"subject_highlight"`
	SnippetHighlight string `json:"snippet_highlight"`
	LatestDate       string `json:"latest_date"`
	Participants     string `json:"participants"`
	MessageCount     int    `json:"message_count"`
	MailboxID        string `json:"mailbox_id"`
	HasAttachments   bool   `json:"has_attachments"`
}

type searchResponse struct {
	Items []searchResultItem `json:"items"`
	Total int                `json:"total"`
}

type searchResultRow struct {
	ThreadID         string `db:"thread_id"`
	Subject          string `db:"subject"`
	SubjectHighlight string `db:"subject_highlight"`
	SnippetHighlight string `db:"snippet_highlight"`
	LatestDate       string `db:"latest_date"`
	Participants     string `db:"participants"`
	MessageCount     int    `db:"message_count"`
	MailboxID        string `db:"mailbox_id"`
	HasAttachments   bool   `db:"has_attachments"`
}

func mapResults(rows []searchResultRow) []searchResultItem {
	items := make([]searchResultItem, len(rows))
	for i, r := range rows {
		items[i] = searchResultItem{
			ThreadID:         r.ThreadID,
			Subject:          r.Subject,
			SubjectHighlight: r.SubjectHighlight,
			SnippetHighlight: r.SnippetHighlight,
			LatestDate:       r.LatestDate,
			Participants:     r.Participants,
			MessageCount:     r.MessageCount,
			MailboxID:        r.MailboxID,
			HasAttachments:   r.HasAttachments,
		}
	}
	return items
}

// threadHasAttachmentsExpr returns a SQL expression that evaluates to 1 if any
// message in thread `t` has attachments, else 0. Aggregated per-thread so the
// indicator is correct regardless of which message matched the FTS query.
const threadHasAttachmentsExpr = `EXISTS (SELECT 1 FROM mail_messages WHERE thread = t.id AND has_attachments = 1)`

// advancedFilters holds parsed advanced search parameters.
type advancedFilters struct {
	from          string
	to            string
	subject       string
	hasWords      string
	notWords      string
	sizeOp        string // "gt" or "lt"
	sizeBytes     int64
	dateAfter     string
	dateBefore    string
	folder        string
	hasAttachment bool
}

func (f *advancedFilters) hasStructuredFilters() bool {
	return f.from != "" || f.to != "" || f.subject != "" ||
		f.dateAfter != "" || f.dateBefore != "" ||
		f.hasAttachment || f.sizeBytes > 0 || f.folder != ""
}

func (f *advancedFilters) hasAnyFilter() bool {
	return f.hasStructuredFilters() || f.hasWords != "" || f.notWords != ""
}

func parseAdvancedFilters(r *http.Request) advancedFilters {
	query := r.URL.Query()
	var f advancedFilters
	f.from = strings.TrimSpace(query.Get("from"))
	f.to = strings.TrimSpace(query.Get("to"))
	f.subject = strings.TrimSpace(query.Get("subject"))
	f.hasWords = strings.TrimSpace(query.Get("has_words"))
	f.notWords = strings.TrimSpace(query.Get("not_words"))
	f.sizeOp = strings.TrimSpace(query.Get("size_op"))
	if sb, err := strconv.ParseInt(query.Get("size_bytes"), 10, 64); err == nil && sb > 0 {
		f.sizeBytes = sb
	}
	f.dateAfter = strings.TrimSpace(query.Get("date_after"))
	f.dateBefore = strings.TrimSpace(query.Get("date_before"))
	f.folder = strings.TrimSpace(query.Get("folder"))
	f.hasAttachment = query.Get("has_attachment") == "true"
	return f
}

// buildMessageWhere builds additional WHERE clauses and params for mail_messages filters.
func buildMessageWhere(f *advancedFilters, params map[string]any) string {
	var clauses []string

	if f.from != "" {
		params["fromLike"] = "%" + f.from + "%"
		clauses = append(clauses, "(m.sender_name LIKE {:fromLike} OR m.sender_email LIKE {:fromLike})")
	}
	if f.to != "" {
		params["toLike"] = "%" + f.to + "%"
		clauses = append(clauses, "(m.recipients_to LIKE {:toLike} OR m.recipients_cc LIKE {:toLike})")
	}
	if f.subject != "" {
		params["subjectLike"] = "%" + f.subject + "%"
		clauses = append(clauses, "m.subject LIKE {:subjectLike}")
	}
	if f.dateAfter != "" {
		params["dateAfter"] = f.dateAfter
		clauses = append(clauses, "m.date >= {:dateAfter}")
	}
	if f.dateBefore != "" {
		params["dateBefore"] = f.dateBefore
		clauses = append(clauses, "m.date <= {:dateBefore}")
	}
	if f.hasAttachment {
		clauses = append(clauses, "m.has_attachments = 1")
	}
	if f.sizeBytes > 0 && (f.sizeOp == "gt" || f.sizeOp == "lt") {
		params["sizeBytes"] = f.sizeBytes
		if f.sizeOp == "gt" {
			clauses = append(clauses, "m.total_size > {:sizeBytes}")
		} else {
			clauses = append(clauses, "m.total_size < {:sizeBytes}")
		}
	}

	if len(clauses) == 0 {
		return ""
	}
	return " AND " + strings.Join(clauses, " AND ")
}

// buildFolderJoin builds an additional JOIN + WHERE clause for folder/starred filtering.
func buildFolderJoin(f *advancedFilters, userOrgIDs []string, params map[string]any) string {
	if f.folder == "" || len(userOrgIDs) == 0 {
		return ""
	}

	uoPlaceholders := make([]string, len(userOrgIDs))
	for i, id := range userOrgIDs {
		key := "uo" + strconv.Itoa(i)
		params[key] = id
		uoPlaceholders[i] = "{:" + key + "}"
	}
	uoInClause := "(" + strings.Join(uoPlaceholders, ", ") + ")"

	if f.folder == "starred" {
		return " JOIN mail_thread_state ts ON ts.thread = t.id AND ts.user_org IN " + uoInClause + " AND ts.is_starred = 1"
	}

	params["folder"] = f.folder
	return " JOIN mail_thread_state ts ON ts.thread = t.id AND ts.user_org IN " + uoInClause + " AND ts.folder = {:folder}"
}

func handleSearch(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	userID := re.Auth.Id
	q := re.Request.URL.Query().Get("q")
	mailboxID := re.Request.URL.Query().Get("mailbox_id")
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

	emptyResponse := searchResponse{Items: []searchResultItem{}, Total: 0}

	filters := parseAdvancedFilters(re.Request)
	hasFTSTerms := len(q) >= 2
	hasFilters := filters.hasAnyFilter()

	if !hasFTSTerms && !hasFilters {
		return re.JSON(http.StatusOK, emptyResponse)
	}

	accessibleMailboxIDs, userOrgIDs, err := getUserMailboxAndOrgIDs(app, userID, mailboxID)
	if err != nil || len(accessibleMailboxIDs) == 0 {
		return re.JSON(http.StatusOK, emptyResponse)
	}

	mailboxParams := make(map[string]any)
	mailboxPlaceholders := make([]string, len(accessibleMailboxIDs))
	for i, id := range accessibleMailboxIDs {
		key := "mb" + strconv.Itoa(i)
		mailboxParams[key] = id
		mailboxPlaceholders[i] = "{:" + key + "}"
	}
	inClause := "(" + strings.Join(mailboxPlaceholders, ", ") + ")"

	params := map[string]any{
		"limit":  limit,
		"offset": offset,
	}
	maps.Copy(params, mailboxParams)

	messageWhere := buildMessageWhere(&filters, params)
	folderJoin := buildFolderJoin(&filters, userOrgIDs, params)

	// SQL-only path: no FTS terms, only structured filters
	if !hasFTSTerms {
		return handleStructuredSearch(app, re, inClause, messageWhere, folderJoin, params, limit, offset, emptyResponse)
	}

	// FTS path (possibly with additional structured filters)
	ftsQuery := buildAdvancedFTSQuery(q, filters.hasWords, filters.notWords)
	if ftsQuery == "" {
		if !filters.hasStructuredFilters() {
			return re.JSON(http.StatusOK, emptyResponse)
		}
		return handleStructuredSearch(app, re, inClause, messageWhere, folderJoin, params, limit, offset, emptyResponse)
	}

	params["ftsQuery"] = ftsQuery

	// When message-level filters are active, use EXISTS to avoid row multiplication
	msgExistsClause := ""
	if messageWhere != "" {
		msgExistsClause = " AND EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread = t.id" + messageWhere + ")"
	}

	threadQuery := `
		SELECT
			t.id as thread_id,
			t.subject,
			highlight(fts_mail_threads, 1, '<mark>', '</mark>') as subject_highlight,
			snippet(fts_mail_threads, 2, '<mark>', '</mark>', '...', 40) as snippet_highlight,
			t.latest_date,
			t.participants,
			t.message_count,
			t.mailbox as mailbox_id,
			` + threadHasAttachmentsExpr + ` as has_attachments,
			fts_mail_threads.rank
		FROM fts_mail_threads
		JOIN mail_threads t ON t.id = fts_mail_threads.record_id` + folderJoin + `
		WHERE fts_mail_threads MATCH {:ftsQuery}
		AND t.mailbox IN ` + inClause + msgExistsClause

	messageQuery := `
		SELECT
			t.id as thread_id,
			t.subject,
			'' as subject_highlight,
			snippet(fts_mail_messages, 5, '<mark>', '</mark>', '...', 40) as snippet_highlight,
			t.latest_date,
			t.participants,
			t.message_count,
			t.mailbox as mailbox_id,
			` + threadHasAttachmentsExpr + ` as has_attachments,
			fts_mail_messages.rank
		FROM fts_mail_messages
		JOIN mail_messages m ON m.id = fts_mail_messages.record_id
		JOIN mail_threads t ON t.id = m.thread` + folderJoin + `
		WHERE fts_mail_messages MATCH {:ftsQuery}
		AND t.mailbox IN ` + inClause + messageWhere

	combinedQuery := `
		SELECT thread_id, MAX(subject) as subject,
			   MAX(subject_highlight) as subject_highlight,
			   MAX(snippet_highlight) as snippet_highlight,
			   MAX(latest_date) as latest_date,
			   MAX(participants) as participants,
			   MAX(message_count) as message_count,
			   MAX(mailbox_id) as mailbox_id,
			   MAX(has_attachments) as has_attachments
		FROM (
			` + threadQuery + `
			UNION ALL
			` + messageQuery + `
		)
		GROUP BY thread_id
		ORDER BY MIN(rank)
		LIMIT {:limit} OFFSET {:offset}
	`

	var results []searchResultRow
	err = app.DB().NewQuery(combinedQuery).Bind(dbx.Params(params)).All(&results)
	if err != nil {
		app.Logger().Warn("FTS: search query failed", "error", err, "query", q)
		return re.JSON(http.StatusOK, emptyResponse)
	}

	items := mapResults(results)
	total := len(items)
	if len(items) >= limit {
		countQuery := `
			SELECT COUNT(DISTINCT thread_id) as total FROM (
				SELECT t.id as thread_id
				FROM fts_mail_threads
				JOIN mail_threads t ON t.id = fts_mail_threads.record_id` + folderJoin + `
				WHERE fts_mail_threads MATCH {:ftsQuery}
				AND t.mailbox IN ` + inClause + msgExistsClause + `
				UNION
				SELECT t.id as thread_id
				FROM fts_mail_messages
				JOIN mail_messages m ON m.id = fts_mail_messages.record_id
				JOIN mail_threads t ON t.id = m.thread` + folderJoin + `
				WHERE fts_mail_messages MATCH {:ftsQuery}
				AND t.mailbox IN ` + inClause + messageWhere + `
			)
		`
		var countResult struct {
			Total int `db:"total"`
		}
		countParams := map[string]any{"ftsQuery": ftsQuery}
		maps.Copy(countParams, mailboxParams)
		// Copy filter params needed for WHERE clauses
		for k, v := range params {
			if k != "limit" && k != "offset" && k != "ftsQuery" {
				countParams[k] = v
			}
		}
		if err := app.DB().NewQuery(countQuery).Bind(dbx.Params(countParams)).One(&countResult); err == nil {
			total = countResult.Total
		}
	} else if offset > 0 {
		total = offset + len(items)
	}

	return re.JSON(http.StatusOK, searchResponse{Items: items, Total: total})
}

// handleStructuredSearch runs a SQL-only search (no FTS) when only structured filters are present.
func handleStructuredSearch(
	app *pocketbase.PocketBase,
	re *core.RequestEvent,
	inClause, messageWhere, folderJoin string,
	params map[string]any,
	limit, offset int,
	emptyResponse searchResponse,
) error {
	query := `
		SELECT DISTINCT
			t.id as thread_id,
			t.subject,
			'' as subject_highlight,
			t.snippet as snippet_highlight,
			t.latest_date,
			t.participants,
			t.message_count,
			t.mailbox as mailbox_id,
			` + threadHasAttachmentsExpr + ` as has_attachments
		FROM mail_threads t
		JOIN mail_messages m ON m.thread = t.id` + folderJoin + `
		WHERE t.mailbox IN ` + inClause + messageWhere + `
		ORDER BY t.latest_date DESC
		LIMIT {:limit} OFFSET {:offset}
	`

	var results []searchResultRow
	err := app.DB().NewQuery(query).Bind(dbx.Params(params)).All(&results)
	if err != nil {
		app.Logger().Warn("Structured search failed", "error", err)
		return re.JSON(http.StatusOK, emptyResponse)
	}

	items := mapResults(results)
	total := len(items)
	if len(items) >= limit {
		countQuery := `
			SELECT COUNT(DISTINCT t.id) as total
			FROM mail_threads t
			JOIN mail_messages m ON m.thread = t.id` + folderJoin + `
			WHERE t.mailbox IN ` + inClause + messageWhere + `
		`
		countParams := make(map[string]any)
		for k, v := range params {
			if k != "limit" && k != "offset" {
				countParams[k] = v
			}
		}
		var countResult struct {
			Total int `db:"total"`
		}
		if err := app.DB().NewQuery(countQuery).Bind(dbx.Params(countParams)).One(&countResult); err == nil {
			total = countResult.Total
		}
	} else if offset > 0 {
		total = offset + len(items)
	}

	return re.JSON(http.StatusOK, searchResponse{Items: items, Total: total})
}

// getUserMailboxAndOrgIDs returns the mailbox IDs and user_org IDs the user has access to.
// If mailboxID is provided, it filters to just that mailbox (after verifying access).
func getUserMailboxAndOrgIDs(app *pocketbase.PocketBase, userID, mailboxID string) ([]string, []string, error) {
	userOrgs, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:user}",
		"",
		100,
		0,
		map[string]any{"user": userID},
	)
	if err != nil || len(userOrgs) == 0 {
		return nil, nil, err
	}

	userOrgIDs := make([]string, len(userOrgs))
	for i, uo := range userOrgs {
		userOrgIDs[i] = uo.Id
	}

	var allMailboxIDs []string
	for _, uoID := range userOrgIDs {
		members, err := app.FindRecordsByFilter(
			"mail_mailbox_members",
			"user_org = {:userOrg}",
			"",
			100,
			0,
			map[string]any{"userOrg": uoID},
		)
		if err != nil {
			continue
		}
		for _, m := range members {
			allMailboxIDs = append(allMailboxIDs, m.GetString("mailbox"))
		}
	}

	if mailboxID != "" {
		if slices.Contains(allMailboxIDs, mailboxID) {
			return []string{mailboxID}, userOrgIDs, nil
		}
		return nil, userOrgIDs, nil
	}

	return allMailboxIDs, userOrgIDs, nil
}
