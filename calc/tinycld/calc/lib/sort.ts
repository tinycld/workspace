// Pure sort routines over a CellRange. Reads each row of the range as
// a tuple of cell snapshots, orders the tuples by the chosen column's
// raw value, then writes the reordered tuples back. Style entries
// (font/fill/alignment/borders/numFmt) ride along with their cell so a
// sort never strips formatting.
//
// All mutations happen inside one doc.transact tagged LOCAL_ORIGIN so
// the realtime undo manager rewinds the sort as a single step. Merged
// cells inside the sort range are auto-unmerged in the same
// transaction (matches Sheets' default) — the returned status reports
// how many were dissolved so the caller can show a banner.
import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { CellRange } from '../hooks/grid-store'
import { yCellKey } from './y-cell-key'
import {
    buildStyleYMap,
    CELLS_MAP,
    readYCell,
    SHEETS_MAP,
    STYLE_KEY,
    type YCellValue,
} from './y-doc-bootstrap'

export type SortDirection = 'asc' | 'desc'

export interface SortRangeResult {
    ok: boolean
    mergesBroken: number
}

function readCell(doc: Y.Doc, sheetId: string, row: number, col: number): YCellValue | null {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    return cell ? readYCell(cell) : null
}

// writeCell replaces the cell at (row, col). Empty value deletes the
// cell. Existing cells are replaced wholesale — sort writes a new
// tuple at every position, so reusing the existing nested Y.Map would
// carry the prior occupant's CRDT history into a different row.
function writeCell(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    value: YCellValue | null
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    if (value == null) {
        cellsMap.delete(key)
        return
    }
    const next = new Y.Map<unknown>()
    next.set('kind', value.kind)
    next.set('raw', value.raw)
    next.set('display', value.display)
    if (value.formula != null) next.set('formula', value.formula)
    if (value.style != null) {
        const styleMap = buildStyleYMap(value.style)
        if (styleMap != null) next.set(STYLE_KEY, styleMap)
    }
    cellsMap.set(key, next)
}

type SortKeyKind = 'null' | 'number' | 'date' | 'string'

interface SortKey {
    kind: SortKeyKind
    key: string | number | null
}

// Empty cells sort last regardless of direction (matches Sheets / Excel).
// Numbers numeric, dates by ISO string (chronologically equivalent),
// formulas by their cached scalar, everything else as string.
function sortKeyFor(value: YCellValue | null): SortKey {
    if (value == null || value.raw == null || value.raw === '') {
        return { kind: 'null', key: null }
    }
    if (value.kind === 'number' && typeof value.raw === 'number') {
        return { kind: 'number', key: value.raw }
    }
    if (value.kind === 'date' && typeof value.raw === 'string') {
        return { kind: 'date', key: value.raw }
    }
    if (typeof value.raw === 'number') return { kind: 'number', key: value.raw }
    if (typeof value.raw === 'string') return { kind: 'string', key: value.raw }
    return { kind: 'string', key: String(value.raw) }
}

const KIND_ORDER: Record<SortKeyKind, number> = { number: 0, date: 1, string: 2, null: 3 }

function compareSortKeys(a: SortKey, b: SortKey): number {
    if (a.kind === 'null' && b.kind === 'null') return 0
    if (a.kind === 'null') return 1
    if (b.kind === 'null') return -1
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (a.kind === 'number') return (a.key as number) - (b.key as number)
    return String(a.key).localeCompare(String(b.key))
}

// detectHeaderRow inspects the first row of `range` and returns true
// when it looks like a header — i.e. all non-empty first-row cells are
// strings AND at least one subsequent row has a numeric value in any
// column. Single-row ranges are never treated as having a header.
export function detectHeaderRow(doc: Y.Doc, sheetId: string, range: CellRange): boolean {
    if (range.endRow <= range.startRow) return false
    let firstRowHasString = false
    for (let c = range.startCol; c <= range.endCol; c++) {
        const v = readCell(doc, sheetId, range.startRow, c)
        if (v == null) continue
        if (v.kind === 'string' && typeof v.raw === 'string' && v.raw !== '') {
            firstRowHasString = true
        } else if (v.kind !== 'string') {
            return false
        }
    }
    if (!firstRowHasString) return false
    for (let r = range.startRow + 1; r <= range.endRow; r++) {
        for (let c = range.startCol; c <= range.endCol; c++) {
            const v = readCell(doc, sheetId, r, c)
            if (v == null) continue
            if (v.kind === 'number' || (v.kind === 'formula' && typeof v.raw === 'number')) {
                return true
            }
        }
    }
    return false
}

// readMergesMap returns the sheet's `merges` Y.Map if present. The
// merge feature is implemented in parallel; tolerate its absence.
function readMergesMap(doc: Y.Doc, sheetId: string): Y.Map<unknown> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (meta == null) return null
    const merges = meta.get('merges')
    if (!(merges instanceof Y.Map)) return null
    return merges
}

