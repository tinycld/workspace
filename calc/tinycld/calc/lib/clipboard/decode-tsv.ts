import type { ClipboardCell, ClipboardPayload } from './types'

// tsvToPayload is the universal fallback: parse a plain-text TSV/CSV-
// like blob into a rectangular ClipboardPayload of typed-string cells.
// The caller routes each cell through inferCellInput at write time so
// numeric / date / boolean kinds re-coerce at the destination.
//
// Quoting follows RFC 4180: a cell wrapped in double quotes may contain
// tabs, newlines, and `""`-escaped quotes. Unquoted cells terminate on
// the first tab or end-of-line.
//
// Robustness: malformed input never throws. An unterminated quote
// consumes the rest of the buffer as one cell; bare quotes inside an
// unquoted cell pass through literally. The aim is to round-trip
// well-formed Sheets/Excel output verbatim and survive everything else.

export function tsvToPayload(text: string): ClipboardPayload {
    if (text.length === 0) {
        return { rows: 0, cols: 0, cells: [], sourceAnchor: { row: 1, col: 1 } }
    }

    const rows: ClipboardCell[][] = []
    let row: ClipboardCell[] = []
    let buf = ''
    let inQuoted = false
    let i = 0
    // Track whether we've consumed any character on the current row,
    // so an empty trailing line (after a final CRLF) doesn't become a
    // spurious row.
    let rowTouched = false

    while (i < text.length) {
        const ch = text[i]

        if (inQuoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    buf += '"'
                    i += 2
                    continue
                }
                inQuoted = false
                i++
                continue
            }
            buf += ch
            i++
            continue
        }

        if (ch === '"') {
            inQuoted = true
            rowTouched = true
            i++
            continue
        }

        if (ch === '\t') {
            row.push({ kind: 'string', raw: buf })
            buf = ''
            rowTouched = true
            i++
            continue
        }

        if (ch === '\r' || ch === '\n') {
            // Commit the in-progress cell + row.
            row.push({ kind: 'string', raw: buf })
            rows.push(row)
            row = []
            buf = ''
            rowTouched = false
            // Swallow CRLF as one separator.
            if (ch === '\r' && text[i + 1] === '\n') {
                i += 2
            } else {
                i++
            }
            continue
        }

        buf += ch
        rowTouched = true
        i++
    }

    // Trailing cell/row. If the input ended cleanly on a newline,
    // rowTouched is false and we skip — otherwise commit what's left.
    if (rowTouched || buf.length > 0) {
        row.push({ kind: 'string', raw: buf })
        rows.push(row)
    }

    // Pad to a rectangular grid: every row gets padded to the widest.
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)
    for (const r of rows) {
        while (r.length < cols) r.push({ kind: 'string', raw: '' })
    }

    return {
        rows: rows.length,
        cols,
        cells: rows,
        sourceAnchor: { row: 1, col: 1 },
    }
}
