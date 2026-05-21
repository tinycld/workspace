import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    applyStyleToRange,
    toggleCellFontAttrInRange,
} from '../tinycld/calc/components/grid/style-helpers'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

// Range-aware style helpers are the apply-side of multi-cell selection.
// applyStyleToRange writes the same patch to every cell in a rectangle
// inside one yjs transaction. toggleCellFontAttrInRange adds mixed-
// toggle semantics: any-off → all-on, otherwise all-off, mirroring
// Google Sheets / Excel behavior.

const SHEET = 'sheet1'

function readBold(doc: Y.Doc, row: number, col: number): boolean {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(SHEET, row, col))
    if (cell == null) return false
    return readStyleFromYMap(cell)?.font?.bold === true
}

function readNumFmt(doc: Y.Doc, row: number, col: number): string | undefined {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(SHEET, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)?.numFmt
}

describe('applyStyleToRange', () => {
    it('writes the same patch to every cell in the range', () => {
        const doc = new Y.Doc()
        applyStyleToRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
            {
                font: { bold: true },
            }
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 3; c++) {
                expect(readBold(doc, r, c)).toBe(true)
            }
        }
    })

    it('emits a single afterTransaction event for the whole range', () => {
        const doc = new Y.Doc()
        let count = 0
        doc.on('afterTransaction', () => {
            count += 1
        })
        applyStyleToRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
            {
                numFmt: '#,##0.00',
            }
        )
        // One outer transact wraps all 9 cell writes; the nested
        // setYCellStyle transactions inherit the outer one and don't
        // start their own.
        expect(count).toBe(1)
    })

    it('applies a numFmt patch to a single-cell range', () => {
        const doc = new Y.Doc()
        applyStyleToRange(
            doc,
            SHEET,
            { startRow: 4, startCol: 4, endRow: 4, endCol: 4 },
            {
                numFmt: '0%',
            }
        )
        expect(readNumFmt(doc, 4, 4)).toBe('0%')
    })

    it('is a no-op when doc is null', () => {
        // Should not throw — toolbar callbacks pass null when the
        // workbook is not yet bootstrapped.
        expect(() =>
            applyStyleToRange(
                null,
                SHEET,
                { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
                {
                    font: { bold: true },
                }
            )
        ).not.toThrow()
    })
})

describe('toggleCellFontAttrInRange (mixed-toggle semantics)', () => {
    it('promotes the whole range to bold when any cell is currently un-bold', () => {
        const doc = new Y.Doc()
        // Bold one corner; leave the rest un-bold.
        setYCellStyle(doc, SHEET, 1, 1, { font: { bold: true } })
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            'bold'
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                expect(readBold(doc, r, c)).toBe(true)
            }
        }
    })

    it('clears the whole range when every cell is already bold', () => {
        const doc = new Y.Doc()
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                setYCellStyle(doc, SHEET, r, c, { font: { bold: true } })
            }
        }
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            'bold'
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                expect(readBold(doc, r, c)).toBe(false)
            }
        }
    })

    it('promotes when the entire range is empty (treats missing as off)', () => {
        const doc = new Y.Doc()
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            'bold'
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                expect(readBold(doc, r, c)).toBe(true)
            }
        }
    })

    it('preserves the single-cell flip behavior when range is one cell', () => {
        const doc = new Y.Doc()
        // First toggle on an empty cell: off → on (any-off true).
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 3, startCol: 3, endRow: 3, endCol: 3 },
            'bold'
        )
        expect(readBold(doc, 3, 3)).toBe(true)
        // Second toggle: on → off (any-off false → next = false).
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 3, startCol: 3, endRow: 3, endCol: 3 },
            'bold'
        )
        expect(readBold(doc, 3, 3)).toBe(false)
    })
})
