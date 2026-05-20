package push

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/pocketbase/core"
)

// Payload is the JSON structure sent to the browser push service.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	Tag   string `json:"tag,omitempty"`
	URL   string `json:"url,omitempty"`
}

// SendToUser sends a push notification to all subscriptions for the given user.
// Stale subscriptions (410/404) are automatically deleted.
func SendToUser(app core.App, userID string, payload Payload) {
	records, err := app.FindRecordsByFilter(
		"push_subscriptions",
		"user = {:userId}",
		"",
		0,
		0,
		map[string]any{"userId": userID},
	)
	if err != nil {
		log.Printf("[push] failed to query subscriptions for user %s: %v", userID, err)
		return
	}

	if len(records) == 0 {
		return
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[push] failed to marshal payload: %v", err)
		return
	}

	vapidPublicKey := os.Getenv("VAPID_PUBLIC_KEY")
	vapidPrivateKey := os.Getenv("VAPID_PRIVATE_KEY")
	vapidSubject := os.Getenv("VAPID_SUBJECT")
	if vapidSubject == "" {
		vapidSubject = "mailto:admin@tinycld.com"
	}

	for _, record := range records {
		endpoint := record.GetString("endpoint")
		keysRaw := record.Get("keys")

		var keys struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		}

		switch v := keysRaw.(type) {
		case string:
			if err := json.Unmarshal([]byte(v), &keys); err != nil {
				log.Printf("[push] invalid keys JSON for subscription %s: %v", record.Id, err)
				continue
			}
		case map[string]any:
			if p, ok := v["p256dh"].(string); ok {
				keys.P256dh = p
			}
			if a, ok := v["auth"].(string); ok {
				keys.Auth = a
			}
		default:
			log.Printf("[push] unexpected keys type for subscription %s", record.Id)
			continue
		}

		sub := &webpush.Subscription{
			Endpoint: endpoint,
			Keys: webpush.Keys{
				P256dh: keys.P256dh,
				Auth:   keys.Auth,
			},
		}

		resp, err := webpush.SendNotification(payloadBytes, sub, &webpush.Options{
			VAPIDPublicKey:  vapidPublicKey,
			VAPIDPrivateKey: vapidPrivateKey,
			Subscriber:      vapidSubject,
			TTL:             86400,
		})
		if err != nil {
			log.Printf("[push] send failed for subscription %s: %v", record.Id, err)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
			log.Printf("[push] removing stale subscription %s (status %d)", record.Id, resp.StatusCode)
			if err := app.Delete(record); err != nil {
				log.Printf("[push] failed to delete stale subscription %s: %v", record.Id, err)
			}
		}
	}
}
