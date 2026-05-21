// Filter view: hides rows in a range whose cells don't match a set of
// per-column criteria. Hidden rows use the existing zero-height-hide
// mechanism (Body.tsx skips height<=0 rows). Prior heights are saved
// in the filter view so clearFilter restores them exactly.
//
// The filter definition lives on sheet metadata under the `filterView`
// Y.Map key — persisted alongside the workbook so a reload restores
// the same hidden-row state. Keeping the Y.Map flat (no nested doc
// types) makes the snapshot serializer's job trivial.
import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { CellRange } from '../hooks/grid-store'
import { ROW_HEIGHTS_KEY } from './dimensions'
import { yCellKey } from './y-cell-key'
import { CELLS_MAP, SHEETS_MAP } from './y-doc-bootstrap'

export type FilterCondition =
    | { op: 'gt'; values: string[] }
    | { op: 'lt'; values: string[] }
    | { op: 'eq'; values: string[] }
    | { op: 'neq'; values: string[] }
    | { op: 'contains'; values: string[] }
    | { op: 'startsWith'; values: string[] }
    | { op: 'endsWith'; values: string[] }
    | { op: 'isEmpty' }
    | { op: 'isNotEmpty' }

export type FilterCriterion =
    | { type: 'values'; allowedValues: string[] }
    | { type: 'condition'; condition: FilterCondition }

export type FilterMode = 'range' | 'header'

export interface FilterDefinition {
    mode: FilterMode
    range: CellRange
    criteria: Record<number, FilterCriterion>
    savedHeights: Record<number, number>
}

export const FILTER_VIEW_KEY = 'filterView'

// readCellDisplay returns the display string of (row, col), or empty
// string when the cell is missing. Used for both criteria evaluation
// and distinct-values enumeration so the user filters by what they see.
function readCellDisplay(doc: Y.Doc, sheetId: string, row: number, col: number): string {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return ''
    const display = cell.get('display')
    return typeof display === 'string' ? display : ''
}

function readCellNumber(doc: Y.Doc, sheetId: string, row: number, col: number): number | null {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return null
    const raw = cell.get('raw')
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
    }
    return null
}

// Numeric-aware single-value comparator for gt/lt. Falls back to
// lexicographic when the criterion's target value isn't parseable
// as a number (matches the previous single-value behavior).
function compareGtLt(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    display: string,
    op: 'gt' | 'lt',
    value: string
): boolean {
    const target = Number(value)
    if (Number.isFinite(target)) {
        const cellNum = readCellNumber(doc, sheetId, row, col)
        if (cellNum == null) return false
        return op === 'gt' ? cellNum > target : cellNum < target
    }
    return op === 'gt' ? display > value : display < value
}

// matchesCriterion evaluates a single column's criterion against the
// cell at (row, col). For value-bearing ops the criterion's `values`
// list is OR-combined (any-of); for `neq` it's AND-of-negations
// (none-of) so "neq A, B" excludes rows whose display is A or B.
function matchesCriterion(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    criterion: FilterCriterion
): boolean {
    const display = readCellDisplay(doc, sheetId, row, col)
    if (criterion.type === 'values') {
        return criterion.allowedValues.includes(display)
    }
    const cond = criterion.condition
    switch (cond.op) {
        case 'isEmpty':
            return display === ''
        case 'isNotEmpty':
            return display !== ''
        case 'eq':
            return cond.values.some(v => display === v)
        case 'neq':
            return cond.values.every(v => display !== v)
        case 'contains':
            return cond.values.some(v => display.includes(v))
        case 'startsWith':
            return cond.values.some(v => display.startsWith(v))
        case 'endsWith':
            return cond.values.some(v => display.endsWith(v))
        case 'gt':
        case 'lt':
            return cond.values.some(v => compareGtLt(doc, sheetId, row, col, display, cond.op, v))
    }
}

// rowMatches returns true iff EVERY column criterion in `criteria`
// passes for the row. Columns with no criterion are ignored.
//
// A row that is entirely blank in the filtered columns counts as
// visible — the filter only suppresses rows whose populated cells fail
// the criteria, never empty rows the user hasn't touched yet. Without
// this, applying a filter across the displayed grid would instantly
// hide every below-data row and the user couldn't type into them.
function rowMatches(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    criteria: Record<number, FilterCriterion>
): boolean {
    let hasPopulated = false
    for (const colKey of Object.keys(criteria)) {
        const col = Number(colKey)
        if (!Number.isFinite(col)) continue
        const display = readCellDisplay(doc, sheetId, row, col)
        if (display !== '') {
            hasPopulated = true
            if (!matchesCriterion(doc, sheetId, row, col, criteria[col])) return false
        }
    }
    if (!hasPopulated) return true
    return true
}

