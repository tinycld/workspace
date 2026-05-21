package calendar

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// handleUserOrgCreated auto-creates a personal calendar when a user joins an org.
func handleUserOrgCreated(app *pocketbase.PocketBase, userOrgRecord *core.Record) {
	orgID := userOrgRecord.GetString("org")
	userID := userOrgRecord.GetString("user")

	user, err := app.FindRecordById("users", userID)
	if err != nil {
		app.Logger().Warn("calendar lifecycle: failed to find user",
			"userID", userID, "error", err)
		return
	}

	// Check if this user already has a calendar in this org (idempotency)
	existing, err := app.FindRecordsByFilter(
		"calendar_members",
		"user_org = {:userOrg} && role = 'owner'",
		"",
		1,
		0,
		map[string]any{"userOrg": userOrgRecord.Id},
	)
	if err == nil && len(existing) > 0 {
		return
	}

	calCollection, err := app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		app.Logger().Warn("calendar lifecycle: calendar_calendars collection not found", "error", err)
		return
	}

	userName := user.GetString("name")
	if userName == "" {
		userName = user.GetString("email")
	}

	cal := core.NewRecord(calCollection)
	cal.Set("org", orgID)
	cal.Set("name", userName)
	cal.Set("description", "")
	cal.Set("color", "blue")
	if err := app.Save(cal); err != nil {
		app.Logger().Warn("calendar lifecycle: failed to create personal calendar",
			"user", userID, "error", err)
		return
	}

	memberCollection, err := app.FindCollectionByNameOrId("calendar_members")
	if err != nil {
		app.Logger().Warn("calendar lifecycle: calendar_members collection not found", "error", err)
		return
	}

	member := core.NewRecord(memberCollection)
	member.Set("calendar", cal.Id)
	member.Set("user_org", userOrgRecord.Id)
	member.Set("role", "owner")
	if err := app.Save(member); err != nil {
		app.Logger().Warn("calendar lifecycle: failed to create calendar member",
			"calendar", cal.Id, "error", err)
	}
}

// handleUserOrgDeleted cleans up orphaned personal calendars after a user leaves an org.
func handleUserOrgDeleted(app *pocketbase.PocketBase, userOrgRecord *core.Record) {
	// Find all calendar memberships for this user_org
	memberships, err := app.FindRecordsByFilter(
		"calendar_members",
		"user_org = {:userOrg}",
		"",
		100,
		0,
		map[string]any{"userOrg": userOrgRecord.Id},
	)
	if err != nil || len(memberships) == 0 {
		return
	}

	for _, membership := range memberships {
		calID := membership.GetString("calendar")

		// Delete the membership
		if err := app.Delete(membership); err != nil {
			app.Logger().Warn("calendar lifecycle: failed to delete membership",
				"membershipID", membership.Id, "error", err)
			continue
		}

		// Check if calendar has any remaining members
		remaining, err := app.FindRecordsByFilter(
			"calendar_members",
			"calendar = {:cal}",
			"",
			1,
			0,
			map[string]any{"cal": calID},
		)
		if err != nil || len(remaining) == 0 {
			cal, err := app.FindRecordById("calendar_calendars", calID)
			if err == nil {
				if err := app.Delete(cal); err != nil {
					app.Logger().Warn("calendar lifecycle: failed to delete orphaned calendar",
						"calendarID", calID, "error", err)
				}
			}
		}
	}
}
