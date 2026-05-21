package calendar

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/pocketbase/pocketbase/core"
)

const pbTimeFormat = "2006-01-02 15:04:05.000Z"

// recordToCalendar converts a PocketBase calendar_events record to an iCalendar object.
func recordToCalendar(record *core.Record) (*ical.Calendar, error) {
	cal := ical.NewCalendar()
	cal.Props.SetText(ical.PropProductID, "-//TinyCld//CalDAV//EN")
	cal.Props.SetText(ical.PropVersion, "2.0")

	event := ical.NewEvent()

	uid := record.GetString("ical_uid")
	if uid == "" {
		return nil, fmt.Errorf("record missing ical_uid")
	}
	event.Props.SetText(ical.PropUID, uid)

	if title := record.GetString("title"); title != "" {
		event.Props.SetText(ical.PropSummary, title)
	}

	if desc := record.GetString("description"); desc != "" {
		event.Props.SetText(ical.PropDescription, desc)
	}

	if loc := record.GetString("location"); loc != "" {
		event.Props.SetText(ical.PropLocation, loc)
	}

	allDay := record.GetBool("all_day")

	if start := record.GetString("start"); start != "" {
		if t, err := time.Parse(pbTimeFormat, start); err == nil {
			setEventTime(event, ical.PropDateTimeStart, t, allDay)
		}
	}

	if end := record.GetString("end"); end != "" {
		if t, err := time.Parse(pbTimeFormat, end); err == nil {
			setEventTime(event, ical.PropDateTimeEnd, t, allDay)
		}
	}

	if rec := record.GetString("recurrence"); rec != "" {
		rruleValue := recurrenceToRRule(rec)
		if rruleValue != "" {
			event.Props.SetText(ical.PropRecurrenceRule, rruleValue)
		}
	}

	if busyStatus := record.GetString("busy_status"); busyStatus == "free" {
		event.Props.SetText(ical.PropTransparency, "TRANSPARENT")
	} else {
		event.Props.SetText(ical.PropTransparency, "OPAQUE")
	}

	if vis := record.GetString("visibility"); vis != "" && vis != "default" {
		event.Props.SetText(ical.PropClass, strings.ToUpper(vis))
	}

	addGuests(event, record)
	addAlarm(event, record)

	if updated := record.GetString("updated"); updated != "" {
		if t, err := time.Parse(pbTimeFormat, updated); err == nil {
			event.Props.SetDateTime(ical.PropDateTimeStamp, t.UTC())
			event.Props.SetDateTime(ical.PropLastModified, t.UTC())
		}
	}

	if created := record.GetString("created"); created != "" {
		if t, err := time.Parse(pbTimeFormat, created); err == nil {
			event.Props.SetDateTime(ical.PropCreated, t.UTC())
		}
	}

	cal.Children = append(cal.Children, event.Component)
	return cal, nil
}

func setEventTime(event *ical.Event, propName string, t time.Time, allDay bool) {
	prop := ical.NewProp(propName)
	if allDay {
		prop.SetDate(t)
		prop.Params.Set("VALUE", "DATE")
	} else {
		prop.SetDateTime(t.UTC())
	}
	event.Props.Set(prop)
}

func addGuests(event *ical.Event, record *core.Record) {
	guestsRaw := record.Get("guests")
	if guestsRaw == nil {
		return
	}

	data, err := json.Marshal(guestsRaw)
	if err != nil {
		return
	}

	var guests []struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		RSVP  string `json:"rsvp"`
		Role  string `json:"role"`
	}
	if err := json.Unmarshal(data, &guests); err != nil {
		return
	}

	for _, g := range guests {
		if g.Email == "" {
			continue
		}
		prop := ical.NewProp(ical.PropAttendee)
		prop.Value = "mailto:" + g.Email
		if g.Name != "" {
			prop.Params.Set(ical.ParamCommonName, g.Name)
		}
		if g.Role == "organizer" {
			prop.Params.Set(ical.ParamRole, "CHAIR")
		} else {
			prop.Params.Set(ical.ParamRole, "REQ-PARTICIPANT")
		}
		switch g.RSVP {
		case "accepted":
			prop.Params.Set(ical.ParamParticipationStatus, "ACCEPTED")
		case "declined":
			prop.Params.Set(ical.ParamParticipationStatus, "DECLINED")
		case "tentative":
			prop.Params.Set(ical.ParamParticipationStatus, "TENTATIVE")
		default:
			prop.Params.Set(ical.ParamParticipationStatus, "NEEDS-ACTION")
		}
		event.Props.Add(prop)
	}
}

func addAlarm(event *ical.Event, record *core.Record) {
	reminder := record.GetFloat("reminder")
	if reminder <= 0 {
		return
	}

	alarm := ical.NewComponent(ical.CompAlarm)
	alarm.Props.SetText(ical.PropAction, "DISPLAY")
	alarm.Props.SetText(ical.PropDescription, "Reminder")

	trigger := ical.NewProp(ical.PropTrigger)
	mins := int(reminder)
	trigger.Value = fmt.Sprintf("-PT%dM", mins)
	alarm.Props.Set(trigger)

	event.Component.Children = append(event.Component.Children, alarm)
}

