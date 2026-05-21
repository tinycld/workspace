import { columnLabel } from '../workbook-types'
import {
    type FormulaTokenContext,
    letterToCol,
    walkFormulaTokens,
} from './formula-token-walker'

// rewriteFormula shifts the relative A1 refs inside a formula by
// (deltaRow, deltaCol), preserving per-axis absoluteness (the `$`
// prefix). Used by the paste path so a copied `=A1+B1` lands as
// `=B2+C2` when pasted one row down and one column right.
//
// Invariants:
//   - Tokens inside double-quoted string literals are never rewritten.
//     Excel/Sheets escape `"` inside strings as `""`, which the walker
//     honours.
//   - Sheet-qualified refs (`Sheet2!A1`, `'My Sheet'!A1`) pass through
//     opaquely — cross-sheet rewriting is a v1 non-goal for the
//     clipboard. The transform recognises these by sheetPrefix !== ''
//     and re-emits the token verbatim.
//   - Function names (SUM, LEN, IF) don't match the ref regex because
//     it requires at least one digit after the column letters, and the
//     walker's identifier-tail guard catches named-range tokens like
//     `Tax2024`.
//   - A shifted axis that would land below 1 substitutes the whole
//     token with the literal `#REF!`, matching the error token the
//     formula engine surfaces when a ref dangles.
//   - When the input does not start with `=` we treat it as a
//     non-formula and return it verbatim.
//
// The implementation is a hand-rolled walker (rather than HyperFormula's
// transform API) because the rules are small, the tests are exhaustive,
// and we don't want a license-keyed engine on the critical path of
// every paste. The walker itself lives in formula-token-walker.ts so
// the structural-mutation rewriter can share it.

export interface RewriteFormulaOptions {
    // Optional bounds for the destination. Out-of-bounds shifts always
    // catch the row < 1 / col < 1 case automatically; an upper bound is
    // accepted for future use but not enforced today (the calc grid has
    // no hard upper bound).
    maxRow?: number
    maxCol?: number
}

export function rewriteFormula(
    formula: string,
    deltaRow: number,
    deltaCol: number,
    _opts?: RewriteFormulaOptions
): string {
    if (!formula.startsWith('=')) return formula
    if (deltaRow === 0 && deltaCol === 0) return formula

    return walkFormulaTokens(formula, (ctx) => transformClipboardToken(ctx, deltaRow, deltaCol))
}

function transformClipboardToken(
    ctx: FormulaTokenContext,
    deltaRow: number,
    deltaCol: number
): string {
    // Cross-sheet refs are opaque to the clipboard rewriter — re-emit
    // the original prefix + token bytes verbatim.
    if (ctx.sheetPrefix !== '') {
        return `${ctx.sheetPrefix}${ctx.colAbs ? '$' : ''}${ctx.colLetters}${ctx.rowAbs ? '$' : ''}${ctx.rowNum}`
    }

    const col = letterToCol(ctx.colLetters)
    const nextCol = ctx.colAbs ? col : col + deltaCol
    const nextRow = ctx.rowAbs ? ctx.rowNum : ctx.rowNum + deltaRow

    if (nextCol < 1 || nextRow < 1) return '#REF!'

    const colPart = `${ctx.colAbs ? '$' : ''}${columnLabel(nextCol)}`
    const rowPart = `${ctx.rowAbs ? '$' : ''}${nextRow}`
    return `${colPart}${rowPart}`
}
