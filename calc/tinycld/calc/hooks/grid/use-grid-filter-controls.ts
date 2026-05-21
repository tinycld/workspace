import { useCallback, useMemo } from 'react'
import type * as Y from 'yjs'
import { MIN_COLS, MIN_ROWS } from '../../components/grid/constants'
import {
    applyValuesFilterFromSelection,
    clearFilter,
    type FilterCriterion,
    type FilterDefinition,
    removeColumnCriterion,
    upsertColumnCriterion,
} from '../../lib/filter'
import { isDisjoint, primaryRange } from '../../lib/selection-range'
import type { GridStoreApi } from '../grid-store'
import { useFilterView } from '../use-filter-view'
import { useYSheets } from '../use-y-sheets'

export interface GridFilterControls {
    filterView: FilterDefinition | null
    filterRange: FilterDefinition['range'] | null
    activeFilterCols: Set<number>
    isFilterActive: boolean
    toggleFilter: () => void
    applyHeaderCriterion: (col: number, criterion: FilterCriterion) => void
    removeHeaderCriterion: (col: number) => void
}

interface UseGridFilterControlsArgs {
    doc: Y.Doc | null
    sheetId: string
    store: GridStoreApi
}

// Reads the persistent filter view (yjs-backed sheet metadata) and
// derives the toolbar's "filter active" state plus the per-column
// active set the column header uses to paint its active-filter
// indicator. toggleFilter creates a values-filter from the current
// selection when none is set, otherwise clears the existing one.
// applyHeaderCriterion / removeHeaderCriterion drive the per-column
// header modal flow.
export function useGridFilterControls({
    doc,
    sheetId,
    store,
}: UseGridFilterControlsArgs): GridFilterControls {
    const filterView = useFilterView(doc, sheetId)
    const filterRange = filterView?.range ?? null
    const sheets = useYSheets(doc)
    const sheet = sheets.find(s => s.id === sheetId)
    // The yjs metadata rowCount/colCount stay at 0 on a fresh sheet
    // even though Grid renders MIN_ROWS×MIN_COLS. Filters need to span
    // the displayed grid so writes into yet-untouched rows below the
    // criteria source are still subject to the hide rule.
    const rowCount = Math.max(sheet?.rowCount ?? 0, MIN_ROWS)
    const colCount = Math.max(sheet?.colCount ?? 0, MIN_COLS)
    const frozenRows = sheet?.frozenRows ?? 0

    const activeFilterCols = useMemo(() => {
        const set = new Set<number>()
        if (filterView != null) {
            for (const key of Object.keys(filterView.criteria)) {
                const c = Number(key)
                if (Number.isFinite(c)) set.add(c)
            }
        }
        return set
    }, [filterView])

    const toggleFilter = useCallback(() => {
        if (doc == null) return
        if (filterView != null) {
            clearFilter(doc, sheetId)
            return
        }
        const state = store.getState()
        // Filter views are a single contiguous rectangle on yjs
        // metadata — disjoint doesn't apply. The UI affordance hides
        // on disjoint (see CellContextMenu); this guard is defense in
        // depth.
        if (isDisjoint(state.selection)) return
        const range = primaryRange(state.selection)
        if (range == null) return
        applyValuesFilterFromSelection(doc, sheetId, range, rowCount, frozenRows)
    }, [doc, sheetId, store, filterView, rowCount, frozenRows])

    const applyHeaderCriterion = useCallback(
        (col: number, criterion: FilterCriterion) => {
            if (doc == null) return
            upsertColumnCriterion(doc, sheetId, col, criterion, rowCount, colCount, frozenRows)
        },
        [doc, sheetId, rowCount, colCount, frozenRows]
    )

    const removeHeaderCriterion = useCallback(
        (col: number) => {
            if (doc == null) return
            removeColumnCriterion(doc, sheetId, col, frozenRows)
        },
        [doc, sheetId, frozenRows]
    )

    return {
        filterView,
        filterRange,
        activeFilterCols,
        isFilterActive: filterView != null,
        toggleFilter,
        applyHeaderCriterion,
        removeHeaderCriterion,
    }
}
