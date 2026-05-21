package calc

import (
	"bytes"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// WorkbookModel mirrors the TS WorkbookModel
// (tinycld/calc/lib/workbook-types.ts). It is the same shape returned
// by the /api/calc/preview/:id endpoint and consumed by the YDoc
// bootstrap path on first joiner. Field names use camelCase JSON tags
// so the wire shape matches the TS interface byte-for-byte.
type WorkbookModel struct {
	Sheets []WorksheetModel     `json:"sheets"`
	Pivots []PivotDefinitionDTO `json:"pivots,omitempty"`
}

type WorksheetModel struct {
	Name     string                  `json:"name"`
	RowCount int                     `json:"rowCount"`
	ColCount int                     `json:"colCount"`
	Cells    map[string]CellValueDTO `json:"cells"`
	// Color is the imported tab color as a "#RRGGBB" hex string.
	// Empty when the source xlsx has no tab color set.
	Color string `json:"color,omitempty"`
	// Hidden mirrors the source xlsx's per-sheet visibility flag.
	// Hidden sheets still get fully read (so peers who unhide them
	// see the data) but the client filters them from the default
	// sheet list — see useYSheets.
	Hidden bool `json:"hidden,omitempty"`
	// Merges enumerates merged-cell rectangles imported from the
	// source xlsx via excelize.GetMergeCells.
	Merges []MergeRangeDTO `json:"merges,omitempty"`
	// FrozenRows / FrozenCols mirror the xlsx <pane> ySplit /
	// xSplit when state="frozen". Zero on either axis means "no
	// freeze on this axis"; the doc bootstrap omits the meta key
	// rather than writing 0 so a freeze-less sheet adds no bytes.
	FrozenRows int `json:"frozenRows,omitempty"`
	FrozenCols int `json:"frozenCols,omitempty"`
	// RowHeights / ColWidths / RowStyles seed the Y.Doc's sparse
	// per-row / per-column customization maps from the imported
	// xlsx. Without this seed the Y.Doc has no knowledge of the
	// original sizing, so the serializer's snapshot-is-authoritative
	// contract for these fields would silently wipe legitimate
	// external customizations on first save. Keys are 1-based row
	// or column numbers; values are CSS pixels (matching the TS
	// side's storage unit).
	RowHeights map[int]int        `json:"rowHeights,omitempty"`
	ColWidths  map[int]int        `json:"colWidths,omitempty"`
	RowStyles  map[int]*CellStyle `json:"rowStyles,omitempty"`
	// ConditionalFormats enumerates rules imported from the source
	// xlsx via excelize.GetConditionalFormats. Bootstrap seeds them
	// into the per-sheet conditionalFormats Y.Array so the doc-side
	// authoring UI sees them on first open. Empty/nil when the
	// source has no rules.
	ConditionalFormats []ConditionalFormatRule `json:"conditionalFormats,omitempty"`
}

// MergeRangeDTO mirrors the TS MergeRangeModel: a merged cell anchor
// (top-left) plus span dimensions. Round-trips through excelize.
type MergeRangeDTO struct {
	AnchorRow int `json:"anchorRow"`
	AnchorCol int `json:"anchorCol"`
	RowSpan   int `json:"rowSpan"`
	ColSpan   int `json:"colSpan"`
}

// CellValueDTO mirrors the TS CellValue. `raw` is one of
// string|number|boolean|null (Yjs-friendly scalar). `formula` is
// emitted only for formula cells; `style` only for cells with a
// tracked attribute.
type CellValueDTO struct {
	Kind    string     `json:"kind"`
	Raw     any        `json:"raw"`
	Display string     `json:"display"`
	Formula string     `json:"formula,omitempty"`
	Style   *CellStyle `json:"style,omitempty"`
}

// ReadWorkbookFromXLSX parses xlsx bytes into a WorkbookModel suitable
// for both the preview endpoint and the YDoc bootstrap. Mirrors the TS
// parseWorkbook (tinycld/calc/lib/xlsx-adapter.ts) so the resulting
// shape decodes identically on the client side.
//
// rowCap and colCap (when > 0) bound the per-sheet read for the
// preview endpoint; pass 0 for the bootstrap path which needs the
// full grid.
func ReadWorkbookFromXLSX(xlsxBytes []byte, rowCap, colCap int) (WorkbookModel, error) {
	if len(xlsxBytes) == 0 {
		return WorkbookModel{}, fmt.Errorf("calc: ReadWorkbookFromXLSX: empty input")
	}
	f, err := excelize.OpenReader(bytes.NewReader(xlsxBytes))
	if err != nil {
		return WorkbookModel{}, fmt.Errorf("calc: open xlsx: %w", err)
	}
	defer func() { _ = f.Close() }()

	sheetNames := f.GetSheetList()
	out := WorkbookModel{Sheets: make([]WorksheetModel, 0, len(sheetNames))}

	for _, sheetName := range sheetNames {
		ws, err := readWorksheet(f, sheetName, rowCap, colCap)
		if err != nil {
			return WorkbookModel{}, fmt.Errorf("calc: read sheet %q: %w", sheetName, err)
		}
		out.Sheets = append(out.Sheets, ws)
	}
	for _, sheetName := range sheetNames {
		pivots, err := readPivotsForSheet(f, sheetName)
		if err != nil {
			return WorkbookModel{}, fmt.Errorf("calc: read pivots for %q: %w", sheetName, err)
		}
		out.Pivots = append(out.Pivots, pivots...)
	}
	// Promote any pivot whose target sheet collides with an existing
	// non-empty data sheet by relocating it to a dedicated "<sheet>
	// pivot" sheet name (design §8). Excel-authored xlsx usually
	// already places the pivot on a dedicated sheet, so this is a
	// safety net for the in-sheet case where the user dropped the
	// pivot into a region that already holds data.
	out.Pivots = ensureDistinctTargets(out.Pivots, out.Sheets)
	return out, nil
}

// ensureDistinctTargets walks the imported pivots and rewrites the
// target sheet name for any pivot whose target collides with an
// existing non-empty sheet. Naming follows "<sheet> pivot" then
// "<sheet> pivot (2)", "<sheet> pivot (3)", … until a free name is
// found. The collision rule is intentionally permissive: a pivot
// whose target sheet exists but is empty (e.g. excelize.NewSheet
// followed by AddPivotTable into PivotSheet!A1) stays put — the
// pivot can paint freely without clobbering anything. Only when the
// target already has data do we relocate.
func ensureDistinctTargets(pivots []PivotDefinitionDTO, sheets []WorksheetModel) []PivotDefinitionDTO {
	taken := make(map[string]bool, len(sheets))
	cellCount := make(map[string]int, len(sheets))
	for _, s := range sheets {
		taken[s.Name] = true
		cellCount[s.Name] = len(s.Cells)
	}
	for i, p := range pivots {
		if cellCount[p.TargetSheetName] > 0 {
			n := 2
			base := fmt.Sprintf("%s pivot", strings.TrimSpace(p.TargetSheetName))
			candidate := base
			for taken[candidate] {
				candidate = fmt.Sprintf("%s (%d)", base, n)
				n++
			}
			pivots[i].TargetSheetName = candidate
			taken[candidate] = true
		}
	}
	return pivots
}

func readWorksheet(f *excelize.File, sheetName string, rowCap, colCap int) (WorksheetModel, error) {
	rows, err := f.GetRows(sheetName)
	if err != nil {
		return WorksheetModel{}, err
	}
	// Tab color + visibility live on the worksheet props. Errors here
	// are non-fatal (fall back to absent / visible) — older xlsx files
	// without sheet-level styling shouldn't break the import.
	var tabColor string
	if props, err := f.GetSheetProps(sheetName); err == nil {
		if props.TabColorRGB != nil && *props.TabColorRGB != "" {
			rgb := *props.TabColorRGB
			if !strings.HasPrefix(rgb, "#") {
				rgb = "#" + rgb
			}
			tabColor = rgb
		}
	}
	hidden := false
	if visible, err := f.GetSheetVisible(sheetName); err == nil {
		hidden = !visible
	}
	cells := make(map[string]CellValueDTO)
	maxRow, maxCol := 0, 0

	for rowIdx, row := range rows {
		rowNumber := rowIdx + 1
		if rowCap > 0 && rowNumber > rowCap {
			break
		}
		for colIdx := range row {
			colNumber := colIdx + 1
			if colCap > 0 && colNumber > colCap {
				break
			}
			ref, err := excelize.CoordinatesToCellName(colNumber, rowNumber)
			if err != nil {
				continue
			}
			cell, ok := readWorkbookCell(f, sheetName, ref)
			if !ok {
				continue
			}
			cells[fmt.Sprintf("%d:%d", rowNumber, colNumber)] = cell
			if rowNumber > maxRow {
				maxRow = rowNumber
			}
			if colNumber > maxCol {
				maxCol = colNumber
			}
		}
	}

	rowCount, colCount := maxRow, maxCol
	if rowCount < 1 {
		rowCount = 1
	}
	if colCount < 1 {
		colCount = 1
	}
	merges, _ := readMerges(f, sheetName)
	frozenRows, frozenCols := readWorksheetFreeze(f, sheetName)
	rowHeights, rowStyles, err := readWorksheetRowOpts(f, sheetName)
	if err != nil {
		return WorksheetModel{}, fmt.Errorf("row opts: %w", err)
	}
	colWidths, err := readWorksheetColWidths(f, sheetName, colCount)
	if err != nil {
		return WorksheetModel{}, fmt.Errorf("col widths: %w", err)
	}
	cfRules, err := readConditionalFormats(f, sheetName)
	if err != nil {
		return WorksheetModel{}, fmt.Errorf("conditional formats: %w", err)
	}
	return WorksheetModel{
		Name:               sheetName,
		RowCount:           rowCount,
		ColCount:           colCount,
		Cells:              cells,
		Color:              tabColor,
		Hidden:             hidden,
		Merges:             merges,
		FrozenRows:         frozenRows,
		FrozenCols:         frozenCols,
		RowHeights:         rowHeights,
		ColWidths:          colWidths,
		RowStyles:          rowStyles,
		ConditionalFormats: cfRules,
	}, nil
}

// readWorksheetRowOpts streams the sheet's rows via excelize.Rows() and
// collects per-row Height + StyleID into maps keyed by 1-based row
// number. Only emits entries whose Height differs from the xlsx default
// (or whose StyleID is non-zero) so the resulting maps remain sparse:
// a workbook with no row customizations contributes no Y.Doc bytes.
//
// Why both maps come from one pass: excelize's streaming row iterator
// is the only public API that exposes both the per-row Height (via
// rows.GetRowOpts().Height) and StyleID without re-decoding the whole
// worksheet XML. A second pass for styles would double the cost on
// large sheets.
//
// Why errors propagate: a partial seed here is dangerous downstream.
// If we returned (nil, nil) on a read failure and the user later
// touched one row, the Y.Doc would carry a one-entry map and the
// serializer's clear-then-write contract would wipe every other row's
// original on-disk customization — re-creating the bug class this
// package is built to prevent. Better to fail bootstrap loudly than
// silently degrade into a save-time wipe.
//
// The default-height epsilon (0.01 pt) catches roundtrip rounding
// without dropping near-default custom heights.
func readWorksheetRowOpts(f *excelize.File, sheetName string) (map[int]int, map[int]*CellStyle, error) {
	rows, err := f.Rows(sheetName)
	if err != nil {
		return nil, nil, fmt.Errorf("open row iterator: %w", err)
	}
	defer func() { _ = rows.Close() }()
	heights := map[int]int{}
	styles := map[int]*CellStyle{}
	rowIdx := 0
	for rows.Next() {
		rowIdx++
		opts := rows.GetRowOpts()
		// excelize's extractRowOpts seeds Height with defaultRowHeight
		// (15pt). Any value materially different from that is a stored
		// customization in the xlsx's <row ht="..."> attribute.
		if opts.Height > 0 && (opts.Height < defaultExcelRowHeight-0.01 || opts.Height > defaultExcelRowHeight+0.01) {
			heights[rowIdx] = excelPointsToPx(opts.Height)
		}
		if opts.StyleID > 0 {
			style, err := f.GetStyle(opts.StyleID)
			if err != nil {
				return nil, nil, fmt.Errorf("read style id %d on row %d: %w", opts.StyleID, rowIdx, err)
			}
			if style != nil {
				if cs := extractStyle(style); cs != nil {
					styles[rowIdx] = cs
				}
			}
		}
	}
	if err := rows.Error(); err != nil {
		return nil, nil, fmt.Errorf("row iterator: %w", err)
	}
	if len(heights) == 0 {
		heights = nil
	}
	if len(styles) == 0 {
		styles = nil
	}
	return heights, styles, nil
}

// readWorksheetColWidths walks columns 1..colCount and emits any whose
// stored width differs from the xlsx default. excelize exposes only a
// per-column lookup (GetColWidth) without an enumerator, so this loop
// is the simplest correct path — colCount is already bounded by the
// sheet's used range and capped by the caller.
//
// Like readWorksheetRowOpts, the result stays sparse: a workbook with
// no width customizations contributes no Y.Doc bytes. Errors propagate
// for the same reason — a partial seed here would let the serializer
// wipe legitimate on-disk widths on first save (see readWorksheetRowOpts
// for the full data-loss story).
//
// ColumnNumberToName failing inside a 1..colCount walk would mean
// colCount is out of range for the xlsx column-name encoding (max
// XFD = 16384), which is a structural invariant violation we should
// surface rather than skip.
func readWorksheetColWidths(f *excelize.File, sheetName string, colCount int) (map[int]int, error) {
	if colCount < 1 {
		return nil, nil
	}
	out := map[int]int{}
	for col := 1; col <= colCount; col++ {
		colName, err := excelize.ColumnNumberToName(col)
		if err != nil {
			return nil, fmt.Errorf("column name for %d: %w", col, err)
		}
		w, err := f.GetColWidth(sheetName, colName)
		if err != nil {
			return nil, fmt.Errorf("get col width %s!%s: %w", sheetName, colName, err)
		}
		// GetColWidth falls back to defaultColWidth (9.140625) when
		// the column has no stored width entry; skip those so the
		// emitted map only carries true customizations.
		if w <= 0 || (w > defaultExcelColWidth-0.001 && w < defaultExcelColWidth+0.001) {
			continue
		}
		out[col] = excelCharWidthToPx(w)
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// defaultExcelRowHeight and defaultExcelColWidth mirror excelize's
// internal defaults (rows.go: defaultRowHeight=15, col.go:
// defaultColWidth=9.140625). Exposed here so the import-side seeding
// can detect "this row/col uses the workbook default" without taking
// on a build-time dependency on excelize's private constants.
const (
	defaultExcelRowHeight = 15.0
	defaultExcelColWidth  = 9.140625
)

// excelPointsToPx is the inverse of pxToExcelPoints (persist.go). 72
// pt / inch / 96 px / inch = 0.75 ratio in the forward direction; the
// inverse divides. Rounds to the nearest integer pixel because the
// Y.Doc stores row heights as ints.
func excelPointsToPx(pt float64) int {
	if pt <= 0 {
		return 0
	}
	return int(pt/0.75 + 0.5)
}

// excelCharWidthToPx is the inverse of pxToExcelCharWidth (persist.go).
// Forward: chars = (px-5)/7 for px>12 else px/12. We pick the inverse
// branch by whether the result of the px>12 branch lands above 12 — i.e.
// `(chars*7)+5 > 12` ⇒ `chars > 1`. Rounds to the nearest integer pixel.
func excelCharWidthToPx(chars float64) int {
	if chars <= 0 {
		return 0
	}
	if chars > 1 {
		return int(chars*7 + 5 + 0.5)
	}
	return int(chars*12 + 0.5)
}

// readMerges extracts the sheet's merged cell rectangles via
// excelize.GetMergeCells and converts each to a MergeRangeDTO. Returns
// nil (not error) on any individual parse failure so a malformed entry
// doesn't poison the whole sheet load.
func readMerges(f *excelize.File, sheetName string) ([]MergeRangeDTO, error) {
	mergeCells, err := f.GetMergeCells(sheetName)
	if err != nil {
		return nil, err
	}
	if len(mergeCells) == 0 {
		return nil, nil
	}
	out := make([]MergeRangeDTO, 0, len(mergeCells))
	for _, mc := range mergeCells {
		startCol, startRow, err := excelize.CellNameToCoordinates(mc.GetStartAxis())
		if err != nil {
			continue
		}
		endCol, endRow, err := excelize.CellNameToCoordinates(mc.GetEndAxis())
		if err != nil {
			continue
		}
		if endRow < startRow || endCol < startCol {
			continue
		}
		out = append(out, MergeRangeDTO{
			AnchorRow: startRow,
			AnchorCol: startCol,
			RowSpan:   endRow - startRow + 1,
			ColSpan:   endCol - startCol + 1,
		})
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// readWorksheetFreeze pulls the xlsx <pane> ySplit/xSplit off the
// sheet via excelize.GetPanes when state="frozen". Returns (0, 0) for
// any sheet that isn't frozen — including split-pane sheets, which we
// don't surface to the doc today (split panes are a different UX
// affordance with no calc-side equivalent yet).
func readWorksheetFreeze(f *excelize.File, sheetName string) (int, int) {
	panes, err := f.GetPanes(sheetName)
	if err != nil || !panes.Freeze {
		return 0, 0
	}
	rows := panes.YSplit
	cols := panes.XSplit
	if rows < 0 {
		rows = 0
	}
	if cols < 0 {
		cols = 0
	}
	return rows, cols
}

// readWorkbookCell extracts a single cell into the typed CellValueDTO shape.
// Returns ok=false for empty cells (no value, no formula) so the
// caller can skip them — keeping the on-wire JSON small and matching
// the TS parser which skips includeEmpty=false cells.
//
// Classification rules:
//   - formula present → kind=formula, raw=cached scalar (best-effort)
//   - excelize cell type Bool/Number/Date/SharedString/InlineString/...
func readWorkbookCell(f *excelize.File, sheet, ref string) (CellValueDTO, bool) {
	formula, _ := f.GetCellFormula(sheet, ref)
	rawStr, _ := f.GetCellValue(sheet, ref)
	cellType, _ := f.GetCellType(sheet, ref)
	style := readWorkbookCellStyle(f, sheet, ref)
	hasAny := formula != "" || rawStr != ""

	if !hasAny {
		return CellValueDTO{}, false
	}

	if formula != "" {
		raw := classifyScalar(rawStr, cellType)
		display := formatDisplay("formula", raw, formula)
		return CellValueDTO{
			Kind:    "formula",
			Raw:     raw,
			Display: display,
			Formula: formula,
			Style:   style,
		}, true
	}

	kind, raw := classifyValue(rawStr, cellType)
	display := formatDisplay(kind, raw, "")
	return CellValueDTO{
		Kind:    kind,
		Raw:     raw,
		Display: display,
		Style:   style,
	}, true
}

// classifyValue maps an excelize (rawString, cellType) pair to our
// (kind, raw) shape. excelize returns the cell value as a string in
// every case — the cell type tells us what semantic interpretation to
// apply.
func classifyValue(rawStr string, cellType excelize.CellType) (string, any) {
	switch cellType {
	case excelize.CellTypeBool:
		return "boolean", rawStr == "1" || strings.EqualFold(rawStr, "true")
	case excelize.CellTypeNumber, excelize.CellTypeUnset:
		// CellTypeUnset is excelize's default for numeric cells with
		// no explicit type tag. Fall through to numeric coercion;
		// non-numeric strings land in the string branch below.
		if n, err := strconv.ParseFloat(rawStr, 64); err == nil {
			return "number", n
		}
		return "string", rawStr
	case excelize.CellTypeDate:
		// excelize formats date cells as their display string; carry
		// that through as a string raw to match the ISO-string
		// convention the TS side uses for dates in YDoc.
		if t, err := time.Parse("2006-01-02", rawStr); err == nil {
			return "date", t.Format("2006-01-02")
		}
		if t, err := time.Parse(time.RFC3339, rawStr); err == nil {
			if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 && t.Nanosecond() == 0 {
				return "date", t.Format("2006-01-02")
			}
			return "date", t.Format(time.RFC3339)
		}
		return "string", rawStr
	default:
		return "string", rawStr
	}
}

// classifyScalar is the formula-cached-value variant — we know the
// cell IS a formula (handled separately) and only need to coerce the
// cached scalar into raw form.
func classifyScalar(rawStr string, cellType excelize.CellType) any {
	switch cellType {
	case excelize.CellTypeBool:
		return rawStr == "1" || strings.EqualFold(rawStr, "true")
	case excelize.CellTypeNumber, excelize.CellTypeUnset:
		if n, err := strconv.ParseFloat(rawStr, 64); err == nil {
			return n
		}
		return rawStr
	case excelize.CellTypeDate:
		return rawStr
	default:
		if rawStr == "" {
			return nil
		}
		return rawStr
	}
}

// formatDisplay mirrors formatCell (workbook-types.ts) for the
// limited set of kinds the parser emits. The Y.Doc carries the
// display string so non-formatter readers (server, alternate clients)
// can render without recomputing.
func formatDisplay(kind string, raw any, formula string) string {
	if kind == "formula" {
		if raw == nil {
			return formula
		}
		return scalarToString(raw)
	}
	if raw == nil {
		return ""
	}
	switch kind {
	case "number":
		if n, ok := raw.(float64); ok {
			return formatNumber(n)
		}
		return scalarToString(raw)
	case "boolean":
		if b, ok := raw.(bool); ok {
			if b {
				return "TRUE"
			}
			return "FALSE"
		}
		return scalarToString(raw)
	case "date":
		return scalarToString(raw)
	default:
		return scalarToString(raw)
	}
}

func formatNumber(n float64) string {
	if n == float64(int64(n)) {
		return strconv.FormatInt(int64(n), 10)
	}
	return strconv.FormatFloat(n, 'g', -1, 64)
}

func scalarToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "TRUE"
		}
		return "FALSE"
	case float64:
		return formatNumber(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", x)
	}
}

// readWorkbookCellStyle pulls a cell's excelize style and converts it
// to *CellStyle via extractStyle (the read-side inverse of
// overlayStyle). Returns nil when the cell has no registered style or
// the style is structurally empty so callers can skip the doc-side
// style key entirely.
//
// Adding support for a new attribute happens in
// style_attribute_registry.go — extractStyle picks it up automatically
// from there. This function only changes when the registration shape
// itself changes.
func readWorkbookCellStyle(f *excelize.File, sheet, ref string) *CellStyle {
	id, err := f.GetCellStyle(sheet, ref)
	if err != nil || id == 0 {
		return nil
	}
	style, err := f.GetStyle(id)
	if err != nil || style == nil {
		return nil
	}
	return extractStyle(style)
}

// BootstrapYDocFromWorkbook seeds an empty server-side Y.Doc from a
// WorkbookModel. Mirrors bootstrapYDocFromWorkbook (TS) so the wire
// shape clients see in their first SyncReply is identical to what the
// pre-removal client-side bootstrap would have written.
//
// Sheet IDs follow the same `sheet${i+1}` convention as the TS
// version. Each cell is its own nested YMap; styles land under the
// cell's `style` key as a YMap of group YMaps + flat scalars.
func BootstrapYDocFromWorkbook(doc *ycrdt.Doc, model WorkbookModel) error {
	sheetsAny := doc.GetMap("sheets")
	cellsAny := doc.GetMap("cells")
	// Register the pivots top-level map even on workbooks with no
	// pivots yet, so y-crdt knows about the type before any client
	// update arrives. Without this, a peer that adds the first pivot
	// has their update applied to the server doc, but the type is
	// only visible after an explicit GetMap call — and any
	// EncodeStateAsUpdate that happens before SaveRoom touches it
	// (e.g. a late-joiner's SyncReply, or the same client tearing
	// down and re-creating its doc on a route change) misses the
	// pivot in the encoded delta.
	doc.GetMap("pivots")
	sheetsMap, ok := sheetsAny.(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: sheets map is not a YMap")
	}
	cellsMap, ok := cellsAny.(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: cells map is not a YMap")
	}

	doc.Transact(func(_ *ycrdt.Transaction) {
		for i, sheet := range model.Sheets {
			sheetID := fmt.Sprintf("sheet%d", i+1)
			meta := ycrdt.NewYMap(nil)
			meta.Set("name", sheet.Name)
			meta.Set("position", i)
			meta.Set("rowCount", sheet.RowCount)
			meta.Set("colCount", sheet.ColCount)
			if sheet.Color != "" {
				meta.Set("color", sheet.Color)
			}
			if sheet.Hidden {
				meta.Set("hidden", true)
			}
			if sheet.FrozenRows > 0 {
				meta.Set("frozenRows", sheet.FrozenRows)
			}
			if sheet.FrozenCols > 0 {
				meta.Set("frozenCols", sheet.FrozenCols)
			}
			sheetsMap.Set(sheetID, meta)

			if len(sheet.Merges) > 0 {
				mergesMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for _, m := range sheet.Merges {
					if m.RowSpan < 1 || m.ColSpan < 1 {
						continue
					}
					if m.RowSpan == 1 && m.ColSpan == 1 {
						continue
					}
					entry := ycrdt.NewYMap(nil)
					entry.Set("rowSpan", m.RowSpan)
					entry.Set("colSpan", m.ColSpan)
					mergesMap.Set(fmt.Sprintf("%d:%d", m.AnchorRow, m.AnchorCol), entry)
					wroteAny = true
				}
				if wroteAny {
					meta.Set("merges", mergesMap)
				}
			}

			// Seed the sparse per-row / per-column customization maps
			// from the imported xlsx. Without this, the serializer's
			// snapshot-is-authoritative pass would clear legitimate
			// pre-existing customizations on the first save.
			//
			// Gotcha: y-crdt's YMap.GetSize() reads from the integrated
			// `Map` field, not from `PrelimContent`. A freshly-created
			// YMap that we've called Set on N times still reports
			// GetSize()==0 until it's attached to a Doc via the parent's
			// Set call. So we track whether we wrote any entry on a
			// plain Go bool (the same shape the merges block above
			// uses) instead of asking the YMap how many entries it
			// holds. Skipping this tripped a silent no-op for all three
			// fields and broke the bootstrap→serializer round-trip.
			if len(sheet.RowHeights) > 0 {
				heightsMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for row, px := range sheet.RowHeights {
					if row < 1 || px <= 0 {
						continue
					}
					heightsMap.Set(strconv.Itoa(row), px)
					wroteAny = true
				}
				if wroteAny {
					meta.Set("rowHeights", heightsMap)
				}
			}
			if len(sheet.ColWidths) > 0 {
				widthsMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for col, px := range sheet.ColWidths {
					if col < 1 || px <= 0 {
						continue
					}
					widthsMap.Set(strconv.Itoa(col), px)
					wroteAny = true
				}
				if wroteAny {
					meta.Set("colWidths", widthsMap)
				}
			}
			if len(sheet.ConditionalFormats) > 0 {
				cfArr := buildConditionalFormatsYArray(sheet.ConditionalFormats)
				if cfArr != nil {
					meta.Set("conditionalFormats", cfArr)
				}
			}

			if len(sheet.RowStyles) > 0 {
				stylesMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for row, style := range sheet.RowStyles {
					if row < 1 || style == nil {
						continue
					}
					if built := buildStyleYMapFromStyle(style); built != nil {
						stylesMap.Set(strconv.Itoa(row), built)
						wroteAny = true
					}
				}
				if wroteAny {
					meta.Set("rowStyles", stylesMap)
				}
			}

			for localKey, value := range sheet.Cells {
				row, col, ok := parseLocalCellKey(localKey)
				if !ok {
					continue
				}
				cell := ycrdt.NewYMap(nil)
				cell.Set("kind", value.Kind)
				cell.Set("raw", normalizeRawForY(value.Raw))
				cell.Set("display", value.Display)
				if value.Formula != "" {
					cell.Set("formula", value.Formula)
				}
				if value.Style != nil {
					if styleMap := buildStyleYMapFromStyle(value.Style); styleMap != nil {
						cell.Set("style", styleMap)
					}
				}
				cellsMap.Set(fmt.Sprintf("%s:%d:%d", sheetID, row, col), cell)
			}
		}
	}, nil)
	return nil
}

// parseLocalCellKey splits "row:col" (the TS local key, scoped to one
// sheet) into its two integers. Returns ok=false on malformed input;
// caller skips the cell.
func parseLocalCellKey(key string) (int, int, bool) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	row, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, false
	}
	col, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, false
	}
	if row <= 0 || col <= 0 {
		return 0, 0, false
	}
	return row, col, true
}

