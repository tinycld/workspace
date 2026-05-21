package mail

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"mime"
	"regexp"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/textextract"
)

// recentlyIndexed tracks message IDs that were indexed inline by storeMessage(),
// so the PB record hook can skip re-indexing with a truncated snippet.
var recentlyIndexed sync.Map

// fts5SpecialChars matches characters that have special meaning in FTS5 queries.
var fts5SpecialChars = regexp.MustCompile(`[":*^{}()\[\]~\-]`)

// buildAdvancedFTSQuery builds an FTS5 query from the main query, hasWords, and notWords.
// hasWords terms are filtered to the body_text column; notWords are appended as NOT clauses.
func buildAdvancedFTSQuery(q, hasWords, notWords string) string {
	base := sanitizeFTSQuery(q)

	if hw := strings.TrimSpace(hasWords); hw != "" {
		cleaned := fts5SpecialChars.ReplaceAllString(hw, " ")
		terms := strings.Fields(cleaned)
		for _, term := range terms {
			term = strings.ReplaceAll(term, `"`, `""`)
			base += ` body_text : "` + term + `"*`
		}
	}

	if nw := strings.TrimSpace(notWords); nw != "" {
		cleaned := fts5SpecialChars.ReplaceAllString(nw, " ")
		terms := strings.Fields(cleaned)
		// FTS5 requires at least one positive term; NOT-only queries error.
		// If no positive terms exist, skip NOT terms (caller falls back to SQL-only).
		if strings.TrimSpace(base) != "" {
			for _, term := range terms {
				term = strings.ReplaceAll(term, `"`, `""`)
				base += ` NOT "` + term + `"`
			}
		}
	}

	return strings.TrimSpace(base)
}

// sanitizeFTSQuery escapes special FTS5 characters and wraps each term in quotes
// so that user input is always treated as literal text.
func sanitizeFTSQuery(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}

	// Remove special FTS5 characters
	cleaned := fts5SpecialChars.ReplaceAllString(input, " ")

	// Split into terms and quote each one
	terms := strings.Fields(cleaned)
	if len(terms) == 0 {
		return ""
	}

	quoted := make([]string, len(terms))
	for i, term := range terms {
		// Double any internal quotes (defensive)
		term = strings.ReplaceAll(term, `"`, `""`)
		quoted[i] = `"` + term + `"*`
	}

	return strings.Join(quoted, " ")
}

// syncThreadToFTS upserts a mail_threads record into the FTS index.
// FTS5 doesn't support UPDATE, so we DELETE then INSERT.
func syncThreadToFTS(app core.App, record *core.Record, op string) {
	db := app.NonconcurrentDB()
	recordID := record.Id

	// Always delete first (for both update and create — idempotent)
	_, err := db.NewQuery("DELETE FROM fts_mail_threads WHERE record_id = {:id}").
		Bind(map[string]any{"id": recordID}).Execute()
	if err != nil {
		app.Logger().Warn("FTS: failed to delete thread from index",
			"id", recordID, "error", err)
	}

	if op == "delete" {
		return
	}

	// Flatten participants JSON to searchable text
	participantsText := flattenParticipants(record.GetString("participants"))

	_, err = db.NewQuery(`
		INSERT INTO fts_mail_threads (record_id, subject, snippet, participants)
		VALUES ({:id}, {:subject}, {:snippet}, {:participants})
	`).Bind(map[string]any{
		"id":           recordID,
		"subject":      record.GetString("subject"),
		"snippet":      record.GetString("snippet"),
		"participants": participantsText,
	}).Execute()

	if err != nil {
		app.Logger().Warn("FTS: failed to index thread",
			"id", recordID, "error", err)
	}
}

