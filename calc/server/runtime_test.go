package calc

import (
	"bytes"
	"fmt"
	"os"
	"testing"

	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// buildSheetsUpdate constructs an encodeStateAsUpdate payload off a
// brand-new y-crdt Doc, populated with one sheet meta entry and one
// cell. The bytes are the same wire format real clients emit; tests
// feed them into a server-side handle's ApplyUpdate to exercise the
// real round-trip.
//
// style is optional; when non-nil it's reproduced as nested YMaps
// under cell['style'], mirroring what bootstrapYDocFromWorkbook stamps
// for styled cells.
func buildSheetsUpdate(t testing.TB, sheetID, sheetName string, sheetPos, rowCount, colCount, row, col int, raw, display string, style map[string]any) []byte {
	t.Helper()
	doc := ycrdt.NewDoc("test-builder", false, nil, nil, false)
	sheetsMap := doc.GetMap("sheets").(*ycrdt.YMap)
	cellsMap := doc.GetMap("cells").(*ycrdt.YMap)
	doc.Transact(func(_ *ycrdt.Transaction) {
		meta := ycrdt.NewYMap(nil)
		meta.Set("name", sheetName)
		meta.Set("position", sheetPos)
		meta.Set("rowCount", rowCount)
		meta.Set("colCount", colCount)
		sheetsMap.Set(sheetID, meta)

		cell := ycrdt.NewYMap(nil)
		cell.Set("kind", "string")
		cell.Set("raw", raw)
		cell.Set("display", display)
		if style != nil {
			cell.Set("style", buildStyleYMap(style))
		}
		key := fmt.Sprintf("%s:%d:%d", sheetID, row, col)
		cellsMap.Set(key, cell)
	}, nil)
	out := ycrdt.EncodeStateAsUpdate(doc, nil)
	if len(out) == 0 {
		t.Fatal("buildSheetsUpdate produced empty bytes")
	}
	return out
}

// buildStyleYMap converts a plain Go map into a YMap tree that
// matches the schema bootstrapYDocFromWorkbook (TS) writes — group
// values are nested YMaps, scalars sit at the top level. Recurses
// exactly one level (font / fill / alignment groups + flat numFmt).
func buildStyleYMap(style map[string]any) *ycrdt.YMap {
	root := ycrdt.NewYMap(nil)
	for k, v := range style {
		switch typed := v.(type) {
		case map[string]any:
			group := ycrdt.NewYMap(nil)
			for kk, vv := range typed {
				if vv == nil {
					continue
				}
				group.Set(kk, vv)
			}
			root.Set(k, group)
		default:
			if typed == nil {
				continue
			}
			root.Set(k, typed)
		}
	}
	return root
}

// readBackCellInTinyXlsx parses xlsx bytes through excelize and
// returns the value at (sheet 0, row, col) as a string. Used by
// persist_test.go to assert SaveRoom landed the expected cell value.
func readBackCellInTinyXlsx(t *testing.T, xlsx []byte, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		t.Fatal("xlsx has no sheets")
	}
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	v, err := f.GetCellValue(sheets[0], ref)
	if err != nil {
		t.Fatalf("get cell %s: %v", ref, err)
	}
	return v
}

// makeYDocUpdateForCell builds a y-crdt update with a single string
// cell; persist_test.go uses this to exercise SaveRoom end-to-end.
func makeYDocUpdateForCell(t *testing.T, sheetID, sheetName string, sheetPos, rowCount, colCount, row, col int, raw, display string) []byte {
	t.Helper()
	return buildSheetsUpdate(t, sheetID, sheetName, sheetPos, rowCount, colCount, row, col, raw, display, nil)
}

// makeYDocUpdateForCellWithBold is the bold-aware variant — same as
// makeYDocUpdateForCell but stamps style.font.bold=true on the cell,
// mirroring what a client emits when the user hits the bold button.
func makeYDocUpdateForCellWithBold(t *testing.T, sheetID, sheetName string, sheetPos, rowCount, colCount, row, col int, raw, display string) []byte {
	t.Helper()
	return buildSheetsUpdate(t, sheetID, sheetName, sheetPos, rowCount, colCount, row, col, raw, display, map[string]any{
		"font": map[string]any{"bold": true},
	})
}

// TestRuntimeRoundTrip is the central runtime smoke test:
//
//  1. Build a yjs update on a fresh y-crdt doc that sets B2 = "from-yjs".
//  2. Hand that update to a server-side DocHandle's ApplyUpdate.
//  3. Call Snapshot() to get a Go-native view of the doc.
//  4. Verify the expected sheet + cell entry is present.
func TestRuntimeRoundTrip(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("test-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCell(t,
		"sheet1", "Sheet1", 0, 8, 6,
		2, 2, "from-yjs", "from-yjs",
	)

	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if len(state) == 0 {
		t.Fatal("expected non-empty encoded state after ApplyUpdate")
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Sheets) != 1 {
		t.Fatalf("snapshot sheets: want 1, got %d (%+v)", len(snap.Sheets), snap.Sheets)
	}
	if snap.Sheets[0].ID != "sheet1" || snap.Sheets[0].Name != "Sheet1" {
		t.Fatalf("snapshot sheet meta: %+v", snap.Sheets[0])
	}
	if len(snap.Cells) != 1 {
		t.Fatalf("snapshot cells: want 1, got %d", len(snap.Cells))
	}
	if got := snap.Cells[0]; got.SheetID != "sheet1" || got.Row != 2 || got.Col != 2 || got.RawString != "from-yjs" {
		t.Fatalf("snapshot cell: %+v", got)
	}
	if got := snap.Cells[0]; got.Kind != "string" {
		t.Fatalf("snapshot cell kind: want %q, got %q", "string", got.Kind)
	}
}

