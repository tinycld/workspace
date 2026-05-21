// Column- and row-dimension helpers for the calc grid.
//
// Column widths and row heights are stored per-sheet on the Y.Doc as
// sparse Y.Maps — only entries whose value differs from the default
// have a stored entry, which keeps the doc cheap for sheets that never
// get resized. The snapshot returned by `useYSheets` exposes these as
// plain Record<number, number>; `readColWidth` / `readRowHeight` are
// the single read-side helpers every layout calculation goes through.
//
// The two axes mirror each other: every column-side helper has a
// row-side counterpart with the axis swapped (col → row, width →
// height, x → y).
import * as Y from 'yjs'
import { yCellKey } from './y-cell-key'
import { CELLS_MAP, SHEETS_MAP } from './y-doc-bootstrap'

// Matches the legacy CELL_WIDTH that callers rendered before per-column
// widths existed. Keeping the same default means an unresized sheet is
// pixel-identical to the pre-resize behavior.
export const DEFAULT_COL_WIDTH = 96

// Drag below DEFAULT-floor and the column hides (width=0). Excel and
// Sheets allow hide-by-drag this way; we mirror the pattern. The snap
// threshold is the visible width below which we round to 0 instead of
// rendering a hairline-thin column the user can no longer click.
export const MIN_COL_WIDTH = 0
export const HIDE_SNAP_THRESHOLD = 8

// Sheets caps at 2000px; Excel's effective cap is similar. No reason to
// be tighter — autosize is hard-capped against this so a single runaway
// cell doesn't blow out the layout.
export const MAX_COL_WIDTH = 2000

// Horizontal padding added to the measured text width when autosizing.
// Cells render with `px-1` (4px each side) plus the right border, so
// 12px each side gives a comfortable gutter that matches what users
// expect from "fit to data" in other spreadsheets.
export const AUTOSIZE_PADDING = 24

// COL_WIDTHS_KEY is the nested key under each sheet's metadata Y.Map
// holding a Y.Map<number> from "col" → width-in-px. Lazily created on
// first write so an unresized sheet adds zero bytes to the doc.
export const COL_WIDTHS_KEY = 'colWidths'

export type ColWidths = Record<number, number>

export function readColWidth(colWidths: ColWidths | undefined, col: number): number {
    if (colWidths == null) return DEFAULT_COL_WIDTH
    const w = colWidths[col]
    return typeof w === 'number' ? w : DEFAULT_COL_WIDTH
}

export function clampColWidth(width: number): number {
    if (!Number.isFinite(width)) return DEFAULT_COL_WIDTH
    if (width < HIDE_SNAP_THRESHOLD) return 0
    if (width > MAX_COL_WIDTH) return MAX_COL_WIDTH
    return Math.round(width)
}

// setYColWidth writes a column's width to the sheet's nested colWidths
// Y.Map, lazily creating the map on first write. Width is clamped to
// [0, MAX_COL_WIDTH] (with a snap-to-hidden floor below
// HIDE_SNAP_THRESHOLD). Writing DEFAULT_COL_WIDTH deletes the entry
// instead of storing it — keeps the map sparse and lets the absence
// of an entry mean "default" everywhere.
export function setYColWidth(doc: Y.Doc | null, sheetId: string, col: number, width: number): void {
    if (doc == null) return
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (meta == null) return
    const clamped = clampColWidth(width)
    doc.transact(() => {
        let widths = meta.get(COL_WIDTHS_KEY)
        if (clamped === DEFAULT_COL_WIDTH) {
            if (widths instanceof Y.Map) {
                widths.delete(String(col))
            }
            return
        }
        if (!(widths instanceof Y.Map)) {
            widths = new Y.Map<number>()
            meta.set(COL_WIDTHS_KEY, widths)
        }
        ;(widths as Y.Map<number>).set(String(col), clamped)
    })
}

// readColWidthsFromMeta extracts the sheet's colWidths Y.Map (if any)
// into a plain Record. Used by useYSheets to build the snapshot. Keeps
// the resulting object sparse so consumers can fall back to the default
// for absent columns via `readColWidth`.
export function readColWidthsFromMeta(meta: Y.Map<unknown> | undefined): ColWidths | undefined {
    if (meta == null) return undefined
    const widths = meta.get(COL_WIDTHS_KEY)
    if (!(widths instanceof Y.Map)) return undefined
    if (widths.size === 0) return undefined
    const out: ColWidths = {}
    widths.forEach((value, key) => {
        if (typeof value !== 'number') return
        const col = Number(key)
        if (!Number.isFinite(col)) return
        out[col] = value
    })
    return out
}

