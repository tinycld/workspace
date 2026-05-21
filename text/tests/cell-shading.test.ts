import { describe, expect, it } from 'vitest'
import {
    CELL_SHADING_PALETTE,
    isValidHexColor,
    normalizeHexColor,
} from '../tinycld/text/lib/cell-shading'

describe('CELL_SHADING_PALETTE', () => {
    it('starts with the "None" option so the picker UI shows it first', () => {
        expect(CELL_SHADING_PALETTE[0]).toEqual({ label: 'None', value: null })
    })

    it('every non-None entry is a normalized 6-digit hex color', () => {
        for (const entry of CELL_SHADING_PALETTE) {
            if (entry.value === null) continue
            expect(entry.value).toMatch(/^#[0-9A-F]{6}$/)
            expect(normalizeHexColor(entry.value)).toBe(entry.value)
        }
    })

    it('contains Yellow #FFFF00 (the docstring example)', () => {
        const yellow = CELL_SHADING_PALETTE.find(o => o.label === 'Yellow')
        expect(yellow?.value).toBe('#FFFF00')
    })

    it("pins the palette so additions/removals require updating the test (palette is user-visible and round-trips through Word)", () => {
        // If you add a color, update this list AND the docstring on
        // cell-shading.ts. Removing a color is a breaking change for
        // any document already using it — those cells will still
        // round-trip the color (it's stored on the cell) but the
        // picker won't let users re-pick it.
        expect(CELL_SHADING_PALETTE.map(o => o.label)).toEqual([
            'None',
            'Yellow',
            'Light Yellow',
            'Light Green',
            'Light Blue',
            'Light Red',
            'Light Purple',
            'Light Orange',
            'Light Gray',
            'Dark Gray',
            'Black',
        ])
    })
})

describe('isValidHexColor', () => {
    it('accepts #RRGGBB (both cases)', () => {
        expect(isValidHexColor('#FFFF00')).toBe(true)
        expect(isValidHexColor('#ffff00')).toBe(true)
        expect(isValidHexColor('#aA1B2c')).toBe(true)
    })

    it('accepts bare RRGGBB (the form Word emits in w:fill)', () => {
        expect(isValidHexColor('FFFF00')).toBe(true)
        expect(isValidHexColor('ffff00')).toBe(true)
    })

    it('rejects 3-digit shorthand (we never want silent expansion)', () => {
        expect(isValidHexColor('#FFF')).toBe(false)
        expect(isValidHexColor('FFF')).toBe(false)
    })

    it('rejects rgb()/named colors and other non-hex strings', () => {
        expect(isValidHexColor('rgb(255, 255, 0)')).toBe(false)
        expect(isValidHexColor('yellow')).toBe(false)
        expect(isValidHexColor('auto')).toBe(false)
    })

    it('rejects empty / null / undefined', () => {
        expect(isValidHexColor('')).toBe(false)
        expect(isValidHexColor(null)).toBe(false)
        expect(isValidHexColor(undefined)).toBe(false)
    })

    it('rejects non-hex characters within a 6-char string', () => {
        expect(isValidHexColor('#GGGGGG')).toBe(false)
        expect(isValidHexColor('123abG')).toBe(false)
    })
})

describe('normalizeHexColor', () => {
    it('upper-cases and prefixes with # — the canonical storage form', () => {
        expect(normalizeHexColor('ffff00')).toBe('#FFFF00')
        expect(normalizeHexColor('FFFF00')).toBe('#FFFF00')
        expect(normalizeHexColor('#ffff00')).toBe('#FFFF00')
        expect(normalizeHexColor('#FFFF00')).toBe('#FFFF00')
    })

    it('returns null for invalid input (does not silently coerce)', () => {
        expect(normalizeHexColor('')).toBeNull()
        expect(normalizeHexColor(null)).toBeNull()
        expect(normalizeHexColor('auto')).toBeNull()
        expect(normalizeHexColor('#FFF')).toBeNull()
        expect(normalizeHexColor('rgb(0,0,0)')).toBeNull()
    })

    it('is idempotent — re-normalizing leaves the canonical form unchanged', () => {
        for (const entry of CELL_SHADING_PALETTE) {
            if (entry.value === null) continue
            expect(normalizeHexColor(entry.value)).toBe(entry.value)
        }
    })
})
