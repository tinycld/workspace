package coreserver

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupCurrentRelease creates a temp directory with a current/release-id.txt file.
func setupCurrentRelease(t *testing.T, releaseId string) string {
	t.Helper()
	releasesDir := t.TempDir()
	currentDir := filepath.Join(releasesDir, "current")
	if err := os.MkdirAll(currentDir, 0o755); err != nil {
		t.Fatalf("MkdirAll current: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(currentDir, "release-id.txt"),
		[]byte(releaseId+"\n"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile release-id.txt: %v", err)
	}
	return releasesDir
}

// runVersionHandlerScenario boots a TestApp with the VersionHandler
// mounted at GET /api/version and drives the given ApiScenario.
func runVersionHandlerScenario(t *testing.T, releasesDir string, scenario *tests.ApiScenario) {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.RouterGroup.GET("/api/version", VersionHandler(releasesDir))
		return e.Next()
	})

	scenario.TestAppFactory = func(_ testing.TB) *tests.TestApp { return app }
	scenario.DisableTestAppCleanup = true
	scenario.Test(t)
}

func TestVersionHandler_ReturnsCurrentReleaseId(t *testing.T) {
	releaseId := "2026-05-01-143022-abc1234"
	releasesDir := setupCurrentRelease(t, releaseId)

	runVersionHandlerScenario(t, releasesDir, &tests.ApiScenario{
		Name:            "returns current release id with no-store cache",
		Method:          http.MethodGet,
		URL:             "/api/version",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"releaseId":"` + releaseId + `"`},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			cc := res.Header.Get("Cache-Control")
			if cc != "no-store" {
				t.Errorf("Cache-Control = %q, want %q", cc, "no-store")
			}
		},
	})
}

func TestVersionHandler_ErrorsWhenMissing(t *testing.T) {
	// Empty temp dir with no current/release-id.txt
	releasesDir := t.TempDir()

	runVersionHandlerScenario(t, releasesDir, &tests.ApiScenario{
		Name:            "returns 500 when release-id.txt is missing",
		Method:          http.MethodGet,
		URL:             "/api/version",
		ExpectedStatus:  http.StatusInternalServerError,
		ExpectedContent: []string{`"status":500`},
	})
}

// Compile-time assertion: VersionHandler must have the correct signature.
// This is intentionally unreachable code — the blank identifier assignment
// forces the compiler to type-check the expression without running it.
var _ func(*core.RequestEvent) error = VersionHandler("")
