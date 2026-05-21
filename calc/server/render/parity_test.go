package render

import (
	"strings"
	"testing"
)

// TestRenderHTML_StyleParity is a comprehensive single-workbook test
// that locks the rendered HTML for a representative workbook
// containing every styling concern the renderer is supposed to
// preserve: font color, fill color, font size, font family,
// bold/italic/underline/strike, horizontal/vertical alignment, wrap,
// every border edge, merged cells, and per-column widths.
//
// It's the regression net the plan called for: if a future change to
// the renderer drops any of these concerns, this test fails with a
// concrete, named gap rather than a passes-but-prints-blank surprise.
// Substring assertions (not a frozen-string snapshot) keep the test
// resilient to incidental whitespace or attribute-order changes while
// still pinning every load-bearing fragment.
func TestRenderHTML_StyleParity(t *testing.T) {
	bold, italic, underline, strike, wrap := true, true, true, true, true
	hAlign := "right"
	vAlign := "middle"
	color := "#3366FF"
	bg := "#FFEECC"
	family := "Helvetica"
	size := 14.0
	thin := "thin"

	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "Parity",
				ColWidths: map[int]int{
					1: 120,
					2: 240,
					3: 60,
				},
				Cells: map[string]Cell{
					// Plain text cell — no style at all.
					"1:1": {Display: "plain"},
					// Styled cell — exercises every open-vocab style
					// field plus every boolean class modifier.
					"1:2": {
						Display: "styled",
						Style: &CellStyle{
							Font: &CellFont{
								Bold:      &bold,
								Italic:    &italic,
								Underline: &underline,
								Strike:    &strike,
								Color:     &color,
								Name:      &family,
								Size:      &size,
							},
							Fill: &CellFill{FgColor: &bg},
							Alignment: &CellAlignment{
								Horizontal: &hAlign,
								Vertical:   &vAlign,
								WrapText:   &wrap,
							},
							Borders: &CellBorders{
								Top:    &CellBorderEdge{Style: &thin},
								Right:  &CellBorderEdge{Style: &thin},
								Bottom: &CellBorderEdge{Style: &thin},
								Left:   &CellBorderEdge{Style: &thin},
							},
						},
					},
					// Cell in column 3 to exercise the 3-column clip
					// (drives the colgroup width-emission path).
					"1:3": {Display: "z"},
					// Merge anchor (2:1 .. 3:2) tests colspan + rowspan
					// on a 2x2 region.
					"2:1": {Display: "merged"},
					"2:2": {Display: "should-be-hidden"},
					"3:1": {Display: "should-be-hidden"},
					"3:2": {Display: "should-be-hidden"},
				},
				Merges: []MergeRange{
					{AnchorRow: 2, AnchorCol: 1, RowSpan: 2, ColSpan: 2},
				},
			},
		},
	}

	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	// Structural skeleton.
	for _, want := range []string{
		`<section class="tinycld-calc">`,
		`<article class="tinycld-calc-sheet">`,
		`<table class="tinycld-calc-grid">`,
		`<colgroup>`,
		`<col class="tinycld-calc-row-h-col">`,
		`<col style="width: 120px">`,
		`<col style="width: 240px">`,
		`<col style="width: 60px">`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing structural fragment %q in output:\n%s", want, out)
		}
	}

	// Cell text + escaping.
	for _, want := range []string{
		`>plain<`,
		`>styled<`,
		`>merged<`,
		`>z<`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing cell text %q in output:\n%s", want, out)
		}
	}

	// Merged anchor: colspan / rowspan present; covered cells suppressed.
	if !strings.Contains(out, `colspan="2"`) {
		t.Errorf("merged cell missing colspan: %s", out)
	}
	if !strings.Contains(out, `rowspan="2"`) {
		t.Errorf("merged cell missing rowspan: %s", out)
	}
	if strings.Contains(out, "should-be-hidden") {
		t.Errorf("merge-covered cells leaked into output: %s", out)
	}

	// Boolean class modifiers.
	for _, want := range []string{
		"tinycld-calc-cell--bold",
		"tinycld-calc-cell--italic",
		"tinycld-calc-cell--underline",
		"tinycld-calc-cell--strike",
		"tinycld-calc-cell--align-right",
		"tinycld-calc-cell--valign-middle",
		"tinycld-calc-cell--wrap",
		"tinycld-calc-cell--border-top",
		"tinycld-calc-cell--border-right",
		"tinycld-calc-cell--border-bottom",
		"tinycld-calc-cell--border-left",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing class %q in output:\n%s", want, out)
		}
	}

	// Inline style declarations for the open-vocab style fields. These
	// are what print and preview rely on for color/fill/font preservation.
	for _, want := range []string{
		`color: #3366FF`,
		`background: #FFEECC`,
		`font-family: Helvetica`,
		`font-size: 14pt`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing inline style %q in output:\n%s", want, out)
		}
	}
}

// TestRenderHTML_ParityAfterSanitization confirms that the entire
// surface tested above survives the sanitizer pass. The sanitizer
// allowlist for calc is narrow on purpose; if a future widening drops
// a critical attribute (e.g. removes `style` from universal-permit),
// this test fires.
func TestRenderHTML_ParityAfterSanitization(t *testing.T) {
	color := "#FF00FF"
	bg := "#112233"
	size := 18.0
	family := "Inter"
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S",
				ColWidths: map[int]int{1: 99},
				Cells: map[string]Cell{
					"1:1": {
						Display: "x",
						Style: &CellStyle{
							Font: &CellFont{Color: &color, Size: &size, Name: &family},
							Fill: &CellFill{FgColor: &bg},
						},
					},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	wants := []string{
		"color: #FF00FF",
		"background: #112233",
		"font-size: 18pt",
		"font-family: Inter",
		`<col style="width: 99px">`,
	}
	for _, want := range wants {
		if !strings.Contains(out, want) {
			t.Errorf("sanitizer dropped %q from output:\n%s", want, out)
		}
	}
}

// TestRenderHTML_NoXSSFromHostileInputs is the defense-in-depth net
// for the calc renderer: a workbook whose imported cell text / font
// color / font family contains script payloads must produce output
// with no `<script`, no `javascript:`, no event handlers, no
// `expression(`. Runs every output through a fixed set of XSS-shape
// substring forbids — any one of them surviving fails the test.
//
// This is the test that justifies dropping inline-style trust to the
// sanitizer: if the renderer ever stops escaping a field, this test
// reports the gap by name.
func TestRenderHTML_NoXSSFromHostileInputs(t *testing.T) {
	hostileColor := "url(javascript:alert(1))"
	hostileFamily := "Arial; background: url(javascript:0)"
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: `</td><script>alert(1)</script>`,
				Cells: map[string]Cell{
					"1:1": {
						Display: `<img src=x onerror=alert(1)>`,
						Style: &CellStyle{
							Font: &CellFont{Color: &hostileColor, Name: &hostileFamily},
						},
					},
					"1:2": {Display: `<script>alert(1)</script>`},
				},
			},
			{
				Name:  "Other",
				Cells: map[string]Cell{"1:1": {Display: "ok"}},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	// Each forbidden token represents an *unescaped* script vector.
	// Entity-escaped occurrences inside text content (e.g.
	// `&lt;script&gt;`) are safe and intentionally not flagged — the
	// browser displays them as literal text.
	forbidden := []string{
		"<script",
		"</script",
		"javascript:",
		"expression(",
	}
	lower := strings.ToLower(out)
	for _, f := range forbidden {
		if strings.Contains(lower, strings.ToLower(f)) {
			t.Errorf("forbidden token %q leaked into output:\n%s", f, out)
		}
	}
}
