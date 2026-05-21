package translate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestDocxToPMJSON_FeatureTestFixture parses the user-authored
// feature-test.docx fixture and verifies the result against
// feature-test.expected.json. The expected JSON is generated once
// (the first run writes feature-test.expected.json.generated and
// fails) and then reviewed by hand before committing.
func TestDocxToPMJSON_FeatureTestFixture(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "tests", "assets", "feature-test.docx")
	expectedPath := filepath.Join("..", "..", "tests", "assets", "feature-test.expected.json")

	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	expected, err := os.ReadFile(expectedPath)
	if err != nil {
		actual, _, parseErr := DocxToPMJSON(fixture)
		if parseErr != nil {
			t.Fatalf("parse fixture: %v", parseErr)
		}
		writePath := expectedPath + ".generated"
		_ = os.WriteFile(writePath, prettifyJSON(actual), 0o644)
		t.Fatalf(
			"expected JSON missing at %s.\n"+
				"Wrote actual output to %s — REVIEW BY HAND, then move to %s once correct",
			expectedPath, writePath, expectedPath,
		)
	}

	actual, warnings, err := DocxToPMJSON(fixture)
	if err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(warnings) > 0 {
		t.Errorf("unexpected warnings parsing feature-test.docx: %+v", warnings)
	}

	var actualNode, expectedNode PMNode
	if err := json.Unmarshal(actual, &actualNode); err != nil {
		t.Fatalf("unmarshal actual: %v", err)
	}
	if err := json.Unmarshal(expected, &expectedNode); err != nil {
		t.Fatalf("unmarshal expected: %v", err)
	}
	actualRe, _ := json.MarshalIndent(actualNode, "", "  ")
	expectedRe, _ := json.MarshalIndent(expectedNode, "", "  ")
	if string(actualRe) != string(expectedRe) {
		t.Errorf("DocxToPMJSON output diverges from expected.\nDiff written to %s.diff", expectedPath)
		_ = os.WriteFile(expectedPath+".diff", actualRe, 0o644)
	}
}

// TestDocxToPMJSON_NotADocx returns an error (not a panic) when the
// bytes aren't a valid ZIP archive.
func TestDocxToPMJSON_NotADocx(t *testing.T) {
	_, _, err := DocxToPMJSON([]byte("not a docx file"))
	if err == nil {
		t.Errorf("expected error for non-docx bytes, got nil")
	}
}

// TestResolveWrap covers the matrix of <wp:anchor> / wrap*
// presence × <wp:positionH><wp:align> that decides the PM image's
// `wrap` attribute. Locks in the mapping so a parser-side refactor
// can't silently flip floated images back to inline.
func TestResolveWrap(t *testing.T) {
	cases := []struct {
		name            string
		hasAnchor       bool
		hasWrap         bool
		hasTopAndBottom bool
		align           string
		want            string
	}{
		{"inline drawing, no anchor", false, false, false, "", ""},
		{"anchor without wrap (wrapNone)", true, false, false, "left", ""},
		{"anchor with wrap, align=left", true, true, false, "left", "left"},
		{"anchor with wrap, align=right", true, true, false, "right", "right"},
		{"anchor with wrap, align=center -> left", true, true, false, "center", "left"},
		{"anchor with wrap, no align -> left", true, true, false, "", "left"},
		// Word's "Top and Bottom" wrap maps to break, regardless of
		// whether a sibling wrap*Square/Tight/Through also appears.
		{"anchor + topAndBottom -> break", true, false, true, "", "break"},
		{"anchor + topAndBottom wins over square", true, true, true, "left", "break"},
		{"anchor + topAndBottom wins over square (right)", true, true, true, "right", "break"},
		// topAndBottom without an anchor is a malformed input — no
		// floating happens, so we return "" rather than "break".
		{"no anchor + topAndBottom -> empty", false, false, true, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := resolveWrap(c.hasAnchor, c.hasWrap, c.hasTopAndBottom, c.align)
			if got != c.want {
				t.Errorf("resolveWrap(anchor=%v, wrap=%v, topAndBottom=%v, align=%q) = %q, want %q",
					c.hasAnchor, c.hasWrap, c.hasTopAndBottom, c.align, got, c.want)
			}
		})
	}
}

// TestParseComments unit-checks the comments.xml parser without going
// through the docx zip path — runs the helper directly on a literal
// XML body so we lock in the per-comment author/text/date extraction.
func TestParseComments(t *testing.T) {
	xmlIn := []byte(`<?xml version="1.0" encoding="UTF-8"?>` +
		`<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:comment w:id="0" w:author="Bob" w:date="2026-05-15T10:00:00Z">` +
		`<w:p><w:r><w:t>hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>` +
		`</w:comment>` +
		`<w:comment w:id="1" w:author="Carol">` +
		`<w:p><w:r><w:t>second</w:t></w:r></w:p>` +
		`</w:comment>` +
		`</w:comments>`)
	got := parseComments(xmlIn)
	if got["0"].Author != "Bob" {
		t.Errorf("id=0 author: %+v", got["0"])
	}
	if got["0"].Text != "hello world" {
		t.Errorf("id=0 text: %q", got["0"].Text)
	}
	if got["0"].Date != "2026-05-15T10:00:00Z" {
		t.Errorf("id=0 date: %q", got["0"].Date)
	}
	if got["1"].Text != "second" {
		t.Errorf("id=1 text: %q", got["1"].Text)
	}
}

// TestParseFootnoteLikeBodies covers the shared footnote / endnote XML
// shape — reserved separators are skipped, user notes round-trip text.
func TestParseFootnoteLikeBodies(t *testing.T) {
	xmlIn := []byte(`<?xml version="1.0" encoding="UTF-8"?>` +
		`<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
		`<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
		`<w:footnote w:id="1"><w:p><w:r><w:t>note body</w:t></w:r></w:p></w:footnote>` +
		`</w:footnotes>`)
	got := parseFootnoteLikeBodies(xmlIn, "footnote")
	if len(got) != 1 {
		t.Errorf("expected 1 user footnote, got %d: %v", len(got), got)
	}
	if got["1"] != "note body" {
		t.Errorf("id=1 body: %q", got["1"])
	}
	if _, hasSep := got["-1"]; hasSep {
		t.Errorf("separator note leaked into output")
	}
}

// prettifyJSON re-marshals JSON with 2-space indentation so the
// generated file is reviewable.
func prettifyJSON(b []byte) []byte {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return b
	}
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return b
	}
	return out
}
