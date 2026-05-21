import { captureException } from '@tinycld/core/lib/errors'
import {
    type FormulaTokenContext,
    letterToCol,
    walkFormulaTokens,
} from '../clipboard/formula-token-walker'
import { columnLabel } from '../workbook-types'

// Per-mutation formula rewriter. Mirrors Excel/Sheets semantics:
// inserts shift refs whose row/col is at-or-below the insertion point;
// deletes collapse fully-overlapped refs to `#REF!` and clamp ranges
// that partially overlap. Cross-sheet refs into the mutated sheet are
// in scope (the case-insensitive sheet-name match matches HF's
// internal lookup). Refs into other sheets pass through unchanged.
//
// The function is pure — `(formula, formulaCellSheetName, mutation) →
// formula' | null`. `null` means "no token changed", letting the
// caller skip the Y.Map write entirely (CRDT tombstone savings).
//
// Range handling is two-pass:
//   1. The shared walker emits a sentinel + index for each accepted A1
//      token; we capture the parsed context and the original token
//      bytes (so we can re-emit verbatim on no-op).
//   2. We rescan the sentinel-decorated string for `<sentinel>:<sentinel>`
//      patterns to identify range pairs. A pair is treated as a range
//      iff BOTH endpoints reference the mutated sheet — otherwise each
//      endpoint is rewritten independently. Range deletion rules
//      (clamp / collapse to `#REF!`) only apply when both endpoints
//      reference the mutated sheet, matching Excel's behavior for
//      mixed-sheet ranges (which are illegal in well-formed formulas
//      anyway).
//
// We use the C0 control characters U+0001 / U+0002 as sentinels — they
// cannot appear in real formula text. As a defensive fallback, if the
// input contains either char we bail out and return `null` (the
// rewriter is best-effort; better to leave a pathological formula
// alone than mangle it).

export type StructuralFormulaMutation =
    | { kind: 'insertRows'; sheetName: string; insertAt: number; count: number }
    | { kind: 'insertColumns'; sheetName: string; insertAt: number; count: number }
    | { kind: 'deleteRows'; sheetName: string; fromRow: number; count: number }
    | { kind: 'deleteColumns'; sheetName: string; fromCol: number; count: number }

const SENTINEL_OPEN = '\x01'
const SENTINEL_CLOSE = '\x02'

interface CapturedToken {
    ctx: FormulaTokenContext
    // Raw bytes of the un-prefixed A1 token as it appeared in the
    // input (`A1`, `$A$1`, etc.). Lets us re-emit verbatim for no-op
    // cases without rebuilding from the parsed parts.
    originalRefBytes: string
}

