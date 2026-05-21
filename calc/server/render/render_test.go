package render

import (
	"errors"
	"strings"
	"testing"
)

func TestRenderHTML_EmptyWorkbook(t *testing.T) {
	out, err := RenderHTML(Workbook{}, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if out != `<section class="tinycld-calc"></section>` {
		t.Fatalf("unexpected output: %q", out)
	}
}

func TestRenderHTML_SingleSheet_NoTitle(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name:     "Sheet1",
				Cells: map[string]Cell{
					"1:1": {Display: "Hello"},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, "tinycld-calc-sheet-title") {
		t.Fatalf("single-sheet output should not emit a sheet title: %q", out)
	}
	if !strings.Contains(out, ">Hello<") {
		t.Fatalf("expected Hello cell value, got %q", out)
	}
	if !strings.Contains(out, `class="tinycld-calc-col-h">A<`) {
		t.Fatalf("expected column letter header, got %q", out)
	}
	if !strings.Contains(out, `class="tinycld-calc-row-h">1<`) {
		t.Fatalf("expected row number header, got %q", out)
	}
}

func TestRenderHTML_MultipleSheets_EmitsTitles(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name:     "First",
				
				Cells: map[string]Cell{
					"1:1": {Display: "A"},
				},
			},
			{
				Name:     "Second",
				
				Cells: map[string]Cell{
					"1:1": {Display: "B"},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out, ">First<") {
		t.Fatalf("expected first sheet title, got %q", out)
	}
	if !strings.Contains(out, ">Second<") {
		t.Fatalf("expected second sheet title, got %q", out)
	}
}

func TestRenderHTML_SkipsHiddenSheets(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{Name: "Visible",  Cells: map[string]Cell{"1:1": {Display: "V"}}},
			{Name: "Stash", Hidden: true,  Cells: map[string]Cell{"1:1": {Display: "X"}}},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, ">X<") {
		t.Fatalf("hidden sheet cell leaked into output: %q", out)
	}
	if !strings.Contains(out, ">V<") {
		t.Fatalf("expected visible sheet cell, got %q", out)
	}
}

