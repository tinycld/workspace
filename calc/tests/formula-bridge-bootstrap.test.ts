import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { FormulaBridge } from '../tinycld/calc/lib/formula/bridge'
import { HYPERFORMULA_LICENSE_KEY } from '../tinycld/calc/lib/formula/hyperformula-license'
import { cellKey, type WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { bootstrapYDocFromWorkbook, CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function startBridge(doc: Y.Doc): { bridge: FormulaBridge; hf: HyperFormula } {
    const hf = HyperFormula.buildEmpty({ licenseKey: HYPERFORMULA_LICENSE_KEY })
    const bridge = new FormulaBridge(doc, hf)
    bridge.start()
    return { bridge, hf }
}

function readRaw(doc: Y.Doc, sheetId: string, row: number, col: number): unknown {
    return doc
        .getMap<Y.Map<unknown>>(CELLS_MAP)
        .get(yCellKey(sheetId, row, col))
        ?.get('raw')
}

describe('FormulaBridge bootstrap', () => {
    it('populates a formula cell that has no cached raw on cold start', () => {
        const doc = new Y.Doc()
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'Sheet1',
                    rowCount: 3,
                    colCount: 2,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'number', raw: 10, display: '10' },
                        [cellKey(2, 1)]: { kind: 'number', raw: 20, display: '20' },
                        [cellKey(1, 2)]: {
                            kind: 'formula',
                            raw: null,
                            display: '=SUM(A1:A2)',
                            formula: '=SUM(A1:A2)',
                        },
                    },
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)

        const { bridge } = startBridge(doc)
        try {
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(30)
        } finally {
            bridge.stop()
        }
    })

    it('overwrites a stale cached raw on cold start', () => {
        const doc = new Y.Doc()
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'Sheet1',
                    rowCount: 3,
                    colCount: 2,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'number', raw: 5, display: '5' },
                        [cellKey(2, 1)]: { kind: 'number', raw: 5, display: '5' },
                        [cellKey(1, 2)]: {
                            kind: 'formula',
                            raw: 999, // stale
                            display: '999',
                            formula: '=SUM(A1:A2)',
                        },
                    },
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)

        const { bridge } = startBridge(doc)
        try {
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(10)
        } finally {
            bridge.stop()
        }
    })

    it('handles multiple sheets independently', () => {
        const doc = new Y.Doc()
        const wb: WorkbookModel = {
            sheets: [
                {
                    name: 'A',
                    rowCount: 2,
                    colCount: 2,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'number', raw: 1, display: '1' },
                        [cellKey(1, 2)]: {
                            kind: 'formula',
                            raw: null,
                            display: '=A1*10',
                            formula: '=A1*10',
                        },
                    },
                },
                {
                    name: 'B',
                    rowCount: 2,
                    colCount: 2,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'number', raw: 7, display: '7' },
                        [cellKey(1, 2)]: {
                            kind: 'formula',
                            raw: null,
                            display: '=A1+5',
                            formula: '=A1+5',
                        },
                    },
                },
            ],
        }
        bootstrapYDocFromWorkbook(doc, wb)

        const { bridge } = startBridge(doc)
        try {
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(10)
            expect(readRaw(doc, 'sheet2', 1, 2)).toBe(12)
        } finally {
            bridge.stop()
        }
    })
})