// rangeIntersects checks whether the merge anchor (anchorRow, anchorCol)
// + spans (rowSpan, colSpan) overlaps the sort range at all.
function rangeIntersects(
    range: CellRange,
    anchorRow: number,
    anchorCol: number,
    rowSpan: number,
    colSpan: number
): boolean {
    const mergeEndRow = anchorRow + rowSpan - 1
    const mergeEndCol = anchorCol + colSpan - 1
    if (mergeEndRow < range.startRow || anchorRow > range.endRow) return false
    if (mergeEndCol < range.startCol || anchorCol > range.endCol) return false
    return true
}

// dissolveMergesInRange removes every merge entry whose covered area
// touches `range`. Returns the count dissolved. The Y.Map mutation
// happens inside the caller's doc.transact so it joins the same undo
// step as the sort itself.
function dissolveMergesInRange(doc: Y.Doc, sheetId: string, range: CellRange): number {
    const merges = readMergesMap(doc, sheetId)
    if (merges == null) return 0
    const toDelete: string[] = []
    merges.forEach((value, key) => {
        const parts = key.split(':')
        if (parts.length !== 2) return
        const anchorRow = Number(parts[0])
        const anchorCol = Number(parts[1])
        if (!Number.isFinite(anchorRow) || !Number.isFinite(anchorCol)) return
        let rowSpan = 1
        let colSpan = 1
        if (value instanceof Y.Map) {
            const rs = value.get('rowSpan')
            const cs = value.get('colSpan')
            if (typeof rs === 'number' && rs > 0) rowSpan = rs
            if (typeof cs === 'number' && cs > 0) colSpan = cs
        } else if (value && typeof value === 'object') {
            const rs = (value as { rowSpan?: number }).rowSpan
            const cs = (value as { colSpan?: number }).colSpan
            if (typeof rs === 'number' && rs > 0) rowSpan = rs
            if (typeof cs === 'number' && cs > 0) colSpan = cs
        }
        if (rangeIntersects(range, anchorRow, anchorCol, rowSpan, colSpan)) {
            toDelete.push(key)
        }
    })
    for (const key of toDelete) {
        merges.delete(key)
    }
    return toDelete.length
}

// sortRange reorders the rows of `range` by the value in
// `columnIndex`'s cell, ascending or descending. When `hasHeader` is
// true the first row stays put and only rows below it are sorted.
// Returns ok=false when the range is degenerate (zero rows to sort).
export function sortRange(
    doc: Y.Doc,
    sheetId: string,
    range: CellRange,
    columnIndex: number,
    direction: SortDirection,
    hasHeader: boolean
): SortRangeResult {
    const headerOffset = hasHeader ? 1 : 0
    const dataStart = range.startRow + headerOffset
    if (dataStart > range.endRow) return { ok: false, mergesBroken: 0 }
    if (columnIndex < range.startCol || columnIndex > range.endCol) {
        return { ok: false, mergesBroken: 0 }
    }

    let mergesBroken = 0
    doc.transact(() => {
        mergesBroken = dissolveMergesInRange(doc, sheetId, range)

        const rows: Array<{
            keyValue: SortKey
            cells: Array<YCellValue | null>
            index: number
        }> = []
        for (let r = dataStart; r <= range.endRow; r++) {
            const cells: Array<YCellValue | null> = []
            for (let c = range.startCol; c <= range.endCol; c++) {
                cells.push(readCell(doc, sheetId, r, c))
            }
            const keyCell = cells[columnIndex - range.startCol]
            rows.push({ keyValue: sortKeyFor(keyCell), cells, index: rows.length })
        }

        const sign = direction === 'asc' ? 1 : -1
        // Empty rows ALWAYS sort last, in both directions — matches
        // Sheets/Excel. We branch on null before applying `sign` so a
        // descending sort doesn't flip nulls to the top (which would
        // push real data off the bottom of the range, visually
        // "deleting" the sheet's content).
        rows.sort((a, b) => {
            const aNull = a.keyValue.kind === 'null'
            const bNull = b.keyValue.kind === 'null'
            if (aNull && bNull) return a.index - b.index
            if (aNull) return 1
            if (bNull) return -1
            const cmp = compareSortKeys(a.keyValue, b.keyValue)
            return cmp !== 0 ? sign * cmp : a.index - b.index
        })

        for (let i = 0; i < rows.length; i++) {
            const targetRow = dataStart + i
            const tuple = rows[i].cells
            for (let c = range.startCol; c <= range.endCol; c++) {
                writeCell(doc, sheetId, targetRow, c, tuple[c - range.startCol])
            }
        }
    }, LOCAL_ORIGIN)

    return { ok: true, mergesBroken }
}
