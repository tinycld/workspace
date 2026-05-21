// Per-edge border descriptor for table cells. Mirrors the shape Word
// uses in w:tcBorders (top/start/bottom/end + insideH/insideV at the
// table level, though we only model the cell-level subset here):
//
//   - style: matches a meaningful subset of CSS border-style — Word's
//     ST_Border has dozens of decorative variants ('threeDEmboss',
//     'wave', …) that we collapse to 'solid' on import. Set to 'none'
//     to remove the edge.
//   - width: in 1/8th of a point in OOXML (`w:sz`). We carry it as a
//     CSS pixel value (rounded) here for simplicity; the Go translate
//     layer is responsible for the unit conversion on import/export.
//   - color: a CSS color string ('#RRGGBB' or named). Word uses
//     `w:color="auto"` for the default — we represent that as null so
//     a serialized cell with no explicit color falls through to the
//     editor's themed border color.
export type CellBorderStyle =
    | 'none'
    | 'solid'
    | 'dashed'
    | 'dotted'
    | 'double'

export interface CellBorder {
    style: CellBorderStyle
    widthPx: number
    color: string | null
}

export interface CellBorders {
    top: CellBorder | null
    right: CellBorder | null
    bottom: CellBorder | null
    left: CellBorder | null
}

export const DEFAULT_BORDER: CellBorder = {
    style: 'solid',
    widthPx: 1,
    color: null,
}

export const EMPTY_BORDERS: CellBorders = {
    top: null,
    right: null,
    bottom: null,
    left: null,
}

export type CellBorderPreset =
    | 'all'
    | 'inner'
    | 'outer'
    | 'top'
    | 'right'
    | 'bottom'
    | 'left'
    | 'horizontal'
    | 'vertical'
    | 'none'

export interface CellPosition {
    row: number
    col: number
}

export interface CellRange {
    startRow: number
    endRow: number
    startCol: number
    endCol: number
}

// Given a preset, a cell's position in the rectangular range, and the
// range itself, compute which edges should be modified and what they
// should be set to. Used by setCellBorders to walk the selection and
// apply a preset without needing each cell to know about its neighbors.
//
// 'inner' and 'outer' depend on cell position within the range:
//   - 'outer' touches only the four perimeter edges of the range
//   - 'inner' touches only edges between adjacent cells in the range
//   - 'horizontal' = inner horizontal lines (between rows)
//   - 'vertical'   = inner vertical lines (between columns)
//
// For single-cell selections, 'inner', 'horizontal', and 'vertical' are
// no-ops; 'outer' equals 'all'.
export function edgesForPreset(
    preset: CellBorderPreset,
    cell: CellPosition,
    range: CellRange,
    border: CellBorder
): Partial<CellBorders> {
    const isTopRow = cell.row === range.startRow
    const isBottomRow = cell.row === range.endRow
    const isLeftCol = cell.col === range.startCol
    const isRightCol = cell.col === range.endCol
    const none: CellBorder = { style: 'none', widthPx: 0, color: null }

    switch (preset) {
        case 'all':
            return { top: border, right: border, bottom: border, left: border }
        case 'none':
            return { top: none, right: none, bottom: none, left: none }
        case 'top':
            return isTopRow ? { top: border } : {}
        case 'bottom':
            return isBottomRow ? { bottom: border } : {}
        case 'left':
            return isLeftCol ? { left: border } : {}
        case 'right':
            return isRightCol ? { right: border } : {}
        case 'outer': {
            const out: Partial<CellBorders> = {}
            if (isTopRow) out.top = border
            if (isBottomRow) out.bottom = border
            if (isLeftCol) out.left = border
            if (isRightCol) out.right = border
            return out
        }
        case 'inner': {
            const out: Partial<CellBorders> = {}
            if (!isTopRow) out.top = border
            if (!isBottomRow) out.bottom = border
            if (!isLeftCol) out.left = border
            if (!isRightCol) out.right = border
            return out
        }
        case 'horizontal': {
            const out: Partial<CellBorders> = {}
            if (!isTopRow) out.top = border
            if (!isBottomRow) out.bottom = border
            return out
        }
        case 'vertical': {
            const out: Partial<CellBorders> = {}
            if (!isLeftCol) out.left = border
            if (!isRightCol) out.right = border
            return out
        }
    }
}

// Render a CellBorders into a CSS-style string fragment for inline use
// on the cell's <td>/<th>. Returns an object so callers can merge with
// other inline styles; absent edges are simply not emitted, letting the
// editor's default cell-border CSS rule (.ProseMirror td { border: 1px
// solid var(--editor-border) }) apply.
export function bordersToInlineStyle(
    borders: CellBorders | null | undefined
): Record<string, string> {
    if (!borders) return {}
    const out: Record<string, string> = {}
    const edges: Array<keyof CellBorders> = ['top', 'right', 'bottom', 'left']
    for (const edge of edges) {
        const b = borders[edge]
        if (!b) continue
        const cap = edge.charAt(0).toUpperCase() + edge.slice(1)
        if (b.style === 'none') {
            out[`border${cap}`] = 'none'
        } else {
            const color = b.color ?? 'currentColor'
            out[`border${cap}`] = `${b.widthPx}px ${b.style} ${color}`
        }
    }
    return out
}

// HTML inline-style flavour of the same. Used by the ProseMirror
// renderHTML attribute mapper — TipTap accepts a `style` string on the
// HTMLAttributes returned by an attribute's renderHTML, which it
// merges onto the rendered DOM element.
export function bordersToInlineStyleString(
    borders: CellBorders | null | undefined
): string {
    const obj = bordersToInlineStyle(borders)
    if (Object.keys(obj).length === 0) return ''
    return Object.entries(obj)
        .map(([key, value]) => {
            // camelCase → kebab-case (borderTop → border-top).
            const k = key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
            return `${k}: ${value}`
        })
        .join('; ')
}

// Re-hydrate a CellBorders from a `data-borders` JSON attribute. The
// HTML parser path uses this to round-trip borders through copy/paste
// and through the .docx → HTML import that the importer emits as a
// fallback during local dev (the real pipeline uses Y.Doc seeding).
export function parseBordersAttr(value: string | null | undefined): CellBorders | null {
    if (!value) return null
    try {
        const parsed = JSON.parse(value) as unknown
        if (!parsed || typeof parsed !== 'object') return null
        const obj = parsed as Record<string, unknown>
        return {
            top: parseEdge(obj.top),
            right: parseEdge(obj.right),
            bottom: parseEdge(obj.bottom),
            left: parseEdge(obj.left),
        }
    } catch {
        return null
    }
}

function parseEdge(value: unknown): CellBorder | null {
    if (!value || typeof value !== 'object') return null
    const obj = value as Record<string, unknown>
    const style = obj.style
    if (
        style !== 'none' &&
        style !== 'solid' &&
        style !== 'dashed' &&
        style !== 'dotted' &&
        style !== 'double'
    ) {
        return null
    }
    const widthPx = typeof obj.widthPx === 'number' ? obj.widthPx : 1
    const color = typeof obj.color === 'string' ? obj.color : null
    return { style, widthPx, color }
}

export function bordersAreEmpty(borders: CellBorders | null | undefined): boolean {
    if (!borders) return true
    return !(borders.top || borders.right || borders.bottom || borders.left)
}
