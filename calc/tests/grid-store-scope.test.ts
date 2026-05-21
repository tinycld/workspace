import { describe, expect, it } from 'vitest'
import { createGridStore, type GridStoreDeps } from '../tinycld/calc/hooks/grid-store'
import { overallScope, primaryAnchor, primaryRange } from '../tinycld/calc/lib/selection-range'

// Per-sub-range scope is the discriminator that drives the format-
// control dispatch path: 'cells' is the default body selection while
// 'row'/'column'/'sheet' indicate header-click selections that route
// style writes to per-axis sheet metadata. Body interactions reset
// the active sub-range scope to 'cells'.
//
// `overallScope(selection)` collapses every sub-range's scope to a
// single enum or 'mixed' for UI consumers that want the high-level
// "what kind of selection is this?" answer.

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

describe('selectRow', () => {
    it('sets scope to row, anchor to (row, 1), and a full-row range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        const s = store.getState()
        expect(overallScope(s.selection)).toBe('row')
        expect(primaryAnchor(s.selection)).toEqual({ row: 7, col: 1 })
        expect(primaryRange(s.selection)).toEqual({
            startRow: 7,
            endRow: 7,
            startCol: 1,
            endCol: 26,
        })
    })

    it('clamps endCol to at least 1 even when colCount is 0', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(2, 0)
        expect(primaryRange(store.getState().selection)?.endCol).toBe(1)
    })

    it('clears any in-flight edit session', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().editCell({ row: 1, col: 1 })
        store.getState().setEditDraft(1, 1, 'foo')
        store.getState().selectRow(7, 5)
        expect(store.getState().editSession).toBeNull()
    })
})

describe('selectColumn', () => {
    it('sets scope to column, anchor to (1, col), and a full-column range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectColumn(4, 100)
        const s = store.getState()
        expect(overallScope(s.selection)).toBe('column')
        expect(primaryAnchor(s.selection)).toEqual({ row: 1, col: 4 })
        expect(primaryRange(s.selection)).toEqual({
            startRow: 1,
            endRow: 100,
            startCol: 4,
            endCol: 4,
        })
    })
})

describe('overallScope reset by body interactions', () => {
    it('selectCell resets scope from row back to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        expect(overallScope(store.getState().selection)).toBe('row')
        store.getState().selectCell({ row: 3, col: 3 })
        expect(overallScope(store.getState().selection)).toBe('cells')
    })

    it('extendActiveRangeTo resets scope from row back to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().selectRow(7, 26)
        expect(overallScope(store.getState().selection)).toBe('row')
        store.getState().extendActiveRangeTo({ row: 5, col: 5 })
        // extendActiveRangeTo on a row-scope sub-range stays row-
        // scope (it shifts the active rectangle); only selectCell
        // resets to cells. Match Sheets parity.
        expect(overallScope(store.getState().selection)).toBe('row')
    })

    it('editCell resets scope to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        store.getState().editCell({ row: 1, col: 1 })
        expect(overallScope(store.getState().selection)).toBe('cells')
    })

    it('commitEdit resets scope to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        store.getState().commitEdit(1, 1, 'value')
        expect(overallScope(store.getState().selection)).toBe('cells')
    })
})

describe('initial state', () => {
    it('starts with no selection', () => {
        const store = createGridStore(makeStubDeps())
        expect(store.getState().selection).toBeNull()
        expect(overallScope(store.getState().selection)).toBe('cells')
    })
})

describe('overallScope with disjoint sub-ranges', () => {
    it("returns 'mixed' when sub-ranges disagree on scope", () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(2, 26)
        store.getState().addColumnSubRange(5, 100)
        expect(overallScope(store.getState().selection)).toBe('mixed')
    })

    it('returns the shared scope when all sub-ranges agree', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(2, 26)
        store.getState().addRowSubRange(5, 26)
        expect(overallScope(store.getState().selection)).toBe('row')
    })
})
