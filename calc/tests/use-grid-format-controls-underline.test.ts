import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    applyStyleToRange,
    toggleCellFontAttrInRange,
} from '../tinycld/calc/components/grid/style-helpers'
import type { CellRange } from '../tinycld/calc/hooks/grid-store'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

// useGridToolbarToggles' onToggleUnderline routes through
// toggleCellFontAttrInRange exactly the same way bold/italic/strike do.
// These tests exercise that pipeline against a Y.Doc so the React
// wiring stays out of the way — same approach the existing
// use-grid-format-controls.test.ts file uses for its own slice.

function readStyle(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)
}

function readUnderline(doc: Y.Doc, sheetId: string, row: number, col: number): boolean {
    return readStyle(doc, sheetId, row, col)?.font?.underline === true
}

function singleCell(row: number, col: number): CellRange {
    return { startRow: row, startCol: col, endRow: row, endCol: col }
}

describe('toggle underline — single cell', () => {
    it('first toggle on an empty cell writes underline=true', () => {
        const doc = new Y.Doc()
        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(false)

        toggleCellFontAttrInRange(doc, 'sheet1', singleCell(1, 1), 'underline')

        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(true)
    })

    it('second toggle flips underline back to false', () => {
        const doc = new Y.Doc()
        toggleCellFontAttrInRange(doc, 'sheet1', singleCell(1, 1), 'underline')
        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(true)

        toggleCellFontAttrInRange(doc, 'sheet1', singleCell(1, 1), 'underline')

        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(false)
    })

    it('underline composes with bold/italic/strike independently', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, {
            font: { bold: true, italic: true, strike: true },
        })

        toggleCellFontAttrInRange(doc, 'sheet1', singleCell(1, 1), 'underline')

        const style = readStyle(doc, 'sheet1', 1, 1)
        expect(style?.font?.bold).toBe(true)
        expect(style?.font?.italic).toBe(true)
        expect(style?.font?.strike).toBe(true)
        expect(style?.font?.underline).toBe(true)
    })
})

describe('toggle underline — range with mixed state', () => {
    it('any-off → all-on across the range', () => {
        const doc = new Y.Doc()
        // A 2x2 range with one cell already underlined and the rest off.
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { underline: true } })

        const range: CellRange = { startRow: 1, startCol: 1, endRow: 2, endCol: 2 }
        toggleCellFontAttrInRange(doc, 'sheet1', range, 'underline')

        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 1, 2)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 2, 1)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 2, 2)).toBe(true)
    })

    it('all-on → all-off across the range', () => {
        const doc = new Y.Doc()
        const range: CellRange = { startRow: 1, startCol: 1, endRow: 2, endCol: 2 }
        applyStyleToRange(doc, 'sheet1', range, { font: { underline: true } })

        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 2, 2)).toBe(true)

        toggleCellFontAttrInRange(doc, 'sheet1', range, 'underline')

        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(false)
        expect(readUnderline(doc, 'sheet1', 1, 2)).toBe(false)
        expect(readUnderline(doc, 'sheet1', 2, 1)).toBe(false)
        expect(readUnderline(doc, 'sheet1', 2, 2)).toBe(false)
    })

    it('all-off → all-on across the range', () => {
        const doc = new Y.Doc()
        const range: CellRange = { startRow: 1, startCol: 1, endRow: 2, endCol: 2 }

        toggleCellFontAttrInRange(doc, 'sheet1', range, 'underline')

        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 1, 2)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 2, 1)).toBe(true)
        expect(readUnderline(doc, 'sheet1', 2, 2)).toBe(true)
    })
})

describe('isUnderline read state — anchor-cell semantics', () => {
    // useGridToolbarToggles derives isUnderline from the anchor cell's
    // style only. These tests pin that read path by reading directly
    // from the Y.Doc the same way the hook's selectedCellValue would.

    it('reads true when the anchor cell has underline set', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { underline: true } })
        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(true)
    })

    it('reads false when the anchor cell does not have underline set', () => {
        const doc = new Y.Doc()
        // A neighbour is underlined; the anchor (1,1) is not.
        setYCellStyle(doc, 'sheet1', 1, 2, { font: { underline: true } })
        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(false)
        expect(readUnderline(doc, 'sheet1', 1, 2)).toBe(true)
    })

    it('reads false when the anchor cell explicitly has underline=false even with a peer on', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { underline: false } })
        setYCellStyle(doc, 'sheet1', 2, 2, { font: { underline: true } })
        expect(readUnderline(doc, 'sheet1', 1, 1)).toBe(false)
    })
})
