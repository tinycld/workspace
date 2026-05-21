// Selection helpers — small, dependency-free utilities for the
// ordered-list-of-sub-ranges model used by the per-Grid store.
//
// A `Selection` is either `null` (nothing selected) or a non-empty
// `{ ranges: SubRange[] }`. A single-cell or single-rectangle
// selection is `ranges.length === 1`; disjoint multi-selection is
// `ranges.length > 1`. The LAST entry of `ranges` is both the "primary"
// (its anchor drives the formula bar, keyboard nav, awareness
// publishing) and the "active" (Shift-click extends its range).
// Ctrl-click appends a new entry, moving the primary anchor to the
// just-clicked cell (Sheets parity).
//
// Per-range scope (`SubRange.scope`) records how each rectangle was
// originally selected — 'cells' for a body selection, 'row' for a row
// header click, 'column' for a column header click. Mutation routing
// reads scope per sub-range; UI affordance routing reads
// `overallScope(selection)` which collapses to a single enum or 'mixed'.
//
// Lives in lib/ (not the store) so the toolbar callbacks, style
// helpers, and tests can import without pulling Zustand into their
// dependency graph.

import type { CellRange, SelectedCell, SelectionScope } from '../hooks/grid-store'

// SubRange is one rectangle the user selected. The (anchor, range,
// scope) triple is intentional:
//   - anchor remembers the cell that started THIS sub-range; Shift-
//     click extends from this anchor (not the primary anchor).
//   - range is the normalized rectangle.
//   - scope is the per-rectangle interpretation (body vs row/col
//     header click). Two ranges in the same Selection can have
//     different scopes — Ctrl-click row 2 then Ctrl-click column C
//     keeps each rectangle's per-axis identity.
export interface SubRange {
    anchor: SelectedCell
    range: CellRange
    scope: SelectionScope
}

// A non-null Selection has at least one SubRange. The last entry is
// the primary/active one — see file header.
export type Selection = { ranges: SubRange[] } | null

// OverallScope is what UI affordances (header bolding, indicator
// labels) read when they need a "what kind of selection is this?"
// answer. 'mixed' surfaces when a disjoint selection contains
// rectangles of different scopes. Writes never use this — they
// iterate sub-ranges and consult each scope individually.
export type OverallScope = SelectionScope | 'mixed'

// rangeContainsCell returns true if (row, col) falls inside the
// inclusive bounds of `range`.
export function rangeContainsCell(range: CellRange, row: number, col: number): boolean {
    return (
        row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol
    )
}

// rangeCellCount is the inclusive cell count of a single range.
export function rangeCellCount(range: CellRange): number {
    return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1)
}

// forEachCellInRange invokes `fn(row, col)` for every cell inside the
// inclusive bounds of `range`, row-major.
export function forEachCellInRange(range: CellRange, fn: (row: number, col: number) => void): void {
    for (let r = range.startRow; r <= range.endRow; r++) {
        for (let c = range.startCol; c <= range.endCol; c++) {
            fn(r, c)
        }
    }
}

// shiftIndexForInsert returns the new row/col index after `count` rows
// or columns are inserted at `insertAt` (1-based). Indices < insertAt
// stay put; indices >= insertAt shift right/down by `count`.
export function shiftIndexForInsert(index: number, insertAt: number, count: number): number {
    return index >= insertAt ? index + count : index
}

// shiftRangeForInsert applies shiftIndexForInsert to a CellRange's
// start/end on a single axis.
export function shiftRangeForInsert(
    range: CellRange,
    axis: 'row' | 'col',
    insertAt: number,
    count: number
): CellRange {
    if (axis === 'row') {
        return {
            startRow: shiftIndexForInsert(range.startRow, insertAt, count),
            endRow: shiftIndexForInsert(range.endRow, insertAt, count),
            startCol: range.startCol,
            endCol: range.endCol,
        }
    }
    return {
        startRow: range.startRow,
        endRow: range.endRow,
        startCol: shiftIndexForInsert(range.startCol, insertAt, count),
        endCol: shiftIndexForInsert(range.endCol, insertAt, count),
    }
}

