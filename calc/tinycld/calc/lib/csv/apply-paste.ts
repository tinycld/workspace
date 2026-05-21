import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import type * as Y from 'yjs'
import { deleteYCell, setYCellTyped } from '../../hooks/use-y-cell'
import { inferCellInput } from '../cell-input'

// applyCsvToDoc writes a parsed CSV grid onto the Y.Doc starting at
// (anchorRow, anchorCol). The whole import runs inside one LOCAL_ORIGIN
// doc.transact so the realtime undo manager treats it as a single step.
// Yjs collapses the per-cell setYCellTyped/deleteYCell transactions
// (which themselves use LOCAL_ORIGIN) into the outer one, so a single
// undo unwinds the entire import.
//
// Type detection runs through inferCellInput (the same path the cell
// editor uses), so "TRUE", "42", "2024-01-15" land as boolean / number
// / date respectively. Empty source strings clear the destination —
// this matches the rectangular-overwrite semantics elsewhere in the
// app, but in practice a fresh import lands on empty cells anyway.

export function applyCsvToDoc(
    doc: Y.Doc,
    sheetId: string,
    anchorRow: number,
    anchorCol: number,
    rows: string[][]
): void {
    if (rows.length === 0) return

    doc.transact(() => {
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r]
            for (let c = 0; c < row.length; c++) {
                const destRow = anchorRow + r
                const destCol = anchorCol + c
                const text = row[c]
                if (text === '') {
                    deleteYCell(doc, sheetId, destRow, destCol)
                    continue
                }
                setYCellTyped(doc, sheetId, destRow, destCol, inferCellInput(text))
            }
        }
    }, LOCAL_ORIGIN)
}
