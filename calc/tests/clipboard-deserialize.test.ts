import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell, setYCellStyle, setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { applyPayloadToDoc } from '../tinycld/calc/lib/clipboard/deserialize'
import { serializeRange } from '../tinycld/calc/lib/clipboard/serialize'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readYCell } from '../tinycld/calc/lib/y-doc-bootstrap'

// applyPayloadToDoc contract: writes the source ClipboardPayload onto
// the destination at opts.destAnchor, with semantics per mode. The
// entire paste runs inside one LOCAL_ORIGIN transaction so the undo
// manager captures it as a single step.

function newManager(doc: Y.Doc): Y.UndoManager {
    return new Y.UndoManager([doc.getMap(CELLS_MAP)], {
        captureTimeout: 0,
        trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    })
}

function readCell(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    return cell ? readYCell(cell) : null
}

function buildSource(): { doc: Y.Doc; payload: ClipboardPayload } {
    // 2×2 source at (1,1):(2,2):
    //   A1 = "alpha" (bold)        B1 = 7
    //   A2 = =A1                   B2 = (empty)
    const doc = new Y.Doc()
    setYCell(doc, 'sheet1', 1, 1, 'alpha')
    setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
    setYCell(doc, 'sheet1', 1, 2, '7')
    setYCellTyped(doc, 'sheet1', 2, 1, {
        kind: 'formula',
        raw: 'alpha', // cached value as if HF had run
        display: '=A1',
        formula: '=A1',
    })
    const payload = serializeRange(doc, 'sheet1', {
        startRow: 1,
        endRow: 2,
        startCol: 1,
        endCol: 2,
    })
    return { doc, payload }
}

describe('applyPayloadToDoc — mode: all', () => {
    it('writes values, formulas (with ref shift), and styles to the destination', () => {
        const { doc, payload } = buildSource()
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'all',
            destAnchor: { row: 5, col: 5 },
        })
        // Source delta is (5-1, 5-1) = (4, 4).
        expect(readCell(doc, 'sheet1', 5, 5)).toMatchObject({
            kind: 'string',
            raw: 'alpha',
            style: { font: { bold: true } },
        })
        expect(readCell(doc, 'sheet1', 5, 6)).toMatchObject({ kind: 'number', raw: 7 })
        // =A1 with delta (4,4) → =E5
        expect(readCell(doc, 'sheet1', 6, 5)).toMatchObject({
            kind: 'formula',
            formula: '=E5',
        })
        // Empty source cell (2,2) clears the destination — but the
        // destination at (6,6) was empty to begin with, so it stays empty.
        expect(readCell(doc, 'sheet1', 6, 6)).toBeNull()
    })

    it('clears destination cells where the source was blank', () => {
        const { doc, payload } = buildSource()
        // Pre-populate the dest blank corner so we can see it cleared.
        setYCell(doc, 'sheet1', 6, 6, 'preexisting')
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'all',
            destAnchor: { row: 5, col: 5 },
        })
        expect(readCell(doc, 'sheet1', 6, 6)).toBeNull()
    })
})

describe('applyPayloadToDoc — mode: values', () => {
    it('drops formulas and styles; pastes only the cached scalar', () => {
        const { doc, payload } = buildSource()
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'values',
            destAnchor: { row: 5, col: 5 },
        })
        // =A1 source (cached raw "alpha") lands as a plain string.
        const formulaCell = readCell(doc, 'sheet1', 6, 5)
        expect(formulaCell?.kind).toBe('string')
        expect(formulaCell?.raw).toBe('alpha')
        expect(formulaCell?.formula).toBeUndefined()
        // Source A1 had bold style — values-only drops it.
        expect(readCell(doc, 'sheet1', 5, 5)?.style).toBeUndefined()
    })

    it('preserves typed kinds for non-formula source cells', () => {
        const { doc, payload } = buildSource()
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'values',
            destAnchor: { row: 5, col: 5 },
        })
        expect(readCell(doc, 'sheet1', 5, 6)).toMatchObject({ kind: 'number', raw: 7 })
    })
})

describe('applyPayloadToDoc — mode: formulas', () => {
    it('writes value and formula (with ref shift) but no style', () => {
        const { doc, payload } = buildSource()
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'formulas',
            destAnchor: { row: 5, col: 5 },
        })
        // =A1 shifted to =E5 lands.
        expect(readCell(doc, 'sheet1', 6, 5)).toMatchObject({
            kind: 'formula',
            formula: '=E5',
        })
        // Bold from source A1 is NOT carried.
        expect(readCell(doc, 'sheet1', 5, 5)?.style).toBeUndefined()
    })
})

