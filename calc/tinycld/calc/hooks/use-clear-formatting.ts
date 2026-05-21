import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback } from 'react'
import type * as Y from 'yjs'
import { forEachCellInRange } from '../lib/selection-range'
import { yCellKey } from '../lib/y-cell-key'
import { CELLS_MAP, STYLE_KEY } from '../lib/y-doc-bootstrap'
import type { CellRange } from './grid-store'
import { useWorkbook } from './use-workbook-context'

// clearFormattingInRange removes the style sub-Y.Map from every cell
// inside `range`, leaving the cell's raw/display/formula intact. Runs
// in a single doc.transact tagged with LOCAL_ORIGIN so undo treats it
// as one step and the realtime undo manager allowlists the change.
//
// Pure yjs writer — no React, no store access. Lives alongside the
// hook below so the format-menu / shortcut wiring and the vitest spec
// can both import it directly.
export function clearFormattingInRange(
    doc: Y.Doc,
    sheetId: string,
    range: CellRange
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    doc.transact(() => {
        forEachCellInRange(range, (row, col) => {
            const cell = cellsMap.get(yCellKey(sheetId, row, col))
            if (cell == null) return
            cell.delete(STYLE_KEY)
        })
    }, LOCAL_ORIGIN)
}

export interface UseClearFormattingArgs {
    sheetId: string
    // Resolved at call time (not at hook-render time) so the callback
    // identity stays stable across selection drags. Matches the
    // resolveRanges pattern in useGridFormatControls.
    getSelectionRanges: () => CellRange[]
    readOnly: boolean
}

// useClearFormatting returns a stable callback that walks every
// sub-range of the live selection and clears formatting from each.
// Early-returns silently when the doc is missing, the user is in
// read-only mode, or there's no selection.
export function useClearFormatting({
    sheetId,
    getSelectionRanges,
    readOnly,
}: UseClearFormattingArgs): () => void {
    const { doc } = useWorkbook()
    return useCallback(() => {
        if (readOnly || doc == null) return
        const ranges = getSelectionRanges()
        if (ranges.length === 0) return
        for (const range of ranges) {
            clearFormattingInRange(doc, sheetId, range)
        }
    }, [doc, sheetId, getSelectionRanges, readOnly])
}
