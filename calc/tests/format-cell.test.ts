import { describe, expect, it } from 'vitest'
import { formatCell } from '../tinycld/calc/lib/workbook-types'

// formatCell is called both at xlsx-import time (to populate the
// `display` cache stored in the Y.Doc) and at live render time. The
// rule is: same (kind, raw) input always produces the same display
// string, so the cache and the live formatter never drift.

describe('formatCell', () => {
    it('strings render as-is', () => {
        expect(formatCell('string', 'hello')).toBe('hello')
        expect(formatCell('string', '')).toBe('')
    })

    it('integer numbers render without decimals', () => {
        expect(formatCell('number', 42)).toBe('42')
        expect(formatCell('number', -7)).toBe('-7')
        expect(formatCell('number', 0)).toBe('0')
    })

    it('non-integer numbers preserve their decimal representation', () => {
        expect(formatCell('number', 3.14)).toBe('3.14')
        expect(formatCell('number', -0.5)).toBe('-0.5')
    })

    it('non-finite numbers stringify as Infinity / NaN', () => {
        expect(formatCell('number', Number.POSITIVE_INFINITY)).toBe('Infinity')
        expect(formatCell('number', Number.NEGATIVE_INFINITY)).toBe('-Infinity')
        expect(formatCell('number', Number.NaN)).toBe('NaN')
    })

    it('booleans render as TRUE / FALSE (matches Excel)', () => {
        expect(formatCell('boolean', true)).toBe('TRUE')
        expect(formatCell('boolean', false)).toBe('FALSE')
    })

    it('dates round-trip ISO strings', () => {
        expect(formatCell('date', '2024-01-15')).toBe('2024-01-15')
        expect(formatCell('date', '2024-01-15T13:30:00.000Z')).toBe('2024-01-15T13:30:00.000Z')
    })

    it('Date objects emit yyyy-mm-dd when the time component is zero', () => {
        const d = new Date('2024-01-15T00:00:00.000Z')
        expect(formatCell('date', d)).toBe('2024-01-15')
    })

    it('Date objects emit full ISO when the time component is non-zero', () => {
        const d = new Date('2024-01-15T13:30:00.000Z')
        expect(formatCell('date', d)).toBe('2024-01-15T13:30:00.000Z')
    })

    it('formula falls back to the formula text when no cached value', () => {
        expect(formatCell('formula', null, '=A1+B1')).toBe('=A1+B1')
    })

    it('formula renders the cached scalar when present', () => {
        expect(formatCell('formula', 42, '=A1+B1')).toBe('42')
        expect(formatCell('formula', 'hi', '=A1')).toBe('hi')
        expect(formatCell('formula', true, '=ISNUMBER(A1)')).toBe('TRUE')
    })

    it('null raw renders empty for non-formula kinds', () => {
        expect(formatCell('string', null)).toBe('')
        expect(formatCell('number', null)).toBe('')
        expect(formatCell('boolean', null)).toBe('')
        expect(formatCell('date', null)).toBe('')
    })
})
