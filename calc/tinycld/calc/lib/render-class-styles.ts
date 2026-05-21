// Single source of truth for the visual semantics of every
// `tinycld-calc-cell--*` modifier class the calc renderer emits.
// Both the preview surface (`components/preview-css.ts`) and the
// print envelope (`lib/print/print-css.web.ts`) include these rules
// verbatim so cell formatting renders identically on screen and on
// paper.
//
// What lives here: rules whose appearance is intrinsic to the
// formatting (bold means bold, align-right means right-aligned,
// border-top means a heavier top edge) and that should never differ
// between preview and print.
//
// What does NOT live here: chrome that depends on the host surface
// — theme tokens, row/column-header background, default cell border
// color, sheet-separator spacing, @page rules. Each surface
// continues to own its own chrome because the design intent
// genuinely differs (screen previews honor light/dark; print uses
// neutral paper colors and break hints).
export const RENDER_CELL_MODIFIER_CSS = `
.tinycld-calc-cell--bold { font-weight: 600; }
.tinycld-calc-cell--italic { font-style: italic; }
.tinycld-calc-cell--underline { text-decoration: underline; }
.tinycld-calc-cell--strike { text-decoration: line-through; }
.tinycld-calc-cell--align-left { text-align: left; }
.tinycld-calc-cell--align-center { text-align: center; }
.tinycld-calc-cell--align-right { text-align: right; }
.tinycld-calc-cell--valign-top { vertical-align: top; }
.tinycld-calc-cell--valign-middle { vertical-align: middle; }
.tinycld-calc-cell--valign-bottom { vertical-align: bottom; }
.tinycld-calc-cell--wrap { white-space: normal; }
.tinycld-calc-cell--border-top { border-top-width: 2px; }
.tinycld-calc-cell--border-right { border-right-width: 2px; }
.tinycld-calc-cell--border-bottom { border-bottom-width: 2px; }
.tinycld-calc-cell--border-left { border-left-width: 2px; }
`
