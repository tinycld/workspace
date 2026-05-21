// Reactive list of every PivotDefinition on the doc. Re-renders only
// when a pivot is added/removed or a tracked field on an existing
// pivot changes. Field-array order changes ARE observed (observeDeep
// catches Y.Array mutations).
//
// Implementation note: the pure subscribe / computeSnapshot helpers
// are exported via __pivotsHookInternals so tests can exercise the
// data-flow contract without mounting React (our vitest setup runs in
// a node environment without jsdom or @testing-library/react). The
// React hook itself is a thin useSyncExternalStore wrapper around
// those helpers.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { readPivotFromMap } from '../lib/pivot/y-binding'
import type { PivotDefinition } from '../lib/workbook-types'
import { PIVOTS_MAP } from '../lib/y-doc-bootstrap'

interface SnapshotState {
    cache: PivotDefinition[]
}

function createSnapshotState(): SnapshotState {
    return { cache: [] }
}

function subscribe(doc: Y.Doc | null, onChange: () => void): () => void {
    if (doc == null) return () => {}
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    const handler = () => onChange()
    map.observeDeep(handler)
    return () => map.unobserveDeep(handler)
}

function computeSnapshot(doc: Y.Doc | null, state: SnapshotState): PivotDefinition[] {
    if (doc == null) return state.cache
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    const next: PivotDefinition[] = []
    map.forEach((entry, id) => {
        if (!(entry instanceof Y.Map)) return
        next.push(readPivotFromMap(id, entry))
    })
    const prev = state.cache
    if (samePivotList(prev, next)) return prev
    state.cache = next
    return next
}

function samePivotList(a: PivotDefinition[], b: PivotDefinition[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false
    }
    return true
}

export function usePivots(doc: Y.Doc | null): PivotDefinition[] {
    const stateRef = useRef<SnapshotState | null>(null)
    if (stateRef.current == null) stateRef.current = createSnapshotState()
    const state = stateRef.current

    const sub = useCallback(
        (onChange: () => void) => subscribe(doc, onChange),
        [doc]
    )

    const getSnapshot = useCallback(
        (): PivotDefinition[] => computeSnapshot(doc, state),
        [doc, state]
    )

    return useSyncExternalStore(sub, getSnapshot, getSnapshot)
}

export const __pivotsHookInternals = {
    createSnapshotState,
    subscribe,
    computeSnapshot,
}
