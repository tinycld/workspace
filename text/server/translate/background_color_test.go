package translate

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// mustBuildMinimalDocxWithRunProps builds the smallest valid .docx
// containing a single paragraph with one run, whose rPr is the
// caller-supplied XML fragment. Used to exercise individual
// run-property parsers (color, shd, highlight, …) without needing
// a real Word-authored fixture for each.
func mustBuildMinimalDocxWithRunProps(t *testing.T, rPrXML, text string) []byte {
	t.Helper()
	docXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:body>` +
		`<w:p>` +
		`<w:r><w:rPr>` + rPrXML + `</w:rPr>` +
		`<w:t xml:space="preserve">` + text + `</w:t></w:r></w:p>` +
		`</w:body></w:document>`
	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="xml" ContentType="application/xml"/>` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
		`</Types>`
	rootRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
		`</Relationships>`
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	files := []struct{ name, body string }{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", rootRels},
		{"word/document.xml", docXML},
	}
	for _, f := range files {
		w, err := zw.Create(f.name)
		if err != nil {
			t.Fatalf("zip create %q: %v", f.name, err)
		}
		if _, err := w.Write([]byte(f.body)); err != nil {
			t.Fatalf("zip write %q: %v", f.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// firstRunMarks finds the first run of the first paragraph and returns
// its marks. Convenience for run-property tests: every test below sets
// up one paragraph + one run.
func firstRunMarks(t *testing.T, pmJSON []byte) []PMMark {
	t.Helper()
	var root PMNode
	if err := json.Unmarshal(pmJSON, &root); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(root.Content) == 0 {
		t.Fatalf("doc has no content")
	}
	para := root.Content[0]
	if len(para.Content) == 0 {
		t.Fatalf("paragraph has no runs")
	}
	return para.Content[0].Marks
}

// firstTextStyleAttrs returns the Attrs map of the first textStyle
// mark on the first run, or nil if no such mark exists.
func firstTextStyleAttrs(marks []PMMark) map[string]any {
	for _, m := range marks {
		if m.Type == MarkTypeTextStyle {
			return m.Attrs
		}
	}
	return nil
}

// TestParseRunProperties_ShdBackgroundColor verifies <w:shd w:fill=…>
// surfaces onto textStyle.backgroundColor. The fill is hex
// (capitalized to match the parser's "always upper" convention).
func TestParseRunProperties_ShdBackgroundColor(t *testing.T) {
	docx := mustBuildMinimalDocxWithRunProps(
		t,
		`<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>`,
		"highlighted",
	)
	pmJSON, _, err := DocxToPMJSON(docx)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	attrs := firstTextStyleAttrs(firstRunMarks(t, pmJSON))
	if attrs == nil {
		t.Fatalf("expected a textStyle mark, got none. pm=%s", pmJSON)
	}
	if attrs["backgroundColor"] != "#FFFF00" {
		t.Fatalf("expected backgroundColor=#FFFF00, got %v", attrs["backgroundColor"])
	}
}

// TestParseRunProperties_ShdAutoFill drops the attr when fill="auto"
// — that means "follow theme default" in OOXML, no override.
func TestParseRunProperties_ShdAutoFill(t *testing.T) {
	docx := mustBuildMinimalDocxWithRunProps(
		t,
		`<w:shd w:val="clear" w:color="auto" w:fill="auto"/>`,
		"x",
	)
	pmJSON, _, err := DocxToPMJSON(docx)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	attrs := firstTextStyleAttrs(firstRunMarks(t, pmJSON))
	if attrs != nil {
		if _, has := attrs["backgroundColor"]; has {
			t.Fatalf("expected no backgroundColor for auto fill, got %v", attrs)
		}
	}
}

// TestParseRunProperties_HighlightNamedColor verifies the legacy
// <w:highlight w:val="yellow"/> form maps onto a hex backgroundColor.
func TestParseRunProperties_HighlightNamedColor(t *testing.T) {
	docx := mustBuildMinimalDocxWithRunProps(
		t,
		`<w:highlight w:val="yellow"/>`,
		"x",
	)
	pmJSON, _, err := DocxToPMJSON(docx)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	attrs := firstTextStyleAttrs(firstRunMarks(t, pmJSON))
	if attrs == nil || attrs["backgroundColor"] != "#FFFF00" {
		t.Fatalf("expected backgroundColor=#FFFF00 for highlight=yellow, got %v", attrs)
	}
}

// TestParseRunProperties_HighlightUnknownName drops the attr for
// names outside the OOXML fixed palette ("none" or vendor variants).
func TestParseRunProperties_HighlightUnknownName(t *testing.T) {
	for _, name := range []string{"none", "puce", ""} {
		t.Run(name, func(t *testing.T) {
			docx := mustBuildMinimalDocxWithRunProps(
				t,
				`<w:highlight w:val="`+name+`"/>`,
				"x",
			)
			pmJSON, _, err := DocxToPMJSON(docx)
			if err != nil {
				t.Fatalf("DocxToPMJSON: %v", err)
			}
			attrs := firstTextStyleAttrs(firstRunMarks(t, pmJSON))
			if attrs != nil {
				if _, has := attrs["backgroundColor"]; has {
					t.Fatalf("expected no backgroundColor for highlight=%q, got %v", name, attrs)
				}
			}
		})
	}
}

// TestParseRunProperties_ShdWinsOverHighlight asserts that when both
// elements appear, the more precise w:shd wins (Word emits them in
// either order, but w:shd is the source of truth for hex precision).
func TestParseRunProperties_ShdWinsOverHighlight(t *testing.T) {
	// shd first, highlight second — highlight must NOT overwrite.
	docx := mustBuildMinimalDocxWithRunProps(
		t,
		`<w:shd w:val="clear" w:color="auto" w:fill="00FF00"/>`+
			`<w:highlight w:val="yellow"/>`,
		"x",
	)
	pmJSON, _, err := DocxToPMJSON(docx)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	attrs := firstTextStyleAttrs(firstRunMarks(t, pmJSON))
	if attrs == nil || attrs["backgroundColor"] != "#00FF00" {
		t.Fatalf("expected shd green to win, got %v", attrs)
	}
}

// TestRoundTrip_BackgroundColor verifies a textStyle.backgroundColor
// attr survives PM → DOCX → PM. The import path was tested above with
// hand-built XML; this test exercises the EXPORT (post-process
// rewriter that injects <w:shd>) by running the full
// PMJSONToDocx → DocxToPMJSON loop.
func TestRoundTrip_BackgroundColor(t *testing.T) {
	pmIn := []byte(`{"type":"doc","content":[
		{"type":"paragraph","content":[
			{"type":"text","text":"highlighted","marks":[
				{"type":"textStyle","attrs":{"backgroundColor":"#FFFF00"}}
			]}
		]}
	]}`)

	docxBytes, err := PMJSONToDocx(pmIn)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	pmOutJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	attrs := firstTextStyleAttrs(firstRunMarks(t, pmOutJSON))
	if attrs == nil || attrs["backgroundColor"] != "#FFFF00" {
		t.Fatalf("backgroundColor lost round-trip; got attrs=%v\npmOut=%s", attrs, pmOutJSON)
	}
}

// TestRoundTrip_BackgroundColorWithBoldAndCode confirms the markers
// nest correctly when multiple inline marks coexist on the same run.
// We expect bold + code + bg-color to all survive (the bg-color
// rewriter runs AFTER code-marks so the inner <w:rPr> already has
// the rStyle injection by the time we add <w:shd>).
func TestRoundTrip_BackgroundColorWithBoldAndCode(t *testing.T) {
	pmIn := []byte(`{"type":"doc","content":[
		{"type":"paragraph","content":[
			{"type":"text","text":"X","marks":[
				{"type":"bold"},
				{"type":"code"},
				{"type":"textStyle","attrs":{"backgroundColor":"#00FF00"}}
			]}
		]}
	]}`)

	docxBytes, err := PMJSONToDocx(pmIn)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	pmOutJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	marks := firstRunMarks(t, pmOutJSON)
	// Confirm bold + code marks both survived (they were already
	// round-trip-tested elsewhere, but checking here pins the
	// "marker layering didn't break anything" property).
	hasBold, hasCode := false, false
	for _, m := range marks {
		if m.Type == MarkTypeBold {
			hasBold = true
		}
		if m.Type == MarkTypeCode {
			hasCode = true
		}
	}
	if !hasBold {
		t.Errorf("bold lost round-trip; marks=%v", marks)
	}
	if !hasCode {
		t.Errorf("code lost round-trip; marks=%v", marks)
	}
	attrs := firstTextStyleAttrs(marks)
	if attrs == nil || attrs["backgroundColor"] != "#00FF00" {
		t.Errorf("backgroundColor lost round-trip; attrs=%v", attrs)
	}
}

// TestHighlightNameToHex pins the OOXML named-color map. Each name in
// the OOXML ST_HighlightColor enumeration maps to a stable hex string;
// unknown names return "".
func TestHighlightNameToHex(t *testing.T) {
	cases := map[string]string{
		"yellow":    "#FFFF00",
		"Yellow":    "#FFFF00", // case-insensitive
		"green":     "#00FF00",
		"darkGray":  "#808080",
		"lightGray": "#C0C0C0",
		"black":     "#000000",
		"white":     "#FFFFFF",
		"none":      "",
		"":          "",
		"puce":      "",
	}
	for in, want := range cases {
		got := highlightNameToHex(in)
		if got != want {
			t.Errorf("highlightNameToHex(%q) = %q, want %q", in, got, want)
		}
	}
	// Sanity: every OOXML name returns a 6-digit uppercase hex.
	for _, name := range []string{
		"black", "blue", "cyan", "darkBlue", "darkCyan", "darkGray",
		"darkGreen", "darkMagenta", "darkRed", "darkYellow", "green",
		"lightGray", "magenta", "red", "white", "yellow",
	} {
		hex := highlightNameToHex(name)
		if len(hex) != 7 || !strings.HasPrefix(hex, "#") {
			t.Errorf("highlightNameToHex(%q) = %q, want 7-char #hex", name, hex)
		}
	}
}
