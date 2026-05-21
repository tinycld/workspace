import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell, setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { detectHeaderRow, sortRange } from '../tinycld/calc/lib/sort'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    CELLS_MAP,
    readStyleFromYMap,
    readYCell,
    SHEETS_MAP,
} from '../tinycld/calc/lib/y-doc-bootstrap'

function seedSheet(doc: Y.Doc, sheetId: string): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', sheetId)
    meta.set('position', 0)
    meta.set('rowCount', 100)
    meta.set('colCount', 10)
    sheetsMap.set(sheetId, meta)
}

function readCell(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    return cell ? readYCell(cell) : null
}

describe('sortRange', () => {
    it('sorts numbers ascending and descending', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, '3')
        setYCell(doc, 'sheet1', 2, 1, '1')
        setYCell(doc, 'sheet1', 3, 1, '2')

        const res = sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            1,
            'asc',
            false
        )
        expect(res.ok).toBe(true)
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe(1)
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe(2)
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe(3)

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            1,
            'desc',
            false
        )
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe(3)
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe(2)
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe(1)
    })

    it('sorts strings locale-aware', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Banana')
        setYCell(doc, 'sheet1', 2, 1, 'apple')
        setYCell(doc, 'sheet1', 3, 1, 'Cherry')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            1,
            'asc',
            false
        )
        // localeCompare puts 'apple' before 'Banana' before 'Cherry' (case-insensitive ish).
        const ordered = [
            readCell(doc, 'sheet1', 1, 1)?.raw,
            readCell(doc, 'sheet1', 2, 1)?.raw,
            readCell(doc, 'sheet1', 3, 1)?.raw,
        ]
        const expected = ['Banana', 'apple', 'Cherry'].sort((a, b) => a.localeCompare(b))
        expect(ordered).toEqual(expected)
    })

    it('sorts mixed types with nulls last', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'banana')
        // Row 2 column 1 left empty
        setYCell(doc, 'sheet1', 3, 1, '5')
        setYCell(doc, 'sheet1', 4, 1, 'apple')
        setYCell(doc, 'sheet1', 5, 1, '10')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 5, startCol: 1, endCol: 1 },
            1,
            'asc',
            false
        )
        // Numbers first (5, 10), then strings localeCompare-sorted, then null last.
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe(5)
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe(10)
        // Last row should be empty (nulls last).
        expect(readCell(doc, 'sheet1', 5, 1)).toBeNull()
    })

    it('respects hasHeader and leaves the header row alone', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Score')
        setYCell(doc, 'sheet1', 2, 1, '3')
        setYCell(doc, 'sheet1', 3, 1, '1')
        setYCell(doc, 'sheet1', 4, 1, '2')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            1,
            'asc',
            true
        )
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('Score')
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe(1)
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe(2)
        expect(readCell(doc, 'sheet1', 4, 1)?.raw).toBe(3)
    })

    it('preserves cell styles across rows', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        // Row 1: value 'b' with bold style.
        setYCell(doc, 'sheet1', 1, 1, 'b')
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCell(doc, 'sheet1', 2, 1, 'a')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            1,
            'asc',
            false
        )
        // 'a' moved to row 1, 'b' (with bold) moved to row 2. Bold rides
        // along with the cell, not the row.
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('a')
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe('b')

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const bCell = cellsMap.get(yCellKey('sheet1', 2, 1))
        const style = bCell ? readStyleFromYMap(bCell) : undefined
        expect(style?.font?.bold).toBe(true)

        const aCell = cellsMap.get(yCellKey('sheet1', 1, 1))
        const aStyle = aCell ? readStyleFromYMap(aCell) : undefined
        expect(aStyle?.font?.bold).toBeUndefined()
    })

    it('one undo step restores original order', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, '3')
        setYCell(doc, 'sheet1', 2, 1, '1')
        setYCell(doc, 'sheet1', 3, 1, '2')

        const manager = new Y.UndoManager([doc.getMap(CELLS_MAP)], {
            captureTimeout: 0,
            trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
        })

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            1,
            'asc',
            false
        )
        expect(manager.undoStack.length).toBe(1)
        manager.undo()
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe(3)
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe(1)
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe(2)
    })

    it('dissolves merges that overlap the sort range and reports count', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, '3')
        setYCell(doc, 'sheet1', 2, 1, '1')
        setYCell(doc, 'sheet1', 3, 1, '2')

        // Add a `merges` Y.Map directly with two entries: one inside
        // the sort range, one outside.
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = sheetsMap.get('sheet1')
        if (meta == null) throw new Error('seed failed')
        const merges = new Y.Map<unknown>()
        meta.set('merges', merges)
        const inside = new Y.Map<unknown>()
        inside.set('rowSpan', 1)
        inside.set('colSpan', 2)
        merges.set('1:1', inside)
        const outside = new Y.Map<unknown>()
        outside.set('rowSpan', 1)
        outside.set('colSpan', 2)
        merges.set('10:5', outside)

        const res = sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            1,
            'asc',
            false
        )
        expect(res.mergesBroken).toBe(1)
        expect(merges.has('1:1')).toBe(false)
        expect(merges.has('10:5')).toBe(true)
    })

    it('detectHeaderRow returns true when first row is text and a later row has a number', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Score')
        setYCell(doc, 'sheet1', 2, 1, '5')
        setYCell(doc, 'sheet1', 3, 1, '10')

        expect(
            detectHeaderRow(doc, 'sheet1', { startRow: 1, endRow: 3, startCol: 1, endCol: 1 })
        ).toBe(true)
    })

    it('keeps empty rows last when sorting descending across a sparse range', () => {
        // Regression: a Z→A sort on a column-header range that spans
        // every row of the sheet used to flip empty rows to the top,
        // pushing real data off the visible area.
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Apple')
        setYCell(doc, 'sheet1', 2, 1, 'Banana')
        setYCell(doc, 'sheet1', 3, 1, 'Cherry')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 100, startCol: 1, endCol: 1 },
            1,
            'desc',
            false
        )

        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('Cherry')
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe('Banana')
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe('Apple')
        expect(readCell(doc, 'sheet1', 4, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 50, 1)).toBeNull()
    })

    it('does not delete data when the range extends well past the populated rows', () => {
        // Simulates the column-header "Sort sheet A→Z" flow where the
        // range spans every row of the sheet (1..100) but only a handful
        // of rows actually have data. Empty cells must sort last and
        // populated rows must survive at the top.
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Banana')
        setYCell(doc, 'sheet1', 1, 2, '2')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 2, 2, '1')
        setYCell(doc, 'sheet1', 3, 1, 'Cherry')
        setYCell(doc, 'sheet1', 3, 2, '3')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 100, startCol: 1, endCol: 10 },
            1,
            'asc',
            false
        )

        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('Apple')
        expect(readCell(doc, 'sheet1', 1, 2)?.raw).toBe(1)
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe('Banana')
        expect(readCell(doc, 'sheet1', 2, 2)?.raw).toBe(2)
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe('Cherry')
        expect(readCell(doc, 'sheet1', 3, 2)?.raw).toBe(3)
        // Trailing rows should be empty.
        expect(readCell(doc, 'sheet1', 4, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 50, 1)).toBeNull()
    })

    it('sorts entire rows across all columns when the range spans multiple columns', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        // Three rows, three columns: sort key in col 1, sibling
        // payload in cols 2 and 3 that must travel with their row.
        setYCell(doc, 'sheet1', 1, 1, '3')
        setYCell(doc, 'sheet1', 1, 2, 'three-b')
        setYCell(doc, 'sheet1', 1, 3, 'three-c')
        setYCell(doc, 'sheet1', 2, 1, '1')
        setYCell(doc, 'sheet1', 2, 2, 'one-b')
        setYCell(doc, 'sheet1', 2, 3, 'one-c')
        setYCell(doc, 'sheet1', 3, 1, '2')
        setYCell(doc, 'sheet1', 3, 2, 'two-b')
        setYCell(doc, 'sheet1', 3, 3, 'two-c')

        sortRange(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 3 },
            1,
            'asc',
            false
        )

        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe(1)
        expect(readCell(doc, 'sheet1', 1, 2)?.raw).toBe('one-b')
        expect(readCell(doc, 'sheet1', 1, 3)?.raw).toBe('one-c')
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe(2)
        expect(readCell(doc, 'sheet1', 2, 2)?.raw).toBe('two-b')
        expect(readCell(doc, 'sheet1', 2, 3)?.raw).toBe('two-c')
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe(3)
        expect(readCell(doc, 'sheet1', 3, 2)?.raw).toBe('three-b')
        expect(readCell(doc, 'sheet1', 3, 3)?.raw).toBe('three-c')
    })

    it('detectHeaderRow returns false when first row already contains a number', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, '5')
        setYCell(doc, 'sheet1', 2, 1, '10')

        expect(
            detectHeaderRow(doc, 'sheet1', { startRow: 1, endRow: 2, startCol: 1, endCol: 1 })
        ).toBe(false)
    })
})
