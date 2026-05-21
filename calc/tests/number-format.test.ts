import { describe, expect, it } from 'vitest'
import { applyNumFmt } from '../tinycld/calc/lib/number-format/format'

// applyNumFmt is the kind+numFmt-aware formatter that powers the live
// cell render path. These tests pin the round-trip from typed cell
// values to display strings for every preset shape we ship today.

describe('applyNumFmt — fallback (no pattern)', () => {
    it('numbers without numFmt render via the default formatter', () => {
        expect(applyNumFmt('number', 42, undefined)).toBe('42')
        expect(applyNumFmt('number', 3.14, undefined)).toBe('3.14')
    })

    it('strings without numFmt pass through', () => {
        expect(applyNumFmt('string', 'hello', undefined)).toBe('hello')
    })

    it('booleans without numFmt render TRUE/FALSE', () => {
        expect(applyNumFmt('boolean', true, undefined)).toBe('TRUE')
        expect(applyNumFmt('boolean', false, undefined)).toBe('FALSE')
    })

    it('null raw renders as empty for non-formula kinds', () => {
        expect(applyNumFmt('number', null, undefined)).toBe('')
        expect(applyNumFmt('string', null, undefined)).toBe('')
        expect(applyNumFmt('date', null, undefined)).toBe('')
    })

    it('formula with no cached value falls back to the formula text', () => {
        expect(applyNumFmt('formula', null, undefined, '=A1+B1')).toBe('=A1+B1')
    })

    it('formula with a cached scalar renders that scalar', () => {
        expect(applyNumFmt('formula', 42, undefined)).toBe('42')
        expect(applyNumFmt('formula', 'hi', undefined)).toBe('hi')
        expect(applyNumFmt('formula', true, undefined)).toBe('TRUE')
    })
})

describe('applyNumFmt — plain text (@)', () => {
    it('plain text passes numbers through untouched', () => {
        // The "Plain text" preset is meant to suppress numeric
        // reformatting: a Number cell shows the user-typed value, not
        // a comma-grouped one.
        expect(applyNumFmt('number', 1234.5, '@')).toBe('1234.5')
    })

    it('plain text passes strings through', () => {
        expect(applyNumFmt('string', 'hello', '@')).toBe('hello')
    })
})

describe('applyNumFmt — Number preset', () => {
    it('groups thousands and shows two decimals', () => {
        expect(applyNumFmt('number', 1000.12, '#,##0.00')).toBe('1,000.12')
        expect(applyNumFmt('number', 1234567.5, '#,##0.00')).toBe('1,234,567.50')
    })

    it('integer numbers still render with the format applied', () => {
        expect(applyNumFmt('number', 42, '#,##0.00')).toBe('42.00')
    })
})

describe('applyNumFmt — Percent preset', () => {
    it('multiplies by 100 and appends %', () => {
        expect(applyNumFmt('number', 0.1012, '0.00%')).toBe('10.12%')
        expect(applyNumFmt('number', 1, '0.00%')).toBe('100.00%')
    })
})

describe('applyNumFmt — Scientific preset', () => {
    it('renders in E-notation', () => {
        expect(applyNumFmt('number', 1010, '0.00E+00')).toBe('1.01E+03')
    })
})

describe('applyNumFmt — Currency presets', () => {
    it('Currency renders dollar-prefixed with two decimals', () => {
        expect(applyNumFmt('number', 1000.12, '$#,##0.00')).toBe('$1,000.12')
    })

    it('Currency rounded drops the decimals', () => {
        expect(applyNumFmt('number', 1000, '$#,##0')).toBe('$1,000')
    })

    it('Financial wraps negatives in parentheses', () => {
        expect(applyNumFmt('number', 1000.12, '#,##0.00;(#,##0.00)')).toBe('1,000.12')
        expect(applyNumFmt('number', -1000.12, '#,##0.00;(#,##0.00)')).toBe('(1,000.12)')
    })
})

describe('applyNumFmt — Date / Time / Datetime / Duration', () => {
    it('Date preset on an ISO date string renders m/d/yyyy', () => {
        expect(applyNumFmt('date', '2008-09-26', 'm/d/yyyy')).toBe('9/26/2008')
    })

    it('Date preset on a JS Date renders m/d/yyyy', () => {
        expect(applyNumFmt('date', new Date('2008-09-26T00:00:00.000Z'), 'm/d/yyyy')).toBe(
            '9/26/2008'
        )
    })

    it('Datetime preset renders both portions', () => {
        // ISO with explicit time goes through Date — emit a full
        // datetime string. The exact h:mm rendering depends on TZ, so
        // we assert the date portion is preserved.
        const out = applyNumFmt('date', '2008-09-26T15:59:00.000Z', 'm/d/yyyy h:mm:ss')
        expect(out.startsWith('9/26/2008')).toBe(true)
    })

    it('Duration preset renders elapsed time from a numeric raw', () => {
        // 1 day + 1 minute as a fractional day = 1.000694…
        expect(applyNumFmt('number', 1.000694444444, '[h]:mm:ss')).toBe('24:01:00')
    })
})

describe('applyNumFmt — empty/edge inputs', () => {
    it('empty pattern is treated as no pattern', () => {
        expect(applyNumFmt('number', 1234.5, '')).toBe('1234.5')
    })

    it('null raw with a number pattern still renders empty', () => {
        expect(applyNumFmt('number', null, '#,##0.00')).toBe('')
    })

    it('string raw on a number pattern falls back to default', () => {
        expect(applyNumFmt('string', 'hello', '#,##0.00')).toBe('hello')
    })
})
