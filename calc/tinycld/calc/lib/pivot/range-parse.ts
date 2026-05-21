// A1-style range parsing/formatting for pivot source ranges.
// Mirrors excelize's accepted forms: `Sheet1!A1:B10` and
// `'Sheet With Spaces'!A1:B10` (apostrophes escaped by doubling).

export interface ParsedRange {
    ok: true
    sheetName: string
    startRow: number
    startCol: number
    endRow: number
    endCol: number
}

export interface ParseRangeError {
    ok: false
    reason: 'missing-sheet' | 'malformed' | 'reversed' | 'empty'
}

export type ParseRangeResult = ParsedRange | ParseRangeError

const A1_CELL = /^([A-Z]+)(\d+)$/

export function parseA1Range(input: string): ParseRangeResult {
    if (input.length === 0) return { ok: false, reason: 'empty' }

    const bang = findSheetSeparator(input)
    if (bang < 0) return { ok: false, reason: 'missing-sheet' }

    const sheetPart = input.slice(0, bang)
    const rangePart = input.slice(bang + 1)
    const sheetName = unquoteSheet(sheetPart)
    if (sheetName == null) return { ok: false, reason: 'malformed' }

    const colon = rangePart.indexOf(':')
    if (colon < 0) return { ok: false, reason: 'malformed' }
    const startStr = rangePart.slice(0, colon)
    const endStr = rangePart.slice(colon + 1)

    const start = parseCell(startStr)
    const end = parseCell(endStr)
    if (start == null || end == null) return { ok: false, reason: 'malformed' }

    if (end.row < start.row || end.col < start.col) {
        return { ok: false, reason: 'reversed' }
    }
    return {
        ok: true,
        sheetName,
        startRow: start.row,
        startCol: start.col,
        endRow: end.row,
        endCol: end.col,
    }
}

export function buildA1Range(
    sheetName: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
): string {
    const sheet = quoteSheetIfNeeded(sheetName)
    return `${sheet}!${colToLetters(startCol)}${startRow}:${colToLetters(endCol)}${endRow}`
}

// `Sheet1!A1` and `'A!B'!A1` — the `!` we want is the one outside any
// single-quoted region. Returns -1 if not found.
function findSheetSeparator(s: string): number {
    let inQuote = false
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c === "'") {
            // doubled apostrophe inside quoted region = literal '
            if (inQuote && s[i + 1] === "'") {
                i++
                continue
            }
            inQuote = !inQuote
            continue
        }
        if (c === '!' && !inQuote) return i
    }
    return -1
}

function unquoteSheet(part: string): string | null {
    if (part.length === 0) return null
    if (part.startsWith("'") && part.endsWith("'") && part.length >= 2) {
        return part.slice(1, -1).replace(/''/g, "'")
    }
    if (part.includes(' ') || part.includes("'") || part.includes('!')) {
        // Unquoted but should have been quoted — treat as malformed.
        return null
    }
    return part
}

function quoteSheetIfNeeded(name: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
    return `'${name.replace(/'/g, "''")}'`
}

function parseCell(s: string): { row: number; col: number } | null {
    const m = A1_CELL.exec(s)
    if (m == null) return null
    const col = lettersToCol(m[1])
    const row = Number(m[2])
    if (!Number.isFinite(row) || row < 1 || col < 1) return null
    return { row, col }
}

function lettersToCol(s: string): number {
    let n = 0
    for (let i = 0; i < s.length; i++) {
        n = n * 26 + (s.charCodeAt(i) - 64)
    }
    return n
}

function colToLetters(col: number): string {
    let n = col
    let out = ''
    while (n > 0) {
        const rem = (n - 1) % 26
        out = String.fromCharCode(65 + rem) + out
        n = Math.floor((n - 1) / 26)
    }
    return out || 'A'
}
