package calendar

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/emersion/go-webdav/caldav"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/audit"
	"tinycld.org/core/notify"
)

func Register(app *pocketbase.PocketBase) {
	// Audit logging for calendar collections
	audit.RegisterCollection(app, "calendar_calendars", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("name"),
	})
	audit.RegisterCollection(app, "calendar_events", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			calendarID := record.GetString("calendar")
			if calendarID == "" {
				return ""
			}
			return audit.ResolveViaRelation(a, "calendar_calendars", calendarID, "org")
		},
		ExtractLabel: audit.LabelFromField("title"),
	})
	audit.RegisterCollection(app, "calendar_members", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			calendarID := record.GetString("calendar")
			if calendarID == "" {
				return ""
			}
			return audit.ResolveViaRelation(a, "calendar_calendars", calendarID, "org")
		},
	})

	// Auto-create personal calendar when a user joins an org
	app.OnRecordAfterCreateSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		handleUserOrgCreated(app, e.Record)
		return e.Next()
	})

	// Clean up orphaned calendars when a user leaves an org
	app.OnRecordAfterDeleteSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		handleUserOrgDeleted(app, e.Record)
		return e.Next()
	})

	// Normalize webcal:// URLs on create/update
	app.OnRecordCreate("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		if url := e.Record.GetString("subscription_url"); url != "" {
			e.Record.Set("subscription_url", normalizeSubscriptionURL(url))
		}
		return e.Next()
	})

	app.OnRecordUpdate("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		if url := e.Record.GetString("subscription_url"); url != "" {
			e.Record.Set("subscription_url", normalizeSubscriptionURL(url))
		}
		return e.Next()
	})

	// Trigger immediate sync when subscription_url changes or a refresh is requested
	// (refresh clears subscription_last_sync to signal the hook)
	app.OnRecordAfterUpdateSuccess("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		newURL := e.Record.GetString("subscription_url")
		if newURL == "" {
			return e.Next()
		}
		oldURL := e.Record.Original().GetString("subscription_url")
		oldSync := e.Record.Original().GetString("subscription_last_sync")
		newSync := e.Record.GetString("subscription_last_sync")
		urlChanged := newURL != oldURL
		refreshRequested := oldSync != "" && newSync == ""
		if urlChanged || refreshRequested {
			calId := e.Record.Id
			go func() {
				rec, err := app.FindRecordById("calendar_calendars", calId)
				if err != nil {
					return
				}
				if err := syncSubscription(app, rec); err != nil {
					app.Logger().Warn("subscription: immediate sync failed",
						"calendar", calId,
						"url", rec.GetString("subscription_url"),
						"error", err)
					errMsg := err.Error()
					if len(errMsg) > 500 {
						errMsg = errMsg[:500]
					}
					rec.Set("subscription_error", errMsg)
					rec.Set("subscription_last_sync", time.Now().UTC().Format(pbTimeFormat))
					_ = app.Save(rec)
					notifySubscriptionError(app, rec, errMsg)
				}
			}()
		}
		return e.Next()
	})

	// Trigger immediate sync when a new subscription is created
	app.OnRecordAfterCreateSuccess("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		if url := e.Record.GetString("subscription_url"); url != "" {
			calId := e.Record.Id
			go func() {
				rec, err := app.FindRecordById("calendar_calendars", calId)
				if err != nil {
					return
				}
				if err := syncSubscription(app, rec); err != nil {
					app.Logger().Warn("subscription: immediate sync failed",
						"calendar", calId,
						"url", rec.GetString("subscription_url"),
						"error", err)
					errMsg := err.Error()
					if len(errMsg) > 500 {
						errMsg = errMsg[:500]
					}
					rec.Set("subscription_error", errMsg)
					rec.Set("subscription_last_sync", time.Now().UTC().Format(pbTimeFormat))
					_ = app.Save(rec)
					notifySubscriptionError(app, rec, errMsg)
				}
			}()
		}
		return e.Next()
	})

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		go startSubscriptionSync(app)
		go startReminderScheduler(app)

		backend := newInstrumentedBackend(&CalDAVBackend{app: app})
		handler := caldav.Handler{Backend: backend, Prefix: "/caldav"}

		serveCalDAV := func(re *core.RequestEvent) error {
			_, _, ok := re.Request.BasicAuth()
			if !ok {
				re.Response.Header().Set("WWW-Authenticate", `Basic realm="TinyCld CalDAV"`)
				http.Error(re.Response, "Authentication required", http.StatusUnauthorized)
				return nil
			}

			ctx := context.WithValue(re.Request.Context(), httpRequestKey, re.Request)
			handler.ServeHTTP(re.Response, re.Request.WithContext(ctx))
			return nil
		}

		e.Router.Any("/caldav/{path...}", serveCalDAV)
		e.Router.Any("/caldav", serveCalDAV)

		e.Router.Any("/.well-known/caldav", func(re *core.RequestEvent) error {
			http.Redirect(re.Response, re.Request, "/caldav/", http.StatusMovedPermanently)
			return nil
		})

		return e.Next()
	})

	// Auto-create owner membership when a calendar is created via the API.
	// The calendar_members create rule requires an existing owner, so the first
	// membership must be created server-side.
	app.OnRecordCreateRequest("calendar_calendars").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}

		auth := e.Auth
		if auth == nil {
			return nil
		}

		orgID := e.Record.GetString("org")
		userOrg, err := app.FindFirstRecordByFilter(
			"user_org",
			"user = {:user} && org = {:org}",
			map[string]any{"user": auth.Id, "org": orgID},
		)
		if err != nil {
			return nil
		}

		memberCollection, err := app.FindCollectionByNameOrId("calendar_members")
		if err != nil {
			return nil
		}

		member := core.NewRecord(memberCollection)
		member.Set("calendar", e.Record.Id)
		member.Set("user_org", userOrg.Id)
		member.Set("role", "owner")
		if err := app.Save(member); err != nil {
			app.Logger().Warn("calendar: failed to auto-create owner membership",
				"calendar", e.Record.Id, "error", err)
		}

		return nil
	})

	// Notify invited user when a new calendar membership is created
	app.OnRecordAfterCreateSuccess("calendar_members").BindFunc(func(e *core.RecordEvent) error {
		go notifyCalendarInvite(app, e.Record)
		return e.Next()
	})

	// Authorize calendar_members create at the Go layer. The PB rule
	// (calOwnerRule) traverses a back-relation through user_org, which
	// PB v0.36 evaluates inconsistently — non-superuser creates always
	// 400 even when the auth user IS an owner. Enforce here instead:
	// only owners of the calendar can add members.
	app.OnRecordCreateRequest("calendar_members").BindFunc(func(e *core.RecordRequestEvent) error {
		auth := e.Auth
		if auth == nil {
			return apis.NewUnauthorizedError("Authentication required.", nil)
		}
		// Superusers bypass: the seed script and admin tooling create
		// memberships without going through the calendar-owner flow.
		if auth.Collection().Name == core.CollectionNameSuperusers {
			return e.Next()
		}
		calendarID := e.Record.GetString("calendar")
		if calendarID == "" {
			return apis.NewBadRequestError("calendar is required.", nil)
		}
		isOwner, err := userIsOwner(app, calendarID, auth.Id)
		if err != nil {
			return err
		}
		if !isOwner {
			return apis.NewForbiddenError("Only calendar owners can add members.", nil)
		}
		return e.Next()
	})

	// Refuse to remove the last owner of a calendar — otherwise no one can
	// manage members or change subscriptions, and the calendar becomes
	// orphaned. Catches both delete and demotion (role-update away from
	// "owner") on the same membership.
	app.OnRecordDeleteRequest("calendar_members").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("role") == "owner" {
			calId := e.Record.GetString("calendar")
			if err := guardLastOwner(app, calId, e.Record.Id); err != nil {
				return err
			}
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("calendar_members").BindFunc(func(e *core.RecordRequestEvent) error {
		// Only block if this is a demotion away from owner.
		original := e.Record.Original()
		if original.GetString("role") == "owner" && e.Record.GetString("role") != "owner" {
			calId := e.Record.GetString("calendar")
			if err := guardLastOwner(app, calId, e.Record.Id); err != nil {
				return err
			}
		}
		return e.Next()
	})

	// Auto-generate ical_uid for events created via the web UI
	app.OnRecordCreate("calendar_events").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("ical_uid") == "" {
			e.Record.Set("ical_uid", "urn:uuid:"+uuid.NewString())
		}
		return e.Next()
	})

	registerRecurrenceUntilHooks(app)
}

