import { describe, expect, it } from 'vitest'
import { rewriteFormulaForMutation } from '../tinycld/calc/lib/formula/rewrite-on-structural-mutation'

// rewriteFormulaForMutation contract — pins the per-mutation A1
// rewriting rules used after a row/column insert or delete on a
// sheet. Returns null when no token changed (so the caller can skip
// the Y.Map write); otherwise returns the rewritten formula text.
//
// Cross-sheet refs into the mutated sheet are in scope. Sheet-name
// matching is case-insensitive (matches HF's internal lookup).

describe('rewriteFormulaForMutation — insertRows', () => {
    it('shifts a relative ref at-or-below the insert point', () => {
        expect(
            rewriteFormulaForMutation('=A5', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe('=A6')
    })

    it('leaves a ref strictly above the insert point unchanged', () => {
        expect(
            rewriteFormulaForMutation('=A4', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })

    it('shifts a ref strictly below the insert point', () => {
        expect(
            rewriteFormulaForMutation('=A7', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBe('=A9')
    })

    it('shifts an absolute-row ref ($A$5) — structural inserts move the cell with it', () => {
        expect(
            rewriteFormulaForMutation('=$A$5', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBe('=$A$7')
    })

    it('preserves the $ on a partially-absolute ref', () => {
        expect(
            rewriteFormulaForMutation('=A$5', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe('=A$6')
    })

    it('shifts both endpoints of a range fully below the insert', () => {
        expect(
            rewriteFormulaForMutation('=SUM(A5:B7)', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBe('=SUM(A7:B9)')
    })

    it('leaves the top endpoint and shifts the bottom for a straddling range', () => {
        // Range A3:A7, insert 2 rows at row 5. A3 unchanged, A7 → A9.
        expect(
            rewriteFormulaForMutation('=SUM(A3:A7)', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBe('=SUM(A3:A9)')
    })

    it('shifts a cross-sheet ref into the mutated sheet', () => {
        expect(
            rewriteFormulaForMutation('=Sheet1!A5', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe('=Sheet1!A6')
    })

    it('leaves a cross-sheet ref to a different sheet untouched', () => {
        expect(
            rewriteFormulaForMutation('=Sheet3!A5', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })

    it('leaves an unqualified ref in a formula on a different sheet untouched', () => {
        expect(
            rewriteFormulaForMutation('=A5', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })
})

describe('rewriteFormulaForMutation — deleteRows', () => {
    it('leaves a ref above the deletion unchanged', () => {
        expect(
            rewriteFormulaForMutation('=A2', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBeNull()
    })

    it('substitutes #REF! for a ref inside the deletion', () => {
        expect(
            rewriteFormulaForMutation('=A6', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=#REF!')
    })

    it('shifts a ref below the deletion up by count', () => {
        expect(
            rewriteFormulaForMutation('=A10', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=A7')
    })

    it('keeps the sheet prefix on a #REF! result for a cross-sheet ref', () => {
        expect(
            rewriteFormulaForMutation('=Sheet1!A6', 'Sheet2', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=Sheet1!#REF!')
    })

    it('collapses a range fully inside the deletion to #REF!', () => {
        expect(
            rewriteFormulaForMutation('=SUM(A5:A7)', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=SUM(#REF!:#REF!)')
    })

    it('clamps a range straddling the start of the deletion', () => {
        // A2:A6, delete rows 5-7. Bottom clamps to fromRow - 1 = 4.
        expect(
            rewriteFormulaForMutation('=SUM(A2:A6)', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=SUM(A2:A4)')
    })

    it('clamps a range straddling the end of the deletion', () => {
        // A6:A10, delete rows 5-7. Top → 5 (first surviving row), bottom 10 - 3 = 7.
        expect(
            rewriteFormulaForMutation('=SUM(A6:A10)', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=SUM(A5:A7)')
    })

    it('shifts a range straddling the entire deletion', () => {
        // A2:A10, delete rows 5-7. Top unchanged, bottom 10 - 3 = 7.
        expect(
            rewriteFormulaForMutation('=SUM(A2:A10)', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=SUM(A2:A7)')
    })

    it('collapses a 2-row range to a single cell when the top is deleted', () => {
        // A5:A6, delete row 5. Surviving: just A5 (was A6).
        expect(
            rewriteFormulaForMutation('=SUM(A5:A6)', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 1,
            })
        ).toBe('=SUM(A5:A5)')
    })

    it('does not mutate refs in a formula on a different sheet', () => {
        expect(
            rewriteFormulaForMutation('=A6', 'Sheet2', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBeNull()
    })
})

describe('rewriteFormulaForMutation — insertColumns', () => {
    it('shifts a relative col ref at-or-below the insert point', () => {
        expect(
            rewriteFormulaForMutation('=C5', 'Sheet1', {
                kind: 'insertColumns',
                sheetName: 'Sheet1',
                insertAt: 3,
                count: 1,
            })
        ).toBe('=D5')
    })

    it('shifts an absolute-column ref', () => {
        expect(
            rewriteFormulaForMutation('=$C$5', 'Sheet1', {
                kind: 'insertColumns',
                sheetName: 'Sheet1',
                insertAt: 3,
                count: 1,
            })
        ).toBe('=$D$5')
    })

    it('shifts both endpoints of a range fully below the insert', () => {
        expect(
            rewriteFormulaForMutation('=SUM(C1:E2)', 'Sheet1', {
                kind: 'insertColumns',
                sheetName: 'Sheet1',
                insertAt: 3,
                count: 2,
            })
        ).toBe('=SUM(E1:G2)')
    })

    it('leaves a column ref above the insert untouched', () => {
        expect(
            rewriteFormulaForMutation('=B5', 'Sheet1', {
                kind: 'insertColumns',
                sheetName: 'Sheet1',
                insertAt: 3,
                count: 1,
            })
        ).toBeNull()
    })
})

describe('rewriteFormulaForMutation — deleteColumns', () => {
    it('substitutes #REF! for a column inside the deletion', () => {
        expect(
            rewriteFormulaForMutation('=C5', 'Sheet1', {
                kind: 'deleteColumns',
                sheetName: 'Sheet1',
                fromCol: 3,
                count: 2,
            })
        ).toBe('=#REF!')
    })

    it('shifts a ref to the right of the deletion left by count', () => {
        expect(
            rewriteFormulaForMutation('=F5', 'Sheet1', {
                kind: 'deleteColumns',
                sheetName: 'Sheet1',
                fromCol: 3,
                count: 2,
            })
        ).toBe('=D5')
    })

    it('clamps a range straddling the end of the column deletion', () => {
        // C5:F5, delete cols 3-4 (C-D). Top → C (first surviving), F → D.
        expect(
            rewriteFormulaForMutation('=SUM(C5:F5)', 'Sheet1', {
                kind: 'deleteColumns',
                sheetName: 'Sheet1',
                fromCol: 3,
                count: 2,
            })
        ).toBe('=SUM(C5:D5)')
    })

    it('collapses a fully-inside range to #REF!', () => {
        expect(
            rewriteFormulaForMutation('=SUM(C5:D5)', 'Sheet1', {
                kind: 'deleteColumns',
                sheetName: 'Sheet1',
                fromCol: 3,
                count: 2,
            })
        ).toBe('=SUM(#REF!:#REF!)')
    })
})

describe('rewriteFormulaForMutation — composition with cell-shift', () => {
    it('rewrites a self-reference correctly when the formula cell moves', () => {
        // Formula at row 7, =A7+1. Insert 2 rows at row 5. Token A7
        // shifts to A9. (The cell itself also moves to row 9 — the
        // shift is a no-op relative to the formula cell.)
        expect(
            rewriteFormulaForMutation('=A7+1', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBe('=A9+1')
    })
})

describe('rewriteFormulaForMutation — string literals are immune', () => {
    it('does not rewrite refs inside double-quoted strings on insert', () => {
        // The bare A5 outside the string shifts; the "A5" inside the
        // string is opaque.
        expect(
            rewriteFormulaForMutation('="row 5"&A5', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 1,
            })
        ).toBe('="row 5"&#REF!')
    })

    it('leaves a string-only formula untouched', () => {
        expect(
            rewriteFormulaForMutation('="A5"', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 1,
            })
        ).toBeNull()
    })
})

describe('rewriteFormulaForMutation — pre-existing #REF! tokens', () => {
    it('passes through a formula already containing #REF!', () => {
        // `#REF!` is not an A1-shaped token (no letters before the
        // digits and no digits at all), so the walker doesn't match it
        // and it round-trips unchanged.
        expect(
            rewriteFormulaForMutation('=#REF!+A2', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })
})

describe('rewriteFormulaForMutation — sheet-name parsing', () => {
    it('matches an unquoted sheet name', () => {
        expect(
            rewriteFormulaForMutation('=Sheet1!A5', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe('=Sheet1!A6')
    })

    it('matches a quoted sheet name and re-emits the quotes verbatim', () => {
        expect(
            rewriteFormulaForMutation("='My Sheet'!A5", 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'My Sheet',
                insertAt: 5,
                count: 1,
            })
        ).toBe("='My Sheet'!A6")
    })

    it("un-escapes '' inside a quoted sheet name for comparison", () => {
        expect(
            rewriteFormulaForMutation("='O''Brien'!A5", 'Sheet2', {
                kind: 'insertRows',
                sheetName: "O'Brien",
                insertAt: 5,
                count: 1,
            })
        ).toBe("='O''Brien'!A6")
    })

    it('handles a quoted sheet name containing !', () => {
        expect(
            rewriteFormulaForMutation("='Foo!Bar'!A5", 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Foo!Bar',
                insertAt: 5,
                count: 1,
            })
        ).toBe("='Foo!Bar'!A6")
    })

    it('matches case-insensitively (matches HF lookup semantics)', () => {
        expect(
            rewriteFormulaForMutation('=sheet1!A5', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe('=sheet1!A6')
    })

    it('leaves a mismatched sheet name untouched', () => {
        expect(
            rewriteFormulaForMutation('=Sheet3!A5', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })

    it('matches a gratuitously-quoted unquoted-legal sheet name', () => {
        // `'Sheet1'!A5` is unusual but legal — HF and Excel accept it.
        // parseSheetPrefix strips the quotes; the case-insensitive
        // comparison then matches `Sheet1`.
        expect(
            rewriteFormulaForMutation("='Sheet1'!A5", 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe("='Sheet1'!A6")
    })

    it('handles a non-Latin (CJK) quoted sheet name', () => {
        expect(
            rewriteFormulaForMutation("='シート1'!A5", 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'シート1',
                insertAt: 5,
                count: 1,
            })
        ).toBe("='シート1'!A6")
    })

    it('shifts unqualified refs but not refs to a different sheet in the same formula', () => {
        // Formula on Sheet1; mutation on Sheet1. Local A5 shifts;
        // Sheet2!A5 is different sheet, untouched.
        expect(
            rewriteFormulaForMutation('=A5+Sheet2!A5', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBe('=A6+Sheet2!A5')
    })
})

describe('rewriteFormulaForMutation — cross-sheet ranges (prefix-on-left convention)', () => {
    // Excel/HyperFormula write cross-sheet ranges with the sheet prefix
    // on the left endpoint only: `Sheet1!A1:A10`. The right endpoint's
    // sheet is implicit (it inherits the left's). The rewriter must
    // honour this when deciding whether a range pair references the
    // mutated sheet.

    it('shifts both endpoints of a prefix-on-left cross-sheet range on insert', () => {
        // Formula on Sheet2; mutation on Sheet1. Right endpoint A10
        // inherits Sheet1 from the left prefix, so both shift.
        expect(
            rewriteFormulaForMutation('=SUM(Sheet1!A1:A10)', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBe('=SUM(Sheet1!A1:A12)')
    })

    it('clamps a prefix-on-left cross-sheet range on partial deletion', () => {
        // Delete rows 5-7 on Sheet1. Range Sheet1!A1:A10 → top above
        // deletion stays, bottom shifts by -count.
        expect(
            rewriteFormulaForMutation('=SUM(Sheet1!A1:A10)', 'Sheet2', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 3,
            })
        ).toBe('=SUM(Sheet1!A1:A7)')
    })

    it('collapses a fully-covered prefix-on-left cross-sheet range to #REF!', () => {
        expect(
            rewriteFormulaForMutation('=SUM(Sheet1!A5:A6)', 'Sheet2', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 2,
            })
        ).toBe('=SUM(Sheet1!#REF!:#REF!)')
    })

    it('handles a prefix-on-left quoted cross-sheet range', () => {
        expect(
            rewriteFormulaForMutation("=SUM('My Sheet'!A1:A10)", 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'My Sheet',
                insertAt: 5,
                count: 1,
            })
        ).toBe("=SUM('My Sheet'!A1:A11)")
    })

    it('leaves prefix-on-left ranges into a different sheet alone', () => {
        // Formula on Sheet2; mutation on Sheet1; range refers to Sheet3.
        // Right endpoint A10 inherits Sheet3 from left, not the
        // formula's Sheet2 — so it doesn't accidentally match the
        // mutation.
        expect(
            rewriteFormulaForMutation('=SUM(Sheet3!A1:A10)', 'Sheet2', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 2,
            })
        ).toBeNull()
    })

    it('collapses a single-cell range whose row is deleted', () => {
        // `=A5:A5` is the degenerate range form (rare, but it can land
        // here after a previous clamp). When the row is deleted, both
        // endpoints fall inside the deletion and the whole range
        // collapses to `#REF!:#REF!`.
        expect(
            rewriteFormulaForMutation('=SUM(A5:A5)', 'Sheet1', {
                kind: 'deleteRows',
                sheetName: 'Sheet1',
                fromRow: 5,
                count: 1,
            })
        ).toBe('=SUM(#REF!:#REF!)')
    })
})

describe('rewriteFormulaForMutation — non-formula and edge inputs', () => {
    it('returns null for a string without a leading =', () => {
        expect(
            rewriteFormulaForMutation('A5', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })

    it('returns null when the formula has no refs', () => {
        expect(
            rewriteFormulaForMutation('=1+2', 'Sheet1', {
                kind: 'insertRows',
                sheetName: 'Sheet1',
                insertAt: 5,
                count: 1,
            })
        ).toBeNull()
    })
})
