package calc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/xuri/excelize/v2"

	"tinycld.org/core/realtime"
)

// driveItemsCollection is the PocketBase collection where spreadsheet
// blobs live. The roomID handed to a sheets RealtimeRoom IS the
// drive_items.id.
const driveItemsCollection = "drive_items"

// SaveRoom serializes the current state of the room's server-side
// Y.Doc back into the source XLSX, writing the result to the
// drive_items record's `file` field.
//
// Failures are returned as errors but never panic. The caller (the
// SaveCoordinator running off a broker hook) is expected to log and
// retry; nothing here mutates the Y.Doc, so the room can re-attempt
// against the same in-memory state on the next trigger.
//
// The handle parameter is the room's DocHandle as returned by
// Runtime.NewDoc; we type-assert to *sheetsDocHandle to access the
// Snapshot method (not part of the realtime.DocHandle interface
// because XLSX-flavored snapshots are calc-specific).
//
// loadComments is optional; when nil the saved xlsx omits cell-comment
// rendering. Tests pass nil; production wiring (MakeProductionFlush)
// supplies MakeProductionLoadComments(app).
func SaveRoom(app core.App, handle realtime.DocHandle, driveItemID string, loadComments LoadCommentsFn) error {
	if handle == nil {
		return errors.New("calc: SaveRoom called with nil handle")
	}
	sh, ok := handle.(*sheetsDocHandle)
	if !ok {
		return fmt.Errorf("calc: SaveRoom expected *sheetsDocHandle, got %T", handle)
	}

	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return fmt.Errorf("calc: load drive_items %s: %w", driveItemID, err)
	}

	originalBytes, err := readDriveItemBytes(app, item)
	if err != nil {
		return fmt.Errorf("calc: read existing file for %s: %w", driveItemID, err)
	}

	snap, err := sh.Snapshot()
	if err != nil {
		return fmt.Errorf("calc: snapshot Y.Doc for %s: %w", driveItemID, err)
	}

	var comments []CommentRow
	if loadComments != nil {
		comments, err = loadComments(driveItemID)
		if err != nil {
			return fmt.Errorf("calc: load comments for %s: %w", driveItemID, err)
		}
	}

	updatedBytes, err := serializeSnapshotToXLSX(originalBytes, snap, comments)
	if err != nil {
		return fmt.Errorf("calc: serialize Y.Doc for %s: %w", driveItemID, err)
	}
	if len(updatedBytes) == 0 {
		return fmt.Errorf("calc: serializer produced empty bytes for %s", driveItemID)
	}

	// Reuse the original filename so URLs / mime detection stay
	// consistent. PocketBase will rename the on-disk blob to a fresh
	// hash on save, so the prior blob isn't overwritten in place.
	filename := item.GetString("file")
	if filename == "" {
		filename = "spreadsheet.xlsx"
	}
	f, err := filesystem.NewFileFromBytes(updatedBytes, filename)
	if err != nil {
		return fmt.Errorf("calc: build filesystem.File for %s: %w", driveItemID, err)
	}
	item.Set("file", f)
	item.Set("size", len(updatedBytes))

	if err := app.Save(item); err != nil {
		return fmt.Errorf("calc: save drive_items %s: %w", driveItemID, err)
	}
	return nil
}

// serializeWorkbook is the model-only serialization path: build a fresh
// xlsx from a WorkbookModel (including pivot defs), without needing a
// Y.Doc. Used by tests; production goes through serializeSnapshotToXLSX.
func serializeWorkbook(model WorkbookModel) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	// Replace the default Sheet1 with the first model sheet's name, so
	// the workbook starts cleanly named.
	if len(model.Sheets) > 0 {
		_ = f.SetSheetName("Sheet1", model.Sheets[0].Name)
	}

	for i, s := range model.Sheets {
		if i > 0 {
			if _, err := f.NewSheet(s.Name); err != nil {
				return nil, fmt.Errorf("new sheet %q: %w", s.Name, err)
			}
		}
		// Write each cell at its (row,col).
		for key, v := range s.Cells {
			r, c := parseModelCellKey(key)
			if r < 1 || c < 1 {
				continue
			}
			ref, err := excelize.CoordinatesToCellName(c, r)
			if err != nil {
				continue
			}
			if err := writeModelCell(f, s.Name, ref, v); err != nil {
				return nil, err
			}
		}
	}

	writePivots(f, model.Pivots)

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, fmt.Errorf("write xlsx: %w", err)
	}
	return buf.Bytes(), nil
}