func TestRenderHTML_StyleClasses(t *testing.T) {
	bold := true
	italic := true
	horizontal := "right"
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S", 
				Cells: map[string]Cell{
					"1:1": {
						Display: "X",
						Style: &CellStyle{
							Font: &CellFont{Bold: &bold, Italic: &italic},
							Alignment: &CellAlignment{
								Horizontal: &horizontal,
							},
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
	for _, want := range []string{
		"tinycld-calc-cell--bold",
		"tinycld-calc-cell--italic",
		"tinycld-calc-cell--align-right",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected class %q in output, got %q", want, out)
		}
	}
}

func TestRenderHTML_BorderClasses(t *testing.T) {
	thin := "thin"
	black := "#000000"
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S", 
				Cells: map[string]Cell{
					"1:1": {
						Display: "X",
						Style: &CellStyle{
							Borders: &CellBorders{
								Top:    &CellBorderEdge{Style: &thin, Color: &black},
								Right:  &CellBorderEdge{IsClear: true},
								Bottom: &CellBorderEdge{Style: &thin},
							},
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
	if !strings.Contains(out, "tinycld-calc-cell--border-top") {
		t.Fatalf("missing top border class: %q", out)
	}
	if strings.Contains(out, "tinycld-calc-cell--border-right") {
		t.Fatalf("explicit clear should not produce border class: %q", out)
	}
	if !strings.Contains(out, "tinycld-calc-cell--border-bottom") {
		t.Fatalf("missing bottom border class: %q", out)
	}
}

func TestRenderHTML_DisplayTextEscaped(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S", 
				Cells: map[string]Cell{
					"1:1": {Display: "<script>x</script>"},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, "<script>") {
		t.Fatalf("script tag leaked into output: %q", out)
	}
	if !strings.Contains(out, "&lt;script&gt;") {
		t.Fatalf("script tag not properly escaped: %q", out)
	}
}

func TestRenderHTML_NumberDisplay(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S", 
				Cells: map[string]Cell{
					"1:1": {Display: "42"},
					"2:1": {Display: "3.14"},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out, ">42<") {
		t.Fatalf("missing integer display: %q", out)
	}
	if !strings.Contains(out, ">3.14<") {
		t.Fatalf("missing float display: %q", out)
	}
}

func TestRenderHTML_FormulaDisplaysCachedValue(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S", 
				Cells: map[string]Cell{
					"1:1": {Display: "5"},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out, ">5<") {
		t.Fatalf("formula cell should display cached value, got %q", out)
	}
	if strings.Contains(out, "SUM(A2:A3)") {
		t.Fatalf("formula text should not leak into rendered HTML, got %q", out)
	}
}

func TestRenderHTML_ScopeSelectionLimitsToOneSheet(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{Name: "First",  Cells: map[string]Cell{"1:1": {Display: "FF"}}},
			{Name: "Second",  Cells: map[string]Cell{"1:1": {Display: "SS"}}},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{Scope: ScopeSelection, Sheet: "Second"})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, ">FF<") {
		t.Fatalf("first sheet leaked into selection-only output: %q", out)
	}
	if !strings.Contains(out, ">SS<") {
		t.Fatalf("selected sheet missing from output: %q", out)
	}
}

func TestRenderHTML_RangeClipping(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S", 
				Cells: map[string]Cell{
					"1:1": {Display: "A1"}, "1:2": {Display: "A2"}, "1:3": {Display: "A3"},
					"2:1": {Display: "B1"}, "2:2": {Display: "B2"}, "2:3": {Display: "B3"},
					"3:1": {Display: "C1"}, "3:2": {Display: "C2"}, "3:3": {Display: "C3"},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{Range: "B2:C3"})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, ">A1<") || strings.Contains(out, ">A2<") || strings.Contains(out, ">A3<") {
		t.Fatalf("first row leaked through range clip: %q", out)
	}
	if !strings.Contains(out, ">B2<") || !strings.Contains(out, ">C3<") {
		t.Fatalf("clip should include B2..C3: %q", out)
	}
}

func TestColumnLabel(t *testing.T) {
	cases := []struct {
		col  int
		want string
	}{
		{1, "A"},
		{2, "B"},
		{26, "Z"},
		{27, "AA"},
		{28, "AB"},
		{52, "AZ"},
		{53, "BA"},
		{702, "ZZ"},
		{703, "AAA"},
	}
	for _, c := range cases {
		got := columnLabel(c.col)
		if got != c.want {
			t.Errorf("columnLabel(%d) = %q, want %q", c.col, got, c.want)
		}
	}
}

func TestParseA1Range(t *testing.T) {
	r, err := parseA1Range("B2:D10")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if r.startCol != 2 || r.endCol != 4 || r.startRow != 2 || r.endRow != 10 {
		t.Fatalf("unexpected rect %+v", r)
	}
}

func TestParseA1Range_SingleCell(t *testing.T) {
	r, err := parseA1Range("A1")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if r.startCol != 1 || r.endCol != 1 || r.startRow != 1 || r.endRow != 1 {
		t.Fatalf("unexpected rect %+v", r)
	}
}

func TestParseA1Range_Invalid(t *testing.T) {
	for _, in := range []string{"", "123", "A", ":B2"} {
		if _, err := parseA1Range(in); err == nil {
			t.Errorf("expected error for %q", in)
		}
	}
}

// TestRenderHTML_BadInputsReturnErrBadRequest pins the
// caller-vs-internal error classification. Bad range strings, unknown
// sheet names, and unsupported scope values are caller errors and
// must wrap ErrBadRequest so the HTTP handler maps them to 400.
func TestRenderHTML_BadInputsReturnErrBadRequest(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{Name: "S", Cells: map[string]Cell{"1:1": {Display: "x"}}},
		},
	}
	cases := []struct {
		name string
		opts RenderOpts
	}{
		{
			name: "malformed range",
			opts: RenderOpts{Range: ":B2"},
		},
		{
			name: "unknown sheet under selection scope",
			opts: RenderOpts{Scope: ScopeSelection, Sheet: "Missing"},
		},
		{
			name: "unsupported scope",
			opts: RenderOpts{Scope: Scope("garbage")},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := RenderHTML(wb, c.opts)
			if err == nil {
				t.Fatalf("expected error")
			}
			if !errors.Is(err, ErrBadRequest) {
				t.Fatalf("expected ErrBadRequest, got %v", err)
			}
		})
	}
}

