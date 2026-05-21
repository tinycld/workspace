import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { cellKey, type WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    bootstrapYDocFromWorkbook,
    CELLS_MAP,
    SHEETS_MAP,
    ydocIsEmpty,
    ydocSheetIds,
} from '../tinycld/calc/lib/y-doc-bootstrap'

function makeWorkbook(): WorkbookModel {
    return {
        sheets: [
            {
                name: 'Sheet1',
                rowCount: 3,
                colCount: 3,
                cells: {
                    [cellKey(1, 1)]: { kind: 'string', raw: 'A1', display: 'A1' },
                    [cellKey(1, 2)]: { kind: 'string', raw: 'B1', display: 'B1' },
                    [cellKey(2, 1)]: { kind: 'string', raw: 'A2', display: 'A2' },
                },
            },
            {
                name: 'Numbers',
                rowCount: 2,
                colCount: 2,
                cells: {
                    [cellKey(1, 1)]: { kind: 'number', raw: 42, display: '42' },
                },
            },
        ],
    }
}

describe('bootstrapYDocFromWorkbook', () => {
    it('marks an unbootstrapped doc as empty', () => {
        const doc = new Y.Doc()
        expect(ydocIsEmpty(doc)).toBe(true)
        expect(ydocSheetIds(doc)).toEqual([])
    })

    it('populates sheets with stable ids and metadata', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, makeWorkbook())

        expect(ydocIsEmpty(doc)).toBe(false)
        const ids = ydocSheetIds(doc)
        expect(ids).toEqual(['sheet1', 'sheet2'])

        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const sheet1 = sheetsMap.get('sheet1')
        const sheet2 = sheetsMap.get('sheet2')
        expect(sheet1?.get('name')).toBe('Sheet1')
        expect(sheet1?.get('position')).toBe(0)
        expect(sheet1?.get('rowCount')).toBe(3)
        expect(sheet1?.get('colCount')).toBe(3)
        expect(sheet2?.get('name')).toBe('Numbers')
        expect(sheet2?.get('position')).toBe(1)
    })

    it('populates cells under composite sheet:row:col keys with typed raw', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, makeWorkbook())

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cellA1 = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(cellA1?.get('kind')).toBe('string')
        expect(cellA1?.get('raw')).toBe('A1')
        expect(cellA1?.get('display')).toBe('A1')

        // Sheet 2 cell A1: a number kind stays a JS number on disk, no
        // longer the legacy stringification.
        const sheet2A1 = cellsMap.get(yCellKey('sheet2', 1, 1))
        expect(sheet2A1?.get('kind')).toBe('number')
        expect(sheet2A1?.get('raw')).toBe(42)
        expect(sheet2A1?.get('display')).toBe('42')
    })

    it('runs in a single transaction', () => {
        const doc = new Y.Doc()
        let updateCount = 0
        doc.on('update', () => {
            updateCount++
        })
        bootstrapYDocFromWorkbook(doc, makeWorkbook())
        // The transaction should produce exactly one Yjs update
        // regardless of how many cells we wrote. This matters for sync:
        // bootstrapping a 100-cell workbook shouldn't fan out as 100
        // separate WS frames.
        expect(updateCount).toBe(1)
    })

    it('writes booleans, dates, and formulas with their kind tag', () => {
        const doc = new Y.Doc()
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'Mixed',
                    rowCount: 4,
                    colCount: 1,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'boolean', raw: true, display: 'TRUE' },
                        [cellKey(2, 1)]: { kind: 'date', raw: '2024-01-15', display: '2024-01-15' },
                        [cellKey(3, 1)]: {
                            kind: 'formula',
                            raw: 42,
                            display: '42',
                            formula: 'A1+A2',
                        },
                    },
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

        const boolCell = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(boolCell?.get('kind')).toBe('boolean')
        expect(boolCell?.get('raw')).toBe(true)

        const dateCell = cellsMap.get(yCellKey('sheet1', 2, 1))
        expect(dateCell?.get('kind')).toBe('date')
        expect(dateCell?.get('raw')).toBe('2024-01-15')

        const formulaCell = cellsMap.get(yCellKey('sheet1', 3, 1))
        expect(formulaCell?.get('kind')).toBe('formula')
        expect(formulaCell?.get('raw')).toBe(42)
        expect(formulaCell?.get('formula')).toBe('A1+A2')
    })

    it('normalizes JS Date values from the parser into ISO strings on the Y.Doc', () => {
        // The xlsx adapter emits ISO strings up front, but if a caller
        // passes a Date through (e.g. a hand-built model), bootstrap
        // still has to normalize because Yjs cannot serialize Date.
        const doc = new Y.Doc()
        const d = new Date('2024-01-15T00:00:00.000Z')
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'D',
                    rowCount: 1,
                    colCount: 1,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'date', raw: d, display: '2024-01-15' },
                    },
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)
        const cell = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1))
        expect(cell?.get('raw')).toBe('2024-01-15')
    })
})
