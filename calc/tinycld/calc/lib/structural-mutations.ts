// Row/column insert + delete on the Y.Doc workbook. All four functions
// shift cells (CELLS_MAP) and sparse sheet metadata maps (rowHeights,
// rowStyles, colWidths) in lockstep, then update rowCount/colCount,
// inside a single doc.transact tagged LOCAL_ORIGIN so the realtime
// undo manager captures the whole shift as one undoable.
//
// Iteration discipline: walking a Y.Map while mutating it is undefined.
// Every shift first snapshots the affected entries into a plain array,
// sorts that array by direction, then applies set+delete in order so
// the source key for each move is read before any subsequent move
// overwrites it.
//
// Cell-move semantics: we cannot reuse an integrated Y.Map under a new
// key. Calling parent.set(newKey, existingYMap) re-runs YMap._integrate
// against an already-integrated Y.Map and crashes on its nulled internal
// state. Instead we deep-clone the cell's Y.Map (and any nested style
// Y.Maps) into a fresh Y.Map, then delete the source. cloneYMapDeep is
// the only correct way to relocate a Y-integrated value within the same
// parent.
//
// Tombstone caveat: each set+delete pair leaves one CRDT tombstone in
// the Y.Map. A bulk shift over N affected cells produces N tombstones
// in one transaction. Bounded but real for long-lived sessions; see
// y-doc-bootstrap.ts:10-20 for the suggested mitigation paths.
//
// Formula rewriting: every transact also rewrites refs in all formula
// cells (across all sheets) via rewriteFormulaForMutation, so refs into
// the mutated sheet shift / clamp / become #REF! atomically with the
// cell move. See lib/formula/rewrite-on-structural-mutation.ts.

import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import { COL_WIDTHS_KEY, ROW_HEIGHTS_KEY } from './dimensions'
import {
    rewriteFormulaForMutation,
    type StructuralFormulaMutation,
} from './formula/rewrite-on-structural-mutation'
import { applyStructuralShiftToMerges } from './merge'
import { ROW_STYLES_KEY } from './sheet-styles'
import { parseYCellKey, yCellKey } from './y-cell-key'
import { CELLS_MAP, cloneYMapDeep, SHEETS_MAP } from './y-doc-bootstrap'

type RowInsertPosition = 'above' | 'below'
type ColInsertPosition = 'left' | 'right'

interface CellSnapshot {
    key: string
    row: number
    col: number
    value: Y.Map<unknown>
}

function snapshotSheetCells(
    cellsMap: Y.Map<Y.Map<unknown>>,
    sheetId: string,
    predicate: (row: number, col: number) => boolean
): CellSnapshot[] {
    const hits: CellSnapshot[] = []
    cellsMap.forEach((value, key) => {
        const parsed = parseYCellKey(key)
        if (parsed == null || parsed.sheetId !== sheetId) return
        if (!predicate(parsed.row, parsed.col)) return
        hits.push({ key, row: parsed.row, col: parsed.col, value })
    })
    return hits
}

function moveCellsBy(
    cellsMap: Y.Map<Y.Map<unknown>>,
    sheetId: string,
    snapshots: CellSnapshot[],
    rowDelta: number,
    colDelta: number
): void {
    for (const snap of snapshots) {
        const newKey = yCellKey(sheetId, snap.row + rowDelta, snap.col + colDelta)
        cellsMap.set(newKey, cloneYMapDeep(snap.value))
        cellsMap.delete(snap.key)
    }
}

interface SparseEntry<V> {
    key: number
    value: V
}

// snapshotSparseMap pulls a nested Y.Map<numStr, V> off the parent meta
// and converts to numeric-keyed entries that match `predicate`.
function snapshotSparseMap<V>(
    parent: Y.Map<unknown>,
    nestedKey: string,
    predicate: (key: number) => boolean
): { map: Y.Map<V> | null; entries: SparseEntry<V>[] } {
    const nested = parent.get(nestedKey)
    if (!(nested instanceof Y.Map)) return { map: null, entries: [] }
    const map = nested as Y.Map<V>
    const entries: SparseEntry<V>[] = []
    map.forEach((value, key) => {
        const k = Number(key)
        if (!Number.isFinite(k)) return
        if (!predicate(k)) return
        entries.push({ key: k, value })
    })
    return { map, entries }
}

