import { RENDER_CELL_MODIFIER_CSS } from '../lib/render-class-styles'

// preview-css.ts is the styling layer for the calc preview surface.
// The server emits stable `tinycld-calc*` class names; this file
// turns those into a theme-aware visual treatment for the read-only
// preview iframe.
//
// The iframe is sandboxed (no scripts, same-origin) so we cannot pull
// theme tokens from the parent. We embed both light and dark palettes
// and switch via `@media (prefers-color-scheme)` — the OS-level
// preference closely matches what the app would pick anyway, and the
// preview is short-lived enough that drift between the two is
// uninteresting.
//
// Layout choices:
//   - tinycld-calc grid uses table-layout: auto so wide cells widen
//     naturally — this is a read-only viewer, not a fixed-grid editor.
//   - row/column headers use a slightly darker background and reduced
//     font size to mirror the on-screen editor.
//   - cell defaults: 1px border, modest padding, vertical-align middle.
export const PREVIEW_CSS = `
:root {
    color-scheme: light dark;
    --tc-fg: #18181b;
    --tc-bg: #ffffff;
    --tc-muted: #71717a;
    --tc-border: #e4e4e7;
    --tc-header-bg: #fafafa;
    --tc-header-fg: #52525b;
    --tc-cell-bg: transparent;
}
@media (prefers-color-scheme: dark) {
    :root {
        --tc-fg: #fafafa;
        --tc-bg: #09090b;
        --tc-muted: #a1a1aa;
        --tc-border: #27272a;
        --tc-header-bg: #18181b;
        --tc-header-fg: #a1a1aa;
        --tc-cell-bg: transparent;
    }
}
html, body { margin: 0; padding: 0; }
body {
    font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
    font-size: 13px;
    color: var(--tc-fg);
    background: var(--tc-bg);
}
.tinycld-calc {
    width: 100%;
    overflow: auto;
}
.tinycld-calc-sheet + .tinycld-calc-sheet {
    margin-top: 24px;
}
.tinycld-calc-sheet-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 8px 0;
    padding: 4px 0;
}
.tinycld-calc-grid {
    border-collapse: collapse;
    width: auto;
    table-layout: auto;
}
.tinycld-calc-corner,
.tinycld-calc-col-h,
.tinycld-calc-row-h {
    background: var(--tc-header-bg);
    color: var(--tc-header-fg);
    font-weight: normal;
    font-size: 11px;
    text-align: center;
    border: 1px solid var(--tc-border);
    padding: 2px 6px;
    min-width: 28px;
}
.tinycld-calc-col-h { min-width: 80px; }
.tinycld-calc-cell {
    border: 1px solid var(--tc-border);
    padding: 2px 6px;
    background: var(--tc-cell-bg);
    vertical-align: middle;
    min-width: 80px;
    max-width: 320px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
${RENDER_CELL_MODIFIER_CSS}
/* Per-cell color / fill / font / size overrides come from inline
   style="…" on each cell, projected by the server renderer and passed
   through by the sanitizer's safe-property allowlist. */
`
