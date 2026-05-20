package coreserver

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupDemoLeadTestApp builds a TestApp containing the demo_leads collection
// and registers POST /api/demo/lead. We rebuild the schema in-test (rather
// than relying on a fixture) for the same reason demo_start_test.go does:
// the shared fixture path isn't always available in CI.
func setupDemoLeadTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	if _, err := app.FindCollectionByNameOrId("demo_leads"); err != nil {
		col := core.NewBaseCollection("demo_leads")
		col.Fields.Add(&core.EmailField{Name: "email", Required: true})
		col.Fields.Add(&core.TextField{Name: "reason", Max: 2000})
		col.Fields.Add(&core.SelectField{
			Name:      "source",
			Required:  true,
			Values:    []string{"intro_modal", "banner_link"},
			MaxSelect: 1,
		})
		col.Fields.Add(&core.TextField{Name: "user_agent", Max: 1000})
		col.Fields.Add(&core.TextField{Name: "ip", Max: 100})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		if err := app.Save(col); err != nil {
			t.Fatalf("create demo_leads: %v", err)
		}
	}

	registerDemoLeadCore(app)
	return app
}

// TestDemoLead_HappyPath exercises the full success flow: a valid POST with
// every field populated lands one row with email/reason/source preserved and
// user_agent/ip captured from request headers.
func TestDemoLead_HappyPath(t *testing.T) {
	app := setupDemoLeadTestApp(t)

	scenario := &tests.ApiScenario{
		Name:           "happy path inserts row",
		Method:         http.MethodPost,
		URL:            "/api/demo/lead",
		Body:           strings.NewReader(`{"email":"prospect@example.com","reason":"Evaluating for my team","source":"intro_modal"}`),
		Headers:        map[string]string{"Content-Type": "application/json", "User-Agent": "PlanTestAgent/1.0"},
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			tt := t.(*testing.T)
			rec, err := app.FindFirstRecordByFilter(
				"demo_leads",
				"email = {:email}",
				dbx.Params{"email": "prospect@example.com"},
			)
			if err != nil {
				tt.Fatalf("lead row not created: %v", err)
			}
			if got := rec.GetString("reason"); got != "Evaluating for my team" {
				tt.Errorf("reason = %q, want %q", got, "Evaluating for my team")
			}
			if got := rec.GetString("source"); got != "intro_modal" {
				tt.Errorf("source = %q, want %q", got, "intro_modal")
			}
			if got := rec.GetString("user_agent"); got != "PlanTestAgent/1.0" {
				tt.Errorf("user_agent = %q, want %q", got, "PlanTestAgent/1.0")
			}
		},
	}
	scenario.Test(t)
}

// TestDemoLead_MissingEmail confirms the handler rejects requests without an
// email. We can't follow up on a lead with no contact info, so this is the
// only hard validation gate.
func TestDemoLead_MissingEmail(t *testing.T) {
	app := setupDemoLeadTestApp(t)

	scenario := &tests.ApiScenario{
		Name:           "missing email returns 400",
		Method:         http.MethodPost,
		URL:            "/api/demo/lead",
		Body:            strings.NewReader(`{"email":"","reason":"hi","source":"intro_modal"}`),
		Headers:         map[string]string{"Content-Type": "application/json"},
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`"status":400`},
		TestAppFactory:  func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestDemoLead_MalformedEmail confirms basic email-format validation. A
// missing @ or domain is the most common shape of bot traffic; we want it
// rejected at the edge so the table doesn't fill with garbage.
func TestDemoLead_MalformedEmail(t *testing.T) {
	app := setupDemoLeadTestApp(t)

	scenario := &tests.ApiScenario{
		Name:           "malformed email returns 400",
		Method:         http.MethodPost,
		URL:            "/api/demo/lead",
		Body:            strings.NewReader(`{"email":"not-an-email","source":"intro_modal"}`),
		Headers:         map[string]string{"Content-Type": "application/json"},
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`"status":400`},
		TestAppFactory:  func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestDemoLead_OversizedReasonTruncated checks the lossy-by-design truncation:
// once the user has submitted, we'd rather store the first 2000 chars than
// lose the lead by rejecting it.
func TestDemoLead_OversizedReasonTruncated(t *testing.T) {
	app := setupDemoLeadTestApp(t)
	longReason := strings.Repeat("x", 3000)

	scenario := &tests.ApiScenario{
		Name:   "oversized reason is truncated to max 2000 chars",
		Method: http.MethodPost,
		URL:    "/api/demo/lead",
		Body: strings.NewReader(
			`{"email":"oversized@example.com","reason":"` + longReason + `","source":"intro_modal"}`,
		),
		Headers:        map[string]string{"Content-Type": "application/json"},
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			tt := t.(*testing.T)
			rec, err := app.FindFirstRecordByFilter(
				"demo_leads",
				"email = {:email}",
				dbx.Params{"email": "oversized@example.com"},
			)
			if err != nil {
				tt.Fatalf("lead row not created: %v", err)
			}
			if got := len(rec.GetString("reason")); got != 2000 {
				tt.Errorf("reason length = %d, want 2000", got)
			}
		},
	}
	scenario.Test(t)
}

// TestDemoLead_UnknownSourceCoerced confirms unknown source values fall back
// to "intro_modal" rather than rejecting. The source field is analytic-only;
// throwing away the lead over a typo is a worse trade than miscategorising it.
func TestDemoLead_UnknownSourceCoerced(t *testing.T) {
	app := setupDemoLeadTestApp(t)

	scenario := &tests.ApiScenario{
		Name:           "unknown source coerced to intro_modal",
		Method:         http.MethodPost,
		URL:            "/api/demo/lead",
		Body:           strings.NewReader(`{"email":"coerced@example.com","source":"garbage"}`),
		Headers:        map[string]string{"Content-Type": "application/json"},
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			tt := t.(*testing.T)
			rec, err := app.FindFirstRecordByFilter(
				"demo_leads",
				"email = {:email}",
				dbx.Params{"email": "coerced@example.com"},
			)
			if err != nil {
				tt.Fatalf("lead row not created: %v", err)
			}
			if got := rec.GetString("source"); got != "intro_modal" {
				tt.Errorf("source = %q, want intro_modal", got)
			}
		},
	}
	scenario.Test(t)
}

// TestDemoLead_MissingSourceCoerced confirms an entirely-missing source key
// also defaults to intro_modal. The intro_modal path is the most common
// caller, so it's the right default for malformed clients.
func TestDemoLead_MissingSourceCoerced(t *testing.T) {
	app := setupDemoLeadTestApp(t)

	scenario := &tests.ApiScenario{
		Name:           "missing source coerced to intro_modal",
		Method:         http.MethodPost,
		URL:            "/api/demo/lead",
		Body:           strings.NewReader(`{"email":"nosource@example.com"}`),
		Headers:        map[string]string{"Content-Type": "application/json"},
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			tt := t.(*testing.T)
			rec, err := app.FindFirstRecordByFilter(
				"demo_leads",
				"email = {:email}",
				dbx.Params{"email": "nosource@example.com"},
			)
			if err != nil {
				tt.Fatalf("lead row not created: %v", err)
			}
			if got := rec.GetString("source"); got != "intro_modal" {
				tt.Errorf("source = %q, want intro_modal", got)
			}
		},
	}
	scenario.Test(t)
}
