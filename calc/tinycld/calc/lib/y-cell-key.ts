// Y.Doc cell key shape: "<sheetId>:<row>:<col>". Distinct from the
// parser's intermediate `cellKey(row, col)` (which is sheet-local) —
// the Y.Doc has a single global `cells` Y.Map shared across all sheets,
// so keys here include the sheet id.
export function yCellKey(sheetId: string, row: number, col: number): string {
    return `${sheetId}:${row}:${col}`
}

export interface ParsedYCellKey {
    sheetId: string
    row: number
    col: number
}

export function parseYCellKey(key: string): ParsedYCellKey | null {
    const parts = key.split(':')
    if (parts.length !== 3) return null
    const row = Number(parts[1])
    const col = Number(parts[2])
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null
    return { sheetId: parts[0], row, col }
}
