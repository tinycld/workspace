import type { CellKind, CellStyle } from '../workbook-types'
import { FIDELITY_META_NAME } from './encode-html'
import type { ClipboardCell, ClipboardPayload } from './types'

// htmlToPayload parses a clipboard-shaped HTML blob into a
// ClipboardPayload. Designed for three sources:
//   1. Our own encoder (data-tinycld-* attrs → fidelity recovery).
//   2. Google Sheets (data-sheets-formula → formula recovery; inline
//      style → CellStyle subset).
//   3. Excel / LibreOffice / generic <table> producers (text + inline
//      style only).
//
// Returns null if no <table> is found — the caller should fall back to
// TSV parsing. Returns a `markerId` alongside the payload when the
// `<meta name="x-tinycld-calc">` marker is present so the caller can
// attempt a fidelity-store lookup before falling back to the parsed
// payload.
//
// Why we don't use DOMParser: the decoder must run in Node for tests
// (no DOM env without adding happy-dom/jsdom). The clipboard HTML we
// expect is highly constrained — `<meta>`, `<table>`, `<tr>`, `<td>`,
// text, and inline styles — so a focused mini-parser is small and
// stable. If we later need fuller HTML support we can swap to
// DOMParser in browser code and keep this fallback for tests.

export interface DecodedHtml {
    markerId: string | null
    payload: ClipboardPayload
}

export function htmlToPayload(html: string): DecodedHtml | null {
    const markerId = extractMarker(html)
    // Strip HTML comments (Excel writes <!--StartFragment-->) so the
    // table scanner doesn't have to special-case them.
    const stripped = stripComments(html)
    const tableHtml = extractFirstTable(stripped)
    if (tableHtml == null) return null

    const rows = parseRows(tableHtml)
    if (rows.length === 0) return null

    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)
    for (const r of rows) {
        while (r.length < cols) r.push({ kind: 'string', raw: '' })
    }

    return {
        markerId,
        payload: {
            rows: rows.length,
            cols,
            cells: rows,
            sourceAnchor: { row: 1, col: 1 },
        },
    }
}

function stripComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '')
}

function extractMarker(html: string): string | null {
    // Case-insensitive, tolerates extra whitespace and attribute order.
    const re = new RegExp(
        `<meta[^>]*\\bname\\s*=\\s*["']${FIDELITY_META_NAME}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`,
        'i'
    )
    const m = re.exec(html)
    if (m != null) return unescapeAttr(m[1])
    // Try reversed attribute order (content before name).
    const re2 = new RegExp(
        `<meta[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\bname\\s*=\\s*["']${FIDELITY_META_NAME}["']`,
        'i'
    )
    const m2 = re2.exec(html)
    return m2 != null ? unescapeAttr(m2[1]) : null
}

function extractFirstTable(html: string): string | null {
    const m = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html)
    return m != null ? m[1] : null
}

function parseRows(tableHtml: string): ClipboardCell[][] {
    const out: ClipboardCell[][] = []
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null
    rowMatch = rowRe.exec(tableHtml)
    while (rowMatch != null) {
        out.push(parseCells(rowMatch[1]))
        rowMatch = rowRe.exec(tableHtml)
    }
    return out
}

function parseCells(rowHtml: string): ClipboardCell[] {
    const cells: ClipboardCell[] = []
    // Match both <td> and <th> tags. Sheets sometimes emits <th> for
    // header rows when the source had a frozen header.
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi
    let m: RegExpExecArray | null
    m = cellRe.exec(rowHtml)
    while (m != null) {
        const attrs = parseAttributes(m[2])
        const inner = m[3]
        cells.push(buildCell(attrs, inner))
        m = cellRe.exec(rowHtml)
    }
    return cells
}

function buildCell(attrs: Map<string, string>, innerHtml: string): ClipboardCell {
    const kindAttr = attrs.get('data-tinycld-kind') as CellKind | undefined
    const rawAttr = attrs.get('data-tinycld-raw')
    const formulaAttr =
        attrs.get('data-tinycld-formula') ?? attrs.get('data-sheets-formula') ?? undefined
    const style = parseInlineStyle(attrs.get('style'))

    const displayText = stripTags(innerHtml).trim()
    const cell: ClipboardCell = {
        kind: kindAttr ?? 'string',
        raw: coerceRaw(kindAttr ?? 'string', rawAttr, displayText),
    }
    if (formulaAttr != null) cell.formula = formulaAttr
    if (style != null) cell.style = style
    return cell
}

