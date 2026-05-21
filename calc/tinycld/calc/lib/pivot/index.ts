// Public entry point for the pivot engine. Composes
// readSourceTable -> aggregate -> renderPivot, returning a
// discriminated-union result so the grid binding can render
// PivotError banners without try/catch.

import type { CellValue, PivotDefinition } from '../workbook-types'
import { aggregate } from './aggregate'
import { renderPivot } from './render'
import { readSourceTable } from './source-read'
import { ok, pivotError, type RenderedPivot, type Result } from './types'

export type { PivotError, PivotErrorCode, RenderedPivot } from './types'

export function computePivot(
    def: PivotDefinition,
    cells: ReadonlyMap<string, CellValue>,
    sheetIdByName: Readonly<Record<string, string>>
): Result<RenderedPivot> {
    if (def.values.length === 0) {
        return pivotError(
            'no-values',
            'Pivot has no value fields. Add a value field to see results.'
        )
    }
    const table = readSourceTable(def.sourceRange, cells, sheetIdByName)
    if (!table.ok) return table
    const tree = aggregate(table.value, def)
    const rendered = renderPivot(tree, def)
    return ok(rendered)
}
