import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { FormulaBridge } from '../tinycld/calc/lib/formula/bridge'
import { HYPERFORMULA_LICENSE_KEY } from '../tinycld/calc/lib/formula/hyperformula-license'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { bootstrapYDocFromWorkbook, CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function startBridge(doc: Y.Doc): FormulaBridge {
    const hf = HyperFormula.buildEmpty({ licenseKey: HYPERFORMULA_LICENSE_KEY })
    const bridge = new FormulaBridge(doc, hf)
    bridge.start()
    return bridge
}

function readRaw(doc: Y.Doc, sheetId: string, row: number, col: number): unknown {
    return doc
        .getMap<Y.Map<unknown>>(CELLS_MAP)
        .get(yCellKey(sheetId, row, col))
        ?.get('raw')
}

function setupNumbers(doc: Y.Doc): void {
    const wb: WorkbookModel = { sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }] }
    bootstrapYDocFromWorkbook(doc, wb)
    setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 2, display: '2' })
    setYCellTyped(doc, 'sheet1', 2, 1, { kind: 'number', raw: 4, display: '4' })
    setYCellTyped(doc, 'sheet1', 3, 1, { kind: 'number', raw: 6, display: '6' })
}

describe('FormulaBridge SUM and AVERAGE', () => {
    it('SUM over a range', () => {
        const doc = new Y.Doc()
        setupNumbers(doc)
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=SUM(A1:A3)',
                formula: '=SUM(A1:A3)',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(12)
        } finally {
            bridge.stop()
        }
    })

    it('AVERAGE over a range', () => {
        const doc = new Y.Doc()
        setupNumbers(doc)
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=AVERAGE(A1:A3)',
                formula: '=AVERAGE(A1:A3)',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(4)
        } finally {
            bridge.stop()
        }
    })

    it('AVERAGE on empty input is #DIV/0!', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, {
            sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }],
        })
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, {
                kind: 'formula',
                raw: null,
                display: '=AVERAGE(B1:B3)',
                formula: '=AVERAGE(B1:B3)',
            })
            const raw = readRaw(doc, 'sheet1', 1, 1)
            expect(raw).toBe('#DIV/0!')
        } finally {
            bridge.stop()
        }
    })

    it('SUM with mixed scalars', () => {
        const doc = new Y.Doc()
        setupNumbers(doc)
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=SUM(A1, A2, 3)',
                formula: '=SUM(A1, A2, 3)',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(9)
        } finally {
            bridge.stop()
        }
    })
})
