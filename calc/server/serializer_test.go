package calc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// readCell opens xlsx bytes via excelize and returns the value at
// (sheetName, row, col) as a stringified value, matching what the
// xlsx-adapter parser would emit on the client.
func readCell(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	v, err := f.GetCellValue(sheetName, ref)
	if err != nil {
		t.Fatalf("get cell %s!%s: %v", sheetName, ref, err)
	}
	return v
}

// readCellType opens xlsx bytes and returns the excelize CellType at
// (sheetName, row, col). Used by per-kind round-trip tests to verify
// that, e.g., a typed number cell really lands as a numeric cell on
// disk rather than a string-of-digits.
func readCellType(t *testing.T, xlsx []byte, sheetName string, row, col int) excelize.CellType {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	tp, err := f.GetCellType(sheetName, ref)
	if err != nil {
		t.Fatalf("get cell type %s!%s: %v", sheetName, ref, err)
	}
	return tp
}

// readFormula returns the formula expression at the given cell, or
// the empty string if the cell has no formula.
func readFormula(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	formula, err := f.GetCellFormula(sheetName, ref)
	if err != nil {
		t.Fatalf("get formula %s!%s: %v", sheetName, ref, err)
	}
	return formula
}

// snapshotFromXLSX walks the source workbook with excelize and
// produces a YDocSnapshot whose Cells slice mirrors every populated
// cell. Used by serializer tests to construct the "client mirrored
// the whole file" baseline that the new deletion-pass semantic
// requires.
func snapshotFromXLSX(t *testing.T, original []byte) YDocSnapshot {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open xlsx for snapshot mirror: %v", err)
	}
	defer func() { _ = f.Close() }()
	snap := YDocSnapshot{}
	for i, sheetName := range f.GetSheetList() {
		sheetID := fmt.Sprintf("sheet%d", i+1)
		snap.Sheets = append(snap.Sheets, SheetMeta{
			ID:       sheetID,
			Name:     sheetName,
			Position: i,
		})
		rows, err := f.GetRows(sheetName)
		if err != nil {
			t.Fatalf("get rows for snapshot mirror: %v", err)
		}
		for rowIdx, row := range rows {
			for colIdx, v := range row {
				if v == "" {
					continue
				}
				snap.Cells = append(snap.Cells, CellEntry{
					SheetID:   sheetID,
					Row:       rowIdx + 1,
					Col:       colIdx + 1,
					RawString: v,
					Display:   v,
				})
			}
		}
	}
	return snap
}

// overrideCell replaces (or inserts) a cell entry in the snapshot
// for the given sheet/row/col.
func overrideCell(snap *YDocSnapshot, sheetID string, row, col int, value string) {
	for i := range snap.Cells {
		c := &snap.Cells[i]
		if c.SheetID == sheetID && c.Row == row && c.Col == col {
			c.RawString = value
			c.Display = value
			return
		}
	}
	snap.Cells = append(snap.Cells, CellEntry{
		SheetID:   sheetID,
		Row:       row,
		Col:       col,
		RawString: value,
		Display:   value,
	})
}

// dropCell removes a single cell entry from the snapshot — mirroring
// a client-side delete that takes the cell out of the Y.Doc.
func dropCell(snap *YDocSnapshot, sheetID string, row, col int) {
	for i := range snap.Cells {
		c := &snap.Cells[i]
		if c.SheetID == sheetID && c.Row == row && c.Col == col {
			snap.Cells = append(snap.Cells[:i], snap.Cells[i+1:]...)
			return
		}
	}
}

// TestSerializerSingleCellChange round-trips tiny.xlsx through the
// snapshot → serializer pipeline with one cell edit. The snapshot
// mirrors every populated cell of the source workbook plus one edit
// so the assertions exercise "snapshot-is-authoritative": cells the
// snapshot carries land in the output verbatim.
func TestSerializerSingleCellChange(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := snapshotFromXLSX(t, original)
	overrideCell(&snap, "sheet1", 2, 2, "from-save")

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !bytes.HasPrefix(out, []byte{0x50, 0x4B, 0x03, 0x04}) {
		t.Fatalf("output is not a valid xlsx (first 4 bytes = %x)", out[:4])
	}

	if got := readCell(t, out, "People", 2, 2); got != "from-save" {
		t.Errorf("B2 after serialize: want %q, got %q", "from-save", got)
	}
	if got := readCell(t, out, "People", 1, 2); got != "First Name" {
		t.Errorf("B1 (header) after serialize: want %q, got %q", "First Name", got)
	}
	if got := readCell(t, out, "People", 3, 2); got != "Mara" {
		t.Errorf("B3 (carried in snapshot) after serialize: want %q, got %q", "Mara", got)
	}
	if got := readCell(t, out, "Incomes", 1, 1); got == "" {
		t.Error("Incomes!A1 unexpectedly empty — second sheet may have been dropped")
	}
}

// TestSerializerClearsCellsDroppedFromSnapshot exercises the deletion
// pass: a cell present in the original .xlsx that the snapshot no
// longer carries (e.g. after a row delete or clear-contents on the
// client) must be blanked in the saved workbook. Without this, the
// next reload reseeds the Y.Doc from the stale .xlsx and the user's
// deletion silently un-does itself.
func TestSerializerClearsCellsDroppedFromSnapshot(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := snapshotFromXLSX(t, original)
	dropCell(&snap, "sheet1", 3, 2) // People!B3 ("Mara")

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCell(t, out, "People", 3, 2); got != "" {
		t.Errorf("B3 after drop: want empty, got %q", got)
	}
	// Sibling cells in the same row are still in the snapshot and
	// must survive — the deletion is per-cell, not per-row.
	if got := readCell(t, out, "People", 3, 3); got != "Hashimoto" {
		t.Errorf("C3 (still in snapshot) after drop: want %q, got %q", "Hashimoto", got)
	}
}

// TestSerializerAppendNewSheet verifies that a snapshot listing a
// third sheet causes serializeSnapshotToXLSX to NewSheet it onto the
// existing workbook.
func TestSerializerAppendNewSheet(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
			{ID: "sheet3", Name: "Notes", Position: 2},
		},
		Cells: []CellEntry{
			{SheetID: "sheet3", Row: 1, Col: 1, RawString: "hello", Display: "hello"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = f.Close() }()
	sheets := f.GetSheetList()
	if len(sheets) != 3 {
		t.Fatalf("sheet count after append: want 3, got %d (%v)", len(sheets), sheets)
	}
	if got := readCell(t, out, "Notes", 1, 1); got != "hello" {
		t.Errorf("Notes!A1: want %q, got %q", "hello", got)
	}
}

