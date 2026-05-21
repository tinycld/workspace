import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    applyReplaceAll,
    applyReplaceToCell,
    buildMatcher,
    computeMatches,
} from '../tinycld/calc/hooks/find/use-find-actions'
import { createFindStore } from '../tinycld/calc/hooks/find/use-find-store'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import {
    bootstrapYDocFromWorkbook,
    CELLS_MAP,
    readYCell,
} from '../tinycld/calc/lib/y-doc-bootstrap'

function makeDoc(): Y.Doc {
    const doc = new Y.Doc()
    const model: WorkbookModel = {
        sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }],
    }
    bootstrapYDocFromWorkbook(doc, model)
    return doc
}

function readDisplay(doc: Y.Doc, sheetId: string, row: number, col: number): string | null {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return null
    return readYCell(cell).display
}

describe('find store wrap-around', () => {
    it('next wraps to first when at last; prev wraps to last when at first', () => {
        const store = createFindStore()
        store.getState().setMatches(
            [
                { sheetId: 'sheet1', row: 1, col: 1 },
                { sheetId: 'sheet1', row: 2, col: 1 },
                { sheetId: 'sheet1', row: 3, col: 1 },
            ],
            null
        )
        // setMatches snaps to 0 since no prior was set
        expect(store.getState().currentMatchIndex).toBe(0)
        // Step forward two → index 2 (last)
        store.getState().setCurrentMatchIndex(2)
        // Wrap forward → 0
        const len = store.getState().matches.length
        const next = (store.getState().currentMatchIndex + 1) % len
        store.getState().setCurrentMatchIndex(next)
        expect(store.getState().currentMatchIndex).toBe(0)
        // Wrap backward → last
        const prev = store.getState().currentMatchIndex <= 0 ? len - 1 : store.getState().currentMatchIndex - 1
        store.getState().setCurrentMatchIndex(prev)
        expect(store.getState().currentMatchIndex).toBe(2)
    })

    it('close clears matches and isOpen', () => {
        const store = createFindStore()
        store.getState().open('find')
        store.getState().setMatches(
            [{ sheetId: 'sheet1', row: 1, col: 1 }],
            null
        )
        expect(store.getState().isOpen).toBe(true)
        expect(store.getState().matches).toHaveLength(1)
        store.getState().close()
        expect(store.getState().isOpen).toBe(false)
        expect(store.getState().matches).toEqual([])
        expect(store.getState().currentMatchIndex).toBe(-1)
    })
})

describe('applyReplaceToCell', () => {
    it('updates only the targeted cell', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        setYCell(doc, 'sheet1', 2, 1, 'apple')
        const matcher = buildMatcher({
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
        })
        if (matcher == null) throw new Error('matcher should compile')
        applyReplaceToCell(
            doc,
            { sheetId: 'sheet1', row: 1, col: 1 },
            matcher,
            'orange',
            false
        )
        expect(readDisplay(doc, 'sheet1', 1, 1)).toBe('orange')
        expect(readDisplay(doc, 'sheet1', 2, 1)).toBe('apple')
    })

    it('replaces a substring inside the cell', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple pie')
        const matcher = buildMatcher({
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
        })
        if (matcher == null) throw new Error('matcher should compile')
        applyReplaceToCell(
            doc,
            { sheetId: 'sheet1', row: 1, col: 1 },
            matcher,
            'orange',
            false
        )
        expect(readDisplay(doc, 'sheet1', 1, 1)).toBe('orange pie')
    })
})

describe('applyReplaceAll', () => {
    it('writes inside one transaction so a single undo reverts everything', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        setYCell(doc, 'sheet1', 2, 1, 'apple pie')
        setYCell(doc, 'sheet1', 3, 1, 'banana')
        const undoMgr = new Y.UndoManager([doc.getMap(CELLS_MAP)], {
            captureTimeout: 0,
            trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
        })

        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(result.matches).toHaveLength(2)

        const matcher = buildMatcher({
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
        })
        if (matcher == null) throw new Error('matcher should compile')

        applyReplaceAll(doc, result.matches, matcher, 'orange', false)
        expect(readDisplay(doc, 'sheet1', 1, 1)).toBe('orange')
        expect(readDisplay(doc, 'sheet1', 2, 1)).toBe('orange pie')
        expect(readDisplay(doc, 'sheet1', 3, 1)).toBe('banana')

        // The whole replace-all must collapse to a single undo step
        // — captured-by-origin + the single outer transact closure.
        expect(undoMgr.undoStack.length).toBe(1)

        // One undo should restore both originally-replaced cells in
        // one step.
        undoMgr.undo()
        expect(readDisplay(doc, 'sheet1', 1, 1)).toBe('apple')
        expect(readDisplay(doc, 'sheet1', 2, 1)).toBe('apple pie')
        expect(readDisplay(doc, 'sheet1', 3, 1)).toBe('banana')
    })

    it('no-op when there are no targets', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        const matcher = buildMatcher({
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
        })
        if (matcher == null) throw new Error('matcher should compile')
        applyReplaceAll(doc, [], matcher, 'orange', false)
        expect(readDisplay(doc, 'sheet1', 1, 1)).toBe('apple')
    })
})
