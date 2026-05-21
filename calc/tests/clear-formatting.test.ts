import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { clearFormattingInRange } from '../tinycld/calc/hooks/use-clear-formatting'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, STYLE_KEY } from '../tinycld/calc/lib/y-doc-bootstrap'

describe('clearFormattingInRange', () => {
    it('removes the style sub-Y.Map from every cell in the range', () => {
        const doc = new Y.Doc()
        const sheetId = 'sheet1'

        setYCellStyle(doc, sheetId, 1, 1, {
            font: { bold: true, color: '#ff0000', size: 14 },
            fill: { fgColor: '#00ff00' },
            alignment: { horizontal: 'center' },
            numFmt: '0.00%',
        })
        setYCellStyle(doc, sheetId, 1, 2, { font: { italic: true } })

        clearFormattingInRange(doc, sheetId, {
            startRow: 1,
            startCol: 1,
            endRow: 1,
            endCol: 2,
        })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const a1 = cellsMap.get(yCellKey(sheetId, 1, 1))
        const b1 = cellsMap.get(yCellKey(sheetId, 1, 2))
        expect(a1?.get(STYLE_KEY)).toBeUndefined()
        expect(b1?.get(STYLE_KEY)).toBeUndefined()
    })

    it('leaves cell value/formula intact while clearing style', () => {
        const doc = new Y.Doc()
        const sheetId = 'sheet1'
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

        const cell = new Y.Map<unknown>()
        cell.set('kind', 'number')
        cell.set('raw', 42)
        cell.set('display', '42')
        cell.set('formula', '=A1+1')
        cellsMap.set(yCellKey(sheetId, 1, 1), cell)
        setYCellStyle(doc, sheetId, 1, 1, { font: { bold: true } })

        clearFormattingInRange(doc, sheetId, {
            startRow: 1,
            startCol: 1,
            endRow: 1,
            endCol: 1,
        })

        const after = cellsMap.get(yCellKey(sheetId, 1, 1))
        expect(after?.get(STYLE_KEY)).toBeUndefined()
        expect(after?.get('kind')).toBe('number')
        expect(after?.get('raw')).toBe(42)
        expect(after?.get('display')).toBe('42')
        expect(after?.get('formula')).toBe('=A1+1')
    })

    it('is a no-op for cells with no existing entry', () => {
        const doc = new Y.Doc()
        const sheetId = 'sheet1'
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

        clearFormattingInRange(doc, sheetId, {
            startRow: 1,
            startCol: 1,
            endRow: 2,
            endCol: 2,
        })

        expect(cellsMap.size).toBe(0)
    })
})
