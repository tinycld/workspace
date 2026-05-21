import { describe, expect, it } from 'vitest'
import { stepDecimals } from '../tinycld/calc/lib/number-format/decimal-step'

describe('stepDecimals — undefined input', () => {
    it('seeds to #,##0.0 when increasing from no format', () => {
        expect(stepDecimals(undefined, 1)).toBe('#,##0.0')
    })

    it('returns undefined when decreasing from no format', () => {
        expect(stepDecimals(undefined, -1)).toBeUndefined()
    })

    it('seeds to #,##0.0 when increasing from empty string', () => {
        expect(stepDecimals('', 1)).toBe('#,##0.0')
    })
})

describe('stepDecimals — simple integer/decimal patterns', () => {
    it('#,##0 → #,##0.0 (+1)', () => {
        expect(stepDecimals('#,##0', 1)).toBe('#,##0.0')
    })

    it('#,##0.0 → #,##0.00 (+1)', () => {
        expect(stepDecimals('#,##0.0', 1)).toBe('#,##0.00')
    })

    it('#,##0.00 → #,##0.000 (+1)', () => {
        expect(stepDecimals('#,##0.00', 1)).toBe('#,##0.000')
    })

    it('#,##0.00 → #,##0.0 (-1)', () => {
        expect(stepDecimals('#,##0.00', -1)).toBe('#,##0.0')
    })

    it('#,##0.0 → #,##0 (-1) — drops the dot', () => {
        expect(stepDecimals('#,##0.0', -1)).toBe('#,##0')
    })

    it('#,##0 → #,##0 (-1) — no-op', () => {
        expect(stepDecimals('#,##0', -1)).toBe('#,##0')
    })
})

describe('stepDecimals — currency-prefixed patterns', () => {
    it('$#,##0.00 → $#,##0.000 (+1)', () => {
        expect(stepDecimals('$#,##0.00', 1)).toBe('$#,##0.000')
    })

    it('$#,##0.00 → $#,##0.0 (-1)', () => {
        expect(stepDecimals('$#,##0.00', -1)).toBe('$#,##0.0')
    })

    it('$#,##0 → $#,##0.0 (+1)', () => {
        expect(stepDecimals('$#,##0', 1)).toBe('$#,##0.0')
    })
})

describe('stepDecimals — percent patterns', () => {
    it('0.00% → 0.000% (+1)', () => {
        expect(stepDecimals('0.00%', 1)).toBe('0.000%')
    })

    it('0.00% → 0.0% (-1)', () => {
        expect(stepDecimals('0.00%', -1)).toBe('0.0%')
    })

    it('0.0% → 0% (-1) — drops the dot', () => {
        expect(stepDecimals('0.0%', -1)).toBe('0%')
    })

    it('0% → 0.0% (+1)', () => {
        expect(stepDecimals('0%', 1)).toBe('0.0%')
    })
})

describe('stepDecimals — complex patterns are left alone', () => {
    it('accounting pattern is a no-op (+1)', () => {
        const accounting = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)'
        expect(stepDecimals(accounting, 1)).toBe(accounting)
    })

    it('accounting pattern is a no-op (-1)', () => {
        const accounting = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)'
        expect(stepDecimals(accounting, -1)).toBe(accounting)
    })

    it('financial pattern (with semicolons) is a no-op (+1)', () => {
        const financial = '#,##0.00;(#,##0.00)'
        expect(stepDecimals(financial, 1)).toBe(financial)
    })

    it('scientific is a no-op (+1)', () => {
        expect(stepDecimals('0.00E+00', 1)).toBe('0.00E+00')
    })

    it('date pattern is a no-op (+1)', () => {
        expect(stepDecimals('m/d/yyyy', 1)).toBe('m/d/yyyy')
    })

    it('plain text marker is a no-op (+1)', () => {
        expect(stepDecimals('@', 1)).toBe('@')
    })
})
