import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyCsvToDoc } from '../tinycld/calc/lib/csv/apply-paste'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readYCell } from '../tinycld/calc/lib/y-doc-bootstrap'

function readCell(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    return cell ? readYCell(cell) : null
}

describe('applyCsvToDoc — type detection', () => {
    it('detects numbers, booleans, ISO dates, and strings', () => {
        const doc = new Y.Doc()
        applyCsvToDoc(doc, 'sheet1', 1, 1, [
            ['Name', 'Score', 'Active', 'Joined'],
            ['Alice', '42', 'TRUE', '2024-01-15'],
            ['Bob', '37.5', 'false', 'plain text'],
        ])

        expect(readCell(doc, 'sheet1', 1, 1)).toMatchObject({ kind: 'string', raw: 'Name' })
        expect(readCell(doc, 'sheet1', 2, 1)).toMatchObject({ kind: 'string', raw: 'Alice' })
        expect(readCell(doc, 'sheet1', 2, 2)).toMatchObject({ kind: 'number', raw: 42 })
        expect(readCell(doc, 'sheet1', 2, 3)).toMatchObject({ kind: 'boolean', raw: true })
        expect(readCell(doc, 'sheet1', 2, 4)).toMatchObject({
            kind: 'date',
            raw: '2024-01-15',
        })
        expect(readCell(doc, 'sheet1', 3, 2)).toMatchObject({ kind: 'number', raw: 37.5 })
        expect(readCell(doc, 'sheet1', 3, 3)).toMatchObject({ kind: 'boolean', raw: false })
        expect(readCell(doc, 'sheet1', 3, 4)).toMatchObject({
            kind: 'string',
            raw: 'plain text',
        })
    })

    it('writes at the given anchor offset', () => {
        const doc = new Y.Doc()
        applyCsvToDoc(doc, 'sheet1', 5, 3, [['hello']])
        expect(readCell(doc, 'sheet1', 5, 3)?.raw).toBe('hello')
        expect(readCell(doc, 'sheet1', 1, 1)).toBeNull()
    })

    it('clears destination cells where the source string is empty', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        // Pre-populate (1,2) so we can see it cleared.
        const pre = new Y.Map<unknown>()
        pre.set('kind', 'string')
        pre.set('raw', 'preexisting')
        pre.set('display', 'preexisting')
        cellsMap.set(yCellKey('sheet1', 1, 2), pre)

        applyCsvToDoc(doc, 'sheet1', 1, 1, [['a', '', 'c']])
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('a')
        expect(readCell(doc, 'sheet1', 1, 2)).toBeNull()
        expect(readCell(doc, 'sheet1', 1, 3)?.raw).toBe('c')
    })

    it('wraps all writes in a single LOCAL_ORIGIN transaction (single undo step)', () => {
        const doc = new Y.Doc()
        const undo = new Y.UndoManager(doc.getMap(CELLS_MAP), {
            captureTimeout: 0,
            trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
        })

        applyCsvToDoc(doc, 'sheet1', 1, 1, [
            ['a', 'b'],
            ['c', 'd'],
        ])

        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('a')
        expect(readCell(doc, 'sheet1', 2, 2)?.raw).toBe('d')

        undo.undo()
        // Single undo should clear every imported cell.
        expect(readCell(doc, 'sheet1', 1, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 1, 2)).toBeNull()
        expect(readCell(doc, 'sheet1', 2, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 2, 2)).toBeNull()
    })
})