// syncMessageToFTS indexes a message into FTS. Called inline from storeMessage()
// so we have access to the full TextBody (not persisted as a PB field).
// attachmentText is optional text extracted from text-based attachments.
func syncMessageToFTS(app core.App, recordID string, msg *storedMessage, attachmentText string) {
	db := app.NonconcurrentDB()

	// Delete first (idempotent upsert)
	_, err := db.NewQuery("DELETE FROM fts_mail_messages WHERE record_id = {:id}").
		Bind(map[string]any{"id": recordID}).Execute()
	if err != nil {
		app.Logger().Warn("FTS: failed to delete message from index",
			"id", recordID, "error", err)
	}

	snippet := msg.StrippedReply
	if snippet == "" {
		snippet = msg.TextBody
	}
	snippet = truncateSnippet(snippet, 200)

	bodyText := msg.TextBody
	if attachmentText != "" {
		bodyText = bodyText + " " + attachmentText
	}

	_, err = db.NewQuery(`
		INSERT INTO fts_mail_messages (record_id, subject, snippet, sender_name, sender_email, body_text)
		VALUES ({:id}, {:subject}, {:snippet}, {:sender_name}, {:sender_email}, {:body_text})
	`).Bind(map[string]any{
		"id":           recordID,
		"subject":      msg.Subject,
		"snippet":      snippet,
		"sender_name":  msg.SenderName,
		"sender_email": msg.SenderEmail,
		"body_text":    bodyText,
	}).Execute()

	if err != nil {
		app.Logger().Warn("FTS: failed to index message",
			"id", recordID, "error", err)
	}
}

// deleteMessageFromFTS removes a message from the FTS index.
func deleteMessageFromFTS(app core.App, recordID string) {
	db := app.NonconcurrentDB()
	_, err := db.NewQuery("DELETE FROM fts_mail_messages WHERE record_id = {:id}").
		Bind(map[string]any{"id": recordID}).Execute()
	if err != nil {
		app.Logger().Warn("FTS: failed to delete message from index",
			"id", recordID, "error", err)
	}
}

// flattenParticipants converts a JSON array of {name, email} objects into
// a space-separated string for FTS indexing.
func flattenParticipants(jsonStr string) string {
	if jsonStr == "" || jsonStr == "[]" {
		return ""
	}

	var participants []Recipient
	if err := json.Unmarshal([]byte(jsonStr), &participants); err != nil {
		return ""
	}

	var parts []string
	for _, p := range participants {
		if p.Name != "" {
			parts = append(parts, p.Name)
		}
		if p.Email != "" {
			parts = append(parts, p.Email)
		}
	}
	return strings.Join(parts, " ")
}

const maxAttachmentBytes = 50 * 1024 // 50KB per attachment

// extractTextFromAttachments extracts searchable text from inline attachments
// (used by storeMessage where we have base64-encoded content in memory).
// Supports all formats registered in textextract (PDF, DOCX, XLSX, PPTX, etc).
func extractTextFromAttachments(attachments []InboundAttachment) string {
	var texts []string
	for _, att := range attachments {
		decoded, err := base64.StdEncoding.DecodeString(att.Content)
		if err != nil {
			continue
		}
		text, err := textextract.Extract(bytes.NewReader(decoded), att.ContentType, maxAttachmentBytes)
		if err != nil || text == "" {
			continue
		}
		texts = append(texts, text)
	}
	return strings.Join(texts, " ")
}

// loadTextAttachments extracts searchable text from stored attachments for a record.
// Used by the record hook when storeMessage wasn't involved.
// Supports all formats registered in textextract (PDF, DOCX, XLSX, PPTX, etc).
func loadTextAttachments(app core.App, record *core.Record) string {
	filenames := record.GetStringSlice("attachments")
	if len(filenames) == 0 {
		return ""
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return ""
	}
	defer fsys.Close()

	var texts []string
	for _, filename := range filenames {
		ext := fileExtension(filename)
		if ext == "" {
			continue
		}
		ct := mime.TypeByExtension("." + ext)
		if ct == "" {
			continue
		}

		key := record.BaseFilesPath() + "/" + filename
		blob, err := fsys.GetReader(key)
		if err != nil {
			continue
		}
		text, extractErr := textextract.Extract(blob, ct, maxAttachmentBytes)
		blob.Close()
		if extractErr != nil || text == "" {
			continue
		}
		texts = append(texts, text)
	}
	return strings.Join(texts, " ")
}