// writePivots emits each pivot definition as an excelize PivotTable on
// the workbook. Shared between serializeWorkbook (model-only path) and
// serializeSnapshotToXLSX (snapshot-on-disk-bytes path) so both paths
// agree on field mapping, naming, and the "skip when Values is empty"
// rule.
//
// Behavior:
//   - Pivots with no Values are skipped silently (excelize requires at
//     least one Data field; v1 surfaces the def to clients via the
//     Y.Doc but doesn't try to materialize it in xlsx).
//   - AddPivotTable failures are logged and skipped rather than fatal,
//     so a single malformed def doesn't poison the whole save. The
//     Y.Doc keeps the original def around for the next attempt.
//   - excelize v2.10.1 quirk: PivotTableRange / DataRange want the
//     bare sheet name, even when it contains spaces — single-quoting
//     breaks the parser's lookup against the workbook.
//
// Order is significant in excelize (pivot caches share workbook-level
// IDs), so the caller's slice order is preserved verbatim.
func writePivots(f *excelize.File, pivots []PivotDefinitionDTO) {
	for _, p := range pivots {
		if len(p.Values) == 0 {
			continue
		}
		opts := &excelize.PivotTableOptions{
			DataRange:           p.SourceRange,
			PivotTableRange:     fmt.Sprintf("%s!A1:Z200", p.TargetSheetName),
			Rows:                toExcelizeFields(p.Rows, false, ""),
			Columns:             toExcelizeFields(p.Cols, false, ""),
			Data:                toExcelizeValueFields(p.Values),
			Filter:              toExcelizeFields(p.Filters, false, ""),
			RowGrandTotals:      p.RowGrandTotals,
			ColGrandTotals:      p.ColGrandTotals,
			PivotTableStyleName: p.StyleName,
		}
		if err := f.AddPivotTable(opts); err != nil {
			fmt.Printf("calc: AddPivotTable %q: %v\n", p.ID, err)
			continue
		}
	}
}

func toExcelizeFields(in []PivotFieldDTO, _ bool, _ string) []excelize.PivotTableField {
	out := make([]excelize.PivotTableField, 0, len(in))
	for _, f := range in {
		out = append(out, excelize.PivotTableField{Data: f.SourceColumn, Name: f.DisplayName})
	}
	return out
}

// toExcelizeValueFields intentionally does NOT propagate v.NumFmt onto
// excelize.PivotTableField.NumFmt. The excelize field is `int` (built-in
// numFmt ID 0..49); a free-form pattern string has no representation
// there. See docs/pivot.md "Per-value numFmt round-trip" for the
// documented divergence.
func toExcelizeValueFields(in []PivotValueFieldDTO) []excelize.PivotTableField {
	out := make([]excelize.PivotTableField, 0, len(in))
	for _, v := range in {
		out = append(out, excelize.PivotTableField{
			Data:     v.SourceColumn,
			Name:     v.DisplayName,
			Subtotal: excelizeSubtotal(v.Aggregation),
		})
	}
	return out
}

func excelizeSubtotal(agg string) string {
	switch agg {
	case "sum":
		return "Sum"
	case "average":
		return "Average"
	case "count":
		return "Count"
	case "countNums":
		return "CountNums"
	case "max":
		return "Max"
	case "min":
		return "Min"
	case "product":
		return "Product"
	case "stdDev":
		return "StdDev"
	case "stdDevp":
		return "StdDevp"
	case "var":
		return "Var"
	case "varp":
		return "Varp"
	}
	return "Sum"
}

// parseModelCellKey parses the "row:col" keys used by
// WorksheetModel.Cells (a different shape from runtime.go's
// parseCellKey, which takes a 3-part "sheetID:row:col"). Returns
// (0,0) on any malformed input — callers treat that as "skip".
func parseModelCellKey(key string) (row, col int) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return 0, 0
	}
	r, errR := strconv.Atoi(parts[0])
	c, errC := strconv.Atoi(parts[1])
	if errR != nil || errC != nil {
		return 0, 0
	}
	return r, c
}

func writeModelCell(f *excelize.File, sheet, ref string, v CellValueDTO) error {
	if v.Formula != "" {
		return f.SetCellFormula(sheet, ref, v.Formula)
	}
	switch v.Kind {
	case "number":
		if n, ok := v.Raw.(float64); ok {
			return f.SetCellFloat(sheet, ref, n, -1, 64)
		}
	case "boolean":
		if b, ok := v.Raw.(bool); ok {
			return f.SetCellBool(sheet, ref, b)
		}
	}
	if s, ok := v.Raw.(string); ok && s != "" {
		return f.SetCellStr(sheet, ref, s)
	}
	if v.Display != "" {
		return f.SetCellStr(sheet, ref, v.Display)
	}
	return nil
}

