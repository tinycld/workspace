package mail

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// findOrCreateThread finds an existing thread or creates a new one.
// Thread matching priority:
//  1. In-Reply-To header → match against mail_messages.message_id in the same mailbox
//  2. References header → match any referenced message_id in the same mailbox
//  3. Subject prefix match (Re:, Fwd:) → match by normalized subject in the same mailbox
func findOrCreateThread(app core.App, mailboxID, subject, inReplyTo, references string) (*core.Record, error) {
	// 1. Match by In-Reply-To
	if inReplyTo != "" {
		thread, err := findThreadByMessageID(app, mailboxID, inReplyTo)
		if err == nil && thread != nil {
			return thread, nil
		}
	}

	// 2. Match by References (check each, most recent first)
	if references != "" {
		refs := strings.Fields(references)
		for i := len(refs) - 1; i >= 0; i-- {
			thread, err := findThreadByMessageID(app, mailboxID, refs[i])
			if err == nil && thread != nil {
				return thread, nil
			}
		}
	}

	// 3. Match by normalized subject
	normalized := normalizeSubject(subject)
	if normalized != subject && normalized != "" {
		threads, err := app.FindRecordsByFilter(
			"mail_threads",
			"mailbox = {:mailbox} && subject = {:subject}",
			"-latest_date",
			1,
			0,
			map[string]any{"mailbox": mailboxID, "subject": normalized},
		)
		if err == nil && len(threads) > 0 {
			return threads[0], nil
		}
	}

	// 4. Create new thread
	collection, err := app.FindCollectionByNameOrId("mail_threads")
	if err != nil {
		return nil, fmt.Errorf("mail_threads collection not found: %w", err)
	}
	thread := core.NewRecord(collection)
	thread.Set("mailbox", mailboxID)
	thread.Set("subject", normalized)
	thread.Set("snippet", "")
	thread.Set("message_count", 0)
	thread.Set("latest_date", time.Now().UTC().Format(time.RFC3339))
	thread.Set("participants", "[]")
	if err := app.Save(thread); err != nil {
		return nil, fmt.Errorf("failed to create thread: %w", err)
	}

	return thread, nil
}

// findMessageInMailbox returns an existing mail_messages record (and its
// thread) when one with the given Message-ID already exists in the given
// mailbox. Returns (nil, nil, nil) when no match exists or messageID is
// empty (an empty Message-ID would falsely collapse unrelated messages).
// Used to dedup the SMTP-submission + IMAP-APPEND-to-Sent collision: most
// IMAP clients append a copy of a sent message to the Sent folder after
// SMTP submission, and without this check we'd store both copies.
func findMessageInMailbox(app core.App, mailboxID, messageID string) (*core.Record, *core.Record, error) {
	if messageID == "" || mailboxID == "" {
		return nil, nil, nil
	}
	candidates, err := app.FindRecordsByFilter(
		"mail_messages",
		"message_id = {:messageID}",
		"",
		10,
		0,
		map[string]any{"messageID": messageID},
	)
	if err != nil || len(candidates) == 0 {
		return nil, nil, nil
	}
	for _, msg := range candidates {
		thread, err := app.FindRecordById("mail_threads", msg.GetString("thread"))
		if err != nil {
			continue
		}
		if thread.GetString("mailbox") == mailboxID {
			return msg, thread, nil
		}
	}
	return nil, nil, nil
}

func findThreadByMessageID(app core.App, mailboxID, messageID string) (*core.Record, error) {
	messages, err := app.FindRecordsByFilter(
		"mail_messages",
		"message_id = {:messageID}",
		"",
		1,
		0,
		map[string]any{"messageID": messageID},
	)
	if err != nil || len(messages) == 0 {
		return nil, fmt.Errorf("no message found with message_id %s", messageID)
	}

	threadID := messages[0].GetString("thread")
	thread, err := app.FindRecordById("mail_threads", threadID)
	if err != nil {
		return nil, err
	}

	// Verify the thread belongs to the target mailbox
	if thread.GetString("mailbox") != mailboxID {
		return nil, fmt.Errorf("thread belongs to a different mailbox")
	}

	return thread, nil
}

