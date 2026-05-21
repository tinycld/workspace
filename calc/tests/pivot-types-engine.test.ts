import { describe, expect, it } from 'vitest'
import {
    ok,
    pivotError,
    type GroupedTree,
    type Ok,
    type PivotError,
    type PivotErrorCode,
    type RenderedPivot,
    type Result,
    type SourceTable,
} from '../tinycld/calc/lib/pivot/types'
import type { CellValue } from '../tinycld/calc/lib/workbook-types'

describe('pivot engine-internal types', () => {
    it('SourceTable shapes a headers + row-records view', () => {
        const text: CellValue = { kind: 'string', raw: 'NA', display: 'NA' }
        const year: CellValue = { kind: 'number', raw: 2024, display: '2024' }
        const sales: CellValue = { kind: 'number', raw: 100, display: '100' }
        const table: SourceTable = {
            headers: ['Region', 'Year', 'Sales'],
            rows: [{ Region: text, Year: year, Sales: sales }],
        }
        expect(table.headers).toHaveLength(3)
        expect(table.rows[0].Region).toBeDefined()
    })

    it('GroupedTree carries cells + subtotals + grand totals', () => {
        const tree: GroupedTree = {
            rowKeys: [['NA']],
            colKeys: [['2024']],
            cells: new Map([
                ['["NA"]', new Map([['["2024"]', [100]]])],
            ]),
            rowTotals: new Map([['["NA"]', [100]]]),
            colTotals: new Map([['["2024"]', [100]]]),
            grandTotals: [100],
        }
        expect(tree.cells.get('["NA"]')?.get('["2024"]')).toEqual([100])
        expect(tree.grandTotals).toEqual([100])
    })

    it('GroupedTree supports the no-row/no-col empty-tuple case', () => {
        const tree: GroupedTree = {
            rowKeys: [[]],
            colKeys: [[]],
            cells: new Map([['[]', new Map([['[]', [42]]])]]),
            rowTotals: new Map([['[]', [42]]]),
            colTotals: new Map([['[]', [42]]]),
            grandTotals: [42],
        }
        expect(tree.cells.get('[]')?.get('[]')).toEqual([42])
    })

    it('RenderedPivot keys cells by "row:col" and carries header bands', () => {
        const header: CellValue = {
            kind: 'string',
            raw: 'Region',
            display: 'Region',
        }
        const na: CellValue = { kind: 'string', raw: 'NA', display: 'NA' }
        const total: CellValue = { kind: 'number', raw: 100, display: '100' }
        const rendered: RenderedPivot = {
            rows: 3,
            cols: 3,
            cells: new Map([
                ['1:1', header],
                ['2:1', na],
                ['2:2', total],
            ]),
            headerRowCount: 1,
            headerColCount: 1,
        }
        expect(rendered.cells.get('1:1')).toBeDefined()
        expect(rendered.headerRowCount).toBe(1)
    })

    it('pivotError builds a discriminated failure result', () => {
        const err: PivotError = pivotError('zero-data-rows', 'no data rows')
        expect(err.ok).toBe(false)
        expect(err.code).toBe('zero-data-rows')
        expect(err.message).toBe('no data rows')
    })

    it('every PivotErrorCode is constructable', () => {
        const codes: PivotErrorCode[] = [
            'missing-source-sheet',
            'malformed-range',
            'duplicate-headers',
            'zero-data-rows',
            'no-values',
        ]
        for (const code of codes) {
            expect(pivotError(code, 'msg').code).toBe(code)
        }
    })

    it('ok() wraps a value into the success branch', () => {
        const r: Ok<number> = ok(7)
        expect(r.ok).toBe(true)
        expect(r.value).toBe(7)
    })

    it('Result<T> narrows on the discriminant', () => {
        const win: Result<number> = ok(1)
        const lose: Result<number> = pivotError('no-values', 'x')
        if (win.ok) {
            expect(win.value).toBe(1)
        } else {
            throw new Error('expected ok')
        }
        if (!lose.ok) {
            expect(lose.code).toBe('no-values')
        } else {
            throw new Error('expected error')
        }
    })
})
