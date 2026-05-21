import { describe, expect, it } from 'vitest'
import { rewriteFormula } from '../tinycld/calc/lib/clipboard/rewrite-formula'

// rewriteFormula contract — pins the per-axis absolute/relative rules
// Excel/Sheets use when a copied formula is pasted at a delta from the
// source anchor. The function is pure: input string + (deltaRow,
// deltaCol) → output string. Tokens inside double-quoted string
// literals are never rewritten. Sheet-qualified refs (`Sheet2!A1`) pass
// through unchanged — cross-sheet rewriting is a non-goal for v1.
//
// Out-of-bounds shifts (row < 1 or col < 1) substitute the literal
// `#REF!` for the offending token, matching the standard error token
// the formula engine surfaces at evaluation time.

describe('rewriteFormula — single refs', () => {
    it('shifts a fully-relative ref by (deltaRow, deltaCol)', () => {
        expect(rewriteFormula('=A1', 1, 1)).toBe('=B2')
    })

    it('leaves a fully-absolute ref untouched', () => {
        expect(rewriteFormula('=$A$1', 5, 5)).toBe('=$A$1')
    })

    it('shifts only the column when the row is locked ($)', () => {
        expect(rewriteFormula('=A$1', 5, 2)).toBe('=C$1')
    })

    it('shifts only the row when the column is locked ($)', () => {
        expect(rewriteFormula('=$A1', 3, 7)).toBe('=$A4')
    })

    it('handles multi-letter columns', () => {
        // AA = 27, AB = 28
        expect(rewriteFormula('=AA1', 0, 1)).toBe('=AB1')
    })

    it('shifts across the Z→AA boundary', () => {
        // Z = 26, AA = 27
        expect(rewriteFormula('=Z1', 0, 1)).toBe('=AA1')
    })

    it('handles negative deltas (paste above/left)', () => {
        expect(rewriteFormula('=B5', -1, -1)).toBe('=A4')
    })
})

describe('rewriteFormula — ranges', () => {
    it('shifts both endpoints of an A1:B2 range', () => {
        expect(rewriteFormula('=SUM(A1:B2)', 1, 1)).toBe('=SUM(B2:C3)')
    })

    it('preserves absoluteness independently per endpoint', () => {
        expect(rewriteFormula('=SUM($A$1:B2)', 2, 2)).toBe('=SUM($A$1:D4)')
    })

    it('preserves mixed absolutes within a range', () => {
        expect(rewriteFormula('=SUM($A1:B$2)', 3, 4)).toBe('=SUM($A4:F$2)')
    })
})

describe('rewriteFormula — string literals are immune', () => {
    it('does not rewrite refs inside double-quoted strings', () => {
        expect(rewriteFormula('="A1"', 5, 5)).toBe('="A1"')
    })

    it('rewrites refs outside strings even when adjacent', () => {
        expect(rewriteFormula('=A1&"A1"', 1, 1)).toBe('=B2&"A1"')
    })

    it('handles escaped quotes inside a string literal', () => {
        // Excel/Sheets escape `"` as `""` inside strings. The literal
        // ` "say ""A1"" here" ` is one string containing `say "A1" here`.
        // No A1-shaped token outside the string here; result is unchanged.
        expect(rewriteFormula('="say ""A1"" here"', 1, 1)).toBe('="say ""A1"" here"')
    })
})

describe('rewriteFormula — function names', () => {
    it('does not rewrite identifiers without trailing digits', () => {
        // SUM, LEN, etc. match `[A-Z]+` but have no row digit. The token
        // regex requires `[A-Z]{1,3}\d+`, so function names pass through.
        expect(rewriteFormula('=SUM(A1)+LEN("hi")', 1, 1)).toBe('=SUM(B2)+LEN("hi")')
    })

    it('rewrites refs adjacent to function calls', () => {
        expect(rewriteFormula('=IF(A1>0,B1,C1)', 0, 1)).toBe('=IF(B1>0,C1,D1)')
    })
})

