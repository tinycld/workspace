// Pure decision helper for PivotGrid. Maps a PivotDefinition plus the
// engine result onto one of three view states (empty / error / grid)
// so the component body stays a thin renderer and the routing logic
// is testable without mounting React Native.
//
// Lives in its own .ts module (no react-native imports) so vitest can
// exercise it directly. The component file (PivotGrid.tsx) consumes
// this helper to pick between PivotEmptyState, PivotBanner, and the
// grid-cell renderer — the helper owns the decision, the .tsx owns
// the JSX.

import type { PivotDefinition } from '../../lib/workbook-types'
import type { RenderedPivotResult } from '../../hooks/use-rendered-pivot'

export type PivotGridViewState =
    | { kind: 'empty' }
    | { kind: 'error'; error: Extract<RenderedPivotResult, { ok: false }> }
    | {
          kind: 'grid'
          rendered: Extract<RenderedPivotResult, { ok: true }>['value']
      }

// "Empty" means the user has created the pivot but hasn't dragged any
// field into rows/cols/values yet. We surface a configure-your-pivot
// CTA in that state instead of an engine error. Filter-only defs still
// count as empty — without a value field, there's nothing to compute.
export function isPivotDefinitionEmpty(def: PivotDefinition): boolean {
    return (
        def.rows.length === 0 &&
        def.cols.length === 0 &&
        def.values.length === 0
    )
}

export function selectPivotGridViewState(
    def: PivotDefinition,
    result: RenderedPivotResult
): PivotGridViewState {
    if (isPivotDefinitionEmpty(def)) return { kind: 'empty' }
    if (!result.ok) return { kind: 'error', error: result }
    return { kind: 'grid', rendered: result.value }
}

// Pure cell-iteration helper. The grid's body is a 1..rows x 1..cols
// loop pulling out engine cells and deciding whether each falls inside
// the header band. Extracted so the loop bounds + isHeader logic can be
// unit-tested without rendering React Native primitives.
export interface PivotGridCellMeta {
    row: number
    col: number
    display: string
    isHeader: boolean
}

export function buildPivotGridCellMatrix(
    rendered: Extract<RenderedPivotResult, { ok: true }>['value']
): PivotGridCellMeta[][] {
    const rows: PivotGridCellMeta[][] = []
    for (let r = 1; r <= rendered.rows; r++) {
        const row: PivotGridCellMeta[] = []
        for (let c = 1; c <= rendered.cols; c++) {
            const cell = rendered.cells.get(`${r}:${c}`)
            const isHeader =
                r <= rendered.headerRowCount || c <= rendered.headerColCount
            row.push({
                row: r,
                col: c,
                display: cell?.display ?? '',
                isHeader,
            })
        }
        rows.push(row)
    }
    return rows
}

// True when the pivot side panel should mount alongside this sheet's
// PivotGrid. The store keys by sheet id (not pivot id) because that's
// what Grid.tsx already passes through when opening, and because the
// same pivot definition might in principle be reused across sheets in
// a future feature — the per-sheet keying keeps each grid's panel
// state independent. Extracted so PivotGrid stays a thin renderer and
// the conditional logic is testable without RN.
export function selectPivotPanelOpen(
    openForSheetId: string | null,
    sheetId: string
): boolean {
    return openForSheetId != null && openForSheetId === sheetId
}
