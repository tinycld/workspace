// Pure helpers for the pivot field-row components (FieldRow.tsx,
// ValueFieldRow.tsx, FilterFieldRow.tsx). Lives in its own .ts module
// so vitest can exercise the logic without dragging react-native into
// the test transform — same pattern as pivot-banner-lines.ts and
// pivot-grid-view-state.ts.
//
// The .tsx components stay thin: presentation only. Anything with a
// branch, a set operation, or a slice belongs here.

import type { PivotAggregation } from '../../lib/workbook-types'

// Canonical ordering for the aggregation picker. Matches the
// PivotAggregation union in workbook-types.ts and the VALID_AGGS set
// in y-binding.ts — keep them in lockstep so the picker can't surface
// an aggregation the y-binding would reject on round-trip.
export const PIVOT_AGGREGATIONS: readonly PivotAggregation[] = [
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

// Cap on the number of filter values shown before the "Show all" toggle
// kicks in. Pulled out so the threshold is configurable in one place
// and the visible-values helper can be tested without rendering RN.
export const FILTER_VALUES_PREVIEW_LIMIT = 12

// Toggle membership of a single value inside the selection set. The
// FilterFieldRow component owns the selected[] array (it comes from
// PivotDefinition.filterSelections), and this helper produces the
// next-state array without mutating the input. Order of the returned
// array matches insertion order via Set semantics — callers that need
// stable sorting should sort the result themselves.
export function toggleFilterSelection(
    selected: readonly string[],
    value: string
): string[] {
    const next = new Set(selected)
    if (next.has(value)) {
        next.delete(value)
    } else {
        next.add(value)
    }
    return Array.from(next)
}

// Compute the visible slice of distinct values for the filter chip
// list. When `showAll` is true the full array is returned; otherwise
// the first FILTER_VALUES_PREVIEW_LIMIT are shown. Returning a
// readonly array keeps callers from mutating the upstream
// distinctValues prop.
export function visibleFilterValues(
    distinctValues: readonly string[],
    showAll: boolean
): readonly string[] {
    if (showAll) return distinctValues
    return distinctValues.slice(0, FILTER_VALUES_PREVIEW_LIMIT)
}

// Whether the "Show all" toggle should be rendered. Hidden when the
// distinct-value count fits in one screenful — there's no value in a
// no-op button.
export function shouldShowAllToggle(
    distinctValues: readonly string[]
): boolean {
    return distinctValues.length > FILTER_VALUES_PREVIEW_LIMIT
}

// Label for the filter-summary line ("All values" vs "N selected").
// Pulled out so the wording lives next to the threshold logic — if
// design changes "5 selected" -> "Filtering 5 values", one edit covers
// the wording and the test for it.
export function filterSummaryLabel(selected: readonly string[]): string {
    if (selected.length === 0) return 'All values'
    return `${selected.length} selected`
}

// Display label for a single filter value. Blank strings (which can
// come from a blank cell in the source range) get the "(blank)"
// placeholder so the chip isn't an invisible click target.
export function filterValueLabel(value: string): string {
    if (value === '') return '(blank)'
    return value
}

// Label for the show-all toggle, switching between expand/collapse
// states. The expanded label includes the total count so the user
// knows the cost of expanding before they commit.
export function showAllToggleLabel(
    showAll: boolean,
    total: number
): string {
    if (showAll) return 'Show fewer'
    return `Show all (${total})`
}