describe('rewriteFormula — named-range token guard', () => {
    // A formula imported from xlsx/Sheets can contain a named-range
    // token like `Tax2024` or `MyTotal1`. The A1-shaped suffix at the
    // tail of such a token must not be rewritten as if it were a cell
    // ref. Excelize/Sheets named ranges are alphanumeric + underscore,
    // so we gate on a leading [A-Za-z0-9_] before the match.
    it('leaves Tax2024 untouched (alpha before column letters)', () => {
        expect(rewriteFormula('=Tax2024', 1, 1)).toBe('=Tax2024')
    })

    it('leaves _A1 untouched (underscore prefix)', () => {
        expect(rewriteFormula('=_A1', 5, 5)).toBe('=_A1')
    })

    it('leaves digit-prefixed tokens untouched', () => {
        // `5A1` isn't a real syntax anywhere, but the gate should
        // catch it for safety.
        expect(rewriteFormula('=5A1', 1, 1)).toBe('=5A1')
    })

    it('still rewrites a normal A1 next to a named-range token', () => {
        // The gate only protects the *named-range* token; standalone
        // A1 refs in the same expression still shift normally.
        expect(rewriteFormula('=Tax2024+A1', 1, 1)).toBe('=Tax2024+B2')
    })
})

describe('rewriteFormula — sheet-qualified refs (passthrough)', () => {
    it('leaves Sheet!A1 references untouched', () => {
        expect(rewriteFormula('=Sheet2!A1', 5, 5)).toBe('=Sheet2!A1')
    })

    it('leaves quoted-sheet refs untouched', () => {
        expect(rewriteFormula("='My Sheet'!A1", 1, 1)).toBe("='My Sheet'!A1")
    })

    it('still rewrites local refs in a mixed expression', () => {
        expect(rewriteFormula('=A1+Sheet2!B2', 1, 0)).toBe('=A2+Sheet2!B2')
    })
})

describe('rewriteFormula — out of bounds → #REF!', () => {
    it('substitutes #REF! when a shifted row would be < 1', () => {
        expect(rewriteFormula('=A1', -1, 0)).toBe('=#REF!')
    })

    it('substitutes #REF! when a shifted column would be < 1', () => {
        expect(rewriteFormula('=A1', 0, -1)).toBe('=#REF!')
    })

    it('substitutes #REF! per-endpoint inside a range', () => {
        // A1 shifts to #REF! (column would be 0); B2 shifts to A1.
        expect(rewriteFormula('=SUM(A1:B2)', 0, -1)).toBe('=SUM(#REF!:A2)')
    })

    it('keeps absolute axes inside bounds — only the relative axis errors', () => {
        // $A is locked, so col stays at 1. Row 1 with delta -1 = row 0 → #REF!.
        expect(rewriteFormula('=$A1', -1, 5)).toBe('=#REF!')
    })

    it('does not error a fully-absolute ref no matter the delta', () => {
        expect(rewriteFormula('=$A$1', -100, -100)).toBe('=$A$1')
    })
})

describe('rewriteFormula — no-formula and edge inputs', () => {
    it('returns the original string when the formula has no refs', () => {
        expect(rewriteFormula('=1+2', 5, 5)).toBe('=1+2')
    })

    it('handles a formula that is just a literal', () => {
        expect(rewriteFormula('="hello"', 3, 3)).toBe('="hello"')
    })

    it('returns input unchanged for zero delta', () => {
        expect(rewriteFormula('=SUM(A1:B2)+$C$3', 0, 0)).toBe('=SUM(A1:B2)+$C$3')
    })

    it('passes non-formula strings through (leading = is required for a ref to be rewritten)', () => {
        // The function is only called on cell.formula text — which always
        // starts with `=`. But the implementation should still be robust
        // if called without a leading `=`: do not rewrite anything.
        expect(rewriteFormula('A1', 5, 5)).toBe('A1')
    })
})
