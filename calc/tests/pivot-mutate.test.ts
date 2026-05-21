import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    addColumn,
    addFilter,
    addRow,
    addValue,
    moveField,
    removeField,
    setBoolean,
    setFilterSelection,
    setValueAggregation,
    setValueNumFmt,
} from '../tinycld/calc/lib/pivot/mutate'
import { readPivot, writePivot } from '../tinycld/calc/lib/pivot/y-binding'
import type { PivotDefinition } from '../tinycld/calc/lib/workbook-types'

function seed(def: Partial<PivotDefinition> = {}): { doc: Y.Doc; id: string } {
    const doc = new Y.Doc()
    writePivot(doc, {
        id: 'p1',
        sourceRange: 'Sheet1!A1:E10',
        targetSheetName: 'Pivot of Sheet1',
        rows: [],
        cols: [],
        values: [],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...def,
    })
    return { doc, id: 'p1' }
}

describe('add* / remove / move', () => {
    it('addRow / addColumn / addValue / addFilter append fields', () => {
        const { doc } = seed()
        addRow(doc, 'p1', 'Region')
        addColumn(doc, 'p1', 'Year')
        addValue(doc, 'p1', 'Sales', 'sum')
        addFilter(doc, 'p1', 'Country')
        const def = readPivot(doc, 'p1')!
        expect(def.rows).toEqual([{ sourceColumn: 'Region' }])
        expect(def.cols).toEqual([{ sourceColumn: 'Year' }])
        expect(def.values).toEqual([{ sourceColumn: 'Sales', aggregation: 'sum' }])
        expect(def.filters).toEqual([{ sourceColumn: 'Country' }])
    })

    it('removeField drops the entry', () => {
        const { doc } = seed({
            rows: [{ sourceColumn: 'Region' }, { sourceColumn: 'Country' }],
        })
        removeField(doc, 'p1', 'rows', 0)
        expect(readPivot(doc, 'p1')!.rows).toEqual([{ sourceColumn: 'Country' }])
    })

    it('moveField reorders inside a slot', () => {
        const { doc } = seed({
            rows: [
                { sourceColumn: 'A' },
                { sourceColumn: 'B' },
                { sourceColumn: 'C' },
            ],
        })
        moveField(doc, 'p1', 'rows', 2, 0)
        expect(readPivot(doc, 'p1')!.rows.map((r) => r.sourceColumn)).toEqual([
            'C',
            'A',
            'B',
        ])
    })

    it('setValueAggregation updates the aggregation', () => {
        const { doc } = seed({
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        })
        setValueAggregation(doc, 'p1', 0, 'average')
        expect(readPivot(doc, 'p1')!.values[0].aggregation).toBe('average')
    })

    it('setValueNumFmt updates the format', () => {
        const { doc } = seed({
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        })
        setValueNumFmt(doc, 'p1', 0, '#,##0')
        expect(readPivot(doc, 'p1')!.values[0].numFmt).toBe('#,##0')
    })

    it('setFilterSelection writes the array', () => {
        const { doc } = seed({
            filters: [{ sourceColumn: 'Country' }],
        })
        setFilterSelection(doc, 'p1', 'Country', ['US', 'CA'])
        expect(readPivot(doc, 'p1')!.filterSelections.Country).toEqual([
            'US',
            'CA',
        ])
    })

    it('setFilterSelection with empty array removes the filter', () => {
        const { doc } = seed({
            filters: [{ sourceColumn: 'Country' }],
            filterSelections: { Country: ['US'] },
        })
        setFilterSelection(doc, 'p1', 'Country', [])
        expect(readPivot(doc, 'p1')!.filterSelections.Country).toBeUndefined()
    })

    it('setBoolean updates the scalar', () => {
        const { doc } = seed()
        setBoolean(doc, 'p1', 'rowSubtotals', true)
        expect(readPivot(doc, 'p1')!.rowSubtotals).toBe(true)
    })
})
