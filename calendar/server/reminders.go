package calendar

import (
	"fmt"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/notify"
)

// sentReminders dedups reminders so the same event-fire-minute isn't
// notified twice across overlapping ticker windows.
var sentReminders sync.Map // key: "eventID-fireMinute" → time.Time

func startReminderScheduler(app *pocketbase.PocketBase) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	checkReminders(app)

	for range ticker.C {
		checkReminders(app)
		cleanExpiredReminderEntries()
	}
}

func checkReminders(app *pocketbase.PocketBase) {
	now := time.Now().UTC()
	windowEnd := now.Add(90 * time.Second)
	lookahead := now.Add(24 * time.Hour)

	records, err := app.FindRecordsByFilter(
		"calendar_events",
		"reminder > 0 && start >= {:now} && start <= {:lookahead}",
		"",
		0,
		0,
		map[string]any{
			"now":       now.Format("2006-01-02 15:04:05.000Z"),
			"lookahead": lookahead.Format("2006-01-02 15:04:05.000Z"),
		},
	)
	if err != nil {
		app.Logger().Warn("calendar/reminders: failed to query events", "error", err)
		return
	}

	for _, event := range records {
		startStr := event.GetString("start")
		eventStart, err := time.Parse("2006-01-02 15:04:05.000Z", startStr)
		if err != nil {
			continue
		}

		reminderMinutes := event.GetFloat("reminder")
		if reminderMinutes <= 0 {
			continue
		}

		fireTime := eventStart.Add(-time.Duration(reminderMinutes) * time.Minute)
		if fireTime.Before(now) || fireTime.After(windowEnd) {
			continue
		}

		dedup := fmt.Sprintf("%s-%d", event.Id, fireTime.Unix()/60)
		if _, loaded := sentReminders.LoadOrStore(dedup, time.Now()); loaded {
			continue
		}

		calendarID := event.GetString("calendar")
		title := event.GetString("title")

		members, err := app.FindRecordsByFilter(
			"calendar_members",
			"calendar = {:calendarId}",
			"",
			0,
			0,
			map[string]any{"calendarId": calendarID},
		)
		if err != nil {
			app.Logger().Warn("calendar/reminders: failed to query members",
				"calendar", calendarID, "error", err)
			continue
		}

		for _, member := range members {
			userOrgRecord, err := app.FindRecordById("user_org", member.GetString("user_org"))
			if err != nil {
				continue
			}
			userID := userOrgRecord.GetString("user")
			orgID := userOrgRecord.GetString("org")
			orgSlug := lookupOrgSlug(app, orgID)

			notify.NotifyUser(app, notify.NotifyParams{
				UserID:  userID,
				OrgID:   orgID,
				Type:    "calendar_reminder",
				Package: "calendar",
				Title:   title,
				Body:    fmt.Sprintf("Starts in %.0f minutes", reminderMinutes),
				URL:     fmt.Sprintf("/a/%s/calendar/%s", orgSlug, event.Id),
			})
		}
	}
}

func lookupOrgSlug(app core.App, orgID string) string {
	record, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		return ""
	}
	return record.GetString("slug")
}

func cleanExpiredReminderEntries() {
	cutoff := time.Now().Add(-24 * time.Hour)
	sentReminders.Range(func(key, value any) bool {
		if t, ok := value.(time.Time); ok && t.Before(cutoff) {
			sentReminders.Delete(key)
		}
		return true
	})
}
