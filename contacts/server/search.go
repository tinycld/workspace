package contacts

import (
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// fts5SpecialChars matches characters that have special meaning in FTS5 queries.
var fts5SpecialChars = regexp.MustCompile(`[":*^{}()\[\]~\-]`)

// sanitizeFTSQuery escapes special FTS5 characters for safe MATCH queries.
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

	// Use prefix matches (term*) so search-as-you-type finds partial words
	// like "joh" -> "john", "johnson". FTS5's bare phrase syntax ("joh")
	// is an exact token match and would only fire when the user types a
	// whole indexed word. Each term is also quoted to keep any residual
	// punctuation from being interpreted as FTS5 operators.
	prefixed := make([]string, len(terms))
	for i, term := range terms {
		term = strings.ReplaceAll(term, `"`, `""`)
		prefixed[i] = `"` + term + `"*`
	}

	return strings.Join(prefixed, " ")
}

// syncContactToFTS upserts a contacts record into the FTS index.
func syncContactToFTS(app *pocketbase.PocketBase, record *core.Record, op string) {
	db := app.NonconcurrentDB()
	recordID := record.Id

	// Always delete first (idempotent upsert)
	_, err := db.NewQuery("DELETE FROM fts_contacts WHERE record_id = {:id}").
		Bind(map[string]any{"id": recordID}).Execute()
	if err != nil {
		app.Logger().Warn("FTS: failed to delete contact from index",
			"id", recordID, "error", err)
	}

	if op == "delete" {
		return
	}

	// Strip HTML from notes (editor field may contain HTML)
	notes := stripHTML(record.GetString("notes"))

	_, err = db.NewQuery(`
		INSERT INTO fts_contacts (record_id, first_name, last_name, email, company, phone, notes)
		VALUES ({:id}, {:first_name}, {:last_name}, {:email}, {:company}, {:phone}, {:notes})
	`).Bind(map[string]any{
		"id":         recordID,
		"first_name": record.GetString("first_name"),
		"last_name":  record.GetString("last_name"),
		"email":      record.GetString("email"),
		"company":    record.GetString("company"),
		"phone":      record.GetString("phone"),
		"notes":      notes,
	}).Execute()

	if err != nil {
		app.Logger().Warn("FTS: failed to index contact",
			"id", recordID, "error", err)
	}
}

// htmlTagRegex is a simple regex to strip HTML tags for FTS indexing.
var htmlTagRegex = regexp.MustCompile(`<[^>]*>`)

// stripHTML removes HTML tags from a string for plain-text indexing.
func stripHTML(s string) string {
	return strings.TrimSpace(htmlTagRegex.ReplaceAllString(s, " "))
}
