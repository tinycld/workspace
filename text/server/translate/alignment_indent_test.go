package translate

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestPMJSONToDocx_AlignmentRoundTrip generates a doc with one
// paragraph per alignment value, round-trips through DOCX bytes,
// and asserts every paragraph's textAlign attr survives unchanged.
// Left alignment is encoded as the absence of a textAlign attr —
// it's the schema default; we verify the parser does NOT add a
// textAlign attr for the unaligned paragraph.
func TestPMJSONToDocx_AlignmentRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type:    NodeTypeParagraph,
				Content: []PMNode{{Type: NodeTypeText, Text: "left default"}},
			},
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"textAlign": "center"},
				Content: []PMNode{{Type: NodeTypeText, Text: "center"}},
			},
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"textAlign": "right"},
				Content: []PMNode{{Type: NodeTypeText, Text: "right"}},
			},
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"textAlign": "justify"},
				Content: []PMNode{{Type: NodeTypeText, Text: "justify"}},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 4 {
		t.Fatalf("expected 4 paragraphs, got %d", len(parsed.Content))
	}

	cases := []struct {
		idx        int
		wantAlign  string
		wantHasKey bool
	}{
		{0, "", false},
		{1, "center", true},
		{2, "right", true},
		{3, "justify", true},
	}
	for _, c := range cases {
		p := parsed.Content[c.idx]
		if p.Type != NodeTypeParagraph {
			t.Errorf("idx %d: expected paragraph, got %q", c.idx, p.Type)
			continue
		}
		got, ok := p.Attrs["textAlign"].(string)
		if c.wantHasKey {
			if !ok {
				t.Errorf("idx %d: expected textAlign=%q, missing attr", c.idx, c.wantAlign)
				continue
			}
			if got != c.wantAlign {
				t.Errorf("idx %d: expected textAlign=%q, got %q", c.idx, c.wantAlign, got)
			}
		} else if ok {
			t.Errorf("idx %d: expected no textAlign attr, got %q", c.idx, got)
		}
	}
}

// TestPMJSONToDocx_IndentRoundTrip checks that indent levels 0..3
// survive PM -> docx -> PM. Level 0 is the schema default and
// should arrive back without an indent attr at all; levels 1..3
// should round-trip exactly.
func TestPMJSONToDocx_IndentRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "no indent"}}},
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"indent": float64(1)},
				Content: []PMNode{{Type: NodeTypeText, Text: "indent 1"}},
			},
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"indent": float64(2)},
				Content: []PMNode{{Type: NodeTypeText, Text: "indent 2"}},
			},
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"indent": float64(3)},
				Content: []PMNode{{Type: NodeTypeText, Text: "indent 3"}},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	want := []int{0, 1, 2, 3}
	for i, w := range want {
		p := parsed.Content[i]
		if p.Type != NodeTypeParagraph {
			t.Errorf("idx %d: expected paragraph, got %q", i, p.Type)
			continue
		}
		got, ok := p.Attrs["indent"].(float64)
		if w == 0 {
			if ok {
				t.Errorf("idx %d: expected no indent attr, got %v", i, got)
			}
			continue
		}
		if !ok {
			t.Errorf("idx %d: expected indent=%d, missing attr", i, w)
			continue
		}
		if int(got) != w {
			t.Errorf("idx %d: expected indent=%d, got %v", i, w, got)
		}
	}
}

// TestPMJSONToDocx_AlignmentPlusIndent verifies a paragraph can
// carry BOTH textAlign and indent without either dropping. This is
// the realistic case (Word writes pPr with both child elements
// commonly) so the round-trip must keep them paired.
func TestPMJSONToDocx_AlignmentPlusIndent(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeParagraph,
				Attrs: map[string]any{
					"textAlign": "right",
					"indent":    float64(2),
				},
				Content: []PMNode{{Type: NodeTypeText, Text: "right + indent 2"}},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 1 {
		t.Fatalf("expected 1 paragraph, got %d", len(parsed.Content))
	}
	p := parsed.Content[0]
	align, _ := p.Attrs["textAlign"].(string)
	if align != "right" {
		t.Errorf("expected textAlign=right, got %q", align)
	}
	indent, _ := p.Attrs["indent"].(float64)
	if int(indent) != 2 {
		t.Errorf("expected indent=2, got %v", indent)
	}
}

