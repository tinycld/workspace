package translate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDocxToHTML_ParityWithTwoStepPath asserts that DocxToHTML
// produces the same HTML as the old DocxToPMJSON + PMJSONToHTML
// pipeline for the feature-test.docx fixture. This is the
// load-bearing guarantee of the render-path refactor: byte-identical
// output, just without the JSON round-trip.
//
// If the two paths ever diverge, the new path has a regression in
// one of the two extracted helpers (parseDocxToPMNode or
// pmNodeToHTML) — both should be pure refactors.
func TestDocxToHTML_ParityWithTwoStepPath(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "tests", "assets", "feature-test.docx")
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	opts := HTMLRenderOpts{Images: ImageModeURL}

	pmJSON, _, err := DocxToPMJSON(fixture)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	twoStep, err := PMJSONToHTML(pmJSON, opts)
	if err != nil {
		t.Fatalf("PMJSONToHTML: %v", err)
	}

	direct, _, err := DocxToHTML(fixture, opts)
	if err != nil {
		t.Fatalf("DocxToHTML: %v", err)
	}

	if direct != twoStep {
		t.Errorf("DocxToHTML output diverges from DocxToPMJSON+PMJSONToHTML.\n"+
			"direct len=%d, twoStep len=%d", len(direct), len(twoStep))
	}
}

// TestDocxToHTML_NotADocx surfaces invalid input as an error rather
// than a panic — matches DocxToPMJSON's contract since both share
// parseDocxToPMNode.
func TestDocxToHTML_NotADocx(t *testing.T) {
	_, _, err := DocxToHTML([]byte("not a docx file"), HTMLRenderOpts{Images: ImageModeURL})
	if err == nil {
		t.Errorf("expected error for non-docx bytes, got nil")
	}
}

// TestDocxToHTML_FixtureShape is a smoke test confirming the new
// entry point emits the expected wrapper + at least one tinycld-text
// class on the feature-test fixture. The full HTML structure is
// pinned by pm_to_html_test.go via PMJSONToHTML; this test exists so
// "DocxToHTML returns sensible output for a real docx" is a
// dedicated assertion.
func TestDocxToHTML_FixtureShape(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "tests", "assets", "feature-test.docx")
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	html, warnings, err := DocxToHTML(fixture, HTMLRenderOpts{Images: ImageModeURL})
	if err != nil {
		t.Fatalf("DocxToHTML: %v", err)
	}
	if !strings.HasPrefix(html, `<article class="tinycld-text">`) {
		t.Errorf("expected <article> wrapper, got prefix: %q", html[:min(60, len(html))])
	}
	if !strings.HasSuffix(html, `</article>`) {
		t.Errorf("expected </article> terminator, got suffix: %q", html[max(0, len(html)-30):])
	}
	if !strings.Contains(html, "tinycld-text-p") {
		t.Errorf("expected at least one paragraph class in fixture output")
	}
	if len(warnings) > 0 {
		t.Errorf("unexpected warnings parsing feature-test.docx: %+v", warnings)
	}
}
