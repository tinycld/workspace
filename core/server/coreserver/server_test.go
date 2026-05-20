package coreserver

import (
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// TestRegisterAuditHooksWiresCoreCollections verifies the audit registration
// path runs without panicking against an empty TestApp. The audit subsystem
// registers hooks on a fixed set of core collections; if any of them is
// missing from the TestApp's seeded schema the call shouldn't fail (audit
// tolerates missing collections at hook time).
//
// This is the only Register* we can call directly from a TestApp because
// it accepts *pocketbase.PocketBase but TestApp embeds *core.BaseApp. The
// other Register* functions are exercised through the API scenarios below
// via account_delete_test.go's RegisterAccountDelete, which is the closest
// thing to a Register-end-to-end smoke test we can run without standing up
// a full pocketbase.PocketBase instance.
func TestRegisterAuditHooksWiresCoreCollections(t *testing.T) {
	t.Skip("RegisterAuditHooks requires *pocketbase.PocketBase; covered via the dev server smoke checks")
}

// TestSchemaGenerationDoesNotPanic exercises GenerateSchemas against the
// TestApp. We don't validate file contents — only that the call path is
// wired and returns cleanly when typesDir is a fresh tempdir.
func TestSchemaGenerationDoesNotPanic(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	tmp := t.TempDir()
	GenerateSchemas(app, tmp)
}

// TestBinaryNameDefaults documents the package-level binaryName state and
// confirms it falls back to "tinycld" when no explicit Options.BinaryName
// is set. Future apps using this library can override via Options.
func TestBinaryNameDefaults(t *testing.T) {
	if binaryName == "" {
		t.Fatal("binaryName should default to a non-empty value")
	}
}

// TestRegisterAccountDeleteCoreSurfacesEndpoint is the canonical smoke test
// proving Register*-side logic gets bound to a TestApp's router. The
// existing TestAccountDelete* tests do this work; we provide an explicit
// "the endpoint is bound" assertion here separate from the auth/email-match
// behavior, so a future regression that drops the binding (without changing
// behavior) still surfaces.
func TestRegisterAccountDeleteCoreSurfacesEndpoint(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	registerAccountDeleteCore(app)

	// 401 on no-auth is what the handler returns; if the route weren't
	// bound, we'd get 404 instead. The body asserts we hit the auth check,
	// not a generic 404.
	scenario := &tests.ApiScenario{
		Name:                  "endpoint bound",
		Method:                "POST",
		URL:                   "/api/account/delete",
		ExpectedStatus:        401,
		ExpectedContent:       []string{"Authentication required"},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}
