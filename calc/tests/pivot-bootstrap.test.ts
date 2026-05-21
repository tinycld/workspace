import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { readPivot, readPivotIds } from '../tinycld/calc/lib/pivot/y-binding'
import type { PivotDefinition, WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import {
    bootstrapYDocFromWorkbook,
    PIVOT_SHEET_KEY,
    SHEETS_MAP,
} from '../tinycld/calc/lib/y-doc-bootstrap'

function emptyWorkbook(overrides: Partial<WorkbookModel> = {}): WorkbookModel {
    return {
        sheets: [
            { name: 'Sheet1', rowCount: 1, colCount: 1, cells: {} },
            { name: 'Pivot of Sheet1', rowCount: 1, colCount: 1, cells: {} },
        ],
        ...overrides,
    }
}

function makeDef(): PivotDefinition {
    return {
        id: 'p1',
        sourceRange: 'Sheet1!A1:E10',
        targetSheetName: 'Pivot of Sheet1',
        rows: [{ sourceColumn: 'Region' }],
        cols: [],
        values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
    }
}

describe('bootstrapYDocFromWorkbook — pivots', () => {
    it('writes pivot defs into doc.getMap("pivots")', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptyWorkbook({ pivots: [makeDef()] }))
        expect(readPivotIds(doc)).toEqual(['p1'])
        const def = readPivot(doc, 'p1') as PivotDefinition
        expect(def.sourceRange).toBe('Sheet1!A1:E10')
        expect(def.rows).toEqual([{ sourceColumn: 'Region' }])
    })

    it('sets pivotId meta on the target sheet', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptyWorkbook({ pivots: [makeDef()] }))
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = sheetsMap.get('sheet2') as Y.Map<unknown>
        expect(meta.get(PIVOT_SHEET_KEY)).toBe('p1')
    })

    it('omits pivot wiring when WorkbookModel.pivots is missing', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptyWorkbook())
        expect(readPivotIds(doc)).toEqual([])
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = sheetsMap.get('sheet2') as Y.Map<unknown>
        expect(meta.has(PIVOT_SHEET_KEY)).toBe(false)
    })
})
