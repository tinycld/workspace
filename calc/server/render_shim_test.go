package calc

import (
	"os"
	"strings"
	"testing"

	"tinycld.org/packages/calc/render"
)

// TestWorkbookForRender_TinyFixtureRoundTrip exercises the
// WorkbookModel → render.Workbook conversion against the curated
// tiny.xlsx fixture and runs the result through the HTML renderer.
//
// This is the integration seam between the xlsx parser and the
// renderer — a regression on either side (parser drops cells; shim
// loses style fields; renderer mis-formats a cell) shows up as a
// failed substring assertion here.
func TestWorkbookForRender_TinyFixtureRoundTrip(t *testing.T) {
	bytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	wb, err := ReadWorkbookFromXLSX(bytes, 0, 0)
	if err != nil {
		t.Fatalf("read workbook: %v", err)
	}
	rwb := workbookForRender(wb)
	if len(rwb.Sheets) == 0 {
		t.Fatalf("expected at least one sheet in tiny fixture")
	}

	out, err := render.RenderHTML(rwb, render.RenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, want := range []string{
		`<section class="tinycld-calc">`,
		`<table class="tinycld-calc-grid">`,
		`tinycld-calc-col-h`,
		`tinycld-calc-row-h`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in fragment, got %q", want, out)
		}
	}
}

func TestWorkbookForRender_PreservesStyle(t *testing.T) {
	bold := true
	wb := WorkbookModel{
		Sheets: []WorksheetModel{
			{
				Name: "S",
				Cells: map[string]CellValueDTO{
					"1:1": {
						Display: "Hello",
						Style: &CellStyle{
							Font: &CellFont{Bold: &bold},
						},
					},
				},
			},
		},
	}
	rwb := workbookForRender(wb)
	cell, ok := rwb.Sheets[0].Cells["1:1"]
	if !ok {
		t.Fatalf("missing cell")
	}
	if cell.Style == nil || cell.Style.Font == nil || cell.Style.Font.Bold == nil || !*cell.Style.Font.Bold {
		t.Fatalf("bold lost during conversion: %+v", cell.Style)
	}
}

// TestWorkbookForRender_PreservesColWidths exercises the column-width
// passthrough. The bootstrap path reads xlsx col widths into
// WorksheetModel.ColWidths; the shim must propagate them into
// render.Worksheet.ColWidths so the renderer's <colgroup> emits the
// correct widths.
func TestWorkbookForRender_PreservesColWidths(t *testing.T) {
	wb := WorkbookModel{
		Sheets: []WorksheetModel{
			{
				Name:      "S",
				ColWidths: map[int]int{1: 100, 4: 250},
			},
		},
	}
	rwb := workbookForRender(wb)
	got := rwb.Sheets[0].ColWidths
	if got == nil {
		t.Fatalf("ColWidths dropped by shim")
	}
	if got[1] != 100 || got[4] != 250 {
		t.Fatalf("ColWidths mismatched: got %+v", got)
	}
}

// TestWorkbookForRender_PreservesMerges asserts that Merges round-
// trip the shim with anchor + span fields intact. The renderer's
// merged-cell test covers the colspan/rowspan emission; this test
// ensures the shim doesn't lose the data before it reaches the
// renderer.
func TestWorkbookForRender_PreservesMerges(t *testing.T) {
	wb := WorkbookModel{
		Sheets: []WorksheetModel{
			{
				Name: "S",
				Merges: []MergeRangeDTO{
					{AnchorRow: 2, AnchorCol: 3, RowSpan: 4, ColSpan: 5},
				},
			},
		},
	}
	rwb := workbookForRender(wb)
	if len(rwb.Sheets[0].Merges) != 1 {
		t.Fatalf("expected one merge, got %d", len(rwb.Sheets[0].Merges))
	}
	m := rwb.Sheets[0].Merges[0]
	if m.AnchorRow != 2 || m.AnchorCol != 3 || m.RowSpan != 4 || m.ColSpan != 5 {
		t.Fatalf("merge fields lost: %+v", m)
	}
}