// TestRuntimeMultipleApplyUpdates: applying two updates in sequence
// composes correctly — both edits show up in the snapshot.
func TestRuntimeMultipleApplyUpdates(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("multi-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	u1 := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "v-one", "v-one")
	u2 := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 3, 2, "v-two", "v-two")

	if err := handle.ApplyUpdate(u1); err != nil {
		t.Fatalf("ApplyUpdate u1: %v", err)
	}
	if err := handle.ApplyUpdate(u2); err != nil {
		t.Fatalf("ApplyUpdate u2: %v", err)
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	cells := map[string]CellEntry{}
	for _, c := range snap.Cells {
		cells[fmt.Sprintf("%s:%d:%d", c.SheetID, c.Row, c.Col)] = c
	}
	if got, ok := cells["sheet1:2:2"]; !ok || got.RawString != "v-one" {
		t.Errorf("B2 in snapshot: ok=%v got=%+v", ok, got)
	}
	if got, ok := cells["sheet1:3:2"]; !ok || got.RawString != "v-two" {
		t.Errorf("B3 in snapshot: ok=%v got=%+v", ok, got)
	}
}

// TestServerRoundtripBoldUpdate: encoding the server-side mirror back
// into bytes and applying those to a fresh peer doc must succeed —
// catches schema-mishandling regressions where the encoded reply
// would fail to decode on the client.
func TestServerRoundtripBoldUpdate(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("rt-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCellWithBold(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "bold-cell", "bold-cell")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}
	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if len(state) == 0 {
		t.Fatal("EncodeStateAsUpdate produced empty bytes")
	}

	rt2 := NewRuntime()
	peer, err := rt2.NewDoc("peer-room")
	if err != nil {
		t.Fatalf("peer NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.ApplyUpdate(state); err != nil {
		t.Fatalf("peer ApplyUpdate: %v", err)
	}

	peerSnap, err := peer.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("peer Snapshot: %v", err)
	}
	if len(peerSnap.Cells) != 1 {
		t.Fatalf("peer snapshot cells: want 1, got %d", len(peerSnap.Cells))
	}
	if peerSnap.Cells[0].Style == nil || peerSnap.Cells[0].Style.Font == nil ||
		peerSnap.Cells[0].Style.Font.Bold == nil || !*peerSnap.Cells[0].Style.Font.Bold {
		t.Fatalf("peer snapshot lost bold style: %+v", peerSnap.Cells[0])
	}
}

// TestSnapshotExtractsBoldStyle: a Y.Doc cell whose style.font.bold
// is true must surface as snap.Cells[0].Style.Font.Bold = &true.
func TestSnapshotExtractsBoldStyle(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("style-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCellWithBold(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "bold-cell", "bold-cell")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Cells) != 1 {
		t.Fatalf("snapshot cells: want 1, got %d", len(snap.Cells))
	}
	c := snap.Cells[0]
	if c.Style == nil {
		t.Fatalf("snapshot cell missing Style: %+v", c)
	}
	if c.Style.Font == nil {
		t.Fatalf("snapshot cell missing Style.Font: %+v", *c.Style)
	}
	if c.Style.Font.Bold == nil || !*c.Style.Font.Bold {
		t.Fatalf("snapshot cell Style.Font.Bold: want &true, got %+v", c.Style.Font.Bold)
	}
}

// TestSnapshotNoStyleProducesNilStyle: a vanilla cell without a style
// entry must surface as Style == nil so the serializer leaves the
// existing on-disk style alone.
func TestSnapshotNoStyleProducesNilStyle(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("nostyle-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 1, 1, "x", "x")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Cells) != 1 {
		t.Fatalf("snapshot cells: want 1, got %d", len(snap.Cells))
	}
	if snap.Cells[0].Style != nil {
		t.Fatalf("expected nil Style, got %+v", *snap.Cells[0].Style)
	}
}

// TestRuntimeCloseRejectsLaterCalls: every method on a closed handle
// must return an error rather than silently returning empty results.
func TestRuntimeCloseRejectsLaterCalls(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("close-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	if err := handle.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := handle.(*sheetsDocHandle).Snapshot(); err == nil {
		t.Fatal("expected Snapshot after Close to fail, got nil")
	}
	if err := handle.ApplyUpdate([]byte{0}); err == nil {
		t.Fatal("expected ApplyUpdate after Close to fail, got nil")
	}
	if _, err := handle.EncodeStateAsUpdate(); err == nil {
		t.Fatal("expected EncodeStateAsUpdate after Close to fail, got nil")
	}
	// Sentinel use of tinyXlsxPath so the fixture path stays
	// exercised across tests.
	if _, err := os.Stat(tinyXlsxPath); err != nil {
		t.Fatalf("fixture missing: %v", err)
	}
}

// TestRuntimeNewDocDuplicateRoom: minting two handles for the same
// roomID should fail rather than silently creating two diverging
// docs that the broker would race against.
func TestRuntimeNewDocDuplicateRoom(t *testing.T) {
	rt := NewRuntime()
	first, err := rt.NewDoc("dup-room")
	if err != nil {
		t.Fatalf("first NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = first.Close() })
	if _, err := rt.NewDoc("dup-room"); err == nil {
		t.Fatal("expected second NewDoc on same roomID to fail, got nil")
	}
}

// TestCollectSheetsDecodesRowHeightsAndColWidths verifies that a
// sheet meta carrying nested rowHeights/colWidths Y.Maps round-trips
// through collectSheets into populated SheetMeta fields.
func TestCollectSheetsDecodesRowHeightsAndColWidths(t *testing.T) {
	doc := ycrdt.NewDoc("test", false, nil, nil, false)
	sheetsMap, _ := doc.GetMap("sheets").(*ycrdt.YMap)

	meta := ycrdt.NewYMap(nil)
	meta.Set("name", "People")
	meta.Set("position", 0)
	meta.Set("rowCount", 50)
	meta.Set("colCount", 10)

	rowHeights := ycrdt.NewYMap(nil)
	rowHeights.Set("2", 60)
	rowHeights.Set("5", 100)
	meta.Set("rowHeights", rowHeights)

	colWidths := ycrdt.NewYMap(nil)
	colWidths.Set("3", 200)
	meta.Set("colWidths", colWidths)

	sheetsMap.Set("sheet1", meta)

	sheets, err := collectSheets(sheetsMap)
	if err != nil {
		t.Fatalf("collectSheets: %v", err)
	}
	if len(sheets) != 1 {
		t.Fatalf("collectSheets count: want 1, got %d", len(sheets))
	}
	s := sheets[0]
	if s.RowCount != 50 || s.ColCount != 10 {
		t.Errorf("RowCount/ColCount: want 50/10, got %d/%d", s.RowCount, s.ColCount)
	}
	if s.RowHeights[2] != 60 || s.RowHeights[5] != 100 {
		t.Errorf("RowHeights: want {2:60, 5:100}, got %v", s.RowHeights)
	}
	if s.ColWidths[3] != 200 {
		t.Errorf("ColWidths: want {3:200}, got %v", s.ColWidths)
	}
}

// TestCollectSheetsDecodesRowStyles verifies that a sheet meta with
// nested rowStyles (Y.Map<string, Y.Map>) round-trips through
// collectSheets into populated SheetMeta.RowStyles entries.
func TestCollectSheetsDecodesRowStyles(t *testing.T) {
	doc := ycrdt.NewDoc("test", false, nil, nil, false)
	sheetsMap, _ := doc.GetMap("sheets").(*ycrdt.YMap)

	meta := ycrdt.NewYMap(nil)
	meta.Set("name", "People")
	meta.Set("position", 0)

	rowStyles := ycrdt.NewYMap(nil)
	rowStyle := ycrdt.NewYMap(nil)
	fontGroup := ycrdt.NewYMap(nil)
	fontGroup.Set("bold", true)
	rowStyle.Set("font", fontGroup)
	rowStyles.Set("7", rowStyle)
	meta.Set("rowStyles", rowStyles)

	sheetsMap.Set("sheet1", meta)

	sheets, err := collectSheets(sheetsMap)
	if err != nil {
		t.Fatalf("collectSheets: %v", err)
	}
	if len(sheets) != 1 {
		t.Fatalf("sheets count: want 1, got %d", len(sheets))
	}
	cs := sheets[0].RowStyles[7]
	if cs == nil || cs.Font == nil || cs.Font.Bold == nil || !*cs.Font.Bold {
		t.Errorf("row 7 style.font.bold: want true, got %+v", cs)
	}
}

// TestRuntimeApplyMalformedUpdateDoesNotCrash: y-crdt logs and
// silently returns on bad bytes (it does not bubble decode errors up
// to ApplyUpdate's caller). The runtime must at least not crash the
// broker goroutine on hostile client input — this asserts that
// behavior so a future y-crdt change to start panicking gets caught.
func TestRuntimeApplyMalformedUpdateDoesNotCrash(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("malformed-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	if err := handle.ApplyUpdate([]byte{0xFF, 0xFE, 0xFD, 0x01, 0x02}); err != nil {
		t.Fatalf("ApplyUpdate: unexpected error from malformed bytes: %v", err)
	}
	// Subsequent operations on the same handle still work — the bad
	// input didn't poison the doc.
	if _, err := handle.EncodeStateAsUpdate(); err != nil {
		t.Fatalf("EncodeStateAsUpdate after malformed input: %v", err)
	}
}