function getMeta(doc: Y.Doc, sheetId: string): Y.Map<unknown> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    return sheetsMap.get(sheetId) ?? null
}

function getOrCreateFilterView(meta: Y.Map<unknown>): Y.Map<unknown> {
    const existing = meta.get(FILTER_VIEW_KEY)
    if (existing instanceof Y.Map) return existing
    const created = new Y.Map<unknown>()
    meta.set(FILTER_VIEW_KEY, created)
    return created
}

function rangeToYMap(range: CellRange): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    m.set('startRow', range.startRow)
    m.set('endRow', range.endRow)
    m.set('startCol', range.startCol)
    m.set('endCol', range.endCol)
    return m
}

function rangeFromYMap(m: Y.Map<unknown>): CellRange | null {
    const sr = m.get('startRow')
    const er = m.get('endRow')
    const sc = m.get('startCol')
    const ec = m.get('endCol')
    if (typeof sr !== 'number' || typeof er !== 'number') return null
    if (typeof sc !== 'number' || typeof ec !== 'number') return null
    return { startRow: sr, endRow: er, startCol: sc, endCol: ec }
}

function criterionToYMap(criterion: FilterCriterion): Y.Map<unknown> {
    const out = new Y.Map<unknown>()
    if (criterion.type === 'values') {
        out.set('type', 'values')
        const arr = new Y.Array<string>()
        arr.push(criterion.allowedValues)
        out.set('allowedValues', arr)
        return out
    }
    out.set('type', 'condition')
    const cond = new Y.Map<unknown>()
    cond.set('op', criterion.condition.op)
    if ('values' in criterion.condition) {
        const arr = new Y.Array<string>()
        arr.push(criterion.condition.values)
        cond.set('values', arr)
    }
    out.set('condition', cond)
    return out
}

function readStringArray(raw: unknown): string[] | null {
    if (raw instanceof Y.Array) {
        return raw.toArray().filter((v): v is string => typeof v === 'string')
    }
    if (Array.isArray(raw)) {
        return raw.filter((v): v is string => typeof v === 'string')
    }
    return null
}

function criterionFromYMap(m: Y.Map<unknown>): FilterCriterion | null {
    const type = m.get('type')
    if (type === 'values') {
        const arr = readStringArray(m.get('allowedValues'))
        return { type: 'values', allowedValues: arr ?? [] }
    }
    if (type === 'condition') {
        const cond = m.get('condition')
        if (!(cond instanceof Y.Map)) return null
        const op = cond.get('op')
        // Back-compat: older docs persisted a single `value` string.
        const valuesArr = readStringArray(cond.get('values'))
        const legacyValue = cond.get('value')
        const values: string[] =
            valuesArr ?? (typeof legacyValue === 'string' ? [legacyValue] : [])
        switch (op) {
            case 'gt':
            case 'lt':
            case 'eq':
            case 'neq':
            case 'contains':
            case 'startsWith':
            case 'endsWith':
                return { type: 'condition', condition: { op, values } }
            case 'isEmpty':
            case 'isNotEmpty':
                return { type: 'condition', condition: { op } }
            default:
                return null
        }
    }
    return null
}

// readFilterView returns a structured snapshot of the persisted filter
// view, or null when none is set. Used by UI components and the apply
// path to read the prior savedHeights so it can preserve user-set row
// heights across multiple apply→clear cycles.
export function readFilterView(doc: Y.Doc, sheetId: string): FilterDefinition | null {
    const meta = getMeta(doc, sheetId)
    if (meta == null) return null
    const view = meta.get(FILTER_VIEW_KEY)
    if (!(view instanceof Y.Map)) return null
    const rangeMap = view.get('range')
    if (!(rangeMap instanceof Y.Map)) return null
    const range = rangeFromYMap(rangeMap)
    if (range == null) return null

    const modeRaw = view.get('mode')
    const mode: FilterMode = modeRaw === 'header' ? 'header' : 'range'

    const criteria: Record<number, FilterCriterion> = {}
    const critMap = view.get('criteria')
    if (critMap instanceof Y.Map) {
        critMap.forEach((value, key) => {
            const col = Number(key)
            if (!Number.isFinite(col)) return
            if (!(value instanceof Y.Map)) return
            const c = criterionFromYMap(value)
            if (c != null) criteria[col] = c
        })
    }

    const savedHeights: Record<number, number> = {}
    const heightsMap = view.get('savedHeights')
    if (heightsMap instanceof Y.Map) {
        heightsMap.forEach((value, key) => {
            const row = Number(key)
            if (!Number.isFinite(row)) return
            if (typeof value !== 'number') return
            savedHeights[row] = value
        })
    }

    return { mode, range, criteria, savedHeights }
}

