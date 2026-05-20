package coreserver

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupPool creates a releasesDir with a _static/<prefix>/<file> entry
// containing the given content, mirroring what the entrypoint produces.
func setupPool(t *testing.T, prefix, file, content string) string {
	t.Helper()
	releasesDir := t.TempDir()
	dir := filepath.Join(releasesDir, "_static", prefix)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return releasesDir
}

func runPoolScenario(t *testing.T, releasesDir, prefix, cacheControl string, scenario *tests.ApiScenario) {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.RouterGroup.GET("/"+prefix+"/{path...}", PoolAssets(releasesDir, prefix, cacheControl))
		return e.Next()
	})

	scenario.TestAppFactory = func(_ testing.TB) *tests.TestApp { return app }
	scenario.DisableTestAppCleanup = true
	scenario.Test(t)
}

func TestPoolAssets_ServesExistingFileWithImmutableCache(t *testing.T) {
	releasesDir := setupPool(t, "_expo/static/js/web", "bundle-abc.js", "console.log('hi')")

	runPoolScenario(t, releasesDir, "_expo/static", "public, max-age=31536000, immutable", &tests.ApiScenario{
		Name:            "serves hashed bundle from pool with immutable cache",
		Method:          http.MethodGet,
		URL:             "/_expo/static/js/web/bundle-abc.js",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"console.log"},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			cc := res.Header.Get("Cache-Control")
			if cc != "public, max-age=31536000, immutable" {
				t.Errorf("Cache-Control = %q", cc)
			}
		},
	})
}

func TestPoolAssets_404OnMissingFile(t *testing.T) {
	releasesDir := setupPool(t, "_expo/static/js/web", "bundle-abc.js", "x")

	runPoolScenario(t, releasesDir, "_expo/static", "public, max-age=31536000, immutable", &tests.ApiScenario{
		Name:            "404 when chunk no longer in pool",
		Method:          http.MethodGet,
		URL:             "/_expo/static/js/web/bundle-zzz.js",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"status":404`},
	})
}

func TestPoolAssets_ServesAssetsWithShortCache(t *testing.T) {
	releasesDir := setupPool(t, "assets", "app-icon.png", "PNGDATA")

	runPoolScenario(t, releasesDir, "assets", "public, max-age=300", &tests.ApiScenario{
		Name:            "serves /assets/ with short cache (mixed-hash subtree)",
		Method:          http.MethodGet,
		URL:             "/assets/app-icon.png",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"PNGDATA"},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			cc := res.Header.Get("Cache-Control")
			if cc != "public, max-age=300" {
				t.Errorf("Cache-Control = %q", cc)
			}
		},
	})
}

// Compile-time assertion that the handler returns the expected signature.
var _ func(*core.RequestEvent) error = PoolAssets("", "", "")