// serializeSnapshotToXLSX reads the original .xlsx bytes, applies the
// Y.Doc snapshot's sheet metadata + cell entries on top, and returns
// the rewritten .xlsx bytes.
//
// Behavior:
//   - Sheets are ordered by SheetMeta.Position (the snapshot producer
//     pre-sorts; we use slice index as the position in the output).
//   - Sheets present in the snapshot but not in the original workbook
//     are appended via NewSheet.
//   - Sheets present in the original workbook with a different name in
//     the snapshot are renamed.
//   - Per-sheet metadata applied after rename/create and before cells:
//     RowCount/ColCount widen the workbook's <dimension> to the union
//     of snapshot and existing extents (never shrink); RowHeights and
//     ColWidths apply px-to-Excel-unit conversions onto SetRowHeight/
//     SetColWidth (px=0 hides the row/column, mirroring the TS-side
//     hide-snap thresholds); RowStyles overwrite the row's xlsx style
//     with the Y.Doc state (per-cell styles still layer on top).
//   - For each cell: if Formula is non-empty, write the formula via
//     SetCellFormula; otherwise write the value (Raw, falling back to
//     Display).
//   - Cells in the original workbook that the snapshot does NOT have
//     an entry for are cleared (value + formula). The Y.Doc is seeded
//     from a complete walk of the source workbook on bootstrap, so a
//     missing snapshot entry reflects a real client-side deletion
//     (delete-rows, delete-columns, clear-contents, sort that wrote
//     null tuples into trailing slots) rather than an untracked cell.
//     The deletion pass runs per-sheet via GetRows before the cell
//     writes below; the writes then re-seed whatever the snapshot
//     does carry.
//   - When comments is non-empty, classic xlsx cell notes are written
//     for each thread via applyCommentsToFile (one-way: app → xlsx).
//     Existing cell notes from external editors are overwritten.
//
// Returns an error rather than empty bytes on any sheet/cell write
// failure; the caller treats both alike.
func serializeSnapshotToXLSX(originalBytes []byte, snap YDocSnapshot, comments []CommentRow) ([]byte, error) {
	if len(originalBytes) == 0 {
		return nil, errors.New("calc: serializeSnapshotToXLSX called with empty original bytes")
	}
	f, err := excelize.OpenReader(bytes.NewReader(originalBytes))
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	defer func() { _ = f.Close() }()

	// existingSheets is the workbook's sheets in their on-disk order;
	// we line them up positionally with the snapshot's sorted slice.
	existingSheets := f.GetSheetList()

	// Map snapshot sheet id → resolved excelize sheet name. New sheets
	// take SheetMeta.Name verbatim; renamed existing sheets take the
	// updated name as well.
	sheetNameByID := make(map[string]string, len(snap.Sheets))
	for i, meta := range snap.Sheets {
		switch {
		case i < len(existingSheets):
			oldName := existingSheets[i]
			if meta.Name != "" && meta.Name != oldName {
				if err := f.SetSheetName(oldName, meta.Name); err != nil {
					return nil, fmt.Errorf("rename sheet %q -> %q: %w", oldName, meta.Name, err)
				}
				sheetNameByID[meta.ID] = meta.Name
			} else {
				sheetNameByID[meta.ID] = oldName
			}
		default:
			name := meta.Name
			if name == "" {
				name = meta.ID
			}
			if _, err := f.NewSheet(name); err != nil {
				return nil, fmt.Errorf("add sheet %q: %w", name, err)
			}
			sheetNameByID[meta.ID] = name
		}
	}

	// Second pass: now that every sheet has its final name, write
	// dimensions for any sheet whose snapshot carries non-zero counts,
	// and apply any row/column size customizations the user made.
	//
	// The heights/widths pass applies EVEN when RowCount/ColCount are
	// zero (a user could resize a column without scrolling any rows), so
	// we iterate all snapshot sheets and make the dimension write
	// conditional on non-zero counts only.
	for _, meta := range snap.Sheets {
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		if meta.RowCount > 0 && meta.ColCount > 0 {
			// Union with the workbook's existing <dimension>: the Y.Doc
			// may track a narrower extent than the imported file actually
			// contains (e.g. when bootstrap sees only a scrolled-into
			// region), and a contracting save would silently hide rows
			// past meta.RowCount from readers that trust <dimension>.
			// Always grow, never shrink.
			existingRef, err := f.GetSheetDimension(name)
			if err != nil {
				return nil, fmt.Errorf("get existing dimension on %s: %w", name, err)
			}
			existingCol, existingRow := parseDimensionRef(existingRef)
			finalCol := max(meta.ColCount, existingCol)
			finalRow := max(meta.RowCount, existingRow)
			bottomRight, err := excelize.CoordinatesToCellName(finalCol, finalRow)
			if err != nil {
				return nil, fmt.Errorf("dimension coords (col=%d,row=%d): %w", finalCol, finalRow, err)
			}
			if err := f.SetSheetDimension(name, "A1:"+bottomRight); err != nil {
				return nil, fmt.Errorf("set dimension on %s: %w", name, err)
			}
		}
		// Enumerate the sheet's existing per-row / per-column
		// customizations once so each clear-then-write helper below
		// only walks the small (existingCustom ∪ snapshotKeys) set
		// rather than the dense 1..maxRow / 1..maxCol range.
		//
		// Why it matters: every mutation API in excelize
		// (SetRowHeight, SetRowStyle, SetCellValue, …) routes through
		// an internal backfill step that extends the worksheet's
		// in-memory row slice up to the touched row, allocating a
		// placeholder xlsxRow for every gap. A dense walk over
		// 1..dimensionExtent triggers that backfill for every
		// uncustomized row in the sheet — wasteful in CPU and
		// allocations even when the on-disk output ends up small
		// after trimRow filtering, and visibly bloating when the
		// helper (SetRowStyle) sets CustomFormat=true on the
		// placeholder, which trimRow keeps.
		//
		// One enumeration covers both row heights and row styles
		// because excelize's Rows() iterator surfaces both Height
		// and StyleID in a single streaming pass over the sheet XML.
		existingHeightRows, existingStyleRows, err := existingCustomRowOpts(f, name)
		if err != nil {
			return nil, fmt.Errorf("enumerate custom row opts on %s: %w", name, err)
		}
		existingWidthCols, err := existingCustomCols(f, name, meta.ColCount)
		if err != nil {
			return nil, fmt.Errorf("enumerate custom col widths on %s: %w", name, err)
		}
		// Row heights / col widths follow the snapshot-is-authoritative
		// contract for tri-state sparse maps (see SheetMeta docstring).
		// Nil ⇒ the Y.Doc has no nested map ⇒ preserve on-disk values
		// (legacy bootstraps). Non-nil ⇒ the Y.Doc tracks this field ⇒
		// clear any on-disk customization not in the map, then write
		// the map entries.
		//
		// px==0 is a deliberate value (snap-to-hide), not an absence:
		// the TS side's HIDE_SNAP_THRESHOLD rounds small drag widths to
		// 0 so excelize's SetRowHeight/SetColWidth=0 hides the row/col.
		// The serializer treats px<0 as an out-of-band sentinel and
		// skips it.
		if err := applySparseRowHeights(f, name, meta.RowHeights, existingHeightRows); err != nil {
			return nil, err
		}
		if err := applySparseColWidths(f, name, meta.ColWidths, existingWidthCols); err != nil {
			return nil, err
		}
		// Merges: unmerge anything that the workbook already has on this
		// sheet (excelize has no "set merges" call — only Add/Remove),
		// then re-merge from the snapshot. This makes the snapshot
		// authoritative without requiring the caller to track diffs.
		existingMerges, _ := f.GetMergeCells(name)
		for _, mc := range existingMerges {
			_ = f.UnmergeCell(name, mc.GetStartAxis(), mc.GetEndAxis())
		}
		for _, m := range meta.Merges {
			if m.RowSpan < 1 || m.ColSpan < 1 {
				continue
			}
			if m.RowSpan == 1 && m.ColSpan == 1 {
				continue
			}
			fromCell, err := excelize.CoordinatesToCellName(m.AnchorCol, m.AnchorRow)
			if err != nil {
				return nil, fmt.Errorf("merge from coords (%d,%d): %w", m.AnchorCol, m.AnchorRow, err)
			}
			toCell, err := excelize.CoordinatesToCellName(
				m.AnchorCol+m.ColSpan-1,
				m.AnchorRow+m.RowSpan-1,
			)
			if err != nil {
				return nil, fmt.Errorf("merge to coords: %w", err)
			}
			if err := f.MergeCell(name, fromCell, toCell); err != nil {
				return nil, fmt.Errorf("merge %s!%s:%s: %w", name, fromCell, toCell, err)
			}
		}

		// Freeze panes: write the xlsx <pane> via excelize.SetPanes when
		// the snapshot has any freeze. Both axes are independent;
		// XSplit=0/YSplit=0 means "no freeze on that axis". When both
		// are zero we explicitly clear any prior freeze (Freeze:false)
		// so an unfreeze on the doc round-trips back to a freeze-less
		// xlsx. The TopLeftCell + ActivePane fields keep Excel happy
		// when it reopens the file.
		if meta.FrozenRows > 0 || meta.FrozenCols > 0 {
			topLeft, err := excelize.CoordinatesToCellName(meta.FrozenCols+1, meta.FrozenRows+1)
			if err != nil {
				return nil, fmt.Errorf("freeze top-left coords on %s: %w", name, err)
			}
			activePane := "bottomRight"
			if meta.FrozenCols == 0 {
				activePane = "bottomLeft"
			} else if meta.FrozenRows == 0 {
				activePane = "topRight"
			}
			if err := f.SetPanes(name, &excelize.Panes{
				Freeze:      true,
				XSplit:      meta.FrozenCols,
				YSplit:      meta.FrozenRows,
				TopLeftCell: topLeft,
				ActivePane:  activePane,
			}); err != nil {
				return nil, fmt.Errorf("set panes on %s: %w", name, err)
			}
		} else {
			// Explicit unfreeze: clears any existing on-disk pane so
			// round-tripping a doc that started frozen and got
			// unfrozen produces a freeze-less xlsx.
			if err := f.SetPanes(name, &excelize.Panes{Freeze: false, Split: false}); err != nil {
				return nil, fmt.Errorf("clear panes on %s: %w", name, err)
			}
		}
		// Row styles follow the same snapshot-is-authoritative contract
		// as row heights / col widths above. Nil ⇒ preserve on-disk;
		// non-nil ⇒ clear any on-disk row style not in the map, then
		// write the entries. Per-cell styles layer on top in Excel's
		// render model, so the row-level clear here doesn't affect
		// individual cells' own styles applied in the cells pass below.
		if err := applySparseRowStyles(f, name, meta.RowStyles, existingStyleRows); err != nil {
			return nil, err
		}

		// Tab color: the Y.Doc is authoritative once a workbook has been
		// bootstrapped (BootstrapYDocFromWorkbook seeds the imported
		// xlsx's TabColorRGB into the doc). Empty Color ⇒ clear any
		// prior tab color so a user-side unset round-trips; non-empty ⇒
		// stamp it via SheetPropsOptions.TabColorRGB. excelize accepts
		// the hex with or without the leading "#"; we strip it for
		// portability with older sheet readers that store the bare RGB.
		if meta.Color != "" {
			rgb := strings.TrimPrefix(meta.Color, "#")
			if err := f.SetSheetProps(name, &excelize.SheetPropsOptions{
				TabColorRGB: &rgb,
			}); err != nil {
				return nil, fmt.Errorf("set tab color on %s: %w", name, err)
			}
		} else {
			empty := ""
			if err := f.SetSheetProps(name, &excelize.SheetPropsOptions{
				TabColorRGB: &empty,
			}); err != nil {
				return nil, fmt.Errorf("clear tab color on %s: %w", name, err)
			}
		}
	}

	// Visibility pass: applied AFTER every sheet write so the count of
	// visible sheets is accurate. SetSheetVisible refuses to hide the
	// only remaining visible sheet — that's a workbook-level rule, not
	// our own. Sheets the snapshot wants visible (Hidden=false) get
	// explicitly re-shown so a Y.Doc unhide propagates.
	for _, meta := range snap.Sheets {
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		if err := f.SetSheetVisible(name, !meta.Hidden); err != nil {
			return nil, fmt.Errorf("set sheet visible on %s: %w", name, err)
		}
	}

	// Final pass: drop any sheets that exist on disk but the snapshot
	// no longer references. Without this, a sheet deleted via the
	// sheet-management UI would persist in the saved xlsx — the
	// positional rename pass above would either rename it to something
	// new (if the snapshot has a sheet at that index) or leave it
	// alone (if there are fewer snapshot sheets than disk sheets).
	keptNames := make(map[string]struct{}, len(sheetNameByID))
	for _, name := range sheetNameByID {
		keptNames[name] = struct{}{}
	}
	for _, name := range f.GetSheetList() {
		if _, kept := keptNames[name]; kept {
			continue
		}
		if err := f.DeleteSheet(name); err != nil {
			return nil, fmt.Errorf("delete sheet %s: %w", name, err)
		}
	}

	// Build the per-sheet set of (row, col) keys the snapshot carries
	// so we can clear any source-workbook cell the snapshot has dropped.
	// Encoding row/col as int64 (row << 32 | col) keeps the key cheap
	// and unambiguous for the worksheet's million-row/16k-column limit.
	snapshotCellsBySheet := make(map[string]map[int64]struct{}, len(sheetNameByID))
	for _, cell := range snap.Cells {
		sheetName, ok := sheetNameByID[cell.SheetID]
		if !ok || cell.Row <= 0 || cell.Col <= 0 {
			continue
		}
		set, exists := snapshotCellsBySheet[sheetName]
		if !exists {
			set = make(map[int64]struct{})
			snapshotCellsBySheet[sheetName] = set
		}
		set[int64(cell.Row)<<32|int64(cell.Col)] = struct{}{}
	}

	// Per-sheet deletion pass: walk the workbook's existing cells and
	// blank any cell the snapshot no longer carries. Without this,
	// row/column deletions and clear-contents would silently bounce
	// back on reload because the original .xlsx bytes still hold those
	// values. GetRows skips truly-empty rows so the cost scales with
	// populated cells, not the worksheet's nominal dimension.
	for _, name := range f.GetSheetList() {
		rows, err := f.GetRows(name)
		if err != nil {
			return nil, fmt.Errorf("read rows on %s for delete pass: %w", name, err)
		}
		set := snapshotCellsBySheet[name]
		for rowIdx, row := range rows {
			rowNumber := rowIdx + 1
			for colIdx, value := range row {
				if value == "" {
					continue
				}
				colNumber := colIdx + 1
				key := int64(rowNumber)<<32 | int64(colNumber)
				if _, kept := set[key]; kept {
					continue
				}
				ref, err := excelize.CoordinatesToCellName(colNumber, rowNumber)
				if err != nil {
					return nil, fmt.Errorf("delete-pass cell coords (%d,%d): %w", colNumber, rowNumber, err)
				}
				if err := f.SetCellValue(name, ref, nil); err != nil {
					return nil, fmt.Errorf("clear stale cell at %s!%s: %w", name, ref, err)
				}
			}
		}
	}

	for _, cell := range snap.Cells {
		sheetName, ok := sheetNameByID[cell.SheetID]
		if !ok {
			// Snapshot referred to a sheet id we never registered.
			// Skip rather than fail — better to write the rest than
			// reject the whole save over an orphan cell.
			continue
		}
		if cell.Row <= 0 || cell.Col <= 0 {
			continue
		}
		ref, err := excelize.CoordinatesToCellName(cell.Col, cell.Row)
		if err != nil {
			return nil, fmt.Errorf("cell coords (%d,%d): %w", cell.Col, cell.Row, err)
		}
		if cell.Formula != "" {
			// Seed the cached value first so non-evaluating readers see
			// something; SetCellFormula attaches the formula on top
			// without clearing it. Calling SetCellValue *after*
			// SetCellFormula would erase the formula.
			if cached, ok := formulaCachedValue(cell); ok {
				if err := f.SetCellValue(sheetName, ref, cached); err != nil {
					return nil, fmt.Errorf("seed formula result at %s!%s: %w", sheetName, ref, err)
				}
			}
			if err := f.SetCellFormula(sheetName, ref, cell.Formula); err != nil {
				return nil, fmt.Errorf("set formula at %s!%s: %w", sheetName, ref, err)
			}
		} else {
			if err := f.SetCellValue(sheetName, ref, cellValueForExcelize(cell)); err != nil {
				return nil, fmt.Errorf("set value at %s!%s: %w", sheetName, ref, err)
			}
		}
		if cell.Style != nil {
			if err := applyCellStyle(f, sheetName, ref, cell.Style); err != nil {
				return nil, fmt.Errorf("apply style at %s!%s: %w", sheetName, ref, err)
			}
		}
	}

	if len(comments) > 0 {
		if err := applyCommentsToFile(f, comments, sheetNameByID); err != nil {
			return nil, fmt.Errorf("apply comments: %w", err)
		}
	}

	// Apply conditional-formatting rules per sheet. Done after the
	// per-cell value/style writes so the dxf style indices excelize
	// generates here don't collide with cell-style indices, and
	// before pivots so pivot output ranges can carry their own
	// conditional formats if a future enhancement wants that.
	for _, meta := range snap.Sheets {
		if len(meta.ConditionalFormats) == 0 {
			continue
		}
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		if err := writeConditionalFormats(f, name, meta.ConditionalFormats); err != nil {
			return nil, fmt.Errorf("write conditional formats on %s: %w", name, err)
		}
	}

	// Emit pivots last so all cells and sheets the pivot defs reference
	// (both source ranges and target sheets) are present in the workbook
	// by the time AddPivotTable runs.
	writePivots(f, snap.Pivots)

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return buf.Bytes(), nil
}

