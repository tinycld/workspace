// Pure-logic helpers for the inline image resize feature. Kept free
// of React / DOM dependencies so the clamping rules can be exercised
// in isolation by vitest — the drag interaction itself sits inside
// the NodeView component and gets exercised in Playwright.

// Minimum dimensions enforce a visible click target: a 1px-wide image
// is impossible to select again to undo the resize. 32×32 matches the
// MIN_SIZE used by tiptap's table columnResizing.
export const IMAGE_MIN_SIZE = 32

// Maximum width mirrors the document content's max-width
// (editor-content-styles.ts: .ProseMirror { max-width: 680px }).
// We allow a small buffer (800) so users can push images slightly
// past the content column for a wide-image feel without breaking
// the page layout.
export const IMAGE_MAX_WIDTH = 800

// Maximum height is a generous bound (4× max width) — tall enough to
// permit a long portrait or screenshot without truncating the user's
// intent, but small enough to prevent pathological 10_000-px+ images
// that would lock up the editor on scroll. The vertical drag handle
// caps at this value; the corner drag (which scales by aspect ratio)
// is implicitly bounded by IMAGE_MAX_WIDTH.
export const IMAGE_MAX_HEIGHT = IMAGE_MAX_WIDTH * 4

export type ResizeMode = 'horizontal' | 'vertical' | 'corner'

export interface ClampImageSizeInput {
    width: number
    height: number
    aspectRatio: number
    mode: ResizeMode
}

export interface ClampedSize {
    width: number
    height: number
}

// clampImageSize returns integer width/height values that respect the
// per-mode constraints:
//
//   horizontal — width is clamped to [MIN, MAX_WIDTH], height left
//     untouched (caller is dragging the right edge, height stays put).
//   vertical   — height is clamped to a minimum of MIN, width
//     untouched.
//   corner     — both clamped, with the aspect ratio (captured at
//     drag start) used to derive the partner dimension. We clamp
//     against width first because the editor's max-width is the
//     dominant constraint; height follows from the ratio.
//
// The aspectRatio passed in is naturalWidth / naturalHeight from the
// underlying <img>. A ratio of 0 (defensive against a div-by-zero
// when the image hasn't loaded) falls back to 1:1 — no ratio info
// means a square drag.
export function clampImageSize({
    width,
    height,
    aspectRatio,
    mode,
}: ClampImageSizeInput): ClampedSize {
    const ratio = aspectRatio > 0 ? aspectRatio : 1
    if (mode === 'horizontal') {
        const clampedWidth = Math.max(IMAGE_MIN_SIZE, Math.min(width, IMAGE_MAX_WIDTH))
        return { width: Math.round(clampedWidth), height: Math.round(height) }
    }
    if (mode === 'vertical') {
        const clampedHeight = Math.max(IMAGE_MIN_SIZE, Math.min(height, IMAGE_MAX_HEIGHT))
        return { width: Math.round(width), height: Math.round(clampedHeight) }
    }
    let clampedWidth = Math.max(IMAGE_MIN_SIZE, Math.min(width, IMAGE_MAX_WIDTH))
    let clampedHeight = clampedWidth / ratio
    if (clampedHeight < IMAGE_MIN_SIZE) {
        clampedHeight = IMAGE_MIN_SIZE
        clampedWidth = clampedHeight * ratio
    }
    return { width: Math.round(clampedWidth), height: Math.round(clampedHeight) }
}
