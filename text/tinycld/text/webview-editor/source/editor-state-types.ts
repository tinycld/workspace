// Pure type-only declarations sharable between the WebView entry, the
// web hook, and the native hook + host-side stores. Kept in its own
// file with zero runtime imports so native code that only needs the
// shape (e.g. use-document-editor.native.tsx, image-selection-store.ts)
// can `import type { ImageSelection }` without dragging in the rest of
// editor-state.ts, which imports `@tiptap/core` and `@tiptap/pm/state` —
// modules whose evaluation hits DOM globals and crashes on native at
// module load.

export interface ImageSelection {
    src: string
    alt: string | null
    wrap: 'left' | 'right' | 'break' | null
    width: number | null
    height: number | null
    naturalWidth: number
    naturalHeight: number
    rect: {
        // Viewport coords (raw getBoundingClientRect output — top/left
        // relative to the WebView's visible area, not the document).
        top: number
        left: number
        width: number
        height: number
        // Scroll snapshot of the WebView's document at the moment this
        // rect was captured. The host can use these to derive
        // document-coords (top+scrollY, left+scrollX) or, more usefully,
        // detect that the user has scrolled since emit and decide
        // whether to re-anchor the overlay or dismiss it.
        scrollX: number
        scrollY: number
    } | null
}
