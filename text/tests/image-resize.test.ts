import { describe, expect, it } from 'vitest'
import {
    clampImageSize,
    IMAGE_MAX_HEIGHT,
    IMAGE_MAX_WIDTH,
    IMAGE_MIN_SIZE,
} from '../tinycld/text/lib/image-resize'

// clampImageSize is the pure helper that powers the drag-to-resize
// NodeView. The drag interaction itself is exercised in Playwright
// (tests/image-resize.spec.ts); here we lock in the bounds + ratio
// rules without booting React.
describe('clampImageSize', () => {
    it('clamps horizontal drag width to the editor max width', () => {
        const { width, height } = clampImageSize({
            width: IMAGE_MAX_WIDTH + 250,
            height: 200,
            aspectRatio: 2,
            mode: 'horizontal',
        })
        expect(width).toBe(IMAGE_MAX_WIDTH)
        // height passes through untouched for a horizontal drag — it's
        // the right-edge handle, not the corner.
        expect(height).toBe(200)
    })

    it('enforces the minimum width on a too-small horizontal drag', () => {
        const { width, height } = clampImageSize({
            width: 4,
            height: 120,
            aspectRatio: 1,
            mode: 'horizontal',
        })
        expect(width).toBe(IMAGE_MIN_SIZE)
        expect(height).toBe(120)
    })

    it('enforces the minimum height on a too-small vertical drag', () => {
        const { width, height } = clampImageSize({
            width: 300,
            height: 1,
            aspectRatio: 1,
            mode: 'vertical',
        })
        expect(width).toBe(300)
        expect(height).toBe(IMAGE_MIN_SIZE)
    })

    it('clamps a wildly tall vertical drag to IMAGE_MAX_HEIGHT', () => {
        // The vertical-drag handle gets its own max (a multiple of
        // the width cap). Without this, dragging the bottom edge for
        // a few seconds produces a 10_000+px image that locks up the
        // editor on scroll.
        const { height } = clampImageSize({
            width: 200,
            height: 10_000,
            aspectRatio: 1,
            mode: 'vertical',
        })
        expect(height).toBe(IMAGE_MAX_HEIGHT)
    })

    it('clamps a moderately-tall vertical drag to IMAGE_MAX_HEIGHT too', () => {
        // 5_000 is well over the cap (currently 3_200) but well under
        // the unbounded behaviour we used to have. Verifies the clamp
        // catches the realistic accidental-drag case, not just the
        // pathological extreme.
        const { height } = clampImageSize({
            width: 200,
            height: 5_000,
            aspectRatio: 1,
            mode: 'vertical',
        })
        expect(height).toBe(IMAGE_MAX_HEIGHT)
    })

    it('preserves aspect ratio on a corner drag', () => {
        const { width, height } = clampImageSize({
            width: 400,
            height: 999, // ignored — corner derives height from width/ratio
            aspectRatio: 2,
            mode: 'corner',
        })
        expect(width).toBe(400)
        expect(height).toBe(200)
    })

    it('snaps corner drag back to min-size while preserving ratio', () => {
        // ratio = 4:1 (wide image). A very small target width (10px)
        // would force height below IMAGE_MIN_SIZE; the helper recovers
        // by treating MIN_SIZE as the floor on the smaller axis and
        // scaling the other axis up accordingly.
        const { width, height } = clampImageSize({
            width: 10,
            height: 5,
            aspectRatio: 4,
            mode: 'corner',
        })
        // After hitting min width 32 -> height = 32/4 = 8 < MIN, so we
        // pin height = MIN (32) and scale width = MIN * ratio = 128.
        expect(height).toBe(IMAGE_MIN_SIZE)
        expect(width).toBe(IMAGE_MIN_SIZE * 4)
    })

    it('clamps corner drag to MAX_WIDTH and scales height accordingly', () => {
        const { width, height } = clampImageSize({
            width: IMAGE_MAX_WIDTH + 500,
            height: 0,
            aspectRatio: 2,
            mode: 'corner',
        })
        expect(width).toBe(IMAGE_MAX_WIDTH)
        expect(height).toBe(IMAGE_MAX_WIDTH / 2)
    })

    it('falls back to 1:1 when aspectRatio is zero (image not loaded)', () => {
        const { width, height } = clampImageSize({
            width: 200,
            height: 999,
            aspectRatio: 0,
            mode: 'corner',
        })
        expect(width).toBe(200)
        expect(height).toBe(200)
    })

    it('returns integer values', () => {
        const { width, height } = clampImageSize({
            width: 333.7,
            height: 200.1,
            aspectRatio: 1.7777,
            mode: 'corner',
        })
        expect(Number.isInteger(width)).toBe(true)
        expect(Number.isInteger(height)).toBe(true)
    })
})