// recurrenceToRRule converts a PB recurrence value to an RRULE string.
// Simple tokens (daily, weekly, etc.) are mapped to FREQ=X.
// Strings that already look like RRULE values are returned as-is.
func recurrenceToRRule(rec string) string {
	switch strings.ToLower(rec) {
	case "daily":
		return "FREQ=DAILY"
	case "weekly":
		return "FREQ=WEEKLY"
	case "monthly":
		return "FREQ=MONTHLY"
	case "yearly":
		return "FREQ=YEARLY"
	case "":
		return ""
	default:
		// Already an RRULE string from a CalDAV client
		return rec
	}
}

// rruleToRecurrence converts an RRULE string to a PB recurrence value.
// Simple FREQ-only rules are mapped back to tokens.
// Complex rules are stored as-is for round-trip fidelity.
func rruleToRecurrence(rrule string) string {
	upper := strings.ToUpper(strings.TrimSpace(rrule))
	switch upper {
	case "FREQ=DAILY":
		return "daily"
	case "FREQ=WEEKLY":
		return "weekly"
	case "FREQ=MONTHLY":
		return "monthly"
	case "FREQ=YEARLY":
		return "yearly"
	default:
		return rrule
	}
}

// applyCalendarToRecord extracts fields from an iCalendar object and applies them to a PB record.
func applyCalendarToRecord(cal *ical.Calendar, record *core.Record) error {
	events := cal.Events()
	if len(events) == 0 {
		return fmt.Errorf("no VEVENT found in calendar data")
	}
	event := events[0]

	if summary, err := event.Props.Text(ical.PropSummary); err == nil && summary != "" {
		record.Set("title", summary)
	}

	if desc, err := event.Props.Text(ical.PropDescription); err == nil {
		record.Set("description", desc)
	}

	if loc, err := event.Props.Text(ical.PropLocation); err == nil {
		record.Set("location", loc)
	}

	allDay := false
	if dtStart := event.Props.Get(ical.PropDateTimeStart); dtStart != nil {
		if dtStart.Params.Get("VALUE") == "DATE" {
			allDay = true
		}
		if t, err := dtStart.DateTime(time.UTC); err == nil {
			record.Set("start", t.UTC().Format(pbTimeFormat))
		}
	}

	if dtEnd := event.Props.Get(ical.PropDateTimeEnd); dtEnd != nil {
		if t, err := dtEnd.DateTime(time.UTC); err == nil {
			record.Set("end", t.UTC().Format(pbTimeFormat))
		}
	}

	record.Set("all_day", allDay)

	if rrule, err := event.Props.Text(ical.PropRecurrenceRule); err == nil && rrule != "" {
		record.Set("recurrence", rruleToRecurrence(rrule))
	} else {
		record.Set("recurrence", "")
	}

	if transp, err := event.Props.Text(ical.PropTransparency); err == nil {
		if strings.EqualFold(transp, "TRANSPARENT") {
			record.Set("busy_status", "free")
		} else {
			record.Set("busy_status", "busy")
		}
	}

	if class, err := event.Props.Text(ical.PropClass); err == nil && class != "" {
		switch strings.ToLower(class) {
		case "public":
			record.Set("visibility", "public")
		case "private", "confidential":
			record.Set("visibility", "private")
		default:
			record.Set("visibility", "default")
		}
	}

	applyAttendees(event, record)
	applyAlarm(event, record)

	return nil
}

func applyAttendees(event ical.Event, record *core.Record) {
	attendeeProps := event.Props.Values(ical.PropAttendee)
	if len(attendeeProps) == 0 {
		return
	}

	type guest struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		RSVP  string `json:"rsvp"`
		Role  string `json:"role"`
	}

	var guests []guest
	for _, prop := range attendeeProps {
		email := strings.TrimPrefix(prop.Value, "mailto:")
		if email == "" {
			continue
		}

		g := guest{
			Name:  prop.Params.Get(ical.ParamCommonName),
			Email: email,
		}

		switch strings.ToUpper(prop.Params.Get(ical.ParamParticipationStatus)) {
		case "ACCEPTED":
			g.RSVP = "accepted"
		case "DECLINED":
			g.RSVP = "declined"
		case "TENTATIVE":
			g.RSVP = "tentative"
		default:
			g.RSVP = "pending"
		}

		if strings.ToUpper(prop.Params.Get(ical.ParamRole)) == "CHAIR" {
			g.Role = "organizer"
		} else {
			g.Role = "attendee"
		}

		guests = append(guests, g)
	}

	record.Set("guests", guests)
}

func applyAlarm(event ical.Event, record *core.Record) {
	for _, child := range event.Component.Children {
		if child.Name != ical.CompAlarm {
			continue
		}
		trigger := child.Props.Get(ical.PropTrigger)
		if trigger == nil {
			continue
		}
		mins := parseTriggerMinutes(trigger.Value)
		if mins > 0 {
			record.Set("reminder", mins)
			return
		}
	}
}

// parseTriggerMinutes parses an iCal TRIGGER duration like "-PT15M" or "-PT1H" into minutes.
func parseTriggerMinutes(value string) int {
	v := strings.TrimPrefix(value, "-")
	v = strings.TrimPrefix(v, "+")
	v = strings.TrimPrefix(v, "PT")
	v = strings.TrimPrefix(v, "P")

	total := 0
	num := 0
	for _, c := range v {
		if c >= '0' && c <= '9' {
			num = num*10 + int(c-'0')
		} else {
			switch c {
			case 'W':
				total += num * 7 * 24 * 60
			case 'D':
				total += num * 24 * 60
			case 'H':
				total += num * 60
			case 'M':
				total += num
			case 'S':
				// ignore seconds
			case 'T':
				// time separator, skip
				continue
			}
			num = 0
		}
	}
	return total
}