// existingCustomRowOpts streams the sheet's rows via excelize.Rows()
// and returns two sets of 1-based row numbers: rows whose stored
// height differs from the xlsx default, and rows whose StyleID is
// non-zero. One pass produces both because the streaming iterator
// surfaces Height + StyleID in the same XML stream.
//
// The serializer's clear-then-write helpers use these sets to bound
// their clear pass to rows that actually have a customization to
// clear. Without that bound, the helpers walked 1..dimensionRowExtent
// and called SetRowHeight(-1) / SetRowStyle(_,_,0) on every row, each
// call triggering excelize's in-memory backfill (it densifies the
// worksheet's row slice up to the touched row, allocating a
// placeholder for every gap). A 50k-row <dimension> sheet with no
// customizations would allocate 50k placeholder rows on every save,
// and the row-style clear path also marks each placeholder with
// CustomFormat=true so the bloat survives excelize's marshal-time
// trimRow filter and shows up as 50k <row> entries on disk.
//
// Returns empty (non-nil) sets on success when nothing is customized;
// callers can treat that as "nothing to clear" without a nil check.
func existingCustomRowOpts(f *excelize.File, sheet string) (map[int]struct{}, map[int]struct{}, error) {
	heights := map[int]struct{}{}
	styles := map[int]struct{}{}
	rows, err := f.Rows(sheet)
	if err != nil {
		return heights, styles, fmt.Errorf("open row iterator: %w", err)
	}
	defer func() { _ = rows.Close() }()
	rowIdx := 0
	for rows.Next() {
		rowIdx++
		opts := rows.GetRowOpts()
		// excelize's extractRowOpts seeds Height with defaultRowHeight
		// when the <row> element has no `ht` attribute. The 0.01pt
		// epsilon catches roundtrip rounding without missing real
		// customizations.
		if opts.Height > 0 && (opts.Height < defaultExcelRowHeight-0.01 || opts.Height > defaultExcelRowHeight+0.01) {
			heights[rowIdx] = struct{}{}
		}
		if opts.StyleID > 0 {
			styles[rowIdx] = struct{}{}
		}
	}
	if err := rows.Error(); err != nil {
		return heights, styles, fmt.Errorf("row iterator: %w", err)
	}
	return heights, styles, nil
}

