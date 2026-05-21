import { describe, expect, it } from 'vitest'
import type {
    PivotAggregation,
    PivotDefinition,
    PivotField,
    PivotValueField,
} from '../tinycld/calc/lib/workbook-types'

describe('pivot types', () => {
    it('PivotDefinition compiles with all required fields', () => {
        const def: PivotDefinition = {
            id: 'p1',
            sourceRange: 'Sheet1!A1:E10',
            targetSheetName: 'Pivot of Sheet1',
            rows: [{ sourceColumn: 'Region' }],
            cols: [{ sourceColumn: 'Year' }],
            values: [
                { sourceColumn: 'Sales', aggregation: 'sum' },
            ],
            filters: [],
            filterSelections: {},
            rowGrandTotals: true,
            colGrandTotals: true,
            rowSubtotals: false,
            colSubtotals: false,
        }
        expect(def.id).toBe('p1')
        expect(def.values[0].aggregation).toBe('sum')
    })

    it('PivotValueField extends PivotField with aggregation + numFmt', () => {
        const v: PivotValueField = {
            sourceColumn: 'Amount',
            displayName: 'Total amount',
            aggregation: 'average',
            numFmt: '#,##0.00',
        }
        expect(v.numFmt).toBe('#,##0.00')
    })

    it('all 11 aggregations are typed', () => {
        const aggs: PivotAggregation[] = [
            'sum', 'average', 'count', 'countNums',
            'max', 'min', 'product',
            'stdDev', 'stdDevp', 'var', 'varp',
        ]
        expect(aggs).toHaveLength(11)
    })

    it('PivotField displayName is optional', () => {
        const f: PivotField = { sourceColumn: 'Region' }
        expect(f.displayName).toBeUndefined()
    })
})
