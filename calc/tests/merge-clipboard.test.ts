import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { applyPayloadToDoc } from '../tinycld/calc/lib/clipboard/deserialize'
import { serializeRange } from '../tinycld/calc/lib/clipboard/serialize'
import { getAllMerges, mergeCells } from '../tinycld/calc/lib/merge'
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

describe('clipboard merge round-trip', () => {
    it('serializeRange captures merges within the range as relative offsets', () => {
        const doc = freshDoc()
        setYCell(doc, 'sheet1', 2, 2, 'a')
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 2, endCol: 3 })
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 2,
            endRow: 4,
            startCol: 2,
            endCol: 4,
        })
        expect(payload.merges).toEqual([
            { rowOffset: 0, colOffset: 0, rowSpan: 2, colSpan: 2 },
        ])
    })

    it('serializeRange omits merges that aren\'t fully inside the range', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 5, startCol: 2, endCol: 5 })
        // Range only covers part of the merge
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 2,
            endRow: 3,
            startCol: 2,
            endCol: 3,
        })
        expect(payload.merges).toBeUndefined()
    })

    it('applyPayloadToDoc re-applies merges at the destination anchor', () => {
        const src = freshDoc()
        setYCell(src, 'sheet1', 2, 2, 'a')
        mergeCells(src, 'sheet1', { startRow: 2, endRow: 3, startCol: 2, endCol: 3 })
        const payload = serializeRange(src, 'sheet1', {
            startRow: 2,
            endRow: 4,
            startCol: 2,
            endCol: 4,
        })

        const dst = freshDoc()
        applyPayloadToDoc(dst, 'sheet1', payload, {
            mode: 'all',
            destAnchor: { row: 6, col: 7 },
        })
        const merges = getAllMerges(dst, 'sheet1')
        expect(merges).toHaveLength(1)
        expect(merges[0]).toEqual({ anchorRow: 6, anchorCol: 7, rowSpan: 2, colSpan: 2 })
    })

    it('applyPayloadToDoc skips a captured merge that conflicts with an existing destination merge', () => {
        const src = freshDoc()
        mergeCells(src, 'sheet1', { startRow: 1, endRow: 2, startCol: 1, endCol: 2 })
        const payload = serializeRange(src, 'sheet1', {
            startRow: 1,
            endRow: 2,
            startCol: 1,
            endCol: 2,
        })

        const dst = freshDoc()
        // Pre-existing merge at the destination region overlaps but
        // anchored elsewhere -> incoming merge should be skipped.
        mergeCells(dst, 'sheet1', { startRow: 5, endRow: 7, startCol: 5, endCol: 7 })
        applyPayloadToDoc(dst, 'sheet1', payload, {
            mode: 'all',
            destAnchor: { row: 6, col: 6 },
        })
        // Only the original destination merge should remain
        const merges = getAllMerges(dst, 'sheet1')
        expect(merges).toHaveLength(1)
        expect(merges[0]).toEqual({ anchorRow: 5, anchorCol: 5, rowSpan: 3, colSpan: 3 })
    })
})
