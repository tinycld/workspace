// Reactive bridge between a PivotDefinition and the engine. Observes
// (a) the pivot's Y.Map entry via SHEETS_MAP (sheets can be renamed,
// which moves the source rect), and (b) the source range's cell
// entries on the source sheet. Returns a Result<RenderedPivot>.
//
// Filtering the cell-map observer to only the source rect avoids
// re-renders on unrelated edits. observeDeep delivers events at two
// levels we care about:
//   1) ev.target === cellsMap → an entry was added/removed from the
//      top-level cells Y.Map. Affected keys live in ev.changes.keys
//      and ev.path is [].
//   2) ev.target is a nested cell Y.Map → an EXISTING cell was mutated
//      (raw/display/formula/style changed). ev.path is [<cellKey>] —
//      one entry pointing at the parent map's key. Without handling
//      this case, edits to source cells silently no-op the recompute.
//
// Implementation note: pure subscribe / computeSnapshot helpers are
// exported via __renderedPivotHookInternals so tests can exercise the
// data-flow contract without mounting React (the vitest setup runs in
// a node environment without jsdom or @testing-library/react). The
// React hook itself is a thin useSyncExternalStore wrapper.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { computePivot, type PivotError, type RenderedPivot } from '../lib/pivot'
import { parseA1Range } from '../lib/pivot/range-parse'
import type { CellValue, PivotDefinition } from '../lib/workbook-types'
import { parseYCellKey, yCellKey } from '../lib/y-cell-key'
import {
    CELLS_MAP,
    readYCell,
    SHEETS_MAP,
} from '../lib/y-doc-bootstrap'

export type RenderedPivotResult =
    | { ok: true; value: RenderedPivot }
    | PivotError

interface SnapshotState {
    cache: RenderedPivotResult
    cacheKey: string
    initialized: boolean
}

function createSnapshotState(): SnapshotState {
    return {
        cache: {
            ok: false,
            code: 'malformed-range',
            message: '',
        },
        cacheKey: '',
        initialized: false,
    }
}

function buildSheetIdByName(doc: Y.Doc): Record<string, string> {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const out: Record<string, string> = {}
    sheetsMap.forEach((meta, id) => {
        if (!(meta instanceof Y.Map)) return
        const name = meta.get('name')
        if (typeof name === 'string') out[name] = id
    })
    return out
}

function resolveSheetIdByName(doc: Y.Doc, name: string): string | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    let found: string | null = null
    sheetsMap.forEach((meta, id) => {
        if (found != null || !(meta instanceof Y.Map)) return
        if (meta.get('name') === name) found = id
    })
    return found
}

interface SourceCellsSnapshot {
    cells: Map<string, CellValue>
    cacheKey: string
}

function snapshotSourceCells(
    doc: Y.Doc,
    def: PivotDefinition,
    sheetIdByName: Readonly<Record<string, string>>
): SourceCellsSnapshot {
    const out = new Map<string, CellValue>()
    const parsed = parseA1Range(def.sourceRange)
    if (!parsed.ok) return { cells: out, cacheKey: '' }
    const sheetId = sheetIdByName[parsed.sheetName]
    if (sheetId == null) return { cells: out, cacheKey: '' }
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const keyParts: string[] = []
    for (let r = parsed.startRow; r <= parsed.endRow; r++) {
        for (let c = parsed.startCol; c <= parsed.endCol; c++) {
            const k = yCellKey(sheetId, r, c)
            const cell = cellsMap.get(k)
            if (!(cell instanceof Y.Map)) continue
            const value = readYCell(cell)
            out.set(k, value)
            keyParts.push(`${k}=${value.kind}:${String(value.raw)}`)
        }
    }
    return { cells: out, cacheKey: keyParts.join('|') }
}

function subscribe(
    doc: Y.Doc | null,
    def: PivotDefinition | null,
    onChange: () => void
): () => void {
    if (doc == null || def == null) return () => {}
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const handleSheets = () => onChange()
    sheetsMap.observeDeep(handleSheets)
    const handleCells = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
        // Resolve the source rect inside the handler so concurrent
        // sheet renames are picked up. parseA1Range is pure.
        const parsed = parseA1Range(def.sourceRange)
        if (!parsed.ok) return
        const sourceSheetId = resolveSheetIdByName(doc, parsed.sheetName)
        if (sourceSheetId == null) return
        const inSourceRect = (key: string): boolean => {
            const parts = parseYCellKey(key)
            if (parts == null) return false
            if (parts.sheetId !== sourceSheetId) return false
            if (parts.row < parsed.startRow || parts.row > parsed.endRow) {
                return false
            }
            if (parts.col < parsed.startCol || parts.col > parsed.endCol) {
                return false
            }
            return true
        }
        for (const ev of events) {
            if (ev.target === cellsMap) {
                for (const key of ev.changes.keys.keys()) {
                    if (inSourceRect(key)) {
                        onChange()
                        return
                    }
                }
                continue
            }
            const first = ev.path[0]
            if (typeof first !== 'string') continue
            if (inSourceRect(first)) {
                onChange()
                return
            }
        }
    }
    cellsMap.observeDeep(handleCells)
    return () => {
        sheetsMap.unobserveDeep(handleSheets)
        cellsMap.unobserveDeep(handleCells)
    }
}

function computeSnapshot(
    doc: Y.Doc | null,
    def: PivotDefinition | null,
    state: SnapshotState
): RenderedPivotResult {
    if (doc == null || def == null) {
        const next: RenderedPivotResult = {
            ok: false,
            code: 'malformed-range',
            message: 'No document or definition',
        }
        if (!state.initialized) {
            state.cache = next
            state.cacheKey = ''
            state.initialized = true
            return next
        }
        // Stable identity for the null-input case: keep returning the
        // cached error so React doesn't loop.
        if (!state.cache.ok && state.cache.code === 'malformed-range') {
            return state.cache
        }
        state.cache = next
        state.cacheKey = ''
        return next
    }
    const sheetIdByName = buildSheetIdByName(doc)
    const sourceCells = snapshotSourceCells(doc, def, sheetIdByName)
    const key = `${sourceCells.cacheKey}|${JSON.stringify(def)}`
    if (state.initialized && key === state.cacheKey) return state.cache
    const r = computePivot(def, sourceCells.cells, sheetIdByName)
    state.cache = r
    state.cacheKey = key
    state.initialized = true
    return r
}

export function useRenderedPivot(
    doc: Y.Doc | null,
    def: PivotDefinition | null
): RenderedPivotResult {
    const stateRef = useRef<SnapshotState | null>(null)
    if (stateRef.current == null) stateRef.current = createSnapshotState()
    const state = stateRef.current

    const sub = useCallback(
        (onChange: () => void) => subscribe(doc, def, onChange),
        [doc, def]
    )

    const getSnapshot = useCallback(
        (): RenderedPivotResult => computeSnapshot(doc, def, state),
        [doc, def, state]
    )

    return useSyncExternalStore(sub, getSnapshot, getSnapshot)
}

export const __renderedPivotHookInternals = {
    createSnapshotState,
    subscribe,
    computeSnapshot,
}
