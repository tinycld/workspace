// Default footprint of the table grid picker. 10 cols × 8 rows matches
// Google Docs' "Table" submenu — enough for the common case (most
// tables are ≤ 5×5) without making the popover wall-sized. Users who
// need more can still grow the table via the row/column ops below the
// picker.
export const GRID_PICKER_DEFAULT_ROWS = 8
export const GRID_PICKER_DEFAULT_COLS = 10

export interface GridPickerCell {
    row: number
    col: number
}

// Smallest insertable selection — Google Docs treats a single click in
// the top-left cell as 1×1, but that's almost never useful (insertTable
// with rows=1, cols=1 makes a degenerate single-cell table). We clamp
// to 1×1 anyway and let the user decide; tests pin this so a future
// "minimum 2×2" rule is an explicit change.
export const GRID_PICKER_MIN_ROWS = 1
export const GRID_PICKER_MIN_COLS = 1

export function clampGridSelection(
    selection: GridPickerCell,
    maxRows: number,
    maxCols: number
): GridPickerCell {
    const row = Math.max(GRID_PICKER_MIN_ROWS, Math.min(selection.row, maxRows))
    const col = Math.max(GRID_PICKER_MIN_COLS, Math.min(selection.col, maxCols))
    return { row, col }
}

export function isCellHighlighted(
    cell: GridPickerCell,
    selection: GridPickerCell | null
): boolean {
    if (!selection) return false
    return cell.row <= selection.row && cell.col <= selection.col
}

// Map an (x,y) coordinate inside the picker's bounding box to the
// (row,col) of the cell under the pointer. cellSize is the rendered
// pixel size of one grid cell (gap-inclusive). Returns null when the
// coords fall outside the picker.
export function cellAtPosition(
    x: number,
    y: number,
    cellSize: number,
    maxRows: number,
    maxCols: number
): GridPickerCell | null {
    if (x < 0 || y < 0 || cellSize <= 0) return null
    const col = Math.floor(x / cellSize) + 1
    const row = Math.floor(y / cellSize) + 1
    if (row > maxRows || col > maxCols) return null
    return clampGridSelection({ row, col }, maxRows, maxCols)
}
