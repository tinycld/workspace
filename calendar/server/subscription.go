package calendar

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/teambition/rrule-go"
	"tinycld.org/core/notify"
)

const (
	syncInterval     = 15 * time.Minute
	fetchTimeout     = 30 * time.Second
	maxResponseBytes = 10 * 1024 * 1024 // 10 MB
	staleErrorDays   = 7
)


func startSubscriptionSync(app *pocketbase.PocketBase) {
	ticker := time.NewTicker(syncInterval)
	defer ticker.Stop()

	// Run once on startup after a short delay
	time.Sleep(10 * time.Second)
	syncAllSubscriptions(app)

	for range ticker.C {
		syncAllSubscriptions(app)
	}
}

func syncAllSubscriptions(app *pocketbase.PocketBase) {
	now := time.Now().UTC()
	staleCutoff := now.AddDate(0, 0, -staleErrorDays).Format(pbTimeFormat)

	records, err := app.FindRecordsByFilter(
		"calendar_calendars",
		`subscription_url != "" && (subscription_error = "" || (subscription_error !~ "^HTTP (401|403|404|410)" && subscription_last_sync > {:staleCutoff}))`,
		"",
		0,
		0,
		map[string]any{"staleCutoff": staleCutoff},
	)
	if err != nil {
		app.Logger().Warn("subscription: failed to query subscriptions", "error", err)
		return
	}

	for _, record := range records {
		if err := syncSubscription(app, record); err != nil {
			app.Logger().Warn("subscription: sync failed",
				"calendar", record.Id,
				"url", record.GetString("subscription_url"),
				"error", err,
			)
			errMsg := err.Error()
			if len(errMsg) > 500 {
				errMsg = errMsg[:500]
			}
			record.Set("subscription_error", errMsg)
			record.Set("subscription_last_sync", now.Format(pbTimeFormat))
			_ = app.Save(record)

			notifySubscriptionError(app, record, errMsg)
		}
	}
}

func syncSubscription(app *pocketbase.PocketBase, calRecord *core.Record) error {
	url := calRecord.GetString("subscription_url")
	if url == "" {
		return fmt.Errorf("no subscription URL")
	}

	body, err := fetchICS(url)
	if err != nil {
		return fmt.Errorf("fetch: %w", err)
	}
	defer body.Close()

	decoder := ical.NewDecoder(body)
	var allEvents []ical.Event

	for {
		cal, err := decoder.Decode()
		if err == io.EOF {
			break
		}
		if err != nil {
			app.Logger().Warn("subscription: parse error, using events collected so far",
				"calendar", calRecord.Id,
				"eventsCollected", len(allEvents),
				"error", err)
			break
		}
		allEvents = append(allEvents, cal.Events()...)
	}

	// Filter to reasonable time window: past 1 year to future 2 years
	now := time.Now().UTC()
	windowStart := now.AddDate(-1, 0, 0)
	windowEnd := now.AddDate(2, 0, 0)

	filteredEvents := filterEventsByWindow(allEvents, windowStart, windowEnd)

	app.Logger().Info("subscription: parsed events",
		"calendar", calRecord.Id,
		"total", len(allEvents),
		"inWindow", len(filteredEvents),
	)

	owner, err := findSubscriptionOwner(app, calRecord.Id)
	if err != nil {
		return fmt.Errorf("find owner: %w", err)
	}

	// Track UIDs we've seen for cleanup
	seenUIDs := make(map[string]bool, len(filteredEvents))

	eventsCollection, err := app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		return fmt.Errorf("find events collection: %w", err)
	}

	// Batch-fetch all existing events for this calendar to avoid N+1 queries
	existingEvents, _ := app.FindRecordsByFilter(
		"calendar_events",
		"calendar = {:calId} && ical_uid != \"\"",
		"",
		0,
		0,
		map[string]any{"calId": calRecord.Id},
	)
	existingByUID := make(map[string]*core.Record, len(existingEvents))
	for _, evt := range existingEvents {
		existingByUID[evt.GetString("ical_uid")] = evt
	}

	lastSync := calRecord.GetString("subscription_last_sync")
	var lastSyncTime time.Time
	if lastSync != "" {
		lastSyncTime, _ = time.Parse(pbTimeFormat, lastSync)
	}

	for _, event := range filteredEvents {
		uid, uidErr := event.Props.Text(ical.PropUID)
		if uidErr != nil || uid == "" {
			continue
		}
		seenUIDs[uid] = true

		// Wrap event in a calendar for applyCalendarToRecord
		cal := ical.NewCalendar()
		cal.Children = append(cal.Children, event.Component)

		if existing, ok := existingByUID[uid]; ok {
			// Skip update if the event hasn't changed since last sync
			if !lastSyncTime.IsZero() {
				if dtstamp := event.Props.Get(ical.PropDateTimeStamp); dtstamp != nil {
					if stampTime, err := dtstamp.DateTime(time.UTC); err == nil && stampTime.Before(lastSyncTime) {
						continue
					}
				}
			}
			if err := applyCalendarToRecord(cal, existing); err != nil {
				continue
			}
			_ = app.SaveNoValidate(existing)
		} else {
			record := core.NewRecord(eventsCollection)
			record.Set("calendar", calRecord.Id)
			record.Set("created_by", owner)
			record.Set("ical_uid", uid)
			record.Set("guests", []any{})
			if err := applyCalendarToRecord(cal, record); err != nil {
				continue
			}
			_ = app.SaveNoValidate(record)
		}
	}

	// Delete events whose ical_uid is no longer in the feed
	for uid, evt := range existingByUID {
		if !seenUIDs[uid] {
			_ = app.Delete(evt)
		}
	}

	// Mark success
	calRecord.Set("subscription_last_sync", now.Format(pbTimeFormat))
	calRecord.Set("subscription_error", "")
	return app.Save(calRecord)
}

