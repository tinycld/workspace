import { useEffect } from 'react'
import type * as Y from 'yjs'
import { applyFilter, readFilterView } from '../lib/filter'
import { parseYCellKey } from '../lib/y-cell-key'
import { CELLS_MAP } from '../lib/y-doc-bootstrap'

// useReactiveFilter re-evaluates the active filter when a cell inside
// any filtered column (within the persisted filter range) changes.
// Without this, typing into a previously-blank row below the source
// selection would leave the row visible even after the value should
// trigger a hide — applyFilter only runs once when the user invokes
// the menu, so it can't react to later edits.
//
// Observes the top-level CELLS_MAP only (not observeDeep) — cell add/
// delete/replace is enough to know a row's data changed, and avoids
// the storm of nested events that observeDeep would emit on style
// edits, formula recomputes, etc.
export function useReactiveFilter(doc: Y.Doc | null, sheetId: string, frozenRows: number): void {
    useEffect(() => {
        if (doc == null) return
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

        const handler = (event: Y.YMapEvent<Y.Map<unknown>>) => {
            const view = readFilterView(doc, sheetId)
            if (view == null) return

            const filteredCols = new Set<number>()
            for (const key of Object.keys(view.criteria)) {
                const c = Number(key)
                if (Number.isFinite(c)) filteredCols.add(c)
            }
            if (filteredCols.size === 0) return

            let touches = false
            for (const key of event.keysChanged) {
                const parsed = parseYCellKey(key)
                if (parsed == null) continue
                if (parsed.sheetId !== sheetId) continue
                if (!filteredCols.has(parsed.col)) continue
                if (parsed.row < view.range.startRow) continue
                if (parsed.row > view.range.endRow) continue
                touches = true
                break
            }
            if (!touches) return

            applyFilter(
                doc,
                sheetId,
                { range: view.range, criteria: view.criteria, mode: view.mode },
                frozenRows
            )
        }

        cellsMap.observe(handler)
        return () => cellsMap.unobserve(handler)
    }, [doc, sheetId, frozenRows])
}