// TestSerializerRenameExistingSheet verifies that a snapshot with a
// new name for an existing-position sheet renames the worksheet.
func TestSerializerRenameExistingSheet(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "Roster", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, RawString: "Renamed", Display: "Renamed"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = f.Close() }()
	sheets := f.GetSheetList()
	if len(sheets) != 2 {
		t.Fatalf("sheet count: want 2, got %d (%v)", len(sheets), sheets)
	}
	if sheets[0] != "Roster" {
		t.Errorf("sheet[0] name after rename: want %q, got %q", "Roster", sheets[0])
	}
	if got := readCell(t, out, "Roster", 2, 2); got != "Renamed" {
		t.Errorf("Roster!B2: want %q, got %q", "Renamed", got)
	}
}

// TestSerializerFormulaCell verifies that snapshot cells with a
// non-empty Formula land as actual formula cells in the output.
func TestSerializerFormulaCell(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			// A1 is the row index column; F2 is the Age column.
			// Put a formula somewhere unused: K1 = F2+F3.
			{
				SheetID:   "sheet1",
				Row:       1,
				Col:       11,
				RawString: "57",
				Display:   "57",
				Formula:   "F2+F3",
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readFormula(t, out, "People", 1, 11); got != "F2+F3" {
		t.Errorf("K1 formula: want %q, got %q", "F2+F3", got)
	}
	if got := readCell(t, out, "People", 1, 11); got != "57" {
		t.Errorf("K1 cached value: want %q, got %q", "57", got)
	}
}

// TestSerializerEmptySnapshot: a snapshot with no cell entries
// represents a workbook whose Y.Doc has had every cell cleared. The
// saved .xlsx must reflect that — sheets stay (their metadata is
// still in the snapshot) but every populated cell from the original
// is blanked.
func TestSerializerEmptySnapshot(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCell(t, out, "People", 2, 2); got != "" {
		t.Errorf("B2 after empty serialize: want empty, got %q", got)
	}
	if got := readCell(t, out, "People", 1, 2); got != "" {
		t.Errorf("B1 after empty serialize: want empty, got %q", got)
	}
}

// TestSerializerEmptyOriginal: zero-length input must error rather
// than silently produce an empty workbook.
func TestSerializerEmptyOriginal(t *testing.T) {
	if _, err := serializeSnapshotToXLSX(nil, YDocSnapshot{}, nil); err == nil {
		t.Fatal("expected error for nil original bytes, got nil")
	}
}

// readCellBold returns the font.bold flag for the given cell.
func readCellBold(t *testing.T, xlsx []byte, sheetName string, row, col int) bool {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return false
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return false
	}
	return style.Font.Bold
}

// readCellFontSize returns the font.size at the given cell, or 0 if
// no style is registered. Used to verify the overlay preserves
// existing font attributes the snapshot doesn't touch.
func readCellFontSize(t *testing.T, xlsx []byte, sheetName string, row, col int) float64 {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return 0
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return 0
	}
	return style.Font.Size
}

// readCellItalic returns the font.italic flag for the given cell.
func readCellItalic(t *testing.T, xlsx []byte, sheetName string, row, col int) bool {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return false
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return false
	}
	return style.Font.Italic
}

// stampFontSize pre-applies a font size on a cell and returns the new
// xlsx bytes. Used to seed an "existing style" we then test the
// overlay preserves.
func stampFontSize(t *testing.T, xlsx []byte, sheetName string, row, col int, size float64) []byte {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Size: size}})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle(sheetName, ref, ref, id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	return buf.Bytes()
}

// boolPtr is a tiny convenience for building *bool literals in tests.
func boolPtr(b bool) *bool { return &b }

// TestSerializerStyleSetsBold: a snapshot whose cell carries
// style.font.bold = true lands as a bold font on the resulting xlsx
// cell.
func TestSerializerStyleSetsBold(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellBold(t, out, "People", 2, 2) {
		t.Errorf("B2 should be bold after style overlay, got non-bold")
	}
	if got := readCell(t, out, "People", 2, 2); got != "from-save" {
		t.Errorf("B2 value: want %q, got %q", "from-save", got)
	}
}

// TestSerializerStylePartialOverlay: an existing style attribute
// (font size) on a cell must survive when the snapshot only carries a
// different attribute (bold). This is the regression test for the
// "don't blow away existing styles" risk that motivated the partial
// overlay design.
func TestSerializerStylePartialOverlay(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with size=14 so we can assert it survives.
	withSize := stampFontSize(t, original, "People", 2, 2, 14)
	if got := readCellFontSize(t, withSize, "People", 2, 2); got != 14 {
		t.Fatalf("seed font size: want 14, got %v", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(withSize, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellBold(t, out, "People", 2, 2) {
		t.Errorf("B2 should be bold after overlay")
	}
	if got := readCellFontSize(t, out, "People", 2, 2); got != 14 {
		t.Errorf("B2 font size: want 14 preserved, got %v", got)
	}
}

// TestSerializerStyleAbsentLeavesCellAlone: a snapshot cell with no
// Style must leave the cell's existing on-disk style intact.
func TestSerializerStyleAbsentLeavesCellAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	withSize := stampFontSize(t, original, "People", 2, 2, 18)

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, RawString: "from-save", Display: "from-save"},
		},
	}

	out, err := serializeSnapshotToXLSX(withSize, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellFontSize(t, out, "People", 2, 2); got != 18 {
		t.Errorf("B2 font size after styleless save: want 18 preserved, got %v", got)
	}
}

// TestSerializerStyleSetsItalic: a snapshot whose cell carries
// style.font.italic = true lands as italic on the resulting xlsx
// cell. Italic is structurally aligned with excelize.Font.Italic; this
// test guards against a future refactor breaking the reflect walk.
func TestSerializerStyleSetsItalic(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Italic: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellItalic(t, out, "People", 2, 2) {
		t.Errorf("B2 should be italic after style overlay")
	}
}

// readCellStrike returns the font.strike flag for the given cell.
func readCellStrike(t *testing.T, xlsx []byte, sheetName string, row, col int) bool {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return false
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return false
	}
	return style.Font.Strike
}

// readCellUnderline returns the font.underline string for the given
// cell ("" when no underline is set, "single"/"double"/etc otherwise).
func readCellUnderline(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return ""
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return ""
	}
	return style.Font.Underline
}

// TestSerializerStyleSetsUnderline: snapshot font.underline = true
// lands as "single" underline in the xlsx cell. Toolbar today is a
// boolean; the override translates true → excelize's "single" string.
func TestSerializerStyleSetsUnderline(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Underline: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellUnderline(t, out, "People", 2, 2); got != "single" {
		t.Errorf("B2 underline: want %q, got %q", "single", got)
	}
}

