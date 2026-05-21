import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell, setYCellStyle, setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { serializeRange } from '../tinycld/calc/lib/clipboard/serialize'

// serializeRange contract: read a rectangle of cells out of a Y.Doc
// into a dense 2D array of ClipboardCell. Empty source cells become
// typed-string blanks so the shape stays rectangular. Source anchor is
// captured for downstream formula-rewrite delta math.

describe('serializeRange', () => {
    it('captures a single cell as a 1×1 payload with its kind and raw', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 2, 3, 'hello')
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 2,
            endRow: 2,
            startCol: 3,
            endCol: 3,
        })
        expect(payload.rows).toBe(1)
        expect(payload.cols).toBe(1)
        expect(payload.cells).toEqual([[{ kind: 'string', raw: 'hello' }]])
        expect(payload.sourceAnchor).toEqual({ row: 2, col: 3 })
    })

    it('produces a dense 2D array; empty cells become typed-string blanks', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'a')
        setYCell(doc, 'sheet1', 2, 2, 'd')
        // (1,2) and (2,1) are empty
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 1,
            endRow: 2,
            startCol: 1,
            endCol: 2,
        })
        expect(payload.rows).toBe(2)
        expect(payload.cols).toBe(2)
        expect(payload.cells[0][0]).toEqual({ kind: 'string', raw: 'a' })
        expect(payload.cells[0][1]).toEqual({ kind: 'string', raw: '' })
        expect(payload.cells[1][0]).toEqual({ kind: 'string', raw: '' })
        expect(payload.cells[1][1]).toEqual({ kind: 'string', raw: 'd' })
    })

    it('preserves typed kinds (number, boolean, formula)', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, '42')
        setYCell(doc, 'sheet1', 1, 2, 'TRUE')
        setYCell(doc, 'sheet1', 1, 3, '=A1+1')
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 1,
            endRow: 1,
            startCol: 1,
            endCol: 3,
        })
        expect(payload.cells[0][0]).toMatchObject({ kind: 'number', raw: 42 })
        expect(payload.cells[0][1]).toMatchObject({ kind: 'boolean', raw: true })
        expect(payload.cells[0][2]).toMatchObject({
            kind: 'formula',
            formula: '=A1+1',
        })
    })

    it('captures style alongside value', () => {
        const doc = new Y.Doc()
        setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'string', raw: 'x', display: 'x' })
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 1,
            endRow: 1,
            startCol: 1,
            endCol: 1,
        })
        expect(payload.cells[0][0]).toMatchObject({
            kind: 'string',
            raw: 'x',
            style: { font: { bold: true } },
        })
    })

    it('captures a pure-style cell (no raw value)', () => {
        // setYCellStyle on an absent cell creates an entry that only
        // carries style. serializeRange should surface that as a typed-
        // string blank with style attached.
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { italic: true } })
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 1,
            endRow: 1,
            startCol: 1,
            endCol: 1,
        })
        expect(payload.cells[0][0]).toMatchObject({
            style: { font: { italic: true } },
        })
    })

    it('captures source anchor for paste-delta math', () => {
        const doc = new Y.Doc()
        const payload = serializeRange(doc, 'sheet1', {
            startRow: 5,
            endRow: 7,
            startCol: 4,
            endCol: 6,
        })
        expect(payload.sourceAnchor).toEqual({ row: 5, col: 4 })
        expect(payload.rows).toBe(3)
        expect(payload.cols).toBe(3)
    })
})
