import { describe, expect, it } from 'vitest'
import { isScrolledToBottom } from '../tinycld/mail/hooks/useScrolledToBottom'

describe('isScrolledToBottom', () => {
    it('returns false when content extends well beyond viewport', () => {
        expect(
            isScrolledToBottom({ contentOffsetY: 0, contentHeight: 2000, layoutHeight: 800 })
        ).toBe(false)
    })

    it('returns true at the exact bottom', () => {
        expect(
            isScrolledToBottom({ contentOffsetY: 1200, contentHeight: 2000, layoutHeight: 800 })
        ).toBe(true)
    })

    it('returns true within the 24px threshold', () => {
        expect(
            isScrolledToBottom({ contentOffsetY: 1180, contentHeight: 2000, layoutHeight: 800 })
        ).toBe(true)
    })

    it('returns true exactly at the 24px threshold edge', () => {
        expect(
            isScrolledToBottom({ contentOffsetY: 1176, contentHeight: 2000, layoutHeight: 800 })
        ).toBe(true)
    })

    it('returns false just past the 24px threshold', () => {
        expect(
            isScrolledToBottom({ contentOffsetY: 1175, contentHeight: 2000, layoutHeight: 800 })
        ).toBe(false)
    })

    it('returns true when content fits entirely in the viewport (short thread)', () => {
        expect(
            isScrolledToBottom({ contentOffsetY: 0, contentHeight: 500, layoutHeight: 800 })
        ).toBe(true)
    })
})