// normalizeRawForY normalizes a parsed raw scalar into the form
// y-crdt's TypeMapSet accepts. The library's content_any path only
// recognizes a narrow set of types: string, bool, int (its `Number`
// alias), float32/float64 are NOT accepted by direct Set even though
// they ARE on the binary-update encode path.
//   - whole-number float64 → int (the only numeric Set supports)
//   - fractional float64 → string (lossy display fallback; the
//     remaining float→int gap is rare in xlsx imports and a future
//     "go through binary update" rework is the right fix when it
//     starts mattering)
//   - bool / string / nil pass through
func normalizeRawForY(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case bool:
		return x
	case float64:
		if x == float64(int(x)) {
			return int(x)
		}
		return formatNumber(x)
	case int:
		return x
	case string:
		return x
	default:
		return fmt.Sprintf("%v", x)
	}
}

// buildStyleYMapFromStyle converts a *CellStyle (the JSON-tagged Go
// shape) into the nested YMap tree the runtime's collectCells
// decoder expects. Mirrors the TS buildStyleYMap (y-doc-bootstrap.ts).
//
// The walk is reflect-driven and follows the json tags on CellStyle /
// CellFont / CellFill / CellAlignment / CellBorders. Only non-nil
// pointer leaves are emitted; an entirely-empty style returns nil so
// callers can skip the `style` cell key.
//
// Adding a new CellStyle field is purely additive: declare the field
// (with a camelCase json tag) on the Go and TS sides, register it in
// styleAttributeRegistry if its overlay isn't structurally 1:1, and
// every path — overlay, extract, bootstrap emit, audit — picks it up.
func buildStyleYMapFromStyle(style *CellStyle) *ycrdt.YMap {
	if style == nil {
		return nil
	}
	root := ycrdt.NewYMap(nil)
	if !emitStyleYMap(reflect.ValueOf(style).Elem(), root) {
		return nil
	}
	return root
}

