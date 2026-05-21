import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { InferredCellInput } from '../lib/cell-input'
import { inferCellInput } from '../lib/cell-input'
import { FORMULA_ORIGIN } from '../lib/formula/origins'
import { type CellRaw, type CellStyle, formatCell } from '../lib/workbook-types'
import { yCellKey } from '../lib/y-cell-key'
import {
    buildStyleYMap,
    CELLS_MAP,
    readYCell,
    STYLE_KEY,
    type YCellValue,
} from '../lib/y-doc-bootstrap'

// useYCell subscribes to one Y.Map cell entry and re-renders the caller
// only when that specific cell changes. Internally uses
// useSyncExternalStore against the parent map's `observe` event,
// filtering to keys this hook cares about.
//
// Returns null when the cell does not exist in the Y.Doc (i.e. empty
// cell).
export function useYCell(
    doc: Y.Doc | null,
    sheetId: string,
    row: number,
    col: number
): YCellValue | null {
    const key = yCellKey(sheetId, row, col)

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
            // We observe two layers: the parent map (for adds/replacements
            // of *this* key) and the nested cell map (for in-place
            // raw/display field changes). When the cell is replaced
            // wholesale, we re-attach the nested observer.
            //
            // observeDeep on the cell Y.Map catches changes inside the
            // nested style Y.Map without us having to re-attach a third
            // layer of observers when style is added/removed.
            let nested: Y.Map<unknown> | undefined = cellsMap.get(key)
            const nestedHandler = () => onChange()
            nested?.observeDeep(nestedHandler)

            const parentHandler = (event: Y.YMapEvent<Y.Map<unknown>>) => {
                if (!event.keysChanged.has(key)) return
                if (nested != null) {
                    try {
                        nested.unobserveDeep(nestedHandler)
                    } catch {
                        // already detached or removed; tolerate
                    }
                }
                nested = cellsMap.get(key)
                nested?.observeDeep(nestedHandler)
                onChange()
            }
            cellsMap.observe(parentHandler)

            return () => {
                cellsMap.unobserve(parentHandler)
                if (nested != null) {
                    try {
                        nested.unobserveDeep(nestedHandler)
                    } catch {
                        // ignore
                    }
                }
            }
        },
        [doc, key]
    )

    // Stable snapshot caching — useSyncExternalStore re-invokes
    // getSnapshot on every render and infinite-loops if we hand back a
    // fresh object each time. We memoize on field-equality so the
    // identity stays stable across renders that didn't actually change
    // the cell.
    const snapshotRef = useRef<YCellValue | null>(null)
    const getSnapshot = useCallback((): YCellValue | null => {
        if (doc == null) {
            snapshotRef.current = null
            return null
        }
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(key)
        if (cell == null) {
            snapshotRef.current = null
            return null
        }
        const next = readYCell(cell)
        const prev = snapshotRef.current
        if (
            prev != null &&
            prev.kind === next.kind &&
            prev.raw === next.raw &&
            prev.display === next.display &&
            prev.formula === next.formula &&
            sameStyle(prev.style, next.style)
        ) {
            return prev
        }
        snapshotRef.current = next
        return next
    }, [doc, key])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// readNumFmtFromCell pulls the numFmt scalar out of a cell's nested
// style Y.Map without going through readStyleFromYMap (which would
// allocate a CellStyle for one field). Returns undefined when the cell
// has no style entry or no numFmt key.
function readNumFmtFromCell(cell: Y.Map<unknown>): string | undefined {
    const style = cell.get('style')
    if (!(style instanceof Y.Map)) return undefined
    const v = style.get('numFmt')
    return typeof v === 'string' ? v : undefined
}

// sameStyle is a structural-equality check used by the snapshot cache
// to avoid handing back a fresh object identity when no style attribute
// actually changed. JSON.stringify is fine here — partial style
// objects are tiny (a handful of keys) and we never store functions or
// circular references.
function sameStyle(a: CellStyle | undefined, b: CellStyle | undefined): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    return JSON.stringify(a) === JSON.stringify(b)
}

// setYCell is the high-level commit path: take the user-typed string,
// run it through inferCellInput, and persist the resulting typed
// (kind, raw, display, formula) tuple to the Y.Doc.
//
// Empty input deletes the cell entry (matches Excel's "backspace
// clears" semantics — there's no kind-string raw-empty state created
// from the editor).
//
// When the cell already exists, this mutates the existing nested
// Y.Map in place rather than replacing it; replacement would discard
// the nested style Y.Map (and its CRDT history), so typing into a
// bolded cell would silently drop the bold.
//
// The LOCAL_ORIGIN tag is what the realtime undo manager allowlists;
// without it the edit would not be captured for undo.
export function setYCell(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    input: string
): void {
    if (input === '') {
        deleteYCell(doc, sheetId, row, col)
        return
    }
    setYCellTyped(doc, sheetId, row, col, inferCellInput(input))
}