export function rewriteFormulaForMutation(
    formula: string,
    formulaCellSheetName: string,
    mutation: StructuralFormulaMutation
): string | null {
    if (!formula.startsWith('=')) return null
    if (formula.includes(SENTINEL_OPEN) || formula.includes(SENTINEL_CLOSE)) {
        // Pathological input — the sentinel collision means we can't
        // safely use our two-pass range detection. Skip the rewrite
        // rather than mangle, but surface to Sentry: any real occurrence
        // points at a code path producing C0 control chars in formula
        // text, which would be a bug worth investigating.
        captureException(
            'rewriteFormulaForMutation: sentinel collision in formula text — skipping rewrite',
            new Error(`formula contained U+0001 or U+0002 (length ${formula.length})`)
        )
        return null
    }

    const tokens: CapturedToken[] = []
    const decorated = walkFormulaTokens(formula, (ctx) => {
        const idx = tokens.length
        const originalRefBytes = `${ctx.colAbs ? '$' : ''}${ctx.colLetters}${ctx.rowAbs ? '$' : ''}${ctx.rowNum}`
        tokens.push({ ctx, originalRefBytes })
        return `${SENTINEL_OPEN}${idx}${SENTINEL_CLOSE}`
    })

    if (tokens.length === 0) return null

    const mutationSheetLower = mutation.sheetName.toLowerCase()
    const formulaSheetLower = formulaCellSheetName.toLowerCase()

    // Identify range pairs: a sentinel followed by `:` followed by
    // another sentinel. Single-cell tokens are everything else.
    const rangePartner = new Map<number, number>()
    const sentinelRe = new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}:${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, 'g')
    for (const m of decorated.matchAll(sentinelRe)) {
        const a = Number(m[1])
        const b = Number(m[2])
        rangePartner.set(a, b)
        rangePartner.set(b, a)
    }

    let anyChange = false
    const replacements = new Map<number, string>()

    for (let i = 0; i < tokens.length; i++) {
        if (replacements.has(i)) continue
        const partner = rangePartner.get(i)
        if (partner != null && partner > i) {
            const left = tokens[i]
            const right = tokens[partner]
            const leftRefs = tokenReferencesMutatedSheet(left.ctx, formulaSheetLower, mutationSheetLower)
            // Right endpoint of a `Sheet1!A1:A10`-style range inherits the
            // left's sheet by Excel convention — the prefix is implicit on
            // the right. When the right has its own prefix we use that
            // instead. (`A1:Sheet1!A10` and `Sheet1!A1:Sheet2!A10` are
            // both illegal Excel; the per-endpoint fallback below handles
            // those without trying to be clever.)
            const rightCtxForMatch =
                right.ctx.sheetPrefix === '' && left.ctx.sheetPrefix !== ''
                    ? { ...right.ctx, sheetPrefix: left.ctx.sheetPrefix }
                    : right.ctx
            const rightRefs = tokenReferencesMutatedSheet(
                rightCtxForMatch,
                formulaSheetLower,
                mutationSheetLower
            )
            if (leftRefs && rightRefs) {
                const [leftOut, rightOut, changed] = applyRangeRule(left, right, mutation)
                if (changed) anyChange = true
                replacements.set(i, leftOut)
                replacements.set(partner, rightOut)
                continue
            }
            // Mixed-sheet pair — fall through to per-endpoint handling.
        }
        const tok = tokens[i]
        const refsMutated = tokenReferencesMutatedSheet(tok.ctx, formulaSheetLower, mutationSheetLower)
        if (!refsMutated) {
            replacements.set(i, `${tok.ctx.sheetPrefix}${tok.originalRefBytes}`)
            continue
        }
        const [out, changed] = applySingleRule(tok, mutation)
        if (changed) anyChange = true
        replacements.set(i, out)
    }

    if (!anyChange) return null

    const expandRe = new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, 'g')
    return decorated.replace(expandRe, (_, idx) => replacements.get(Number(idx)) ?? '')
}

function tokenReferencesMutatedSheet(
    ctx: FormulaTokenContext,
    formulaSheetLower: string,
    mutationSheetLower: string
): boolean {
    if (ctx.sheetPrefix === '') return formulaSheetLower === mutationSheetLower
    const parsed = parseSheetPrefix(ctx.sheetPrefix)
    return parsed.toLowerCase() === mutationSheetLower
}

// Pull the sheet name out of the prefix bytes the walker captured.
// Two forms:
//   - `Sheet1!`  → `Sheet1`
//   - `'Sheet'!` → `Sheet` (with `''` un-escaped to `'`)
function parseSheetPrefix(prefix: string): string {
    // Strip trailing `!`.
    const inner = prefix.endsWith('!') ? prefix.slice(0, -1) : prefix
    if (inner.startsWith("'") && inner.endsWith("'")) {
        return inner.slice(1, -1).replace(/''/g, "'")
    }
    return inner
}

function applySingleRule(
    tok: CapturedToken,
    mutation: StructuralFormulaMutation
): [string, boolean] {
    const { ctx } = tok
    const col = letterToCol(ctx.colLetters)
    const row = ctx.rowNum

    switch (mutation.kind) {
        case 'insertRows': {
            if (row >= mutation.insertAt) {
                return [emitToken(ctx, col, row + mutation.count), true]
            }
            return [`${ctx.sheetPrefix}${tok.originalRefBytes}`, false]
        }
        case 'insertColumns': {
            if (col >= mutation.insertAt) {
                return [emitToken(ctx, col + mutation.count, row), true]
            }
            return [`${ctx.sheetPrefix}${tok.originalRefBytes}`, false]
        }
        case 'deleteRows': {
            const last = mutation.fromRow + mutation.count - 1
            if (row < mutation.fromRow) {
                return [`${ctx.sheetPrefix}${tok.originalRefBytes}`, false]
            }
            if (row <= last) {
                return [`${ctx.sheetPrefix}#REF!`, true]
            }
            return [emitToken(ctx, col, row - mutation.count), true]
        }
        case 'deleteColumns': {
            const last = mutation.fromCol + mutation.count - 1
            if (col < mutation.fromCol) {
                return [`${ctx.sheetPrefix}${tok.originalRefBytes}`, false]
            }
            if (col <= last) {
                return [`${ctx.sheetPrefix}#REF!`, true]
            }
            return [emitToken(ctx, col - mutation.count, row), true]
        }
    }
}