// TestSerializerStyleClearsUnderline: snapshot font.underline = false
// on a cell that already has an underline in the base xlsx must
// remove it. We pre-stamp B2 with single-underline, then save with
// the snapshot's Underline=false — the resulting xlsx must round-trip
// without underline (excelize round-trips "none" as "none", which
// readCellUnderline returns; what it must NOT return is "single").
func TestSerializerStyleClearsUnderline(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with a single underline.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Underline: "single"}})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellUnderline(t, seeded, "People", 2, 2); got != "single" {
		t.Fatalf("seed: want underline=single, got %q", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Font: &CellFont{Underline: boolPtr(false)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readCellUnderline(t, out, "People", 2, 2); got != "none" {
		t.Errorf("B2 underline: want %q (explicit OOXML cancel), got %q — underline not properly cleared", "none", got)
	}
}

// readCellFontFamily returns the font.family (font name) for the given cell.
func readCellFontFamily(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return ""
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return ""
	}
	return style.Font.Family
}

// stringPtr is a tiny convenience for building *string literals in tests.
func stringPtr(s string) *string { return &s }

// TestSerializerStyleSetsFontName: snapshot font.name = "Courier New"
// lands as Font.Family on the resulting xlsx cell.
func TestSerializerStyleSetsFontName(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Name: stringPtr("Courier New")}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellFontFamily(t, out, "People", 2, 2); got != "Courier New" {
		t.Errorf("B2 font family: want %q, got %q", "Courier New", got)
	}
}

// TestSerializerStyleClearsFontName: snapshot font.name = "" on a
// cell that already has a font family in the base xlsx — does the
// serializer clear it, or does excelize silently drop empty-string
// Family writes (the same trap that motivated TestSerializerStyleClearsUnderline)?
//
// If the YDoc never sends Name: stringPtr("") today the test simply
// documents the assumption: failure here means a real silent-drop
// gap that a future user action (clearing the font picker) could trip.
func TestSerializerStyleClearsFontName(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Family: "Courier New"}})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellFontFamily(t, seeded, "People", 2, 2); got != "Courier New" {
		t.Fatalf("seed: want family=Courier New, got %q", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Font: &CellFont{Name: stringPtr("")}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readCellFontFamily(t, out, "People", 2, 2); got == "Courier New" {
		t.Errorf("B2 font family: empty-string clear failed silently — got %q (existing family survived)", got)
	}
}

// readCellNumFmt returns the custom number format string applied to
// the cell, or "" if none is set.
func readCellNumFmt(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return ""
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.CustomNumFmt == nil {
		return ""
	}
	return *style.CustomNumFmt
}

// TestSerializerStyleSetsNumFmt: snapshot numFmt lands as
// CustomNumFmt on the xlsx cell.
func TestSerializerStyleSetsNumFmt(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				Kind:      "number",
				RawNumber: func() *float64 { v := 1234.5; return &v }(),
				Display:   "1,234.50",
				Style:     &CellStyle{NumFmt: stringPtr("#,##0.00")},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellNumFmt(t, out, "People", 2, 2); got != "#,##0.00" {
		t.Errorf("B2 numFmt: want %q, got %q", "#,##0.00", got)
	}
}

// TestSerializerStyleClearsNumFmt: snapshot numFmt = "" on a cell
// that already carries a custom format must clear it (and must not
// fail the save). Excelize.NewStyle errors on CustomNumFmt = &""
// with ErrCustomNumFmt — the override has to translate empty-string
// patches into "remove custom format".
func TestSerializerStyleClearsNumFmt(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	seedFmt := "#,##0.00"
	id, err := f.NewStyle(&excelize.Style{CustomNumFmt: &seedFmt})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellNumFmt(t, seeded, "People", 2, 2); got != "#,##0.00" {
		t.Fatalf("seed: want numFmt=#,##0.00, got %q", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{NumFmt: stringPtr("")},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readCellNumFmt(t, out, "People", 2, 2); got == "#,##0.00" {
		t.Errorf("B2 numFmt: clear failed silently — got %q (existing format survived)", got)
	}
}

// getCellStyle is the shared lookup-and-return helper for the fill /
// border / numFmt readers added in later tasks. Returns nil if the
// cell has no style.
func getCellStyle(t *testing.T, xlsx []byte, sheetName string, row, col int) *excelize.Style {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return nil
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	return style
}

// readCellFillType returns the cell's fill.type ("" / "pattern").
func readCellFillType(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return ""
	}
	return style.Fill.Type
}

// readCellFillPattern returns the cell's fill.pattern enum index (0 = none, 1 = solid).
func readCellFillPattern(t *testing.T, xlsx []byte, sheetName string, row, col int) int {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return 0
	}
	return style.Fill.Pattern
}

// readCellFillColors returns the fill.Color slice for the cell.
func readCellFillColors(t *testing.T, xlsx []byte, sheetName string, row, col int) []string {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return nil
	}
	return style.Fill.Color
}

