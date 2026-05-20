package coreserver

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// IsDemoUser is the single helper every outbound-effect chokepoint consults
// (mail send, invite email, drive share email, Expo push). Test it
// thoroughly: a regression here silently lets demo accounts send for real.

func setupDemoTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.BoolField{Name: "is_demo"})
	if err := app.Save(users); err != nil {
		t.Fatalf("save users: %v", err)
	}
	return app
}

func TestIsDemoUser_FalseForNonDemoUser(t *testing.T) {
	app := setupDemoTestApp(t)
	user := mustCreateUser(t, app, "regular@test.local", false)

	if IsDemoUser(app, user.Id) {
		t.Errorf("regular user should not be demo")
	}
}

func TestIsDemoUser_TrueForDemoUser(t *testing.T) {
	app := setupDemoTestApp(t)
	user := mustCreateUser(t, app, "demo@test.local", true)

	if !IsDemoUser(app, user.Id) {
		t.Errorf("demo user should be demo")
	}
}

func TestIsDemoUser_FalseForUnknownID(t *testing.T) {
	app := setupDemoTestApp(t)

	if IsDemoUser(app, "nonexistent_id_x") {
		t.Errorf("unknown user id should not be demo (safe default)")
	}
}

func TestIsDemoUser_FalseForEmptyID(t *testing.T) {
	app := setupDemoTestApp(t)

	if IsDemoUser(app, "") {
		t.Errorf("empty user id should not be demo")
	}
}

func TestIsDemoUser_TrueAfterFlippingFlag(t *testing.T) {
	// Ensures the helper reads live data, not a cached value.
	app := setupDemoTestApp(t)
	user := mustCreateUser(t, app, "flip@test.local", false)

	if IsDemoUser(app, user.Id) {
		t.Fatalf("precondition: user should start non-demo")
	}

	user.Set("is_demo", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	if !IsDemoUser(app, user.Id) {
		t.Errorf("flag flip not picked up by helper")
	}
}

func mustCreateUser(t *testing.T, app core.App, email string, demo bool) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("username", DeriveUsername(email))
	r.Set("name", "Test")
	r.SetVerified(true)
	r.SetPassword("Password123!")
	r.Set("is_demo", demo)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}