func notifyCalendarInvite(app *pocketbase.PocketBase, memberRecord *core.Record) {
	userOrgID := memberRecord.GetString("user_org")
	calendarID := memberRecord.GetString("calendar")
	role := memberRecord.GetString("role")

	// Skip notifications for owner memberships (auto-created)
	if role == "owner" {
		return
	}

	userOrgRecord, err := app.FindRecordById("user_org", userOrgID)
	if err != nil {
		return
	}
	userID := userOrgRecord.GetString("user")
	orgID := userOrgRecord.GetString("org")

	calendar, err := app.FindRecordById("calendar_calendars", calendarID)
	if err != nil {
		return
	}
	calendarName := calendar.GetString("name")

	orgRecord, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		return
	}
	orgSlug := orgRecord.GetString("slug")

	notify.NotifyUser(app, notify.NotifyParams{
		UserID:  userID,
		OrgID:   orgID,
		Type:    "calendar_invite",
		Package: "calendar",
		Title:   fmt.Sprintf("You were added to calendar: %s", calendarName),
		Body:    fmt.Sprintf("You now have %s access", role),
		URL:     fmt.Sprintf("/a/%s/calendar", orgSlug),
	})
}

// userIsOwner reports whether the given user holds an "owner" calendar_members
// row for the given calendar (via any of their user_org records).
func userIsOwner(app core.App, calendarID, userID string) (bool, error) {
	userOrgs, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:userId}",
		"", 0, 0,
		map[string]any{"userId": userID},
	)
	if err != nil {
		return false, err
	}
	for _, uo := range userOrgs {
		owners, err := app.FindRecordsByFilter(
			"calendar_members",
			"calendar = {:calId} && user_org = {:uoId} && role = 'owner'",
			"", 1, 0,
			map[string]any{"calId": calendarID, "uoId": uo.Id},
		)
		if err != nil {
			return false, err
		}
		if len(owners) > 0 {
			return true, nil
		}
	}
	return false, nil
}

// guardLastOwner returns an error if removing or demoting the membership
// identified by excludeMemberID would leave the calendar with zero owners.
// excludeMemberID is the row about to be deleted/demoted; it's excluded from
// the count so the caller's own record doesn't keep itself alive.
func guardLastOwner(app core.App, calendarID, excludeMemberID string) error {
	owners, err := app.FindRecordsByFilter(
		"calendar_members",
		"calendar = {:calId} && role = 'owner' && id != {:excludeId}",
		"", 0, 0,
		map[string]any{"calId": calendarID, "excludeId": excludeMemberID},
	)
	if err != nil {
		return err
	}
	if len(owners) == 0 {
		return apis.NewBadRequestError("A calendar must have at least one owner.", nil)
	}
	return nil
}
