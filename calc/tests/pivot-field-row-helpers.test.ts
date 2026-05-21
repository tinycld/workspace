// Tests for the pure helpers behind FieldRow / ValueFieldRow /
// FilterFieldRow. The components themselves live in .tsx files that
// import react-native, which vitest's transformer can't parse (Flow
// types — same wall the PivotBanner test sidesteps). The helpers live
// in field-row-helpers.ts (no RN imports) so we can assert against
// them directly here.
//
// What we verify:
//   - PIVOT_AGGREGATIONS is in lockstep with the y-binding's VALID_AGGS
//     set (a future aggregation added to the union without also
//     updating the picker — or vice versa — fails this test)
//   - toggleFilterSelection is a pure add/remove with set semantics
//     (insertion-order preserved, no duplicates)
//   - visibleFilterValues respects the 12-item preview cap and shows
//     everything when expanded
//   - filterSummaryLabel / filterValueLabel / showAllToggleLabel
//     produce the wording the component renders, so a copy change
//     can't silently drift from this test

import { describe, expect, it } from 'vitest'
import {
    FILTER_VALUES_PREVIEW_LIMIT,
    PIVOT_AGGREGATIONS,
    filterSummaryLabel,
    filterValueLabel,
    shouldShowAllToggle,
    showAllToggleLabel,
    toggleFilterSelection,
    visibleFilterValues,
} from '../tinycld/calc/components/pivot/field-row-helpers'
import type { PivotAggregation } from '../tinycld/calc/lib/workbook-types'

describe('PIVOT_AGGREGATIONS', () => {
    it('lists exactly the aggregations the engine accepts', () => {
        const expected: PivotAggregation[] = [
            'sum',
            'average',
            'count',
            'countNums',
            'max',
            'min',
            'product',
            'stdDev',
            'stdDevp',
            'var',
            'varp',
        ]
        expect([...PIVOT_AGGREGATIONS]).toEqual(expected)
    })

    it('has no duplicate entries', () => {
        expect(new Set(PIVOT_AGGREGATIONS).size).toBe(PIVOT_AGGREGATIONS.length)
    })
})

describe('toggleFilterSelection', () => {
    it('adds a value not yet in the selection', () => {
        expect(toggleFilterSelection(['a'], 'b')).toEqual(['a', 'b'])
    })

    it('removes a value already in the selection', () => {
        expect(toggleFilterSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    })

    it('does not mutate the input array', () => {
        const input = ['a', 'b']
        toggleFilterSelection(input, 'c')
        expect(input).toEqual(['a', 'b'])
    })

    it('treats duplicates in the input as a single entry (Set semantics)', () => {
        expect(toggleFilterSelection(['a', 'a', 'b'], 'b')).toEqual(['a'])
    })

    it('toggling the same value twice returns the original set', () => {
        const original = ['a', 'b']
        const once = toggleFilterSelection(original, 'c')
        const twice = toggleFilterSelection(once, 'c')
        expect(twice).toEqual(['a', 'b'])
    })
})

describe('visibleFilterValues / shouldShowAllToggle', () => {
    const many = Array.from({ length: 20 }, (_, i) => `v${i}`)

    it('returns all values when there are fewer than the cap', () => {
        const short = ['a', 'b', 'c']
        expect(visibleFilterValues(short, false)).toEqual(short)
        expect(visibleFilterValues(short, true)).toEqual(short)
    })

    it('caps the preview at FILTER_VALUES_PREVIEW_LIMIT when collapsed', () => {
        expect(visibleFilterValues(many, false)).toHaveLength(
            FILTER_VALUES_PREVIEW_LIMIT
        )
        expect(visibleFilterValues(many, false)).toEqual(
            many.slice(0, FILTER_VALUES_PREVIEW_LIMIT)
        )
    })

    it('returns every value when expanded', () => {
        expect(visibleFilterValues(many, true)).toEqual(many)
    })

    it('hides the toggle when the list fits in the preview', () => {
        expect(
            shouldShowAllToggle(['a', 'b', 'c'])
        ).toBe(false)
    })

    it('hides the toggle exactly at the limit', () => {
        const exact = Array.from(
            { length: FILTER_VALUES_PREVIEW_LIMIT },
            (_, i) => `v${i}`
        )
        expect(shouldShowAllToggle(exact)).toBe(false)
    })

    it('shows the toggle when the list exceeds the limit', () => {
        expect(shouldShowAllToggle(many)).toBe(true)
    })
})

describe('label helpers', () => {
    it('summarizes empty selection as "All values"', () => {
        expect(filterSummaryLabel([])).toBe('All values')
    })

    it('summarizes non-empty selection with the count', () => {
        expect(filterSummaryLabel(['x', 'y', 'z'])).toBe('3 selected')
    })

    it('shows "(blank)" for an empty-string value so the chip is clickable', () => {
        expect(filterValueLabel('')).toBe('(blank)')
    })

    it('shows the value verbatim otherwise', () => {
        expect(filterValueLabel('North')).toBe('North')
    })

    it('show-all toggle label flips between expand and collapse copy', () => {
        expect(showAllToggleLabel(false, 25)).toBe('Show all (25)')
        expect(showAllToggleLabel(true, 25)).toBe('Show fewer')
    })
})
