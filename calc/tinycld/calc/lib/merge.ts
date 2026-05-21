// Merged-cell metadata lives on per-sheet meta under MERGES_KEY as a
// Y.Map keyed by `${anchorRow}:${anchorCol}`. The anchor cell renders
// at the merged width/height; covered (non-anchor) cells render
// nothing.
//
// Each entry is itself a nested Y.Map with `rowSpan` and `colSpan`
// integer fields. The nested-Y.Map shape is required so the Go
// snapshot decoder (`decodeMerges` in server/runtime.go) and the
// xlsx import path can read entries — both type-assert each value
// to `*ycrdt.YMap`. Writing a plain JS object instead silently
// drops the merge on the next save.
//
// Mutations are wrapped in doc.transact with LOCAL_ORIGIN so the
// realtime undo manager (scoped to SHEETS_MAP) captures the merge as
// a single step. mergeCells over an existing-overlapping range first
// unmerges the conflicting entries and clears non-anchor cell values
// in the same transaction so undo restores everything.

import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { CellRange } from '../hooks/grid-store'
import { yCellKey } from './y-cell-key'
import { CELLS_MAP, MERGES_KEY, SHEETS_MAP } from './y-doc-bootstrap'

export { MERGES_KEY }

export interface MergeRange {
    anchorRow: number
    anchorCol: number
    rowSpan: number
    colSpan: number
}

interface MergeEntry {
    rowSpan: number
    colSpan: number
}

function mergeKey(row: number, col: number): string {
    return `${row}:${col}`
}

function getSheetMeta(doc: Y.Doc, sheetId: string): Y.Map<unknown> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    return sheetsMap.get(sheetId) ?? null
}

function readMergeEntry(value: unknown): MergeEntry | null {
    if (!(value instanceof Y.Map)) return null
    const rowSpan = value.get('rowSpan')
    const colSpan = value.get('colSpan')
    if (typeof rowSpan !== 'number' || typeof colSpan !== 'number') return null
    if (rowSpan < 1 || colSpan < 1) return null
    return { rowSpan, colSpan }
}

function parseAnchorKey(key: string): { row: number; col: number } | null {
    const parts = key.split(':')
    if (parts.length !== 2) return null
    const row = Number(parts[0])
    const col = Number(parts[1])
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null
    return { row, col }
}

function rangesOverlap(
    aStartRow: number,
    aEndRow: number,
    aStartCol: number,
    aEndCol: number,
    bStartRow: number,
    bEndRow: number,
    bStartCol: number,
    bEndCol: number
): boolean {
    if (aEndRow < bStartRow || aStartRow > bEndRow) return false
    if (aEndCol < bStartCol || aStartCol > bEndCol) return false
    return true
}

// getAllMerges returns every merge on the sheet as a plain array. Used
// by selection/render code that needs to scan all merges to decide
// whether a cell is covered. Linear scan; cache externally if needed.
export function getAllMerges(doc: Y.Doc, sheetId: string): MergeRange[] {
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return []
    const merges = meta.get(MERGES_KEY)
    if (!(merges instanceof Y.Map)) return []
    const out: MergeRange[] = []
    merges.forEach((value, key) => {
        const entry = readMergeEntry(value)
        if (entry == null) return
        const anchor = parseAnchorKey(key)
        if (anchor == null) return
        out.push({
            anchorRow: anchor.row,
            anchorCol: anchor.col,
            rowSpan: entry.rowSpan,
            colSpan: entry.colSpan,
        })
    })
    return out
}

// findMergeContaining returns the merge whose footprint covers (row,
// col), or null if (row, col) is independent. Includes the anchor cell
// itself.
export function findMergeContaining(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number
): MergeRange | null {
    const all = getAllMerges(doc, sheetId)
    for (const m of all) {
        if (
            row >= m.anchorRow &&
            row <= m.anchorRow + m.rowSpan - 1 &&
            col >= m.anchorCol &&
            col <= m.anchorCol + m.colSpan - 1
        ) {
            return m
        }
    }
    return null
}

