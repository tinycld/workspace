package mail

import (
	"crypto/subtle"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// routingResult aggregates the per-recipient outcomes of an inbound delivery.
// Used to decide the HTTP response code: any storage failure → 500;
// no recipients matched but at least one was unknown → 403; any stored → 200.
type routingResult struct {
	storedCount     int
	unknownAddrs    []string
	storageFailures []error
}

func handleInbound(app core.App, provider Provider, re *core.RequestEvent, secret string) error {
	// Validate secret token (constant-time comparison to prevent timing attacks)
	token := re.Request.PathValue("token")
	if secret == "" || subtle.ConstantTimeCompare([]byte(token), []byte(secret)) != 1 {
		return re.UnauthorizedError("Invalid inbound token", nil)
	}

	// Read and parse body (capped at 25MB — Postmark's max message size)
	const maxInboundBodySize = 25 << 20
	body, err := io.ReadAll(io.LimitReader(re.Request.Body, maxInboundBodySize))
	if err != nil {
		return re.BadRequestError(fmt.Sprintf("Failed to read request body: %v", err), err)
	}

	// Verify webhook signature (provider-specific)
	headers := make(map[string]string)
	for k, v := range re.Request.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}
	if err := provider.VerifyWebhookSignature(headers, body); err != nil {
		return re.UnauthorizedError("Webhook signature verification failed", err)
	}

	msg, err := provider.ParseInbound(body)
	if err != nil {
		app.Logger().Error("inbound: parse failed", "error", err)
		return router.NewApiError(
			http.StatusUnprocessableEntity,
			fmt.Sprintf("Unprocessable inbound payload: %v", err),
			err,
		)
	}

	allRecipients := make([]Recipient, 0, len(msg.To)+len(msg.Cc))
	allRecipients = append(allRecipients, msg.To...)
	allRecipients = append(allRecipients, msg.Cc...)

	result := routingResult{}

	for _, rcpt := range allRecipients {
		localPart, domain := splitAddress(rcpt.Email)
		if localPart == "" || domain == "" {
			app.Logger().Warn("inbound: malformed recipient address", "email", rcpt.Email)
			continue
		}

		localPart = stripPlusTag(localPart)

		mailbox, _, err := resolveMailboxByAddress(app, localPart, domain)
		if err != nil {
			fullAddr := localPart + "@" + domain
			result.unknownAddrs = append(result.unknownAddrs, fullAddr)
			app.Logger().Info("inbound: unknown recipient",
				"address", fullAddr, "messageID", msg.MessageID)
			continue
		}

		if err := processInboundForMailbox(app, mailbox, msg); err != nil {
			result.storageFailures = append(result.storageFailures, err)
			app.Logger().Error("inbound: storage failed",
				"mailboxID", mailbox.Id, "messageID", msg.MessageID, "error", err)
			continue
		}
		result.storedCount++
	}

	// Any storage failure fails the whole batch so Postmark retries.
	if len(result.storageFailures) > 0 {
		return router.NewApiError(
			http.StatusInternalServerError,
			fmt.Sprintf("Storage failed for %d recipient(s): %v", len(result.storageFailures), result.storageFailures[0]),
			result.storageFailures[0],
		)
	}

	// Nothing stored, but we had at least one syntactically-valid recipient
	// that didn't resolve to a mailbox → 403 (bounce).
	if result.storedCount == 0 && len(result.unknownAddrs) > 0 {
		return re.ForbiddenError(
			fmt.Sprintf("No mailbox for recipient(s): %s", strings.Join(result.unknownAddrs, ", ")),
			nil,
		)
	}

	// Nothing stored and no unknowns means every recipient was malformed.
	// Treat as parse-level failure — Postmark won't retry.
	if result.storedCount == 0 {
		return router.NewApiError(http.StatusUnprocessableEntity, "No valid recipients in To/Cc", nil)
	}

	return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

func processInboundForMailbox(app core.App, mailbox *core.Record, msg *InboundMessage) error {
	mailboxID := mailbox.Id

	// Idempotency: skip if message with this message_id already exists in a thread for this mailbox
	if msg.MessageID != "" {
		existing, err := app.FindRecordsByFilter(
			"mail_messages",
			"message_id = {:messageID}",
			"",
			1,
			0,
			map[string]any{"messageID": msg.MessageID},
		)
		if err == nil && len(existing) > 0 {
			threadID := existing[0].GetString("thread")
			thread, err := app.FindRecordById("mail_threads", threadID)
			if err == nil && thread.GetString("mailbox") == mailboxID {
				return nil // already processed
			}
		}
	}

	// Find or create thread. Track whether we created a new one so we can
	// roll it back if storeMessage fails.
	thread, err := findOrCreateThread(app, mailboxID, msg.Subject, msg.InReplyTo, msg.References)
	if err != nil {
		return fmt.Errorf("findOrCreateThread: %w", err)
	}
	threadWasNew := thread.GetInt("message_count") == 0

	stored := &storedMessage{
		MessageID:     msg.MessageID,
		InReplyTo:     msg.InReplyTo,
		SenderName:    msg.From.Name,
		SenderEmail:   msg.From.Email,
		To:            msg.To,
		Cc:            msg.Cc,
		Date:          msg.Date,
		Subject:       msg.Subject,
		HTMLBody:      msg.HTMLBody,
		TextBody:      msg.TextBody,
		StrippedReply: msg.StrippedReply,
		Attachments:   msg.Attachments,
	}

	if _, err := storeMessage(app, thread.Id, stored); err != nil {
		if threadWasNew {
			if delErr := app.Delete(thread); delErr != nil {
				app.Logger().Error("inbound: failed to clean up empty thread after storage error",
					"threadID", thread.Id, "error", delErr)
			}
		}
		return fmt.Errorf("storeMessage: %w", err)
	}

	// Use stripped reply for snippet when available (just the new content, no quoted history)
	snippet := msg.StrippedReply
	if snippet == "" {
		snippet = msg.TextBody
	}
	if snippet == "" {
		snippet = msg.Subject
	}
	if err := updateThreadMetadata(app, thread, msg.From.Name, msg.From.Email, snippet, msg.Date); err != nil {
		return fmt.Errorf("updateThreadMetadata: %w", err)
	}

	// Member lookup failure means we can't deliver to any user — propagate so
	// the caller returns 500 and Postmark retries.
	members, err := getMailboxMembers(app, mailboxID)
	if err != nil {
		return fmt.Errorf("getMailboxMembers: %w", err)
	}
	for _, member := range members {
		userOrgID := member.GetString("user_org")
		if err := ensureThreadState(app, thread.Id, userOrgID, "inbox", false); err != nil {
			// Per-member state failure is non-fatal: the message is stored,
			// the affected user's thread state can be reconciled later.
			app.Logger().Error("inbound: failed to create thread state",
				"threadID", thread.Id, "userOrgID", userOrgID, "error", err)
		}
	}

	return nil
}

func splitAddress(email string) (localPart, domain string) {
	email = strings.TrimSpace(strings.ToLower(email))
	at := strings.LastIndex(email, "@")
	if at < 1 || at >= len(email)-1 {
		return "", ""
	}
	return email[:at], email[at+1:]
}

func stripPlusTag(localPart string) string {
	if plus := strings.Index(localPart, "+"); plus >= 0 {
		return localPart[:plus]
	}
	return localPart
}
