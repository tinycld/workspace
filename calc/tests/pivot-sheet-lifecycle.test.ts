import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    propagateSheetDelete,
    propagateSheetRename,
} from '../tinycld/calc/lib/pivot/lifecycle'
import { readPivot, writePivot } from '../tinycld/calc/lib/pivot/y-binding'
import type { PivotDefinition } from '../tinycld/calc/lib/workbook-types'
import {
    PIVOT_SHEET_KEY,
    SHEETS_MAP,
} from '../tinycld/calc/lib/y-doc-bootstrap'

function makeDef(overrides: Partial<PivotDefinition> = {}): PivotDefinition {
    return {
        id: 'p1',
        sourceRange: 'Sales!A1:E10',
        targetSheetName: 'Pivot of Sales',
        rows: [],
        cols: [],
        values: [{ sourceColumn: 'Amount', aggregation: 'sum' }],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...overrides,
    }
}

describe('propagateSheetRename', () => {
    it('rewrites sourceRange when the source sheet is renamed', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        propagateSheetRename(doc, 'Sales', 'Q4 Sales')
        expect(readPivot(doc, 'p1')!.sourceRange).toBe("'Q4 Sales'!A1:E10")
    })

    it('rewrites targetSheetName when the target sheet is renamed', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        propagateSheetRename(doc, 'Pivot of Sales', 'Summary')
        expect(readPivot(doc, 'p1')!.targetSheetName).toBe('Summary')
    })

    it('leaves unrelated pivots untouched', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        propagateSheetRename(doc, 'Other', 'Renamed')
        expect(readPivot(doc, 'p1')!.sourceRange).toBe('Sales!A1:E10')
    })

    it('is a no-op when oldName === newName', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        propagateSheetRename(doc, 'Sales', 'Sales')
        expect(readPivot(doc, 'p1')!.sourceRange).toBe('Sales!A1:E10')
    })
})

describe('propagateSheetDelete', () => {
    it('deletes the pivot def if the deleted sheet was the target', () => {
        const doc = new Y.Doc()
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = new Y.Map<unknown>()
        meta.set('name', 'Pivot of Sales')
        meta.set(PIVOT_SHEET_KEY, 'p1')
        sheetsMap.set('s2', meta)
        writePivot(doc, makeDef())
        propagateSheetDelete(doc, 's2')
        expect(readPivot(doc, 'p1')).toBeNull()
    })

    it('does NOT delete when the deleted sheet was only the source', () => {
        const doc = new Y.Doc()
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = new Y.Map<unknown>()
        meta.set('name', 'Sales')
        sheetsMap.set('s1', meta)
        writePivot(doc, makeDef())
        propagateSheetDelete(doc, 's1')
        // The def stays — engine will return PivotError on next render.
        expect(readPivot(doc, 'p1')).not.toBeNull()
    })
})