// storeMessage creates a mail_messages record with body_html stored as a file.
func storeMessage(app core.App, threadID string, msg *storedMessage) (*core.Record, error) {
	collection, err := app.FindCollectionByNameOrId("mail_messages")
	if err != nil {
		return nil, fmt.Errorf("mail_messages collection not found: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("thread", threadID)
	record.Set("message_id", msg.MessageID)
	record.Set("in_reply_to", msg.InReplyTo)
	if msg.Alias != "" {
		record.Set("alias", msg.Alias)
	}
	record.Set("sender_name", msg.SenderName)
	record.Set("sender_email", msg.SenderEmail)
	record.Set("date", msg.Date)
	record.Set("subject", msg.Subject)
	snippetSource := msg.StrippedReply
	if snippetSource == "" {
		snippetSource = msg.TextBody
	}
	record.Set("snippet", truncateSnippet(snippetSource, 200))
	record.Set("has_attachments", len(msg.Attachments) > 0)

	totalSize := int64(len(msg.HTMLBody))
	for _, att := range msg.Attachments {
		totalSize += att.Size
	}
	record.Set("total_size", totalSize)

	deliveryStatus := msg.DeliveryStatus
	if deliveryStatus == "" {
		deliveryStatus = "sending"
	}
	record.Set("delivery_status", deliveryStatus)

	if msg.HTMLBody != "" {
		sanitized := sanitizeEmailHTML(msg.HTMLBody)
		htmlFile, err := filesystem.NewFileFromBytes([]byte(sanitized), "body.html")
		if err != nil {
			return nil, fmt.Errorf("failed to create body_html file: %w", err)
		}
		record.Set("body_html", htmlFile)
	}

	for _, att := range msg.Attachments {
		decoded, err := base64.StdEncoding.DecodeString(att.Content)
		if err != nil {
			app.Logger().Warn("failed to decode attachment",
				"name", att.Name, "error", err)
			continue
		}
		f, err := filesystem.NewFileFromBytes(decoded, att.Name)
		if err != nil {
			app.Logger().Warn("failed to create attachment file",
				"name", att.Name, "error", err)
			continue
		}
		record.Set("attachments+", f)
	}

	toJSON, err := json.Marshal(msg.To)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal recipients_to: %w", err)
	}
	record.Set("recipients_to", string(toJSON))

	ccJSON, err := json.Marshal(msg.Cc)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal recipients_cc: %w", err)
	}
	record.Set("recipients_cc", string(ccJSON))

	// Mark as recently indexed so the record hook skips re-indexing
	recentlyIndexed.Store(record.Id, true)

	if err := app.Save(record); err != nil {
		recentlyIndexed.Delete(record.Id)
		return nil, fmt.Errorf("failed to store message: %w", err)
	}

	// Build cid → stored-filename map for inline images. Stored as JSON on
	// the message so the client can resolve <img src="cid:foo"> against
	// pb.files.getURL at render time. Doing the resolution client-side
	// keeps the URL host correct under every deployment (dev, test, prod
	// can serve PB on different hosts than the web app).
	cidMap := buildCIDMap(msg.Attachments, record.GetStringSlice("attachments"))
	if len(cidMap) > 0 {
		cidJSON, err := json.Marshal(cidMap)
		if err == nil {
			record.Set("cid_map", string(cidJSON))
			recentlyIndexed.Store(record.Id, true)
			if err := app.Save(record); err != nil {
				recentlyIndexed.Delete(record.Id)
				app.Logger().Warn("failed to save cid_map", "messageID", record.Id, "error", err)
			}
		}
	}

	// Assign IMAP UID for the new message
	thread, err := app.FindRecordById("mail_threads", threadID)
	if err == nil {
		mailboxID := thread.GetString("mailbox")
		if _, uidErr := ensureMessageUID(app, mailboxID, record); uidErr != nil {
			app.Logger().Warn("failed to assign imap_uid", "messageID", record.Id, "error", uidErr)
		}
	}

	// Index in FTS — done inline so we have access to full TextBody + attachments
	attachmentText := extractTextFromAttachments(msg.Attachments)
	syncMessageToFTS(app, record.Id, msg, attachmentText)

	return record, nil
}

// storedMessage is the internal representation passed to storeMessage.
type storedMessage struct {
	MessageID      string
	InReplyTo      string
	Alias          string
	References     string
	SenderName     string
	SenderEmail    string
	To             []Recipient
	Cc             []Recipient
	Date           string
	Subject        string
	HTMLBody       string
	TextBody       string
	StrippedReply  string
	Attachments    []InboundAttachment
	DeliveryStatus string // "sending", "sent", "delivered", "bounced", "spam_complaint", "draft"
}

