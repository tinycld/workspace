import { describe, expect, it } from 'vitest'
import { createGridStore, type GridStoreDeps } from '../tinycld/calc/hooks/grid-store'
import { primaryAnchor } from '../tinycld/calc/lib/selection-range'

// commentTarget mirrors contextTarget but lives independently so the
// thread popover and the right-click menu don't collide. These tests
// pin: opening sets the target, closing clears it, and a cell
// re-selection on a *different* cell auto-dismisses the popover.

function makeDeps(): GridStoreDeps {
    return {
        readOnly: false,
        writeCell: () => {},
        focusActiveInput: () => {},
        applyStructuralMutation: () => {},
        applyFill: () => {},
        resolveMergeAnchor: (row, col) => ({ row, col }),
        expandRangeOverMerges: r => r,
        findMergesInRange: () => [],
        mergeRange: () => {},
        unmergeAt: () => {},
        setFrozenRows: () => {},
        setFrozenCols: () => {},
    }
}

describe('grid-store comment popover', () => {
    it('openCommentPopover sets commentTarget at the cursor', () => {
        const store = createGridStore(makeDeps())
        store.getState().openCommentPopover(3, 4, 100, 200)
        expect(store.getState().commentTarget).toEqual({
            cell: { row: 3, col: 4 },
            cursor: { x: 100, y: 200 },
        })
        // The opened cell becomes the active selection so any
        // toolbar-driven mutation targets the same cell the popover
        // is attached to.
        expect(primaryAnchor(store.getState().selection)).toEqual({ row: 3, col: 4 })
    })

    it('closeCommentPopover clears commentTarget', () => {
        const store = createGridStore(makeDeps())
        store.getState().openCommentPopover(1, 1, 0, 0)
        store.getState().closeCommentPopover()
        expect(store.getState().commentTarget).toBeNull()
    })

    it('selectCell on a different cell closes the popover', () => {
        const store = createGridStore(makeDeps())
        store.getState().openCommentPopover(1, 1, 0, 0)
        store.getState().selectCell({ row: 5, col: 5 })
        expect(store.getState().commentTarget).toBeNull()
    })

    it('selectCell on the same cell keeps the popover open', () => {
        const store = createGridStore(makeDeps())
        store.getState().openCommentPopover(2, 2, 50, 50)
        store.getState().selectCell({ row: 2, col: 2 })
        expect(store.getState().commentTarget).not.toBeNull()
    })

    it('opening a popover dismisses any open context menu', () => {
        const store = createGridStore(makeDeps())
        store.getState().openCellContextMenu(1, 1, 10, 10)
        expect(store.getState().contextTarget).not.toBeNull()
        store.getState().openCommentPopover(1, 1, 10, 10)
        expect(store.getState().contextTarget).toBeNull()
        expect(store.getState().commentTarget).not.toBeNull()
    })
})
