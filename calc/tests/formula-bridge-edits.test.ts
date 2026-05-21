import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { FormulaBridge } from '../tinycld/calc/lib/formula/bridge'
import { HYPERFORMULA_LICENSE_KEY } from '../tinycld/calc/lib/formula/hyperformula-license'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { bootstrapYDocFromWorkbook, CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function emptySheet(): WorkbookModel {
    return {
        sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }],
    }
}

function readRaw(doc: Y.Doc, sheetId: string, row: number, col: number): unknown {
    return doc
        .getMap<Y.Map<unknown>>(CELLS_MAP)
        .get(yCellKey(sheetId, row, col))
        ?.get('raw')
}

function startBridge(doc: Y.Doc): FormulaBridge {
    const hf = HyperFormula.buildEmpty({ licenseKey: HYPERFORMULA_LICENSE_KEY })
    const bridge = new FormulaBridge(doc, hf)
    bridge.start()
    return bridge
}

describe('FormulaBridge live edits', () => {
    it('computes a SUM formula when its arguments are entered', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 1, display: '1' })
            setYCellTyped(doc, 'sheet1', 2, 1, { kind: 'number', raw: 2, display: '2' })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=SUM(A1:A2)',
                formula: '=SUM(A1:A2)',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(3)
        } finally {
            bridge.stop()
        }
    })

    it('recomputes downstream cells when an input changes', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 5, display: '5' })
            setYCellTyped(doc, 'sheet1', 2, 1, { kind: 'number', raw: 5, display: '5' })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=A1+A2',
                formula: '=A1+A2',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(10)

            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 100, display: '100' })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(105)
        } finally {
            bridge.stop()
        }
    })

    it('handles chained dependencies', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 2, display: '2' })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=A1*3',
                formula: '=A1*3',
            })
            setYCellTyped(doc, 'sheet1', 1, 3, {
                kind: 'formula',
                raw: null,
                display: '=B1+1',
                formula: '=B1+1',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(6)
            expect(readRaw(doc, 'sheet1', 1, 3)).toBe(7)

            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 10, display: '10' })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(30)
            expect(readRaw(doc, 'sheet1', 1, 3)).toBe(31)
        } finally {
            bridge.stop()
        }
    })

    it('surfaces a cycle as an error string in raw', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, {
                kind: 'formula',
                raw: null,
                display: '=B1',
                formula: '=B1',
            })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=A1',
                formula: '=A1',
            })
            const a1 = readRaw(doc, 'sheet1', 1, 1)
            const b1 = readRaw(doc, 'sheet1', 1, 2)
            expect(typeof a1).toBe('string')
            expect(typeof b1).toBe('string')
            // HF surfaces cycles as #CYCLE!
            expect(a1).toMatch(/^#/)
            expect(b1).toMatch(/^#/)
        } finally {
            bridge.stop()
        }
    })
})
