import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import type * as Y from 'yjs'
import { deleteYCell, setYCellStyle, setYCellTyped } from '../../hooks/use-y-cell'
import type { InferredCellInput } from '../cell-input'
import { findMergeContaining, mergeCells } from '../merge'
import { formatCell } from '../workbook-types'
import { rewriteFormula } from './rewrite-formula'
import type { ClipboardCell, ClipboardPayload, PasteMode, PasteOptions } from './types'

// applyPayloadToDoc writes a ClipboardPayload onto the Y.Doc at the
// destination anchor, with the semantics selected by opts.mode.
//
// Single-undo discipline: the entire paste — every cell value write
// plus every cell style write — runs inside one `doc.transact(_,
// LOCAL_ORIGIN)`. The realtime Y.UndoManager captures one step per
// LOCAL_ORIGIN transaction, so pasting an N-cell rectangle is exactly
// one Cmd+Z.
//
// Empty source cells (kind='string', raw='') *clear* the destination
// rather than skipping it, matching the spreadsheet expectation that
// "paste 2x2" overwrites the 2x2 destination — including any holes.
// Exception: 'format' mode is style-only and never touches raw/kind/
// formula, so empty source cells contribute no operation.
//
// Formula rewriting: for 'all', 'formulas', and 'transpose' modes, any
// cell with `formula` set has its refs shifted by (deltaRow, deltaCol)
// where delta is the destination anchor minus the source anchor (and
// the transposed mapping reuses the same delta because we compute it
// in destination-cell terms, not source-cell terms).
//
// 'values' mode emits the cached `raw` and the same `kind` as the
// source — for a formula source cell whose `raw` carries the computed
// scalar, this lands as a number/string/boolean/date at the dest, no
// formula. Matches Sheets' "Paste values only".

export function applyPayloadToDoc(
    doc: Y.Doc,
    sheetId: string,
    payload: ClipboardPayload,
    opts: PasteOptions
): void {
    const transposed = opts.mode === 'transpose'
    const destRows = transposed ? payload.cols : payload.rows
    const destCols = transposed ? payload.rows : payload.cols
    const deltaRow = opts.destAnchor.row - payload.sourceAnchor.row
    const deltaCol = opts.destAnchor.col - payload.sourceAnchor.col

    doc.transact(() => {
        for (let r = 0; r < destRows; r++) {
            for (let c = 0; c < destCols; c++) {
                const cell = transposed ? payload.cells[c][r] : payload.cells[r][c]
                const destRow = opts.destAnchor.row + r
                const destCol = opts.destAnchor.col + c
                applyOneCell(doc, sheetId, destRow, destCol, cell, opts.mode, deltaRow, deltaCol)
            }
        }
        // Apply captured merges at the destination. Skip 'format'-only
        // pastes (style overlay, no structural change) and the
        // transpose case (a transposed merge isn't well-defined under
        // simple offsets — out of scope for v1). If applying a merge
        // would land inside an existing destination merge, skip it
        // rather than silently corrupt the layout.
        if (
            payload.merges != null &&
            payload.merges.length > 0 &&
            opts.mode !== 'format' &&
            opts.mode !== 'transpose'
        ) {
            for (const m of payload.merges) {
                const anchorRow = opts.destAnchor.row + m.rowOffset
                const anchorCol = opts.destAnchor.col + m.colOffset
                const endRow = anchorRow + m.rowSpan - 1
                const endCol = anchorCol + m.colSpan - 1
                let conflict = false
                for (let rr = anchorRow; rr <= endRow && !conflict; rr++) {
                    for (let cc = anchorCol; cc <= endCol && !conflict; cc++) {
                        if (rr === anchorRow && cc === anchorCol) continue
                        const existing = findMergeContaining(doc, sheetId, rr, cc)
                        if (
                            existing != null &&
                            (existing.anchorRow !== anchorRow ||
                                existing.anchorCol !== anchorCol)
                        ) {
                            conflict = true
                        }
                    }
                }
                if (conflict) continue
                mergeCells(doc, sheetId, {
                    startRow: anchorRow,
                    endRow,
                    startCol: anchorCol,
                    endCol,
                })
            }
        }
    }, LOCAL_ORIGIN)
}

