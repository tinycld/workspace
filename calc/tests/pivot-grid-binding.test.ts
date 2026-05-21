// Tests for the Grid <-> pivot binding. The grid mounts PivotGrid when
// usePivotForSheet returns a non-null def; PivotGrid then dispatches
// among three view states (empty, error, grid) via the pure helper
// in pivot-grid-view-state.ts. The vitest setup runs in a node env
// without jsdom or @testing-library/react, so we exercise the pure
// helper directly (matching the pattern used by pivot-banner.test.tsx
// and the __internals export on the pivot hooks).
//
// What we verify:
//   - selectPivotGridViewState dispatches to 'empty' when the def has
//     no rows / cols / values, regardless of engine result.
//   - selectPivotGridViewState dispatches to 'error' when the engine
//     returns a PivotError, and threads the error through verbatim.
//   - selectPivotGridViewState dispatches to 'grid' when the engine
//     returns a RenderedPivot, and threads the value through.
//   - isPivotDefinitionEmpty matches the spec: empty iff rows AND cols
//     AND values are all empty arrays.
//   - buildPivotGridCellMatrix lays cells out in row-major order with
//     header banding driven by headerRowCount / headerColCount.
//
// We exercise the helper against real engine output too: seed a tiny
// source table, run computePivot, and verify the view state lands on
// the rendered grid with the expected display values.

import { describe, expect, it } from 'vitest'
import { computePivot, type PivotError, type RenderedPivot } from '../tinycld/calc/lib/pivot'
import {
    buildPivotGridCellMatrix,
    isPivotDefinitionEmpty,
    selectPivotGridViewState,
    selectPivotPanelOpen,
} from '../tinycld/calc/components/pivot/pivot-grid-view-state'
import type { CellValue, PivotDefinition } from '../tinycld/calc/lib/workbook-types'
import type { RenderedPivotResult } from '../tinycld/calc/hooks/use-rendered-pivot'

function makeDef(overrides: Partial<PivotDefinition> = {}): PivotDefinition {
    return {
        id: 'p1',
        sourceRange: 'Sheet1!A1:B3',
        targetSheetName: 'Pivot of Sheet1',
        rows: [{ sourceColumn: 'Region' }],
        cols: [],
        values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...overrides,
    }
}

function makeError(): PivotError {
    return {
        ok: false,
        code: 'missing-source-sheet',
        message: 'Source sheet "Sheet1" not found.',
    }
}

function makeRendered(): RenderedPivot {
    return {
        rows: 1,
        cols: 1,
        cells: new Map(),
        headerRowCount: 1,
        headerColCount: 0,
    }
}

function ok(value: RenderedPivot): RenderedPivotResult {
    return { ok: true, value }
}

describe('isPivotDefinitionEmpty', () => {
    it('returns true when rows, cols, and values are all empty', () => {
        const def = makeDef({ rows: [], cols: [], values: [] })
        expect(isPivotDefinitionEmpty(def)).toBe(true)
    })

    it('returns false when any of rows / cols / values has at least one field', () => {
        expect(isPivotDefinitionEmpty(makeDef({ rows: [], cols: [], values: [] }))).toBe(true)
        expect(
            isPivotDefinitionEmpty(
                makeDef({
                    rows: [{ sourceColumn: 'A' }],
                    cols: [],
                    values: [],
                })
            )
        ).toBe(false)
        expect(
            isPivotDefinitionEmpty(
                makeDef({
                    rows: [],
                    cols: [{ sourceColumn: 'A' }],
                    values: [],
                })
            )
        ).toBe(false)
        expect(
            isPivotDefinitionEmpty(
                makeDef({
                    rows: [],
                    cols: [],
                    values: [{ sourceColumn: 'A', aggregation: 'sum' }],
                })
            )
        ).toBe(false)
    })

    it('counts filter-only defs as empty (no value field means nothing to render)', () => {
        const def = makeDef({
            rows: [],
            cols: [],
            values: [],
            filters: [{ sourceColumn: 'Region' }],
        })
        expect(isPivotDefinitionEmpty(def)).toBe(true)
    })
})

describe('selectPivotGridViewState', () => {
    it('returns { kind: "empty" } when the def has no fields, regardless of engine result', () => {
        const emptyDef = makeDef({ rows: [], cols: [], values: [] })
        // Even with a successful engine result, an empty def should
        // route to the configure-your-pivot CTA, not the data grid.
        expect(selectPivotGridViewState(emptyDef, ok(makeRendered())).kind).toBe('empty')
        // Same when the engine errored (the def-empty case takes
        // priority — no point showing "Pivot can't render" when the
        // user has only just created the pivot).
        expect(selectPivotGridViewState(emptyDef, makeError()).kind).toBe('empty')
    })

    it('returns { kind: "error", error } when the def has fields and the engine errored', () => {
        const def = makeDef()
        const err = makeError()
        const view = selectPivotGridViewState(def, err)
        expect(view.kind).toBe('error')
        if (view.kind === 'error') {
            expect(view.error).toBe(err)
        }
    })

    it('returns { kind: "grid", rendered } when the def has fields and the engine succeeded', () => {
        const def = makeDef()
        const rendered = makeRendered()
        const view = selectPivotGridViewState(def, ok(rendered))
        expect(view.kind).toBe('grid')
        if (view.kind === 'grid') {
            expect(view.rendered).toBe(rendered)
        }
    })
})

