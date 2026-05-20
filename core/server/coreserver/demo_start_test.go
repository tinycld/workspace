package coreserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupDemoStartTestApp builds a TestApp with the minimum schema RegisterDemoStart
// touches: users.is_demo, plus orgs and user_org collections. The shared
// fixture path used by account_delete_test.go isn't always present in CI, so
// we build the schema in-test like demo_test.go does for IsDemoUser.
func setupDemoStartTestApp(t *testing.T) *tests.TestApp {
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
	if users.Fields.GetByName("is_demo") == nil {
		users.Fields.Add(&core.BoolField{Name: "is_demo"})
		if err := app.Save(users); err != nil {
			t.Fatalf("save users with is_demo: %v", err)
		}
	}

	ensureCollection(t, app, "orgs", []core.Field{
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "slug", Required: true},
		&core.RelationField{Name: "users", CollectionId: users.Id, MaxSelect: 999},
	})

	orgs, err := app.FindCollectionByNameOrId("orgs")
	if err != nil {
		t.Fatalf("find orgs after create: %v", err)
	}

	ensureCollection(t, app, "user_org", []core.Field{
		&core.RelationField{Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1},
		&core.RelationField{Name: "org", Required: true, CollectionId: orgs.Id, MaxSelect: 1},
		&core.SelectField{Name: "role", Required: true, Values: []string{"owner", "admin", "member", "guest"}, MaxSelect: 1},
	})

	registerDemoStartCore(app)
	return app
}

func ensureCollection(t *testing.T, app core.App, name string, fields []core.Field) {
	t.Helper()
	if _, err := app.FindCollectionByNameOrId(name); err == nil {
		return
	}
	col := core.NewBaseCollection(name)
	for _, f := range fields {
		col.Fields.Add(f)
	}
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s collection: %v", name, err)
	}
}

