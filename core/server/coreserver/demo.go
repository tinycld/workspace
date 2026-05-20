package coreserver

import (
	"github.com/pocketbase/pocketbase/core"
)

// IsDemoUser returns true when the given user has the is_demo flag set.
//
// All outbound side effects (mail send, invite emails, share emails, Expo
// push) consult this helper before placing data on the wire, so demo
// accounts can walk through the full app flow without anything actually
// leaving the box. Returns false on lookup failure so non-demo behavior is
// the safe default if the user record can't be loaded.
//
// Takes core.App rather than *pocketbase.PocketBase so tests can call it
// against a *tests.TestApp without duplicating the lookup logic. Production
// callers (mail/server, drive/server, coreserver itself) already have a
// *pocketbase.PocketBase, which embeds core.App via *core.BaseApp.
func IsDemoUser(app core.App, userID string) bool {
	if userID == "" {
		return false
	}
	rec, err := app.FindRecordById("users", userID)
	if err != nil {
		return false
	}
	return rec.GetBool("is_demo")
}