// clampIndexForDelete returns the new row/col index after `count` rows
// or columns are deleted starting at `fromIndex` (1-based) on a sheet
// whose post-delete extent is `newAxisCount`. Indices before the
// deletion site stay put; indices past the deleted range shift left /
// up by `count`. Indices that fell inside the deletion snap to the
// first surviving slot at the deletion site, clamped into the new
// bounds.
export function clampIndexForDelete(
    index: number,
    fromIndex: number,
    count: number,
    newAxisCount: number
): number {
    if (index < fromIndex) return index
    if (index >= fromIndex + count) return index - count
    return Math.min(fromIndex, newAxisCount)
}

// Selection helpers ----------------------------------------------------

// primaryAnchor returns the anchor of the last (primary) sub-range,
// or null when the selection is empty. The "primary" anchor drives
// the formula bar, keyboard nav, and awareness publishing.
export function primaryAnchor(selection: Selection): SelectedCell | null {
    if (selection == null || selection.ranges.length === 0) return null
    return selection.ranges[selection.ranges.length - 1].anchor
}

// primaryRange returns the range of the last (primary) sub-range, or
// null when the selection is empty. Tier B consumers (sort dialog,
// filter view, print "current selection", freeze) read this when they
// fall back to single-rectangle behavior on a disjoint selection.
export function primaryRange(selection: Selection): CellRange | null {
    if (selection == null || selection.ranges.length === 0) return null
    return selection.ranges[selection.ranges.length - 1].range
}

// activeSubRange returns the last (primary/active) sub-range, or
// null when empty. The "active" sub-range is the one Shift-click
// extends — same as primary in this model.
export function activeSubRange(selection: Selection): SubRange | null {
    if (selection == null || selection.ranges.length === 0) return null
    return selection.ranges[selection.ranges.length - 1]
}

// allRanges returns every sub-range's `range` (without anchor/scope).
// Used by Tier A consumers that iterate every rectangle to apply a
// per-cell write.
export function allRanges(selection: Selection): CellRange[] {
    if (selection == null) return []
    return selection.ranges.map(sr => sr.range)
}

// isDisjoint returns true when the selection has more than one
// sub-range. Tier B consumers branch on this to switch into "use
// primary / disable / refuse" mode.
export function isDisjoint(selection: Selection): boolean {
    return selection != null && selection.ranges.length > 1
}

// forEachCellInSelection invokes `fn(row, col)` for every cell in
// every sub-range, in sub-range order then row-major within each.
// Overlapping sub-ranges visit the overlapping cells more than once;
// for idempotent writes (style toggles, clears) that's fine — Sheets
// behaves the same way.
export function forEachCellInSelection(
    selection: Selection,
    fn: (row: number, col: number) => void
): void {
    if (selection == null) return
    for (const sr of selection.ranges) {
        forEachCellInRange(sr.range, fn)
    }
}

// unionBoundingBox returns the smallest rectangle that contains every
// sub-range, or null when the selection is empty. Used by perf
// optimizations (e.g. fast-reject in containsAny) and any consumer
// that needs a single rectangle "tour" of the selection.
export function unionBoundingBox(selection: Selection): CellRange | null {
    if (selection == null || selection.ranges.length === 0) return null
    const first = selection.ranges[0].range
    let startRow = first.startRow
    let endRow = first.endRow
    let startCol = first.startCol
    let endCol = first.endCol
    for (let i = 1; i < selection.ranges.length; i++) {
        const r = selection.ranges[i].range
        if (r.startRow < startRow) startRow = r.startRow
        if (r.endRow > endRow) endRow = r.endRow
        if (r.startCol < startCol) startCol = r.startCol
        if (r.endCol > endCol) endCol = r.endCol
    }
    return { startRow, endRow, startCol, endCol }
}

