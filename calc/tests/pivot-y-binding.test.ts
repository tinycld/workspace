import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    deletePivot,
    readPivot,
    readPivotIds,
    writePivot,
} from '../tinycld/calc/lib/pivot/y-binding'
import type { PivotDefinition } from '../tinycld/calc/lib/workbook-types'
import { PIVOTS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function makeDef(overrides: Partial<PivotDefinition> = {}): PivotDefinition {
    return {
        id: 'p1',
        sourceRange: 'Sheet1!A1:E10',
        targetSheetName: 'Pivot of Sheet1',
        rows: [{ sourceColumn: 'Region' }],
        cols: [{ sourceColumn: 'Year' }],
        values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        filters: [{ sourceColumn: 'Country' }],
        filterSelections: { Country: ['US', 'CA'] },
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...overrides,
    }
}

describe('writePivot / readPivot', () => {
    it('round-trips a full definition', () => {
        const doc = new Y.Doc()
        const def = makeDef()
        writePivot(doc, def)
        const out = readPivot(doc, 'p1')
        expect(out).toEqual(def)
    })

    it('stores rows/cols/values/filters as Y.Arrays', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const pivots = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
        const entry = pivots.get('p1')!
        expect(entry.get('rows')).toBeInstanceOf(Y.Array)
        expect(entry.get('cols')).toBeInstanceOf(Y.Array)
        expect(entry.get('values')).toBeInstanceOf(Y.Array)
        expect(entry.get('filters')).toBeInstanceOf(Y.Array)
    })

    it('stores filterSelections as nested Y.Map of Y.Arrays', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const pivots = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
        const entry = pivots.get('p1')!
        const sel = entry.get('filterSelections')
        expect(sel).toBeInstanceOf(Y.Map)
        const country = (sel as Y.Map<unknown>).get('Country')
        expect(country).toBeInstanceOf(Y.Array)
        expect((country as Y.Array<string>).toArray()).toEqual(['US', 'CA'])
    })

    it('omits styleName when undefined', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const pivots = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
        expect(pivots.get('p1')!.has('styleName')).toBe(false)
    })

    it('writes styleName when set', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef({ styleName: 'PivotStyleLight16' }))
        expect(readPivot(doc, 'p1')!.styleName).toBe('PivotStyleLight16')
    })

    it('readPivot returns null for missing id', () => {
        const doc = new Y.Doc()
        expect(readPivot(doc, 'nope')).toBeNull()
    })

    it('readPivotIds returns all ids in insertion order', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef({ id: 'a' }))
        writePivot(doc, makeDef({ id: 'b' }))
        expect(readPivotIds(doc)).toEqual(['a', 'b'])
    })

    it('deletePivot removes the entry', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        deletePivot(doc, 'p1')
        expect(readPivot(doc, 'p1')).toBeNull()
        expect(readPivotIds(doc)).toEqual([])
    })

    it('subsequent writePivot overwrites the existing entry', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        writePivot(
            doc,
            makeDef({ rows: [{ sourceColumn: 'Region', displayName: 'R' }] })
        )
        const out = readPivot(doc, 'p1')!
        expect(out.rows).toEqual([{ sourceColumn: 'Region', displayName: 'R' }])
    })

    it('omits filterSelections entry when array is empty', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef({ filterSelections: {} }))
        const out = readPivot(doc, 'p1')!
        expect(out.filterSelections).toEqual({})
    })
})
