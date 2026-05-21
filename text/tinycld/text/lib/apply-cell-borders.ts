import type { Editor } from '@tiptap/react'
import { CellSelection, selectedRect, TableMap } from '@tiptap/pm/tables'
import {
    type CellBorder,
    type CellBorderPreset,
    type CellBorders,
    type CellRange,
    DEFAULT_BORDER,
    edgesForPreset,
    EMPTY_BORDERS,
} from './cell-borders'

export interface ApplyBordersOptions {
    preset: CellBorderPreset
    border?: Partial<CellBorder>
}

// applyCellBorders walks the current selection's cells, computes the
// per-edge edits using edgesForPreset, and merges them into each cell's
// existing `borders` attribute in a single transaction. If the caret
// is in a table but no cells are selected (a plain TextSelection inside
// one cell), we treat that single cell as the range — Google Docs does
// the same thing.
//
// Returns true if it actually applied changes. False when:
//   - the editor isn't focused on a table
//   - the preset is a no-op for the given range (e.g. 'inner' on a 1×1
//     range)
//
// All edits go through a single tr.setNodeMarkup() per cell and one
// dispatch — TipTap's collab plugin then forwards one batched Y.Doc
// transaction.
export function applyCellBorders(editor: Editor | null, opts: ApplyBordersOptions): boolean {
    if (!editor) return false
    const { state } = editor
    const rectInfo = safeSelectedRect(state)
    if (!rectInfo) return false
    const { rect, map, tableStart, table } = rectInfo

    const range: CellRange = {
        startRow: rect.top,
        endRow: rect.bottom - 1,
        startCol: rect.left,
        endCol: rect.right - 1,
    }

    const border: CellBorder = {
        style: opts.border?.style ?? DEFAULT_BORDER.style,
        widthPx: opts.border?.widthPx ?? DEFAULT_BORDER.widthPx,
        color: opts.border?.color ?? DEFAULT_BORDER.color,
    }

    const tr = state.tr
    let changed = false
    const seen = new Set<number>()

    for (let row = rect.top; row < rect.bottom; row++) {
        for (let col = rect.left; col < rect.right; col++) {
            const cellPos = map.map[row * map.width + col]
            if (seen.has(cellPos)) continue
            seen.add(cellPos)

            const cellNode = table.nodeAt(cellPos)
            if (!cellNode) continue

            const edges = edgesForPreset(opts.preset, { row, col }, range, border)
            if (Object.keys(edges).length === 0) continue

            const existing = (cellNode.attrs.borders as CellBorders | null) ?? EMPTY_BORDERS
            const next: CellBorders = {
                top: 'top' in edges ? (edges.top ?? null) : existing.top,
                right: 'right' in edges ? (edges.right ?? null) : existing.right,
                bottom: 'bottom' in edges ? (edges.bottom ?? null) : existing.bottom,
                left: 'left' in edges ? (edges.left ?? null) : existing.left,
            }

            tr.setNodeMarkup(tableStart + cellPos, undefined, {
                ...cellNode.attrs,
                borders: next,
            })
            changed = true
        }
    }

    if (!changed) return false
    editor.view.dispatch(tr)
    return true
}

// selectedRect needs a CellSelection to give us the rectangular range.
// If the caret is a plain TextSelection inside a single cell, we
// synthesize a CellSelection over just that cell. The returned
// `tableStart` is the absolute doc position of the table's open token,
// and `map` is indexed in row-major order over the table's cell grid.
function safeSelectedRect(state: import('@tiptap/pm/state').EditorState) {
    let selection = state.selection
    if (!(selection instanceof CellSelection)) {
        // Find the enclosing cell. selectedRect requires the selection
        // to start inside a cell; if we're not even in a table, bail.
        const $from = selection.$from
        for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth)
            if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') {
                const cellPos = $from.before(depth)
                selection = CellSelection.create(state.doc, cellPos)
                break
            }
        }
        if (!(selection instanceof CellSelection)) return null
    }

    // selectedRect wants the selection to be the active one — clone the
    // state with our (possibly-synthesized) CellSelection so its read
    // is consistent.
    const tr = state.tr.setSelection(selection)
    const rect = selectedRect(state.apply(tr))
    if (!rect.tableStart || !rect.map || !rect.table) return null
    return {
        rect: rect as ReturnType<typeof selectedRect> & { map: TableMap },
        map: rect.map,
        tableStart: rect.tableStart,
        table: rect.table,
    }
}
