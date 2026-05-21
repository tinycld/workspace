import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

// The toolbar's bold/italic buttons are two-step: read the cell's current
// style, flip the relevant boolean, write back. The toggle handler in
// Grid.tsx encodes this as `current?.font?.bold !== true` (so missing
// or false both flip to true; only an explicit true flips to false).
// These tests exercise that read/flip/write sequence end-to-end against
// the Y.Doc to make sure it behaves the same way the toolbar will at
// runtime.

function readBold(doc: Y.Doc, sheetId: string, row: number, col: number): boolean {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return false
    return readStyleFromYMap(cell)?.font?.bold === true
}

function readItalic(doc: Y.Doc, sheetId: string, row: number, col: number): boolean {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return false
    return readStyleFromYMap(cell)?.font?.italic === true
}

function readStrike(doc: Y.Doc, sheetId: string, row: number, col: number): boolean {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return false
    return readStyleFromYMap(cell)?.font?.strike === true
}

describe('toolbar bold/italic toggle sequence', () => {
    it('first bold toggle on an empty cell writes bold=true', () => {
        const doc = new Y.Doc()
        expect(readBold(doc, 'sheet1', 1, 1)).toBe(false)

        const next = readBold(doc, 'sheet1', 1, 1) !== true
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: next } })

        expect(readBold(doc, 'sheet1', 1, 1)).toBe(true)
    })

    it('second bold toggle flips back to false', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        expect(readBold(doc, 'sheet1', 1, 1)).toBe(true)

        const next = readBold(doc, 'sheet1', 1, 1) !== true
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: next } })

        expect(readBold(doc, 'sheet1', 1, 1)).toBe(false)
    })

    it('italic toggle is independent of bold', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })

        const next = readItalic(doc, 'sheet1', 1, 1) !== true
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { italic: next } })

        expect(readBold(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readItalic(doc, 'sheet1', 1, 1)).toBe(true)
    })

    it('toggling italic off leaves bold intact', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true, italic: true } })

        const next = readItalic(doc, 'sheet1', 1, 1) !== true
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { italic: next } })

        expect(readBold(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readItalic(doc, 'sheet1', 1, 1)).toBe(false)
    })

    it('first strike toggle on an empty cell writes strike=true', () => {
        const doc = new Y.Doc()
        expect(readStrike(doc, 'sheet1', 1, 1)).toBe(false)

        const next = readStrike(doc, 'sheet1', 1, 1) !== true
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { strike: next } })

        expect(readStrike(doc, 'sheet1', 1, 1)).toBe(true)
    })

    it('strike is independent of bold/italic', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true, italic: true } })

        const next = readStrike(doc, 'sheet1', 1, 1) !== true
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { strike: next } })

        expect(readBold(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readItalic(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readStrike(doc, 'sheet1', 1, 1)).toBe(true)
    })
})
