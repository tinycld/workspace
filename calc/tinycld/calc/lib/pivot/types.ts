// Engine-internal types. Public types (PivotDefinition, PivotField, etc.)
// live in lib/workbook-types.ts so the server-side DTO mirror stays
// colocated with the wire shape.

import type { CellValue } from '../workbook-types'

// SourceTable is the engine's read-side view of the source data range:
// row 1 of the rectangle becomes `headers`, rows 2..N become `rows`
// keyed by header string. Cells outside the rectangle are not read.
export interface SourceTable {
    headers: string[]
    rows: Array<Record<string, CellValue>>
}

// GroupedTree is the aggregator's output: per-(rowKey, colKey) cell
// aggregations plus subtotals and grand totals. Each "cell" carries
// one number per value field in the definition's `values` order.
//
// Keys are JSON-encoded tuples (string[]). The empty tuple is the
// "no row/col fields" case — there's exactly one rowKey and one
// colKey, both `[]`, and cells map [] -> [] -> per-value totals.
export interface GroupedTree {
    rowKeys: string[][]
    colKeys: string[][]
    cells: Map<string, Map<string, number[]>>
    rowTotals: Map<string, number[]>
    colTotals: Map<string, number[]>
    grandTotals: number[]
}

// RenderedPivot is the laid-out 2D grid the grid binding consumes.
// Cells are keyed by "row:col" (1-based), matching the shape
// WorksheetModel.cells uses.
//
// headerRowCount / headerColCount are passed through to Grid.tsx so
// the pivot sheet auto-freezes its header bands.
export interface RenderedPivot {
    rows: number
    cols: number
    cells: Map<string, CellValue>
    headerRowCount: number
    headerColCount: number
}

// PivotError is the discriminated-union failure result returned by
// computePivot. The grid binding maps each `code` onto a banner with
// a recovery action.
export type PivotErrorCode =
    | 'missing-source-sheet'
    | 'malformed-range'
    | 'duplicate-headers'
    | 'zero-data-rows'
    | 'no-values'

export interface PivotError {
    ok: false
    code: PivotErrorCode
    message: string
}

export function pivotError(
    code: PivotErrorCode,
    message: string
): PivotError {
    return { ok: false, code, message }
}

// Result wrappers — engine internals use Result<T, PivotError> so
// errors flow without try/catch.
export type Ok<T> = { ok: true; value: T }
export type Result<T> = Ok<T> | PivotError

export function ok<T>(value: T): Ok<T> {
    return { ok: true, value }
}
