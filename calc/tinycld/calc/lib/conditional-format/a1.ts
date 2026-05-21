// Sheet-relative A1 range parser for conditional formatting rules.
// Differs from lib/pivot/range-parse.ts in two ways:
//   1. No sheet prefix — rules are stored under a specific sheet, so
//      ranges are scoped to that sheet implicitly.
//   2. Accepts full-column ("A:A") and full-row ("1:5") notations, and
//      single-cell anchors ("B2") in addition to rectangles ("A1:C10").
//
// `$` anchors on cell coordinates are accepted and stripped — they
// have no effect on range storage (a range is a rectangle, not a
// formula reference).

export interface ParsedCellRange {
    startRow: number
    startCol: number
    endRow: number
    endCol: number
}

// MAX_ROW / MAX_COL bound full-column / full-row ranges. Excel's hard
// limits are 1,048,576 rows × 16,384 columns; the calc grid never
// approaches either, but the cell-render hot path benefits from a
// finite bound when iterating range membership. 1<<20 rows is the
// xlsx ceiling; 16384 (XFD) is the xlsx column ceiling.
export const MAX_ROW = 1048576
export const MAX_COL = 16384

const A1_CELL = /^\$?([A-Z]+)\$?(\d+)$/
const COL_ONLY = /^\$?([A-Z]+)$/
const ROW_ONLY = /^\$?(\d+)$/

export function parseSheetRange(input: string): ParsedCellRange | null {
    const trimmed = input.trim()
    if (trimmed.length === 0) return null
    const colon = trimmed.indexOf(':')
    if (colon < 0) {
        const cell = parseCellAddress(trimmed)
        if (cell == null) return null
        return { startRow: cell.row, startCol: cell.col, endRow: cell.row, endCol: cell.col }
    }
    const left = trimmed.slice(0, colon)
    const right = trimmed.slice(colon + 1)
    // Full-column ranges: "A:A", "B:D"
    const lc = COL_ONLY.exec(left)
    const rc = COL_ONLY.exec(right)
    if (lc != null && rc != null) {
        const startCol = lettersToCol(lc[1])
        const endCol = lettersToCol(rc[1])
        return { startRow: 1, startCol, endRow: MAX_ROW, endCol }
    }
    // Full-row ranges: "1:5", "10:10"
    const lr = ROW_ONLY.exec(left)
    const rr = ROW_ONLY.exec(right)
    if (lr != null && rr != null) {
        const startRow = Number(lr[1])
        const endRow = Number(rr[1])
        return { startRow, startCol: 1, endRow, endCol: MAX_COL }
    }
    const start = parseCellAddress(left)
    const end = parseCellAddress(right)
    if (start == null || end == null) return null
    return {
        startRow: Math.min(start.row, end.row),
        startCol: Math.min(start.col, end.col),
        endRow: Math.max(start.row, end.row),
        endCol: Math.max(start.col, end.col),
    }
}

// parseSheetRanges accepts the comma-separated multi-range form Sheets
// uses ("A1:A10,C:C") and returns the parsed parts. Whitespace around
// commas is tolerated; any unparseable segment causes the whole input
// to be rejected.
export function parseSheetRanges(input: string): ParsedCellRange[] | null {
    const out: ParsedCellRange[] = []
    for (const part of input.split(',')) {
        const parsed = parseSheetRange(part)
        if (parsed == null) return null
        out.push(parsed)
    }
    return out
}

export function cellInRange(range: ParsedCellRange, row: number, col: number): boolean {
    return (
        row >= range.startRow &&
        row <= range.endRow &&
        col >= range.startCol &&
        col <= range.endCol
    )
}

export function lettersToCol(s: string): number {
    let n = 0
    for (let i = 0; i < s.length; i++) {
        n = n * 26 + (s.charCodeAt(i) - 64)
    }
    return n
}

export function colToLetters(col: number): string {
    let n = col
    let out = ''
    while (n > 0) {
        const rem = (n - 1) % 26
        out = String.fromCharCode(65 + rem) + out
        n = Math.floor((n - 1) / 26)
    }
    return out || 'A'
}

// rangeToSheetRelativeA1 formats a (startRow, startCol, endRow, endCol)
// rectangle as a sheet-relative A1 range string. Single-cell ranges
// collapse to just the anchor address.
export function rangeToSheetRelativeA1(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
): string {
    const start = `${colToLetters(startCol)}${startRow}`
    if (startRow === endRow && startCol === endCol) return start
    const end = `${colToLetters(endCol)}${endRow}`
    return `${start}:${end}`
}

function parseCellAddress(s: string): { row: number; col: number } | null {
    const m = A1_CELL.exec(s)
    if (m == null) return null
    const col = lettersToCol(m[1])
    const row = Number(m[2])
    if (!Number.isFinite(row) || row < 1 || col < 1) return null
    return { row, col }
}