// applyFilter persists the criteria onto sheet metadata and writes
// rowHeights[row] = 0 for every non-matching row in the range.
// Prior heights are stored in `savedHeights` (only on the first apply)
// so clearFilter can restore them. Frozen rows are always protected:
// they never get a 0-height override even if they don't match.
//
// Re-applying after a criteria change reuses the existing savedHeights
// and unhides any rows that now match again before re-hiding the new
// non-matchers.
export function applyFilter(
    doc: Y.Doc,
    sheetId: string,
    filterDef: { range: CellRange; criteria: Record<number, FilterCriterion>; mode: FilterMode },
    frozenRows: number
): void {
    const meta = getMeta(doc, sheetId)
    if (meta == null) return

    const safeFrozen = Math.max(0, frozenRows)

    doc.transact(() => {
        const view = getOrCreateFilterView(meta)

        view.set('mode', filterDef.mode)
        view.set('range', rangeToYMap(filterDef.range))
        const critMap = new Y.Map<unknown>()
        for (const [colKey, criterion] of Object.entries(filterDef.criteria)) {
            const col = Number(colKey)
            if (!Number.isFinite(col)) continue
            critMap.set(String(col), criterionToYMap(criterion))
        }
        view.set('criteria', critMap)

        // Capture the *pre-filter* heights map. If a prior savedHeights
        // exists (re-apply after criteria change), keep it — those are
        // the user's true heights; the current rowHeights map may
        // already carry our 0-overrides.
        let savedHeightsMap = view.get('savedHeights')
        if (!(savedHeightsMap instanceof Y.Map)) {
            savedHeightsMap = new Y.Map<unknown>()
            view.set('savedHeights', savedHeightsMap)
            const rh = meta.get(ROW_HEIGHTS_KEY)
            if (rh instanceof Y.Map) {
                const snapshotStart = Math.max(filterDef.range.startRow, safeFrozen)
                rh.forEach((value, key) => {
                    if (typeof value !== 'number') return
                    const row = Number(key)
                    if (!Number.isFinite(row)) return
                    if (row < snapshotStart || row > filterDef.range.endRow) return
                    if (value === 0) return
                    ;(savedHeightsMap as Y.Map<unknown>).set(String(row), value)
                })
            }
        }

        let rowHeights = meta.get(ROW_HEIGHTS_KEY)
        if (!(rowHeights instanceof Y.Map)) {
            rowHeights = new Y.Map<number>()
            meta.set(ROW_HEIGHTS_KEY, rowHeights)
        }
        const heights = rowHeights as Y.Map<number>

        const loopStart = Math.max(filterDef.range.startRow, safeFrozen)
        for (let r = loopStart; r <= filterDef.range.endRow; r++) {
            const visible = rowMatches(doc, sheetId, r, filterDef.criteria)
            if (visible) {
                // Restore prior height if we'd previously hidden this
                // row; otherwise leave whatever the user set.
                const prior = (savedHeightsMap as Y.Map<unknown>).get(String(r))
                if (typeof prior === 'number') {
                    heights.set(String(r), prior)
                } else {
                    // Default-height row: drop any 0-override entry we
                    // might have written previously.
                    heights.delete(String(r))
                }
                continue
            }
            heights.set(String(r), 0)
        }
    }, LOCAL_ORIGIN)
}

// clearFilter restores prior row heights and removes the filter view
// entry. Heights stored in savedHeights are written back; rows we
// hid (height 0) but had no prior entry have their override deleted
// so they resume rendering at DEFAULT_ROW_HEIGHT.
export function clearFilter(doc: Y.Doc, sheetId: string): void {
    const meta = getMeta(doc, sheetId)
    if (meta == null) return
    const view = meta.get(FILTER_VIEW_KEY)
    if (!(view instanceof Y.Map)) return
    const rangeMap = view.get('range')
    if (!(rangeMap instanceof Y.Map)) {
        doc.transact(() => meta.delete(FILTER_VIEW_KEY), LOCAL_ORIGIN)
        return
    }
    const range = rangeFromYMap(rangeMap)
    if (range == null) {
        doc.transact(() => meta.delete(FILTER_VIEW_KEY), LOCAL_ORIGIN)
        return
    }
    doc.transact(() => {
        const heights = meta.get(ROW_HEIGHTS_KEY)
        if (heights instanceof Y.Map) {
            const savedHeightsMap = view.get('savedHeights')
            const isYMap = savedHeightsMap instanceof Y.Map
            for (let r = range.startRow; r <= range.endRow; r++) {
                const cur = heights.get(String(r))
                if (cur !== 0) continue
                const prior = isYMap ? (savedHeightsMap as Y.Map<unknown>).get(String(r)) : undefined
                if (typeof prior === 'number') {
                    ;(heights as Y.Map<number>).set(String(r), prior)
                } else {
                    heights.delete(String(r))
                }
            }
        }
        meta.delete(FILTER_VIEW_KEY)
    }, LOCAL_ORIGIN)
}