// emitStyleYMap walks the leaves of one CellStyle-shaped struct value
// onto a YMap. Pointer-to-struct fields recurse into a nested YMap
// keyed by the field's json tag. Pointer-to-scalar fields land as a
// leaf on the current YMap. Returns true when at least one leaf was
// written, so the caller can decide whether to attach this group to
// its parent at all.
//
// Float64 leaves (Font.Size today) go through normalizeRawForY before
// being Set on the YMap. y-crdt's Go TypeMapSet only accepts
// Number(=int)|Object|bool|ArrayAny|string and silently drops a
// float64. The TS side bootstrap stores numbers natively because Yjs
// has no integer/float split there; the Go side needs the same
// coercion the cell-raw path uses.
func emitStyleYMap(src reflect.Value, dst *ycrdt.YMap) bool {
	if src.Kind() != reflect.Struct {
		return false
	}
	srcType := src.Type()
	wrote := false
	for i := range src.NumField() {
		field := src.Field(i)
		if field.Kind() != reflect.Pointer || field.IsNil() {
			continue
		}
		key := jsonFieldKey(srcType.Field(i))
		if key == "" {
			continue
		}
		elem := field.Elem()
		if elem.Kind() == reflect.Struct {
			group := ycrdt.NewYMap(nil)
			if emitStyleYMap(elem, group) {
				dst.Set(key, group)
				wrote = true
			}
			continue
		}
		value := elem.Interface()
		if f, ok := value.(float64); ok {
			value = normalizeRawForY(f)
		}
		dst.Set(key, value)
		wrote = true
	}
	return wrote
}