function applyRangeRule(
    left: CapturedToken,
    right: CapturedToken,
    mutation: StructuralFormulaMutation
): [string, string, boolean] {
    const lCtx = left.ctx
    const rCtx = right.ctx
    const lCol = letterToCol(lCtx.colLetters)
    const rCol = letterToCol(rCtx.colLetters)
    const lRow = lCtx.rowNum
    const rRow = rCtx.rowNum

    switch (mutation.kind) {
        case 'insertRows': {
            const at = mutation.insertAt
            const newL = lRow >= at ? lRow + mutation.count : lRow
            const newR = rRow >= at ? rRow + mutation.count : rRow
            const changed = newL !== lRow || newR !== rRow
            return [emitToken(lCtx, lCol, newL), emitToken(rCtx, rCol, newR), changed]
        }
        case 'insertColumns': {
            const at = mutation.insertAt
            const newL = lCol >= at ? lCol + mutation.count : lCol
            const newR = rCol >= at ? rCol + mutation.count : rCol
            const changed = newL !== lCol || newR !== rCol
            return [emitToken(lCtx, newL, lRow), emitToken(rCtx, newR, rRow), changed]
        }
        case 'deleteRows': {
            return applyRangeDelete(
                left,
                right,
                lRow,
                rRow,
                mutation.fromRow,
                mutation.count,
                /* axis */ 'row',
                lCol,
                rCol
            )
        }
        case 'deleteColumns': {
            return applyRangeDelete(
                left,
                right,
                lCol,
                rCol,
                mutation.fromCol,
                mutation.count,
                'col',
                lRow,
                rRow
            )
        }
    }
}

// Range delete clamping. `axis` selects which numeric component is
// being mutated; cross-axis components (`crossL`, `crossR`) pass
// through untouched. Endpoint values `aL`, `aR` are the *original*
// (unsorted) values from the input — we sort to apply the rules but
// reproject back to the original endpoint order in the output so
// `=SUM(B5:B2)` doesn't silently rewrite to `=SUM(B2:B5)`.
function applyRangeDelete(
    left: CapturedToken,
    right: CapturedToken,
    aL: number,
    aR: number,
    fromAxis: number,
    count: number,
    axis: 'row' | 'col',
    crossL: number,
    crossR: number
): [string, string, boolean] {
    const last = fromAxis + count - 1
    const swapped = aL > aR
    const lo = swapped ? aR : aL
    const hi = swapped ? aL : aR
    let nLo = lo
    let nHi = hi
    let collapsed = false

    if (hi < fromAxis) {
        // Both above — unchanged.
    } else if (lo > last) {
        nLo = lo - count
        nHi = hi - count
    } else if (lo >= fromAxis && hi <= last) {
        collapsed = true
    } else if (lo < fromAxis && hi <= last) {
        // Straddles start: clamp top to fromAxis - 1.
        nHi = fromAxis - 1
    } else if (lo >= fromAxis && hi > last) {
        // Straddles end (top inside, bottom below): the surviving top
        // is the first row after the deletion (`last + 1`), which in
        // the post-deletion coordinate space is `fromAxis`. Bottom
        // shifts by -count like any below-the-deletion ref.
        nLo = fromAxis
        nHi = hi - count
    } else {
        // Straddles entirely: lo unchanged, hi shifts by -count.
        nHi = hi - count
    }

    if (collapsed) {
        return [`${left.ctx.sheetPrefix}#REF!`, `${right.ctx.sheetPrefix}#REF!`, true]
    }

    const newL = swapped ? nHi : nLo
    const newR = swapped ? nLo : nHi
    const changed = newL !== aL || newR !== aR

    if (axis === 'row') {
        return [emitToken(left.ctx, crossL, newL), emitToken(right.ctx, crossR, newR), changed]
    }
    return [emitToken(left.ctx, newL, crossL), emitToken(right.ctx, newR, crossR), changed]
}

function emitToken(ctx: FormulaTokenContext, col: number, row: number): string {
    if (col < 1 || row < 1) return `${ctx.sheetPrefix}#REF!`
    const colPart = `${ctx.colAbs ? '$' : ''}${columnLabel(col)}`
    const rowPart = `${ctx.rowAbs ? '$' : ''}${row}`
    return `${ctx.sheetPrefix}${colPart}${rowPart}`
}
