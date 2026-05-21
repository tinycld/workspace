import { describe, expect, it } from 'vitest'
import {
    IMAGE_WRAP_MODES,
    normalizeWrap,
    wrapToAttr,
} from '../tinycld/text/lib/image-wrap-modes'

// image-wrap-modes is the pure helper module that backs the wrap-mode
// toolbar and the WrappedImage schema's parseHTML. The toolbar reads
// normalizeWrap() to decide which button is highlighted; the schema
// reads it to whitelist parsed attribute values; both call wrapToAttr()
// to convert the UX-facing mode (which includes 'inline') to the
// persisted attr value (which never includes 'inline').

describe('IMAGE_WRAP_MODES', () => {
    it('lists the four UX-facing modes in toolbar order', () => {
        expect(IMAGE_WRAP_MODES).toEqual(['inline', 'left', 'right', 'break'])
    })
})

describe('normalizeWrap', () => {
    it('passes through known persisted values', () => {
        expect(normalizeWrap('left')).toBe('left')
        expect(normalizeWrap('right')).toBe('right')
        expect(normalizeWrap('break')).toBe('break')
    })
    it("collapses null / undefined / '' to 'inline'", () => {
        expect(normalizeWrap(null)).toBe('inline')
        expect(normalizeWrap(undefined)).toBe('inline')
        expect(normalizeWrap('')).toBe('inline')
    })
    it("collapses the literal string 'inline' to 'inline' (defensive)", () => {
        // Documents authored before the schema tightening could in
        // theory carry a literal 'inline'. We accept it here so the
        // toolbar still renders correctly; the schema's parseHTML
        // strips the literal on next parse + write so the doc gets
        // cleaner over time.
        expect(normalizeWrap('inline')).toBe('inline')
    })
    it("collapses unknown / malformed inputs to 'inline'", () => {
        expect(normalizeWrap('garbage')).toBe('inline')
        expect(normalizeWrap(42)).toBe('inline')
        expect(normalizeWrap({})).toBe('inline')
        expect(normalizeWrap('LEFT')).toBe('inline') // case sensitive on purpose
    })
})

describe('wrapToAttr', () => {
    it("returns null for the 'inline' mode (absence-of-attribute)", () => {
        expect(wrapToAttr('inline')).toBeNull()
    })
    it('returns the literal attr for the three persisted modes', () => {
        expect(wrapToAttr('left')).toBe('left')
        expect(wrapToAttr('right')).toBe('right')
        expect(wrapToAttr('break')).toBe('break')
    })
})
