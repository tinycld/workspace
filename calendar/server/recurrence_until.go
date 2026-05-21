package calendar

import (
	"regexp"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// recurrenceUntilRe captures UNTIL=YYYYMMDD or UNTIL=YYYYMMDDThhmmssZ from
// any recurrence string we accept. Mirrors the JS parseUntil in the
// 1830000002 migration so the backfill and the live hook compute the same
// value for the same input.
var recurrenceUntilRe = regexp.MustCompile(`UNTIL=(\d{8})(?:T(\d{6})Z?)?`)

// extractRecurrenceUntil reads the UNTIL= portion of a recurrence string and
// returns it as a SQL-friendly date (YYYY-MM-DD HH:MM:SS). Returns "" when:
//   - the string is empty (non-recurring event)
//   - the recurrence is unbounded (no UNTIL)
//   - the recurrence uses COUNT instead of UNTIL (we can't materialize a
//     date without expanding occurrences; treated as open-ended in time)
func extractRecurrenceUntil(rrule string) string {
	match := recurrenceUntilRe.FindStringSubmatch(rrule)
	if match == nil {
		return ""
	}
	date := match[1]
	year, month, day := date[:4], date[4:6], date[6:8]
	if len(match) >= 3 && match[2] != "" {
		t := match[2]
		return year + "-" + month + "-" + day + " " + t[:2] + ":" + t[2:4] + ":" + t[4:6]
	}
	return year + "-" + month + "-" + day + " 00:00:00"
}

// registerRecurrenceUntilHooks keeps calendar_events.recurrence_until in
// sync with the recurrence string. Runs in the OnRecordCreate /
// OnRecordUpdate (pre-save) phase so the value lands in the same write as
// the rest of the record — no follow-up save needed.
func registerRecurrenceUntilHooks(app *pocketbase.PocketBase) {
	apply := func(e *core.RecordEvent) error {
		rrule := e.Record.GetString("recurrence")
		until := extractRecurrenceUntil(rrule)
		if e.Record.GetString("recurrence_until") != until {
			e.Record.Set("recurrence_until", until)
		}
		return e.Next()
	}
	app.OnRecordCreate("calendar_events").BindFunc(apply)
	app.OnRecordUpdate("calendar_events").BindFunc(apply)
}
