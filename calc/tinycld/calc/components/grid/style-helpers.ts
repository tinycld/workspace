import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import type * as Y from 'yjs'
import type { CellRange } from '../../hooks/grid-store'
import { setYCellStyle, type useYCell } from '../../hooks/use-y-cell'
import { firstColAtOffset, firstRowAtOffset } from '../../lib/dimensions'
import { forEachCellInRange } from '../../lib/selection-range'
import type { CellStyle } from '../../lib/workbook-types'
import { formatCell } from '../../lib/workbook-types'
import { yCellKey } from '../../lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../../lib/y-doc-bootstrap'

// computeFormulaBarValue picks the right text to display in the
// formula bar:
//   - while editing, show the in-progress draft
//   - for formula cells, show the formula expression (so editing
//     round-trips the formula text rather than its cached result)
//   - otherwise, show the same string the cell renders
export function computeFormulaBarValue(
    editSession: { draft: string } | null,
    cell: ReturnType<typeof useYCell>,
    hasSelection: boolean
): string {
    if (editSession != null) return editSession.draft
    if (!hasSelection || cell == null) return ''
    if (cell.kind === 'formula' && cell.formula) {
        return cell.formula
    }
    return formatCell(cell.kind, cell.raw, cell.formula, cell.style?.numFmt)
}

// readCellStyle is a one-shot read of a cell's style from the Y.Doc.
// Used by handlers that need the current value to compute a toggle —
// can't use the useYCell hook from inside a callback, and subscribing
// the whole Grid to every cell change just to know whether bold is on
// would be wasteful.
export function readCellStyle(doc: Y.Doc | null, sheetId: string, row: number, col: number) {
    if (doc == null) return undefined
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)
}

type FontToggleAttr = 'bold' | 'italic' | 'strike' | 'underline'

// toggleCellFontAttrInRange flips one boolean font attribute (bold,
// italic, strike, or underline) on every cell inside `range`. Mixed-
// state semantics: if any cell in the range has the attribute OFF,
// turn ALL cells to ON; otherwise (all cells ON), turn ALL to OFF.
// Mirrors how Google Sheets / Excel toggle a multi-cell selection —
// any unset cell wins, so a single click "promotes" the whole range
// to bold rather than leaving it half-formatted.
//
// The write loop runs inside a single doc.transact (via
// applyStyleToRange) so undo treats it as one step and observers
// fire once per cell rather than receiving per-attribute splits.
//
// The READ pass deliberately runs outside that transaction. Yjs is
// single-threaded JS, so no local mutation can interleave; a
// concurrent peer's applyUpdate landing between the read and the
// write would race against the local user's "any-off → all-on"
// decision and use stale state. We accept this — it matches the
// optimistic-CRDT behavior in Sheets/Excel under contention. Moving
// the read inside doc.transact wouldn't help: yjs doesn't isolate
// transactions from remote updates, and the JS-level captured value
// would still be stale.
export function toggleCellFontAttrInRange(
    doc: Y.Doc | null,
    sheetId: string,
    range: CellRange,
    attr: FontToggleAttr
): void {
    if (doc == null) return
    let anyOff = false
    forEachCellInRange(range, (row, col) => {
        const style = readCellStyle(doc, sheetId, row, col)
        if (style?.font?.[attr] !== true) anyOff = true
    })
    const next = anyOff
    applyStyleToRange(doc, sheetId, range, { font: { [attr]: next } })
}

// applyStyleToRange applies the same partial CellStyle patch to every
// cell inside `range` in a single yjs transaction. Used by the
// toolbar font/fill/border/alignment/number-format setters so a
// range-write is one undo step and one observer notification per
// cell, not N transactions.
export function applyStyleToRange(
    doc: Y.Doc | null,
    sheetId: string,
    range: CellRange,
    patch: CellStyle
): void {
    if (doc == null) return
    doc.transact(() => {
        forEachCellInRange(range, (row, col) => {
            setYCellStyle(doc, sheetId, row, col, patch)
        })
    }, LOCAL_ORIGIN)
}

// toggleCellFontAttrAcrossRanges is the disjoint-aware variant of
// toggleCellFontAttrInRange. It computes the mixed-toggle decision
// (any-off → all-on; otherwise all-off) once over the UNION of every
// passed range, then applies the chosen value inside a single
// doc.transact so the whole write is one undo step and observers
// fire once per cell.
//
// The read pass and write pass both walk every range in order. The
// read race-condition concern (see toggleCellFontAttrInRange) applies
// the same way; the union scope is the same as a single rectangle
// for the purposes of optimistic-CRDT semantics.
export function toggleCellFontAttrAcrossRanges(
    doc: Y.Doc | null,
    sheetId: string,
    ranges: CellRange[],
    attr: FontToggleAttr
): void {
    if (doc == null) return
    if (ranges.length === 0) return
    // Inlined read loop with labelled break so the inner per-cell
    // walk stops as soon as we find a single OFF cell — the union
    // mixed-toggle decision needs only one OFF cell to be made, and
    // forEachCellInRange has no early-exit callback contract.
    let anyOff = false
    outer: for (const range of ranges) {
        for (let row = range.startRow; row <= range.endRow; row++) {
            for (let col = range.startCol; col <= range.endCol; col++) {
                const style = readCellStyle(doc, sheetId, row, col)
                if (style?.font?.[attr] !== true) {
                    anyOff = true
                    break outer
                }
            }
        }
    }
    const next = anyOff
    doc.transact(() => {
        for (const range of ranges) {
            forEachCellInRange(range, (row, col) => {
                setYCellStyle(doc, sheetId, row, col, { font: { [attr]: next } })
            })
        }
    }, LOCAL_ORIGIN)
}

// locateCellAtGridCoord maps an (x, y) inside the grid body to the
// 1-based (row, col) of the cell at that point. Used by the cell
// PanResponder to translate pointer-move locations into the cell the
// user has dragged onto. Returns null when the coordinate falls in a
// hidden (zero-width or zero-height) cell or outside the grid.
export function locateCellAtGridCoord(
    x: number,
    y: number,
    colOffsets: Float64Array,
    rowOffsets: Float64Array
): { row: number; col: number } | null {
    if (y < 0) return null
    const row = firstRowAtOffset(rowOffsets, y)
    const col = firstColAtOffset(colOffsets, x)
    if (row < 1 || col < 1) return null
    const top = rowOffsets[row - 1] ?? 0
    const bottom = rowOffsets[row] ?? top
    if (bottom - top <= 0) return null
    const left = colOffsets[col - 1] ?? 0
    const right = colOffsets[col] ?? left
    if (right - left <= 0) return null
    return { row, col }
}
