package translate

import (
	"encoding/json"
	"fmt"
	"testing"
)

// TestPMJSONToDocx_FontSizeRoundTrip emits a doc whose paragraph
// carries a textStyle mark with a fontSize attribute, runs it through
// the DOCX round-trip, and asserts the value lands back on the mark
// unchanged. We exercise the full integer-px set the editor's UI
// dropdown offers (8..96) — those are the canonical values we
// guarantee survive round-trip without drift.
func TestPMJSONToDocx_FontSizeRoundTrip(t *testing.T) {
	cases := []int{8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96}
	for _, px := range cases {
		original := PMNode{
			Type: NodeTypeDoc,
			Content: []PMNode{{
				Type: NodeTypeParagraph,
				Content: []PMNode{{
					Type: NodeTypeText,
					Text: "sized text",
					Marks: []PMMark{{
						Type:  MarkTypeTextStyle,
						Attrs: map[string]any{"fontSize": fmt.Sprintf("%dpx", px)},
					}},
				}},
			}},
		}
		parsed := mustRoundtripParagraph(t, original)
		got := findTextStyleAttr(t, parsed, "fontSize")
		want := fmt.Sprintf("%dpx", px)
		if got != want {
			t.Errorf("fontSize px=%d: round-tripped to %v (want %s)", px, got, want)
		}
	}
}

// TestPMJSONToDocx_FontFamilyRoundTrip checks the family-name string
// survives PM -> DOCX -> PM unchanged. The family set is the one the
// editor's dropdown exposes (curated, web-safe).
func TestPMJSONToDocx_FontFamilyRoundTrip(t *testing.T) {
	cases := []string{
		"Arial",
		"Calibri",
		"Cambria",
		"Georgia",
		"Helvetica",
		"Tahoma",
		"Times New Roman",
		"Verdana",
		"Consolas",
		"Courier New",
		"Menlo",
		"Monaco",
	}
	for _, family := range cases {
		original := PMNode{
			Type: NodeTypeDoc,
			Content: []PMNode{{
				Type: NodeTypeParagraph,
				Content: []PMNode{{
					Type: NodeTypeText,
					Text: "named text",
					Marks: []PMMark{{
						Type:  MarkTypeTextStyle,
						Attrs: map[string]any{"fontFamily": family},
					}},
				}},
			}},
		}
		parsed := mustRoundtripParagraph(t, original)
		got := findTextStyleAttr(t, parsed, "fontFamily")
		if got != family {
			t.Errorf("fontFamily %q: round-tripped to %v", family, got)
		}
	}
}

// TestPMJSONToDocx_FontComboRoundTrip combines color + fontSize +
// fontFamily on a single textStyle mark and verifies all three survive
// the round-trip together. The Go importer coalesces multiple <w:rPr>
// children into one mark; this guarantees we don't drop any of them.
func TestPMJSONToDocx_FontComboRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{{
			Type: NodeTypeParagraph,
			Content: []PMNode{{
				Type: NodeTypeText,
				Text: "styled",
				Marks: []PMMark{{
					Type: MarkTypeTextStyle,
					Attrs: map[string]any{
						"color":      "#336699",
						"fontSize":   "20px",
						"fontFamily": "Georgia",
					},
				}},
			}},
		}},
	}
	parsed := mustRoundtripParagraph(t, original)
	if got := findTextStyleAttr(t, parsed, "color"); got != "#336699" {
		t.Errorf("color round-trip: got %v", got)
	}
	if got := findTextStyleAttr(t, parsed, "fontSize"); got != "20px" {
		t.Errorf("fontSize round-trip: got %v", got)
	}
	if got := findTextStyleAttr(t, parsed, "fontFamily"); got != "Georgia" {
		t.Errorf("fontFamily round-trip: got %v", got)
	}
}

// TestFontSizeEdgeCases — a fontSize of 0 (and a missing fontFamily on
// an attrs map that's otherwise empty) must NOT produce a textStyle
// mark. We assert by feeding the emitter a PM tree with zero / empty
// values and checking the import side never sees a textStyle mark
// back.
func TestFontSizeEdgeCases(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{{
			Type: NodeTypeParagraph,
			Content: []PMNode{{
				Type: NodeTypeText,
				Text: "plain",
				Marks: []PMMark{{
					Type: MarkTypeTextStyle,
					Attrs: map[string]any{
						"fontSize":   "",
						"fontFamily": "",
					},
				}},
			}},
		}},
	}
	parsed := mustRoundtripParagraph(t, original)
	// Find the text node and verify it has no textStyle mark — the
	// emitter should treat zero/empty values as absent and the
	// importer should not synthesize a textStyle mark for them.
	walk := func(n PMNode) bool {
		if n.Type == NodeTypeText && n.Text == "plain" {
			for _, m := range n.Marks {
				if m.Type == MarkTypeTextStyle {
					return true
				}
			}
		}
		return false
	}
	var found bool
	for _, p := range parsed.Content {
		for _, child := range p.Content {
			if walk(child) {
				found = true
			}
		}
	}
	if found {
		t.Errorf("expected no textStyle mark on zero/empty input; got one")
	}
}

// TestPxToHalfPointsRoundTrip exercises the half-point⇄px conversion
// helpers in isolation. The full dropdown set should round-trip
// stably (px -> halfPoints -> px == px) even though half-points are
// the storage unit and px the editor unit.
func TestPxToHalfPointsRoundTrip(t *testing.T) {
	cases := []int{8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96}
	for _, px := range cases {
		hp := PxToHalfPoints(px)
		back := HalfPointsToPx(hp)
		if back != px {
			t.Errorf("px=%d -> halfPoints=%d -> px=%d", px, hp, back)
		}
	}
}

// TestHalfPointsToPxKnownValues pins the conversion to a few values a
// user might paste from a Word doc so a future refactor doesn't drift
// the rounding direction.
func TestHalfPointsToPxKnownValues(t *testing.T) {
	cases := []struct {
		halfPoints int
		wantPx     int
	}{
		{16, 11}, // 8pt -> 10.67 -> 11
		{20, 13}, // 10pt -> 13.33 -> 13
		{22, 15}, // 11pt -> 14.67 -> 15
		{24, 16}, // 12pt -> 16
		{28, 19}, // 14pt -> 18.67 -> 19
		{32, 21}, // 16pt -> 21.33 -> 21
		{36, 24}, // 18pt -> 24
		{48, 32}, // 24pt -> 32
	}
	for _, c := range cases {
		got := HalfPointsToPx(c.halfPoints)
		if got != c.wantPx {
			t.Errorf("HalfPointsToPx(%d) = %d, want %d", c.halfPoints, got, c.wantPx)
		}
	}
}

// findTextStyleAttr walks the parsed PM tree and returns the value of
// the named attr on the first textStyle mark it finds. Fails the test
// when no textStyle mark is present — every test that calls this
// expects one.
func findTextStyleAttr(t *testing.T, root PMNode, attr string) any {
	t.Helper()
	var found any
	hit := false
	var walk func(n PMNode)
	walk = func(n PMNode) {
		if hit {
			return
		}
		for _, m := range n.Marks {
			if m.Type == MarkTypeTextStyle {
				if v, ok := m.Attrs[attr]; ok {
					found = v
					hit = true
					return
				}
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(root)
	if !hit {
		// Marshal the tree into the error so failures point at what
		// the importer actually produced.
		b, _ := json.Marshal(root)
		t.Fatalf("no textStyle.%s found in: %s", attr, string(b))
	}
	return found
}