// TestRenderHTML_FontColorAndFillEmitInlineStyle guards the per-cell
// color preservation. The renderer projects color / fill / font-size
// / font-family directly into an inline `style="…"` attribute (the
// sanitizer's safe-property allowlist passes the declarations
// through); attribute-selector / typed-attr() schemes were rejected
// for cross-browser support reasons.
func TestRenderHTML_FontColorAndFillEmitInlineStyle(t *testing.T) {
	color := "#FF0000"
	bg := "#00FF00"
	family := "Arial"
	size := 12.5
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S",
				Cells: map[string]Cell{
					"1:1": {
						Display: "X",
						Style: &CellStyle{
							Font: &CellFont{Color: &color, Name: &family, Size: &size},
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
	for _, want := range []string{
		`color: #FF0000`,
		`background: #00FF00`,
		`font-family: Arial`,
		`font-size: 12.5pt`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in output, got %q", want, out)
		}
	}
}

// TestRenderHTML_HostileColorRejected verifies emit-time value
// validation: a "color" value containing CSS escape sequences or
// url() must be dropped at cell-emit time (and the sanitizer pass
// catches anything that slips through as defense-in-depth).
func TestRenderHTML_HostileColorRejected(t *testing.T) {
	hostile := "url(javascript:alert(1))"
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S",
				Cells: map[string]Cell{
					"1:1": {
						Display: "X",
						Style: &CellStyle{
							Font: &CellFont{Color: &hostile},
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
	if strings.Contains(out, "color:") {
		t.Fatalf("hostile color leaked into output: %q", out)
	}
	if strings.Contains(out, "javascript") {
		t.Fatalf("javascript scheme leaked into output: %q", out)
	}
}

// TestRenderHTML_ColWidthsEmitColgroup verifies that the renderer
// emits a <colgroup> with <col style="width: Npx"> for each tracked
// column width. Columns not in the ColWidths map render as a bare
// <col>; the leading row-header column always renders as a bare
// <col class="tinycld-calc-row-h-col">.
func TestRenderHTML_ColWidthsEmitColgroup(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S",
				Cells: map[string]Cell{
					"1:1": {Display: "A"},
					"1:2": {Display: "B"},
					"1:3": {Display: "C"},
				},
				ColWidths: map[int]int{
					1: 200,
					3: 75,
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out, `<colgroup>`) {
		t.Fatalf("missing colgroup: %q", out)
	}
	if !strings.Contains(out, `<col class="tinycld-calc-row-h-col">`) {
		t.Fatalf("missing leading row-header col: %q", out)
	}
	if !strings.Contains(out, `<col style="width: 200px">`) {
		t.Fatalf("missing first column width: %q", out)
	}
	if !strings.Contains(out, `<col style="width: 75px">`) {
		t.Fatalf("missing third column width: %q", out)
	}
	// Middle column has no width — should be a bare <col>.
	if !strings.Contains(out, `<col><col style="width: 75px">`) {
		t.Fatalf("middle column should render as bare <col>: %q", out)
	}
}

// TestRenderHTML_MergedCellsEmitSpansAndSuppressInsideCells covers
// the merged-cell pipeline end-to-end. The renderer must emit
// colspan/rowspan on the anchor cell and entirely skip the cells
// covered by the merge so the anchor visually spans them.
func TestRenderHTML_MergedCellsEmitSpansAndSuppressInsideCells(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name: "S",
				Cells: map[string]Cell{
					"1:1": {Display: "A1"}, "1:2": {Display: "should-not-appear-B1"},
					"2:1": {Display: "should-not-appear-A2"}, "2:2": {Display: "should-not-appear-B2"},
				},
				Merges: []MergeRange{
					{AnchorRow: 1, AnchorCol: 1, RowSpan: 2, ColSpan: 2},
				},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out, `colspan="2"`) {
		t.Errorf("missing colspan in merged-cell output: %q", out)
	}
	if !strings.Contains(out, `rowspan="2"`) {
		t.Errorf("missing rowspan in merged-cell output: %q", out)
	}
	if strings.Contains(out, "should-not-appear") {
		t.Fatalf("covered cells leaked into merged-cell output: %q", out)
	}
	if !strings.Contains(out, ">A1<") {
		t.Fatalf("anchor cell value missing: %q", out)
	}
}

// TestRenderHTML_1x1MergeIgnored verifies the degenerate "merge of
// one cell" case doesn't emit colspan/rowspan or suppress anything.
func TestRenderHTML_1x1MergeIgnored(t *testing.T) {
	wb := Workbook{
		Sheets: []Worksheet{
			{
				Name:   "S",
				Cells:  map[string]Cell{"1:1": {Display: "A1"}},
				Merges: []MergeRange{{AnchorRow: 1, AnchorCol: 1, RowSpan: 1, ColSpan: 1}},
			},
		},
	}
	out, err := RenderHTML(wb, RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, "colspan") || strings.Contains(out, "rowspan") {
		t.Fatalf("1x1 merge should not emit span attrs: %q", out)
	}
}
