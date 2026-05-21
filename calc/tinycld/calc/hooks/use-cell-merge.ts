import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { findMergeContaining, getAllMerges, type MergeRange } from '../lib/merge'
import { MERGES_KEY, SHEETS_MAP } from '../lib/y-doc-bootstrap'

// useCellMerge returns the merge that covers (sheetId, row, col), or
// null when the cell is independent. The hook re-renders the caller
// whenever a merge entry inside the sheet's merges Y.Map is added,
// removed, or replaced — picking up footprint changes that wouldn't
// otherwise wake the (memoized) Cell.
//
// Background. Cell.tsx is memoized and its other subscriptions
// (useYCell, selection-derived booleans via useGridStore) don't track
// merge state. Without this hook, when mergeCells creates a new merge
// over a previously-independent range:
//   - covered cells (B1, C1 of an A1:C1 merge) DO re-render because
//     mergeCells collapses the selection to a single anchor cell,
//     flipping their `isInRange` — they then read findMergeContaining
//     and return null.
//   - the anchor cell (A1) re-render is NOT triggered: it was the
//     primary anchor before and after the collapse, so neither
//     isSelected nor isInRange flips. The merge entry lands in the
//     doc but the anchor's renderWidth stays at single-cell.
// This hook closes the gap by giving every cell a Y-backed subscription
// to merge changes.
//
// Subscription shape. Two layers, mirroring useYCell:
//   1. The sheet's meta Y.Map, watching for MERGES_KEY being added —
//      that's how a fresh sheet gets its first merge. observe() (NOT
//      observeDeep) so unrelated meta-level keys (rowCount, frozen
//      rows, filter view) don't fire this handler.
//   2. The merges Y.Map itself once it exists, watching for entry
//      add/delete. observe() suffices because merge values are plain
//      JS objects with no nested Y types.
// On layer-1 fires for MERGES_KEY, we detach the old inner observer
// (if any) and re-attach to the new merges map.
//
// Snapshot identity is stabilized by sameMerge so useSyncExternalStore
// short-circuits when an unrelated merge changes elsewhere on the
// sheet — Cell.tsx skips re-render entirely in that case.
export function useCellMerge(
    doc: Y.Doc | null,
    sheetId: string,
    row: number,
    col: number
): MergeRange | null {
    const snapshotRef = useRef<MergeRange | null>(null)

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}

            const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
            const meta = sheetsMap.get(sheetId)
            // Sheet meta should always exist by the time Cells are
            // rendering against it, but guard for the transient case
            // where useYSheets has reported a sheet that's already been
            // deleted on a peer — better to no-op than throw here.
            if (!(meta instanceof Y.Map)) return () => {}

            // Inner observer state. mergesHandler fires on add/delete
            // of merge entries inside the merges Y.Map (no nested Y
            // types to descend into, so observe() is enough).
            let mergesMap: Y.Map<unknown> | undefined
            const mergesHandler = () => onChange()
            const detachMerges = () => {
                if (mergesMap == null) return
                try {
                    mergesMap.unobserve(mergesHandler)
                } catch {
                    // already detached or destroyed; tolerate
                }
                mergesMap = undefined
            }
            const attachMerges = () => {
                const next = meta.get(MERGES_KEY)
                const nextMap = next instanceof Y.Map ? next : undefined
                if (nextMap === mergesMap) return
                detachMerges()
                if (nextMap != null) {
                    nextMap.observe(mergesHandler)
                    mergesMap = nextMap
                }
            }

            // Initial attach: covers the case where the merges Y.Map
            // already exists on the sheet (e.g. round-trip after first
            // merge, or remote sync). On a fresh sheet it's absent and
            // the parent observer below catches the eventual add.
            attachMerges()

            // Parent observer: fires on key add/delete at the meta
            // level. We re-attach the inner observer when MERGES_KEY
            // changes (the merges map was just created, or replaced)
            // and also notify the consumer — the snapshot equality
            // check below will short-circuit if the new merges map
            // happens to leave this cell's merge unchanged.
            const metaHandler = (event: Y.YMapEvent<unknown>) => {
                if (!event.keysChanged.has(MERGES_KEY)) return
                attachMerges()
                onChange()
            }
            meta.observe(metaHandler)

            return () => {
                meta.unobserve(metaHandler)
                detachMerges()
            }
        },
        [doc, sheetId]
    )

    const getSnapshot = useCallback((): MergeRange | null => {
        if (doc == null) {
            snapshotRef.current = null
            return null
        }
        const next = findMergeContaining(doc, sheetId, row, col)
        const prev = snapshotRef.current
        if (sameMerge(prev, next)) return prev
        snapshotRef.current = next
        return next
    }, [doc, sheetId, row, col])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function sameMerge(a: MergeRange | null, b: MergeRange | null): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    return (
        a.anchorRow === b.anchorRow &&
        a.anchorCol === b.anchorCol &&
        a.rowSpan === b.rowSpan &&
        a.colSpan === b.colSpan
    )
}

// useSheetMerges returns every merge on the sheet as a plain array,
// re-rendering on any add/remove/replace inside the sheet's merges
// Y.Map. Single subscription per consumer (vs. useCellMerge's per-cell
// snapshot) — built for whole-sheet renderers like LocalSelectionOverlay
// that need to walk all merges to expand a selection rectangle over
// the merges it intersects.
//
// Identity is stabilized so useSyncExternalStore can short-circuit
// renders when the merge set is unchanged: the snapshot is rebuilt
// only when sameMergeList returns false against the previous one.
const EMPTY_MERGES: MergeRange[] = []

export function useSheetMerges(doc: Y.Doc | null, sheetId: string): MergeRange[] {
    const snapshotRef = useRef<MergeRange[]>(EMPTY_MERGES)

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
            const meta = sheetsMap.get(sheetId)
            if (!(meta instanceof Y.Map)) return () => {}

            let mergesMap: Y.Map<unknown> | undefined
            const mergesHandler = () => onChange()
            const detachMerges = () => {
                if (mergesMap == null) return
                try {
                    mergesMap.unobserve(mergesHandler)
                } catch {
                    // already detached or destroyed; tolerate
                }
                mergesMap = undefined
            }
            const attachMerges = () => {
                const next = meta.get(MERGES_KEY)
                const nextMap = next instanceof Y.Map ? next : undefined
                if (nextMap === mergesMap) return
                detachMerges()
                if (nextMap != null) {
                    nextMap.observe(mergesHandler)
                    mergesMap = nextMap
                }
            }
            attachMerges()

            const metaHandler = (event: Y.YMapEvent<unknown>) => {
                if (!event.keysChanged.has(MERGES_KEY)) return
                attachMerges()
                onChange()
            }
            meta.observe(metaHandler)
            return () => {
                meta.unobserve(metaHandler)
                detachMerges()
            }
        },
        [doc, sheetId]
    )

    const getSnapshot = useCallback((): MergeRange[] => {
        if (doc == null) {
            snapshotRef.current = EMPTY_MERGES
            return EMPTY_MERGES
        }
        const next = getAllMerges(doc, sheetId)
        const prev = snapshotRef.current
        if (sameMergeList(prev, next)) return prev
        snapshotRef.current = next
        return next
    }, [doc, sheetId])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function sameMergeList(a: MergeRange[], b: MergeRange[]): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (!sameMerge(a[i], b[i])) return false
    }
    return true
}
