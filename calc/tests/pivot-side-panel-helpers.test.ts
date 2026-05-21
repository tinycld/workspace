// Tests for the pure helpers behind PivotSidePanel. The component
// itself (PivotSidePanel.tsx) imports react-native, which vitest
// can't parse during the import phase (Flow types) — the helpers
// live in pivot-side-panel-helpers.ts so we can exercise them
// directly here. Same pattern as pivot-banner-lines.ts /
// pivot-grid-view-state.ts / field-row-helpers.ts.
//
// What we verify:
//   - readSourceMetadata pulls headers out of row 1 of the source
//     range and emits one distinct-value list per column (sorted,
//     deduped via Set semantics, capped at PIVOT_SOURCE_DISTINCT_CAP)
//   - readSourceMetadata returns empty results — not a throw — when
//     the range is malformed or the source sheet is missing, because
//     the side panel renders alongside a PivotBanner that already
//     surfaces the engine-side error
//   - canMoveUp / canMoveDown are exactly the edge predicates used
//     to disable the up/down chevrons on field rows

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    PIVOT_SOURCE_DISTINCT_CAP,
    canMoveDown,
    canMoveUp,
    readSourceMetadata,
} from '../tinycld/calc/components/pivot/pivot-side-panel-helpers'
import type { PivotDefinition } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    CELLS_MAP,
    PIVOT_SHEET_KEY,
    SHEETS_MAP,
} from '../tinycld/calc/lib/y-doc-bootstrap'

interface SeedCell {
    row: number
    col: number
    raw: unknown
    display: string
    kind?: string
}

function setCell(
    cells: Y.Map<Y.Map<unknown>>,
    sheetId: string,
    spec: SeedCell
): void {
    const m = new Y.Map<unknown>()
    m.set('kind', spec.kind ?? 'string')
    m.set('raw', spec.raw)
    m.set('display', spec.display)
    cells.set(yCellKey(sheetId, spec.row, spec.col), m)
}

function seedSheet(
    doc: Y.Doc,
    sheetId: string,
    name: string,
    position: number,
    pivotId?: string
): void {
    const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', name)
    meta.set('position', position)
    if (pivotId != null) meta.set(PIVOT_SHEET_KEY, pivotId)
    sheets.set(sheetId, meta)
}

function baseDef(overrides: Partial<PivotDefinition> = {}): PivotDefinition {
    return {
        id: 'p1',
        sourceRange: 'Sheet1!A1:B3',
        targetSheetName: 'Pivot of Sheet1',
        rows: [],
        cols: [],
        values: [],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...overrides,
    }
}

describe('readSourceMetadata / headers', () => {
    it('reads the header row out of row 1 of the source range', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            setCell(cells, 's1', { row: 1, col: 1, raw: 'Region', display: 'Region' })
            setCell(cells, 's1', { row: 1, col: 2, raw: 'Sales', display: 'Sales' })
            setCell(cells, 's1', { row: 2, col: 1, raw: 'East', display: 'East' })
            setCell(cells, 's1', { row: 2, col: 2, raw: 10, display: '10', kind: 'number' })
        })

        const { headers } = readSourceMetadata(doc, baseDef({ sourceRange: 'Sheet1!A1:B2' }))
        expect(headers).toEqual(['Region', 'Sales'])
    })

    it('returns empty header list when the source range is malformed', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const { headers, distinctByColumn } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'not a range' })
        )
        expect(headers).toEqual([])
        expect(distinctByColumn).toEqual({})
    })

    it('returns empty header list when the source sheet is missing', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'OtherSheet', 0)
        const { headers, distinctByColumn } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'Sheet1!A1:B2' })
        )
        expect(headers).toEqual([])
        expect(distinctByColumn).toEqual({})
    })

    it('uses an empty string for missing header cells (preserves column ordering)', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            // Only col 1 has a header; col 2 has data but no header.
            setCell(cells, 's1', { row: 1, col: 1, raw: 'Region', display: 'Region' })
            setCell(cells, 's1', { row: 2, col: 2, raw: 'E', display: 'E' })
        })
        const { headers } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'Sheet1!A1:B2' })
        )
        expect(headers).toEqual(['Region', ''])
    })

    it('coerces numeric headers to their string form via raw', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            setCell(cells, 's1', {
                row: 1,
                col: 1,
                raw: 2024,
                display: '2024',
                kind: 'number',
            })
        })
        const { headers } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'Sheet1!A1:A2' })
        )
        expect(headers).toEqual(['2024'])
    })
})