// TestSerializerStyleSetsFill: snapshot fill.type=pattern + pattern=solid
// + fgColor=#FF0000 lands as a solid red fill on the xlsx cell.
func TestSerializerStyleSetsFill(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style: &CellStyle{
					Fill: &CellFill{
						Type:    stringPtr("pattern"),
						Pattern: stringPtr("solid"),
						FgColor: stringPtr("#FF0000"),
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellFillType(t, out, "People", 2, 2); got != "pattern" {
		t.Errorf("B2 fill.type: want %q, got %q", "pattern", got)
	}
	if got := readCellFillPattern(t, out, "People", 2, 2); got != 1 {
		t.Errorf("B2 fill.pattern: want 1 (solid), got %d", got)
	}
	colors := readCellFillColors(t, out, "People", 2, 2)
	if len(colors) == 0 || colors[0] != "FF0000" {
		// excelize strips the leading # on read-back.
		t.Errorf("B2 fill.colors: want [\"FF0000\"...], got %v", colors)
	}
}

// TestSerializerStyleSetsStrike: snapshot font.strike = true lands as
// strikethrough on the xlsx cell.
func TestSerializerStyleSetsStrike(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Strike: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellStrike(t, out, "People", 2, 2) {
		t.Errorf("B2 should be strikethrough after style overlay")
	}
}

// stampFill pre-applies a solid red fill on a cell and returns the new
// xlsx bytes. Used to seed an "existing fill" that clearing tests can
// then attempt to remove.
func stampFill(t *testing.T, xlsx []byte, sheetName string, row, col int) []byte {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FF0000"}},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle(sheetName, ref, ref, id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	return buf.Bytes()
}

// readCellBorder returns the excelize Border (Type matches edgeName,
// e.g. "top"/"right"/"bottom"/"left") at the given cell, or a
// zero-value Border if no such edge is set.
func readCellBorder(t *testing.T, xlsx []byte, sheetName string, row, col int, edgeName string) excelize.Border {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return excelize.Border{}
	}
	for _, b := range style.Border {
		if b.Type == edgeName {
			return b
		}
	}
	return excelize.Border{}
}

// TestSerializerStyleSetsBorders: snapshot borders.{top,bottom}=true
// lands as thin black borders on the corresponding edges.
// Uses K1 (row=1, col=11) which is outside the fixture's data range
// and carries no pre-existing borders, so nil edges stay absent.
func TestSerializerStyleSetsBorders(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       1,
				Col:       11,
				RawString: "from-save",
				Display:   "from-save",
				Style: &CellStyle{
					Borders: &CellBorders{
						Top:    &CellBorderEdge{Style: stringPtr("thin"), Color: stringPtr("#000000")},
						Bottom: &CellBorderEdge{Style: stringPtr("thin"), Color: stringPtr("#000000")},
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	top := readCellBorder(t, out, "People", 1, 11, "top")
	if top.Style != 1 {
		t.Errorf("K1 top border style: want 1 (thin), got %d", top.Style)
	}
	bottom := readCellBorder(t, out, "People", 1, 11, "bottom")
	if bottom.Style != 1 {
		t.Errorf("K1 bottom border style: want 1 (thin), got %d", bottom.Style)
	}
	// Edges not in the patch must not be set.
	left := readCellBorder(t, out, "People", 1, 11, "left")
	if left.Style != 0 {
		t.Errorf("K1 left border: want absent, got style=%d", left.Style)
	}
}

// TestSerializerStyleClearsBorder: snapshot borders.top=false on a cell
// that previously had a top border results in the top edge being
// cleared. Verifies the false-clears-edge semantics matching the TS
// `none` preset.
func TestSerializerStyleClearsBorder(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with all four thin borders.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Border: []excelize.Border{
			{Type: "top", Color: "000000", Style: 1},
			{Type: "right", Color: "000000", Style: 1},
			{Type: "bottom", Color: "000000", Style: 1},
			{Type: "left", Color: "000000", Style: 1},
		},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Borders: &CellBorders{Top: &CellBorderEdge{IsClear: true}}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readCellBorder(t, out, "People", 2, 2, "top"); got.Style != 0 {
		t.Errorf("top border should be cleared (style=0), got style=%d", got.Style)
	}
	// Other edges must survive.
	if got := readCellBorder(t, out, "People", 2, 2, "right"); got.Style != 1 {
		t.Errorf("right border survived: want style=1, got %d", got.Style)
	}
}

// TestSerializerStyleBordersPreservesDiagonals: a Borders patch must
// not drop diagonalUp / diagonalDown borders that exist in the base
// xlsx. Our schema only models the four orthogonal edges; anything
// else excelize understands has to round-trip verbatim. Today the
// toolbar can't author diagonals, but workbooks imported from Excel
// frequently contain them — losing them silently on save would
// corrupt the user's data.
func TestSerializerStyleBordersPreservesDiagonals(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with both a top border and a diagonalUp border.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Border: []excelize.Border{
			{Type: "top", Color: "000000", Style: 1},
			{Type: "diagonalUp", Color: "FF0000", Style: 1},
		},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellBorder(t, seeded, "People", 2, 2, "diagonalUp"); got.Style != 1 {
		t.Fatalf("seed: want diagonalUp style=1, got style=%d", got.Style)
	}

	// Patch the four orthogonal edges only — diagonals are not in
	// our schema and must survive untouched.
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Borders: &CellBorders{Bottom: &CellBorderEdge{Style: stringPtr("thin"), Color: stringPtr("#000000")}}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readCellBorder(t, out, "People", 2, 2, "diagonalUp"); got.Style != 1 {
		t.Errorf("diagonalUp border was silently dropped: want style=1, got style=%d", got.Style)
	}
	// The patch's own bottom edge landed.
	if got := readCellBorder(t, out, "People", 2, 2, "bottom"); got.Style != 1 {
		t.Errorf("bottom border (in patch) lost: want style=1, got %d", got.Style)
	}
	// The seeded top edge survives (it's a schema edge not in the patch).
	if got := readCellBorder(t, out, "People", 2, 2, "top"); got.Style != 1 {
		t.Errorf("top border (preserved schema edge) lost: want style=1, got %d", got.Style)
	}
}

// TestSerializerStyleSetsBorderColorAndLineStyle: a CellBorderEdge with
// non-default style + color round-trips through xlsx with the
// matching excelize Style code (3 = dashed at weight 1, 2 = medium)
// and color (no leading "#").
func TestSerializerStyleSetsBorderColorAndLineStyle(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       1,
				Col:       11,
				RawString: "borders",
				Display:   "borders",
				Style: &CellStyle{
					Borders: &CellBorders{
						Top: &CellBorderEdge{
							Style: stringPtr("dashed"),
							Color: stringPtr("#FF0000"),
						},
						Right: &CellBorderEdge{
							Style: stringPtr("medium"),
							Color: stringPtr("#00FF00"),
						},
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	top := readCellBorder(t, out, "People", 1, 11, "top")
	if top.Style != 3 {
		t.Errorf("K1 top border style: want 3 (dashed), got %d", top.Style)
	}
	if !strings.EqualFold(top.Color, "FF0000") {
		t.Errorf("K1 top border color: want FF0000, got %q", top.Color)
	}
	right := readCellBorder(t, out, "People", 1, 11, "right")
	if right.Style != 2 {
		t.Errorf("K1 right border style: want 2 (medium), got %d", right.Style)
	}
	if !strings.EqualFold(right.Color, "00FF00") {
		t.Errorf("K1 right border color: want 00FF00, got %q", right.Color)
	}
}

// TestSerializerStyleClearViaFalseWire proves the scalar-`false` wire
// form survives JSON decode and lands as an edge-delete in the
// overlay. This exercises CellBorderEdge.UnmarshalJSON's IsClear
// path, which the leaf-walking audit cannot cover (IsClear is a
// non-exported field, invisible to the reflection walk).
func TestSerializerStyleClearViaFalseWire(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with a top border so we have something to clear.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Border: []excelize.Border{
			{Type: "top", Color: "000000", Style: 1},
			{Type: "right", Color: "000000", Style: 1},
		},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()

	// Decode CellBorders from the on-the-wire JSON shape — borders.top
	// is the literal scalar `false`, the rest absent. This is what the
	// TS side emits for an "explicit clear" edge.
	const wire = `{"top": false}`
	var borders CellBorders
	if err := json.Unmarshal([]byte(wire), &borders); err != nil {
		t.Fatalf("unmarshal CellBorders %s: %v", wire, err)
	}
	if borders.Top == nil || !borders.Top.IsClear {
		t.Fatalf("UnmarshalJSON should have set Top.IsClear=true; got %+v", borders.Top)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Borders: &borders},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readCellBorder(t, out, "People", 2, 2, "top"); got.Style != 0 {
		t.Errorf("top border should be cleared via wire-false, got style=%d", got.Style)
	}
	if got := readCellBorder(t, out, "People", 2, 2, "right"); got.Style != 1 {
		t.Errorf("right border (not in patch) should survive: got style=%d", got.Style)
	}
}

// readSheetDimension returns the <dimension ref="..."/> string for
// the given sheet, or "" if the workbook doesn't have one.
func readSheetDimension(t *testing.T, xlsx []byte, sheetName string) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	dim, err := f.GetSheetDimension(sheetName)
	if err != nil {
		t.Fatalf("get dimension %s: %v", sheetName, err)
	}
	return dim
}

// TestSerializerExpandsSheetDimension: a snapshot whose SheetMeta
// declares RowCount=50, ColCount=10 widens the workbook's <dimension>
// to A1:J50 even when no new cells are written.
func TestSerializerExpandsSheetDimension(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0, RowCount: 50, ColCount: 10},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readSheetDimension(t, out, "People"); got != "A1:J50" {
		t.Errorf("People dimension: want %q, got %q", "A1:J50", got)
	}
}

// TestSerializerDimensionDoesNotShrink: when the Y.Doc tracks a
// narrower extent than the workbook's existing <dimension>, the save
// must not truncate. Mirrors the discipline behind the clearing tests:
// catches the silent-truncate failure mode where a Y.Doc that only
// observed the scrolled-into region would shrink the saved file's
// dimension below its actual data extent.
func TestSerializerDimensionDoesNotShrink(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	// The fixture's natural dimension is wider than what we'll feed in
	// through the snapshot. Confirm the seed first so the assertion
	// below is meaningful.
	seedDim := readSheetDimension(t, original, "People")
	if seedDim == "" {
		t.Fatalf("fixture has no dimension; cannot test shrink behavior")
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			// Deliberately tiny: 2 rows x 2 cols.
			{ID: "sheet1", Name: "People", Position: 0, RowCount: 2, ColCount: 2},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	got := readSheetDimension(t, out, "People")
	if got != seedDim {
		t.Errorf("dimension shrank: seeded %q, got %q (snapshot's tiny RowCount/ColCount truncated the existing extent)", seedDim, got)
	}
}

// TestSerializerDimensionUntouchedWhenSheetMetaIsZero: a snapshot
// whose SheetMeta carries RowCount=0/ColCount=0 must leave the
// workbook's existing <dimension> alone. Pins the "zero is untracked"
// sentinel.
func TestSerializerDimensionUntouchedWhenSheetMetaIsZero(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	seedDim := readSheetDimension(t, original, "People")

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // RowCount/ColCount default to 0
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readSheetDimension(t, out, "People"); got != seedDim {
		t.Errorf("dimension changed despite zero-count sentinel: seeded %q, got %q", seedDim, got)
	}
}

// readRowHeight returns the row's height in Excel points.
func readRowHeight(t *testing.T, xlsx []byte, sheetName string, row int) float64 {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	h, err := f.GetRowHeight(sheetName, row)
	if err != nil {
		t.Fatalf("get row height %s!%d: %v", sheetName, row, err)
	}
	return h
}

// readColWidth returns the column's width in Excel character units.
func readColWidth(t *testing.T, xlsx []byte, sheetName string, col int) float64 {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	colName, err := excelize.ColumnNumberToName(col)
	if err != nil {
		t.Fatalf("col name %d: %v", col, err)
	}
	w, err := f.GetColWidth(sheetName, colName)
	if err != nil {
		t.Fatalf("get col width %s!%s: %v", sheetName, colName, err)
	}
	return w
}

// TestSerializerPersistsRowHeights: a snapshot with RowHeights{2: 60}
// produces a sheet where row 2's height is 60px → 45pt.
func TestSerializerPersistsRowHeights(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				RowHeights: map[int]int{2: 60},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readRowHeight(t, out, "People", 2); got != 45.0 {
		t.Errorf("row 2 height: want 45 (60px * 0.75), got %v", got)
	}
}

// TestSerializerPersistsColWidths: a snapshot with ColWidths{3: 96}
// produces a sheet where column C's width is the Excel-char
// equivalent of 96px (i.e. (96-5)/7 ≈ 13).
func TestSerializerPersistsColWidths(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				ColWidths: map[int]int{3: 96},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	got := readColWidth(t, out, "People", 3)
	want := 13.0 // (96-5)/7
	if got < want-0.05 || got > want+0.05 {
		t.Errorf("col C width: want ≈ %v (96px → chars), got %v", want, got)
	}
}

// TestSerializerRowHeightsNilLeavesExistingAlone: a snapshot whose
// SheetMeta.RowHeights is nil must not touch the workbook's existing
// row heights. The nil-vs-empty-map distinction is load-bearing: nil
// means "the Y.Doc has no nested map for this field" (legacy doc that
// predates bootstrap-seeding), and the serializer leaves the on-disk
// xlsx alone. An empty (but non-nil) map signals "the doc tracked the
// field and the user cleared every entry" — the serializer clears
// every customization in that case (see TestSerializerClearsRowHeightsForEmptyMap).
func TestSerializerRowHeightsNilLeavesExistingAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp row 2 with a non-default height so we can detect changes.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := f.SetRowHeight("People", 2, 50); err != nil {
		t.Fatalf("seed SetRowHeight: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readRowHeight(t, seeded, "People", 2); got != 50 {
		t.Fatalf("seed: want row 2 height=50, got %v", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // RowHeights nil
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readRowHeight(t, out, "People", 2); got != 50 {
		t.Errorf("row 2 height changed despite nil RowHeights: want 50 preserved, got %v", got)
	}
}

// TestSerializerColWidthsNilLeavesExistingAlone: same tri-state
// sentinel as above for the column-widths path. Nil ⇒ preserve;
// empty (non-nil) ⇒ clear all (covered by
// TestSerializerClearsColWidthsForEmptyMap).
func TestSerializerColWidthsNilLeavesExistingAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := f.SetColWidth("People", "C", "C", 25); err != nil {
		t.Fatalf("seed SetColWidth: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	seedW := readColWidth(t, seeded, "People", 3)
	if seedW < 24.95 || seedW > 25.05 {
		t.Fatalf("seed: want col C width≈25, got %v", seedW)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // ColWidths nil
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	got := readColWidth(t, out, "People", 3)
	if got < 24.95 || got > 25.05 {
		t.Errorf("col C width changed despite nil ColWidths: want ≈25 preserved, got %v", got)
	}
}

// readRowStyleFill returns the fill type/pattern/color of the row
// style for the given row, if one is set.
func readRowStyleFill(t *testing.T, xlsx []byte, sheetName string, row int) (string, int, []string) {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	// excelize reads row style from any cell on that row that has the
	// row-style applied; we read from the first column (which
	// SetRowStyle applies to even if the column is empty).
	id, err := f.GetCellStyle(sheetName, fmt.Sprintf("A%d", row))
	if err != nil {
		t.Fatalf("get style A%d: %v", row, err)
	}
	if id == 0 {
		return "", 0, nil
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil {
		return "", 0, nil
	}
	return style.Fill.Type, style.Fill.Pattern, style.Fill.Color
}

// TestSerializerPersistsRowStyle: a snapshot whose SheetMeta.RowStyles
// declares row 7 should be solid yellow lands as a row-level fill.
func TestSerializerPersistsRowStyle(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				RowStyles: map[int]*CellStyle{
					7: {
						Fill: &CellFill{
							Type:    stringPtr("pattern"),
							Pattern: stringPtr("solid"),
							FgColor: stringPtr("#FFFF00"),
						},
					},
				},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	fillType, pattern, colors := readRowStyleFill(t, out, "People", 7)
	if fillType != "pattern" {
		t.Errorf("row 7 fill.type: want %q, got %q", "pattern", fillType)
	}
	if pattern != 1 {
		t.Errorf("row 7 fill.pattern: want 1 (solid), got %d", pattern)
	}
	if len(colors) == 0 || colors[0] != "FFFF00" {
		t.Errorf("row 7 fill.colors: want [\"FFFF00\"...], got %v", colors)
	}
}

// TestSerializerRowStylesNilLeavesExistingAlone: nil RowStyles means
// the Y.Doc has no nested map for this field, so the serializer leaves
// pre-existing row-level styles in the workbook alone. The empty-map
// case (doc tracks the field, user cleared every entry) is the
// snapshot-is-authoritative clear path — see
// TestSerializerClearsRowStylesForEmptyMap.
func TestSerializerRowStylesNilLeavesExistingAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp row 7 with a yellow row-level fill.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFFF00"}},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetRowStyle("People", 7, 7, id); err != nil {
		t.Fatalf("seed SetRowStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if _, _, colors := readRowStyleFill(t, seeded, "People", 7); len(colors) == 0 || colors[0] != "FFFF00" {
		t.Fatalf("seed: want row 7 fill FFFF00, got %v", colors)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // RowStyles nil
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	_, _, colors := readRowStyleFill(t, out, "People", 7)
	if len(colors) == 0 || colors[0] != "FFFF00" {
		t.Errorf("row 7 fill changed despite nil RowStyles: want FFFF00 preserved, got %v", colors)
	}
}

// TestSerializerIntegratedRoundTrip stacks every persistable
// attribute on one workbook in a single save and verifies each one
// independently. Functions as both a smoke test for the cumulative
// state of the serializer and a fast canary for cross-attribute
// interactions (e.g. cell style + row style on the same row, dimension
// expansion alongside row heights).
func TestSerializerIntegratedRoundTrip(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				RowCount: 50, ColCount: 10,
				RowHeights: map[int]int{2: 60},
				ColWidths:  map[int]int{3: 96},
				RowStyles: map[int]*CellStyle{
					7: {
						Fill: &CellFill{
							Type:    stringPtr("pattern"),
							Pattern: stringPtr("solid"),
							FgColor: stringPtr("#FFFF00"),
						},
					},
				},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1", Row: 2, Col: 2,
				RawString: "styled", Display: "styled",
				Style: &CellStyle{
					Font: &CellFont{
						Bold:      boolPtr(true),
						Italic:    boolPtr(true),
						Underline: boolPtr(true),
						Strike:    boolPtr(true),
						Size:      func() *float64 { v := 14.0; return &v }(),
						Name:      stringPtr("Courier New"),
						Color:     stringPtr("#0000FF"),
					},
					Fill: &CellFill{
						Type:    stringPtr("pattern"),
						Pattern: stringPtr("solid"),
						FgColor: stringPtr("#FF0000"),
					},
					Borders: &CellBorders{
						Top:    &CellBorderEdge{Style: stringPtr("thin"), Color: stringPtr("#000000")},
						Bottom: &CellBorderEdge{Style: stringPtr("thin"), Color: stringPtr("#000000")},
					},
					NumFmt: stringPtr("0.00%"),
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	// Cell-level
	if !readCellBold(t, out, "People", 2, 2) {
		t.Error("B2 bold lost")
	}
	if !readCellItalic(t, out, "People", 2, 2) {
		t.Error("B2 italic lost")
	}
	if got := readCellUnderline(t, out, "People", 2, 2); got != "single" {
		t.Errorf("B2 underline: want single, got %q", got)
	}
	if !readCellStrike(t, out, "People", 2, 2) {
		t.Error("B2 strike lost")
	}
	if got := readCellFontSize(t, out, "People", 2, 2); got != 14 {
		t.Errorf("B2 size: want 14, got %v", got)
	}
	if got := readCellFontFamily(t, out, "People", 2, 2); got != "Courier New" {
		t.Errorf("B2 family: want Courier New, got %q", got)
	}
	if got := readCellFillPattern(t, out, "People", 2, 2); got != 1 {
		t.Errorf("B2 fill.pattern: want 1, got %d", got)
	}
	if got := readCellNumFmt(t, out, "People", 2, 2); got != "0.00%" {
		t.Errorf("B2 numFmt: want 0.00%%, got %q", got)
	}
	if readCellBorder(t, out, "People", 2, 2, "top").Style != 1 {
		t.Error("B2 top border lost")
	}

	// Sheet-level
	if got := readSheetDimension(t, out, "People"); got != "A1:J50" {
		t.Errorf("dimension: want A1:J50, got %q", got)
	}
	if got := readRowHeight(t, out, "People", 2); got != 45 {
		t.Errorf("row 2 height: want 45pt, got %v", got)
	}
	if got := readColWidth(t, out, "People", 3); got < 12.95 || got > 13.05 {
		t.Errorf("col C width: want ≈ 13, got %v", got)
	}
	fillType, pattern, _ := readRowStyleFill(t, out, "People", 7)
	if fillType != "pattern" || pattern != 1 {
		t.Errorf("row 7 row-style fill: want pattern/1, got %s/%d", fillType, pattern)
	}
}

// TestSerializerStyleClearsFill: snapshot FgColor = "" on a cell that
// already has a red fill must clear the foreground color. The trailing-
// empty trimmer in the Fill override drops the now-empty color slot,
// producing an empty Color slice which excelize treats as no fill color.
func TestSerializerStyleClearsFill(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	seeded := stampFill(t, original, "People", 2, 2)
	seededColors := readCellFillColors(t, seeded, "People", 2, 2)
	if len(seededColors) == 0 || seededColors[0] != "FF0000" {
		t.Fatalf("seed: want fill color FF0000, got %v", seededColors)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style: &CellStyle{
					Fill: &CellFill{
						FgColor: stringPtr(""),
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	colors := readCellFillColors(t, out, "People", 2, 2)
	// An empty-string FgColor patch trims the color slot — the resulting
	// Color slice should be empty, which means no fill color is set.
	if len(colors) != 0 {
		t.Errorf("B2 fill color: want empty slice after clear, got %v", colors)
	}
}

// TestSerializerClearsRowHeightsForEmptyMap: a snapshot whose
// SheetMeta.RowHeights is non-nil but empty represents a Y.Doc that
// tracked row heights and then had every entry cleared. The serializer
// must unset all stored row heights on the sheet so the user-side
// clears survive a reload. Without this, the prior fix for
// delete-row persistence (c901b55) left a parallel hole open for
// resize-then-default-reset.
func TestSerializerClearsRowHeightsForEmptyMap(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := f.SetRowHeight("People", 2, 50); err != nil {
		t.Fatalf("seed SetRowHeight: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readRowHeight(t, seeded, "People", 2); got != 50 {
		t.Fatalf("seed: want row 2 height=50, got %v", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				// Non-nil empty: doc tracked heights, user cleared all.
				RowHeights: map[int]int{},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	// Cleared row falls back to the workbook default — read row 3
	// (which we never touched) to find what that default is for this
	// fixture, then assert row 2 matches it (and is no longer 50pt).
	def := readRowHeight(t, out, "People", 3)
	got := readRowHeight(t, out, "People", 2)
	if got == 50.0 {
		t.Errorf("row 2 height after empty-map clear: still seeded 50pt — clear did not run")
	}
	if got != def {
		t.Errorf("row 2 height after empty-map clear: want default %v (matching row 3), got %v", def, got)
	}
}

// TestSerializerClearsColWidthsForEmptyMap: non-nil empty ColWidths
// clears every customized column on the sheet. Same contract as
// TestSerializerClearsRowHeightsForEmptyMap; pinned per-axis because
// SetColWidth and SetRowHeight have different "unset" mechanisms in
// excelize (col uses defaultColWidth, row uses height=-1).
func TestSerializerClearsColWidthsForEmptyMap(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := f.SetColWidth("People", "C", "C", 25); err != nil {
		t.Fatalf("seed SetColWidth: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				ColWidths: map[int]int{},
				// ColCount > seeded customization so the clear loop reaches col C.
				ColCount: 5,
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	got := readColWidth(t, out, "People", 3)
	// defaultExcelColWidth ≈ 9.140625
	if got < 9.0 || got > 9.3 {
		t.Errorf("col C width after empty-map clear: want ≈ default (9.14), got %v", got)
	}
}

// TestSerializerClearsRowStylesForEmptyMap: non-nil empty RowStyles
// clears every row-level style on the sheet. Per-cell styles applied
// in the cells pass layer on top in Excel's render model, so clearing
// the row-level style is the right scope.
func TestSerializerClearsRowStylesForEmptyMap(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFFF00"}},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetRowStyle("People", 7, 7, id); err != nil {
		t.Fatalf("seed SetRowStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				RowStyles: map[int]*CellStyle{},
				// RowCount > seeded row so the clear loop reaches row 7.
				RowCount: 10,
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	_, _, colors := readRowStyleFill(t, out, "People", 7)
	if len(colors) != 0 {
		t.Errorf("row 7 row-style after empty-map clear: want no colors, got %v", colors)
	}
}

// TestSerializerClearsTabColorWhenSnapshotEmpty: a snapshot with empty
// SheetMeta.Color must clear any prior tab color on the sheet. Mirrors
// the same authoritative-snapshot contract used for cells, merges, and
// the sparse maps above. Previously this branch was a write-only
// `if meta.Color != "" { ... }` — a user clearing the tab color in
// the client would silently leave the old color on disk.
func TestSerializerClearsTabColorWhenSnapshotEmpty(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Seed a tab color on the original.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	red := "FF0000"
	if err := f.SetSheetProps("People", &excelize.SheetPropsOptions{TabColorRGB: &red}); err != nil {
		t.Fatalf("seed SetSheetProps: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()

	props, err := openSheetProps(t, seeded, "People")
	if err != nil {
		t.Fatalf("read seeded props: %v", err)
	}
	if props.TabColorRGB == nil || *props.TabColorRGB != "FF0000" {
		t.Fatalf("seed: want TabColorRGB=FF0000, got %v", props.TabColorRGB)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // Color: "" (cleared)
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	outProps, err := openSheetProps(t, out, "People")
	if err != nil {
		t.Fatalf("read output props: %v", err)
	}
	if outProps.TabColorRGB != nil && *outProps.TabColorRGB != "" {
		t.Errorf("tab color after clear: want empty/absent, got %q", *outProps.TabColorRGB)
	}
}

// openSheetProps returns the excelize SheetPropsOptions for the given
// sheet — used by tab-color tests to assert the on-disk worksheet
// <sheetPr> state.
func openSheetProps(t *testing.T, xlsx []byte, sheet string) (excelize.SheetPropsOptions, error) {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		return excelize.SheetPropsOptions{}, err
	}
	defer func() { _ = f.Close() }()
	return f.GetSheetProps(sheet)
}

// TestSerializerSparseMapRoundTripContract is the structural canary
// that catches future regressions of the c901b55 bug class: a sparse
// per-sheet map (or scalar) whose serializer writes new values but
// fails to clear values the snapshot has dropped.
//
// For each registered (name, seed, mutate-snapshot, observe) tuple,
// the test:
//  1. Seeds the source xlsx with a non-default customization for the
//     field.
//  2. Builds a snapshot via snapshotFromXLSX (cells mirrored) and
//     applies the mutate-snapshot callback — typically dropping the
//     field's customization from the snapshot.
//  3. Asserts the observe callback finds the customization cleared in
//     the output.
//
// Adding a new persisted per-sheet attribute means adding one entry
// here. If the new attribute's serializer code forgets the clear-on-
// drop pass, this test fails immediately rather than waiting for a
// user-visible "my edit came back" bug report.
func TestSerializerSparseMapRoundTripContract(t *testing.T) {
	type roundTripCase struct {
		name     string
		seed     func(t *testing.T, f *excelize.File)
		mutate   func(snap *YDocSnapshot)
		observe  func(t *testing.T, out []byte) (got string, want string)
		describe string
	}

	cases := []roundTripCase{
		{
			name: "row height dropped from snapshot clears on disk",
			seed: func(t *testing.T, f *excelize.File) {
				if err := f.SetRowHeight("People", 2, 50); err != nil {
					t.Fatalf("seed SetRowHeight: %v", err)
				}
			},
			mutate: func(snap *YDocSnapshot) {
				// Doc tracks heights but row 2's customization is gone.
				snap.Sheets[0].RowHeights = map[int]int{}
				snap.Sheets[0].RowCount = 10
			},
			observe: func(t *testing.T, out []byte) (string, string) {
				// Workbook default varies per fixture; row 3 was never
				// touched, so it reads as the workbook default. The
				// cleared row must match that, not the seeded 50pt.
				h := readRowHeight(t, out, "People", 2)
				def := readRowHeight(t, out, "People", 3)
				if h == 50.0 {
					return "50 (seeded — clear did not run)", "default"
				}
				if h == def {
					return "default", "default"
				}
				return fmt.Sprintf("%v", h), fmt.Sprintf("default(%v)", def)
			},
			describe: "RowHeights",
		},
		{
			name: "col width dropped from snapshot clears on disk",
			seed: func(t *testing.T, f *excelize.File) {
				if err := f.SetColWidth("People", "C", "C", 25); err != nil {
					t.Fatalf("seed SetColWidth: %v", err)
				}
			},
			mutate: func(snap *YDocSnapshot) {
				snap.Sheets[0].ColWidths = map[int]int{}
				snap.Sheets[0].ColCount = 5
			},
			observe: func(t *testing.T, out []byte) (string, string) {
				w := readColWidth(t, out, "People", 3)
				// Within tolerance of defaultExcelColWidth.
				if w > 9.0 && w < 9.3 {
					return "default", "default"
				}
				return fmt.Sprintf("%v", w), "default"
			},
			describe: "ColWidths",
		},
		{
			name: "row style dropped from snapshot clears on disk",
			seed: func(t *testing.T, f *excelize.File) {
				id, err := f.NewStyle(&excelize.Style{
					Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFFF00"}},
				})
				if err != nil {
					t.Fatalf("seed NewStyle: %v", err)
				}
				if err := f.SetRowStyle("People", 7, 7, id); err != nil {
					t.Fatalf("seed SetRowStyle: %v", err)
				}
			},
			mutate: func(snap *YDocSnapshot) {
				snap.Sheets[0].RowStyles = map[int]*CellStyle{}
				snap.Sheets[0].RowCount = 10
			},
			observe: func(t *testing.T, out []byte) (string, string) {
				_, _, colors := readRowStyleFill(t, out, "People", 7)
				if len(colors) == 0 {
					return "cleared", "cleared"
				}
				return fmt.Sprintf("%v", colors), "cleared"
			},
			describe: "RowStyles",
		},
		{
			name: "tab color dropped from snapshot clears on disk",
			seed: func(t *testing.T, f *excelize.File) {
				rgb := "FF0000"
				if err := f.SetSheetProps("People", &excelize.SheetPropsOptions{TabColorRGB: &rgb}); err != nil {
					t.Fatalf("seed SetSheetProps: %v", err)
				}
			},
			mutate: func(snap *YDocSnapshot) {
				// Color: "" — doc explicitly has no tab color.
				snap.Sheets[0].Color = ""
			},
			observe: func(t *testing.T, out []byte) (string, string) {
				props, err := openSheetProps(t, out, "People")
				if err != nil {
					return "error", "cleared"
				}
				if props.TabColorRGB == nil || *props.TabColorRGB == "" {
					return "cleared", "cleared"
				}
				return *props.TabColorRGB, "cleared"
			},
			describe: "Color",
		},
	}

	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, err := excelize.OpenReader(bytes.NewReader(original))
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			tc.seed(t, f)
			buf, err := f.WriteToBuffer()
			if err != nil {
				t.Fatalf("WriteToBuffer: %v", err)
			}
			_ = f.Close()
			seeded := buf.Bytes()

			snap := snapshotFromXLSX(t, seeded)
			tc.mutate(&snap)

			out, err := serializeSnapshotToXLSX(seeded, snap, nil)
			if err != nil {
				t.Fatalf("serialize: %v", err)
			}
			got, want := tc.observe(t, out)
			if got != want {
				t.Errorf("%s round-trip clear: want %q, got %q", tc.describe, want, got)
			}
		})
	}
}

// countSheetDataRows enumerates the <row> elements in a sheet's
// sheetData via excelize's streaming row iterator. Used by the no-op-
// save bloat regression test below.
func countSheetDataRows(t *testing.T, xlsx []byte, sheetName string) int {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	rows, err := f.Rows(sheetName)
	if err != nil {
		t.Fatalf("open row iterator: %v", err)
	}
	defer func() { _ = rows.Close() }()
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Error(); err != nil {
		t.Fatalf("row iterator: %v", err)
	}
	return count
}

// TestSerializerNoOpSaveDoesNotInflateSheetData pins the optimization-#2
// invariant: a save whose snapshot has empty (non-nil) RowStyles on a
// sheet that itself has no on-disk row-level styles must NOT backfill
// placeholder <row> entries up to the sheet's <dimension>.
//
// Why RowStyles specifically: excelize's trimRow() filter (called at
// marshal time) prunes rows whose only "customization" is Ht=nil /
// CustomHeight=false, so the row-heights clear pass survives
// pre-optimization without inflating the file. But SetRowStyle(_,_,_,0)
// sets the row's CustomFormat=true, which trimRow.hasAttr() returns
// true for — those rows are KEPT on write. The dense version of
// applySparseRowStyles would have walked 1..dimensionRowExtent and
// marked every row CustomFormat=true. A 50k-dimension sheet with no
// row styles would gain 50k <row> entries on every save.
//
// The test pins the row-style clear path specifically because that's
// where the inflation actually shows up in the saved file. The other
// two helpers (heights, widths) are still optimized for the same
// reason but their inflation was masked by excelize's own pruning.
func TestSerializerNoOpSaveDoesNotInflateSheetData(t *testing.T) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	if err := f.SetCellValue("Sheet1", "A1", "hello"); err != nil {
		t.Fatalf("seed cell: %v", err)
	}
	// Widen <dimension> well past the populated cells so the
	// pre-optimization dense loop would have walked 1..1000 in the
	// clear pass.
	if err := f.SetSheetDimension("Sheet1", "A1:Z1000"); err != nil {
		t.Fatalf("widen dimension: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	original := buf.Bytes()
	originalRowCount := countSheetDataRows(t, original, "Sheet1")
	if originalRowCount > 5 {
		t.Fatalf("fixture row count %d is unexpectedly large — test setup may be wrong", originalRowCount)
	}

	// Snapshot mirrors the workbook contents and declares an empty-but-
	// non-nil RowStyles map so the clear-then-write helper runs its
	// clear pass. Heights and widths are exercised too for completeness,
	// but RowStyles is the one that actually inflates pre-optimization.
	snap := snapshotFromXLSX(t, original)
	for i := range snap.Sheets {
		snap.Sheets[i].RowHeights = map[int]int{}
		snap.Sheets[i].ColWidths = map[int]int{}
		snap.Sheets[i].RowStyles = map[int]*CellStyle{}
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	outRowCount := countSheetDataRows(t, out, "Sheet1")
	if outRowCount != originalRowCount {
		t.Errorf("sheetData row count after no-op save: want %d (matching input), got %d — clear pass backfilled placeholder rows",
			originalRowCount, outRowCount)
	}
}
