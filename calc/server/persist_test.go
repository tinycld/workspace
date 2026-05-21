package calc

import (
	"errors"
	"os"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/xuri/excelize/v2"
)

// setupPersistTestApp creates a tests.TestApp with a minimal
// drive_items collection (just enough to seed an XLSX blob and
// re-read it after SaveRoom). Real production schemas have many more
// fields; we synthesize the bits SaveRoom touches.
func setupPersistTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("tests.NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	items := core.NewBaseCollection(driveItemsCollection)
	items.Fields.Add(&core.TextField{Name: "name"})
	items.Fields.Add(&core.FileField{
		Name:    "file",
		MaxSize: 50 << 20, // 50 MiB — a real spreadsheet may be large
	})
	items.Fields.Add(&core.NumberField{Name: "size"})
	if err := app.Save(items); err != nil {
		t.Fatalf("save drive_items collection: %v", err)
	}
	return app
}

// seedDriveItem creates a drive_items record with the given file
// bytes attached and returns the saved record's id.
func seedDriveItem(t *testing.T, app *tests.TestApp, name string, content []byte) string {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(driveItemsCollection)
	if err != nil {
		t.Fatalf("find drive_items collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("size", len(content))
	f, err := filesystem.NewFileFromBytes(content, name)
	if err != nil {
		t.Fatalf("NewFileFromBytes: %v", err)
	}
	rec.Set("file", f)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_item record: %v", err)
	}
	return rec.Id
}

// TestSaveRoomWritesUpdatedXLSX is the integration test:
//   - seed drive_items with tiny.xlsx
//   - mint a Runtime + DocHandle
//   - apply a yjs update setting cell B2 = "from-yjs"
//   - call SaveRoom
//   - reload the record, read the file blob, parse with excelize,
//     assert B2 changed
func TestSaveRoomWritesUpdatedXLSX(t *testing.T) {
	tinyXlsx, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	app := setupPersistTestApp(t)
	itemID := seedDriveItem(t, app, "tiny.xlsx", tinyXlsx)

	rt := NewRuntime()
	handle, err := rt.NewDoc(itemID)
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "from-save", "from-save")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	if err := SaveRoom(app, handle, itemID, nil); err != nil {
		t.Fatalf("SaveRoom: %v", err)
	}

	// Reload the record and read back the file bytes via the same
	// helper SaveRoom uses, then re-parse to confirm the cell.
	reloaded, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		t.Fatalf("reload drive_item: %v", err)
	}
	bytesAfter, err := readDriveItemBytes(app, reloaded)
	if err != nil {
		t.Fatalf("readDriveItemBytes after save: %v", err)
	}
	if len(bytesAfter) == 0 {
		t.Fatal("file bytes empty after save")
	}
	if got := readBackCellInTinyXlsx(t, bytesAfter, 2, 2); got != "from-save" {
		t.Fatalf("B2 after SaveRoom: want %q, got %q", "from-save", got)
	}

	// And the size field is updated to match.
	if got, want := reloaded.GetInt("size"), len(bytesAfter); got != want {
		t.Errorf("size field after save: want %d, got %d", want, got)
	}
}

// TestSaveRoomPersistsBold is the full-loop test: a Y.Doc update
// stamps style.font.bold on a cell; SaveRoom serializes through the
// snapshot path; the reloaded .xlsx still reports bold on that cell.
func TestSaveRoomPersistsBold(t *testing.T) {
	tinyXlsx, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	app := setupPersistTestApp(t)
	itemID := seedDriveItem(t, app, "tiny.xlsx", tinyXlsx)

	rt := NewRuntime()
	handle, err := rt.NewDoc(itemID)
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCellWithBold(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "from-save", "from-save")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}
	if err := SaveRoom(app, handle, itemID, nil); err != nil {
		t.Fatalf("SaveRoom: %v", err)
	}

	reloaded, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		t.Fatalf("reload drive_item: %v", err)
	}
	bytesAfter, err := readDriveItemBytes(app, reloaded)
	if err != nil {
		t.Fatalf("readDriveItemBytes after save: %v", err)
	}
	// makeYDocUpdateForCellWithBold passes sheetName="Sheet1", which
	// renames the on-disk "People" sheet to "Sheet1" via the position
	// match — match the renamed name when reading back.
	if !readCellBold(t, bytesAfter, "Sheet1", 2, 2) {
		t.Fatalf("B2 expected bold after SaveRoom, got non-bold")
	}
	if got := readBackCellInTinyXlsx(t, bytesAfter, 2, 2); got != "from-save" {
		t.Errorf("B2 value after SaveRoom: want %q, got %q", "from-save", got)
	}
}

// TestSaveRoomMissingRecordReturnsError: passing an unknown
// driveItemID surfaces the FindRecordById failure.
func TestSaveRoomMissingRecordReturnsError(t *testing.T) {
	app := setupPersistTestApp(t)
	rt := NewRuntime()
	handle, err := rt.NewDoc("missing-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	if err := SaveRoom(app, handle, "doesnotexist", nil); err == nil {
		t.Fatal("expected SaveRoom on missing record to fail")
	}
}