// buildColOffsets returns a Float64Array where `offsets[c]` is the pixel
// x-coordinate of the LEFT edge of column c+1 (so `offsets[0] === 0`
// and `offsets[cols] === total content width`). Used both for direct
// position lookups in render and as the input to the visible-range
// binary search.
export function buildColOffsets(cols: number, colWidths: ColWidths | undefined): Float64Array {
    const out = new Float64Array(cols + 1)
    let acc = 0
    for (let c = 1; c <= cols; c++) {
        acc += readColWidth(colWidths, c)
        out[c] = acc
    }
    return out
}

// firstColAtOffset returns the 1-based column index whose left edge is
// at or before `x`. Binary search over the prefix-sum offsets. Returns
// `cols` if `x` is past the last column. Used by the visible-range
// memo to find the first column to render at the current scroll
// position.
export function firstColAtOffset(offsets: Float64Array, x: number): number {
    if (x <= 0) return 1
    const lastCol = offsets.length - 1
    if (lastCol < 1) return 1
    if (x >= offsets[lastCol]) return lastCol
    // Largest c such that offsets[c] <= x → first column whose right
    // edge is past x is c+1. Off-by-one note: offsets[c] is the LEFT
    // edge of column c+1, so we want the column where x falls *inside*
    // it — that's the column index c+1 such that offsets[c] <= x <
    // offsets[c+1].
    let lo = 0
    let hi = lastCol
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1
        if (offsets[mid] <= x) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return Math.max(1, lo + 1)
}

// lastColAtOffset returns the 1-based column index that contains `x`
// at the end of the viewport (i.e. the last column whose left edge is
// before `x`). Mirrors `firstColAtOffset` for the right-hand bound.
export function lastColAtOffset(offsets: Float64Array, x: number): number {
    const lastCol = offsets.length - 1
    if (lastCol < 1) return 0
    if (x <= 0) return 1
    if (x >= offsets[lastCol]) return lastCol
    let lo = 1
    let hi = lastCol
    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (offsets[mid] >= x) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}

// measureWidestDisplay walks the cells Y.Map for a single column and
// returns the maximum width (in px) of any rendered `display` string,
// using `measure` to render each candidate. On web we pass a canvas
// 2D measurement function; on native a glyph-count estimate. Returns
// 0 if the column has no non-empty cells.
//
// We read directly from the Y.Doc rather than going through useYCell
// because autosize is a one-shot operation — we don't need
// subscriptions, and walking the cells map once is O(cells-on-sheet)
// which is fine even for dense sheets.
export function measureWidestDisplay(
    doc: Y.Doc,
    sheetId: string,
    col: number,
    measure: (text: string) => number
): number {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    let max = 0
    cellsMap.forEach((cell, key) => {
        // Cheap prefix filter to avoid splitting every cell key when
        // most cells aren't on this column. yCellKey is
        // "<sheetId>:<row>:<col>" — we ignore the row.
        if (!key.startsWith(`${sheetId}:`)) return
        const lastColon = key.lastIndexOf(':')
        if (lastColon < 0) return
        if (Number(key.slice(lastColon + 1)) !== col) return
        const display = cell.get('display')
        if (typeof display !== 'string' || display.length === 0) return
        const w = measure(display)
        if (w > max) max = w
    })
    return max
}

// autosizeColumnWidth returns the width that autosize would commit for
// the given column, given a measure function. Pulled out from the doc
// write so callers can preview, test, or intercept (e.g. for
// non-uniform padding). Always returns a clamped value.
export function autosizeColumnWidth(
    doc: Y.Doc,
    sheetId: string,
    col: number,
    measure: (text: string) => number
): number {
    const widest = measureWidestDisplay(doc, sheetId, col, measure)
    if (widest <= 0) return DEFAULT_COL_WIDTH
    return clampColWidth(widest + AUTOSIZE_PADDING)
}

// ----- Row heights ---------------------------------------------------
//
// Mirror of the column helpers above with the axis swapped. A separate
// sparse Y.Map under each sheet's metadata holds non-default row
// heights; rows whose height is DEFAULT_ROW_HEIGHT have no entry.

// Matches the legacy CELL_HEIGHT that callers rendered before per-row
// heights existed. Keeping the same default means an unresized sheet is
// pixel-identical to the pre-resize behavior.
export const DEFAULT_ROW_HEIGHT = 28

// Row-hide-by-drag mirrors the column behavior: drag a row handle
// upward and below ROW_HIDE_SNAP_THRESHOLD the row snaps to height 0.
export const MIN_ROW_HEIGHT = 0
export const ROW_HIDE_SNAP_THRESHOLD = 8

