package text

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// TestRenderETag_DependsOnInputs verifies the ETag formula is
// deterministic for stable inputs and changes when any contributing
// component (drive_item id, updated timestamp, renderer version)
// changes. The handler's 304 fast path relies on this.
func TestRenderETag_DependsOnInputs(t *testing.T) {
	a := renderETag("rec1", "2026-01-01T00:00:00Z")
	b := renderETag("rec1", "2026-01-01T00:00:00Z")
	if a != b {
		t.Fatalf("renderETag must be deterministic: %q vs %q", a, b)
	}
	if a == renderETag("rec1", "2026-01-02T00:00:00Z") {
		t.Fatalf("renderETag must change when updated timestamp changes")
	}
	if a == renderETag("rec2", "2026-01-01T00:00:00Z") {
		t.Fatalf("renderETag must change when item id changes")
	}
	if !strings.HasPrefix(a, `"`) || !strings.HasSuffix(a, `"`) {
		t.Fatalf("renderETag must be a quoted strong validator: %q", a)
	}
}

func TestParseDriveFileURL(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		coll    string
		recID   string
		fileNm  string
		wantOK  bool
	}{
		{
			name:   "absolute https URL with token",
			in:     "https://app.example.com/api/files/drive_items/abc123/photo.png?token=xyz",
			coll:   "drive_items",
			recID:  "abc123",
			fileNm: "photo.png",
			wantOK: true,
		},
		{
			name:   "http URL no token",
			in:     "http://localhost:8090/api/files/drive_items/abc123/photo.png",
			coll:   "drive_items",
			recID:  "abc123",
			fileNm: "photo.png",
			wantOK: true,
		},
		{
			name:   "off-pattern path",
			in:     "https://x/foo/bar/baz",
			wantOK: false,
		},
		{
			name:   "missing filename segment",
			in:     "https://x/api/files/drive_items/abc123/",
			wantOK: false,
		},
		{
			name:   "empty string",
			in:     "",
			wantOK: false,
		},
		{
			name:   "data URI not handled here (translate layer skips it)",
			in:     "data:image/png;base64,abc",
			wantOK: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			coll, recID, fileNm, ok := parseDriveFileURL(tc.in)
			if ok != tc.wantOK {
				t.Fatalf("ok mismatch: got %v want %v (in=%q)", ok, tc.wantOK, tc.in)
			}
			if !tc.wantOK {
				return
			}
			if coll != tc.coll || recID != tc.recID || fileNm != tc.fileNm {
				t.Fatalf("parts mismatch: got (%q,%q,%q) want (%q,%q,%q)",
					coll, recID, fileNm, tc.coll, tc.recID, tc.fileNm)
			}
		})
	}
}

func TestMimeFromFilename(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"photo.png", "image/png"},
		{"PHOTO.PNG", "image/png"},
		{"a.jpg", "image/jpeg"},
		{"a.JPEG", "image/jpeg"},
		{"a.gif", "image/gif"},
		{"a.webp", "image/webp"},
		{"untyped", "image/png"},
		{"a.svg", "image/png"}, // SVG explicitly falls back; sanitizer would reject anyway
		{"", "image/png"},
	}
	for _, tc := range tests {
		got := mimeFromFilename(tc.in)
		if got != tc.want {
			t.Errorf("%q: got %q want %q", tc.in, got, tc.want)
		}
	}
}