// mergeCells creates a single merge spanning `range`. If the range
// overlaps any existing merges, those are unmerged first. After
// merging, every covered cell other than the anchor is cleared so the
// merged area shows only the anchor's value.
export function mergeCells(doc: Y.Doc, sheetId: string, range: CellRange): void {
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return

    const startRow = Math.min(range.startRow, range.endRow)
    const endRow = Math.max(range.startRow, range.endRow)
    const startCol = Math.min(range.startCol, range.endCol)
    const endCol = Math.max(range.startCol, range.endCol)
    const rowSpan = endRow - startRow + 1
    const colSpan = endCol - startCol + 1
    if (rowSpan <= 1 && colSpan <= 1) return

    doc.transact(() => {
        let merges = meta.get(MERGES_KEY)
        if (!(merges instanceof Y.Map)) {
            merges = new Y.Map<Y.Map<number>>()
            meta.set(MERGES_KEY, merges)
        }
        const mergesMap = merges as Y.Map<Y.Map<number>>

        const overlappingKeys: string[] = []
        mergesMap.forEach((value, key) => {
            const entry = readMergeEntry(value)
            if (entry == null) return
            const anchor = parseAnchorKey(key)
            if (anchor == null) return
            const otherEndRow = anchor.row + entry.rowSpan - 1
            const otherEndCol = anchor.col + entry.colSpan - 1
            if (
                rangesOverlap(
                    startRow,
                    endRow,
                    startCol,
                    endCol,
                    anchor.row,
                    otherEndRow,
                    anchor.col,
                    otherEndCol
                )
            ) {
                overlappingKeys.push(key)
            }
        })
        for (const key of overlappingKeys) {
            mergesMap.delete(key)
        }

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                if (r === startRow && c === startCol) continue
                cellsMap.delete(yCellKey(sheetId, r, c))
            }
        }

        const entry = new Y.Map<number>()
        entry.set('rowSpan', rowSpan)
        entry.set('colSpan', colSpan)
        mergesMap.set(mergeKey(startRow, startCol), entry)
    }, LOCAL_ORIGIN)
}

// unmergeCells deletes the merge anchored at (anchorRow, anchorCol).
// The covered cells become independent again (their values stay
// cleared from the original merge unless undo is invoked).
export function unmergeCells(
    doc: Y.Doc,
    sheetId: string,
    anchorRow: number,
    anchorCol: number
): void {
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return
    const merges = meta.get(MERGES_KEY)
    if (!(merges instanceof Y.Map)) return
    const key = mergeKey(anchorRow, anchorCol)
    if (!merges.has(key)) return
    doc.transact(() => {
        merges.delete(key)
    }, LOCAL_ORIGIN)
}

// expandRangeOverMergeList grows `range` so every merge it touches is
// fully contained. Pure variant — takes a plain merge list, no Y.Doc
// dependency. Returns the original range (after normalization) when no
// merges intersect. Used by the Y.Doc-bound expandRangeOverMerges
// below and by render-time consumers (the selection overlay) that
// already have the merge list in hand via useSheetMerges.
export function expandRangeOverMergeList(range: CellRange, merges: MergeRange[]): CellRange {
    let startRow = Math.min(range.startRow, range.endRow)
    let endRow = Math.max(range.startRow, range.endRow)
    let startCol = Math.min(range.startCol, range.endCol)
    let endCol = Math.max(range.startCol, range.endCol)
    if (merges.length === 0) return { startRow, endRow, startCol, endCol }
    let changed = true
    while (changed) {
        changed = false
        for (const m of merges) {
            const mEndRow = m.anchorRow + m.rowSpan - 1
            const mEndCol = m.anchorCol + m.colSpan - 1
            if (
                rangesOverlap(
                    startRow,
                    endRow,
                    startCol,
                    endCol,
                    m.anchorRow,
                    mEndRow,
                    m.anchorCol,
                    mEndCol
                )
            ) {
                if (m.anchorRow < startRow) {
                    startRow = m.anchorRow
                    changed = true
                }
                if (mEndRow > endRow) {
                    endRow = mEndRow
                    changed = true
                }
                if (m.anchorCol < startCol) {
                    startCol = m.anchorCol
                    changed = true
                }
                if (mEndCol > endCol) {
                    endCol = mEndCol
                    changed = true
                }
            }
        }
    }
    return { startRow, endRow, startCol, endCol }
}

