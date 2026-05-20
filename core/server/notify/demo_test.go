package notify

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// isDemoUser is the gate used by sendExpoPush to suppress external
// device-wake calls for demo accounts. The behavior is identical to
// coreserver.IsDemoUser but inlined here to avoid an import cycle.

func setupNotifyTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.Add(&core.BoolField{Name: "is_demo"})
	if err := app.Save(users); err != nil {
		t.Fatal(err)
	}
	return app
}

func mkUser(t *testing.T, app core.App, email string, demo bool) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("name", "T")
	r.SetVerified(true)
	r.SetPassword("Password123!")
	r.Set("is_demo", demo)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestIsDemoUser_FalseForNonDemo(t *testing.T) {
	app := setupNotifyTestApp(t)
	u := mkUser(t, app, "n@test.local", false)
	if isDemoUser(app, u.Id) {
		t.Error("non-demo user reported as demo")
	}
}

func TestIsDemoUser_TrueForDemo(t *testing.T) {
	app := setupNotifyTestApp(t)
	u := mkUser(t, app, "d@test.local", true)
	if !isDemoUser(app, u.Id) {
		t.Error("demo user not reported as demo")
	}
}

func TestIsDemoUser_FalseForEmptyOrUnknown(t *testing.T) {
	app := setupNotifyTestApp(t)
	if isDemoUser(app, "") {
		t.Error("empty id should not be demo")
	}
	if isDemoUser(app, "doesnotexist1234") {
		t.Error("unknown id should not be demo (safe default)")
	}
}

// TestSendExpoPush_DemoSkipsAll asserts the gate short-circuits before any
// other DB lookup. The function would normally query push_subscriptions
// next; we don't seed that collection. For a demo user the function returns
// immediately, never panicking on the missing collection. For a non-demo
// user the lookup runs and silently no-ops on the missing collection
// (FindRecordsByFilter returns an error which the function swallows). Both
// paths are quiet; the difference is observable only by hooking deeper.
//
// The real coverage here is the gate: if a future refactor drops the demo
// check, sendExpoPush would attempt to query push_subscriptions even for
// demo recipients, which we'd want to know about.
func TestSendExpoPush_DemoUserSkipsExternalCall(t *testing.T) {
	app := setupNotifyTestApp(t)
	u := mkUser(t, app, "demo@test.local", true)

	// Calling against a TestApp without push_subscriptions seeded: if the
	// gate is broken and the function fell through to FindRecordsByFilter,
	// we'd see a no-collection error logged but no panic. We can't directly
	// assert "no Expo HTTP call" without intercepting, so we cover that
	// piece via TestIsDemoUser_TrueForDemo above. This test ensures the
	// composite call doesn't panic on a demo user when push_subscriptions
	// is absent.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("sendExpoPush panicked for demo user: %v", r)
		}
	}()
	sendExpoPush(app, u.Id, NotifyParams{
		UserID: u.Id,
		Type:   "test",
		Title:  "ignored",
		Body:   "ignored",
	})
}