// updateThreadMetadata updates the thread's snippet, latest_date, message_count, and participants.
func updateThreadMetadata(app core.App, thread *core.Record, senderName, senderEmail, snippet, date string) error {
	count := thread.GetInt("message_count") + 1
	thread.Set("message_count", count)
	thread.Set("snippet", truncateSnippet(snippet, 200))
	thread.Set("latest_date", date)

	// Merge sender into participants list
	var participants []Recipient
	existing := thread.GetString("participants")
	if existing != "" {
		_ = json.Unmarshal([]byte(existing), &participants)
	}

	found := false
	for _, p := range participants {
		if strings.EqualFold(p.Email, senderEmail) {
			found = true
			break
		}
	}
	if !found {
		participants = append(participants, Recipient{Name: senderName, Email: senderEmail})
		pJSON, err := json.Marshal(participants)
		if err != nil {
			return fmt.Errorf("failed to marshal participants: %w", err)
		}
		thread.Set("participants", string(pJSON))
	}

	if err := app.Save(thread); err != nil {
		return fmt.Errorf("failed to update thread: %w", err)
	}
	return nil
}

// ensureThreadState creates or updates a mail_thread_state record for a user_org.
func ensureThreadState(app core.App, threadID, userOrgID, folder string, isRead bool) error {
	// Check for existing thread state
	records, err := app.FindRecordsByFilter(
		"mail_thread_state",
		"thread = {:thread} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"thread": threadID, "userOrg": userOrgID},
	)
	if err == nil && len(records) > 0 {
		// Update existing
		record := records[0]
		record.Set("folder", folder)
		record.Set("is_read", isRead)
		return app.Save(record)
	}

	// Create new
	collection, err := app.FindCollectionByNameOrId("mail_thread_state")
	if err != nil {
		return fmt.Errorf("mail_thread_state collection not found: %w", err)
	}
	record := core.NewRecord(collection)
	record.Set("thread", threadID)
	record.Set("user_org", userOrgID)
	record.Set("folder", folder)
	record.Set("is_read", isRead)
	record.Set("is_starred", false)
	record.Set("labels", "[]")
	return app.Save(record)
}

// resolveMailboxByAddress finds a mailbox matching a local part and domain.
// It first checks primary addresses on mail_mailboxes, then falls back to
// mail_mailbox_aliases. When a match is via an alias, the alias record is
// returned as the second value; for a primary-address match, alias is nil.
// Addresses are compared case-insensitively.
func resolveMailboxByAddress(app core.App, localPart, domainStr string) (*core.Record, *core.Record, error) {
	normalizedLocal := strings.ToLower(strings.TrimSpace(localPart))
	normalizedDomain := strings.ToLower(strings.TrimSpace(domainStr))

	// First find the domain record
	domains, err := app.FindRecordsByFilter(
		"mail_domains",
		"domain = {:domain}",
		"",
		1,
		0,
		map[string]any{"domain": normalizedDomain},
	)
	if err != nil || len(domains) == 0 {
		return nil, nil, fmt.Errorf("domain %s not found", domainStr)
	}

	domainID := domains[0].Id

	// Then find a mailbox with a matching primary address on this domain
	mailboxes, err := app.FindRecordsByFilter(
		"mail_mailboxes",
		"address = {:address} && domain = {:domain}",
		"",
		1,
		0,
		map[string]any{"address": normalizedLocal, "domain": domainID},
	)
	if err == nil && len(mailboxes) > 0 {
		return mailboxes[0], nil, nil
	}

	// Fall back to alias lookup
	mailbox, alias, err := findMailboxViaAlias(app, domainID, normalizedLocal)
	if err == nil {
		return mailbox, alias, nil
	}

	return nil, nil, fmt.Errorf("mailbox %s@%s not found", localPart, domainStr)
}

// getMailboxMembers returns all mail_mailbox_members for a given mailbox.
func getMailboxMembers(app core.App, mailboxID string) ([]*core.Record, error) {
	return app.FindRecordsByFilter(
		"mail_mailbox_members",
		"mailbox = {:mailbox}",
		"",
		100,
		0,
		map[string]any{"mailbox": mailboxID},
	)
}

// normalizeSubject strips Re:, Fwd:, etc. prefixes for thread matching.
func normalizeSubject(subject string) string {
	s := strings.TrimSpace(subject)
	for {
		lower := strings.ToLower(s)
		trimmed := false
		for _, prefix := range []string{"re:", "fwd:", "fw:"} {
			if strings.HasPrefix(lower, prefix) {
				s = strings.TrimSpace(s[len(prefix):])
				trimmed = true
			}
		}
		if !trimmed {
			break
		}
	}
	return s
}

func truncateSnippet(text string, maxLen int) string {
	text = strings.TrimSpace(text)
	runes := []rune(text)
	if len(runes) <= maxLen {
		return text
	}
	return string(runes[:maxLen-3]) + "..."
}
