// Pure helpers behind PivotSidePanel. The panel itself (.tsx) imports
// react-native, which vitest's transformer can't parse during the
// import phase (Flow types) — the same wall the PivotBanner test
// sidesteps. Anything with a branch, a loop, or a Y.Doc read lives
// here so vitest can exercise it directly without rendering RN.
//
// Two pieces of logic live here:
//   1. readSourceMetadata — walk the source range out of the Y.Doc and
//      produce (a) the headers from row 1 and (b) a per-column distinct
//      values list (capped) for filter chip rendering.
//   2. canMoveUp / canMoveDown — trivial edge predicates the four
//      slots all share. Inlining them in JSX would force a comparison
//      against `def[slot].length - 1` inside the return statement,
//      which CLAUDE.md rules out (no calculations inside JSX).

import * as Y from 'yjs'
import type { PivotDefinition } from '../../lib/workbook-types'
import { parseA1Range } from '../../lib/pivot/range-parse'
import {
    CELLS_MAP,
    SHEETS_MAP,
    readYCell,
} from '../../lib/y-doc-bootstrap'
import { yCellKey } from '../../lib/y-cell-key'

// Cap on the number of distinct filter values we extract per source
// column. The FilterFieldRow already paginates the visible chips (see
// FILTER_VALUES_PREVIEW_LIMIT in field-row-helpers.ts); this cap is a
// secondary guard against extracting millions of unique values out of
// a wide source table. 200 is enough headroom for any realistic
// categorical column and bounds the worst-case scan length.
export const PIVOT_SOURCE_DISTINCT_CAP = 200

export interface PivotSourceMetadata {
    headers: string[]
    distinctByColumn: Record<string, string[]>
}

// Read the headers (row 1 of the source range) and a per-column
// distinct-values list out of the Y.Doc. Returns empty results — not
// an error — when the range is malformed or the source sheet is
// missing, because the PivotSidePanel renders alongside a PivotBanner
// that already surfaces the same engine error to the user.
//
// The "headers" array uses `raw ?? display` so numeric headers
// (e.g. the cell value 2024) come through as "2024", matching what
// the rest of the pivot pipeline expects from source-read.ts. Blank
// headers are kept in place rather than dropped, so column ordering
// from FieldList stays aligned with source-column indices.
export function readSourceMetadata(
    doc: Y.Doc,
    def: PivotDefinition
): PivotSourceMetadata {
    const parsed = parseA1Range(def.sourceRange)
    if (!parsed.ok) return { headers: [], distinctByColumn: {} }

    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const sheetId = findSheetIdByName(sheetsMap, parsed.sheetName)
    if (sheetId == null) return { headers: [], distinctByColumn: {} }

    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    const headers: string[] = []
    for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        headers.push(
            readHeaderCell(cellsMap, sheetId, parsed.startRow, c)
        )
    }

    const distinctByColumn: Record<string, string[]> = {}
    for (let i = 0; i < headers.length; i++) {
        const colIdx = parsed.startCol + i
        distinctByColumn[headers[i]] = readDistinctValues(
            cellsMap,
            sheetId,
            colIdx,
            parsed.startRow + 1,
            parsed.endRow
        )
    }
    return { headers, distinctByColumn }
}

function findSheetIdByName(
    sheetsMap: Y.Map<Y.Map<unknown>>,
    name: string
): string | null {
    let found: string | null = null
    sheetsMap.forEach((meta, id) => {
        if (found != null || !(meta instanceof Y.Map)) return
        if (meta.get('name') === name) found = id
    })
    return found
}

function readHeaderCell(
    cellsMap: Y.Map<Y.Map<unknown>>,
    sheetId: string,
    row: number,
    col: number
): string {
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (!(cell instanceof Y.Map)) return ''
    const v = readYCell(cell)
    return String(v.raw ?? v.display ?? '')
}

function readDistinctValues(
    cellsMap: Y.Map<Y.Map<unknown>>,
    sheetId: string,
    col: number,
    startRow: number,
    endRow: number
): string[] {
    const seen = new Set<string>()
    for (let r = startRow; r <= endRow && seen.size < PIVOT_SOURCE_DISTINCT_CAP; r++) {
        const cell = cellsMap.get(yCellKey(sheetId, r, col))
        if (!(cell instanceof Y.Map)) continue
        const v = readYCell(cell)
        seen.add(String(v.raw ?? v.display ?? ''))
    }
    return Array.from(seen).sort()
}

// Edge predicates for the move-up / move-down chevrons on field rows.
// Trivial enough that inlining them in JSX would be tolerable, but
// CLAUDE.md draws the line at "no calculations inside JSX" and four
// nearly-identical FieldSlot blocks make the difference visible.
export function canMoveUp(index: number): boolean {
    return index > 0
}

export function canMoveDown(index: number, listLength: number): boolean {
    return index < listLength - 1
}
