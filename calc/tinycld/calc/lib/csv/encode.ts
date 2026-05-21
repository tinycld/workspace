import type * as Y from 'yjs'
import { formatCell } from '../workbook-types'
import { yCellKey } from '../y-cell-key'
import { CELLS_MAP, readYCell } from '../y-doc-bootstrap'

// serializeSheetToCsv writes the active rectangular extent of a sheet
// as RFC 4180 CSV text. The extent is computed from the maximum row /
// column actually populated in the Y.Doc (NOT the meta rowCount /
// colCount, which the renderer pads up to MIN_ROWS / MIN_COLS); trailing
// empty rows AND trailing empty columns are trimmed so a sheet with one
// cell at (1,1) yields one CSV line, not 50.
//
// useDisplay: true (default) writes the cell's `display` cache — the
// formatted text the user sees on screen, e.g. "$1,234.56" for a
// currency cell or "TRUE" for a boolean. useDisplay: false writes the
// raw scalar's string form, suitable for round-trip into a parser that
// re-detects types.
//
// Line terminator is CRLF per RFC 4180. Quoting wraps any field that
// contains the delimiter, `"`, `\r`, or `\n`; embedded `"` are doubled.

export type CsvDelimiter = ',' | '\t' | ';'

export interface SerializeCsvOptions {
    delimiter?: CsvDelimiter
    useDisplay?: boolean
}

const ROW_SEP = '\r\n'

export function serializeSheetToCsv(
    doc: Y.Doc,
    sheetId: string,
    opts: SerializeCsvOptions = {}
): string {
    const delimiter: CsvDelimiter = opts.delimiter ?? ','
    const useDisplay = opts.useDisplay ?? true

    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    // Walk every cell once to find the actual populated extent and to
    // bucket the values for emission. This is O(N) over all cells in
    // the doc but each cell touch is a hash lookup so practical sheets
    // (10s of thousands of cells) stay fast.
    let maxRow = 0
    let maxCol = 0
    const values = new Map<string, string>()
    cellsMap.forEach((cell, key) => {
        // Skip cells from other sheets — keys are "<sheetId>:<row>:<col>".
        if (!key.startsWith(`${sheetId}:`)) return
        const parts = key.split(':')
        if (parts.length !== 3) return
        const row = Number(parts[1])
        const col = Number(parts[2])
        if (!Number.isFinite(row) || !Number.isFinite(col)) return
        const text = renderCsvCell(cell, useDisplay)
        if (text === '') return
        if (row > maxRow) maxRow = row
        if (col > maxCol) maxCol = col
        values.set(yCellKey(sheetId, row, col), text)
    })

    if (maxRow === 0 || maxCol === 0) return ''

    const lines: string[] = []
    for (let r = 1; r <= maxRow; r++) {
        const parts: string[] = []
        for (let c = 1; c <= maxCol; c++) {
            const text = values.get(yCellKey(sheetId, r, c)) ?? ''
            parts.push(escapeCsvField(text, delimiter))
        }
        lines.push(parts.join(delimiter))
    }
    return lines.join(ROW_SEP)
}

function renderCsvCell(cell: Y.Map<unknown>, useDisplay: boolean): string {
    const snap = readYCell(cell)
    if (useDisplay) return snap.display ?? ''
    // Raw mode: emit the scalar without numFmt formatting. Formula
    // cells with no cached value emit empty (the formula text itself
    // belongs in display-mode fallback, not raw).
    if (snap.raw == null) return ''
    if (typeof snap.raw === 'boolean') return snap.raw ? 'TRUE' : 'FALSE'
    if (typeof snap.raw === 'number') return formatCell('number', snap.raw)
    return String(snap.raw)
}

function escapeCsvField(text: string, delimiter: CsvDelimiter): string {
    if (text === '') return ''
    if (needsQuoting(text, delimiter)) {
        return `"${text.replace(/"/g, '""')}"`
    }
    return text
}

function needsQuoting(text: string, delimiter: CsvDelimiter): boolean {
    if (text.indexOf(delimiter) !== -1) return true
    if (text.indexOf('"') !== -1) return true
    if (text.indexOf('\r') !== -1) return true
    if (text.indexOf('\n') !== -1) return true
    return false
}