// expandRangeOverMerges grows `range` so every merge it touches is
// fully contained. Returns the original range when no merges
// intersect. Used by selection helpers (shift-click extend, drag) and
// by mergeSelection so a partial-overlap selection auto-grows to a
// merge-respecting rectangle before committing.
export function expandRangeOverMerges(
    doc: Y.Doc,
    sheetId: string,
    range: CellRange
): CellRange {
    return expandRangeOverMergeList(range, getAllMerges(doc, sheetId))
}

// snapPointToMerge returns the anchor of the merge containing (row,
// col), or the same (row, col) when not merged. Used by selectCell to
// route a click on a covered cell to the anchor.
export function snapPointToMerge(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number
): { row: number; col: number } {
    const m = findMergeContaining(doc, sheetId, row, col)
    if (m == null) return { row, col }
    return { row: m.anchorRow, col: m.anchorCol }
}

// applyStructuralShiftToMerges adjusts every merge entry on the sheet
// in response to an insert/delete row or column. Operates inside its
// own doc.transact so the caller can wrap a higher-level mutation
// without burying us in a partial-update state. Mutation rules:
//
//   insertRows(at, count): rows >= `at` shift down by `count`. If the
//   insertion sits strictly inside the merge (anchorRow < at and at <=
//   anchorRow + rowSpan - 1), the merge's rowSpan grows by `count`. If
//   `at` equals the anchor, the anchor itself shifts down.
//
//   deleteRows(from, count): a merge fully inside [from, from+count)
//   is removed. A merge whose anchor is in the deleted band but whose
//   tail extends past the band shrinks (anchor moves to `from`,
//   rowSpan reduced to the surviving tail). A merge whose anchor sits
//   above the deleted band shrinks rowSpan by the overlap. Rows
//   strictly past the band shift up by `count`.
//
// Symmetric rules apply to columns.
export type MergeShiftOp =
    | { kind: 'insertRows'; at: number; count: number }
    | { kind: 'insertColumns'; at: number; count: number }
    | { kind: 'deleteRows'; from: number; count: number }
    | { kind: 'deleteColumns'; from: number; count: number }

