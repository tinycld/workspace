import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import {
    expandRangeOverMergeList,
    expandRangeOverMerges,
    findMergeContaining,
    getAllMerges,
    mergeCells,
    snapPointToMerge,
    unmergeCells,
} from '../tinycld/calc/lib/merge'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function freshDoc(): Y.Doc {
    const doc = new Y.Doc()
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet1')
    meta.set('position', 0)
    meta.set('rowCount', 10)
    meta.set('colCount', 10)
    sheetsMap.set('sheet1', meta)
    return doc
}

describe('mergeCells / unmergeCells / getAllMerges', () => {
    it('mergeCells creates a single entry visible via getAllMerges', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 1, endRow: 1, startCol: 1, endCol: 3 })
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges).toHaveLength(1)
        expect(merges[0]).toEqual({ anchorRow: 1, anchorCol: 1, rowSpan: 1, colSpan: 3 })
    })

    it('mergeCells normalizes inverted ranges', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 3, endRow: 1, startCol: 4, endCol: 2 })
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges[0]).toEqual({ anchorRow: 1, anchorCol: 2, rowSpan: 3, colSpan: 3 })
    })

    it('mergeCells with a 1x1 range is a no-op', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
        expect(getAllMerges(doc, 'sheet1')).toHaveLength(0)
    })

    it('unmergeCells removes the entry', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 4, startCol: 2, endCol: 3 })
        expect(getAllMerges(doc, 'sheet1')).toHaveLength(1)
        unmergeCells(doc, 'sheet1', 2, 2)
        expect(getAllMerges(doc, 'sheet1')).toHaveLength(0)
    })

    it('findMergeContaining returns the merge for any covered cell', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 4, startCol: 2, endCol: 4 })
        const m = findMergeContaining(doc, 'sheet1', 3, 3)
        expect(m).toEqual({ anchorRow: 2, anchorCol: 2, rowSpan: 3, colSpan: 3 })
        // Anchor cell
        expect(findMergeContaining(doc, 'sheet1', 2, 2)).not.toBeNull()
        // Outside the merge
        expect(findMergeContaining(doc, 'sheet1', 5, 5)).toBeNull()
        expect(findMergeContaining(doc, 'sheet1', 1, 3)).toBeNull()
    })

    it('mergeCells over an existing overlapping merge first unmerges then re-merges', () => {
        const doc = freshDoc()
        // Two non-overlapping initial merges
        mergeCells(doc, 'sheet1', { startRow: 1, endRow: 1, startCol: 1, endCol: 2 })
        mergeCells(doc, 'sheet1', { startRow: 3, endRow: 4, startCol: 1, endCol: 2 })
        expect(getAllMerges(doc, 'sheet1')).toHaveLength(2)
        // Merge that covers both — both should be replaced by one new merge
        mergeCells(doc, 'sheet1', { startRow: 1, endRow: 4, startCol: 1, endCol: 2 })
        const merges = getAllMerges(doc, 'sheet1')
        expect(merges).toHaveLength(1)
        expect(merges[0]).toEqual({ anchorRow: 1, anchorCol: 1, rowSpan: 4, colSpan: 2 })
    })

    it('mergeCells keeps anchor value and clears non-anchor covered cells', () => {
        const doc = freshDoc()
        setYCell(doc, 'sheet1', 1, 1, 'anchor')
        setYCell(doc, 'sheet1', 1, 2, 'lost-1')
        setYCell(doc, 'sheet1', 2, 1, 'lost-2')
        setYCell(doc, 'sheet1', 2, 2, 'lost-3')
        mergeCells(doc, 'sheet1', { startRow: 1, endRow: 2, startCol: 1, endCol: 2 })
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        // Anchor preserved
        const anchor = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(anchor?.get('raw')).toBe('anchor')
        // Other cells removed
        expect(cellsMap.get(yCellKey('sheet1', 1, 2))).toBeUndefined()
        expect(cellsMap.get(yCellKey('sheet1', 2, 1))).toBeUndefined()
        expect(cellsMap.get(yCellKey('sheet1', 2, 2))).toBeUndefined()
    })

    it('snapPointToMerge returns anchor for covered cells, identity otherwise', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 3, startCol: 2, endCol: 3 })
        expect(snapPointToMerge(doc, 'sheet1', 3, 3)).toEqual({ row: 2, col: 2 })
        expect(snapPointToMerge(doc, 'sheet1', 2, 2)).toEqual({ row: 2, col: 2 })
        expect(snapPointToMerge(doc, 'sheet1', 5, 5)).toEqual({ row: 5, col: 5 })
    })

    it('expandRangeOverMerges grows a partial selection to cover the merge', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 4, startCol: 2, endCol: 4 })
        const expanded = expandRangeOverMerges(doc, 'sheet1', {
            startRow: 1,
            endRow: 3,
            startCol: 3,
            endCol: 3,
        })
        expect(expanded).toEqual({ startRow: 1, endRow: 4, startCol: 2, endCol: 4 })
    })

    it('expandRangeOverMerges leaves a non-touching range alone', () => {
        const doc = freshDoc()
        mergeCells(doc, 'sheet1', { startRow: 2, endRow: 4, startCol: 2, endCol: 4 })
        const range = { startRow: 6, endRow: 7, startCol: 6, endCol: 7 }
        expect(expandRangeOverMerges(doc, 'sheet1', range)).toEqual(range)
    })
})

describe('expandRangeOverMergeList', () => {
    it('grows a single-cell selection on the merge anchor to the full merge', () => {
        // This is the selection-overlay parity case: clicking the
        // anchor of a 3×3 merge produces a 1×1 selection. The
        // selection overlay expands it so the green box traces the
        // merged footprint, matching the blue edit-mode border.
        const merges = [{ anchorRow: 2, anchorCol: 2, rowSpan: 3, colSpan: 3 }]
        expect(
            expandRangeOverMergeList(
                { startRow: 2, endRow: 2, startCol: 2, endCol: 2 },
                merges
            )
        ).toEqual({ startRow: 2, endRow: 4, startCol: 2, endCol: 4 })
    })

    it('normalizes an inverted range even when no merges are present', () => {
        expect(
            expandRangeOverMergeList(
                { startRow: 5, endRow: 2, startCol: 4, endCol: 1 },
                []
            )
        ).toEqual({ startRow: 2, endRow: 5, startCol: 1, endCol: 4 })
    })

    it('leaves a range untouched when no merge overlaps', () => {
        const merges = [{ anchorRow: 1, anchorCol: 1, rowSpan: 2, colSpan: 2 }]
        const range = { startRow: 5, endRow: 6, startCol: 5, endCol: 6 }
        expect(expandRangeOverMergeList(range, merges)).toEqual(range)
    })

    it('expands transitively when one merge pulls in another', () => {
        // M1 covers (2,2)-(2,4). M2 covers (2,4)-(4,4). Selecting just
        // (2,2) should pull in M1 (extends to col 4), and the new col-4
        // overlap pulls in M2 (extends to row 4).
        const merges = [
            { anchorRow: 2, anchorCol: 2, rowSpan: 1, colSpan: 3 },
            { anchorRow: 2, anchorCol: 4, rowSpan: 3, colSpan: 1 },
        ]
        expect(
            expandRangeOverMergeList(
                { startRow: 2, endRow: 2, startCol: 2, endCol: 2 },
                merges
            )
        ).toEqual({ startRow: 2, endRow: 4, startCol: 2, endCol: 4 })
    })
})
