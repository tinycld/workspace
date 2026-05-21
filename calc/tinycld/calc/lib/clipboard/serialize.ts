import type * as Y from 'yjs'
import type { CellRange } from '../../hooks/grid-store'
import { getAllMerges } from '../merge'
import { yCellKey } from '../y-cell-key'
import { CELLS_MAP, readYCell } from '../y-doc-bootstrap'
import type { ClipboardCell, ClipboardMerge, ClipboardPayload } from './types'

// serializeRange snapshots a rectangular block of cells out of the Y.Doc
// into a ClipboardPayload. Empty source cells become a typed-string
// blank (`{ kind: 'string', raw: '' }`) so the resulting 2D array is
// rectangular — the deserializer relies on dense indexing for delta math
// and transpose.
//
// `sourceAnchor` is the (row, col) of the source range's top-left cell.
// The deserializer subtracts this from the destination anchor to compute
// the formula-rewrite delta.
//
// Read-side reuses the existing `readYCell` helper so we surface the
// same kind/raw/formula/style coercion that the live grid uses. No
// special cases for legacy / typeless cells live here.

export function serializeRange(doc: Y.Doc, sheetId: string, range: CellRange): ClipboardPayload {
    const rows = range.endRow - range.startRow + 1
    const cols = range.endCol - range.startCol + 1
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    const cells: ClipboardCell[][] = []
    for (let r = 0; r < rows; r++) {
        const rowArr: ClipboardCell[] = []
        for (let c = 0; c < cols; c++) {
            const sourceRow = range.startRow + r
            const sourceCol = range.startCol + c
            const cell = cellsMap.get(yCellKey(sheetId, sourceRow, sourceCol))
            if (cell == null) {
                rowArr.push({ kind: 'string', raw: '' })
                continue
            }
            const snap = readYCell(cell)
            rowArr.push({
                kind: snap.kind,
                raw: snap.raw,
                formula: snap.formula,
                style: snap.style,
            })
        }
        cells.push(rowArr)
    }

    // Capture merges fully contained inside the source range,
    // expressed as offsets from the range's top-left so the
    // deserializer can re-anchor at the paste site.
    const allMerges = getAllMerges(doc, sheetId)
    const captured: ClipboardMerge[] = []
    for (const m of allMerges) {
        const mEndRow = m.anchorRow + m.rowSpan - 1
        const mEndCol = m.anchorCol + m.colSpan - 1
        if (
            m.anchorRow < range.startRow ||
            m.anchorCol < range.startCol ||
            mEndRow > range.endRow ||
            mEndCol > range.endCol
        ) {
            continue
        }
        captured.push({
            rowOffset: m.anchorRow - range.startRow,
            colOffset: m.anchorCol - range.startCol,
            rowSpan: m.rowSpan,
            colSpan: m.colSpan,
        })
    }

    return {
        rows,
        cols,
        cells,
        sourceAnchor: { row: range.startRow, col: range.startCol },
        merges: captured.length > 0 ? captured : undefined,
    }
}
