import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { type FilterDefinition, readFilterView } from '../lib/filter'
import { SHEETS_MAP } from '../lib/y-doc-bootstrap'

// useFilterView subscribes to the per-sheet `filterView` Y.Map and
// returns the snapshot whenever it changes. Returns null when no
// filter is active. Re-renders are coarse (any sheet metadata change
// triggers a re-read) which is fine because the filter UI is the only
// consumer.
export function useFilterView(doc: Y.Doc | null, sheetId: string): FilterDefinition | null {
    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
            const handler = () => onChange()
            sheetsMap.observeDeep(handler)
            return () => sheetsMap.unobserveDeep(handler)
        },
        [doc]
    )

    const snapshotRef = useRef<FilterDefinition | null>(null)
    const getSnapshot = useCallback((): FilterDefinition | null => {
        if (doc == null) return null
        const next = readFilterView(doc, sheetId)
        const prev = snapshotRef.current
        if (sameFilter(prev, next)) return prev
        snapshotRef.current = next
        return next
    }, [doc, sheetId])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function sameFilter(a: FilterDefinition | null, b: FilterDefinition | null): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (
        a.range.startRow !== b.range.startRow ||
        a.range.endRow !== b.range.endRow ||
        a.range.startCol !== b.range.startCol ||
        a.range.endCol !== b.range.endCol
    ) {
        return false
    }
    const aKeys = Object.keys(a.criteria)
    const bKeys = Object.keys(b.criteria)
    if (aKeys.length !== bKeys.length) return false
    if (JSON.stringify(a.criteria) !== JSON.stringify(b.criteria)) return false
    if (JSON.stringify(a.savedHeights) !== JSON.stringify(b.savedHeights)) return false
    return true
}
