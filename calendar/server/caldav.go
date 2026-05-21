package calendar

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav/caldav"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

type CalDAVBackend struct {
	app *pocketbase.PocketBase
}

type contextKey string

const httpRequestKey contextKey = "httpRequest"

func (b *CalDAVBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	_, err := b.authFromContext(ctx)
	if err != nil {
		return "", err
	}
	return "/caldav/u/", nil
}

func (b *CalDAVBackend) CalendarHomeSetPath(ctx context.Context) (string, error) {
	_, err := b.authFromContext(ctx)
	if err != nil {
		return "", err
	}
	return "/caldav/u/cal/", nil
}

func (b *CalDAVBackend) ListCalendars(ctx context.Context) ([]caldav.Calendar, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}

	// Find all user_org records for this user
	userOrgs, err := b.app.FindRecordsByFilter("user_org", "user = {:userId}", "", 0, 0,
		map[string]any{"userId": user.Id})
	if err != nil {
		return nil, err
	}

	if len(userOrgs) == 0 {
		return nil, nil
	}

	// PB's filter grammar (fexpr) has no IN operator — only =, !=, <, <=, >,
	// >=, ~, !~ joined by && / ||. Expand to "user_org = {:uo0} || ..."
	filter, params := orEqualsFilter("user_org", recordIDs(userOrgs), nil)

	members, err := b.app.FindRecordsByFilter("calendar_members", filter, "", 0, 0, params)
	if err != nil {
		return nil, err
	}

	// When the user has multiple orgs, calendar names can collide across
	// orgs (e.g. the auto-created personal calendar is named after the
	// user, so a multi-org user gets one "Test User" calendar per org).
	// CalDAV clients show only `displayname`, so unsuffixed names appear
	// as duplicates. Suffix with the org name in that case so each entry
	// is unambiguous in the client and identifiable in tests.
	multiOrg := len(userOrgs) > 1

	var calendars []caldav.Calendar
	for _, member := range members {
		calId := member.GetString("calendar")
		calRecord, err := b.app.FindRecordById("calendar_calendars", calId)
		if err != nil {
			continue
		}

		calendars = append(calendars, caldav.Calendar{
			Path:                  fmt.Sprintf("/caldav/u/cal/%s/", calId),
			Name:                  b.calendarDisplayName(calRecord, multiOrg),
			Description:           calRecord.GetString("description"),
			SupportedComponentSet: []string{ical.CompEvent},
		})
	}

	return calendars, nil
}

// calendarDisplayName returns the calendar name to surface over CalDAV,
// suffixed with the org name when multiOrg is true. Falls back to the
// bare name if the org record can't be loaded.
func (b *CalDAVBackend) calendarDisplayName(calRecord *core.Record, multiOrg bool) string {
	name := calRecord.GetString("name")
	if !multiOrg {
		return name
	}
	orgID := calRecord.GetString("org")
	if orgID == "" {
		return name
	}
	orgRecord, err := b.app.FindRecordById("orgs", orgID)
	if err != nil {
		return name
	}
	orgName := orgRecord.GetString("name")
	if orgName == "" {
		return name
	}
	return fmt.Sprintf("%s (%s)", name, orgName)
}

func (b *CalDAVBackend) GetCalendar(ctx context.Context, path string) (*caldav.Calendar, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}

	calId := extractCalendarID(path)
	if calId == "" {
		return nil, fmt.Errorf("invalid calendar path")
	}

	calRecord, err := b.app.FindRecordById("calendar_calendars", calId)
	if err != nil {
		return nil, fmt.Errorf("calendar not found")
	}

	_, err = b.resolveCalendarMembership(user.Id, calId)
	if err != nil {
		return nil, err
	}

	// Match ListCalendars: disambiguate the displayname when the user
	// belongs to more than one org.
	userOrgs, err := b.app.FindRecordsByFilter("user_org", "user = {:userId}", "", 0, 0,
		map[string]any{"userId": user.Id})
	if err != nil {
		return nil, err
	}
	multiOrg := len(userOrgs) > 1

	return &caldav.Calendar{
		Path:                  fmt.Sprintf("/caldav/u/cal/%s/", calId),
		Name:                  b.calendarDisplayName(calRecord, multiOrg),
		Description:           calRecord.GetString("description"),
		SupportedComponentSet: []string{ical.CompEvent},
	}, nil
}

func (b *CalDAVBackend) CreateCalendar(_ context.Context, _ *caldav.Calendar) error {
	return fmt.Errorf("creating calendars via CalDAV is not supported")
}