// Cap large row heights so a runaway autosize on a wrapped cell can't
// blow out the layout. 1000px is well past anything reasonable for a
// single row but leaves room for tall multi-line content.
export const MAX_ROW_HEIGHT = 1000

// Vertical padding added to the measured text height when autosizing.
// Cell content centers vertically with a small gutter; 8px keeps text
// from sitting flush against the row borders.
export const AUTOSIZE_ROW_PADDING = 8

// ROW_HEIGHTS_KEY is the nested key under each sheet's metadata Y.Map
// holding a Y.Map<number> from "row" → height-in-px. Lazily created on
// first write so an unresized sheet adds zero bytes to the doc.
export const ROW_HEIGHTS_KEY = 'rowHeights'

export type RowHeights = Record<number, number>

export function readRowHeight(rowHeights: RowHeights | undefined, row: number): number {
    if (rowHeights == null) return DEFAULT_ROW_HEIGHT
    const h = rowHeights[row]
    return typeof h === 'number' ? h : DEFAULT_ROW_HEIGHT
}

export function clampRowHeight(height: number): number {
    if (!Number.isFinite(height)) return DEFAULT_ROW_HEIGHT
    if (height < ROW_HIDE_SNAP_THRESHOLD) return 0
    if (height > MAX_ROW_HEIGHT) return MAX_ROW_HEIGHT
    return Math.round(height)
}

// setYRowHeight writes a row's height to the sheet's nested rowHeights
// Y.Map, lazily creating the map on first write. Height is clamped to
// [0, MAX_ROW_HEIGHT] (with a snap-to-hidden floor below
// ROW_HIDE_SNAP_THRESHOLD). Writing DEFAULT_ROW_HEIGHT deletes the entry
// instead of storing it — keeps the map sparse and lets the absence
// of an entry mean "default" everywhere.
export function setYRowHeight(
    doc: Y.Doc | null,
    sheetId: string,
    row: number,
    height: number
): void {
    if (doc == null) return
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (meta == null) return
    const clamped = clampRowHeight(height)
    doc.transact(() => {
        let heights = meta.get(ROW_HEIGHTS_KEY)
        if (clamped === DEFAULT_ROW_HEIGHT) {
            if (heights instanceof Y.Map) {
                heights.delete(String(row))
            }
            return
        }
        if (!(heights instanceof Y.Map)) {
            heights = new Y.Map<number>()
            meta.set(ROW_HEIGHTS_KEY, heights)
        }
        ;(heights as Y.Map<number>).set(String(row), clamped)
    })
}

export function readRowHeightsFromMeta(meta: Y.Map<unknown> | undefined): RowHeights | undefined {
    if (meta == null) return undefined
    const heights = meta.get(ROW_HEIGHTS_KEY)
    if (!(heights instanceof Y.Map)) return undefined
    if (heights.size === 0) return undefined
    const out: RowHeights = {}
    heights.forEach((value, key) => {
        if (typeof value !== 'number') return
        const row = Number(key)
        if (!Number.isFinite(row)) return
        out[row] = value
    })
    return out
}

// buildRowOffsets returns a Float64Array where `offsets[r]` is the pixel
// y-coordinate of the TOP edge of row r+1 (so `offsets[0] === 0` and
// `offsets[rows] === total content height`). Used both for direct
// position lookups in render and as the input to the visible-range
// binary search.
export function buildRowOffsets(rows: number, rowHeights: RowHeights | undefined): Float64Array {
    const out = new Float64Array(rows + 1)
    let acc = 0
    for (let r = 1; r <= rows; r++) {
        acc += readRowHeight(rowHeights, r)
        out[r] = acc
    }
    return out
}

export function firstRowAtOffset(offsets: Float64Array, y: number): number {
    if (y <= 0) return 1
    const lastRow = offsets.length - 1
    if (lastRow < 1) return 1
    if (y >= offsets[lastRow]) return lastRow
    let lo = 0
    let hi = lastRow
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1
        if (offsets[mid] <= y) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return Math.max(1, lo + 1)
}

export function lastRowAtOffset(offsets: Float64Array, y: number): number {
    const lastRow = offsets.length - 1
    if (lastRow < 1) return 0
    if (y <= 0) return 1
    if (y >= offsets[lastRow]) return lastRow
    let lo = 1
    let hi = lastRow
    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (offsets[mid] >= y) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}

// Re-exported for callers that want to compose `yCellKey` without
// pulling another import — autosize lives in this file alongside the
// other dimension helpers, and the cell-key shape is part of the same
// "how to walk the doc for column data" surface.
export { yCellKey }
