import { describe, expect, it } from 'vitest'
import {
    type CellRange,
    createGridStore,
    type GridStoreDeps,
} from '../tinycld/calc/hooks/grid-store'
import {
    isDisjoint,
    overallScope,
    primaryAnchor,
    primaryRange,
} from '../tinycld/calc/lib/selection-range'

// Disjoint selection state-transition contract. Ctrl-click appends a
// new sub-range that becomes primary; Shift-click extends the active
// (last) sub-range; Ctrl-clicking an existing anchor pops that sub-
// range; arrow keys collapse a disjoint selection to a single cell;
// fill is refused on disjoint.

function makeStubDeps(opts: { readOnly?: boolean } = {}): GridStoreDeps {
    return {
        readOnly: opts.readOnly ?? false,
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

describe('addSubRange — Ctrl-click body cell', () => {
    it('on an empty selection equals selectCell', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().addSubRange({ row: 3, col: 4 })
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryAnchor(s.selection)).toEqual({ row: 3, col: 4 })
    })

    it('appends a new single-cell sub-range, moves primary anchor to it', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 2, col: 2 })
        store.getState().addSubRange({ row: 5, col: 5 })
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(2)
        expect(primaryAnchor(s.selection)).toEqual({ row: 5, col: 5 })
        // Older sub-range stays intact.
        expect(s.selection?.ranges[0].range).toEqual({
            startRow: 1,
            endRow: 2,
            startCol: 1,
            endCol: 2,
        })
        expect(isDisjoint(s.selection)).toBe(true)
    })

    it('Ctrl-click on an existing anchor pops that sub-range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().addSubRange({ row: 5, col: 5 })
        // Click on the anchor of the first sub-range — it gets
        // removed; second becomes the only one.
        store.getState().addSubRange({ row: 1, col: 1 })
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryAnchor(s.selection)).toEqual({ row: 5, col: 5 })
    })

    it('does NOT pop the sole anchor when ranges.length === 1', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().addSubRange({ row: 1, col: 1 })
        // No-op: re-clicking the sole anchor without other sub-ranges
        // collapses to the same single-cell selection.
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
    })

    it('Ctrl-click inside an existing sub-range (not anchor) is no-op (no hole-punch)', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 3, col: 3 })
        // Click inside the range, not at the anchor — should be a
        // no-op per plan §6.b (no hole-punching).
        const before = store.getState().selection
        store.getState().addSubRange({ row: 2, col: 2 })
        const after = store.getState().selection
        expect(after).toBe(before)
    })
})

describe('extendActiveRangeTo on disjoint — Shift-click extends NEW sub-range', () => {
    it('Shift after Ctrl-click extends the just-added sub-range from its anchor', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 3, col: 3 })
        // Ctrl-click at E5 → adds new sub-range.
        store.getState().addSubRange({ row: 5, col: 5 })
        // Shift-click at G7 → extends the E5 sub-range to E5..G7.
        store.getState().extendActiveRangeTo({ row: 7, col: 7 })
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(2)
        // First sub-range untouched.
        expect(s.selection?.ranges[0].range).toEqual({
            startRow: 1,
            endRow: 3,
            startCol: 1,
            endCol: 3,
        })
        // Second sub-range extended from its own anchor (5,5) to (7,7).
        expect(s.selection?.ranges[1].anchor).toEqual({ row: 5, col: 5 })
        expect(s.selection?.ranges[1].range).toEqual({
            startRow: 5,
            endRow: 7,
            startCol: 5,
            endCol: 7,
        })
    })
})

describe('collapseToPrimary — arrow-key collapse', () => {
    it('collapses a disjoint selection to a single-cell at the primary anchor', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().addSubRange({ row: 5, col: 5 })
        store.getState().collapseToPrimary()
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryAnchor(s.selection)).toEqual({ row: 5, col: 5 })
        expect(primaryRange(s.selection)).toEqual({
            startRow: 5,
            endRow: 5,
            startCol: 5,
            endCol: 5,
        })
    })

    it('collapses a single multi-cell rectangle to its anchor', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 3, col: 3 })
        store.getState().collapseToPrimary()
        const s = store.getState()
        expect(primaryRange(s.selection)).toEqual({
            startRow: 1,
            endRow: 1,
            startCol: 1,
            endCol: 1,
        })
    })

    it('no-op when already a single cell', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 5, col: 5 })
        const before = store.getState().selection
        store.getState().collapseToPrimary()
        expect(store.getState().selection).toBe(before)
    })
})

describe('addColumnSubRange — Ctrl-click column header', () => {
    it('appends a column-scope sub-range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectColumn(2, 100)
        store.getState().addColumnSubRange(5, 100)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(2)
        expect(s.selection?.ranges[1].scope).toBe('column')
        expect(primaryAnchor(s.selection)).toEqual({ row: 1, col: 5 })
    })

    it('Ctrl-click on existing column anchor pops it', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectColumn(2, 100)
        store.getState().addColumnSubRange(5, 100)
        store.getState().addColumnSubRange(2, 100)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryAnchor(s.selection)).toEqual({ row: 1, col: 5 })
    })
})

