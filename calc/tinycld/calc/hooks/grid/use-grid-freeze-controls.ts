import { useMemo } from 'react'
import { primaryRange } from '../../lib/selection-range'
import type { GridStoreApi } from '../grid-store'
import { useGridStore } from '../use-grid-store'

export interface GridFreezeControls {
    // Bottom row / right col of the active selection (or anchor when
    // there's no range). null when there's no selection at all so the
    // FreezeMenu can hide its dynamic "Freeze up to row N" item.
    selectionBottomRow: number | null
    selectionRightCol: number | null
    setFrozenRows: (n: number) => void
    setFrozenCols: (n: number) => void
    unfreeze: () => void
}

// FreezeMenu inputs: the *current* freeze counts come straight off the
// sheet meta in Grid (already needed there for the viewport quadrants),
// so this hook only owns the selection-derived inputs and the
// store-passthrough actions. Stable identities so memo'd Toolbar
// doesn't churn.
export function useGridFreezeControls(store: GridStoreApi): GridFreezeControls {
    // Tier B: freeze is single-axis and per-sheet; disjoint doesn't
    // apply. Read the primary sub-range; on a disjoint selection
    // that's the most-recently-Ctrl-clicked rectangle.
    const selectionBottomRow = useGridStore(s => primaryRange(s.selection)?.endRow ?? null)
    const selectionRightCol = useGridStore(s => primaryRange(s.selection)?.endCol ?? null)

    const actions = useMemo(() => {
        const s = () => store.getState()
        return {
            setFrozenRows: (n: number) => s().setFrozenRows(n),
            setFrozenCols: (n: number) => s().setFrozenCols(n),
            unfreeze: () => s().unfreeze(),
        }
    }, [store])

    return {
        selectionBottomRow,
        selectionRightCol,
        ...actions,
    }
}
