import { describe, expect, it } from 'vitest'
import {
    type CellRange,
    createGridStore,
    type GridStoreDeps,
} from '../tinycld/calc/hooks/grid-store'
import { primaryAnchor, primaryRange } from '../tinycld/calc/lib/selection-range'

// The store delegates merge-aware selection logic to deps. These
// tests pin the contract: clicking a covered cell snaps the selection
// to the merge anchor, and shift-click extending the range expands
// over any merge it intersects.

interface FakeMerge {
    anchorRow: number
    anchorCol: number
    rowSpan: number
    colSpan: number
}

function rangesOverlap(a: CellRange, b: CellRange): boolean {
    return !(
        a.endRow < b.startRow ||
        a.startRow > b.endRow ||
        a.endCol < b.startCol ||
        a.startCol > b.endCol
    )
}

function makeDepsWithMerges(merges: FakeMerge[]): GridStoreDeps {
    return {
        readOnly: false,
        writeCell: () => {},
        focusActiveInput: () => {},
        applyStructuralMutation: () => {},
        applyFill: () => {},
        setFrozenRows: () => {},
        setFrozenCols: () => {},
        resolveMergeAnchor: (row, col) => {
            for (const m of merges) {
                if (
                    row >= m.anchorRow &&
                    row <= m.anchorRow + m.rowSpan - 1 &&
                    col >= m.anchorCol &&
                    col <= m.anchorCol + m.colSpan - 1
                ) {
                    return { row: m.anchorRow, col: m.anchorCol }
                }
            }
            return { row, col }
        },
        expandRangeOverMerges: range => {
            let startRow = Math.min(range.startRow, range.endRow)
            let endRow = Math.max(range.startRow, range.endRow)
            let startCol = Math.min(range.startCol, range.endCol)
            let endCol = Math.max(range.startCol, range.endCol)
            let changed = true
            while (changed) {
                changed = false
                for (const m of merges) {
                    const mRange: CellRange = {
                        startRow: m.anchorRow,
                        endRow: m.anchorRow + m.rowSpan - 1,
                        startCol: m.anchorCol,
                        endCol: m.anchorCol + m.colSpan - 1,
                    }
                    if (rangesOverlap({ startRow, endRow, startCol, endCol }, mRange)) {
                        if (mRange.startRow < startRow) {
                            startRow = mRange.startRow
                            changed = true
                        }
                        if (mRange.endRow > endRow) {
                            endRow = mRange.endRow
                            changed = true
                        }
                        if (mRange.startCol < startCol) {
                            startCol = mRange.startCol
                            changed = true
                        }
                        if (mRange.endCol > endCol) {
                            endCol = mRange.endCol
                            changed = true
                        }
                    }
                }
            }
            return { startRow, endRow, startCol, endCol }
        },
        findMergesInRange: () => [],
        mergeRange: () => {},
        unmergeAt: () => {},
    }
}

describe('grid-store merge-aware selection', () => {
    it('selectCell on a covered cell snaps to the merge anchor', () => {
        const deps = makeDepsWithMerges([
            { anchorRow: 2, anchorCol: 2, rowSpan: 3, colSpan: 3 },
        ])
        const store = createGridStore(deps)
        store.getState().selectCell({ row: 4, col: 4 })
        expect(primaryAnchor(store.getState().selection)).toEqual({ row: 2, col: 2 })
    })

    it('selectCell on a free cell stays put', () => {
        const deps = makeDepsWithMerges([
            { anchorRow: 2, anchorCol: 2, rowSpan: 3, colSpan: 3 },
        ])
        const store = createGridStore(deps)
        store.getState().selectCell({ row: 7, col: 7 })
        expect(primaryAnchor(store.getState().selection)).toEqual({ row: 7, col: 7 })
    })

    it('extendSelectionTo through a merge expands the range to fully contain it', () => {
        const deps = makeDepsWithMerges([
            { anchorRow: 4, anchorCol: 4, rowSpan: 3, colSpan: 3 },
        ])
        const store = createGridStore(deps)
        // Anchor at (1,1)
        store.getState().selectCell({ row: 1, col: 1 })
        // Shift-click to (5,5) — naive range would be (1..5, 1..5) but
        // it touches the merge anchored at (4,4) spanning to (6,6),
        // so it should grow to include the full merge.
        store.getState().extendActiveRangeTo({ row: 5, col: 5 })
        expect(primaryRange(store.getState().selection)).toEqual({
            startRow: 1,
            endRow: 6,
            startCol: 1,
            endCol: 6,
        })
    })

    it('extendSelectionTo on a non-touching range leaves it alone', () => {
        const deps = makeDepsWithMerges([
            { anchorRow: 4, anchorCol: 4, rowSpan: 3, colSpan: 3 },
        ])
        const store = createGridStore(deps)
        store.getState().selectCell({ row: 10, col: 10 })
        store.getState().extendActiveRangeTo({ row: 12, col: 12 })
        expect(primaryRange(store.getState().selection)).toEqual({
            startRow: 10,
            endRow: 12,
            startCol: 10,
            endCol: 12,
        })
    })
})
