import { useCallback } from 'react'
import type * as Y from 'yjs'
import { autosizeCol, commitColWidth } from '../../components/grid/resize-actions'
import { type ColumnResizeHandlers, useColumnResize } from '../use-column-resize'
import { useGridStoreApi } from '../use-grid-store'
import type { useYSheets } from '../use-y-sheets'

interface UseGridColumnResizeArgs {
    doc: Y.Doc | null
    sheetId: string
    sheet: ReturnType<typeof useYSheets>[number] | null
    readOnly: boolean
}

// Wraps useColumnResize with Y.Doc-bound commit/autosize callbacks
// and routes the right-click handle menu through the store.
export function useGridColumnResize({
    doc,
    sheetId,
    sheet,
    readOnly,
}: UseGridColumnResizeArgs): ColumnResizeHandlers {
    const store = useGridStoreApi()
    const onCommit = useCallback(
        (col: number, width: number) => commitColWidth(doc, sheetId, col, width),
        [doc, sheetId]
    )
    const onAutosize = useCallback((col: number) => autosizeCol(doc, sheetId, col), [doc, sheetId])
    const onRequestMenu = useCallback(
        (col: number, x: number, y: number) => store.getState().openHandleMenu('col', col, x, y),
        [store]
    )
    return useColumnResize({
        colWidths: sheet?.colWidths,
        readOnly,
        onCommit,
        onAutosize,
        onRequestMenu,
    })
}