function coerceRaw(
    kind: CellKind,
    rawAttr: string | undefined,
    displayText: string
): ClipboardCell['raw'] {
    // Prefer the data-tinycld-raw attribute (round-trip path). Fall
    // back to coercing the visible text when only display is present
    // (Sheets/Excel paste path).
    const source = rawAttr ?? displayText
    if (source === '') return ''
    switch (kind) {
        case 'number': {
            const n = Number(source)
            return Number.isFinite(n) ? n : null
        }
        case 'boolean':
            return source.toUpperCase() === 'TRUE'
        case 'formula':
            // The cached scalar inside a formula cell can be any
            // serialisable type. Re-detect from the string form: it's
            // a boolean if the source matches TRUE/FALSE, a number if
            // parseable, otherwise a string. This is the inverse of
            // what the encoder writes via `String(raw)`.
            return coerceFormulaScalar(source)
        case 'date':
        case 'string':
            return source
    }
}

function coerceFormulaScalar(source: string): ClipboardCell['raw'] {
    const upper = source.toUpperCase()
    if (upper === 'TRUE') return true
    if (upper === 'FALSE') return false
    if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(source)) {
        const n = Number(source)
        if (Number.isFinite(n)) return n
    }
    return source
}

function parseAttributes(s: string): Map<string, string> {
    const out = new Map<string, string>()
    const re = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
    let m: RegExpExecArray | null
    m = re.exec(s)
    while (m != null) {
        const value = m[3] ?? m[4] ?? ''
        out.set(m[1].toLowerCase(), unescapeAttr(value))
        m = re.exec(s)
    }
    return out
}

function parseInlineStyle(style: string | undefined): CellStyle | undefined {
    if (!style) return undefined
    const decls = style.split(';')
    const out: CellStyle = {}
    const font: NonNullable<CellStyle['font']> = {}
    const fill: NonNullable<CellStyle['fill']> = {}
    const alignment: NonNullable<CellStyle['alignment']> = {}
    let fontUsed = false
    let fillUsed = false
    let alignUsed = false

    for (const decl of decls) {
        const colonIdx = decl.indexOf(':')
        if (colonIdx < 0) continue
        const prop = decl.slice(0, colonIdx).trim().toLowerCase()
        const value = decl.slice(colonIdx + 1).trim()
        if (value.length === 0) continue

        switch (prop) {
            case 'font-weight':
                if (value === 'bold' || Number(value) >= 600) {
                    font.bold = true
                    fontUsed = true
                }
                break
            case 'font-style':
                if (value === 'italic') {
                    font.italic = true
                    fontUsed = true
                }
                break
            case 'text-decoration':
            case 'text-decoration-line':
                if (/underline/.test(value)) {
                    font.underline = true
                    fontUsed = true
                }
                if (/line-through/.test(value)) {
                    font.strike = true
                    fontUsed = true
                }
                break
            case 'color': {
                const c = parseCssColor(value)
                if (c != null) {
                    font.color = c
                    fontUsed = true
                }
                break
            }
            case 'font-size': {
                const n = parsePx(value)
                if (n != null) {
                    font.size = n
                    fontUsed = true
                }
                break
            }
            case 'font-family':
                font.name = value.replace(/^['"]|['"]$/g, '')
                fontUsed = true
                break
            case 'background-color':
            case 'background': {
                const c = parseCssColor(value)
                if (c != null) {
                    fill.fgColor = c
                    fillUsed = true
                }
                break
            }
            case 'text-align':
                if (value === 'left' || value === 'center' || value === 'right') {
                    alignment.horizontal = value
                    alignUsed = true
                }
                break
            case 'vertical-align':
                if (value === 'top' || value === 'middle' || value === 'bottom') {
                    alignment.vertical = value
                    alignUsed = true
                }
                break
        }
    }

    if (fontUsed) out.font = font
    if (fillUsed) {
        fill.type = 'pattern'
        fill.pattern = 'solid'
        out.fill = fill
    }
    if (alignUsed) out.alignment = alignment

    return fontUsed || fillUsed || alignUsed ? out : undefined
}

function parsePx(value: string): number | null {
    const m = /^([\d.]+)\s*(px|pt)?$/.exec(value)
    if (m == null) return null
    const n = Number(m[1])
    return Number.isFinite(n) ? n : null
}

function parseCssColor(value: string): string | null {
    // Hex with hash: keep verbatim, sans hash for excelize-compat
    // storage (matches what payloadToHtml normalises FROM).
    const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value)
    if (hex != null) {
        const h = hex[1]
        if (h.length === 3) {
            return h
                .split('')
                .map(c => c + c)
                .join('')
        }
        if (h.length === 8) return h.slice(2)
        return h
    }
    // rgb()/rgba() — convert to hex for symmetry with our encoder.
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value)
    if (rgb != null) {
        return [rgb[1], rgb[2], rgb[3]]
            .map(n => Number(n).toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase()
    }
    return null
}

function stripTags(s: string): string {
    return decodeEntities(s.replace(/<[^>]+>/g, ''))
}

function decodeEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
}

function unescapeAttr(s: string): string {
    return decodeEntities(s)
}
