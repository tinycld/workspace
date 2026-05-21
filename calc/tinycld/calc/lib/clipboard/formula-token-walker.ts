// Single-pass walker over the A1-shaped tokens in a formula. Shared
// internals between the clipboard rewriter (uniform delta shift) and
// the structural-mutation rewriter (per-token axis-aware shift). The
// walker handles:
//
//   - Double-quoted string literals, with `""` as the embedded-quote
//     escape (Excel/Sheets convention). Tokens inside strings are not
//     emitted to the transform — the bytes pass through verbatim.
//   - A1 tokens: `(\$?)([A-Z]{1,3})(\$?)(\d+)`. Captures the four parts
//     so the transform can preserve per-axis absoluteness.
//   - Identifier-tail guard: a token whose surrounding char is in
//     `[A-Za-z0-9_]` is part of a longer identifier (named range like
//     `Tax2024`, or `_A1`, or `5A1`) and is not handed to the
//     transform — it passes through verbatim.
//   - Sheet-qualified prefixes. The walker parses the FULL prefix
//     (unquoted `Sheet1!` or quoted `'Sheet Name'!` with `''` as the
//     embedded-apostrophe escape) backwards from the `!` and exposes it
//     as one piece. The transform decides what to do with it.
//
// The transform receives `FormulaTokenContext` and returns the
// replacement bytes for the WHOLE token (including any sheetPrefix it
// chooses to re-emit). This lets the structural rewriter swap the
// numeric parts in cross-sheet refs while keeping the prefix bytes
// verbatim, and lets the clipboard rewriter return the token verbatim
// when sheetPrefix is non-empty.

export interface FormulaTokenContext {
    colAbs: boolean
    colLetters: string
    rowAbs: boolean
    rowNum: number
    // Exact bytes of the "Sheet!" or "'Sheet'!" prefix that immediately
    // precedes the A1 token, or "" when the token is unqualified. The
    // walker parses the prefix; the transform decides what to do.
    sheetPrefix: string
}

export type FormulaTokenTransform = (token: FormulaTokenContext) => string

// A1-shaped token: optional $, 1-3 column letters, optional $, ≥1 row
// digit. Sticky (`y`) so we anchor at lastIndex rather than scanning.
const REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/y

// HF's UNQUOTED_SHEET_NAME_PATTERN — Latin letters incl. Latin-1
// supplement (À-ʯ), digits, underscores. Anything else (spaces, dots,
// parens, apostrophes, CJK, etc.) requires the quoted form in formula
// text. Matched character-by-character when scanning backwards.
const UNQUOTED_SHEET_CHAR = /[A-Za-zÀ-ʯ0-9_]/

export function walkFormulaTokens(formula: string, transform: FormulaTokenTransform): string {
    if (!formula.startsWith('=')) return formula

    let out = ''
    let i = 0
    let inString = false

    while (i < formula.length) {
        const ch = formula[i]

        if (inString) {
            out += ch
            if (ch === '"') {
                if (formula[i + 1] === '"') {
                    out += '"'
                    i += 2
                    continue
                }
                inString = false
            }
            i++
            continue
        }

        if (ch === '"') {
            inString = true
            out += ch
            i++
            continue
        }

        REF_RE.lastIndex = i
        const m = REF_RE.exec(formula)
        if (m == null) {
            out += ch
            i++
            continue
        }

        const tail = i + m[0].length

        // Identifier-tail guard: a letter/digit/underscore on either
        // side of the match means the A1-shape is just the suffix of a
        // longer identifier (named range, etc.) — pass through verbatim.
        if (tail < formula.length && /[A-Za-z0-9_]/.test(formula[tail])) {
            out += m[0]
            i = tail
            continue
        }
        if (m.index > 0 && /[A-Za-z0-9_]/.test(formula[m.index - 1])) {
            out += m[0]
            i = tail
            continue
        }

        // Parse a sheet-qualified prefix backwards from the token.
        // colStart is the index of the first column letter (skipping
        // the optional `$`); the prefix's `!` sits immediately before
        // colStart when present.
        const colStart = m[1] === '$' ? m.index + 1 : m.index
        let prefixStart = colStart
        let sheetPrefix = ''
        if (colStart > 0 && formula[colStart - 1] === '!') {
            const bang = colStart - 1
            if (bang > 0 && formula[bang - 1] === "'") {
                // Quoted form: scan back for the matching opening "'",
                // treating "''" as an embedded apostrophe (which
                // belongs to the name, not the delimiter).
                let q = bang - 2
                let foundOpen = false
                while (q >= 0) {
                    if (formula[q] === "'") {
                        if (q > 0 && formula[q - 1] === "'") {
                            q -= 2
                            continue
                        }
                        foundOpen = true
                        break
                    }
                    q--
                }
                if (foundOpen) {
                    prefixStart = q
                    sheetPrefix = formula.slice(prefixStart, colStart)
                }
            } else {
                // Unquoted form: scan back over the unquoted-name char
                // class. At least one char is required for it to be a
                // real prefix.
                let q = bang - 1
                while (q >= 0 && UNQUOTED_SHEET_CHAR.test(formula[q])) q--
                if (q < bang - 1) {
                    prefixStart = q + 1
                    sheetPrefix = formula.slice(prefixStart, colStart)
                }
            }

            // If we resolved a prefix, the identifier-tail guard on the
            // LEFT side has to be re-checked against the char before
            // the prefix — `FOO'Sheet'!A1` shouldn't be treated as a
            // sheet-qualified ref because `FOO` glues onto the quoted
            // name. (In practice formulas don't look like this, but
            // matching the same guard keeps the walker robust.)
            if (sheetPrefix !== '' && prefixStart > 0) {
                const prev = formula[prefixStart - 1]
                if (/[A-Za-z0-9_]/.test(prev)) {
                    out += m[0]
                    i = tail
                    continue
                }
            }
        }

        const ctx: FormulaTokenContext = {
            colAbs: m[1] === '$',
            colLetters: m[2],
            rowAbs: m[3] === '$',
            rowNum: Number(m[4]),
            sheetPrefix,
        }

        // The transform owns the token's full output bytes. We rewind
        // out to the start of the prefix (if any) so we don't double-
        // emit characters the transform decides to re-include.
        if (sheetPrefix !== '') {
            out = out.slice(0, out.length - sheetPrefix.length)
        }
        out += transform(ctx)
        i = tail
    }

    return out
}

// Inverse of columnLabel: "A" → 1, "Z" → 26, "AA" → 27. Lives here so
// both rewriters can share it — the walker hands the transform the raw
// letters, and the transform converts to a numeric column when it
// needs to do arithmetic.
export function letterToCol(letters: string): number {
    let n = 0
    for (let k = 0; k < letters.length; k++) {
        n = n * 26 + (letters.charCodeAt(k) - 64)
    }
    return n
}
