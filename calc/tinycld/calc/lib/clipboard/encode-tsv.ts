import { formatCell } from '../workbook-types'
import type { ClipboardCell, ClipboardPayload } from './types'

// payloadToTsv produces the text/plain clipboard form — the universally
// portable shape every spreadsheet (and every text editor) accepts.
// Rows are CRLF-separated, columns tab-separated. Cells containing
// special characters (tab, CR, LF, or `"`) are wrapped in double quotes
// with internal `"` doubled, per RFC 4180.
//
// Formula cells emit the cached scalar (`raw`) through formatCell, not
// the formula text. This matches what Sheets/Excel write: copying a
// SUM cell into a text editor pastes the number, not the formula. The
// fidelity-preserving form for formulas lives in the HTML payload via
// data-tinycld-formula.

const ROW_SEP = '\r\n'
const COL_SEP = '\t'

export function payloadToTsv(payload: ClipboardPayload): string {
    const lines: string[] = []
    for (const row of payload.cells) {
        const parts: string[] = []
        for (const cell of row) {
            parts.push(escapeCell(cell))
        }
        lines.push(parts.join(COL_SEP))
    }
    return lines.join(ROW_SEP)
}

function escapeCell(cell: ClipboardCell): string {
    const text = renderCell(cell)
    if (text === '') return ''
    if (NEEDS_QUOTE_RE.test(text)) {
        return `"${text.replace(/"/g, '""')}"`
    }
    return text
}

const NEEDS_QUOTE_RE = /[\t\r\n"]/

function renderCell(cell: ClipboardCell): string {
    // For non-formula cells render the kind-aware display string. For
    // formula cells render only the cached scalar (no formula text in
    // TSV) — formula round-tripping is the HTML encoder's job.
    if (cell.kind === 'formula') {
        if (cell.raw == null) return ''
        return formatCell(cell.kind, cell.raw)
    }
    return formatCell(cell.kind, cell.raw)
}