function shiftSparseEntries<V>(
    map: Y.Map<V>,
    entries: SparseEntry<V>[],
    delta: number,
    direction: 'descending' | 'ascending'
): void {
    const sorted = [...entries].sort((a, b) =>
        direction === 'descending' ? b.key - a.key : a.key - b.key
    )
    for (const entry of sorted) {
        const oldKey = String(entry.key)
        const newKey = String(entry.key + delta)
        // Same constraint as moveCellsBy: a Y.Map value already
        // integrated under oldKey can't be re-set under newKey, so
        // deep-clone before re-parenting. Scalars copy by value.
        const next =
            entry.value instanceof Y.Map
                ? (cloneYMapDeep(entry.value as Y.Map<unknown>) as unknown as V)
                : entry.value
        map.set(newKey, next)
        map.delete(oldKey)
    }
}

function deleteSparseEntries<V>(map: Y.Map<V> | null, entries: SparseEntry<V>[]): void {
    if (map == null) return
    for (const entry of entries) {
        map.delete(String(entry.key))
    }
}

function getSheetMeta(doc: Y.Doc, sheetId: string): Y.Map<unknown> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    return meta ?? null
}

function readNumberField(meta: Y.Map<unknown>, key: string, fallback: number): number {
    const v = meta.get(key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function readSheetName(sheetsMap: Y.Map<Y.Map<unknown>>, sheetId: string): string | null {
    const meta = sheetsMap.get(sheetId)
    if (meta == null) return null
    const name = meta.get('name')
    return typeof name === 'string' && name !== '' ? name : null
}

// Resolve the user-visible name for the mutated sheet, with sheetId as
// the fallback when name is missing (matches the formula bridge's
// behaviour in lib/formula/bridge.ts:84-86). Called once per mutation
// outside the transact so the lookup doesn't repeat per call site.
function resolveMutatedSheetName(doc: Y.Doc, sheetId: string): string {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    return readSheetName(sheetsMap, sheetId) ?? sheetId
}

// Walks every formula cell in the doc (across all sheets) and rewrites
// its `formula` string to reflect the structural mutation. Must be
// called inside the same doc.transact as the cell shift so the undo
// manager and remote peers see one atomic update. Walking all sheets
// matters: a formula on Sheet2 may reference Sheet1, and a row insert
// on Sheet1 must rewrite that cross-sheet ref.
function applyFormulaRewrite(doc: Y.Doc, mutation: StructuralFormulaMutation): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    cellsMap.forEach((cell, key) => {
        if (cell.get('kind') !== 'formula') return
        const formula = cell.get('formula')
        if (typeof formula !== 'string') return
        const parsed = parseYCellKey(key)
        if (parsed == null) return
        const formulaCellSheetName = readSheetName(sheetsMap, parsed.sheetId) ?? parsed.sheetId
        const next = rewriteFormulaForMutation(formula, formulaCellSheetName, mutation)
        if (next == null) return
        cell.set('formula', next)
    })
}

export function insertRows(
    doc: Y.Doc,
    sheetId: string,
    atRow: number,
    count: number,
    position: RowInsertPosition,
    displayedRowCount = 0
): void {
    if (count <= 0) return
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return
    const insertAt = position === 'above' ? atRow : atRow + 1
    if (insertAt < 1) return

    const mutatedSheetName = resolveMutatedSheetName(doc, sheetId)

    doc.transact(() => {
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        // Snapshot affected cells, then walk descending so each move
        // (row -> row+count) doesn't overwrite a source row we still
        // need to read.
        const cells = snapshotSheetCells(cellsMap, sheetId, row => row >= insertAt).sort(
            (a, b) => b.row - a.row
        )
        moveCellsBy(cellsMap, sheetId, cells, count, 0)

        const heights = snapshotSparseMap<number>(meta, ROW_HEIGHTS_KEY, k => k >= insertAt)
        if (heights.map != null) {
            shiftSparseEntries(heights.map, heights.entries, count, 'descending')
        }
        const styles = snapshotSparseMap<Y.Map<unknown>>(meta, ROW_STYLES_KEY, k => k >= insertAt)
        if (styles.map != null) {
            shiftSparseEntries(styles.map, styles.entries, count, 'descending')
        }

        // Rewrite must happen after cell shift but before rowCount
        // update so the new sheet bounds are committed atomically with
        // the rewritten formula text.
        applyFormulaRewrite(doc, {
            kind: 'insertRows',
            sheetName: mutatedSheetName,
            insertAt,
            count,
        })

        // rowCount lags behind the *rendered* grid: Grid.tsx clamps the
        // displayed size up to MIN_ROWS, so a fresh sheet can show 50
        // rows with rowCount=0. Promote the stored count to whichever
        // is largest of:
        //   (a) old + count (normal insert in the middle of stored data)
        //   (b) insertAt + count - 1 (insert at the rendered bottom edge,
        //       past the stored count — the new slab itself extends here)
        //   (c) displayedRowCount + count (insert at the rendered top
        //       edge — the original visible rows below the insertion
        //       are now shifted down, so the sheet must grow to keep
        //       them visible).
        const oldRowCount = readNumberField(meta, 'rowCount', 0)
        const newRowCount = Math.max(
            oldRowCount + count,
            insertAt + count - 1,
            displayedRowCount + count
        )
        meta.set('rowCount', newRowCount)

        applyStructuralShiftToMerges(doc, sheetId, {
            kind: 'insertRows',
            at: insertAt,
            count,
        })
    }, LOCAL_ORIGIN)
}

export function insertColumns(
    doc: Y.Doc,
    sheetId: string,
    atCol: number,
    count: number,
    position: ColInsertPosition,
    displayedColCount = 0
): void {
    if (count <= 0) return
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return
    const insertAt = position === 'left' ? atCol : atCol + 1
    if (insertAt < 1) return

    const mutatedSheetName = resolveMutatedSheetName(doc, sheetId)

    doc.transact(() => {
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cells = snapshotSheetCells(cellsMap, sheetId, (_row, col) => col >= insertAt).sort(
            (a, b) => b.col - a.col
        )
        moveCellsBy(cellsMap, sheetId, cells, 0, count)

        const widths = snapshotSparseMap<number>(meta, COL_WIDTHS_KEY, k => k >= insertAt)
        if (widths.map != null) {
            shiftSparseEntries(widths.map, widths.entries, count, 'descending')
        }

        applyFormulaRewrite(doc, {
            kind: 'insertColumns',
            sheetName: mutatedSheetName,
            insertAt,
            count,
        })

        // Same three-way max as insertRows — see comment there.
        const oldColCount = readNumberField(meta, 'colCount', 0)
        const newColCount = Math.max(
            oldColCount + count,
            insertAt + count - 1,
            displayedColCount + count
        )
        meta.set('colCount', newColCount)

        applyStructuralShiftToMerges(doc, sheetId, {
            kind: 'insertColumns',
            at: insertAt,
            count,
        })
    }, LOCAL_ORIGIN)
}

export function deleteRows(doc: Y.Doc, sheetId: string, fromRow: number, count: number): void {
    if (count <= 0) return
    if (fromRow < 1) return
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return

    const oldRowCount = readNumberField(meta, 'rowCount', 0)
    if (oldRowCount <= 1) return
    // Floor at rowCount=1: never delete the entire sheet's worth of rows.
    const maxDeletable = oldRowCount - 1
    const clamped = Math.min(count, maxDeletable, oldRowCount - fromRow + 1)
    if (clamped <= 0) return

    const mutatedSheetName = resolveMutatedSheetName(doc, sheetId)

    doc.transact(() => {
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        // Delete in-range cells outright.
        const inRange = snapshotSheetCells(
            cellsMap,
            sheetId,
            row => row >= fromRow && row < fromRow + clamped
        )
        for (const snap of inRange) {
            cellsMap.delete(snap.key)
        }
        // Shift rows below the deletion up by `clamped`. Walk ascending
        // so r=fromRow+clamped writes to r-clamped before we revisit
        // the source row.
        const below = snapshotSheetCells(cellsMap, sheetId, row => row >= fromRow + clamped).sort(
            (a, b) => a.row - b.row
        )
        moveCellsBy(cellsMap, sheetId, below, -clamped, 0)

        const heightsInRange = snapshotSparseMap<number>(
            meta,
            ROW_HEIGHTS_KEY,
            k => k >= fromRow && k < fromRow + clamped
        )
        deleteSparseEntries(heightsInRange.map, heightsInRange.entries)
        const heightsBelow = snapshotSparseMap<number>(
            meta,
            ROW_HEIGHTS_KEY,
            k => k >= fromRow + clamped
        )
        if (heightsBelow.map != null) {
            shiftSparseEntries(heightsBelow.map, heightsBelow.entries, -clamped, 'ascending')
        }

        const stylesInRange = snapshotSparseMap<Y.Map<unknown>>(
            meta,
            ROW_STYLES_KEY,
            k => k >= fromRow && k < fromRow + clamped
        )
        deleteSparseEntries(stylesInRange.map, stylesInRange.entries)
        const stylesBelow = snapshotSparseMap<Y.Map<unknown>>(
            meta,
            ROW_STYLES_KEY,
            k => k >= fromRow + clamped
        )
        if (stylesBelow.map != null) {
            shiftSparseEntries(stylesBelow.map, stylesBelow.entries, -clamped, 'ascending')
        }

        applyFormulaRewrite(doc, {
            kind: 'deleteRows',
            sheetName: mutatedSheetName,
            fromRow,
            count: clamped,
        })

        meta.set('rowCount', oldRowCount - clamped)

        applyStructuralShiftToMerges(doc, sheetId, {
            kind: 'deleteRows',
            from: fromRow,
            count: clamped,
        })
    }, LOCAL_ORIGIN)
}

export function deleteColumns(doc: Y.Doc, sheetId: string, fromCol: number, count: number): void {
    if (count <= 0) return
    if (fromCol < 1) return
    const meta = getSheetMeta(doc, sheetId)
    if (meta == null) return

    const oldColCount = readNumberField(meta, 'colCount', 0)
    if (oldColCount <= 1) return
    const maxDeletable = oldColCount - 1
    const clamped = Math.min(count, maxDeletable, oldColCount - fromCol + 1)
    if (clamped <= 0) return

    const mutatedSheetName = resolveMutatedSheetName(doc, sheetId)

    doc.transact(() => {
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const inRange = snapshotSheetCells(
            cellsMap,
            sheetId,
            (_row, col) => col >= fromCol && col < fromCol + clamped
        )
        for (const snap of inRange) {
            cellsMap.delete(snap.key)
        }
        const right = snapshotSheetCells(
            cellsMap,
            sheetId,
            (_row, col) => col >= fromCol + clamped
        ).sort((a, b) => a.col - b.col)
        moveCellsBy(cellsMap, sheetId, right, 0, -clamped)

        const widthsInRange = snapshotSparseMap<number>(
            meta,
            COL_WIDTHS_KEY,
            k => k >= fromCol && k < fromCol + clamped
        )
        deleteSparseEntries(widthsInRange.map, widthsInRange.entries)
        const widthsRight = snapshotSparseMap<number>(
            meta,
            COL_WIDTHS_KEY,
            k => k >= fromCol + clamped
        )
        if (widthsRight.map != null) {
            shiftSparseEntries(widthsRight.map, widthsRight.entries, -clamped, 'ascending')
        }

        applyFormulaRewrite(doc, {
            kind: 'deleteColumns',
            sheetName: mutatedSheetName,
            fromCol,
            count: clamped,
        })

        meta.set('colCount', oldColCount - clamped)

        applyStructuralShiftToMerges(doc, sheetId, {
            kind: 'deleteColumns',
            from: fromCol,
            count: clamped,
        })
    }, LOCAL_ORIGIN)
}
