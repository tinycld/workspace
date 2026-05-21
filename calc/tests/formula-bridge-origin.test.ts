import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { FormulaBridge } from '../tinycld/calc/lib/formula/bridge'
import { HYPERFORMULA_LICENSE_KEY } from '../tinycld/calc/lib/formula/hyperformula-license'
import { FORMULA_ORIGIN } from '../tinycld/calc/lib/formula/origins'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { bootstrapYDocFromWorkbook, CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function startBridge(doc: Y.Doc): FormulaBridge {
    const hf = HyperFormula.buildEmpty({ licenseKey: HYPERFORMULA_LICENSE_KEY })
    const bridge = new FormulaBridge(doc, hf)
    bridge.start()
    return bridge
}

describe('FormulaBridge origin tagging', () => {
    it('tags writebacks with FORMULA_ORIGIN', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, {
            sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }],
        } satisfies WorkbookModel)

        const observedOrigins: unknown[] = []
        doc.on('afterTransaction', txn => {
            // Filter out the bootstrap and user-edit transactions; the
            // ones triggered by HF carry FORMULA_ORIGIN.
            if (txn.changed.size === 0) return
            observedOrigins.push(txn.origin)
        })

        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 2, display: '2' })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=A1*5',
                formula: '=A1*5',
            })
            const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
            expect(cellsMap.get(yCellKey('sheet1', 1, 2))?.get('raw')).toBe(10)
            // At least one observed transaction must carry FORMULA_ORIGIN
            // (the writeback). We don't assert on the count because
            // transaction grouping is yjs-internal.
            expect(observedOrigins.some(o => o === FORMULA_ORIGIN)).toBe(true)
        } finally {
            bridge.stop()
        }
    })

    it('does not re-forward its own writebacks back into HF (no echo)', () => {
        // The hot loop to avoid: HF writeback -> Y.Doc observeDeep ->
        // bridge -> hf.setCellContents -> valuesUpdated -> writeback ...
        //
        // If the bridge re-forwarded its own writes, every formula edit
        // would produce >1 valuesUpdated event. We assert on event count
        // by intercepting at HF.
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, {
            sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }],
        } satisfies WorkbookModel)

        const hf = HyperFormula.buildEmpty({ licenseKey: HYPERFORMULA_LICENSE_KEY })
        let valuesUpdatedCount = 0
        hf.on('valuesUpdated', () => {
            valuesUpdatedCount++
        })
        const bridge = new FormulaBridge(doc, hf)
        bridge.start()
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 2, display: '2' })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=A1*5',
                formula: '=A1*5',
            })
            // Two user edits => HF should fire valuesUpdated twice. If
            // the writeback echoed, we'd see strictly more.
            expect(valuesUpdatedCount).toBeLessThanOrEqual(2)
        } finally {
            bridge.stop()
        }
    })
})
