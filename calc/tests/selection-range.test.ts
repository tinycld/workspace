import { describe, expect, it } from 'vitest'
import {
    allRanges,
    clampSubRangesForDelete,
    computeShiftArrowTarget,
    containsAny,
    forEachCellInRange,
    forEachCellInSelection,
    isDisjoint,
    overallScope,
    primaryAnchor,
    primaryRange,
    rangeCellCount,
    rangeContainsCell,
    type Selection,
    shiftSubRangesForInsert,
    singleCellSelection,
    singleRectSelection,
    subRangeAtCell,
    unionBoundingBox,
} from '../tinycld/calc/lib/selection-range'

// Selection helpers are dependency-free utilities used by the toolbar
// callbacks, the cell context menu, and the grid store. The contract
// pinned here is what the rest of the multi-select machinery assumes
// (always normalized, single-cell ranges allowed, end-inclusive).

describe('rangeContainsCell', () => {
    it('includes both endpoints (inclusive bounds)', () => {
        const range = { startRow: 2, startCol: 3, endRow: 4, endCol: 5 }
        expect(rangeContainsCell(range, 2, 3)).toBe(true)
        expect(rangeContainsCell(range, 4, 5)).toBe(true)
    })

    it('rejects coordinates outside the range', () => {
        const range = { startRow: 2, startCol: 3, endRow: 4, endCol: 5 }
        expect(rangeContainsCell(range, 1, 4)).toBe(false)
        expect(rangeContainsCell(range, 5, 4)).toBe(false)
        expect(rangeContainsCell(range, 3, 2)).toBe(false)
        expect(rangeContainsCell(range, 3, 6)).toBe(false)
    })

    it('treats a single-cell range as containing only that cell', () => {
        const range = { startRow: 7, startCol: 8, endRow: 7, endCol: 8 }
        expect(rangeContainsCell(range, 7, 8)).toBe(true)
        expect(rangeContainsCell(range, 7, 9)).toBe(false)
    })
})

describe('rangeCellCount', () => {
    it('counts both endpoints (single cell = 1)', () => {
        expect(rangeCellCount({ startRow: 3, startCol: 4, endRow: 3, endCol: 4 })).toBe(1)
    })

    it('multiplies width by height', () => {
        expect(rangeCellCount({ startRow: 1, startCol: 1, endRow: 3, endCol: 4 })).toBe(12)
    })
})

describe('forEachCellInRange', () => {
    it('visits every cell in row-major order', () => {
        const visits: [number, number][] = []
        forEachCellInRange({ startRow: 1, startCol: 1, endRow: 2, endCol: 3 }, (r, c) => {
            visits.push([r, c])
        })
        expect(visits).toEqual([
            [1, 1],
            [1, 2],
            [1, 3],
            [2, 1],
            [2, 2],
            [2, 3],
        ])
    })

    it('visits a single cell once when range is degenerate', () => {
        const visits: [number, number][] = []
        forEachCellInRange({ startRow: 9, startCol: 7, endRow: 9, endCol: 7 }, (r, c) => {
            visits.push([r, c])
        })
        expect(visits).toEqual([[9, 7]])
    })
})

// Selection helpers --------------------------------------------------

describe('primaryAnchor', () => {
    it('returns null on null selection', () => {
        expect(primaryAnchor(null)).toBeNull()
    })

    it('returns the last sub-range anchor (single-rectangle case)', () => {
        const s = singleCellSelection({ row: 4, col: 5 })
        expect(primaryAnchor(s)).toEqual({ row: 4, col: 5 })
    })

    it('returns the last entry on disjoint — most-recent Ctrl-click', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 5, startCol: 5, endCol: 5 },
                    scope: 'cells',
                },
            ],
        }
        expect(primaryAnchor(s)).toEqual({ row: 5, col: 5 })
    })
})

describe('primaryRange', () => {
    it('returns null on empty selection', () => {
        expect(primaryRange(null)).toBeNull()
    })

    it('returns the last sub-range range', () => {
        const s = singleRectSelection(
            { row: 2, col: 3 },
            { startRow: 2, endRow: 5, startCol: 3, endCol: 7 }
        )
        expect(primaryRange(s)).toEqual({ startRow: 2, endRow: 5, startCol: 3, endCol: 7 })
    })
})

describe('allRanges', () => {
    it('returns [] on null selection', () => {
        expect(allRanges(null)).toEqual([])
    })

    it('returns every sub-range', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 6, startCol: 5, endCol: 6 },
                    scope: 'cells',
                },
            ],
        }
        expect(allRanges(s)).toEqual([
            { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
            { startRow: 5, endRow: 6, startCol: 5, endCol: 6 },
        ])
    })
})