describe('applyPayloadToDoc — mode: format', () => {
    it('writes only style; leaves destination value/formula intact', () => {
        const { doc, payload } = buildSource()
        // Pre-populate destination with values that should be preserved.
        setYCell(doc, 'sheet1', 5, 5, 'keepMe')
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'format',
            destAnchor: { row: 5, col: 5 },
        })
        const cell = readCell(doc, 'sheet1', 5, 5)
        expect(cell?.raw).toBe('keepMe')
        expect(cell?.style).toMatchObject({ font: { bold: true } })
    })

    it('does not delete the destination when the source cell is blank', () => {
        const { doc, payload } = buildSource()
        // Pre-populate the dest cell corresponding to source (2,2)
        // (which is blank). Format-only must leave it alone.
        setYCell(doc, 'sheet1', 6, 6, 'survivor')
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'format',
            destAnchor: { row: 5, col: 5 },
        })
        expect(readCell(doc, 'sheet1', 6, 6)?.raw).toBe('survivor')
    })
})

describe('applyPayloadToDoc — mode: transpose', () => {
    it('swaps rows and columns at the destination', () => {
        const { doc, payload } = buildSource()
        // Source 2×2:  A1=alpha, B1=7
        //              A2=(=A1), B2=blank
        // Transposed   row0col0=alpha,    row0col1=(=A1)
        //              row1col0=7,        row1col1=blank
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'transpose',
            destAnchor: { row: 5, col: 5 },
        })
        expect(readCell(doc, 'sheet1', 5, 5)?.raw).toBe('alpha')
        // Formula is at (5,6) in the transposed layout. Refs still shift
        // by the (4,4) destination-source delta.
        expect(readCell(doc, 'sheet1', 5, 6)).toMatchObject({
            kind: 'formula',
            formula: '=E5',
        })
        expect(readCell(doc, 'sheet1', 6, 5)?.raw).toBe(7)
        expect(readCell(doc, 'sheet1', 6, 6)).toBeNull()
    })
})

describe('applyPayloadToDoc — single undo step', () => {
    it('wraps the entire paste in one LOCAL_ORIGIN transaction', () => {
        // Build the doc + manager *before* the paste so the manager
        // observes only the paste's transactions.
        const doc = new Y.Doc()
        // Seed some pre-paste state with bare doc.transact (no origin)
        // so the undo manager doesn't see it.
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            const c = new Y.Map<unknown>()
            c.set('kind', 'string')
            c.set('raw', 'preseed')
            c.set('display', 'preseed')
            cellsMap.set(yCellKey('sheet1', 1, 1), c)
        })

        const manager = newManager(doc)

        // Build a fresh payload (no Y.Doc-coupled side effects).
        const payload: ClipboardPayload = {
            rows: 3,
            cols: 3,
            sourceAnchor: { row: 1, col: 1 },
            cells: [
                [
                    { kind: 'string', raw: 'a' },
                    { kind: 'string', raw: 'b' },
                    { kind: 'string', raw: 'c' },
                ],
                [
                    { kind: 'string', raw: 'd' },
                    { kind: 'string', raw: 'e' },
                    { kind: 'string', raw: 'f' },
                ],
                [
                    { kind: 'string', raw: 'g' },
                    { kind: 'string', raw: 'h' },
                    { kind: 'string', raw: 'i' },
                ],
            ],
        }
        applyPayloadToDoc(doc, 'sheet1', payload, {
            mode: 'all',
            destAnchor: { row: 10, col: 10 },
        })

        // 3x3 = 9 destination cells, all written in one undo step.
        expect(manager.undoStack.length).toBe(1)
        // Sanity: cells landed.
        expect(readCell(doc, 'sheet1', 10, 10)?.raw).toBe('a')
        expect(readCell(doc, 'sheet1', 12, 12)?.raw).toBe('i')

        // One undo reverts every destination cell.
        manager.undo()
        expect(readCell(doc, 'sheet1', 10, 10)).toBeNull()
        expect(readCell(doc, 'sheet1', 12, 12)).toBeNull()
        // Pre-seed survives.
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('preseed')
    })
})
