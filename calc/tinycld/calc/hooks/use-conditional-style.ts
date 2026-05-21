// useConditionalStyleForCell composes the moving parts of conditional
// formatting on the cell render hot path:
//
//   - useSheetConditionalFormats(doc, sheetId) — the sheet's rules.
//   - filterRulesForCell(index, row, col) — which rules cover this cell.
//   - useConditionalFormatVersionStore — the HF-bumped version so
//     custom-formula rules re-evaluate on dependency change.
//   - evaluateRulesForCell + the FormulaBridge — the actual condition
//     check that returns the winning rule's style.
//
// Returns CellStyle | undefined; callers feed it into mergeCellStyles
// alongside the cell's own style.

import { useMemo } from 'react'
import type * as Y from 'yjs'
import {
    type EvaluableCell,
    evaluateRulesForCell,
    type EvaluationContext,
} from '../lib/conditional-format/evaluate'
import {
    buildRuleRangeIndex,
    filterRulesForCell,
} from '../lib/conditional-format/range-index'
import { useConditionalFormatVersionStore } from '../lib/conditional-format/version-store'
import { getFormulaBridge } from '../lib/formula/bridge'
import type { CellStyle } from '../lib/workbook-types'
import { SHEETS_MAP } from '../lib/y-doc-bootstrap'
import { useSheetConditionalFormats } from './use-sheet-conditional-formats'

export function useConditionalStyleForCell(
    doc: Y.Doc | null,
    sheetId: string,
    cell: EvaluableCell | null,
    row: number,
    col: number
): CellStyle | undefined {
    const rules = useSheetConditionalFormats(doc, sheetId)
    // Subscribe to the version counter only when at least one rule on
    // this sheet uses a custom formula — otherwise we'd re-render
    // every cell on every keystroke through HF, defeating the
    // memoization. Selector returns 0 when no rule needs it.
    const hasCustomFormula = rules.some((r) => r.condition.type === 'customFormula')
    const version = useConditionalFormatVersionStore((s) =>
        hasCustomFormula ? s.version : 0
    )

    const index = useMemo(() => buildRuleRangeIndex(rules), [rules])

    return useMemo(() => {
        if (doc == null || index.length === 0) return undefined
        const matching = filterRulesForCell(index, row, col)
        if (matching.length === 0) return undefined
        const sheetName = readSheetName(doc, sheetId) ?? sheetId
        const ctx: EvaluationContext = {
            sheetName,
            row,
            col,
            evalFormulaAt: (formula, name, r, c) => {
                const bridge = getFormulaBridge(doc)
                if (bridge == null) return null
                return bridge.evaluateFormulaAt(formula, name, r, c)
            },
        }
        const style = evaluateRulesForCell(matching, cell, ctx)
        return style ?? undefined
        // version is intentionally in deps: when HF reports updates,
        // custom-formula rules need to re-evaluate against fresh
        // dependency values. The cell-value identity (`cell`) covers
        // changes to THIS cell; `version` covers changes to any cell
        // a custom formula references.
    }, [doc, sheetId, index, row, col, cell, version])
}

function readSheetName(doc: Y.Doc, sheetId: string): string | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const sheet = sheetsMap.get(sheetId)
    if (sheet == null || typeof sheet !== 'object') return null
    // Avoid an `instanceof Y.Map` import dependency here — `.get` on
    // anything not-a-Y.Map returns undefined, which we treat as missing.
    const name = (sheet as { get?: (k: string) => unknown }).get?.('name')
    return typeof name === 'string' ? name : null
}