describe('addRowSubRange — Ctrl-click row header', () => {
    it('appends a row-scope sub-range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(2, 26)
        store.getState().addRowSubRange(5, 26)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(2)
        expect(s.selection?.ranges[1].scope).toBe('row')
        expect(primaryAnchor(s.selection)).toEqual({ row: 5, col: 1 })
    })
})

describe('extendActiveColumnTo — Shift-click column header', () => {
    it('extends an active column-scope sub-range by columns', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectColumn(2, 100)
        store.getState().extendActiveColumnTo(5, 100)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryRange(s.selection)).toEqual({
            startRow: 1,
            endRow: 100,
            startCol: 2,
            endCol: 5,
        })
    })

    it('falls back to a plain column selection when active scope is not column', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(2, 26)
        store.getState().extendActiveColumnTo(5, 100)
        const s = store.getState()
        // Cross-scope Shift-extend replaces the selection — Sheets
        // parity. Just one column-scope sub-range now.
        expect(s.selection?.ranges).toHaveLength(1)
        expect(overallScope(s.selection)).toBe('column')
        expect(primaryRange(s.selection)).toEqual({
            startRow: 1,
            endRow: 100,
            startCol: 5,
            endCol: 5,
        })
    })
})

describe('fillDragStart — disjoint refusal', () => {
    it('refuses to start when selection is disjoint', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().addSubRange({ row: 5, col: 5 })
        const ok = store.getState().fillDragStart()
        expect(ok).toBe(false)
        expect(store.getState().fillDrag).toBeNull()
    })

    it('starts normally on a single-rectangle selection (regression guard)', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        expect(store.getState().fillDragStart()).toBe(true)
    })
})

describe('mergeSelection — disjoint refusal', () => {
    it('refuses on disjoint selection', () => {
        const calls: CellRange[] = []
        const deps = {
            ...makeStubDeps(),
            mergeRange: (r: CellRange) => calls.push(r),
        }
        const store = createGridStore(deps)
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 2, col: 2 })
        store.getState().addSubRange({ row: 5, col: 5 })
        store.getState().mergeSelection()
        expect(calls).toHaveLength(0)
    })
})

describe('clearSelection on disjoint', () => {
    it('clears every cell in every sub-range', () => {
        const writes: Array<{ row: number; col: number; value: string }> = []
        const deps = {
            ...makeStubDeps(),
            writeCell: (row: number, col: number, value: string) =>
                writes.push({ row, col, value }),
        }
        const store = createGridStore(deps)
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 1, col: 2 })
        store.getState().addSubRange({ row: 5, col: 5 })
        store.getState().clearSelection()
        expect(writes).toEqual([
            { row: 1, col: 1, value: '' },
            { row: 1, col: 2, value: '' },
            { row: 5, col: 5, value: '' },
        ])
    })
})

describe('structural mutations shift all sub-ranges', () => {
    it('insertRows above primary also shifts other sub-ranges', () => {
        const store = createGridStore(makeStubDeps())
        // Set up: row 2 selected, plus a disjoint single-cell sub-
        // range at row 8 (the primary, since it's the most recent).
        store.getState().selectCell({ row: 2, col: 1 })
        store.getState().addSubRange({ row: 8, col: 5 })
        // Insert 1 row above primary (row 8) — primary becomes 9,
        // and the earlier sub-range at row 2 stays at 2 (it's
        // above the insertion).
        store.getState().insertRowsAtSelection('above', 50)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(2)
        expect(s.selection?.ranges[0].anchor.row).toBe(2)
        expect(s.selection?.ranges[1].anchor.row).toBe(9)
    })

    it('deleteSelectedRows collapses to single cell at primary clamp', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 2, col: 1 })
        store.getState().addSubRange({ row: 8, col: 5 })
        store.getState().deleteSelectedRows(50)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryAnchor(s.selection)?.row).toBe(8)
    })
})

describe('openCellContextMenu preserves disjoint when click is inside any sub-range', () => {
    it('keeps the disjoint selection when the click lands inside any sub-range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 3, col: 3 })
        store.getState().addSubRange({ row: 5, col: 5 })
        // Right-click inside the first sub-range — preserves
        // disjoint selection.
        store.getState().openCellContextMenu(2, 2, 0, 0)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(2)
    })

    it('collapses when the click lands outside every sub-range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().addSubRange({ row: 5, col: 5 })
        store.getState().openCellContextMenu(9, 9, 0, 0)
        const s = store.getState()
        expect(s.selection?.ranges).toHaveLength(1)
        expect(primaryAnchor(s.selection)).toEqual({ row: 9, col: 9 })
    })
})
