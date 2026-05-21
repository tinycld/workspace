package translate

import (
	"strings"
	"testing"
)

// A drive-file image src embeds when a resolver supplies the bytes — the
// editor stores /api/files/drive_items/<id>/<file> URLs, and the server
// flush wires a resolver so the docx carries the real image.
func TestPMJSONToDocx_DriveImageResolved(t *testing.T) {
	pngBytes := makePNGBytes(t)
	src := "http://localhost:7200/api/files/drive_items/abc123/photo_x7.png?token=stale"
	pmJSON := buildImageDocJSON(t, src)

	var gotID, gotFile string
	resolver := func(driveItemID, fileName string) ([]byte, error) {
		gotID = driveItemID
		gotFile = fileName
		return pngBytes, nil
	}

	docxBytes, warnings, err := PMJSONToDocxWithResolver(pmJSON, resolver)
	if err != nil {
		t.Fatalf("PMJSONToDocxWithResolver: %v", err)
	}
	if len(docxBytes) == 0 {
		t.Fatal("expected non-empty docx")
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %+v", warnings)
	}
	if gotID != "abc123" {
		t.Errorf("resolver got driveItemID %q, want abc123", gotID)
	}
	// The stale ?token is stripped; the file name comes through clean.
	if gotFile != "photo_x7.png" {
		t.Errorf("resolver got fileName %q, want photo_x7.png", gotFile)
	}
}

// Without a resolver, a drive-file src is rejected — preserving the
// data:-only contract for non-server callers (and surfacing a clear
// error instead of silently dropping the image).
func TestPMJSONToDocx_DriveImageNoResolverErrors(t *testing.T) {
	src := "/api/files/drive_items/abc123/photo.png"
	pmJSON := buildImageDocJSON(t, src)

	_, err := PMJSONToDocx(pmJSON)
	if err == nil {
		t.Fatal("expected error for drive src without resolver, got nil")
	}
	if !strings.Contains(err.Error(), "no resolver") {
		t.Errorf("expected 'no resolver' error, got %v", err)
	}
}

// A resolver failure aborts the flush rather than emitting a lossy docx,
// so the SaveCoordinator can retry.
func TestPMJSONToDocx_DriveImageResolverErrorAborts(t *testing.T) {
	src := "/api/files/drive_items/abc123/photo.png"
	pmJSON := buildImageDocJSON(t, src)

	resolver := func(_, _ string) ([]byte, error) {
		return nil, errFakeResolver
	}
	_, _, err := PMJSONToDocxWithResolver(pmJSON, resolver)
	if err == nil {
		t.Fatal("expected resolver error to propagate, got nil")
	}
	if !strings.Contains(err.Error(), "resolve drive image") {
		t.Errorf("expected wrapped resolve error, got %v", err)
	}
}

// An unsupported extension is dropped with a warning (not a hard error),
// matching the data: URI unsupported-type behaviour.
func TestPMJSONToDocx_DriveImageBadExtensionDropped(t *testing.T) {
	src := "/api/files/drive_items/abc123/diagram.svg"
	pmJSON := buildImageDocJSON(t, src)

	called := false
	resolver := func(_, _ string) ([]byte, error) {
		called = true
		return nil, nil
	}
	_, warnings, err := PMJSONToDocxWithResolver(pmJSON, resolver)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if called {
		t.Error("resolver should not be called for an unsupported extension")
	}
	if !hasWarning(warnings, WarningUnsupportedImageType) {
		t.Fatalf("expected WarningUnsupportedImageType, got %+v", warnings)
	}
}

func TestParseDriveFileSrc(t *testing.T) {
	cases := []struct {
		name           string
		src            string
		wantOK         bool
		wantID, wantFn string
	}{
		{"absolute with token", "http://h/api/files/drive_items/id1/a.png?token=x", true, "id1", "a.png"},
		{"relative", "/api/files/drive_items/id2/b_c.jpg", true, "id2", "b_c.jpg"},
		{"data uri", "data:image/png;base64,AAAA", false, "", ""},
		{"other url", "https://example.com/image.png", false, "", ""},
		{"missing file", "/api/files/drive_items/id3/", false, "", ""},
		{"nested path in file", "/api/files/drive_items/id4/sub/dir.png", false, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, fn, ok := parseDriveFileSrc(tc.src)
			if ok != tc.wantOK || id != tc.wantID || fn != tc.wantFn {
				t.Errorf("parseDriveFileSrc(%q) = (%q,%q,%v), want (%q,%q,%v)",
					tc.src, id, fn, ok, tc.wantID, tc.wantFn, tc.wantOK)
			}
		})
	}
}

var errFakeResolver = &resolverErr{}

type resolverErr struct{}

func (*resolverErr) Error() string { return "boom" }
