import { describe, expect, it } from 'vitest'
import { aggregate } from '../tinycld/calc/lib/pivot/aggregate'
import type { SourceTable } from '../tinycld/calc/lib/pivot/types'
import type { CellValue, PivotDefinition } from '../tinycld/calc/lib/workbook-types'

function str(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}
function num(n: number): CellValue {
    return { kind: 'number', raw: n, display: String(n) }
}
function empty(): CellValue {
    return { kind: 'string', raw: null, display: '' }
}

function table(headers: string[], rows: CellValue[][]): SourceTable {
    return {
        headers,
        rows: rows.map((r) => {
            const o: Record<string, CellValue> = {}
            headers.forEach((h, i) => {
                o[h] = r[i] ?? empty()
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

const k = (parts: string[]) => JSON.stringify(parts)

describe('aggregate — basics', () => {
    it('sums one value over one row dimension', () => {
        const t = table(
            ['Region', 'Sales'],
            [
                [str('East'), num(10)],
                [str('West'), num(20)],
                [str('East'), num(5)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                rows: [{ sourceColumn: 'Region' }],
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            })
        )
        expect(tree.rowKeys.map(k)).toEqual([k(['East']), k(['West'])])
        expect(tree.cells.get(k(['East']))!.get(k([]))![0]).toBe(15)
        expect(tree.cells.get(k(['West']))!.get(k([]))![0]).toBe(20)
        expect(tree.grandTotals[0]).toBe(35)
    })

    it('crosses rows and cols', () => {
        const t = table(
            ['Region', 'Year', 'Sales'],
            [
                [str('East'), num(2024), num(10)],
                [str('East'), num(2025), num(20)],
                [str('West'), num(2024), num(5)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                rows: [{ sourceColumn: 'Region' }],
                cols: [{ sourceColumn: 'Year' }],
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            })
        )
        expect(tree.rowKeys.map(k)).toEqual([k(['East']), k(['West'])])
        expect(tree.colKeys.map(k)).toEqual([k(['2024']), k(['2025'])])
        expect(tree.cells.get(k(['East']))!.get(k(['2024']))![0]).toBe(10)
        expect(tree.cells.get(k(['East']))!.get(k(['2025']))![0]).toBe(20)
        expect(tree.cells.get(k(['West']))!.get(k(['2024']))![0]).toBe(5)
        expect(tree.rowTotals.get(k(['East']))![0]).toBe(30)
        expect(tree.colTotals.get(k(['2024']))![0]).toBe(15)
        expect(tree.grandTotals[0]).toBe(35)
    })
})

describe('aggregate — each aggregation function', () => {
    const t = table(
        ['Sales'],
        [[num(2)], [num(4)], [num(4)], [num(4)], [num(5)], [num(5)], [num(7)], [num(9)]]
    )
    function run(agg: PivotDefinition['values'][number]['aggregation']) {
        const tree = aggregate(
            t,
            baseDef({
                values: [{ sourceColumn: 'Sales', aggregation: agg }],
            })
        )
        return tree.grandTotals[0]
    }
    it('sum', () => expect(run('sum')).toBe(40))
    it('average', () => expect(run('average')).toBe(5))
    it('count', () => expect(run('count')).toBe(8))
    it('countNums', () => expect(run('countNums')).toBe(8))
    it('max', () => expect(run('max')).toBe(9))
    it('min', () => expect(run('min')).toBe(2))
    it('product', () => expect(run('product')).toBe(2 * 4 * 4 * 4 * 5 * 5 * 7 * 9))
    it('stdDev (sample)', () =>
        expect(Math.abs(run('stdDev') - 2.138089935299395) < 1e-9).toBe(true))
    it('stdDevp (population)', () => expect(Math.abs(run('stdDevp') - 2) < 1e-9).toBe(true))
    it('var (sample)', () =>
        expect(Math.abs(run('var') - 4.571428571428571) < 1e-9).toBe(true))
    it('varp (population)', () => expect(Math.abs(run('varp') - 4) < 1e-9).toBe(true))
})

describe('aggregate — count vs countNums', () => {
    it('count counts non-empty, countNums counts numeric', () => {
        const t = table(
            ['Sales'],
            [[num(1)], [str('text')], [empty()], [num(2)]]
        )
        const tCount = aggregate(
            t,
            baseDef({
                values: [{ sourceColumn: 'Sales', aggregation: 'count' }],
            })
        )
        expect(tCount.grandTotals[0]).toBe(3)
        const tNums = aggregate(
            t,
            baseDef({
                values: [{ sourceColumn: 'Sales', aggregation: 'countNums' }],
            })
        )
        expect(tNums.grandTotals[0]).toBe(2)
    })
})

describe('aggregate — filters', () => {
    it('drops rows whose filter column is not in filterSelections', () => {
        const t = table(
            ['Country', 'Sales'],
            [
                [str('US'), num(10)],
                [str('CA'), num(20)],
                [str('UK'), num(30)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                filters: [{ sourceColumn: 'Country' }],
                filterSelections: { Country: ['US', 'CA'] },
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            })
        )
        expect(tree.grandTotals[0]).toBe(30)
    })

    it('empty selection means "all" (no filtering)', () => {
        const t = table(
            ['Country', 'Sales'],
            [
                [str('US'), num(10)],
                [str('CA'), num(20)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                filters: [{ sourceColumn: 'Country' }],
                filterSelections: {},
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            })
        )
        expect(tree.grandTotals[0]).toBe(30)
    })
})

describe('aggregate — ordering', () => {
    it('row/col keys are lex-sorted', () => {
        const t = table(
            ['City', 'Sales'],
            [
                [str('Berlin'), num(1)],
                [str('Austin'), num(2)],
                [str('Chicago'), num(3)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                rows: [{ sourceColumn: 'City' }],
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            })
        )
        expect(tree.rowKeys.map(k)).toEqual([k(['Austin']), k(['Berlin']), k(['Chicago'])])
    })

    it('preserves values-field order in per-cell arrays', () => {
        const t = table(
            ['Region', 'Sales', 'Cost'],
            [
                [str('East'), num(10), num(3)],
                [str('East'), num(20), num(6)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                rows: [{ sourceColumn: 'Region' }],
                values: [
                    { sourceColumn: 'Sales', aggregation: 'sum' },
                    { sourceColumn: 'Cost', aggregation: 'sum' },
                ],
            })
        )
        const cell = tree.cells.get(k(['East']))!.get(k([]))!
        expect(cell).toEqual([30, 9])
    })
})

describe('aggregate — multi-row + multi-col', () => {
    it('produces composite keys for multiple row/col fields', () => {
        const t = table(
            ['Region', 'Country', 'Year', 'Sales'],
            [
                [str('East'), str('US'), num(2024), num(10)],
                [str('East'), str('CA'), num(2024), num(20)],
            ]
        )
        const tree = aggregate(
            t,
            baseDef({
                rows: [{ sourceColumn: 'Region' }, { sourceColumn: 'Country' }],
                cols: [{ sourceColumn: 'Year' }],
                values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            })
        )
        expect(tree.rowKeys.map(k)).toEqual([k(['East', 'CA']), k(['East', 'US'])])
    })
})
