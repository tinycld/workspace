import { describe, expect, it } from 'vitest'
import { buildA1Range, parseA1Range } from '../tinycld/calc/lib/pivot/range-parse'

describe('parseA1Range', () => {
    it('parses unquoted sheet name', () => {
        expect(parseA1Range('Sheet1!A1:B10')).toEqual({
            ok: true,
            sheetName: 'Sheet1',
            startRow: 1,
            startCol: 1,
            endRow: 10,
            endCol: 2,
        })
    })

    it('parses quoted sheet name with spaces and apostrophes', () => {
        const r = parseA1Range("'Sheet With Spaces'!C2:D5")
        expect(r).toEqual({
            ok: true,
            sheetName: 'Sheet With Spaces',
            startRow: 2,
            startCol: 3,
            endRow: 5,
            endCol: 4,
        })
    })

    it('parses multi-letter columns', () => {
        const r = parseA1Range('Sheet1!Z1:AB3')
        expect(r).toMatchObject({ ok: true, startCol: 26, endCol: 28 })
    })

    it('errors on missing sheet separator', () => {
        const r = parseA1Range('A1:B10')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toBe('missing-sheet')
    })

    it('errors on malformed range', () => {
        const r = parseA1Range('Sheet1!notarange')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toBe('malformed')
    })

    it('errors on reversed range (end before start)', () => {
        const r = parseA1Range('Sheet1!B10:A1')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toBe('reversed')
    })

    it('errors on empty string', () => {
        const r = parseA1Range('')
        expect(r.ok).toBe(false)
    })
})

describe('buildA1Range', () => {
    it('builds simple range', () => {
        expect(buildA1Range('Sheet1', 1, 1, 10, 5)).toBe('Sheet1!A1:E10')
    })

    it('quotes sheet name with spaces', () => {
        expect(buildA1Range('My Sheet', 2, 3, 5, 4)).toBe("'My Sheet'!C2:D5")
    })

    it('escapes apostrophes in quoted sheet name', () => {
        expect(buildA1Range("Bob's", 1, 1, 1, 1)).toBe("'Bob''s'!A1:A1")
    })

    it('handles multi-letter columns', () => {
        expect(buildA1Range('Sheet1', 1, 26, 3, 28)).toBe('Sheet1!Z1:AB3')
    })
})
