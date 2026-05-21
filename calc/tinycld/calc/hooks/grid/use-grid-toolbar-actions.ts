import { useMemo } from 'react'
import type { GridStoreApi } from '../grid-store'

export interface GridToolbarActions {
    openSort: () => void
    mergeAll: () => void
    mergeHorizontal: () => void
    mergeVertical: () => void
    unmerge: () => void
}

// Bundles the toolbar's store-passthrough sort/merge actions into a
// single stable object. Each callback reads getState() at call time so
// identities stay tied to the store's lifetime rather than the
// orchestrating component's render cycle — this is what keeps
// <Toolbar>'s memo from churning on every selection-range update.
//
// Freeze actions live in useGridFreezeControls (paired with the
// selection-bottom/right derived state the FreezeMenu's dynamic items
// need).
export function useGridToolbarActions(store: GridStoreApi): GridToolbarActions {
    return useMemo(() => {
        const s = () => store.getState()
        return {
            openSort: () => s().openSortDialog(),
            mergeAll: () => s().mergeSelection(),
            mergeHorizontal: () => s().mergeSelectionHorizontal(),
            mergeVertical: () => s().mergeSelectionVertical(),
            unmerge: () => s().unmergeSelection(),
        }
    }, [store])
}