// existingCustomCols walks columns 1..maxCol and returns the set of
// 1-based column numbers whose stored width differs from the xlsx
// default. excelize has no public column iterator so the bounded walk
// is the simplest correct path — GetColWidth is a constant-time lookup
// into ws.Cols.Col, so the cost is O(maxCol) memory reads, not
// O(maxCol) XML mutations.
//
// maxCol is read from the snapshot's tracked ColCount unioned with the
// workbook's <dimension> column extent so columns customized in the
// original file beyond the snapshot's tracked extent still surface.
func existingCustomCols(f *excelize.File, sheet string, snapshotColCount int) (map[int]struct{}, error) {
	out := map[int]struct{}{}
	dimCol, _ := parseDimensionRef(getSheetDimension(f, sheet))
	maxCol := dimCol
	if snapshotColCount > maxCol {
		maxCol = snapshotColCount
	}
	for col := 1; col <= maxCol; col++ {
		colName, err := excelize.ColumnNumberToName(col)
		if err != nil {
			return out, fmt.Errorf("col name for %d: %w", col, err)
		}
		w, err := f.GetColWidth(sheet, colName)
		if err != nil {
			return out, fmt.Errorf("get col width %s!%s: %w", sheet, colName, err)
		}
		if w > 0 && (w < defaultExcelColWidth-0.001 || w > defaultExcelColWidth+0.001) {
			out[col] = struct{}{}
		}
	}
	return out, nil
}

