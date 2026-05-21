// Reactive list of conditional-formatting rules on a single sheet.
// Returns a stable POJO array — useSyncExternalStore + identity-stable
// snapshots ensure the cell render path only re-renders when rules
// actually change.
//
// The subscribe path uses observeDeep on the sheet's meta Y.Map so
// edits inside any rule's Y.Map (condition, ranges, style) propagate.
// The snapshot reads from the rules Y.Array under the sheet's
// CONDITIONAL_FORMATS_KEY.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { readRuleFromMap } from '../lib/conditional-format/y-binding'
import type { CFRule } from '../lib/conditional-format/types'
import { CONDITIONAL_FORMATS_KEY } from '../lib/conditional-format/y-binding'
import { SHEETS_MAP } from '../lib/y-doc-bootstrap'

interface SnapshotState {
    cache: CFRule[]
}

function createSnapshotState(): SnapshotState {
    return { cache: [] }
}

function subscribe(doc: Y.Doc | null, sheetId: string, onChange: () => void): () => void {
    if (doc == null) return () => {}
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const handler = () => onChange()
    // observeDeep on sheetsMap catches both "sheet meta value changed
    // for this sheet id" and "nested CF rule edit" with a single
    // observer. Coarser than a per-sheet observer (we re-snapshot on
    // any sheet meta change), but the snapshot's identity-stable
    // comparison short-circuits useless renders.
    sheetsMap.observeDeep(handler)
    return () => sheetsMap.unobserveDeep(handler)
}

function computeSnapshot(
    doc: Y.Doc | null,
    sheetId: string,
    state: SnapshotState
): CFRule[] {
    if (doc == null) return state.cache
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const sheet = sheetsMap.get(sheetId)
    if (!(sheet instanceof Y.Map)) {
        if (state.cache.length === 0) return state.cache
        state.cache = []
        return state.cache
    }
    const arr = sheet.get(CONDITIONAL_FORMATS_KEY)
    if (!(arr instanceof Y.Array)) {
        if (state.cache.length === 0) return state.cache
        state.cache = []
        return state.cache
    }
    const next: CFRule[] = []
    arr.forEach((entry) => {
        if (!(entry instanceof Y.Map)) return
        const rule = readRuleFromMap(entry)
        if (rule != null) next.push(rule)
    })
    if (sameRuleList(state.cache, next)) return state.cache
    state.cache = next
    return next
}

function sameRuleList(a: CFRule[], b: CFRule[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false
    }
    return true
}

export function useSheetConditionalFormats(
    doc: Y.Doc | null,
    sheetId: string
): CFRule[] {
    const stateRef = useRef<SnapshotState | null>(null)
    if (stateRef.current == null) stateRef.current = createSnapshotState()
    const state = stateRef.current

    const sub = useCallback(
        (onChange: () => void) => subscribe(doc, sheetId, onChange),
        [doc, sheetId]
    )

    const getSnapshot = useCallback(
        (): CFRule[] => computeSnapshot(doc, sheetId, state),
        [doc, sheetId, state]
    )

    return useSyncExternalStore(sub, getSnapshot, getSnapshot)
}

export const __conditionalFormatsHookInternals = {
    createSnapshotState,
    subscribe,
    computeSnapshot,
}
