import { formatCell } from '../workbook-types'
import type { ClipboardCell, ClipboardPayload } from './types'

// payloadToHtml emits the text/html clipboard form for interop with
// Google Sheets, Excel Online / Desktop, and other rich-text receivers.
//
// Two responsibilities:
//   1. Carry an opaque marker (<meta name="x-tinycld-calc" ...>) plus
//      `data-tinycld-*` attributes so a same-process or cross-tab paste
//      back into calc can recover the full ClipboardPayload via the
//      fidelity store (when in-process) or via the data-* attributes
//      (cross-tab fallback).
//   2. Carry inline CSS for visual style (font-weight, font-style,
//      colour, background, alignment) so receivers that read HTML
//      surface a styled paste. Sheets and Excel both honour inline
//      CSS at table-cell granularity.
//
// We do NOT emit `data-sheets-formula` or other Sheets-proprietary
// attributes on writeout — Sheets generates them on its own writeouts
// and reads its own format back, but it also reads `<td>` text +
// inline style happily, so writing those attributes would be
// unnecessary noise. We DO read `data-sheets-formula` on decode so
// Sheets → calc paste preserves formulas.

export const FIDELITY_META_NAME = 'x-tinycld-calc'

export function payloadToHtml(payload: ClipboardPayload, markerId: string): string {
    const out: string[] = []
    out.push(`<meta name="${FIDELITY_META_NAME}" content="${escapeAttr(markerId)}">`)
    out.push('<table>')
    for (const row of payload.cells) {
        out.push('<tr>')
        for (const cell of row) {
            out.push(renderTd(cell))
        }
        out.push('</tr>')
    }
    out.push('</table>')
    return out.join('')
}

function renderTd(cell: ClipboardCell): string {
    const attrs: string[] = []
    attrs.push(`data-tinycld-kind="${escapeAttr(cell.kind)}"`)
    if (cell.formula != null) {
        attrs.push(`data-tinycld-formula="${escapeAttr(cell.formula)}"`)
    }
    // Encode the raw scalar so the decoder can recover the original
    // typed value without re-parsing the rendered display. Strings
    // are emitted verbatim; numbers/booleans/dates as their canonical
    // string form. null stays empty.
    if (cell.raw != null) {
        const rawAttr = typeof cell.raw === 'string' ? cell.raw : String(cell.raw)
        attrs.push(`data-tinycld-raw="${escapeAttr(rawAttr)}"`)
    }
    const style = inlineStyleFor(cell)
    if (style.length > 0) {
        attrs.push(`style="${escapeAttr(style)}"`)
    }
    const display = renderDisplay(cell)
    return `<td ${attrs.join(' ')}>${escapeText(display)}</td>`
}

function renderDisplay(cell: ClipboardCell): string {
    if (cell.kind === 'formula') {
        if (cell.raw == null) return ''
        return formatCell(cell.kind, cell.raw)
    }
    return formatCell(cell.kind, cell.raw)
}

function inlineStyleFor(cell: ClipboardCell): string {
    const decls: string[] = []
    const font = cell.style?.font
    const fill = cell.style?.fill
    const align = cell.style?.alignment
    if (font?.bold) decls.push('font-weight:bold')
    if (font?.italic) decls.push('font-style:italic')
    if (font?.underline || font?.strike) {
        const parts: string[] = []
        if (font?.underline) parts.push('underline')
        if (font?.strike) parts.push('line-through')
        decls.push(`text-decoration:${parts.join(' ')}`)
    }
    if (font?.color) decls.push(`color:${normalizeColor(font.color)}`)
    if (font?.size) decls.push(`font-size:${font.size}px`)
    if (font?.name) decls.push(`font-family:${font.name}`)
    if (fill?.fgColor) {
        decls.push(`background-color:${normalizeColor(fill.fgColor)}`)
    } else if (fill?.bgColor) {
        decls.push(`background-color:${normalizeColor(fill.bgColor)}`)
    }
    if (align?.horizontal) decls.push(`text-align:${align.horizontal}`)
    if (align?.vertical) {
        const v =
            align.vertical === 'middle' ? 'middle' : align.vertical === 'top' ? 'top' : 'bottom'
        decls.push(`vertical-align:${v}`)
    }
    return decls.join(';')
}

// Excelize / OOXML colours arrive as 6 or 8 hex digits (the 8-digit
// form includes an alpha byte). CSS only handles `#RRGGBB` reliably —
// strip alpha and prefix `#` when absent. Pass through everything
// already in a CSS-recognisable form (e.g. `rgb(...)`).
function normalizeColor(c: string): string {
    if (c.startsWith('#') || c.startsWith('rgb')) return c
    const hex = c.replace(/[^0-9a-fA-F]/g, '')
    if (hex.length === 8) return `#${hex.slice(2)}`
    if (hex.length === 6) return `#${hex}`
    if (hex.length === 3) return `#${hex}`
    return c
}

function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}
