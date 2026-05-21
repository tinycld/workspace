// Lazy row / column / whole-sheet styling lives on per-sheet metadata
// rather than per-cell, so applying "fill row 7 yellow" produces a
// single Y.Map entry on the sheet instead of N per-cell writes for
// every column. The render path merges these layers under the cell's
// own style at draw time (see mergeStyleLayers in cell-style-render.ts);
// precedence highest→lowest is cell > row > col > sheet, matching
// Excel/Sheets and the OOXML inheritance model where empty cells
// inherit row/col styles at render time.
//
// The nested style Y.Map shape is identical to cell[STYLE_KEY] (groups
// font/fill/alignment/borders + scalar numFmt), so buildStyleYMap and
// the deep-merge logic in setYCellStyle are reused as-is — only the
// storage location differs.
//
// Tombstone caveat: meta.get(ROW_STYLES_KEY) is Y.Map<Y.Map<unknown>>.
// Every set on the same row key retains a CRDT tombstone for the prior
// value. Sparse usage (10s of styled rows in a real workbook) keeps
// this bounded — see the same caveat for cells at
// y-doc-bootstrap.ts:11-17. If we later see hundreds of styled rows in
// real workbooks the YKeyValue migration applies.
import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { CellStyle } from './workbook-types'
import { buildStyleYMap, readStyleFromYMapEntry, SHEETS_MAP } from './y-doc-bootstrap'

// ROW_STYLES_KEY is the nested key under each sheet's metadata Y.Map
// holding a Y.Map<Y.Map<unknown>> from "row" → style YMap. Lazily
// created on first write so an unstyled sheet adds zero bytes to the
// doc.
export const ROW_STYLES_KEY = 'rowStyles'

export type RowStyles = Record<number, CellStyle>

// readRowStylesFromMeta extracts the sheet's rowStyles Y.Map (if any)
// into a plain Record<number, CellStyle>. Used by useYSheets to build
// the snapshot. Keeps the resulting object sparse so consumers can
// fall back to undefined for absent rows.
export function readRowStylesFromMeta(meta: Y.Map<unknown> | undefined): RowStyles | undefined {
    if (meta == null) return undefined
    const styles = meta.get(ROW_STYLES_KEY)
    if (!(styles instanceof Y.Map)) return undefined
    if (styles.size === 0) return undefined
    const out: RowStyles = {}
    let any = false
    styles.forEach((value, key) => {
        if (!(value instanceof Y.Map)) return
        const row = Number(key)
        if (!Number.isFinite(row)) return
        const decoded = readStyleFromYMapEntry(value)
        if (decoded == null) return
        out[row] = decoded
        any = true
    })
    return any ? out : undefined
}

// readRowStyleFromMeta reads a single row's style without allocating
// the full sparse Record. Used by per-cell selectors that only care
// about their own row.
export function readRowStyleFromMeta(
    meta: Y.Map<unknown> | undefined,
    row: number
): CellStyle | undefined {
    if (meta == null) return undefined
    const styles = meta.get(ROW_STYLES_KEY)
    if (!(styles instanceof Y.Map)) return undefined
    const entry = styles.get(String(row))
    if (!(entry instanceof Y.Map)) return undefined
    return readStyleFromYMapEntry(entry)
}

// setYRowStyle deep-merges a partial CellStyle patch onto the row's
// style YMap, lazily creating the rowStyles container and the row
// entry on first write. Mirrors setYCellStyle's semantics: setting a
// value to undefined leaves it alone, setting a defined value
// overwrites. LOCAL_ORIGIN tags the transact so the realtime undo
// manager captures the write (sheet-meta mutations land under
// SHEETS_MAP, which the undo manager already scopes — see
// use-undo-manager.ts).
export function setYRowStyle(
    doc: Y.Doc | null,
    sheetId: string,
    row: number,
    patch: CellStyle
): void {
    if (doc == null) return
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (meta == null) return
    doc.transact(() => {
        let stylesMap = meta.get(ROW_STYLES_KEY)
        if (!(stylesMap instanceof Y.Map)) {
            stylesMap = new Y.Map<Y.Map<unknown>>()
            meta.set(ROW_STYLES_KEY, stylesMap)
        }
        const rowKey = String(row)
        const rowStyle = (stylesMap as Y.Map<Y.Map<unknown>>).get(rowKey)
        if (!(rowStyle instanceof Y.Map)) {
            // First write to this row: build the YMap from the patch
            // directly. buildStyleYMap returns null when the patch is
            // structurally empty — guard here and short-circuit so we
            // don't create an empty entry the reader would later skip.
            const built = buildStyleYMap(patch)
            if (built == null) return
            ;(stylesMap as Y.Map<Y.Map<unknown>>).set(rowKey, built)
            return
        }
        for (const groupKey of Object.keys(patch) as (keyof CellStyle)[]) {
            const groupPatch = patch[groupKey]
            if (groupPatch == null) continue
            if (typeof groupPatch === 'string') {
                rowStyle.set(groupKey, groupPatch)
                continue
            }
            const existing = rowStyle.get(groupKey)
            const groupMap: Y.Map<unknown> =
                existing instanceof Y.Map ? existing : new Y.Map<unknown>()
            if (existing !== groupMap) rowStyle.set(groupKey, groupMap)
            for (const [k, v] of Object.entries(groupPatch)) {
                if (v == null) continue
                groupMap.set(k, v as unknown)
            }
        }
    }, LOCAL_ORIGIN)
}

// clearYRowStyle removes a row's style entry entirely. Used by the
// "Clear formatting" context-menu action when scope is 'row'. Cells
// in the row keep their per-cell styles (and their values).
export function clearYRowStyle(doc: Y.Doc | null, sheetId: string, row: number): void {
    if (doc == null) return
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (meta == null) return
    doc.transact(() => {
        const stylesMap = meta.get(ROW_STYLES_KEY)
        if (!(stylesMap instanceof Y.Map)) return
        stylesMap.delete(String(row))
    }, LOCAL_ORIGIN)
}
