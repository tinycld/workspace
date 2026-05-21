import { describe, expect, it } from 'vitest'
import { createGridStore, type GridStoreDeps } from '../tinycld/calc/hooks/grid-store'

// useClipboard's copy/cut refuses on a disjoint selection per plan
// §6.d. The hook reads `state.selection` via `isDisjoint(...)` and,
// when true, calls `state.setSelectionStatus({ kind: 'copy-disjoint-refused' })`
// instead of writing to the OS clipboard.
//
// These tests pin the store-level contract the hook depends on:
// setSelectionStatus / dismissSelectionStatus toggle a transient
// banner, and the action references are stable across getState calls.

function makeStubDeps(): GridStoreDeps {
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

describe('selectionStatus banner', () => {
    it('starts null', () => {
        const store = createGridStore(makeStubDeps())
        expect(store.getState().selectionStatus).toBeNull()
    })

    it('setSelectionStatus stamps the kind', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setSelectionStatus({ kind: 'copy-disjoint-refused' })
        expect(store.getState().selectionStatus).toEqual({
            kind: 'copy-disjoint-refused',
        })
    })

    it('dismissSelectionStatus clears it', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setSelectionStatus({ kind: 'copy-disjoint-refused' })
        store.getState().dismissSelectionStatus()
        expect(store.getState().selectionStatus).toBeNull()
    })

    it('action references are stable across getState calls', () => {
        const store = createGridStore(makeStubDeps())
        const a1 = store.getState().setSelectionStatus
        store.getState().setSelectionStatus({ kind: 'copy-disjoint-refused' })
        const a2 = store.getState().setSelectionStatus
        expect(a1).toBe(a2)
    })
})

// The refusal branch in useClipboard's captureSelection reads
// `isDisjoint(state.selection)`. This block guards the disjoint
// detection used by that branch.
describe('disjoint detection — the gate useClipboard reads', () => {
    it('false on a single-rectangle selection', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().extendActiveRangeTo({ row: 3, col: 3 })
        expect(store.getState().selection?.ranges).toHaveLength(1)
    })

    it('true after Ctrl-click appends a second sub-range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().addSubRange({ row: 5, col: 5 })
        expect(store.getState().selection?.ranges).toHaveLength(2)
    })
})