// TestSaveRoomNilHandleReturnsError: a guard so a misuse from the
// caller side surfaces clearly rather than panicking.
func TestSaveRoomNilHandleReturnsError(t *testing.T) {
	app := setupPersistTestApp(t)
	if err := SaveRoom(app, nil, "any", nil); err == nil {
		t.Fatal("expected nil handle to fail")
	} else if !errors.Is(err, errors.New("calc: SaveRoom called with nil handle")) {
		// errors.Is on a sentinel-less error: just check the message.
		if err.Error() != "calc: SaveRoom called with nil handle" {
			t.Fatalf("wrong error: %v", err)
		}
	}
}

// TestSerializerKindNumber: typed number cells emit excelize numeric
// cells. Excelize stores native numerics with no `t` attribute on the
// cell (the OOXML default), so GetCellType returns CellTypeUnset (0) —
// that's how we distinguish a numeric cell from a string cell, which
// returns CellTypeSharedString or CellTypeInlineString.
func TestSerializerKindNumber(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	n := 42.0
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
				RawNumber: &n,
				Display:   "42",
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellType(t, out, "People", 2, 2); !isNumericCellType(got) {
		t.Errorf("B2 cell type: want numeric (Unset/Number), got %v", got)
	}
	if got := readCell(t, out, "People", 2, 2); got != "42" {
		t.Errorf("B2 value: want %q, got %q", "42", got)
	}
}

// TestSerializerKindNumberFloat: non-integer numbers stay floats; the
// integer-promotion guard only kicks in for whole values.
func TestSerializerKindNumberFloat(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	n := 3.14
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, Kind: "number", RawNumber: &n, Display: "3.14"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellType(t, out, "People", 2, 2); !isNumericCellType(got) {
		t.Errorf("B2 cell type: want numeric (Unset/Number), got %v", got)
	}
	if got := readCell(t, out, "People", 2, 2); got != "3.14" {
		t.Errorf("B2 value: want %q, got %q", "3.14", got)
	}
}

// TestSerializerKindBoolean: typed boolean cells emit as boolean
// cells, not the strings "TRUE"/"FALSE".
func TestSerializerKindBoolean(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	b := true
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, Kind: "boolean", RawBool: &b, Display: "TRUE"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellType(t, out, "People", 2, 2); got != excelize.CellTypeBool {
		t.Errorf("B2 cell type: want bool, got %v", got)
	}
}

// TestSerializerKindDate: typed date cells emit as date-flavored
// numeric cells (excelize stores dates as serial numbers under a date
// numFmt).
func TestSerializerKindDate(t *testing.T) {
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
				Kind:      "date",
				RawString: "2024-01-15",
				Display:   "2024-01-15",
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	// excelize encodes dates as numeric cells under a date numFmt; the
	// underlying CellType is therefore Number. Importantly the cell is
	// *not* the literal string "2024-01-15" — re-parse and confirm.
	if got := readCellType(t, out, "People", 2, 2); got == excelize.CellTypeSharedString {
		t.Errorf("B2 stored as string, expected numeric date encoding")
	}
}

// TestSerializerKindStringDoesNotPromoteToNumber: a string-kinded
// "42" must stay a string in the workbook (the whole point of the
// '-prefix convention).
func TestSerializerKindStringDoesNotPromoteToNumber(t *testing.T) {
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
				Kind:      "string",
				RawString: "42",
				Display:   "42",
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellType(t, out, "People", 2, 2); isNumericCellType(got) {
		t.Errorf("B2 was promoted to number (cell type %v) despite kind=string", got)
	}
	if got := readCell(t, out, "People", 2, 2); got != "42" {
		t.Errorf("B2 value: want %q, got %q", "42", got)
	}
}

// TestSerializerLegacyCellNoKind: a snapshot with empty Kind (a doc
// from before the typed-cell schema landed) falls back to the
// pre-existing "promote numeric strings" coercer so already-saved
// workbooks continue to round-trip as before.
func TestSerializerLegacyCellNoKind(t *testing.T) {
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
			{SheetID: "sheet1", Row: 2, Col: 2, RawString: "42", Display: "42"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	// Legacy promotion: numeric-looking strings become numbers, just
	// like the pre-typed-cells path did.
	if got := readCellType(t, out, "People", 2, 2); !isNumericCellType(got) {
		t.Errorf("legacy B2 cell type: want numeric (promoted), got %v", got)
	}
}

// isNumericCellType returns true when excelize reports the cell as
// numeric. Excelize stores native numerics with no `t` attribute on
// the cell (the OOXML default), which surfaces as CellTypeUnset on
// read; explicit `t="n"` would surface as CellTypeNumber. Treat both
// as "this is a number cell".
func isNumericCellType(t excelize.CellType) bool {
	return t == excelize.CellTypeUnset || t == excelize.CellTypeNumber
}
