import { describe, expect, it } from 'vitest'
import { aggregate } from '../tinycld/calc/lib/pivot/aggregate'
import { renderPivot } from '../tinycld/calc/lib/pivot/render'
import type { SourceTable } from '../tinycld/calc/lib/pivot/types'
import type { CellValue, PivotDefinition } from '../tinycld/calc/lib/workbook-types'

function str(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}
function num(n: number): CellValue {
    return { kind: 'number', raw: n, display: String(n) }
}
function table(headers: string[], rows: CellValue[][]): SourceTable {
    return {
        headers,
        rows: rows.map((r) => {
            const o: Record<string, CellValue> = {}
            headers.forEach((h, i) => {
                o[h] = r[i]
            })
            return o
        }),
    }
}
function baseDef(overrides: Partial<PivotDefinition>): PivotDefinition {
    return {
        id: 'p',
        sourceRange: 'X!A1:A1',
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
        ...overrides,
    }
}
function pick(cells: Map<string, CellValue>, r: number, c: number) {
    return cells.get(`${r}:${c}`)
}

describe('renderPivot — minimal layout', () => {
    it('renders rows x cols x one value with grand totals', () => {
        const t = table(
            ['Region', 'Year', 'Sales'],
            [
                [str('East'), num(2024), num(10)],
                [str('East'), num(2025), num(20)],
                [str('West'), num(2024), num(5)],
            ]
        )
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            cols: [{ sourceColumn: 'Year' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Layout for this case:
        //   row 1: [ "", 2024, 2025, "Grand Total" ]
        //   row 2: [ "East", 10, 20, 30 ]
        //   row 3: [ "West", 5, "", 5 ]
        //   row 4: [ "Grand Total", 15, 20, 35 ]
        expect(out.rows).toBe(4)
        expect(out.cols).toBe(4)
        expect(out.headerRowCount).toBe(1)
        expect(out.headerColCount).toBe(1)
        expect(pick(out.cells, 1, 2)!.display).toBe('2024')
        expect(pick(out.cells, 2, 1)!.display).toBe('East')
        expect(pick(out.cells, 2, 2)!.raw).toBe(10)
        expect(pick(out.cells, 2, 4)!.raw).toBe(30)
        expect(pick(out.cells, 4, 1)!.display).toBe('Grand Total')
        expect(pick(out.cells, 4, 4)!.raw).toBe(35)
    })

    it('omits grand-total row/col when disabled', () => {
        const t = table(['Region', 'Sales'], [[str('East'), num(10)]])
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Layout: row 1 = [ "", "Sum of Sales" ]; row 2 = [ "East", 10 ]
        expect(out.rows).toBe(2)
        expect(out.cols).toBe(2)
    })

    it('uses two header rows when multiple value fields exist', () => {
        const t = table(
            ['Region', 'Year', 'Sales', 'Cost'],
            [
                [str('East'), num(2024), num(10), num(3)],
                [str('East'), num(2025), num(20), num(7)],
            ]
        )
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            cols: [{ sourceColumn: 'Year' }],
            values: [
                { sourceColumn: 'Sales', aggregation: 'sum' },
                { sourceColumn: 'Cost', aggregation: 'sum' },
            ],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Two header rows: row 1 = col-field values; row 2 = per-cell
        // value-field labels.
        expect(out.headerRowCount).toBe(2)
        expect(pick(out.cells, 1, 2)!.display).toBe('2024')
        expect(pick(out.cells, 2, 2)!.display).toBe('Sum of Sales')
        expect(pick(out.cells, 2, 3)!.display).toBe('Sum of Cost')
    })

    it('applies per-value numFmt to data cells', () => {
        const t = table(['Region', 'Sales'], [[str('East'), num(1500)]])
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum', numFmt: '#,##0' }],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // The data cell at (row 2, col 2) is 1500 formatted with #,##0.
        expect(pick(out.cells, 2, 2)!.display).toBe('1,500')
    })

    it('renders no-rows/no-cols pivot as 2x2 with one data cell', () => {
        const t = table(['Sales'], [[num(10)], [num(20)]])
        const def = baseDef({
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Layout: row 1 = [ "Sum of Sales" ]; row 2 = [ 30 ]
        expect(out.rows).toBe(2)
        expect(out.cols).toBe(1)
        expect(pick(out.cells, 1, 1)!.display).toBe('Sum of Sales')
        expect(pick(out.cells, 2, 1)!.raw).toBe(30)
    })

    it('emits subtotal rows when rowSubtotals=true and multiple row fields', () => {
        const t = table(
            ['Region', 'Country', 'Sales'],
            [
                [str('East'), str('US'), num(10)],
                [str('East'), str('CA'), num(20)],
                [str('West'), str('US'), num(5)],
            ]
        )
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }, { sourceColumn: 'Country' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            rowGrandTotals: false,
            colGrandTotals: false,
            rowSubtotals: true,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // We expect subtotal rows "East Total" (30) and "West Total" (5)
        // after each Region group.
        const labels: string[] = []
        for (let r = 1; r <= out.rows; r++) {
            labels.push(pick(out.cells, r, 1)?.display ?? '')
        }
        expect(labels).toContain('East Total')
        expect(labels).toContain('West Total')
    })
})