func filterEventsByWindow(events []ical.Event, start, end time.Time) []ical.Event {
	var filtered []ical.Event
	for _, event := range events {
		// Include recurring events unless they ended more than a year ago
		if rruleProp := event.Props.Get(ical.PropRecurrenceRule); rruleProp != nil {
			until := parseRRuleUntil(rruleProp.Value)
			if until.IsZero() || until.After(start) {
				filtered = append(filtered, event)
			}
			continue
		}

		// Always include recurrence exceptions — they modify a recurring series
		if event.Props.Get(ical.PropRecurrenceID) != nil {
			filtered = append(filtered, event)
			continue
		}

		dtStart := event.Props.Get(ical.PropDateTimeStart)
		if dtStart == nil {
			filtered = append(filtered, event)
			continue
		}
		t, err := dtStart.DateTime(time.UTC)
		if err != nil {
			filtered = append(filtered, event)
			continue
		}
		if t.After(start) && t.Before(end) {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

// parseRRuleUntil extracts the UNTIL value from an RRULE string using rrule-go.
// Returns zero time if no UNTIL is present or parsing fails (unbounded).
func parseRRuleUntil(rule string) time.Time {
	if !strings.HasPrefix(rule, "RRULE:") {
		rule = "RRULE:" + rule
	}
	r, err := rrule.StrToRRule(rule)
	if err != nil {
		return time.Time{}
	}
	until := r.GetUntil()
	// rrule-go returns 9999-01-01 for unbounded rules
	if until.Year() > 9000 {
		return time.Time{}
	}
	return until
}

func findSubscriptionOwner(app *pocketbase.PocketBase, calendarId string) (string, error) {
	member, err := app.FindFirstRecordByFilter(
		"calendar_members",
		"calendar = {:calId} && role = 'owner'",
		map[string]any{"calId": calendarId},
	)
	if err != nil {
		return "", fmt.Errorf("no owner membership for calendar %s: %w", calendarId, err)
	}
	return member.GetString("user_org"), nil
}

func fetchICS(rawURL string) (io.ReadCloser, error) {
	// Parse and validate URL
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return nil, fmt.Errorf("unsupported URL scheme")
	}

	// SSRF protection: resolve hostname and check for private IPs
	parsed := strings.TrimPrefix(strings.TrimPrefix(rawURL, "https://"), "http://")
	host := strings.SplitN(parsed, "/", 2)[0]
	host = strings.SplitN(host, ":", 2)[0]
	if isPrivateCalHost(host) {
		return nil, fmt.Errorf("private/internal hosts are not allowed")
	}

	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	req.Header.Set("User-Agent", "TinyCld/1.0 ICS Sync")

	client := &http.Client{Timeout: fetchTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		code := resp.StatusCode
		return nil, fmt.Errorf("HTTP %d", code)
	}

	return http.MaxBytesReader(nil, resp.Body, maxResponseBytes), nil
}

func isPrivateCalHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		addrs, err := net.LookupHost(host)
		if err != nil || len(addrs) == 0 {
			return false
		}
		ip = net.ParseIP(addrs[0])
		if ip == nil {
			return false
		}
	}

	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified()
}

// normalizeSubscriptionURL converts various calendar URL formats to a direct ICS feed URL.
// Handles webcal:// scheme and Google Calendar sharing links.
func normalizeSubscriptionURL(rawURL string) string {
	if strings.HasPrefix(rawURL, "webcal://") {
		rawURL = "https://" + strings.TrimPrefix(rawURL, "webcal://")
	}

	// Google Calendar sharing link: https://calendar.google.com/calendar/u/0?cid=BASE64
	parsed, err := url.Parse(rawURL)
	if err == nil && strings.HasSuffix(parsed.Host, "calendar.google.com") && parsed.Query().Get("cid") != "" {
		cid := parsed.Query().Get("cid")
		// cid is base64-encoded calendar ID (email or hash)
		decoded, err := base64.RawStdEncoding.DecodeString(cid)
		if err != nil {
			decoded, err = base64.StdEncoding.DecodeString(cid)
		}
		if err == nil && len(decoded) > 0 {
			calID := url.PathEscape(string(decoded))
			rawURL = "https://calendar.google.com/calendar/ical/" + calID + "/public/basic.ics"
		}
	}

	return rawURL
}

// notifySubscriptionError sends a notification to the calendar owner when a subscription sync fails.
func notifySubscriptionError(app *pocketbase.PocketBase, calRecord *core.Record, errMsg string) {
	calendarName := calRecord.GetString("name")
	calendarID := calRecord.Id
	orgID := calRecord.GetString("org")

	ownerUserOrgID, err := findSubscriptionOwner(app, calendarID)
	if err != nil {
		return
	}

	userOrgRecord, err := app.FindRecordById("user_org", ownerUserOrgID)
	if err != nil {
		return
	}
	userID := userOrgRecord.GetString("user")

	orgRecord, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		return
	}
	orgSlug := orgRecord.GetString("slug")

	notify.NotifyUser(app, notify.NotifyParams{
		UserID:  userID,
		OrgID:   orgID,
		Type:    "calendar_subscription_error",
		Package: "calendar",
		Title:   fmt.Sprintf("Calendar sync failed: %s", calendarName),
		Body:    errMsg,
		URL:     fmt.Sprintf("/a/%s/calendar", orgSlug),
	})
}
