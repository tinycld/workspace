package mail

import (
	"crypto/subtle"
	"fmt"
	"io"
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func handleBounce(app *pocketbase.PocketBase, provider Provider, re *core.RequestEvent, secret string) error {
	token := re.Request.PathValue("token")
	if secret == "" || subtle.ConstantTimeCompare([]byte(token), []byte(secret)) != 1 {
		return re.ForbiddenError("Invalid token", nil)
	}

	body, err := io.ReadAll(io.LimitReader(re.Request.Body, 1<<20)) // 1 MB limit
	if err != nil {
		return re.BadRequestError("Failed to read request body", err)
	}

	event, err := provider.ParseBounce(body)
	if err != nil {
		return re.BadRequestError("Failed to parse bounce payload", err)
	}

	if event.MessageID == "" {
		return re.BadRequestError("Missing message ID in bounce payload", nil)
	}

	// Look up the message by provider message_id
	messages, err := app.FindRecordsByFilter(
		"mail_messages",
		"message_id = {:messageID}",
		"",
		1,
		0,
		map[string]any{"messageID": event.MessageID},
	)
	if err != nil || len(messages) == 0 {
		app.Logger().Warn("bounce received for unknown message",
			"message_id", event.MessageID, "email", event.Email)
		return re.JSON(http.StatusOK, map[string]string{"status": "ignored"})
	}

	record := messages[0]

	status := "bounced"
	if event.RecordType == "SpamComplaint" {
		status = "spam_complaint"
	}

	record.Set("delivery_status", status)

	reason := event.Description
	if len([]rune(reason)) > 500 {
		reason = string([]rune(reason)[:500])
	}
	record.Set("bounce_reason", reason)

	if err := app.Save(record); err != nil {
		return re.InternalServerError(fmt.Sprintf("Failed to update message %s", record.Id), err)
	}

	app.Logger().Info("bounce processed",
		"message_id", event.MessageID, "status", status, "email", event.Email)

	return re.JSON(http.StatusOK, map[string]string{"status": "processed"})
}