describe('isDisjoint', () => {
    it('false on null', () => {
        expect(isDisjoint(null)).toBe(false)
    })

    it('false on single-rectangle', () => {
        expect(isDisjoint(singleCellSelection({ row: 1, col: 1 }))).toBe(false)
    })

    it('true on multi-range', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 5, startCol: 5, endCol: 5 },
                    scope: 'cells',
                },
            ],
        }
        expect(isDisjoint(s)).toBe(true)
    })
})

describe('containsAny', () => {
    it('false on null', () => {
        expect(containsAny(null, 1, 1)).toBe(false)
    })

    it('true when cell is inside any sub-range', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 6, startCol: 5, endCol: 6 },
                    scope: 'cells',
                },
            ],
        }
        expect(containsAny(s, 2, 1)).toBe(true)
        expect(containsAny(s, 5, 5)).toBe(true)
        expect(containsAny(s, 3, 3)).toBe(false)
    })
})

describe('subRangeAtCell', () => {
    it('returns the matching sub-range', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 6, startCol: 5, endCol: 6 },
                    scope: 'cells',
                },
            ],
        }
        const hit = subRangeAtCell(s, 6, 6)
        expect(hit?.anchor).toEqual({ row: 5, col: 5 })
    })

    it('returns null when no sub-range matches', () => {
        expect(subRangeAtCell(singleCellSelection({ row: 1, col: 1 }), 3, 3)).toBeNull()
    })
})

describe('overallScope', () => {
    it('cells when empty', () => {
        expect(overallScope(null)).toBe('cells')
    })

    it('matches the sole sub-range', () => {
        const s = singleRectSelection(
            { row: 1, col: 1 },
            { startRow: 1, endRow: 1, startCol: 1, endCol: 5 },
            'row'
        )
        expect(overallScope(s)).toBe('row')
    })

    it("returns 'mixed' when sub-ranges disagree", () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 5 },
                    scope: 'row',
                },
                {
                    anchor: { row: 1, col: 3 },
                    range: { startRow: 1, endRow: 5, startCol: 3, endCol: 3 },
                    scope: 'column',
                },
            ],
        }
        expect(overallScope(s)).toBe('mixed')
    })
})

describe('unionBoundingBox', () => {
    it('returns null on null', () => {
        expect(unionBoundingBox(null)).toBeNull()
    })

    it('returns the smallest enclosing rectangle', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 7, startCol: 5, endCol: 6 },
                    scope: 'cells',
                },
            ],
        }
        expect(unionBoundingBox(s)).toEqual({
            startRow: 1,
            endRow: 7,
            startCol: 1,
            endCol: 6,
        })
    })
})

describe('forEachCellInSelection', () => {
    it('visits every cell in every sub-range, in sub-range order', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 2 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 5 },
                    range: { startRow: 5, endRow: 5, startCol: 5, endCol: 5 },
                    scope: 'cells',
                },
            ],
        }
        const visits: [number, number][] = []
        forEachCellInSelection(s, (r, c) => visits.push([r, c]))
        expect(visits).toEqual([
            [1, 1],
            [1, 2],
            [5, 5],
        ])
    })
})

describe('shiftSubRangesForInsert', () => {
    it('shifts every sub-range that starts at-or-after the insertion', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 1 },
                    range: { startRow: 5, endRow: 6, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
            ],
        }
        const next = shiftSubRangesForInsert(s, 'row', 4, 2)
        expect(next?.ranges[0].range).toEqual({ startRow: 1, endRow: 2, startCol: 1, endCol: 1 })
        expect(next?.ranges[1].range).toEqual({ startRow: 7, endRow: 8, startCol: 1, endCol: 1 })
        expect(next?.ranges[1].anchor).toEqual({ row: 7, col: 1 })
    })
})

describe('clampSubRangesForDelete', () => {
    it('clamps rows past the deletion site', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 10, col: 1 },
                    range: { startRow: 10, endRow: 11, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
            ],
        }
        // Delete 2 rows starting at row 5, new total = 18.
        const next = clampSubRangesForDelete(s, 'row', 5, 2, 18)
        expect(next?.ranges[0].range).toEqual({
            startRow: 8,
            endRow: 9,
            startCol: 1,
            endCol: 1,
        })
        expect(next?.ranges[0].anchor).toEqual({ row: 8, col: 1 })
    })

    it('drops sub-ranges entirely outside the new bounds', () => {
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 10, col: 1 },
                    range: { startRow: 10, endRow: 11, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
            ],
        }
        // Delete rows from 5..9999 — clamps to within new bounds.
        // The second sub-range's range collapses; should drop.
        const next = clampSubRangesForDelete(s, 'row', 5, 100, 4)
        expect(next?.ranges).toHaveLength(1)
        expect(next?.ranges[0].range.startRow).toBe(1)
    })

    it('returns null when every sub-range was dropped', () => {
        const s = singleRectSelection(
            { row: 50, col: 50 },
            { startRow: 50, endRow: 51, startCol: 50, endCol: 50 }
        )
        const next = clampSubRangesForDelete(s, 'row', 1, 100, 5)
        expect(next).toBeNull()
    })
})