export function applyStructuralShiftToMerges(
    doc: Y.Doc,
    sheetId: string,
    op: MergeShiftOp
): void {
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return
    const merges = meta.get(MERGES_KEY)
    if (!(merges instanceof Y.Map)) return
    const mergesMap = merges as Y.Map<Y.Map<number>>
    if (mergesMap.size === 0) return

    interface Snap {
        key: string
        anchorRow: number
        anchorCol: number
        rowSpan: number
        colSpan: number
    }
    const snaps: Snap[] = []
    mergesMap.forEach((value, key) => {
        const entry = readMergeEntry(value)
        if (entry == null) return
        const anchor = parseAnchorKey(key)
        if (anchor == null) return
        snaps.push({
            key,
            anchorRow: anchor.row,
            anchorCol: anchor.col,
            rowSpan: entry.rowSpan,
            colSpan: entry.colSpan,
        })
    })

    interface Mutation {
        oldKey: string
        newKey: string | null
        next: MergeEntry | null
    }
    const mutations: Mutation[] = []

    for (const s of snaps) {
        let nextAnchorRow = s.anchorRow
        let nextAnchorCol = s.anchorCol
        let nextRowSpan = s.rowSpan
        let nextColSpan = s.colSpan
        let drop = false

        switch (op.kind) {
            case 'insertRows': {
                const endRow = s.anchorRow + s.rowSpan - 1
                if (op.at <= s.anchorRow) {
                    nextAnchorRow = s.anchorRow + op.count
                } else if (op.at <= endRow) {
                    nextRowSpan = s.rowSpan + op.count
                }
                break
            }
            case 'insertColumns': {
                const endCol = s.anchorCol + s.colSpan - 1
                if (op.at <= s.anchorCol) {
                    nextAnchorCol = s.anchorCol + op.count
                } else if (op.at <= endCol) {
                    nextColSpan = s.colSpan + op.count
                }
                break
            }
            case 'deleteRows': {
                const endRow = s.anchorRow + s.rowSpan - 1
                const delStart = op.from
                const delEnd = op.from + op.count - 1
                if (delStart <= s.anchorRow && delEnd >= endRow) {
                    drop = true
                } else if (delEnd < s.anchorRow) {
                    nextAnchorRow = s.anchorRow - op.count
                } else if (delStart > endRow) {
                    // No overlap, no shift
                } else if (delStart <= s.anchorRow && delEnd < endRow) {
                    const removed = delEnd - s.anchorRow + 1
                    nextAnchorRow = delStart
                    nextRowSpan = s.rowSpan - removed
                } else if (delStart > s.anchorRow && delEnd >= endRow) {
                    nextRowSpan = delStart - s.anchorRow
                } else if (delStart > s.anchorRow && delEnd < endRow) {
                    nextRowSpan = s.rowSpan - op.count
                }
                if (!drop && nextRowSpan < 1) drop = true
                break
            }
            case 'deleteColumns': {
                const endCol = s.anchorCol + s.colSpan - 1
                const delStart = op.from
                const delEnd = op.from + op.count - 1
                if (delStart <= s.anchorCol && delEnd >= endCol) {
                    drop = true
                } else if (delEnd < s.anchorCol) {
                    nextAnchorCol = s.anchorCol - op.count
                } else if (delStart > endCol) {
                    // No overlap
                } else if (delStart <= s.anchorCol && delEnd < endCol) {
                    const removed = delEnd - s.anchorCol + 1
                    nextAnchorCol = delStart
                    nextColSpan = s.colSpan - removed
                } else if (delStart > s.anchorCol && delEnd >= endCol) {
                    nextColSpan = delStart - s.anchorCol
                } else if (delStart > s.anchorCol && delEnd < endCol) {
                    nextColSpan = s.colSpan - op.count
                }
                if (!drop && nextColSpan < 1) drop = true
                break
            }
        }

        if (drop) {
            mutations.push({ oldKey: s.key, newKey: null, next: null })
            continue
        }
        // A 1×1 merge is meaningless — collapse to no-merge.
        if (nextRowSpan === 1 && nextColSpan === 1) {
            mutations.push({ oldKey: s.key, newKey: null, next: null })
            continue
        }
        const newKey = mergeKey(nextAnchorRow, nextAnchorCol)
        if (
            newKey === s.key &&
            nextRowSpan === s.rowSpan &&
            nextColSpan === s.colSpan
        ) {
            continue
        }
        mutations.push({
            oldKey: s.key,
            newKey,
            next: { rowSpan: nextRowSpan, colSpan: nextColSpan },
        })
    }

    if (mutations.length === 0) return

    doc.transact(() => {
        for (const m of mutations) {
            mergesMap.delete(m.oldKey)
        }
        for (const m of mutations) {
            if (m.newKey != null && m.next != null) {
                const entry = new Y.Map<number>()
                entry.set('rowSpan', m.next.rowSpan)
                entry.set('colSpan', m.next.colSpan)
                mergesMap.set(m.newKey, entry)
            }
        }
    }, LOCAL_ORIGIN)
}
