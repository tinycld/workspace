// Reactive lookup: given a sheet id, return the PivotDefinition that
// owns it — i.e. the pivot whose dedicated output sheet this is — or
// null when the sheet has no pivot association. The grid branches on
// this hook to decide between rendering normal cells and the engine's
// rendered pivot output (see grid Body integration in §9 of the plan).
//
// Implementation note: pure subscribe / computeSnapshot helpers are
// exported via __pivotForSheetHookInternals so tests can exercise the
// data-flow contract without mounting React (the vitest setup runs in
// a node environment without jsdom or @testing-library/react). The
// React hook itself is a thin useSyncExternalStore wrapper.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { readPivot } from '../lib/pivot/y-binding'
import type { PivotDefinition } from '../lib/workbook-types'
import {
    PIVOT_SHEET_KEY,
    PIVOTS_MAP,
    SHEETS_MAP,
} from '../lib/y-doc-bootstrap'

interface SnapshotState {
    cache: PivotDefinition | null
}

function createSnapshotState(): SnapshotState {
    return { cache: null }
}

// We observe BOTH maps because a re-render is required when either:
//   - the sheet's pivotId meta changes (sheet starts/stops being a
//     pivot output sheet — that's a write on sheetsMap), or
//   - the pivot itself is mutated (rows/cols/values/filters/scalars
//     change — that's a write on pivotsMap).
// observeDeep on each map catches all nested writes; combined with the
// JSON-equality guard in computeSnapshot, unrelated writes don't cause
// the snapshot identity to change.
function subscribe(doc: Y.Doc | null, onChange: () => void): () => void {
    if (doc == null) return () => {}
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const pivotsMap = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    const handler = () => onChange()
    sheetsMap.observeDeep(handler)
    pivotsMap.observeDeep(handler)
    return () => {
        sheetsMap.unobserveDeep(handler)
        pivotsMap.unobserveDeep(handler)
    }
}

function computeSnapshot(
    doc: Y.Doc | null,
    sheetId: string,
    state: SnapshotState
): PivotDefinition | null {
    if (doc == null) return state.cache
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (!(meta instanceof Y.Map)) {
        if (state.cache !== null) state.cache = null
        return state.cache
    }
    const next = findOwningPivot(doc, meta)
    const prev = state.cache
    if (
        prev != null &&
        next != null &&
        JSON.stringify(prev) === JSON.stringify(next)
    ) {
        return prev
    }
    state.cache = next
    return next
}

// Resolve the pivot that owns `sheetId` by either:
//   1. Sheet meta carries PIVOT_SHEET_KEY -> pivot id (the explicit
//      pointer set by PivotInsertButton / xlsx import), OR
//   2. A pivot's targetSheetName equals this sheet's current name.
//
// (2) is the fallback. We saw mid-session sheet-meta drift where the
// pivotId tag set in PivotInsertButton's transact stops appearing on
// the sheet meta a few ticks later (still under investigation —
// happens through the realtime broker, not visible in pure-doc unit
// tests). Pivot.targetSheetName lives on the pivot entry itself in
// PIVOTS_MAP and is not subject to the same drift, so resolving the
// owner by name is a safe second source of truth. The explicit
// pointer is still set and preferred when present so future migrations
// (e.g. renamed sheets where the meta tag updates faster than peer
// observers see the new name) continue to work.
function findOwningPivot(
    doc: Y.Doc,
    meta: Y.Map<unknown>
): PivotDefinition | null {
    const explicitPivotId = meta.get(PIVOT_SHEET_KEY)
    if (typeof explicitPivotId === 'string') {
        const def = readPivot(doc, explicitPivotId)
        if (def != null) return def
    }
    const sheetName = meta.get('name')
    if (typeof sheetName !== 'string' || sheetName.length === 0) return null
    const pivotsMap = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    let found: PivotDefinition | null = null
    pivotsMap.forEach((entry, pivotId) => {
        if (found != null) return
        if (!(entry instanceof Y.Map)) return
        const target = entry.get('targetSheetName')
        if (target === sheetName) {
            const def = readPivot(doc, pivotId)
            if (def != null) found = def
        }
    })
    return found
}

export function usePivotForSheet(
    doc: Y.Doc | null,
    sheetId: string
): PivotDefinition | null {
    const stateRef = useRef<SnapshotState | null>(null)
    if (stateRef.current == null) stateRef.current = createSnapshotState()
    const state = stateRef.current

    const sub = useCallback(
        (onChange: () => void) => subscribe(doc, onChange),
        [doc]
    )

    const getSnapshot = useCallback(
        (): PivotDefinition | null => computeSnapshot(doc, sheetId, state),
        [doc, sheetId, state]
    )

    return useSyncExternalStore(sub, getSnapshot, getSnapshot)
}

export const __pivotForSheetHookInternals = {
    createSnapshotState,
    subscribe,
    computeSnapshot,
}
