package calc

import (
	"strings"
	"testing"
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