// TestRender_RejectsNonDocxMime exercises the mime-type gate added
// to handleRender. A drive_item with `mime_type` set to anything
// other than the wordprocessingml docx mime must respond with a clean
// 400 — the original code dropped the bytes straight into
// DocxToPMJSON which surfaced as an opaque 500.
//
// The test wires the production `registerRenderAPI` against a
// tests.TestApp so the entire chain (route registration, auth
// middleware, share-role check, mime gate) is exercised in order.
// The share-role check passes because we seed an owner share for the
// authed user; the only reason the request fails is the mime gate.
func TestRender_RejectsNonDocxMime(t *testing.T) {
	app := setupAuthTestApp(t)
	registerRenderAPI(app)

	// Owner user with a share on the drive_item — passes the
	// resolveShareRole gate so the mime check is the only thing
	// standing between the request and a 200.
	user := mustCreateUser(t, app, "render-mime-test@example.com")
	item := seedDriveItemInOrg(t, app, "org1", "not-a-docx.png")
	item.Set("mime_type", "image/png")
	if err := app.Save(item); err != nil {
		t.Fatalf("save mime_type: %v", err)
	}
	userOrgID := seedUserOrg(t, app, user.Id, "org1")
	seedShare(t, app, item.Id, userOrgID, "owner")

	scenario := &tests.ApiScenario{
		Name:           "non-docx mime returns 400",
		Method:         http.MethodGet,
		URL:            "/api/text/render/" + item.Id,
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			// PocketBase capitalizes the first letter of the message
			// before serializing — match the capitalised form.
			"Not a docx",
		},
		Headers: map[string]string{
			"Authorization": userToken(t, app, user),
		},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestRender_RejectsEmptyMime guards the mime gate against
// drive_items where mime_type was never set (older import paths,
// manually-inserted rows, partial syncs). Empty string is not the
// docx mime, so the gate must reject — same 400 path as a mismatching
// non-empty value.
func TestRender_RejectsEmptyMime(t *testing.T) {
	app := setupAuthTestApp(t)
	registerRenderAPI(app)

	user := mustCreateUser(t, app, "render-mime-empty@example.com")
	item := seedDriveItemInOrg(t, app, "org1", "no-mime")
	item.Set("mime_type", "")
	if err := app.Save(item); err != nil {
		t.Fatalf("save mime_type: %v", err)
	}
	userOrgID := seedUserOrg(t, app, user.Id, "org1")
	seedShare(t, app, item.Id, userOrgID, "owner")

	scenario := &tests.ApiScenario{
		Name:           "empty mime returns 400",
		Method:         http.MethodGet,
		URL:            "/api/text/render/" + item.Id,
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Not a docx",
		},
		Headers: map[string]string{
			"Authorization": userToken(t, app, user),
		},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestRender_RejectsUnauthenticated guards the auth middleware: a
// request with no Authorization header must respond with 401 before
// the mime gate or share-role check even runs. Catches a regression
// where someone disables the BindFunc(requireAuthText) wiring.
func TestRender_RejectsUnauthenticated(t *testing.T) {
	app := setupAuthTestApp(t)
	registerRenderAPI(app)
	item := seedDriveItemInOrg(t, app, "org1", "anything.docx")
	scenario := &tests.ApiScenario{
		Name:           "no auth returns 401",
		Method:         http.MethodGet,
		URL:            "/api/text/render/" + item.Id,
		ExpectedStatus: http.StatusUnauthorized,
		ExpectedContent: []string{
			"Authentication required",
		},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestRender_RejectsUnshared guards the share-role check: an
// authenticated user with no share on the drive_item must get 403,
// not a 400/200/304 leaking item existence. The mime gate runs
// after the share check so a non-shared item with mismatching mime
// still surfaces as 403, never 400.
func TestRender_RejectsUnshared(t *testing.T) {
	app := setupAuthTestApp(t)
	registerRenderAPI(app)
	user := mustCreateUser(t, app, "render-mime-unshared@example.com")
	item := seedDriveItemInOrg(t, app, "org1", "secret.docx")
	item.Set("mime_type", docxMimeType)
	if err := app.Save(item); err != nil {
		t.Fatalf("save mime_type: %v", err)
	}
	// Deliberately omit seedShare so the user has no access.
	scenario := &tests.ApiScenario{
		Name:           "no share returns 403",
		Method:         http.MethodGet,
		URL:            "/api/text/render/" + item.Id,
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			"No access to this drive item",
		},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		Headers: map[string]string{
			"Authorization": userToken(t, app, user),
		},
	}
	scenario.Test(t)
}

// userToken mints a fresh auth token for the given record. Mirrors
// the helper PB tests typically reach for; copied here to avoid
// pulling in test fixtures that don't otherwise belong in this package.
func userToken(t *testing.T, app *tests.TestApp, user *core.Record) string {
	t.Helper()
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatalf("NewAuthToken: %v", err)
	}
	return "Bearer " + token
}

// Note on broader HTTP-level endpoint coverage:
//
// The PocketBase test harness used elsewhere in this package
// (bootstrap_test.go, persist_test.go in calc) requires constructing
// a full test app with collections seeded, then driving requests
// through Apis.ServeHTTP. The mime gate test above shows the pattern;
// the 401/403/200/304 status matrix is covered by the Playwright
// integration suite hitting a live server rather than via additional
// Go tests here.
