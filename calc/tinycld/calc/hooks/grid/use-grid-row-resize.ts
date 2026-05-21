import { useCallback } from 'react'
import type * as Y from 'yjs'
import { commitRowHeight, resetRowToDefault } from '../../components/grid/resize-actions'
import { useGridStoreApi } from '../use-grid-store'
import { type RowResizeHandlers, useRowResize } from '../use-row-resize'
import type { useYSheets } from '../use-y-sheets'

interface UseGridRowResizeArgs {
    doc: Y.Doc | null
    sheetId: string
    sheet: ReturnType<typeof useYSheets>[number] | null
    readOnly: boolean
}

// Mirror of useGridColumnResize for the Y axis. Vertical autosize
// would need per-cell text height measurement, which we don't have
// yet — the menu offers reset-to-default instead.
export function useGridRowResize({
    doc,
    sheetId,
    sheet,
    readOnly,
}: UseGridRowResizeArgs): RowResizeHandlers {
    const store = useGridStoreApi()
    const onCommit = useCallback(
        (row: number, height: number) => commitRowHeight(doc, sheetId, row, height),
        [doc, sheetId]
    )
    const onResetDefault = useCallback(
        (row: number) => resetRowToDefault(doc, sheetId, row),
        [doc, sheetId]
    )
    const onRequestMenu = useCallback(
        (row: number, x: number, y: number) => store.getState().openHandleMenu('row', row, x, y),
        [store]
    )
    return useRowResize({
        rowHeights: sheet?.rowHeights,
        readOnly,
        onCommit,
        onResetDefault,
        onRequestMenu,
    })
}