describe('readSourceMetadata / distinctByColumn', () => {
    it('extracts distinct values per column (sorted, deduped)', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            setCell(cells, 's1', { row: 1, col: 1, raw: 'Region', display: 'Region' })
            setCell(cells, 's1', { row: 2, col: 1, raw: 'West', display: 'West' })
            setCell(cells, 's1', { row: 3, col: 1, raw: 'East', display: 'East' })
            setCell(cells, 's1', { row: 4, col: 1, raw: 'West', display: 'West' })
        })
        const { distinctByColumn } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'Sheet1!A1:A4' })
        )
        expect(distinctByColumn).toEqual({ Region: ['East', 'West'] })
    })

    it('skips missing cells without breaking the scan', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            setCell(cells, 's1', { row: 1, col: 1, raw: 'Region', display: 'Region' })
            setCell(cells, 's1', { row: 2, col: 1, raw: 'East', display: 'East' })
            // row 3, col 1: intentionally absent
            setCell(cells, 's1', { row: 4, col: 1, raw: 'West', display: 'West' })
        })
        const { distinctByColumn } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'Sheet1!A1:A4' })
        )
        expect(distinctByColumn).toEqual({ Region: ['East', 'West'] })
    })

    it('caps the distinct-values scan at PIVOT_SOURCE_DISTINCT_CAP', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const rowCount = PIVOT_SOURCE_DISTINCT_CAP + 50
        doc.transact(() => {
            setCell(cells, 's1', { row: 1, col: 1, raw: 'Tag', display: 'Tag' })
            for (let r = 2; r <= rowCount + 1; r++) {
                const v = `v${r - 2}`
                setCell(cells, 's1', { row: r, col: 1, raw: v, display: v })
            }
        })
        const { distinctByColumn } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: `Sheet1!A1:A${rowCount + 1}` })
        )
        expect(distinctByColumn.Tag).toHaveLength(PIVOT_SOURCE_DISTINCT_CAP)
    })

    it('emits one distinct-list entry per header, keyed by header text', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 's1', 'Sheet1', 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            setCell(cells, 's1', { row: 1, col: 1, raw: 'Region', display: 'Region' })
            setCell(cells, 's1', { row: 1, col: 2, raw: 'Sales', display: 'Sales' })
            setCell(cells, 's1', { row: 2, col: 1, raw: 'East', display: 'East' })
            setCell(cells, 's1', { row: 2, col: 2, raw: 10, display: '10', kind: 'number' })
            setCell(cells, 's1', { row: 3, col: 1, raw: 'West', display: 'West' })
            setCell(cells, 's1', { row: 3, col: 2, raw: 20, display: '20', kind: 'number' })
        })
        const { distinctByColumn } = readSourceMetadata(
            doc,
            baseDef({ sourceRange: 'Sheet1!A1:B3' })
        )
        expect(Object.keys(distinctByColumn).sort()).toEqual(['Region', 'Sales'])
        expect(distinctByColumn.Region).toEqual(['East', 'West'])
        expect(distinctByColumn.Sales).toEqual(['10', '20'])
    })
})

describe('canMoveUp / canMoveDown', () => {
    it('disables move-up at the top of the list', () => {
        expect(canMoveUp(0)).toBe(false)
        expect(canMoveUp(1)).toBe(true)
        expect(canMoveUp(5)).toBe(true)
    })

    it('disables move-down at the bottom of the list', () => {
        expect(canMoveDown(0, 1)).toBe(false)
        expect(canMoveDown(0, 2)).toBe(true)
        expect(canMoveDown(2, 3)).toBe(false)
        expect(canMoveDown(1, 3)).toBe(true)
    })

    it('disables both edges when the list has one item', () => {
        expect(canMoveUp(0)).toBe(false)
        expect(canMoveDown(0, 1)).toBe(false)
    })
})