// TestPMJSONToDocx_HeadingAlignmentIndent confirms the same attrs
// also work on headings, not just paragraphs (the editor wires
// TextAlign to both node types and the importer treats them as a
// pair via assembleParagraph's heading branch).
func TestPMJSONToDocx_HeadingAlignmentIndent(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeHeading,
				Attrs: map[string]any{
					"level":     float64(2),
					"textAlign": "center",
					"indent":    float64(1),
				},
				Content: []PMNode{{Type: NodeTypeText, Text: "Centered indented h2"}},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 1 {
		t.Fatalf("expected 1 heading, got %d", len(parsed.Content))
	}
	h := parsed.Content[0]
	if h.Type != NodeTypeHeading {
		t.Fatalf("expected heading, got %q", h.Type)
	}
	if got, _ := h.Attrs["level"].(float64); int(got) != 2 {
		t.Errorf("expected level=2, got %v", got)
	}
	if got, _ := h.Attrs["textAlign"].(string); got != "center" {
		t.Errorf("expected textAlign=center, got %q", got)
	}
	if got, _ := h.Attrs["indent"].(float64); int(got) != 1 {
		t.Errorf("expected indent=1, got %v", got)
	}
}

// TestPMJSONToDocx_AlignmentOOXMLShape sanity-checks that the
// emitted document.xml actually contains the expected w:jc and
// w:ind elements — guarding against a regression where the post-
// process passes accidentally strip them or our exporter routes
// these attrs into the wrong WordZero method.
func TestPMJSONToDocx_AlignmentOOXMLShape(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type:    NodeTypeParagraph,
				Attrs:   map[string]any{"textAlign": "justify", "indent": float64(2)},
				Content: []PMNode{{Type: NodeTypeText, Text: "x"}},
			},
		},
	}
	originalJSON, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	docxBytes, err := PMJSONToDocx(originalJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	docXML := string(readDocxPart(t, docxBytes, "word/document.xml"))
	if !strings.Contains(docXML, `<w:jc w:val="both"`) {
		t.Errorf("document.xml missing <w:jc w:val=\"both\">: %s", docXML)
	}
	// w:ind w:left="1440" == 2 levels * 720 twips/level (1 inch total).
	if !strings.Contains(docXML, `w:left="1440"`) {
		t.Errorf("document.xml missing w:left=\"1440\": %s", docXML)
	}
}

// TestTwipsToIndentLevel validates the boundary cases for the twips
// -> indent-level conversion. 720 twips is exactly one level; 360
// twips rounds down to 0 (under half a level); 1080 twips (Word's
// default 3/4-inch indent) rounds up to level 2.
func TestTwipsToIndentLevel(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"0", 0},
		{"-720", 0},
		{"359", 0},
		{"360", 1}, // exactly half a level rounds up
		{"720", 1},
		{"1080", 2},
		{"1440", 2},
		{"2160", 3},
		{"100000", MaxIndentLevel}, // clamp
		{"not-a-number", 0},
	}
	for _, c := range cases {
		got := twipsToIndentLevel(c.in)
		if got != c.want {
			t.Errorf("twipsToIndentLevel(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

// TestIndentLevelFromAttrs is the inverse helper — making sure the
// emitter clamps and rejects nonsense before it would otherwise
// emit a negative or absurdly large w:left attr.
func TestIndentLevelFromAttrs(t *testing.T) {
	if got := indentLevelFromAttrs(map[string]any{}); got != 0 {
		t.Errorf("missing attr -> got %d, want 0", got)
	}
	if got := indentLevelFromAttrs(map[string]any{"indent": float64(-1)}); got != 0 {
		t.Errorf("negative -> got %d, want 0", got)
	}
	if got := indentLevelFromAttrs(map[string]any{"indent": float64(100)}); got != MaxIndentLevel {
		t.Errorf("oversize -> got %d, want %d", got, MaxIndentLevel)
	}
	if got := indentLevelFromAttrs(map[string]any{"indent": float64(3)}); got != 3 {
		t.Errorf("normal -> got %d, want 3", got)
	}
	if got := indentLevelFromAttrs(map[string]any{"indent": "3"}); got != 0 {
		t.Errorf("string indent should not parse, got %d", got)
	}
}

// mustRoundtripParagraph runs the supplied PM doc through
// PMJSONToDocx and DocxToPMJSON and returns the parsed tree.
// Centralizes the "marshal -> emit -> parse -> unmarshal" boilerplate
// shared by every test in this file.
func mustRoundtripParagraph(t *testing.T, original PMNode) PMNode {
	t.Helper()
	originalJSON, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	docxBytes, err := PMJSONToDocx(originalJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	parsedJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	var parsed PMNode
	if err := json.Unmarshal(parsedJSON, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return parsed
}