func (b *CalDAVBackend) ListCalendarObjects(ctx context.Context, path string, _ *caldav.CalendarCompRequest) ([]caldav.CalendarObject, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}

	calId := extractCalendarID(path)
	if calId == "" {
		return nil, fmt.Errorf("invalid calendar path")
	}

	_, err = b.resolveCalendarMembership(user.Id, calId)
	if err != nil {
		return nil, err
	}

	records, err := b.app.FindRecordsByFilter("calendar_events",
		"calendar = {:calId}", "-updated", 0, 0,
		map[string]any{"calId": calId})
	if err != nil {
		return nil, err
	}

	calPath := fmt.Sprintf("/caldav/u/cal/%s/", calId)
	objects := make([]caldav.CalendarObject, 0, len(records))
	for _, record := range records {
		b.backfillICalUID(record)

		obj, err := b.recordToCalendarObject(record, calPath)
		if err != nil {
			continue
		}
		objects = append(objects, *obj)
	}

	return objects, nil
}

func (b *CalDAVBackend) GetCalendarObject(ctx context.Context, path string, _ *caldav.CalendarCompRequest) (*caldav.CalendarObject, error) {
	record, calPath, err := b.resolveEventByPath(ctx, path)
	if err != nil {
		return nil, err
	}
	return b.recordToCalendarObject(record, calPath)
}

func (b *CalDAVBackend) QueryCalendarObjects(ctx context.Context, path string, _ *caldav.CalendarQuery) ([]caldav.CalendarObject, error) {
	return b.ListCalendarObjects(ctx, path, nil)
}

func (b *CalDAVBackend) PutCalendarObject(ctx context.Context, path string, cal *ical.Calendar, _ *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}

	calId := extractCalendarID(path)
	if calId == "" {
		return nil, fmt.Errorf("invalid calendar path")
	}

	membership, err := b.resolveCalendarMembership(user.Id, calId)
	if err != nil {
		return nil, err
	}
	if err := requireEditorRole(membership); err != nil {
		return nil, err
	}

	events := cal.Events()
	if len(events) == 0 {
		return nil, fmt.Errorf("no VEVENT found in calendar data")
	}

	icalUID, err := events[0].Props.Text(ical.PropUID)
	if err != nil || icalUID == "" {
		return nil, fmt.Errorf("VEVENT must have a UID")
	}

	// Try to find existing event by ical_uid
	existing, _ := b.app.FindRecordsByFilter("calendar_events",
		"ical_uid = {:uid} && calendar = {:calId}", "", 1, 0,
		map[string]any{"uid": icalUID, "calId": calId})

	if len(existing) > 0 {
		record := existing[0]
		if err := applyCalendarToRecord(cal, record); err != nil {
			return nil, err
		}
		if err := b.app.Save(record); err != nil {
			return nil, err
		}
		calPath := fmt.Sprintf("/caldav/u/cal/%s/", calId)
		return b.recordToCalendarObject(record, calPath)
	}

	// Create new event
	collection, err := b.app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		return nil, err
	}

	record := core.NewRecord(collection)
	record.Set("calendar", calId)
	record.Set("created_by", membership.GetString("user_org"))
	record.Set("ical_uid", icalUID)
	// Set defaults before applying iCal data
	record.Set("busy_status", "busy")
	record.Set("visibility", "default")

	if err := applyCalendarToRecord(cal, record); err != nil {
		return nil, err
	}

	if err := b.app.Save(record); err != nil {
		return nil, err
	}

	calPath := fmt.Sprintf("/caldav/u/cal/%s/", calId)
	return b.recordToCalendarObject(record, calPath)
}

func (b *CalDAVBackend) DeleteCalendarObject(ctx context.Context, path string) error {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return err
	}

	calId := extractCalendarID(path)
	if calId == "" {
		return fmt.Errorf("invalid calendar path")
	}

	membership, err := b.resolveCalendarMembership(user.Id, calId)
	if err != nil {
		return err
	}
	if err := requireEditorRole(membership); err != nil {
		return err
	}

	record, _, err := b.resolveEventByPath(ctx, path)
	if err != nil {
		return err
	}

	return b.app.Delete(record)
}

// authFromContext extracts the authenticated user from the request context.
func (b *CalDAVBackend) authFromContext(ctx context.Context) (*core.Record, error) {
	r, ok := ctx.Value(httpRequestKey).(*http.Request)
	if !ok {
		return nil, errUnauthorized
	}
	return authenticateRequest(b.app, r)
}

