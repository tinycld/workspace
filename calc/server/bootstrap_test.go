package calc

import (
	"bytes"
	"os"
	"testing"

	"github.com/xuri/excelize/v2"
)

// TestReadWorkbookFromXLSXTinyFixture parses the user-curated tiny.xlsx
// fixture and asserts the high-level shape — number of sheets, the
// header row of "People", and that the row/col counts grow with the
// data. Drift here usually means an excelize upgrade changed how a
// particular cell type surfaces; that's the kind of regression the
// preview/bootstrap paths quietly amplify into rendering bugs.
func TestReadWorkbookFromXLSXTinyFixture(t *testing.T) {
	bytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(bytes, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if len(model.Sheets) < 1 {
		t.Fatalf("want at least 1 sheet, got %d", len(model.Sheets))
	}
	first := model.Sheets[0]
	if first.Name == "" {
		t.Fatal("first sheet has empty name")
	}
	if first.RowCount < 5 {
		t.Errorf("first sheet rowCount: want >=5, got %d", first.RowCount)
	}
	if first.ColCount < 3 {
		t.Errorf("first sheet colCount: want >=3, got %d", first.ColCount)
	}
	if len(first.Cells) == 0 {
		t.Error("first sheet has no cells")
	}
	a1 := first.Cells["1:1"]
	if a1.Display == "" {
		t.Errorf("A1 display unexpectedly empty: %+v", a1)
	}
}

// TestReadWorkbookFromXLSXEmptyInputErrors guards against the
// bootstrap hook's empty-bytes branch silently passing through and
// stamping nothing into the YDoc — the bootstrap path treats len==0 as
// "no file yet, leave doc empty", but ReadWorkbookFromXLSX itself must
// reject so the hook can't accidentally feed a parser with no bytes.
func TestReadWorkbookFromXLSXEmptyInputErrors(t *testing.T) {
	_, err := ReadWorkbookFromXLSX(nil, 0, 0)
	if err == nil {
		t.Fatal("expected error on empty input, got nil")
	}
}

// TestReadWorkbookFromXLSXCaps trims rows/cols to the supplied caps,
// which is what the preview endpoint relies on to keep the response
// payload bounded regardless of the source workbook's size.
func TestReadWorkbookFromXLSXCaps(t *testing.T) {
	bytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(bytes, 2, 2)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	for _, sheet := range model.Sheets {
		for key := range sheet.Cells {
			row, col, ok := parseLocalCellKey(key)
			if !ok {
				t.Errorf("malformed cell key: %q", key)
				continue
			}
			if row > 2 || col > 2 {
				t.Errorf("cell %s exceeds caps (row=%d col=%d)", key, row, col)
			}
		}
	}
}

// TestBootstrapYDocFromWorkbookRoundTrip parses the fixture, stamps it
// into a fresh y-crdt doc, and re-extracts via Snapshot — the same
// path the broker uses on first sync. The snapshot's sheets and cells
// must match what we read from xlsx, otherwise clients would see a
// different shape than the server thinks it sent.
func TestBootstrapYDocFromWorkbookRoundTrip(t *testing.T) {
	xlsxBytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(xlsxBytes, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}

	rt := NewRuntime()
	handle, err := rt.NewDoc("bootstrap-test-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	sh := handle.(*sheetsDocHandle)
	if err := BootstrapYDocFromWorkbook(sh.doc, model); err != nil {
		t.Fatalf("BootstrapYDocFromWorkbook: %v", err)
	}

	snap, err := sh.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Sheets) != len(model.Sheets) {
		t.Fatalf("snapshot sheets: want %d, got %d", len(model.Sheets), len(snap.Sheets))
	}
	if len(snap.Cells) == 0 {
		t.Fatal("snapshot has no cells after bootstrap")
	}

	// Spot-check one cell: snapshot SheetID is "sheet1" for the
	// first sheet, and a non-empty A1 should round-trip with a
	// non-empty raw value.
	var sawA1 bool
	for _, c := range snap.Cells {
		if c.SheetID == "sheet1" && c.Row == 1 && c.Col == 1 {
			sawA1 = true
			if c.RawString == "" && c.RawNumber == nil {
				t.Errorf("A1 round-trip: raw is empty: %+v", c)
			}
		}
	}
	if !sawA1 {
		t.Error("A1 missing from snapshot after bootstrap")
	}
}

// TestBootstrapToSerializerRoundTripPreservesCustomizations is the end-
// to-end structural canary for the snapshot-is-authoritative contract.
// It exercises the full bootstrap→snapshot→serializer pipeline that
// runs on every save:
//
//  1. Synthesize an xlsx with every persistable per-sheet
//     customization stamped in: a cell value, row height, col width,
//     row-level style, tab color, sheet hidden, freeze pane, merged
//     range.
//  2. ReadWorkbookFromXLSX (the import-side seed reader).
//  3. BootstrapYDocFromWorkbook (writes the seed into a fresh Y.Doc).
//  4. Snapshot (extracts the Y.Doc state for the serializer).
//  5. serializeSnapshotToXLSX (writes the snapshot back to xlsx).
//  6. Assert every customization survives identically.
//
// Why this matters: each layer is unit-tested individually but the
// chain has the property that an information loss anywhere (the
// reader skipping a field, the bootstrap forgetting to seed it, the
// snapshot decoder collapsing absent/empty, the serializer wiping
// instead of preserving) would silently delete customizations on the
// first save. A failure here means the bug class this package is
// built to prevent has re-opened.
//
// Future fields go in the assertions below; the test is the
// regression net for the whole contract.
func TestBootstrapToSerializerRoundTripPreservesCustomizations(t *testing.T) {
	// 1. Build the source workbook in memory.
	src := excelize.NewFile()
	defer func() { _ = src.Close() }()
	const sheetName = "Sheet1"
	if err := src.SetCellValue(sheetName, "A1", "hello"); err != nil {
		t.Fatalf("seed cell: %v", err)
	}
	if err := src.SetRowHeight(sheetName, 3, 40); err != nil {
		t.Fatalf("seed row height: %v", err)
	}
	if err := src.SetColWidth(sheetName, "B", "B", 25); err != nil {
		t.Fatalf("seed col width: %v", err)
	}
	rowStyleID, err := src.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFFF00"}},
	})
	if err != nil {
		t.Fatalf("seed NewStyle: %v", err)
	}
	if err := src.SetRowStyle(sheetName, 5, 5, rowStyleID); err != nil {
		t.Fatalf("seed SetRowStyle: %v", err)
	}
	tabColor := "FF0000"
	if err := src.SetSheetProps(sheetName, &excelize.SheetPropsOptions{TabColorRGB: &tabColor}); err != nil {
		t.Fatalf("seed tab color: %v", err)
	}
	// A second sheet so we can mark it hidden — excelize forbids
	// hiding the only visible sheet.
	if _, err := src.NewSheet("Other"); err != nil {
		t.Fatalf("seed second sheet: %v", err)
	}
	if err := src.SetSheetVisible("Other", false); err != nil {
		t.Fatalf("seed hide: %v", err)
	}
	if err := src.SetPanes(sheetName, &excelize.Panes{
		Freeze:      true,
		XSplit:      1,
		YSplit:      2,
		TopLeftCell: "B3",
		ActivePane:  "bottomRight",
	}); err != nil {
		t.Fatalf("seed freeze: %v", err)
	}
	if err := src.MergeCell(sheetName, "D1", "E1"); err != nil {
		t.Fatalf("seed merge: %v", err)
	}
	buf, err := src.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	original := buf.Bytes()

	// 2. Read.
	model, err := ReadWorkbookFromXLSX(original, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}

	// 3. Bootstrap.
	rt := NewRuntime()
	handle, err := rt.NewDoc("round-trip-test-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	sh := handle.(*sheetsDocHandle)
	if err := BootstrapYDocFromWorkbook(sh.doc, model); err != nil {
		t.Fatalf("BootstrapYDocFromWorkbook: %v", err)
	}

	// 4. Snapshot.
	snap, err := sh.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	// 5. Serialize.
	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	// 6. Assertions — every customization stamped above must survive.
	got, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = got.Close() }()

	if v, _ := got.GetCellValue(sheetName, "A1"); v != "hello" {
		t.Errorf("A1 value: want %q, got %q", "hello", v)
	}
	// Row height round-trip: seed is in excelize POINTS (40pt), the
	// bootstrap reader converts pt→px via excelPointsToPx with integer
	// rounding, the serializer converts px→pt via pxToExcelPoints
	// (linear × 0.75). The chain is lossy at the integer-px boundary.
	// For 40pt seed: pt(40) → px(53) → pt(39.75). Tolerate ±1pt to
	// absorb the integer-px quantization without losing the assertion's
	// meaning ("the height survived the round-trip, modulo unit jitter").
	if h, _ := got.GetRowHeight(sheetName, 3); h < 38.0 || h > 41.0 {
		t.Errorf("row 3 height: want ~39.75pt (40pt seed via 53px Y.Doc), got %v", h)
	}
	if w, _ := got.GetColWidth(sheetName, "B"); w < 24.0 || w > 26.0 {
		t.Errorf("col B width: want ~25 chars, got %v", w)
	}
	rowStyleIDOut, _ := got.GetCellStyle(sheetName, "A5")
	if rowStyleIDOut == 0 {
		t.Errorf("row 5 style: want non-zero StyleID, got 0 (row-level style lost)")
	} else if style, err := got.GetStyle(rowStyleIDOut); err == nil && style != nil {
		if len(style.Fill.Color) == 0 || style.Fill.Color[0] != "FFFF00" {
			t.Errorf("row 5 style fill: want FFFF00, got %v", style.Fill.Color)
		}
	}
	if props, err := got.GetSheetProps(sheetName); err == nil {
		if props.TabColorRGB == nil || *props.TabColorRGB != "FF0000" {
			t.Errorf("tab color: want FF0000, got %v", props.TabColorRGB)
		}
	}
	if visible, _ := got.GetSheetVisible("Other"); visible {
		t.Errorf("Other sheet visibility: want hidden, got visible")
	}
	if panes, err := got.GetPanes(sheetName); err == nil {
		if !panes.Freeze {
			t.Errorf("freeze: want frozen, got Freeze=false")
		}
		if panes.XSplit != 1 || panes.YSplit != 2 {
			t.Errorf("freeze split: want (XSplit=1, YSplit=2), got (XSplit=%d, YSplit=%d)", panes.XSplit, panes.YSplit)
		}
	}
	merges, _ := got.GetMergeCells(sheetName)
	sawMerge := false
	for _, m := range merges {
		if m.GetStartAxis() == "D1" && m.GetEndAxis() == "E1" {
			sawMerge = true
		}
	}
	if !sawMerge {
		t.Errorf("merge D1:E1: missing from output; got %d merges total", len(merges))
	}
}
