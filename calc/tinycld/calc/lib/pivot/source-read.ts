// Read a source-cell snapshot into a SourceTable. Pure function:
// takes a plain Map keyed by yCellKey(sheetId, row, col), a
// sheet-name -> sheet-id lookup, and the A1 source range; returns
// either a populated SourceTable or a typed error.

import type { CellValue } from '../workbook-types'
import { yCellKey } from '../y-cell-key'
import { parseA1Range } from './range-parse'
import { pivotError, type Result, ok, type SourceTable } from './types'

const EMPTY_CELL: CellValue = { kind: 'string', raw: null, display: '' }

export function readSourceTable(
    a1: string,
    cells: ReadonlyMap<string, CellValue>,
    sheetIdByName: Readonly<Record<string, string>>
): Result<SourceTable> {
    const parsed = parseA1Range(a1)
    if (!parsed.ok) {
        return pivotError(
            'malformed-range',
            `Source range "${a1}" is not a valid A1 range.`
        )
    }
    const sheetId = sheetIdByName[parsed.sheetName]
    if (sheetId == null) {
        return pivotError(
            'missing-source-sheet',
            `Source sheet "${parsed.sheetName}" was not found.`
        )
    }

    const headers: string[] = []
    for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        const cell = cells.get(yCellKey(sheetId, parsed.startRow, c))
        headers.push(cell != null ? String(cell.raw ?? cell.display ?? '') : '')
    }
    const duplicate = findDuplicateNonEmpty(headers)
    if (duplicate != null) {
        return pivotError(
            'duplicate-headers',
            `Header "${duplicate}" appears more than once in the first row of ${a1}.`
        )
    }

    const rows: Array<Record<string, CellValue>> = []
    for (let r = parsed.startRow + 1; r <= parsed.endRow; r++) {
        const row: Record<string, CellValue> = {}
        for (let i = 0; i < headers.length; i++) {
            const c = parsed.startCol + i
            const cell = cells.get(yCellKey(sheetId, r, c))
            row[headers[i]] = cell ?? EMPTY_CELL
        }
        rows.push(row)
    }
    if (rows.length === 0) {
        return pivotError(
            'zero-data-rows',
            `Source range ${a1} has no data rows (header row only).`
        )
    }

    return ok({ headers, rows })
}

function findDuplicateNonEmpty(headers: string[]): string | null {
    const seen = new Set<string>()
    for (const h of headers) {
        if (h === '') continue
        if (seen.has(h)) return h
        seen.add(h)
    }
    return null
}
