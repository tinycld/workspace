package mail

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/notify"
)

type pendingMail struct {
	sender  string
	subject string
	orgID   string
}

var mailBuffer sync.Map // map[string]*mailBucket

type mailBucket struct {
	mu    sync.Mutex
	items []pendingMail
}

// bufferMailNotificationForUser adds a mail message to the per-user buffer
// for batched delivery. Called from the inbound message hook.
func bufferMailNotificationForUser(userID, orgID, sender, subject string) {
	val, _ := mailBuffer.LoadOrStore(userID, &mailBucket{})
	buf := val.(*mailBucket)
	buf.mu.Lock()
	buf.items = append(buf.items, pendingMail{
		sender:  sender,
		subject: subject,
		orgID:   orgID,
	})
	buf.mu.Unlock()
}

func startMailBatcher(app *pocketbase.PocketBase) {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		flushMailBuffer(app)
	}
}

func flushMailBuffer(app *pocketbase.PocketBase) {
	mailBuffer.Range(func(key, value any) bool {
		userID := key.(string)
		buf := value.(*mailBucket)

		buf.mu.Lock()
		items := buf.items
		buf.items = nil
		buf.mu.Unlock()

		mailBuffer.Delete(userID)

		if len(items) == 0 {
			return true
		}

		orgID := items[0].orgID

		mode := getMailNotifyMode(app, userID)
		if mode == "important_only" {
			items = filterImportantMail(app, userID, orgID, items)
			if len(items) == 0 {
				return true
			}
		}

		orgSlug := getOrgSlugForBatcher(app, orgID)
		url := fmt.Sprintf("/a/%s/mail", orgSlug)

		if len(items) == 1 {
			notify.NotifyUser(app, notify.NotifyParams{
				UserID:  userID,
				OrgID:   orgID,
				Type:    "mail_new_message",
				Package: "mail",
				Title:   fmt.Sprintf("New mail from %s", items[0].sender),
				Body:    items[0].subject,
				URL:     url,
			})
		} else {
			notify.NotifyUser(app, notify.NotifyParams{
				UserID:  userID,
				OrgID:   orgID,
				Type:    "mail_new_message",
				Package: "mail",
				Title:   fmt.Sprintf("You have %d new messages", len(items)),
				Body:    fmt.Sprintf("From %s and others", items[0].sender),
				URL:     url,
			})
		}

		return true
	})
}

func getMailNotifyMode(app core.App, userID string) string {
	records, err := app.FindRecordsByFilter(
		"user_preferences",
		"user = {:userId} && app = 'notifications' && key = 'mail_notify_mode'",
		"",
		1,
		0,
		map[string]any{"userId": userID},
	)
	if err != nil || len(records) == 0 {
		return "batched"
	}
	mode, ok := records[0].Get("value").(string)
	if !ok || mode == "" {
		return "batched"
	}
	return mode
}

func filterImportantMail(app core.App, userID, orgID string, items []pendingMail) []pendingMail {
	userOrgs, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:userId} && org = {:orgId}",
		"",
		1,
		0,
		map[string]any{"userId": userID, "orgId": orgID},
	)
	if err != nil || len(userOrgs) == 0 {
		return items
	}

	var important []pendingMail
	for _, item := range items {
		contacts, err := app.FindRecordsByFilter(
			"contacts_contacts",
			"org = {:orgId} && emails ~ {:sender}",
			"",
			1,
			0,
			map[string]any{"orgId": orgID, "sender": item.sender},
		)
		if err == nil && len(contacts) > 0 {
			important = append(important, item)
			continue
		}

		// Still create a silent notification (no push) for non-important mail
		collection, err := app.FindCollectionByNameOrId("notifications")
		if err != nil {
			continue
		}
		record := core.NewRecord(collection)
		record.Set("user", userID)
		record.Set("org", orgID)
		record.Set("type", "mail_new_message")
		record.Set("package", "mail")
		record.Set("title", fmt.Sprintf("New mail from %s", item.sender))
		record.Set("body", item.subject)
		record.Set("url", fmt.Sprintf("/a/%s/mail", getOrgSlugForBatcher(app, orgID)))
		record.Set("read", false)
		record.Set("dismissed", false)
		if err := app.Save(record); err != nil {
			log.Printf("[mail/batcher] failed to save silent notification: %v", err)
		}
	}
	return important
}

func getOrgSlugForBatcher(app core.App, orgID string) string {
	record, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		return ""
	}
	return record.GetString("slug")
}
