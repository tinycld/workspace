import { describe, expect, it } from 'vitest'
import { normalizeColor } from '../normalize-color'
import { BORDERS_PALETTE, COLOR_PALETTE } from '../palette'

describe('COLOR_PALETTE', () => {
    it('contains 80 swatches in a 10-wide layout', () => {
        expect(COLOR_PALETTE.length).toBe(80)
        expect(COLOR_PALETTE.length % 10).toBe(0)
    })

    it('starts with the grayscale row (black → white)', () => {
        expect(COLOR_PALETTE[0].hex).toBe('#000000')
        expect(COLOR_PALETTE[9].hex).toBe('#FFFFFF')
    })

    it('has unique hex values', () => {
        const hexes = new Set(COLOR_PALETTE.map(s => s.hex))
        expect(hexes.size).toBe(COLOR_PALETTE.length)
    })

    it('has unique labels (accessibility)', () => {
        const labels = new Set(COLOR_PALETTE.map(s => s.label))
        expect(labels.size).toBe(COLOR_PALETTE.length)
    })

    it('only contains uppercase 6-digit hex values', () => {
        for (const swatch of COLOR_PALETTE) {
            expect(swatch.hex).toMatch(/^#[0-9A-F]{6}$/)
        }
    })
})

describe('BORDERS_PALETTE', () => {
    it('leads with the empty-string sentinel (Default / no override)', () => {
        expect(BORDERS_PALETTE[0]).toEqual({ hex: '', label: 'Default' })
    })

    it('contains 10 entries total', () => {
        expect(BORDERS_PALETTE.length).toBe(10)
    })
})

describe('normalizeColor', () => {
    it('passes hex values through unchanged', () => {
        expect(normalizeColor('#FF0000')).toBe('#FF0000')
    })

    it('prepends # to 6-digit hex (excelize RRGGBB form)', () => {
        expect(normalizeColor('FF0000')).toBe('#FF0000')
        expect(normalizeColor('ff0000')).toBe('#FF0000')
    })

    it('strips opaque alpha from 8-digit hex (excelize AARRGGBB form)', () => {
        expect(normalizeColor('FFFF0000')).toBe('#FF0000')
    })

    it('converts non-opaque 8-digit hex to rgba()', () => {
        // 80 = 128/255 ≈ 0.502 alpha, FF0000 = red
        expect(normalizeColor('80FF0000')).toBe('rgba(255,0,0,0.502)')
    })

    it('returns unrecognized values unchanged', () => {
        expect(normalizeColor('not-a-color')).toBe('not-a-color')
    })
})