func (b *CalDAVBackend) recordToCalendarObject(record *core.Record, calPath string) (*caldav.CalendarObject, error) {
	cal, err := recordToCalendar(record)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := ical.NewEncoder(&buf).Encode(cal); err != nil {
		return nil, err
	}

	modTime := time.Time{}
	if updated := record.GetString("updated"); updated != "" {
		if t, err := time.Parse(pbTimeFormat, updated); err == nil {
			modTime = t
		}
	}

	icalUID := record.GetString("ical_uid")
	return &caldav.CalendarObject{
		Path:          calPath + icalUID + ".ics",
		ModTime:       modTime,
		ContentLength: int64(buf.Len()),
		ETag:          fmt.Sprintf(`"%s"`, record.GetString("updated")),
		Data:          cal,
	}, nil
}

// resolveEventByPath finds a calendar event by its path, authenticating and authorizing the user.
func (b *CalDAVBackend) resolveEventByPath(ctx context.Context, path string) (*core.Record, string, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, "", err
	}

	calId := extractCalendarID(path)
	if calId == "" {
		return nil, "", fmt.Errorf("invalid event path")
	}

	_, err = b.resolveCalendarMembership(user.Id, calId)
	if err != nil {
		return nil, "", err
	}

	icalUID := extractICalUID(path)
	if icalUID == "" {
		return nil, "", fmt.Errorf("invalid event path")
	}

	records, err := b.app.FindRecordsByFilter("calendar_events",
		"ical_uid = {:uid} && calendar = {:calId}", "", 1, 0,
		map[string]any{"uid": icalUID, "calId": calId})
	if err != nil || len(records) == 0 {
		return nil, "", fmt.Errorf("event not found")
	}

	calPath := fmt.Sprintf("/caldav/u/cal/%s/", calId)
	return records[0], calPath, nil
}

// resolveCalendarMembership verifies a user has access to a calendar via any of their user_org records.
// Returns the calendar_members record.
func (b *CalDAVBackend) resolveCalendarMembership(userId, calId string) (*core.Record, error) {
	userOrgs, err := b.app.FindRecordsByFilter("user_org", "user = {:userId}", "", 0, 0,
		map[string]any{"userId": userId})
	if err != nil || len(userOrgs) == 0 {
		return nil, fmt.Errorf("user has no org memberships")
	}

	uoFilter, params := orEqualsFilter("user_org", recordIDs(userOrgs), map[string]any{"calId": calId})
	filter := "calendar = {:calId} && (" + uoFilter + ")"

	members, err := b.app.FindRecordsByFilter("calendar_members", filter, "", 1, 0, params)
	if err != nil || len(members) == 0 {
		return nil, fmt.Errorf("user is not a member of calendar %s", calId)
	}

	return members[0], nil
}

// recordIDs extracts the Id field from each record into a string slice.
func recordIDs(records []*core.Record) []string {
	ids := make([]string, len(records))
	for i, r := range records {
		ids[i] = r.Id
	}
	return ids
}

// orEqualsFilter builds a PB filter clause that matches when `field` equals
// any of `values`, joining N `field = {:keyN}` predicates with ||. Returns
// the clause and a params map. Pass an existing `extra` params map to merge
// additional placeholders (e.g. "calId"); pass nil to allocate a fresh one.
//
// PB's fexpr parser has no IN operator. This is the standard workaround.
func orEqualsFilter(field string, values []string, extra map[string]any) (string, map[string]any) {
	params := extra
	if params == nil {
		params = make(map[string]any, len(values))
	}
	clauses := make([]string, len(values))
	for i, v := range values {
		key := fmt.Sprintf("%s_%d", field, i)
		clauses[i] = field + " = {:" + key + "}"
		params[key] = v
	}
	return strings.Join(clauses, " || "), params
}

func requireEditorRole(membership *core.Record) error {
	role := membership.GetString("role")
	if role == "viewer" {
		return fmt.Errorf("insufficient permissions: viewer role cannot modify events")
	}
	return nil
}

// backfillICalUID generates an ical_uid for events that don't have one yet.
func (b *CalDAVBackend) backfillICalUID(record *core.Record) {
	if record.GetString("ical_uid") != "" {
		return
	}
	uid := "urn:uuid:" + uuid.NewString()
	record.Set("ical_uid", uid)
	_ = b.app.Save(record)
}

// extractCalendarID gets the calendar ID from /caldav/u/cal/{calendarId}/...
func extractCalendarID(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	// parts: caldav / u / cal / {calendarId} / ...
	if len(parts) >= 4 {
		return parts[3]
	}
	return ""
}

// extractICalUID gets the ical UID from /caldav/u/cal/{calendarId}/{ical_uid}.ics
func extractICalUID(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	// parts: caldav / u / cal / {calendarId} / {uid}.ics
	if len(parts) >= 5 {
		return strings.TrimSuffix(parts[4], ".ics")
	}
	return ""
}