// applySparseRowHeights enforces the snapshot-is-authoritative contract
// for per-row heights on one sheet.
//
//   - heights == nil → no-op (legacy bootstrap; preserve on-disk).
//   - heights non-nil → walk (existingCustom ∪ snapshotKeys), unset
//     rows in existingCustom but not in the snapshot, write rows in
//     the snapshot. existingCustom is pre-computed by
//     existingCustomRowOpts so the clear pass touches only rows that
//     have something to clear — no dense 1..maxRow walk, no
//     excelize-side backfill of placeholders on uncustomized rows.
//
// Without the unset pass, a user resizing a row and then resetting to
// default would silently leave the old height in the saved xlsx; the
// next reload would reseed the row's customization from the stale file.
func applySparseRowHeights(f *excelize.File, sheet string, heights map[int]int, existingCustom map[int]struct{}) error {
	if heights == nil {
		return nil
	}
	for row := range existingCustom {
		if _, kept := heights[row]; kept {
			continue
		}
		if err := f.SetRowHeight(sheet, row, -1); err != nil {
			return fmt.Errorf("clear stale row height %s!%d: %w", sheet, row, err)
		}
	}
	for row, px := range heights {
		if row < 1 || px < 0 {
			continue
		}
		if err := f.SetRowHeight(sheet, row, pxToExcelPoints(px)); err != nil {
			return fmt.Errorf("set row height %s!%d: %w", sheet, row, err)
		}
	}
	return nil
}

