package mail

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"tinycld.org/core/coreserver"
)

// demoMessageID returns a synthesized RFC-822-ish Message-ID for messages
// "sent" by demo accounts. The "demo-" prefix makes simulated sends easy to
// distinguish from real ones in the database for forensic purposes.
func demoMessageID() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return "demo-" + hex.EncodeToString(buf) + "@tinycld.local"
}

type sendRequest struct {
	MailboxID          string      `json:"mailbox_id"`
	AliasID            string      `json:"alias_id"`
	To                 []Recipient `json:"to"`
	Cc                 []Recipient `json:"cc"`
	Bcc                []Recipient `json:"bcc"`
	Subject            string      `json:"subject"`
	HTMLBody           string      `json:"html_body"`
	TextBody           string      `json:"text_body"`
	InReplyToMessageID string      `json:"in_reply_to_message_id"` // PB record ID of the message being replied to
}

func handleSend(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	userID := re.Auth.Id

	var req sendRequest
	var fileAttachments []Attachment

	contentType := re.Request.Header.Get("Content-Type")
	isMultipart := strings.HasPrefix(contentType, "multipart/form-data") ||
		strings.HasPrefix(contentType, "multipart/mixed")

	if isMultipart {
		if err := re.Request.ParseMultipartForm(25 << 20); err != nil {
			return re.BadRequestError("Failed to parse multipart form", err)
		}
		jsonStr := re.Request.FormValue("json")
		if err := json.Unmarshal([]byte(jsonStr), &req); err != nil {
			return re.BadRequestError("Invalid JSON in form field", err)
		}
		var err error
		fileAttachments, err = parseFileAttachments(re)
		if err != nil {
			return re.BadRequestError("Failed to read attachments", err)
		}
	} else if strings.HasPrefix(contentType, "application/json") || contentType == "" {
		if err := json.NewDecoder(re.Request.Body).Decode(&req); err != nil {
			return re.BadRequestError("Invalid request body", err)
		}
	} else {
		return re.BadRequestError("Unsupported Content-Type: "+contentType, nil)
	}

	if req.MailboxID == "" {
		return re.BadRequestError("mailbox_id is required", nil)
	}
	if len(req.To) == 0 {
		return re.BadRequestError("at least one recipient is required", nil)
	}

	// Load mailbox and build From address
	mailbox, err := app.FindRecordById("mail_mailboxes", req.MailboxID)
	if err != nil {
		return re.NotFoundError("Mailbox not found", err)
	}

	domainRecord, err := app.FindRecordById("mail_domains", mailbox.GetString("domain"))
	if err != nil {
		return re.NotFoundError("Domain not found", err)
	}

	orgID := domainRecord.GetString("org")

	// Resolve provider from org settings (falls back to env vars)
	provider := providerForOrg(app, orgID)

	// Verify user is a member of this mailbox's org and has access
	userOrg, err := resolveUserOrg(app, userID, orgID)
	if err != nil {
		return re.ForbiddenError("Not a member of this organization", err)
	}

	if _, err := verifyMailboxMembership(app, req.MailboxID, userOrg.Id); err != nil {
		return re.ForbiddenError("Not a member of this mailbox", err)
	}

	var alias *core.Record
	if req.AliasID != "" {
		alias, err = app.FindRecordById("mail_mailbox_aliases", req.AliasID)
		if err != nil {
			return re.NotFoundError("Alias not found", err)
		}
		if err := verifyAliasBelongsToMailbox(alias, req.MailboxID); err != nil {
			return re.ForbiddenError("Alias does not belong to this mailbox", err)
		}
	}

	// Build From address
	displayName := mailbox.GetString("display_name")
	domain := domainRecord.GetString("domain")
	fromAddr := buildFromAddress(mailbox, domainRecord, alias)

	senderAddress := resolveSenderAddressRecords(mailbox, alias)
	senderEmail := fmt.Sprintf("%s@%s", senderAddress, domain)

	// Build threading headers if replying
	var inReplyToHeader, referencesHeader string
	if req.InReplyToMessageID != "" {
		originalMsg, err := app.FindRecordById("mail_messages", req.InReplyToMessageID)
		if err == nil {
			inReplyToHeader = originalMsg.GetString("message_id")
			referencesHeader = inReplyToHeader
		}
	}

	// Send via provider
	sendReq := &SendRequest{
		From:        fromAddr,
		To:          req.To,
		Cc:          req.Cc,
		Bcc:         req.Bcc,
		Subject:     req.Subject,
		HTMLBody:    req.HTMLBody,
		TextBody:    req.TextBody,
		InReplyTo:   inReplyToHeader,
		References:  referencesHeader,
		Attachments: fileAttachments,
	}

	var result *SendResult
	if coreserver.IsDemoUser(app, userID) {
		// Demo accounts: skip the provider call but synthesize a result so
		// the rest of the persistence path runs unchanged. Message lands in
		// the user's Sent folder; nothing leaves the box.
		result = &SendResult{MessageID: demoMessageID()}
	} else {
		var sendErr error
		result, sendErr = provider.Send(re.Request.Context(), sendReq)
		if sendErr != nil {
			return router.NewApiError(http.StatusBadGateway, "Failed to send email", sendErr)
		}
	}

	// Store in database
	now := time.Now().UTC().Format(time.RFC3339)

	thread, err := findOrCreateThread(app, req.MailboxID, req.Subject, inReplyToHeader, referencesHeader)
	if err != nil {
		return re.InternalServerError("Failed to create thread", err)
	}

	// Convert Attachment (base64) → InboundAttachment for storage
	var storedAttachments []InboundAttachment
	for _, att := range fileAttachments {
		storedAttachments = append(storedAttachments, InboundAttachment{
			Name:        att.Name,
			ContentType: att.ContentType,
			Content:     att.Content,
		})
	}

	msg := &storedMessage{
		MessageID:      result.MessageID,
		InReplyTo:      inReplyToHeader,
		Alias:          req.AliasID,
		SenderName:     displayName,
		SenderEmail:    senderEmail,
		To:             req.To,
		Cc:             req.Cc,
		Date:           now,
		Subject:        req.Subject,
		HTMLBody:       req.HTMLBody,
		TextBody:       req.TextBody,
		DeliveryStatus: "sent",
		Attachments:    storedAttachments,
	}

	record, err := storeMessage(app, thread.Id, msg)
	if err != nil {
		return re.InternalServerError("Failed to store message", err)
	}

	if err := updateThreadMetadata(app, thread, displayName, msg.SenderEmail, msg.TextBody, now); err != nil {
		return re.InternalServerError("Failed to update thread", err)
	}

	// Create thread state for the sender
	if err := ensureThreadState(app, thread.Id, userOrg.Id, "sent", true); err != nil {
		return re.InternalServerError("Failed to create thread state", err)
	}

	return re.JSON(http.StatusOK, map[string]string{
		"message_id": record.Id,
		"thread_id":  thread.Id,
	})
}

// parseFileAttachments reads uploaded files from a multipart form and returns
// them as base64-encoded Attachment structs ready for the email provider.
func parseFileAttachments(re *core.RequestEvent) ([]Attachment, error) {
	if re.Request.MultipartForm == nil {
		return nil, nil
	}
	fileHeaders := re.Request.MultipartForm.File["attachments"]
	if len(fileHeaders) == 0 {
		return nil, nil
	}

	attachments := make([]Attachment, 0, len(fileHeaders))
	for _, fh := range fileHeaders {
		f, err := fh.Open()
		if err != nil {
			return nil, fmt.Errorf("failed to open attachment %s: %w", fh.Filename, err)
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read attachment %s: %w", fh.Filename, err)
		}

		attachments = append(attachments, Attachment{
			Name:        fh.Filename,
			ContentType: fh.Header.Get("Content-Type"),
			Content:     base64.StdEncoding.EncodeToString(data),
		})
	}
	return attachments, nil
}
