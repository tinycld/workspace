import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import type * as Y from 'yjs'
import type { CellRange } from '../hooks/grid-store'
import { setYCellStyle } from '../hooks/use-y-cell'
import { forEachCellInRange } from './selection-range'
import type { CellBorderEdge, CellBorders } from './workbook-types'

// Border presets exposed by the toolbar's BordersMenu. The id is what
// the menu sends to setBorders; resolveBorderPatch translates it into
// the per-cell CellBorders patch that should land on a specific (row,
// col) inside the active range.
//
// Treat the range as a single block. Outline presets (outer, top,
// bottom, left, right) only set the relevant edge on the cells along
// that edge of the range, leaving other cells untouched so any
// pre-existing borders survive. `all` paints a full grid (every cell,
// all four sides). `inner` paints the four interior crosshair edges
// across the range; `innerH` only the interior horizontal lines;
// `innerV` only the interior vertical lines. `none` is the only preset
// that explicitly clears — it stamps all four edges to `false` on
// every selected cell, doubling as a "reset" affordance.
export type BorderPresetId =
    | 'all'
    | 'inner'
    | 'innerH'
    | 'innerV'
    | 'none'
    | 'outer'
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'

// Returns the CellBorders patch for one cell at (row, col) inside
// `range` for the given preset. The `edge` parameter carries the
// sticky color + line style from the picker store; it lands verbatim
// on every truthy edge the preset assigns. Returns null when the
// preset has no effect on that cell (e.g. an interior cell under
// "outer" or "top"), signalling the caller to skip writing — important
// because writing an empty patch would still create a Y.Map style
// entry on a previously unstyled cell.
export function resolveBorderPatch(
    presetId: BorderPresetId,
    range: CellRange,
    row: number,
    col: number,
    edge: CellBorderEdge
): CellBorders | null {
    if (presetId === 'all') {
        return { top: edge, right: edge, bottom: edge, left: edge }
    }
    if (presetId === 'none') {
        return { top: false, right: false, bottom: false, left: false }
    }
    const isTopRow = row === range.startRow
    const isBottomRow = row === range.endRow
    const isLeftCol = col === range.startCol
    const isRightCol = col === range.endCol
    if (presetId === 'top') {
        return isTopRow ? { top: edge } : null
    }
    if (presetId === 'bottom') {
        return isBottomRow ? { bottom: edge } : null
    }
    if (presetId === 'left') {
        return isLeftCol ? { left: edge } : null
    }
    if (presetId === 'right') {
        return isRightCol ? { right: edge } : null
    }
    if (presetId === 'inner') {
        // Interior crosshair: each cell paints the side(s) facing
        // another cell in the range. Corner / edge cells contribute
        // only their inward-facing sides; the perimeter is left alone.
        const patch: CellBorders = {}
        if (!isTopRow) patch.top = edge
        if (!isBottomRow) patch.bottom = edge
        if (!isLeftCol) patch.left = edge
        if (!isRightCol) patch.right = edge
        if (isEmptyPatch(patch)) return null
        return patch
    }
    if (presetId === 'innerH') {
        // Horizontal interior lines only — the top side of every row
        // except the topmost, plus the bottom side of every row except
        // the bottom-most. Each cell contributes the relevant edges of
        // its own bounding box.
        const patch: CellBorders = {}
        if (!isTopRow) patch.top = edge
        if (!isBottomRow) patch.bottom = edge
        if (isEmptyPatch(patch)) return null
        return patch
    }
    if (presetId === 'innerV') {
        const patch: CellBorders = {}
        if (!isLeftCol) patch.left = edge
        if (!isRightCol) patch.right = edge
        if (isEmptyPatch(patch)) return null
        return patch
    }
    // outer — only the cells on the perimeter contribute, and each
    // contributes only the side(s) facing outward. A 1x1 range gets
    // all four edges (every side faces outward).
    const patch: CellBorders = {}
    if (isTopRow) patch.top = edge
    if (isBottomRow) patch.bottom = edge
    if (isLeftCol) patch.left = edge
    if (isRightCol) patch.right = edge
    if (isEmptyPatch(patch)) return null
    return patch
}

function isEmptyPatch(patch: CellBorders): boolean {
    return (
        patch.top == null &&
        patch.bottom == null &&
        patch.left == null &&
        patch.right == null
    )
}

// applyBorderPreset writes the resolved per-cell patches inside one
// yjs transaction so the whole range-write is a single undo step.
// `edge` carries the active line style + color from the picker store;
// the caller (use-grid-format-controls) reads the store at write time
// and forwards the snapshot here.
export function applyBorderPreset(
    doc: Y.Doc | null,
    sheetId: string,
    range: CellRange,
    presetId: BorderPresetId,
    edge: CellBorderEdge
): void {
    if (doc == null) return
    doc.transact(() => {
        forEachCellInRange(range, (row, col) => {
            const patch = resolveBorderPatch(presetId, range, row, col, edge)
            if (patch == null) return
            setYCellStyle(doc, sheetId, row, col, { borders: patch })
        })
    }, LOCAL_ORIGIN)
}
