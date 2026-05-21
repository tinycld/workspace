// parseCsv parses RFC 4180 CSV (or TSV / semicolon-separated text) into
// a rectangular 2D array of strings. The resulting cells are *not*
// type-detected — that's the apply step's job. Empty trailing rows
// emitted by a final newline are dropped; rows are right-padded with
// empty strings so the output is rectangular.
//
// Auto-detect (the default) samples the first non-quoted line and picks
// whichever of `,`, `\t`, `;` appears most often. Ties break in that
// order — comma wins over tab wins over semicolon. The sampler skips
// over text inside double quotes so a quoted comma in a TSV doesn't
// flip the choice.
//
// Robustness: an unterminated quote consumes the rest of the buffer as
// one cell rather than throwing — matches the existing TSV decoder so
// pasted Sheets/Excel output round-trips even when malformed.

export type CsvDelimiter = ',' | '\t' | ';'

export interface ParseCsvOptions {
    delimiter?: CsvDelimiter | 'auto'
}

const DELIMITER_CANDIDATES: CsvDelimiter[] = [',', '\t', ';']

export function parseCsv(text: string, opts: ParseCsvOptions = {}): string[][] {
    if (text.length === 0) return []
    let body = text
    if (body.charCodeAt(0) === 0xfeff) {
        body = body.slice(1)
    }

    const delimiter = resolveDelimiter(body, opts.delimiter ?? 'auto')

    const rows: string[][] = []
    let row: string[] = []
    let buf = ''
    let inQuoted = false
    let rowTouched = false
    let i = 0

    while (i < body.length) {
        const ch = body[i]

        if (inQuoted) {
            if (ch === '"') {
                if (body[i + 1] === '"') {
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

        if (ch === delimiter) {
            row.push(buf)
            buf = ''
            rowTouched = true
            i++
            continue
        }

        if (ch === '\r' || ch === '\n') {
            row.push(buf)
            rows.push(row)
            row = []
            buf = ''
            rowTouched = false
            if (ch === '\r' && body[i + 1] === '\n') {
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

    if (rowTouched || buf.length > 0) {
        row.push(buf)
        rows.push(row)
    }

    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)
    for (const r of rows) {
        while (r.length < cols) r.push('')
    }
    return rows
}

function resolveDelimiter(text: string, choice: CsvDelimiter | 'auto'): CsvDelimiter {
    if (choice !== 'auto') return choice
    return detectDelimiter(text)
}

// detectDelimiter samples the first non-quoted line and picks whichever
// candidate occurs most often. Ties break by candidate order.
function detectDelimiter(text: string): CsvDelimiter {
    const counts: Record<CsvDelimiter, number> = { ',': 0, '\t': 0, ';': 0 }
    let inQuoted = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inQuoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    i++
                    continue
                }
                inQuoted = false
            }
            continue
        }
        if (ch === '"') {
            inQuoted = true
            continue
        }
        if (ch === '\r' || ch === '\n') break
        if (ch === ',' || ch === '\t' || ch === ';') {
            counts[ch as CsvDelimiter]++
        }
    }
    let best: CsvDelimiter = ','
    let bestCount = counts[','] // ties broken by candidate order, so seed with the first
    for (let i = 1; i < DELIMITER_CANDIDATES.length; i++) {
        const cand = DELIMITER_CANDIDATES[i]
        if (counts[cand] > bestCount) {
            best = cand
            bestCount = counts[cand]
        }
    }
    return best
}