// applySparseColWidths enforces the snapshot-is-authoritative contract
// for per-column widths on one sheet. excelize has no public
// "unset column width" call, so the "clear" path writes the workbook
// default (defaultExcelColWidth) which is the rendered behavior of a
// column with no customization. The clear is bounded to columns
// pre-identified as having a non-default width on disk, so the file
// gains no spurious <col> entries on a no-op save.
func applySparseColWidths(f *excelize.File, sheet string, widths map[int]int, existingCustom map[int]struct{}) error {
	if widths == nil {
		return nil
	}
	for col := range existingCustom {
		if _, kept := widths[col]; kept {
			continue
		}
		colName, err := excelize.ColumnNumberToName(col)
		if err != nil {
			return fmt.Errorf("col name for %d: %w", col, err)
		}
		if err := f.SetColWidth(sheet, colName, colName, defaultExcelColWidth); err != nil {
			return fmt.Errorf("clear stale col width %s!%s: %w", sheet, colName, err)
		}
	}
	for col, px := range widths {
		if col < 1 || px < 0 {
			continue
		}
		colName, err := excelize.ColumnNumberToName(col)
		if err != nil {
			return fmt.Errorf("col name for %d: %w", col, err)
		}
		if err := f.SetColWidth(sheet, colName, colName, pxToExcelCharWidth(px)); err != nil {
			return fmt.Errorf("set col width %s!%s: %w", sheet, colName, err)
		}
	}
	return nil
}

// applySparseRowStyles enforces the snapshot-is-authoritative contract
// for per-row styles. Same tri-state semantics as the height/width
// helpers above. The "clear" path writes excelize's style-ID 0 (the
// "no style" sentinel), which removes the row-level style without
// affecting per-cell styles applied in the cells pass.
//
// existingCustom is bounded to rows that actually carry a non-zero
// StyleID on disk so the clear pass doesn't dirty every row in the
// dimension on a sheet with no row-level styles.
func applySparseRowStyles(f *excelize.File, sheet string, styles map[int]*CellStyle, existingCustom map[int]struct{}) error {
	if styles == nil {
		return nil
	}
	for row := range existingCustom {
		if _, kept := styles[row]; kept {
			continue
		}
		if err := f.SetRowStyle(sheet, row, row, 0); err != nil {
			return fmt.Errorf("clear stale row style %s!%d: %w", sheet, row, err)
		}
	}
	for row, style := range styles {
		if row < 1 || style == nil {
			continue
		}
		base := &excelize.Style{}
		overlayStyle(base, style)
		styleID, err := f.NewStyle(base)
		if err != nil {
			return fmt.Errorf("register row style %s!%d: %w", sheet, row, err)
		}
		if err := f.SetRowStyle(sheet, row, row, styleID); err != nil {
			return fmt.Errorf("set row style %s!%d: %w", sheet, row, err)
		}
	}
	return nil
}

// getSheetDimension is a small error-swallowing wrapper around
// excelize.GetSheetDimension so callers can use it inside expression
// contexts without four lines of plumbing. A missing dimension reads
// as the empty string, which parseDimensionRef maps to (0, 0).
func getSheetDimension(f *excelize.File, sheet string) string {
	ref, err := f.GetSheetDimension(sheet)
	if err != nil {
		return ""
	}
	return ref
}

// applyCellStyle overlays a partial CellStyle onto the cell's existing
// excelize style and writes the result back via NewStyle/SetCellStyle.
//
// "Existing" matters: the original .xlsx may already have a style on
// this cell (a fill color, a number format, a font size). Reading it
// first and overlaying only the snapshot's non-nil leaves preserves
// every attribute the doc didn't track.
func applyCellStyle(f *excelize.File, sheet, ref string, patch *CellStyle) error {
	if patch == nil {
		return nil
	}
	styleID, err := f.GetCellStyle(sheet, ref)
	if err != nil {
		return fmt.Errorf("get existing style: %w", err)
	}
	base := &excelize.Style{}
	if styleID != 0 {
		got, err := f.GetStyle(styleID)
		if err != nil {
			return fmt.Errorf("read style %d: %w", styleID, err)
		}
		if got != nil {
			base = got
		}
	}
	overlayStyle(base, patch)
	newID, err := f.NewStyle(base)
	if err != nil {
		return fmt.Errorf("register style: %w", err)
	}
	if err := f.SetCellStyle(sheet, ref, ref, newID); err != nil {
		return fmt.Errorf("apply style: %w", err)
	}
	return nil
}

