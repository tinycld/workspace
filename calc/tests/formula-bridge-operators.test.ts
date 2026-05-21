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

function setupAB(doc: Y.Doc, a: number, b: number): void {
    const wb: WorkbookModel = { sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }] }
    bootstrapYDocFromWorkbook(doc, wb)
    setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: a, display: String(a) })
    setYCellTyped(doc, 'sheet1', 2, 1, { kind: 'number', raw: b, display: String(b) })
}

interface OpCase {
    label: string
    formula: string
    expected: number
}

const cases: OpCase[] = [
    { label: 'addition', formula: '=A1+A2', expected: 7 },
    { label: 'subtraction', formula: '=A1-A2', expected: 1 },
    { label: 'multiplication', formula: '=A1*A2', expected: 12 },
    { label: 'division', formula: '=A1/A2', expected: 4 / 3 },
    { label: 'exponent', formula: '=A1^A2', expected: 64 },
    { label: 'parenthesized', formula: '=(A1+A2)*2', expected: 14 },
    { label: 'unary minus', formula: '=-A1', expected: -4 },
]

describe('FormulaBridge arithmetic operators', () => {
    for (const c of cases) {
        it(`${c.label} (${c.formula})`, () => {
            const doc = new Y.Doc()
            setupAB(doc, 4, 3)
            const bridge = startBridge(doc)
            try {
                setYCellTyped(doc, 'sheet1', 1, 2, {
                    kind: 'formula',
                    raw: null,
                    display: c.formula,
                    formula: c.formula,
                })
                expect(readRaw(doc, 'sheet1', 1, 2)).toBeCloseTo(c.expected)
            } finally {
                bridge.stop()
            }
        })
    }

    it('division by zero is #DIV/0!', () => {
        const doc = new Y.Doc()
        setupAB(doc, 5, 0)
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=A1/A2',
                formula: '=A1/A2',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe('#DIV/0!')
        } finally {
            bridge.stop()
        }
    })
})
