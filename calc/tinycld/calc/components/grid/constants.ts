// Shared layout constants for the Grid subtree. Each cell is the same
// fixed height; row-header column is fixed width; column header and
// formula bar each occupy one cell-height row at the top of the grid.
//
// OVERSCAN is the count of extra rows/columns rendered just outside
// the visible viewport so newly-scrolled-in cells are already mounted
// when they appear.
export const CELL_HEIGHT = 28
export const ROW_HEADER_WIDTH = 48
export const HEADER_HEIGHT = CELL_HEIGHT
export const TOOLBAR_HEIGHT = 28
export const FORMULA_BAR_HEIGHT = 28
export const OVERSCAN = 4
export const MIN_ROWS = 50
export const MIN_COLS = 26

// Inset shadow applied to the active row/column header cell on top of
// the bg-accent fill. Two paired insets produce a "pressed" look — a
// dim top-left edge plus a slightly brighter bottom-right edge, like
// the cell is sunken into the toolbar. RN-Web compiles boxShadow to
// CSS; on native, `style.boxShadow` is ignored gracefully (the bg +
// bold text already convey the active state without it).
export const ACTIVE_HEADER_INSET_STYLE = {
    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.18), inset -1px -1px 0 rgba(255,255,255,0.18)',
} as const