describe('buildPivotGridCellMatrix', () => {
    it('lays cells out in row-major order, 1-based row/col indices', () => {
        const rendered: RenderedPivot = {
            rows: 2,
            cols: 2,
            headerRowCount: 1,
            headerColCount: 1,
            cells: new Map<string, CellValue>([
                ['1:1', { kind: 'string', raw: '', display: '' }],
                ['1:2', { kind: 'string', raw: 'A', display: 'A' }],
                ['2:1', { kind: 'string', raw: 'B', display: 'B' }],
                ['2:2', { kind: 'number', raw: 7, display: '7' }],
            ]),
        }
        const m = buildPivotGridCellMatrix(rendered)
        expect(m.length).toBe(2)
        expect(m[0].length).toBe(2)
        expect(m[0][0].row).toBe(1)
        expect(m[0][0].col).toBe(1)
        expect(m[1][1].row).toBe(2)
        expect(m[1][1].col).toBe(2)
        expect(m[1][1].display).toBe('7')
    })

    it('flags cells inside the header band (top headerRowCount rows or left headerColCount cols)', () => {
        // headerRowCount=1, headerColCount=1 -> top row is header,
        // leftmost column is header. Bottom-right (2,2) is data.
        const rendered: RenderedPivot = {
            rows: 2,
            cols: 2,
            headerRowCount: 1,
            headerColCount: 1,
            cells: new Map(),
        }
        const m = buildPivotGridCellMatrix(rendered)
        expect(m[0][0].isHeader).toBe(true) // top-left corner
        expect(m[0][1].isHeader).toBe(true) // top row
        expect(m[1][0].isHeader).toBe(true) // left column
        expect(m[1][1].isHeader).toBe(false) // data
    })

    it('falls back to empty display string when a cell entry is missing', () => {
        const rendered: RenderedPivot = {
            rows: 1,
            cols: 2,
            headerRowCount: 1,
            headerColCount: 0,
            cells: new Map<string, CellValue>([
                ['1:1', { kind: 'string', raw: 'hi', display: 'hi' }],
                // 1:2 omitted
            ]),
        }
        const m = buildPivotGridCellMatrix(rendered)
        expect(m[0][0].display).toBe('hi')
        expect(m[0][1].display).toBe('')
    })
})

describe('selectPivotPanelOpen', () => {
    it('returns false when nothing is open', () => {
        expect(selectPivotPanelOpen(null, 'sheet-1')).toBe(false)
    })

    it('returns false when a different sheet is open', () => {
        expect(selectPivotPanelOpen('sheet-2', 'sheet-1')).toBe(false)
    })

    it('returns true when the open sheet matches', () => {
        expect(selectPivotPanelOpen('sheet-1', 'sheet-1')).toBe(true)
    })

    it('treats empty string as a real sheet id (not null)', () => {
        // Defensive: the store's "no panel" sentinel is null, not "".
        // If a caller ever passes "" we want the comparison to follow
        // strict equality so we don't accidentally mount the panel
        // against a sheetless caller.
        expect(selectPivotPanelOpen('', 'sheet-1')).toBe(false)
        expect(selectPivotPanelOpen('', '')).toBe(true)
    })
})

describe('PivotGrid view-state pipeline (with real engine)', () => {
    // Wire the selector against actual computePivot output so a future
    // engine refactor that breaks the discriminated-union shape (or
    // changes the ok/error contract) trips this test.

    function makeSourceCells(): Map<string, CellValue> {
        // 1-based row/col keys are how Y.Doc + the engine name cells.
        const cells = new Map<string, CellValue>()
        const set = (
            r: number,
            c: number,
            raw: string | number,
            display: string,
            kind: 'string' | 'number' = 'string'
        ) => {
            cells.set(`s1:${r}:${c}`, {
                kind,
                raw,
                display,
            } as CellValue)
        }
        set(1, 1, 'Region', 'Region')
        set(1, 2, 'Sales', 'Sales')
        set(2, 1, 'East', 'East')
        set(2, 2, 10, '10', 'number')
        set(3, 1, 'West', 'West')
        set(3, 2, 20, '20', 'number')
        return cells
    }

    it('renders engine output for a valid def', () => {
        // Sanity: engine computes; selector routes to "grid"; cell
        // matrix surfaces the row-label "East" we seeded.
        const sourceCells = makeSourceCells()
        const def = makeDef()
        const result = computePivot(def, sourceCells, { Sheet1: 's1' })
        expect(result.ok).toBe(true)
        const view = selectPivotGridViewState(def, result)
        expect(view.kind).toBe('grid')
        if (view.kind !== 'grid') return
        const matrix = buildPivotGridCellMatrix(view.rendered)
        const allText = matrix.flat().map((m) => m.display)
        expect(allText).toContain('East')
        expect(allText).toContain('Grand Total')
    })

    it('routes to "error" when the source sheet is missing', () => {
        // Empty sheetIdByName -> engine returns missing-source-sheet.
        const def = makeDef({ sourceRange: 'Missing!A1:B3' })
        const result = computePivot(def, new Map(), {})
        expect(result.ok).toBe(false)
        const view = selectPivotGridViewState(def, result)
        expect(view.kind).toBe('error')
    })

    it('routes to "empty" when the def has no fields, even before the engine runs', () => {
        const def = makeDef({ rows: [], cols: [], values: [] })
        // We don't even invoke computePivot here — the selector should
        // short-circuit on def-shape alone. Pass a fake ok-result to
        // prove the def-empty branch wins.
        const view = selectPivotGridViewState(def, ok(makeRendered()))
        expect(view.kind).toBe('empty')
    })
})