function applyOneCell(
    doc: Y.Doc,
    sheetId: string,
    destRow: number,
    destCol: number,
    cell: ClipboardCell,
    mode: PasteMode,
    deltaRow: number,
    deltaCol: number
): void {
    if (mode === 'format') {
        // Style-only: deep-merge if we have a style, no-op otherwise.
        // Does not clear an existing cell when the source is blank.
        if (cell.style != null) {
            setYCellStyle(doc, sheetId, destRow, destCol, cell.style)
        }
        return
    }

    const isEmpty = isEmptyCell(cell)
    if (isEmpty) {
        // 'all', 'values', 'formulas', 'transpose' all treat a blank
        // source as "clear the destination". This is the rectangular-
        // overwrite contract.
        deleteYCell(doc, sheetId, destRow, destCol)
        return
    }

    const input = makeInput(cell, mode, deltaRow, deltaCol)
    setYCellTyped(doc, sheetId, destRow, destCol, input)

    // 'values' and 'formulas' explicitly drop the source's style. 'all'
    // and 'transpose' carry style across.
    if ((mode === 'all' || mode === 'transpose') && cell.style != null) {
        setYCellStyle(doc, sheetId, destRow, destCol, cell.style)
    }
}

function isEmptyCell(cell: ClipboardCell): boolean {
    if (cell.formula != null) return false
    if (cell.kind !== 'string') return false
    return cell.raw === '' || cell.raw == null
}

function makeInput(
    cell: ClipboardCell,
    mode: PasteMode,
    deltaRow: number,
    deltaCol: number
): InferredCellInput {
    // 'values' mode strips the formula and pastes only the cached raw
    // with the source's kind. A formula cell whose cached value was
    // 7 lands as `{ kind:'formula', raw:7 }`? No — we want it to land as
    // a non-formula scalar so subsequent edits don't reanimate as
    // formulas. Coerce formula→matching scalar kind.
    if (mode === 'values') {
        return valuesOnlyInput(cell)
    }

    // 'all', 'formulas', and 'transpose' all preserve the formula
    // (with rewritten refs) when one is present.
    if (cell.formula != null) {
        const nextFormula = rewriteFormula(cell.formula, deltaRow, deltaCol)
        // Drop the cached raw so HF recomputes against the rewritten
        // refs at the new location. display falls back to the formula
        // text until HF writes a result back, mirroring inferCellInput.
        return {
            kind: 'formula',
            raw: null,
            display: nextFormula,
            formula: nextFormula,
        }
    }

    // Non-formula cell — just round-trip the value through formatCell
    // to derive a display string. numFmt-aware formatting happens at
    // render time; the cached display is the kind-only baseline (same
    // as inferCellInput).
    return {
        kind: cell.kind,
        raw: cell.raw,
        display: formatCell(cell.kind, cell.raw),
    }
}

// 'values' coercion: a formula source cell becomes a plain scalar at
// the destination so the paste is truly value-only. Pick the kind that
// matches the typeof of `raw`. If raw is null (unevaluated formula),
// drop to an empty string cell — matches Sheets' behavior for an
// uncomputed formula in a values-only paste.
function valuesOnlyInput(cell: ClipboardCell): InferredCellInput {
    if (cell.kind !== 'formula') {
        return {
            kind: cell.kind,
            raw: cell.raw,
            display: formatCell(cell.kind, cell.raw),
        }
    }
    const raw = cell.raw
    if (typeof raw === 'number') {
        return { kind: 'number', raw, display: formatCell('number', raw) }
    }
    if (typeof raw === 'boolean') {
        return { kind: 'boolean', raw, display: formatCell('boolean', raw) }
    }
    if (typeof raw === 'string') {
        return { kind: 'string', raw, display: raw }
    }
    return { kind: 'string', raw: '', display: '' }
}
