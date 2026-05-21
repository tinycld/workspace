import { describe, expect, it } from 'vitest'
import { computePivot } from '../tinycld/calc/lib/pivot'
import type { CellValue, PivotDefinition } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'

function str(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}
function num(n: number): CellValue {
    return { kind: 'number', raw: n, display: String(n) }
}

function makeCells(sheetId: string, rows: CellValue[][]): Map<string, CellValue> {
    const m = new Map<string, CellValue>()
    rows.forEach((row, r) =>
        row.forEach((c, i) => m.set(yCellKey(sheetId, r + 1, i + 1), c))
    )
    return m
}

function defOf(partial: Partial<PivotDefinition>): PivotDefinition {
    return {
        id: 'p',
        sourceRange: 'Sheet1!A1:C3',
        targetSheetName: 'P',
        rows: [],
        cols: [],
        values: [],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...partial,
    }
}

describe('computePivot — happy path', () => {
    it('returns a RenderedPivot for a valid def + source', () => {
        const cells = makeCells('s1', [
            [str('Region'), str('Year'), str('Sales')],
            [str('East'), num(2024), num(10)],
            [str('West'), num(2024), num(5)],
        ])
        const out = computePivot(
            defOf({
                rows: [{ sourceColumn: 'Region' }],
                cols: [{ sourceColumn: 'Year' }],
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            }),
            cells,
            { Sheet1: 's1' }
        )
        expect(out.ok).toBe(true)
        if (out.ok) expect(out.value.rows).toBeGreaterThan(0)
    })
})

describe('computePivot — errors', () => {
    it('surfaces missing-source-sheet', () => {
        const out = computePivot(
            defOf({
                sourceRange: 'Missing!A1:B2',
                values: [{ sourceColumn: 'X', aggregation: 'sum' }],
            }),
            new Map(),
            { Sheet1: 's1' }
        )
        expect(out.ok).toBe(false)
        if (!out.ok) expect(out.code).toBe('missing-source-sheet')
    })

    it('surfaces malformed-range', () => {
        const out = computePivot(
            defOf({
                sourceRange: 'not a range',
                values: [{ sourceColumn: 'X', aggregation: 'sum' }],
            }),
            new Map(),
            { Sheet1: 's1' }
        )
        expect(out.ok).toBe(false)
        if (!out.ok) expect(out.code).toBe('malformed-range')
    })

    it('surfaces zero-data-rows', () => {
        const cells = makeCells('s1', [[str('A'), str('B')]])
        const out = computePivot(
            defOf({
                sourceRange: 'Sheet1!A1:B1',
                values: [{ sourceColumn: 'A', aggregation: 'sum' }],
            }),
            cells,
            { Sheet1: 's1' }
        )
        expect(out.ok).toBe(false)
        if (!out.ok) expect(out.code).toBe('zero-data-rows')
    })

    it('surfaces no-values when def.values is empty', () => {
        const cells = makeCells('s1', [
            [str('Region')],
            [str('East')],
            [str('West')],
        ])
        const out = computePivot(
            defOf({
                sourceRange: 'Sheet1!A1:A3',
                rows: [{ sourceColumn: 'Region' }],
                values: [],
            }),
            cells,
            { Sheet1: 's1' }
        )
        expect(out.ok).toBe(false)
        if (!out.ok) expect(out.code).toBe('no-values')
    })
})
