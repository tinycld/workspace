import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    FROZEN_COLS_KEY,
    FROZEN_ROWS_KEY,
    bootstrapYDocFromWorkbook,
    readFrozenCount,
    setYFrozenCount,
    SHEETS_MAP,
} from '../tinycld/calc/lib/y-doc-bootstrap'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'

// Pin the freeze-pane Y.Doc layer: the meta-key reader/writer round-
// trips, setting count <= 0 deletes the key (sparse "no freeze"
// state), independent axes, and bootstrap brings frozen counts in
// from the parsed WorkbookModel.

function bootstrap(doc: Y.Doc, sheetIds: string[] = ['sheet1']): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    sheetIds.forEach((id, i) => {
        const meta = new Y.Map<unknown>()
        meta.set('name', `Sheet${i + 1}`)
        meta.set('position', i)
        meta.set('rowCount', 10)
        meta.set('colCount', 10)
        sheetsMap.set(id, meta)
    })
}

describe('frozen rows / cols on the sheet Y.Map', () => {
    it('starts undefined and reflects a write', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()
        expect(readFrozenCount(meta, FROZEN_COLS_KEY)).toBeUndefined()

        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 1)
        setYFrozenCount(doc, 'sheet1', FROZEN_COLS_KEY, 2)
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBe(1)
        expect(readFrozenCount(meta, FROZEN_COLS_KEY)).toBe(2)
    })

    it('treats setFrozenRows(0) as unfreeze (deletes the key)', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')

        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 3)
        expect(meta?.has(FROZEN_ROWS_KEY)).toBe(true)
        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 0)
        expect(meta?.has(FROZEN_ROWS_KEY)).toBe(false)
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()
    })

    it('negative or NaN counts are clamped to 0 (delete)', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')

        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 2)
        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, -1)
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()

        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 2)
        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, Number.NaN)
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()
    })

    it('setting one axis leaves the other untouched', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')

        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 1)
        setYFrozenCount(doc, 'sheet1', FROZEN_COLS_KEY, 2)
        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 0)
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()
        expect(readFrozenCount(meta, FROZEN_COLS_KEY)).toBe(2)
    })

    it('setting freeze on one sheet does not affect another', () => {
        const doc = new Y.Doc()
        bootstrap(doc, ['sheet1', 'sheet2'])
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta1 = sheetsMap.get('sheet1')
        const meta2 = sheetsMap.get('sheet2')

        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 3)
        expect(readFrozenCount(meta1, FROZEN_ROWS_KEY)).toBe(3)
        expect(readFrozenCount(meta2, FROZEN_ROWS_KEY)).toBeUndefined()
    })

    it('readFrozenCount ignores zero / non-numeric values', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')
        // Direct write of a stale 0 value (defensive read path: 0 is
        // semantically equivalent to "no freeze").
        meta?.set(FROZEN_ROWS_KEY, 0)
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()
        meta?.set(FROZEN_ROWS_KEY, 'oops')
        expect(readFrozenCount(meta, FROZEN_ROWS_KEY)).toBeUndefined()
    })

    it('write is wrapped in a transaction (single update event)', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        let updates = 0
        doc.on('update', () => {
            updates++
        })
        setYFrozenCount(doc, 'sheet1', FROZEN_ROWS_KEY, 2)
        expect(updates).toBe(1)
    })
})

describe('bootstrapYDocFromWorkbook with frozen counts', () => {
    it('copies frozenRows / frozenCols onto the sheet meta', () => {
        const doc = new Y.Doc()
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'A',
                    rowCount: 5,
                    colCount: 5,
                    cells: {},
                    frozenRows: 1,
                    frozenCols: 2,
                },
                {
                    name: 'B',
                    rowCount: 5,
                    colCount: 5,
                    cells: {},
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(readFrozenCount(sheetsMap.get('sheet1'), FROZEN_ROWS_KEY)).toBe(1)
        expect(readFrozenCount(sheetsMap.get('sheet1'), FROZEN_COLS_KEY)).toBe(2)
        // No freeze on sheet B → keys absent.
        expect(readFrozenCount(sheetsMap.get('sheet2'), FROZEN_ROWS_KEY)).toBeUndefined()
        expect(readFrozenCount(sheetsMap.get('sheet2'), FROZEN_COLS_KEY)).toBeUndefined()
    })

    it('skips frozen keys when the parsed value is zero', () => {
        const doc = new Y.Doc()
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'A',
                    rowCount: 1,
                    colCount: 1,
                    cells: {},
                    frozenRows: 0,
                    frozenCols: 0,
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')
        expect(meta?.has(FROZEN_ROWS_KEY)).toBe(false)
        expect(meta?.has(FROZEN_COLS_KEY)).toBe(false)
    })
})

describe('grid-store freeze actions delegate through deps', () => {
    it('setFrozenRows / setFrozenCols / unfreeze invoke the matching deps', async () => {
        const { createGridStore } = await import('../tinycld/calc/hooks/grid-store')
        const rowCalls: number[] = []
        const colCalls: number[] = []
        const store = createGridStore({
            readOnly: false,
            writeCell: () => {},
            focusActiveInput: () => {},
            applyStructuralMutation: () => {},
            setFrozenRows: n => rowCalls.push(n),
            setFrozenCols: n => colCalls.push(n),
        })
        store.getState().setFrozenRows(2)
        store.getState().setFrozenCols(3)
        store.getState().unfreeze()
        expect(rowCalls).toEqual([2, 0])
        expect(colCalls).toEqual([3, 0])
    })

    it('readOnly suppresses the dispatch', async () => {
        const { createGridStore } = await import('../tinycld/calc/hooks/grid-store')
        const rowCalls: number[] = []
        const colCalls: number[] = []
        const store = createGridStore({
            readOnly: true,
            writeCell: () => {},
            focusActiveInput: () => {},
            applyStructuralMutation: () => {},
            setFrozenRows: n => rowCalls.push(n),
            setFrozenCols: n => colCalls.push(n),
        })
        store.getState().setFrozenRows(2)
        store.getState().unfreeze()
        expect(rowCalls).toEqual([])
        expect(colCalls).toEqual([])
    })
})
