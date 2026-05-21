import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getAllMerges, mergeCells } from '../tinycld/calc/lib/merge'
import {
    deleteColumns,
    deleteRows,
    insertColumns,
    insertRows,
} from '../tinycld/calc/lib/structural-mutations'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function freshDoc(): Y.Doc {
    const doc = new Y.Doc()
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet1')
    meta.set('position', 0)
    meta.set('rowCount', 20)
    meta.set('colCount', 20)
    sheetsMap.set('sheet1', meta)
    return doc
}

describe('structural mutations on merges — rows', () => {
    it('insertRows above a merge shifts the anchor down', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 5, endRow: 6, startCol: 2, endCol: 3 })
        insertRows(doc, 'sheet1', 3, 2, 'above', 20)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges).toHaveLength(1)
        expect(merges[0]).toEqual({ anchorRow: 7, anchorCol: 2, rowSpan: 2, colSpan: 2 })
    })

    it('insertRows below a merge leaves it alone', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 2, endCol: 3 })
        insertRows(doc, 'sheet1', 8, 2, 'below', 20)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 2, rowSpan: 2, colSpan: 2 })
    })

    it('insertRows inside a merge grows rowSpan', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 5, startCol: 2, endCol: 3 })
        // Insert above row 4 -> insertAt = 4, which is strictly inside (anchor 2, end 5)
        insertRows(doc, 'sheet1', 4, 2, 'above', 20)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 2, rowSpan: 6, colSpan: 2 })
    })

    it('deleteRows fully containing a merge drops it', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 4, endRow: 5, startCol: 2, endCol: 3 })
        deleteRows(doc, 'sheet1', 3, 5)
        expect(getAllMerges(doc, 'sheet1')).toHaveLength(0)
    })

    it('deleteRows partial-from-above shifts the anchor down to the deletion start', () => {
        const doc = freshDoc()
        // anchor 5, end 8 (rowSpan 4)
        mergeCells(doc, 'sheet1', { startRow: 5, endRow: 8, startCol: 2, endCol: 3 })
        // delete rows 4..6 — anchor (5) is in deleted band, tail (8) survives
        deleteRows(doc, 'sheet1', 4, 3)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges).toHaveLength(1)
        // Anchor moves to deletion start (row 4), span shrinks to 2 (rows 4..5 in new coords)
        expect(merges[0]).toEqual({ anchorRow: 4, anchorCol: 2, rowSpan: 2, colSpan: 2 })
    })

    it('deleteRows partial-from-inside shrinks rowSpan', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 7, startCol: 2, endCol: 3 })
        // Delete rows 4..5, fully inside the merge
        deleteRows(doc, 'sheet1', 4, 2)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 2, rowSpan: 4, colSpan: 2 })
    })

    it('deleteRows after a merge shifts anchor up by count', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 8, endRow: 9, startCol: 2, endCol: 3 })
        deleteRows(doc, 'sheet1', 2, 3)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 5, anchorCol: 2, rowSpan: 2, colSpan: 2 })
    })
})

describe('structural mutations on merges — columns', () => {
    it('insertColumns left of a merge shifts the anchor right', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 5, endCol: 6 })
        insertColumns(doc, 'sheet1', 3, 2, 'left', 20)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 7, rowSpan: 2, colSpan: 2 })
    })

    it('insertColumns inside a merge grows colSpan', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 2, endCol: 5 })
        insertColumns(doc, 'sheet1', 4, 2, 'left', 20)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 2, rowSpan: 2, colSpan: 6 })
    })

    it('deleteColumns fully containing a merge drops it', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 4, endCol: 5 })
        deleteColumns(doc, 'sheet1', 3, 5)
        expect(getAllMerges(doc, 'sheet1')).toHaveLength(0)
    })

    it('deleteColumns partial-from-inside shrinks colSpan', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 2, endCol: 7 })
        deleteColumns(doc, 'sheet1', 4, 2)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 2, rowSpan: 2, colSpan: 4 })
    })

    it('deleteColumns partial-from-left shifts anchor to deletion start', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 5, endCol: 8 })
        deleteColumns(doc, 'sheet1', 4, 3)
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 2, anchorCol: 4, rowSpan: 2, colSpan: 2 })
    })
})
