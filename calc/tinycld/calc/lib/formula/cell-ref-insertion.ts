import { columnLabel } from '../workbook-types'
import type { DraftSelection } from './autocomplete'

// Pure helpers powering "click a cell while editing a formula to
// insert its address" (and the drag variant for ranges).
//
// The flow:
//   1. Grid sees a cell tap while editSession != null.
//   2. It calls isRefAcceptable(draft, cursor) — only insert when the
//      char to the left of the cursor admits a fresh reference.
//   3. It computes the address with formatRef / formatRange.
//   4. It calls applyCellRefInsertion to splice the address into the
//      draft and updates the cursor.
//   5. For a drag, the first move calls applyCellRefInsertion; each
//      subsequent move calls extendCellRefInsertion to replace the
//      previously-inserted slice with the updated range.

const REF_ACCEPTABLE_PREV_CHAR = new Set([
    '=',
    '(',
    ',',
    '+',
    '-',
    '*',
    '/',
    ':',
    '&',
    '<',
    '>',
    '%',
    '^',
    ' ',
    '\t',
])

// isRefAcceptable returns true when the cursor is in a position where
// a fresh cell reference can be inserted without mangling existing
// syntax. False inside string literals, false when the previous char
// is part of an existing identifier (a letter or digit), true after
// operators/parens/commas/whitespace.
export function isRefAcceptable(draft: string, cursor: number): boolean {
    if (!draft.startsWith('=')) return false
    if (cursor < 1 || cursor > draft.length) return false
    if (isInsideStringLiteral(draft, cursor)) return false
    const prev = draft[cursor - 1]
    if (prev === undefined) return false
    return REF_ACCEPTABLE_PREV_CHAR.has(prev)
}

function isInsideStringLiteral(draft: string, cursor: number): boolean {
    let inside = false
    for (let i = 0; i < cursor; i++) {
        if (draft[i] !== '"') continue
        if (inside && draft[i + 1] === '"') {
            i++
            continue
        }
        inside = !inside
    }
    return inside
}

// formatRef produces the A1 form of a 1-indexed (row, col) pair.
export function formatRef(row: number, col: number): string {
    return `${columnLabel(col)}${row}`
}

// formatRange produces a normalized A1:B2 range. Inputs may be in any
// order — the result always has the top-left corner first. When the
// two cells are the same, returns the single-cell form.
export function formatRange(
    a: { row: number; col: number },
    b: { row: number; col: number }
): string {
    const minRow = Math.min(a.row, b.row)
    const maxRow = Math.max(a.row, b.row)
    const minCol = Math.min(a.col, b.col)
    const maxCol = Math.max(a.col, b.col)
    if (minRow === maxRow && minCol === maxCol) return formatRef(minRow, minCol)
    return `${formatRef(minRow, minCol)}:${formatRef(maxRow, maxCol)}`
}

// applyCellRefInsertion splices `ref` into the draft at the current
// cursor. Returns the new draft and the slice we inserted (so a
// subsequent extendCellRefInsertion call can replace it during a
// drag).
export interface InsertionResult {
    draft: string
    selection: DraftSelection
    insertedSlice: { start: number; end: number }
}

export function applyCellRefInsertion(draft: string, cursor: number, ref: string): InsertionResult {
    const before = draft.slice(0, cursor)
    const after = draft.slice(cursor)
    const nextDraft = `${before}${ref}${after}`
    const start = before.length
    const end = start + ref.length
    return {
        draft: nextDraft,
        selection: { start: end, end },
        insertedSlice: { start, end },
    }
}

// extendCellRefInsertion replaces the previously-inserted slice with
// the new ref. Used during a drag: each pointer move computes the new
// range and we swap in place so the draft reads cleanly (no
// accumulating "B5B5:B6B5:B7" garbage).
export function extendCellRefInsertion(
    draft: string,
    prevSlice: { start: number; end: number },
    ref: string
): InsertionResult {
    const before = draft.slice(0, prevSlice.start)
    const after = draft.slice(prevSlice.end)
    const nextDraft = `${before}${ref}${after}`
    const start = before.length
    const end = start + ref.length
    return {
        draft: nextDraft,
        selection: { start: end, end },
        insertedSlice: { start, end },
    }
}