// Blanks-last lexicographic sort, shared by distinctValuesForColumn
// and applyValuesFilterFromSelection so the persisted criteria order
// is stable & predictable.
function sortDisplaysBlanksLast(values: Iterable<string>): string[] {
    return [...values].sort((a, b) => {
        if (a === '' && b !== '') return 1
        if (b === '' && a !== '') return -1
        return a.localeCompare(b)
    })
}

// distinctValuesForColumn returns the unique cell display strings in
// `colIndex` over the data rows of `range` (skipping the header).
// Empty strings are included as a single "(blanks)" candidate so the
// user can hide missing values.
export function distinctValuesForColumn(
    doc: Y.Doc,
    sheetId: string,
    range: CellRange,
    colIndex: number
): string[] {
    const seen = new Set<string>()
    for (let r = range.startRow + 1; r <= range.endRow; r++) {
        const display = readCellDisplay(doc, sheetId, r, colIndex)
        seen.add(display)
    }
    return sortDisplaysBlanksLast(seen)
}

// applyValuesFilterFromSelection builds a `values` criterion per
// selected column from the displays inside the selection rectangle,
// then applies it across the whole sheet (rows 0..rowCount-1) for
// those columns. Frozen rows stay protected via applyFilter's clamp.
export function applyValuesFilterFromSelection(
    doc: Y.Doc,
    sheetId: string,
    selection: CellRange,
    rowCount: number,
    frozenRows: number
): void {
    const criteria: Record<number, FilterCriterion> = {}
    for (let c = selection.startCol; c <= selection.endCol; c++) {
        const seen = new Set<string>()
        for (let r = selection.startRow; r <= selection.endRow; r++) {
            seen.add(readCellDisplay(doc, sheetId, r, c))
        }
        criteria[c] = { type: 'values', allowedValues: sortDisplaysBlanksLast(seen) }
    }
    const range: CellRange = {
        startRow: 0,
        endRow: Math.max(0, rowCount - 1),
        startCol: selection.startCol,
        endCol: selection.endCol,
    }
    applyFilter(doc, sheetId, { range, criteria, mode: 'range' }, frozenRows)
}

// upsertColumnCriterion sets/replaces a single column's criterion on
// the shared filterView in `header` mode. If no view exists yet, a
// fresh header-mode view spanning the whole sheet is created.
// `range` mode views are immutable from this entry point (UI hides it).
export function upsertColumnCriterion(
    doc: Y.Doc,
    sheetId: string,
    col: number,
    criterion: FilterCriterion,
    rowCount: number,
    colCount: number,
    frozenRows: number
): void {
    const existing = readFilterView(doc, sheetId)
    if (existing == null) {
        const range: CellRange = {
            startRow: 0,
            endRow: Math.max(0, rowCount - 1),
            startCol: 0,
            endCol: Math.max(0, colCount - 1),
        }
        applyFilter(doc, sheetId, { range, criteria: { [col]: criterion }, mode: 'header' }, frozenRows)
        return
    }
    if (existing.mode === 'range') {
        // UI hides this entry point in range mode; refuse defensively
        // rather than silently clobbering the range-mode filter.
        console.warn('upsertColumnCriterion: refusing to mutate range-mode filterView')
        return
    }
    const merged: Record<number, FilterCriterion> = { ...existing.criteria, [col]: criterion }
    applyFilter(
        doc,
        sheetId,
        { range: existing.range, criteria: merged, mode: 'header' },
        frozenRows
    )
}

// removeColumnCriterion drops a single column's criterion. When it
// was the last criterion on the view, the whole view is cleared
// (restoring all hidden rows). Otherwise the trimmed criteria are
// re-applied so the surviving columns continue to hide non-matchers.
export function removeColumnCriterion(
    doc: Y.Doc,
    sheetId: string,
    col: number,
    frozenRows: number
): void {
    const existing = readFilterView(doc, sheetId)
    if (existing == null) return
    if (!(col in existing.criteria)) return
    const trimmed: Record<number, FilterCriterion> = { ...existing.criteria }
    delete trimmed[col]
    if (Object.keys(trimmed).length === 0) {
        clearFilter(doc, sheetId)
        return
    }
    applyFilter(
        doc,
        sheetId,
        { range: existing.range, criteria: trimmed, mode: existing.mode },
        frozenRows
    )
}