// TestDemoStartCreatesUserAndOrg covers the cold-start path: no demo user
// exists, no demo org exists. After one POST the endpoint must return a
// PocketBase auth response, the user must exist with is_demo=true, and the
// org must exist with slug="demo" containing that user as a member.
func TestDemoStartCreatesUserAndOrg(t *testing.T) {
	app := setupDemoStartTestApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "cold start creates demo identity",
		Method:                http.MethodPost,
		URL:                   "/api/demo/start",
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"token":`, `"record":`, `"is_demo":true`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			user, err := app.FindAuthRecordByEmail("users", demoUserEmail)
			if err != nil {
				t.Fatalf("demo user not created: %v", err)
			}
			if !user.GetBool("is_demo") {
				t.Error("is_demo flag not set on created demo user")
			}

			org, err := app.FindFirstRecordByFilter(
				"orgs",
				"slug = {:slug}",
				dbx.Params{"slug": demoOrgSlug},
			)
			if err != nil {
				t.Fatalf("demo org not created: %v", err)
			}
			if !contains(org.GetStringSlice("users"), user.Id) {
				t.Errorf("demo org missing demo user in users[]: %v", org.GetStringSlice("users"))
			}

			membership, err := app.FindFirstRecordByFilter(
				"user_org",
				"user = {:uid} && org = {:oid}",
				dbx.Params{"uid": user.Id, "oid": org.Id},
			)
			if err != nil {
				t.Fatalf("user_org membership not created: %v", err)
			}
			if membership.GetString("role") != "owner" {
				t.Errorf("expected role=owner, got %q", membership.GetString("role"))
			}
		},
	}
	scenario.Test(t)
}

// TestDemoStartIsIdempotent covers the warm path: a demo user and org already
// exist. The endpoint must not create duplicates and must still return a
// valid auth token. Idempotency matters because the marketing CTA can fire
// repeatedly (browser back, double-click, retry on flaky network).
func TestDemoStartIsIdempotent(t *testing.T) {
	app := setupDemoStartTestApp(t)

	for i := 0; i < 3; i++ {
		scenario := &tests.ApiScenario{
			Name:                  "repeat call returns auth without duplication",
			Method:                http.MethodPost,
			URL:                   "/api/demo/start",
			ExpectedStatus:        http.StatusOK,
			ExpectedContent:       []string{`"token":`, `"record":`},
			TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
		}
		scenario.Test(t)
	}

	users, err := app.FindRecordsByFilter(
		"users",
		"email = {:email}",
		"-id", 0, 0,
		dbx.Params{"email": demoUserEmail},
	)
	if err != nil {
		t.Fatalf("FindRecordsByFilter users: %v", err)
	}
	if len(users) != 1 {
		t.Errorf("expected exactly 1 demo user, got %d", len(users))
	}

	orgs, err := app.FindRecordsByFilter(
		"orgs",
		"slug = {:slug}",
		"-id", 0, 0,
		dbx.Params{"slug": demoOrgSlug},
	)
	if err != nil {
		t.Fatalf("FindRecordsByFilter orgs: %v", err)
	}
	if len(orgs) != 1 {
		t.Errorf("expected exactly 1 demo org, got %d", len(orgs))
	}

	memberships, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:uid} && org = {:oid}",
		"-id", 0, 0,
		dbx.Params{"uid": users[0].Id, "oid": orgs[0].Id},
	)
	if err != nil {
		t.Fatalf("FindRecordsByFilter user_org: %v", err)
	}
	if len(memberships) != 1 {
		t.Errorf("expected exactly 1 membership, got %d", len(memberships))
	}
}

// TestDemoStartReturnsValidAuthToken confirms the response is shaped like a
// PocketBase auth response — the front-end depends on this exact shape so it
// can drop the result straight into pb.authStore via importAuth.
func TestDemoStartReturnsValidAuthToken(t *testing.T) {
	app := setupDemoStartTestApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "auth response shape",
		Method:                http.MethodPost,
		URL:                   "/api/demo/start",
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"token":`, `"record":`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			var payload struct {
				Token  string `json:"token"`
				Record struct {
					ID     string `json:"id"`
					Email  string `json:"email"`
					IsDemo bool   `json:"is_demo"`
				} `json:"record"`
			}
			if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if payload.Token == "" {
				t.Error("empty token")
			}
			if !strings.Contains(payload.Token, ".") {
				t.Errorf("token doesn't look like a JWT: %q", payload.Token)
			}
			if payload.Record.Email != demoUserEmail {
				t.Errorf("expected email %q, got %q", demoUserEmail, payload.Record.Email)
			}
			if !payload.Record.IsDemo {
				t.Error("record.is_demo should be true so client suppresses outbound effects")
			}
			if payload.Record.ID == "" {
				t.Error("empty record.id")
			}
		},
	}
	scenario.Test(t)
}

// TestDemoStart_SetsUsername verifies that the demo user gets the stable
// "demo" username so the front-end can address the demo session by username.
func TestDemoStart_SetsUsername(t *testing.T) {
	app := setupDemoStartTestApp(t)

	scenario := &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/demo/start",
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"username":"demo"`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			tt := t.(*testing.T)
			rec, err := app.FindFirstRecordByFilter(
				"users", "username = {:u}", dbx.Params{"u": demoUserUsername})
			if err != nil {
				tt.Fatalf("demo user not found by username: %v", err)
			}
			if got := rec.GetString("username"); got != demoUserUsername {
				tt.Errorf("username = %q, want %q", got, demoUserUsername)
			}
		},
	}
	scenario.Test(t)
}

// TestDemoStartUserPasswordIsUnknowable verifies that even though the
// endpoint creates a real auth user, the password is set to fresh random
// bytes and never returned. Anyone who learns the email can't sign in via
// /authWithPassword — the demo flow is the only door.
func TestDemoStartUserPasswordIsUnknowable(t *testing.T) {
	app := setupDemoStartTestApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "password not exposed",
		Method:                http.MethodPost,
		URL:                   "/api/demo/start",
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"token":`},
		NotExpectedContent:    []string{`"password":`, `"tokenKey":`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			var raw map[string]any
			if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
				t.Fatalf("decode: %v", err)
			}
			rec, _ := raw["record"].(map[string]any)
			if _, hasPwd := rec["password"]; hasPwd {
				t.Error("response leaks password field")
			}
			if _, hasTokenKey := rec["tokenKey"]; hasTokenKey {
				t.Error("response leaks tokenKey field")
			}
		},
	}
	scenario.Test(t)
}
