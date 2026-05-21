import type * as Y from 'yjs'
import { runAutosize } from '../../hooks/use-column-resize'
import { DEFAULT_ROW_HEIGHT, setYColWidth, setYRowHeight } from '../../lib/dimensions'

// Resize commit/reset/autosize handlers as plain functions. The
// useColumnResize and useRowResize hooks call these via callbacks
// supplied by Grid; keeping them as standalone functions lets Grid
// wrap each in a one-line useCallback rather than spelling out the
// body inline.

export function commitColWidth(
    doc: Y.Doc | null,
    sheetId: string,
    col: number,
    width: number
): void {
    setYColWidth(doc, sheetId, col, width)
}

export function commitRowHeight(
    doc: Y.Doc | null,
    sheetId: string,
    row: number,
    height: number
): void {
    setYRowHeight(doc, sheetId, row, height)
}

export function autosizeCol(doc: Y.Doc | null, sheetId: string, col: number): void {
    runAutosize(doc, sheetId, col, (c, w) => commitColWidth(doc, sheetId, c, w))
}

export function resetRowToDefault(doc: Y.Doc | null, sheetId: string, row: number): void {
    setYRowHeight(doc, sheetId, row, DEFAULT_ROW_HEIGHT)
}
