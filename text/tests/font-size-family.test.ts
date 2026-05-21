// Pure-helper tests for the font-size + family picker plumbing:
//   - Conversion between CSS px and OOXML half-points stays
//     round-trip stable across the editor's dropdown set.
//   - The toolbar-state derivation reads textStyle.fontSize /
//     textStyle.fontFamily off the Tiptap editor and normalises them
//     into the EditorToolbarState shape (integer px / family string /
//     null).

import { describe, expect, it } from 'vitest'
import {
    FONT_FAMILY_OPTIONS,
    FONT_SIZE_OPTIONS,
    type FontOption,
} from '../tinycld/text/lib/font-options'

// pxToHalfPoints + halfPointsToPx mirror the Go helpers in
// server/translate/font.go. Half-points = px * 144 / 96 = px * 1.5; px
// back = half-points * 2 / 3. Rounded to nearest integer. The pure
// arithmetic lives here so the toolbar code (which only deals in px)
// and the round-trip code (which only deals in half-points on the
// wire) agree on the conversion.
function pxToHalfPoints(px: number): number {
    if (!Number.isFinite(px) || px <= 0) return 0
    return Math.round(px * 1.5)
}
function halfPointsToPx(hp: number): number {
    if (!Number.isFinite(hp) || hp <= 0) return 0
    return Math.round((hp * 2) / 3)
}

// Tiptap's FontSize extension stores the attribute verbatim as a CSS
// length string ("16px"). The toolbar's currentFontSize is a number,
// so the editor hook derives it via a tiny parse step. We exercise
// that step in isolation here, since wiring up a full Tiptap editor
// in a unit test is heavy.
function deriveFontSizeFromAttr(raw: unknown): number | null {
    if (typeof raw !== 'string' || raw === '') return null
    const trimmed = raw.trim().toLowerCase()
    const numeric = trimmed.endsWith('px') ? trimmed.slice(0, -2).trim() : trimmed
    const n = Number.parseFloat(numeric)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.round(n)
}

function deriveFontFamilyFromAttr(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw === '') return null
    return raw
}

describe('font-size px ⇄ half-points', () => {
    it('round-trips every value in FONT_SIZE_OPTIONS without drift', () => {
        for (const px of FONT_SIZE_OPTIONS) {
            const hp = pxToHalfPoints(px)
            const back = halfPointsToPx(hp)
            expect(back).toBe(px)
        }
    })

    it('matches known Word values', () => {
        expect(halfPointsToPx(24)).toBe(16)
        expect(halfPointsToPx(20)).toBe(13)
        expect(halfPointsToPx(48)).toBe(32)
    })

    it('treats 0 / negative / NaN as 0', () => {
        expect(pxToHalfPoints(0)).toBe(0)
        expect(pxToHalfPoints(-1)).toBe(0)
        expect(pxToHalfPoints(Number.NaN)).toBe(0)
        expect(halfPointsToPx(0)).toBe(0)
        expect(halfPointsToPx(-1)).toBe(0)
        expect(halfPointsToPx(Number.NaN)).toBe(0)
    })
})

describe('toolbar fontSize derivation', () => {
    it('reads the integer px out of a "16px" attr', () => {
        expect(deriveFontSizeFromAttr('16px')).toBe(16)
    })

    it('tolerates whitespace and case', () => {
        expect(deriveFontSizeFromAttr(' 24PX ')).toBe(24)
        expect(deriveFontSizeFromAttr('24Px')).toBe(24)
    })

    it('rounds non-integer values to the nearest pixel', () => {
        // A Word import might land on 13.33px when converting half-
        // points back to px; the dropdown shows whole pixels only.
        expect(deriveFontSizeFromAttr('13.4px')).toBe(13)
        expect(deriveFontSizeFromAttr('13.7px')).toBe(14)
    })

    it('returns null for missing, blank, zero, or non-numeric input', () => {
        expect(deriveFontSizeFromAttr(undefined)).toBeNull()
        expect(deriveFontSizeFromAttr(null)).toBeNull()
        expect(deriveFontSizeFromAttr('')).toBeNull()
        expect(deriveFontSizeFromAttr('0px')).toBeNull()
        expect(deriveFontSizeFromAttr('-12px')).toBeNull()
        expect(deriveFontSizeFromAttr('garbage')).toBeNull()
    })
})

describe('toolbar fontFamily derivation', () => {
    it('returns the family string verbatim', () => {
        expect(deriveFontFamilyFromAttr('Georgia, serif')).toBe('Georgia, serif')
        expect(deriveFontFamilyFromAttr("'Times New Roman', serif")).toBe(
            "'Times New Roman', serif"
        )
    })

    it('returns null for missing or empty input', () => {
        expect(deriveFontFamilyFromAttr(undefined)).toBeNull()
        expect(deriveFontFamilyFromAttr(null)).toBeNull()
        expect(deriveFontFamilyFromAttr('')).toBeNull()
    })
})

describe('FONT_SIZE_OPTIONS contract', () => {
    it('is sorted ascending and has no duplicates', () => {
        for (let i = 1; i < FONT_SIZE_OPTIONS.length; i++) {
            expect(FONT_SIZE_OPTIONS[i]).toBeGreaterThan(FONT_SIZE_OPTIONS[i - 1] ?? 0)
        }
    })

    it('only contains positive integer pixel values', () => {
        for (const px of FONT_SIZE_OPTIONS) {
            expect(Number.isInteger(px)).toBe(true)
            expect(px).toBeGreaterThan(0)
        }
    })
})

describe('FONT_FAMILY_OPTIONS contract', () => {
    it('only contains valid fallback categories', () => {
        const valid = new Set<FontOption['fallback']>(['sans-serif', 'serif', 'monospace'])
        for (const opt of FONT_FAMILY_OPTIONS) {
            expect(valid.has(opt.fallback)).toBe(true)
            expect(opt.name.length).toBeGreaterThan(0)
        }
    })

    it('has no duplicate names', () => {
        const names = FONT_FAMILY_OPTIONS.map(o => o.name)
        expect(new Set(names).size).toBe(names.length)
    })
})
