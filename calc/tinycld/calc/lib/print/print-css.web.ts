import { RENDER_CELL_MODIFIER_CSS } from '../render-class-styles'
import type { PrintConfig, PrintMargins } from './types'

// Numbers are inches because @page margins are universally supported
// in inches and that matches the labels print preview shows.
const MARGIN_INCHES: Record<PrintMargins, string> = {
    narrow: '0.25in',
    normal: '0.75in',
    wide: '1in',
}

// buildPrintCss returns the BODY of a <style> block (no outer
// <style> tags). The print envelope embeds this between
// <head><style> and </style></head>, and the server-rendered
// fragment provides the `tinycld-calc*` class names this CSS
// targets.
//
// On web, browsers fetch external images themselves during the
// print preview, so `images=url` mode (the default) works fine.
// We don't need to strip any external assets here.
export function buildPrintCss(config: PrintConfig): string {
    const { orientation, scaling, margins } = config.page
    const { showHeaders, showGridlines } = config.layout

    const lines: string[] = []

    lines.push(`@page { size: ${orientation}; margin: ${MARGIN_INCHES[margins]}; }`)
    lines.push('html, body { margin: 0; padding: 0; }')
    lines.push(
        "body { font-family: -apple-system, system-ui, 'Segoe UI', sans-serif; color: #000; }"
    )

    const tableWidth =
        scaling === 'fit-width' || scaling === 'fit-page' ? '100%' : 'auto'
    lines.push(
        `.tinycld-calc-grid { border-collapse: collapse; width: ${tableWidth}; table-layout: fixed; }`
    )
    if (scaling === 'fit-page') {
        // Best-effort: hint the print engine to keep the table on a
        // single page. Browsers vary in honoring this; the OS print
        // dialog's "fit to page" usually overrides.
        lines.push('.tinycld-calc-grid { page-break-inside: avoid; }')
    }
    lines.push('thead { display: table-header-group; }')
    lines.push('tr { break-inside: avoid; page-break-inside: avoid; }')

    if (showGridlines) {
        lines.push(
            '.tinycld-calc-grid td, .tinycld-calc-grid th { border: 1px solid #ccc; padding: 2px 4px; }'
        )
    } else {
        lines.push('.tinycld-calc-grid td, .tinycld-calc-grid th { padding: 2px 4px; }')
    }

    // Row + column headers were called .row-header/.col-header in the
    // old client-rendered path; the server emits stable
    // `tinycld-calc-row-h` / `tinycld-calc-col-h`. Show or hide them
    // entirely based on the user's print option.
    if (showHeaders) {
        lines.push(
            '.tinycld-calc-row-h, .tinycld-calc-col-h, .tinycld-calc-corner { background-color: #f2f2f2; text-align: center; font-weight: normal; color: #555; font-size: 9pt; }'
        )
    } else {
        lines.push(
            '.tinycld-calc-row-h, .tinycld-calc-col-h, .tinycld-calc-corner { display: none; }'
        )
    }

    // Per-sheet title: server emits .tinycld-calc-sheet-title only
    // when the fragment contains multiple sheets. Pre/post spacing
    // mirrors the original print layout.
    lines.push(
        '.tinycld-calc-sheet-title { font-size: 14pt; margin: 0 0 8px 0; padding-top: 12px; break-before: page; }'
    )
    lines.push(
        '.tinycld-calc-sheet:first-of-type .tinycld-calc-sheet-title { break-before: avoid; padding-top: 0; }'
    )

    // Cell modifier classes (bold/italic/align/border/etc.) — pulled
    // from the shared render-class-styles module so print and preview
    // can't drift when the renderer adds new modifier classes.
    lines.push(RENDER_CELL_MODIFIER_CSS.trim())

    // Per-cell color / fill / font / family overrides are projected
    // by the server as inline `style="…"` on each cell — the
    // sanitizer's safe-property allowlist passes them through. No
    // additional CSS rules required here.

    return lines.join('\n')
}
