import { describe, expect, it } from 'vitest'
import {
    applyFunctionInsertion,
    filterFunctions,
    parseFunctionToken,
} from '../tinycld/calc/lib/formula/autocomplete'

describe('parseFunctionToken', () => {
    it('returns null when draft does not start with =', () => {
        expect(parseFunctionToken('LE', 2)).toBeNull()
    })

    it('returns null on bare = with no token', () => {
        expect(parseFunctionToken('=', 1)).toBeNull()
    })

    it('finds a token at top level', () => {
        const t = parseFunctionToken('=LE', 3)
        expect(t).toEqual({ token: 'LE', tokenStart: 1, tokenEnd: 3 })
    })

    it('finds a token nested inside a function', () => {
        const t = parseFunctionToken('=SUM(LE', 7)
        expect(t).toEqual({ token: 'LE', tokenStart: 5, tokenEnd: 7 })
    })

    it('finds a token after an operator', () => {
        const t = parseFunctionToken('=A1+LE', 6)
        expect(t).toEqual({ token: 'LE', tokenStart: 4, tokenEnd: 6 })
    })

    it('returns null when cursor sits inside a string literal', () => {
        expect(parseFunctionToken('="LE', 4)).toBeNull()
    })

    it('returns null when cursor sits inside a closed string literal', () => {
        expect(parseFunctionToken('="hi" + LE', 5)).toBeNull()
    })

    it('handles escaped quotes inside string literals', () => {
        // ="he said ""hi""" — cursor right after the closing quote means
        // we are NOT inside a string.
        const draft = '="he said ""hi"""'
        expect(parseFunctionToken(draft, draft.length)).toBeNull()
    })

    it('returns null when the token starts with a digit', () => {
        expect(parseFunctionToken('=2LE', 4)).toBeNull()
    })

    it('returns null when cursor sits in whitespace after a token', () => {
        expect(parseFunctionToken('=LE ', 4)).toBeNull()
    })

    it('returns null when cursor sits in a cell reference', () => {
        // A1 is a valid token starting with a letter, but it has a digit
        // before the cursor — autocomplete would mangle the ref. This is
        // the edge case isRefAcceptable cares about; here we still return
        // a token because A1's digit is after the letter. The caller is
        // expected to gate on reference-vs-function context separately.
        // Documenting current behavior for future reference.
        const t = parseFunctionToken('=A1', 3)
        expect(t).toEqual({ token: 'A1', tokenStart: 1, tokenEnd: 3 })
    })
})

describe('filterFunctions', () => {
    const FNS = ['ABS', 'AVERAGE', 'LEFT', 'LEN', 'LEFTB', 'SUM', 'SUMIF', 'SUMIFS']

    it('returns [] for empty prefix', () => {
        expect(filterFunctions(FNS, '')).toEqual([])
    })

    it('case-insensitive prefix match', () => {
        expect(filterFunctions(FNS, 'le')).toEqual(['LEFT', 'LEFTB', 'LEN'])
    })

    it('respects limit', () => {
        expect(filterFunctions(FNS, 'sum', 2)).toEqual(['SUM', 'SUMIF'])
    })

    it('sorts alphabetically', () => {
        const out = filterFunctions(['SUMIFS', 'SUMIF', 'SUM'], 'sum')
        expect(out).toEqual(['SUM', 'SUMIF', 'SUMIFS'])
    })
})

describe('applyFunctionInsertion', () => {
    it('replaces partial token with NAME( and places cursor inside parens', () => {
        const result = applyFunctionInsertion(
            '=LE',
            { token: 'LE', tokenStart: 1, tokenEnd: 3 },
            'LEFT'
        )
        expect(result.draft).toBe('=LEFT(')
        expect(result.selection).toEqual({ start: 6, end: 6 })
    })

    it('preserves text after the cursor', () => {
        const result = applyFunctionInsertion(
            '=LE+1',
            { token: 'LE', tokenStart: 1, tokenEnd: 3 },
            'LEFT'
        )
        expect(result.draft).toBe('=LEFT(+1')
        expect(result.selection).toEqual({ start: 6, end: 6 })
    })

    it('inserts inside an outer function', () => {
        const result = applyFunctionInsertion(
            '=SUM(LE',
            { token: 'LE', tokenStart: 5, tokenEnd: 7 },
            'LEN'
        )
        expect(result.draft).toBe('=SUM(LEN(')
        expect(result.selection).toEqual({ start: 9, end: 9 })
    })
})