// cellValueForExcelize picks the right Go value to hand to
// excelize.SetCellValue based on the cell's Kind. excelize dispatches
// internally on the value's reflect type — a Go int64/float64 lands
// as a numeric cell, a bool as a boolean cell, a time.Time as a date
// cell, and a string as a text cell. Matching kind to type at this
// boundary is what gives the round-trip its type-fidelity.
//
// Empty Kind (legacy doc with no kind tag written) falls back to the
// previous "try int → float → string" coercion of RawString, so
// already-saved workbooks continue to round-trip as they did before.
func cellValueForExcelize(c CellEntry) any {
	switch c.Kind {
	case "number":
		if c.RawNumber == nil {
			// Legacy fallback: kind says number but raw was carried
			// as a string. Promote via the same path the legacy
			// coercer used.
			return legacyCoerceCellValue(c.RawString)
		}
		n := *c.RawNumber
		// Excel stores integers as floats with no fractional part;
		// surfacing them as int64 to excelize keeps the on-disk
		// representation tidy (no trailing .0 in raw XML). The 2^53
		// guard avoids precision loss for large floats that Go can't
		// round-trip through int64 cleanly.
		if !math.IsNaN(n) && !math.IsInf(n, 0) && n == math.Trunc(n) && math.Abs(n) < (1<<53) {
			return int64(n)
		}
		return n
	case "boolean":
		if c.RawBool == nil {
			return false
		}
		return *c.RawBool
	case "date":
		// ISO-only on the wire (the TS side never writes anything
		// else). Try full RFC3339 first, then date-only.
		if t, err := time.Parse(time.RFC3339, c.RawString); err == nil {
			return t
		}
		if t, err := time.Parse("2006-01-02", c.RawString); err == nil {
			return t
		}
		// Unparseable date — round-trip as the literal text rather
		// than fail the whole save.
		return c.RawString
	case "string":
		return c.RawString
	case "formula":
		// Reached when called from the formula cache path; just
		// surface the cached scalar.
		return c.RawString
	case "":
		// Legacy snapshot: no kind tag was written by the producer.
		// Preserve prior behavior by promoting numeric-looking
		// strings.
		val := c.RawString
		if val == "" {
			val = c.Display
		}
		return legacyCoerceCellValue(val)
	}
	return c.RawString
}

// formulaCachedValue extracts the kind-aware cached scalar for a
// formula cell, if one is present. Returns ok=false when the formula
// has no cached value (e.g. a fresh =A1+B1 the user just typed) so the
// caller can skip the SetCellValue seed.
//
// excelize semantics: when SetCellValue sees a numeric Go type, it
// stores both the number and the cell type as Number; setting the
// same cell to a string-of-digits stores it as an inline string and
// excelize will recompute the formula's result. So promoting numeric
// cached values up front is what keeps "this cell shows 57" durable
// across the round-trip.
func formulaCachedValue(c CellEntry) (any, bool) {
	switch {
	case c.RawNumber != nil:
		v := *c.RawNumber
		if !math.IsNaN(v) && !math.IsInf(v, 0) && v == math.Trunc(v) && math.Abs(v) < (1<<53) {
			return int64(v), true
		}
		return v, true
	case c.RawBool != nil:
		return *c.RawBool, true
	case c.RawString != "":
		// Numeric-looking strings get promoted so excelize stores
		// them as Number cells; non-numeric strings round-trip as
		// strings.
		return legacyCoerceCellValue(c.RawString), true
	case c.Display != "":
		return legacyCoerceCellValue(c.Display), true
	}
	return nil, false
}

// legacyCoerceCellValue is the prior pre-typed-cells fallback: try
// int → float → string. Kept around for legacy docs that were
// persisted before the typed-cell schema landed.
func legacyCoerceCellValue(s string) any {
	if s == "" {
		return s
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n
	}
	if n, err := strconv.ParseFloat(s, 64); err == nil {
		return n
	}
	return s
}

// pxToExcelPoints converts a CSS pixel value (the unit calc stores
// in the Y.Doc) to Excel row-height points. 96 px / inch on screen,
// 72 pt / inch in OOXML, so the ratio is 0.75.
func pxToExcelPoints(px int) float64 {
	return float64(px) * 0.75
}

// pxToExcelCharWidth converts a pixel value to Excel column-width
// "character" units. The standard XLSX formula (mirroring Excel's
// own UI math) is:
//
//	chars = (px - 5) / 7    when px > 12
//	chars = px / 12         otherwise
//
// 7 is the average glyph width of the default 11pt Calibri; the 5px
// constant is the column padding Excel reserves for cell gridlines.
func pxToExcelCharWidth(px int) float64 {
	if px <= 0 {
		return 0
	}
	if px > 12 {
		return float64(px-5) / 7.0
	}
	return float64(px) / 12.0
}

// parseDimensionRef extracts the bottom-right (col, row) from an
// excelize <dimension> ref like "A1:H30". Returns (0,0) on a missing
// or malformed ref so callers can treat it as "no existing extent"
// and fall back to whatever the snapshot supplies.
func parseDimensionRef(ref string) (col, row int) {
	if ref == "" {
		return 0, 0
	}
	parts := strings.SplitN(ref, ":", 2)
	target := parts[len(parts)-1]
	c, r, err := excelize.CellNameToCoordinates(target)
	if err != nil {
		return 0, 0
	}
	return c, r
}

// readDriveItemBytes returns the current `file` blob attached to
// item. Returns (nil, nil) if no file is attached — callers that
// need a non-empty XLSX should check.
func readDriveItemBytes(app core.App, item *core.Record) ([]byte, error) {
	filename := item.GetString("file")
	if filename == "" {
		return nil, nil
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, fmt.Errorf("open filesystem: %w", err)
	}
	defer fsys.Close()

	key := item.BaseFilesPath() + "/" + filename
	rdr, err := fsys.GetReader(key)
	if err != nil {
		return nil, fmt.Errorf("get reader for %s: %w", key, err)
	}
	defer rdr.Close()

	return io.ReadAll(rdr)
}
