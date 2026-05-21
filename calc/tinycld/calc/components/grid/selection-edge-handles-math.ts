// Pure-math helper extracted from SelectionEdgeHandles.tsx so unit
// tests can import it without dragging react-native through vitest's
// transformer. See pivot-banner.test.tsx for the same pattern.

import type { CellRange } from '../../hooks/grid-store'

export interface HandlePositions {
    left: number
    right: number
    top: number
    bottom: number
}

// computeHandlePositions resolves the active range's bounding rect
// into pixel coordinates. Returns null when there is no anchored
// range, or when the resolved rect has zero width or height (a hidden
// column/row would do that).
export function computeHandlePositions(
    range: CellRange | null,
    colOffsets: Float64Array,
    rowOffsets: Float64Array
): HandlePositions | null {
    if (range == null) return null
    const left = colOffsets[range.startCol - 1] ?? 0
    const right = colOffsets[range.endCol] ?? left
    const top = rowOffsets[range.startRow - 1] ?? 0
    const bottom = rowOffsets[range.endRow] ?? top
    if (right - left <= 0 || bottom - top <= 0) return null
    return { left, right, top, bottom }
}
