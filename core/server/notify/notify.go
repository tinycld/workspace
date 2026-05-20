package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/push"
)

// NotifyParams describes a notification to send to a user.
type NotifyParams struct {
	UserID  string         `json:"userId"`
	OrgID   string         `json:"orgId"`
	Type    string         `json:"type"`
	Package string         `json:"package"`
	Title   string         `json:"title"`
	Body    string         `json:"body"`
	URL     string         `json:"url"`
	Meta    map[string]any `json:"metadata"`
}

// NotifyUser persists a notification record and dispatches push notifications
// to all registered devices for the user.
func NotifyUser(app core.App, params NotifyParams) {
	// Check user preferences — skip if this notification type is muted
	if isNotificationMuted(app, params.UserID, params.Type) {
		return
	}

	// Insert into notifications collection
	collection, err := app.FindCollectionByNameOrId("notifications")
	if err != nil {
		log.Printf("[notify] failed to find notifications collection: %v", err)
		return
	}

	record := core.NewRecord(collection)
	record.Set("user", params.UserID)
	record.Set("org", params.OrgID)
	record.Set("type", params.Type)
	record.Set("package", params.Package)
	record.Set("title", params.Title)
	record.Set("body", params.Body)
	record.Set("url", params.URL)
	record.Set("metadata", params.Meta)
	record.Set("read", false)
	record.Set("dismissed", false)

	if err := app.Save(record); err != nil {
		log.Printf("[notify] failed to save notification: %v", err)
		return
	}

	// Dispatch web push
	push.SendToUser(app, params.UserID, push.Payload{
		Title: params.Title,
		Body:  params.Body,
		Tag:   fmt.Sprintf("%s-%s", params.Type, record.Id),
		URL:   params.URL,
	})

	// Dispatch Expo push
	sendExpoPush(app, params.UserID, params)
}

// isNotificationMuted checks user_preferences for a muted notification type.
func isNotificationMuted(app core.App, userID, notifType string) bool {
	records, err := app.FindRecordsByFilter(
		"user_preferences",
		"user = {:userId} && app = 'notifications' && key = 'preferences'",
		"",
		1,
		0,
		map[string]any{"userId": userID},
	)
	if err != nil || len(records) == 0 {
		return false
	}

	prefsRaw := records[0].Get("value")
	prefsJSON, err := json.Marshal(prefsRaw)
	if err != nil {
		return false
	}

	var prefs map[string]any
	if err := json.Unmarshal(prefsJSON, &prefs); err != nil {
		return false
	}

	if muted, ok := prefs[notifType]; ok {
		if enabled, ok := muted.(bool); ok {
			return !enabled
		}
	}
	return false
}

// isDemoUser reports whether the given user has the is_demo flag set.
// Defined locally rather than calling coreserver.IsDemoUser to avoid an
// import cycle (coreserver imports notify). Returns false on lookup failure
// so non-demo behavior is the safe default.
func isDemoUser(app core.App, userID string) bool {
	if userID == "" {
		return false
	}
	rec, err := app.FindRecordById("users", userID)
	if err != nil {
		return false
	}
	return rec.GetBool("is_demo")
}

// sendExpoPush sends push notifications to all Expo push subscriptions for the user.
func sendExpoPush(app core.App, userID string, params NotifyParams) {
	// Demo users: skip the external Expo Push API hop. The notification
	// record is already saved and the in-app web push has fired, so the user
	// still sees the notification in the app — we just don't wake an actual
	// device.
	if isDemoUser(app, userID) {
		return
	}

	records, err := app.FindRecordsByFilter(
		"push_subscriptions",
		"user = {:userId} && platform = 'expo'",
		"",
		0,
		0,
		map[string]any{"userId": userID},
	)
	if err != nil || len(records) == 0 {
		return
	}

	for _, record := range records {
		token := record.GetString("expo_token")
		if token == "" {
			continue
		}

		payload := map[string]any{
			"to":    token,
			"title": params.Title,
			"body":  params.Body,
			"data": map[string]string{
				"url": params.URL,
			},
			"sound": "default",
		}

		body, err := json.Marshal(payload)
		if err != nil {
			log.Printf("[notify/expo] failed to marshal payload: %v", err)
			continue
		}

		resp, err := http.Post(
			"https://exp.host/--/api/v2/push/send",
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			log.Printf("[notify/expo] send failed for token %s: %v", token, err)
			continue
		}

		var result struct {
			Data struct {
				Status  string `json:"status"`
				Details struct {
					Error string `json:"error"`
				} `json:"details"`
			} `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			if result.Data.Details.Error == "DeviceNotRegistered" {
				log.Printf("[notify/expo] removing stale token %s", token)
				if err := app.Delete(record); err != nil {
					log.Printf("[notify/expo] failed to delete stale token %s: %v", record.Id, err)
				}
			}
		}
		resp.Body.Close()
	}
}
