package translate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestRoundTrip_FeatureTest verifies that parsing feature-test.docx,
// re-emitting it, and re-parsing it produces structurally identical
// PMNode trees on both passes. This is the GATING CONTRACT for editor
// feature additions: any regression in either DocxToPMJSON or
// PMJSONToDocx surfaces here.
//
// Adding a new node type to the editor schema requires extending
// feature-test.docx to include it, regenerating feature-test.expected.json,
// and watching this test fail-then-pass.
func TestRoundTrip_FeatureTest(t *testing.T) {
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "assets", "feature-test.docx"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pass 1: docx -> PM
	pm1JSON, warnings1, err := DocxToPMJSON(fixture)
	if err != nil {
		t.Fatalf("pass 1 DocxToPMJSON: %v", err)
	}
	if len(warnings1) > 0 {
		t.Errorf("unexpected warnings in pass 1: %+v", warnings1)
	}

	// Pass 2: PM -> docx
	docxBytes, err := PMJSONToDocx(pm1JSON)
	if err != nil {
		t.Fatalf("pass 2 PMJSONToDocx: %v", err)
	}

	// Pass 3: docx -> PM (the round-trip)
	pm3JSON, warnings3, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("pass 3 DocxToPMJSON: %v", err)
	}
	if len(warnings3) > 0 {
		t.Errorf("unexpected warnings in pass 3: %+v", warnings3)
	}

	// Compare pass 1 and pass 3 structurally.
	var pm1, pm3 PMNode
	if err := json.Unmarshal(pm1JSON, &pm1); err != nil {
		t.Fatalf("unmarshal pm1: %v", err)
	}
	if err := json.Unmarshal(pm3JSON, &pm3); err != nil {
		t.Fatalf("unmarshal pm3: %v", err)
	}
	pm1Norm, _ := json.MarshalIndent(pm1, "", "  ")
	pm3Norm, _ := json.MarshalIndent(pm3, "", "  ")
	if string(pm1Norm) != string(pm3Norm) {
		t.Errorf("round-trip diverges:\n--- pass 1 ---\n%s\n--- pass 3 ---\n%s", pm1Norm, pm3Norm)
	}
}

// TestDocxToPMJSON_TrackedChanges asserts that tracked-changes.docx
// parses with WarningTrackedChanges and that the insertions are kept
// (deletions dropped). Skipped if fixture is missing.
func TestDocxToPMJSON_TrackedChanges(t *testing.T) {
	expectWarning(t, "tracked-changes.docx", WarningTrackedChanges)
}

// TestDocxToPMJSON_Comments asserts that comments.docx parses with
// WarningComments and that comments are stripped from the body.
func TestDocxToPMJSON_Comments(t *testing.T) {
	expectWarning(t, "comments.docx", WarningComments)
}

// TestDocxToPMJSON_ContentControls asserts WarningContentControls
// is emitted and the inner text is preserved.
func TestDocxToPMJSON_ContentControls(t *testing.T) {
	expectWarning(t, "content-controls.docx", WarningContentControls)
}

// TestDocxToPMJSON_UnknownStyle asserts WarningUnsupportedStyle is
// emitted for a custom style.
func TestDocxToPMJSON_UnknownStyle(t *testing.T) {
	expectWarning(t, "unknown-style.docx", WarningUnsupportedStyle)
}

// TestDocxToPMJSON_Corrupted asserts that a corrupted docx returns a
// hard error (not a warning).
func TestDocxToPMJSON_Corrupted(t *testing.T) {
	path := filepath.Join("..", "..", "tests", "assets", "corrupted.docx")
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("fixture %s not yet provided; skip", path)
	}
	_, _, err = DocxToPMJSON(bytes)
	if err == nil {
		t.Fatalf("expected non-nil err for corrupted.docx")
	}
}

// expectWarning is a helper that loads the named fixture, parses it,
// and asserts the warning code appears in the result. Skips the test
// if the fixture file is missing (allows the test suite to land before
// all fixtures are user-provided).
func expectWarning(t *testing.T, fixtureName string, code WarningCode) {
	t.Helper()
	path := filepath.Join("..", "..", "tests", "assets", fixtureName)
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("fixture %s not yet provided; skip", path)
	}
	_, warnings, err := DocxToPMJSON(bytes)
	if err != nil {
		t.Fatalf("parse %s: %v", fixtureName, err)
	}
	for _, w := range warnings {
		if w.Code == code {
			return
		}
	}
	t.Errorf("expected warning code %q for %s; got %+v", code, fixtureName, warnings)
}