// containsAny is the perf-critical primitive used by every visible
// Cell to decide its range-tint. Returns true if (row, col) falls
// inside any sub-range of the selection. Cells outside the selection
// short-circuit on the boolean's reference equality (the result
// stays false across pointermoves while a drag stretches the active
// sub-range somewhere else on screen), so non-selected cells don't
// re-render.
export function containsAny(selection: Selection, row: number, col: number): boolean {
    if (selection == null) return false
    const ranges = selection.ranges
    for (let i = 0; i < ranges.length; i++) {
        if (rangeContainsCell(ranges[i].range, row, col)) return true
    }
    return false
}

// subRangeAtCell returns the first sub-range that contains (row, col),
// or null. Used by openCellContextMenu to decide whether a right-click
// should keep the disjoint selection (click landed inside any sub-
// range) or collapse to single-cell.
export function subRangeAtCell(
    selection: Selection,
    row: number,
    col: number
): SubRange | null {
    if (selection == null) return null
    for (const sr of selection.ranges) {
        if (rangeContainsCell(sr.range, row, col)) return sr
    }
    return null
}

// overallScope collapses the per-sub-range scopes to a single tag for
// UI consumers (header bolding, indicator labels). 'mixed' surfaces
// when sub-ranges disagree.
export function overallScope(selection: Selection): OverallScope {
    if (selection == null || selection.ranges.length === 0) return 'cells'
    const first = selection.ranges[0].scope
    for (let i = 1; i < selection.ranges.length; i++) {
        if (selection.ranges[i].scope !== first) return 'mixed'
    }
    return first
}

// shiftSubRangesForInsert maps shiftRangeForInsert over every sub-
// range's `range` (and also its `anchor`) so a structural insert
// shifts all sub-ranges in lockstep. Returns a new selection with the
// same length (no sub-ranges are dropped by inserts).
export function shiftSubRangesForInsert(
    selection: Selection,
    axis: 'row' | 'col',
    insertAt: number,
    count: number
): Selection {
    if (selection == null) return null
    return {
        ranges: selection.ranges.map(sr => ({
            anchor:
                axis === 'row'
                    ? {
                          row: shiftIndexForInsert(sr.anchor.row, insertAt, count),
                          col: sr.anchor.col,
                      }
                    : {
                          row: sr.anchor.row,
                          col: shiftIndexForInsert(sr.anchor.col, insertAt, count),
                      },
            range: shiftRangeForInsert(sr.range, axis, insertAt, count),
            scope: sr.scope,
        })),
    }
}

// clampSubRangesForDelete clamps every sub-range's `range` after a
// row/col delete. Sub-ranges that fell ENTIRELY inside the deleted
// span are dropped (the user's selection had no surviving rows/cols);
// sub-ranges that straddle the deletion shrink to the surviving
// portion; sub-ranges past the deletion shift down/left by `count`.
// The anchor also clamps via clampIndexForDelete; if it ends up
// outside the surviving range, snap it to the range's top-left so
// the invariant "anchor is inside range" is preserved.
//
// Returns null when every sub-range was dropped. Callers should
// treat null as "no selection left".
export function clampSubRangesForDelete(
    selection: Selection,
    axis: 'row' | 'col',
    fromIndex: number,
    count: number,
    newAxisCount: number
): Selection {
    if (selection == null) return null
    const next: SubRange[] = []
    for (const sr of selection.ranges) {
        if (axis === 'row') {
            // Drop sub-ranges entirely inside the deleted span.
            if (
                sr.range.startRow >= fromIndex &&
                sr.range.endRow < fromIndex + count
            ) {
                continue
            }
            const startRow = clampIndexForDelete(sr.range.startRow, fromIndex, count, newAxisCount)
            const endRow = clampIndexForDelete(sr.range.endRow, fromIndex, count, newAxisCount)
            const normStartRow = Math.min(startRow, endRow)
            const normEndRow = Math.max(startRow, endRow)
            if (normStartRow < 1 || normStartRow > newAxisCount) continue
            const anchorRow = clampIndexForDelete(sr.anchor.row, fromIndex, count, newAxisCount)
            const inBoundsAnchor =
                anchorRow >= normStartRow && anchorRow <= normEndRow ? anchorRow : normStartRow
            next.push({
                anchor: { row: inBoundsAnchor, col: sr.anchor.col },
                range: {
                    startRow: normStartRow,
                    endRow: normEndRow,
                    startCol: sr.range.startCol,
                    endCol: sr.range.endCol,
                },
                scope: sr.scope,
            })
        } else {
            if (
                sr.range.startCol >= fromIndex &&
                sr.range.endCol < fromIndex + count
            ) {
                continue
            }
            const startCol = clampIndexForDelete(sr.range.startCol, fromIndex, count, newAxisCount)
            const endCol = clampIndexForDelete(sr.range.endCol, fromIndex, count, newAxisCount)
            const normStartCol = Math.min(startCol, endCol)
            const normEndCol = Math.max(startCol, endCol)
            if (normStartCol < 1 || normStartCol > newAxisCount) continue
            const anchorCol = clampIndexForDelete(sr.anchor.col, fromIndex, count, newAxisCount)
            const inBoundsAnchor =
                anchorCol >= normStartCol && anchorCol <= normEndCol ? anchorCol : normStartCol
            next.push({
                anchor: { row: sr.anchor.row, col: inBoundsAnchor },
                range: {
                    startRow: sr.range.startRow,
                    endRow: sr.range.endRow,
                    startCol: normStartCol,
                    endCol: normEndCol,
                },
                scope: sr.scope,
            })
        }
    }
    if (next.length === 0) return null
    return { ranges: next }
}

