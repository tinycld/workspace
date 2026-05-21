import type { Editor } from '@tiptap/react'
import { CellSelection, selectedRect, TableMap } from '@tiptap/pm/tables'
import { normalizeHexColor } from './cell-shading'

// applyCellShading walks the current selection's cells and sets the
// `shading` attr on each to `color` (a CSS hex like "#FFFF00") or null
// (to clear it). If the caret is in a table but no cells are selected
// (a plain TextSelection inside one cell), we treat that single cell
// as the range — Google Docs does the same thing.
//
// Mirrors applyCellBorders: one transaction, one dispatch, deduplicate
// cells by position so a CellSelection over a merged cell doesn't
// double-set the attr.
export function applyCellShading(editor: Editor | null, color: string | null): boolean {
    if (!editor) return false
    const { state } = editor
    const rectInfo = safeSelectedRect(state)
    if (!rectInfo) return false
    const { rect, map, tableStart, table } = rectInfo

    const normalized = color === null ? null : normalizeHexColor(color)

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

            if ((cellNode.attrs.shading ?? null) === normalized) continue

            tr.setNodeMarkup(tableStart + cellPos, undefined, {
                ...cellNode.attrs,
                shading: normalized,
            })
            changed = true
        }
    }

    if (!changed) return false
    editor.view.dispatch(tr)
    return true
}

// Mirror of apply-cell-borders' safeSelectedRect — synthesize a
// CellSelection over the caret's enclosing cell when the user has a
// plain TextSelection so the user can apply shading without
// shift-dragging first.
function safeSelectedRect(state: import('@tiptap/pm/state').EditorState) {
    let selection = state.selection
    if (!(selection instanceof CellSelection)) {
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
