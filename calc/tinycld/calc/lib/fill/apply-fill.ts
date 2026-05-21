import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import type * as Y from 'yjs'
import type { CellRange } from '../../hooks/grid-store'
import { deleteYCell, setYCellStyle, setYCellTyped } from '../../hooks/use-y-cell'
import type { InferredCellInput } from '../cell-input'
import { rewriteFormula } from '../clipboard/rewrite-formula'
import { serializeRange } from '../clipboard/serialize'
import type { ClipboardCell } from '../clipboard/types'
import { formatCell } from '../workbook-types'
import { detectSeries, projectSeries, type SeriesPlan } from './detect-series'

// applyFill commits a fill-handle drag to the Y.Doc. The destRange is
// always anchored at the source's top-left and extends down OR right
// (never both — see hooks/grid-store.ts FillDrag for the axis-locking
// contract). The function reads the source from the doc, runs
// detectSeries per column-or-row, projects each post-source cell, and
// writes everything in one LOCAL_ORIGIN transaction.
//
// Single-undo discipline: every dest write — kind/raw/display/formula
// AND style — runs inside the same `doc.transact(_, LOCAL_ORIGIN)`,
// so the realtime undo manager captures the entire fill as one Cmd+Z.
// Mirrors the contract in lib/clipboard/deserialize.ts:applyPayloadToDoc.
//
// Per-cell formula rewriting: detectSeries.projectSeries returns
// `linear-formula` cells with the source formula text verbatim (the
// projection function has no destination knowledge). The commit loop
// here computes the delta from each destination back to the source
// cell whose formula is being cycled, and overlays rewriteFormula.
// Same shift mechanic the clipboard paste uses, but per-step rather
// than per-payload — each post-source cell gets its own delta because
// the source cycles modulo its length.
//
// Empty projected cells: when a projected cell is empty (kind='string',
// raw=''), the destination is *deleted* — matching Sheets' behavior of
// replaying source holes when filling in `copy` mode. This is the
// rectangular-overwrite contract from clipboard paste, applied
// per-projected-cell rather than per-source-cell.

export interface ApplyFillOptions {
    doc: Y.Doc
    sheetId: string
    sourceRange: CellRange
    destRange: CellRange
    direction: 'down' | 'right'
}

export function applyFill(opts: ApplyFillOptions): void {
    const { doc, sheetId, sourceRange, destRange, direction } = opts

    if (rangesEqual(sourceRange, destRange)) return

    const payload = serializeRange(doc, sheetId, sourceRange)

    doc.transact(() => {
        if (direction === 'down') {
            applyDown(doc, sheetId, payload.cells, sourceRange, destRange)
            return
        }
        applyRight(doc, sheetId, payload.cells, sourceRange, destRange)
    }, LOCAL_ORIGIN)
}

function applyDown(
    doc: Y.Doc,
    sheetId: string,
    sourceCells: ClipboardCell[][],
    sourceRange: CellRange,
    destRange: CellRange
): void {
    const sourceRowCount = sourceCells.length
    const sourceColCount = sourceCells[0]?.length ?? 0

    for (let c = 0; c < sourceColCount; c++) {
        const colCells: ClipboardCell[] = []
        for (let r = 0; r < sourceRowCount; r++) {
            colCells.push(sourceCells[r][c])
        }
        const plan = detectSeries(colCells)

        for (let destRow = sourceRange.endRow + 1; destRow <= destRange.endRow; destRow++) {
            const stepIndex = destRow - sourceRange.startRow
            const sourceCellIdx = stepIndex % colCells.length
            const sourceRow = sourceRange.startRow + sourceCellIdx
            const destCol = sourceRange.startCol + c
            const dRow = destRow - sourceRow
            commitProjected(doc, sheetId, plan, colCells, stepIndex, destRow, destCol, dRow, 0)
        }
    }
}

function applyRight(
    doc: Y.Doc,
    sheetId: string,
    sourceCells: ClipboardCell[][],
    sourceRange: CellRange,
    destRange: CellRange
): void {
    const sourceRowCount = sourceCells.length
    const sourceColCount = sourceCells[0]?.length ?? 0

    for (let r = 0; r < sourceRowCount; r++) {
        const rowCells: ClipboardCell[] = []
        for (let c = 0; c < sourceColCount; c++) {
            rowCells.push(sourceCells[r][c])
        }
        const plan = detectSeries(rowCells)

        for (let destCol = sourceRange.endCol + 1; destCol <= destRange.endCol; destCol++) {
            const stepIndex = destCol - sourceRange.startCol
            const sourceCellIdx = stepIndex % rowCells.length
            const sourceCol = sourceRange.startCol + sourceCellIdx
            const destRow = sourceRange.startRow + r
            const dCol = destCol - sourceCol
            commitProjected(doc, sheetId, plan, rowCells, stepIndex, destRow, destCol, 0, dCol)
        }
    }
}

function commitProjected(
    doc: Y.Doc,
    sheetId: string,
    plan: SeriesPlan,
    sourceCells: ClipboardCell[],
    stepIndex: number,
    destRow: number,
    destCol: number,
    dRow: number,
    dCol: number
): void {
    const projected = projectSeries(plan, sourceCells, stepIndex)

    if (isEmptyProjected(projected)) {
        deleteYCell(doc, sheetId, destRow, destCol)
        return
    }

    const cycleSourceCell = sourceCells[stepIndex % sourceCells.length]
    const input = makeInput(projected, plan, dRow, dCol)
    setYCellTyped(doc, sheetId, destRow, destCol, input)

    if (cycleSourceCell.style != null) {
        setYCellStyle(doc, sheetId, destRow, destCol, cycleSourceCell.style)
    }
}

function makeInput(
    projected: ClipboardCell,
    plan: SeriesPlan,
    dRow: number,
    dCol: number
): InferredCellInput {
    if (plan.kind === 'linear-formula' && projected.formula != null) {
        const nextFormula = rewriteFormula(projected.formula, dRow, dCol)
        return {
            kind: 'formula',
            raw: null,
            display: nextFormula,
            formula: nextFormula,
        }
    }

    return {
        kind: projected.kind,
        raw: projected.raw,
        display: formatCell(projected.kind, projected.raw),
    }
}

function isEmptyProjected(cell: ClipboardCell): boolean {
    if (cell.formula != null) return false
    if (cell.kind !== 'string') return false
    return cell.raw === '' || cell.raw == null
}

function rangesEqual(a: CellRange, b: CellRange): boolean {
    return (
        a.startRow === b.startRow &&
        a.endRow === b.endRow &&
        a.startCol === b.startCol &&
        a.endCol === b.endCol
    )
}