// jsonFieldKey returns the camelCase wire key for a Go struct field,
// derived from its json tag. Tagless fields (none of our style structs
// have any) are skipped.
func jsonFieldKey(field reflect.StructField) string {
	tag := field.Tag.Get("json")
	if tag == "" {
		return ""
	}
	for i := 0; i < len(tag); i++ {
		if tag[i] == ',' {
			return tag[:i]
		}
	}
	return tag
}

// buildConditionalFormatsYArray seeds the per-sheet rules Y.Array
// from imported model rules. Shape MUST stay in sync with the TS
// y-binding writeRule (lib/conditional-format/y-binding.ts) — same
// field names and nesting so a peer joining mid-session via doc
// update sees a structurally identical tree.
//
// Returns nil when no rules pass the structural sanity check (id +
// at least one range, or an opaque blob), so callers can skip the
// meta key.
func buildConditionalFormatsYArray(rules []ConditionalFormatRule) *ycrdt.YArray {
	if len(rules) == 0 {
		return nil
	}
	arr := ycrdt.NewYArray()
	wroteAny := false
	for _, rule := range rules {
		if rule.ID == "" {
			continue
		}
		m := ycrdt.NewYMap(nil)
		m.Set("id", rule.ID)
		rangesArr := ycrdt.NewYArray()
		for _, r := range rule.Ranges {
			if r == "" {
				continue
			}
			rangesArr.Push(ycrdt.ArrayAny{r})
		}
		m.Set("ranges", rangesArr)
		condMap := ycrdt.NewYMap(nil)
		condMap.Set("type", rule.Condition.Type)
		if rule.Condition.Value1 != nil {
			condMap.Set("value1", *rule.Condition.Value1)
		}
		if rule.Condition.Value2 != nil {
			condMap.Set("value2", *rule.Condition.Value2)
		}
		if rule.Condition.Formula != nil && *rule.Condition.Formula != "" {
			condMap.Set("formula", *rule.Condition.Formula)
		}
		if rule.Condition.OpaqueXlsx != nil {
			opaqueMap := ycrdt.NewYMap(nil)
			for k, v := range rule.Condition.OpaqueXlsx {
				opaqueMap.Set(k, normalizeRawForY(v))
			}
			condMap.Set("opaqueXlsx", opaqueMap)
		}
		m.Set("condition", condMap)
		if rule.Style != nil {
			if styleMap := buildStyleYMapFromStyle(rule.Style); styleMap != nil {
				m.Set("style", styleMap)
			}
		}
		arr.Push(ycrdt.ArrayAny{m})
		wroteAny = true
	}
	if !wroteAny {
		return nil
	}
	return arr
}