// singleCellSelection is a tiny constructor for the most common case:
// a single 'cells'-scope sub-range covering one cell. Used wherever we
// used to write `{ selected: cell, selectionRange: null, selectionScope: 'cells' }`.
export function singleCellSelection(cell: SelectedCell): Selection {
    return {
        ranges: [
            {
                anchor: { row: cell.row, col: cell.col },
                range: {
                    startRow: cell.row,
                    endRow: cell.row,
                    startCol: cell.col,
                    endCol: cell.col,
                },
                scope: 'cells',
            },
        ],
    }
}

// singleRectSelection is the rectangle-form constructor — anchor +
// range + scope. Useful for header-click actions and the in-store
// rewrite of drag-extend.
export function singleRectSelection(
    anchor: SelectedCell,
    range: CellRange,
    scope: SelectionScope = 'cells'
): Selection {
    return {
        ranges: [
            {
                anchor: { row: anchor.row, col: anchor.col },
                range: { ...range },
                scope,
            },
        ],
    }
}

// computeShiftArrowTarget returns the (row, col) the active sub-
// range's "far corner" (the corner opposite the anchor) should move
// to under a Shift+arrow keypress. Caller feeds the result to
// extendActiveRangeTo to grow or shrink the range by one cell in that
// direction.
//
// Falls back to (fallbackRow, fallbackCol) — the focused cell — when
// the selection is empty, so the action still has an anchor to extend
// from. Clamps to [1, rowCount] / [1, colCount] so a Shift+arrow at a
// sheet edge stays in-bounds (Sheets / Excel parity).
export function computeShiftArrowTarget(
    selection: Selection,
    direction: 'up' | 'down' | 'left' | 'right',
    fallbackRow: number,
    fallbackCol: number,
    rowCount: number,
    colCount: number
): SelectedCell {
    const active = activeSubRange(selection)
    let farRow = fallbackRow
    let farCol = fallbackCol
    if (active != null) {
        const { anchor, range } = active
        farRow = range.startRow === anchor.row ? range.endRow : range.startRow
        farCol = range.startCol === anchor.col ? range.endCol : range.startCol
    }
    switch (direction) {
        case 'up':
            farRow -= 1
            break
        case 'down':
            farRow += 1
            break
        case 'left':
            farCol -= 1
            break
        case 'right':
            farCol += 1
            break
    }
    if (farRow < 1) farRow = 1
    if (farCol < 1) farCol = 1
    if (rowCount > 0 && farRow > rowCount) farRow = rowCount
    if (colCount > 0 && farCol > colCount) farCol = colCount
    return { row: farRow, col: farCol }
}
