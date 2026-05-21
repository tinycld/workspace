import { useEffect } from 'react'
import { extendCellRefInsertion, formatRange } from '../../lib/formula/cell-ref-insertion'
import { useGridStore, useGridStoreApi } from '../use-grid-store'

// Live-extends the in-progress draft as the ref-drag end-cell
// changes. Lives outside the store because extendCellRefInsertion is
// a formula-helper concern; the store carries only the result.
//
// Subscribes to refDrag identity. On each non-trivial change of the
// drag rectangle, computes the new range string, splices it into the
// draft via the formula helper, and pushes the result back through
// the store action.
export function useRefDragExtender(): void {
    const refDrag = useGridStore(s => s.refDrag)
    const store = useGridStoreApi()
    useEffect(() => {
        if (refDrag == null) return
        const session = store.getState().editSession
        if (session == null) return
        const range = formatRange(refDrag.anchor, refDrag.end)
        const result = extendCellRefInsertion(session.draft, refDrag.lastSlice, range)
        if (result.draft === session.draft) return
        store.getState().extendRefDragDraft(result.draft, result.insertedSlice)
    }, [refDrag, store])
}