// setYCellTyped writes a pre-inferred value to a cell. Programmatic
// callers (tests, paste-special handlers, future bulk-edit paths) skip
// the inference step and hand the typed shape directly. The editor
// commit path goes through setYCell, which calls inferCellInput first.
export function setYCellTyped(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    input: InferredCellInput
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    doc.transact(() => {
        // Empty string-kinded input is the editor's "user backspaced
        // out everything and pressed Enter" path: clear the cell.
        if (input.kind === 'string' && input.raw === '') {
            cellsMap.delete(key)
            return
        }
        let cell = cellsMap.get(key)
        if (cell == null) {
            cell = new Y.Map<unknown>()
            cellsMap.set(key, cell)
        }
        cell.set('kind', input.kind)
        cell.set('raw', input.raw)
        cell.set('display', input.display)
        if (input.formula != null) {
            cell.set('formula', input.formula)
        } else if (cell.has('formula')) {
            cell.delete('formula')
        }
    }, LOCAL_ORIGIN)
}

// setYCellFormulaResult writes the engine-computed result of a formula
// cell back into the Y.Doc, leaving kind, formula, and style untouched.
//
// Tagged with FORMULA_ORIGIN so:
//   - the realtime undo manager (which allowlists LOCAL_ORIGIN) does
//     not capture it — undo rewinds the user's formula edit, not the
//     recomputed result
//   - the formula bridge's own observeDeep callback can short-circuit
//     and skip re-forwarding the writeback into HF
//
// Self-equality short-circuit: when peers also evaluate the same
// formula and arrive at the same value, the no-op avoids redundant
// CRDT updates on the wire.
//
// Only acts on cells that already have kind === 'formula'. If the cell
// is missing or has a different kind, the call is a no-op (a writeback
// arriving against a cell whose formula was just deleted shouldn't
// resurrect it).
export function setYCellFormulaResult(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    raw: CellRaw
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    const cell = cellsMap.get(key)
    if (cell == null) return
    if (cell.get('kind') !== 'formula') return
    if (cell.get('raw') === raw) return
    const formula = cell.get('formula')
    const formulaText = typeof formula === 'string' ? formula : undefined
    // Read the cell's numFmt (if any) so the cached display string
    // reflects the formatted value old peers / serializers see. The
    // live render path recomputes display from raw + style anyway, so
    // a missing numFmt here just means the cache shows the unformatted
    // baseline — it can't drift the live UI.
    const numFmt = readNumFmtFromCell(cell)
    const display = formatCell('formula', raw, formulaText, numFmt)
    doc.transact(() => {
        cell.set('raw', raw)
        cell.set('display', display)
    }, FORMULA_ORIGIN)
}

// deleteYCell removes a cell entry entirely. Used by the editor's
// "clear" path and by the context menu's "Clear contents" action.
export function deleteYCell(doc: Y.Doc, sheetId: string, row: number, col: number): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    doc.transact(() => {
        cellsMap.delete(key)
    }, LOCAL_ORIGIN)
}

// setYCellStyle deep-merges a partial CellStyle patch onto the cell at
// (sheetId, row, col). Cells that don't exist yet are created with no
// raw/display, just style — toggling bold on an empty cell is valid
// and persists as soon as the cell gets a value, or on its own as a
// pure-style entry on save.
//
// The patch is merged group-by-group, key-by-key. Setting a value to
// `undefined` (or omitting the key) leaves the prior value alone;
// setting it to a defined value overwrites. This matches the snapshot
// semantics: only what's present is sent, only what's present is
// applied.
export function setYCellStyle(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    patch: CellStyle
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    doc.transact(() => {
        let cell = cellsMap.get(key)
        if (cell == null) {
            cell = new Y.Map<unknown>()
            cellsMap.set(key, cell)
        }
        let styleMap = cell.get(STYLE_KEY)
        if (!(styleMap instanceof Y.Map)) {
            styleMap = buildStyleYMap(patch)
            if (styleMap != null) {
                cell.set(STYLE_KEY, styleMap)
            }
            return
        }
        for (const groupKey of Object.keys(patch) as (keyof CellStyle)[]) {
            const groupPatch = patch[groupKey]
            if (groupPatch == null) continue
            if (typeof groupPatch === 'string') {
                styleMap.set(groupKey, groupPatch)
                continue
            }
            let groupMap = styleMap.get(groupKey)
            if (!(groupMap instanceof Y.Map)) {
                groupMap = new Y.Map<unknown>()
                styleMap.set(groupKey, groupMap)
            }
            for (const [k, v] of Object.entries(groupPatch)) {
                if (v == null) continue
                // Inner value is itself an object (e.g. CellBorderEdge under
                // a borders edge): build a nested Y.Map so the read path
                // sees structured data instead of a literal JS object that
                // y-crdt cannot index. Scalars (string/number/boolean) and
                // explicit `false` clears land directly on the group map.
                if (typeof v === 'object' && v !== null) {
                    const inner = new Y.Map<unknown>()
                    for (const [ik, iv] of Object.entries(v)) {
                        if (iv == null) continue
                        inner.set(ik, iv as unknown)
                    }
                    groupMap.set(k, inner)
                    continue
                }
                groupMap.set(k, v as unknown)
            }
        }
    }, LOCAL_ORIGIN)
}