describe('computeShiftArrowTarget', () => {
    // Shift+arrow grows or shrinks the active sub-range's far corner
    // (the corner opposite the anchor) by one cell. The store's
    // extendActiveRangeTo then rewrites the range from anchor to the
    // returned cell. Single-rectangle and disjoint cases share the
    // same code path — only the *active* (last) sub-range matters.

    it('extends a single-cell selection down by one cell', () => {
        const s = singleCellSelection({ row: 3, col: 2 })
        expect(computeShiftArrowTarget(s, 'down', 3, 2, 100, 26)).toEqual({ row: 4, col: 2 })
    })

    it('extends a single-cell selection right by one cell', () => {
        const s = singleCellSelection({ row: 3, col: 2 })
        expect(computeShiftArrowTarget(s, 'right', 3, 2, 100, 26)).toEqual({ row: 3, col: 3 })
    })

    it('grows the far-corner row when arrow matches the existing extension axis', () => {
        // anchor B3, range B3:B5 → far corner row=5. Shift+Down → row 6.
        const s = singleRectSelection(
            { row: 3, col: 2 },
            { startRow: 3, endRow: 5, startCol: 2, endCol: 2 }
        )
        expect(computeShiftArrowTarget(s, 'down', 3, 2, 100, 26)).toEqual({ row: 6, col: 2 })
    })

    it('shrinks the far-corner row when arrow points back toward the anchor', () => {
        // anchor B3, range B3:B5 → Shift+Up: far corner row 5 → 4. Range
        // ends up B3:B4 after extendActiveRangeTo consumes the target.
        const s = singleRectSelection(
            { row: 3, col: 2 },
            { startRow: 3, endRow: 5, startCol: 2, endCol: 2 }
        )
        expect(computeShiftArrowTarget(s, 'up', 3, 2, 100, 26)).toEqual({ row: 4, col: 2 })
    })

    it('flips the far corner past the anchor onto the other side', () => {
        // anchor B3, range B3:B3 → Shift+Up: far corner row 3 → 2. Range
        // ends up B2:B3 with anchor still at B3.
        const s = singleCellSelection({ row: 3, col: 2 })
        expect(computeShiftArrowTarget(s, 'up', 3, 2, 100, 26)).toEqual({ row: 2, col: 2 })
    })

    it('uses the active (last) sub-range on a disjoint selection', () => {
        // First sub-range anchor A1:A1; second (active) anchor C5 range
        // C5:E7. Shift+Right should move the active far corner col 5→6.
        const s: Selection = {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
                {
                    anchor: { row: 5, col: 3 },
                    range: { startRow: 5, endRow: 7, startCol: 3, endCol: 5 },
                    scope: 'cells',
                },
            ],
        }
        expect(computeShiftArrowTarget(s, 'right', 9, 9, 100, 26)).toEqual({ row: 7, col: 6 })
    })

    it('falls back to the focused cell when nothing is selected', () => {
        expect(computeShiftArrowTarget(null, 'down', 3, 2, 100, 26)).toEqual({ row: 4, col: 2 })
    })

    it('clamps at row 1 / col 1 — Shift+Up at the top stays in-bounds', () => {
        const s = singleCellSelection({ row: 1, col: 1 })
        expect(computeShiftArrowTarget(s, 'up', 1, 1, 100, 26)).toEqual({ row: 1, col: 1 })
        expect(computeShiftArrowTarget(s, 'left', 1, 1, 100, 26)).toEqual({ row: 1, col: 1 })
    })

    it('clamps at the sheet bottom / right edge', () => {
        const s = singleCellSelection({ row: 100, col: 26 })
        expect(computeShiftArrowTarget(s, 'down', 100, 26, 100, 26)).toEqual({ row: 100, col: 26 })
        expect(computeShiftArrowTarget(s, 'right', 100, 26, 100, 26)).toEqual({
            row: 100,
            col: 26,
        })
    })
})
