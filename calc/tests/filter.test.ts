import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { setYRowHeight } from '../tinycld/calc/lib/dimensions'
import {
    applyFilter,
    applyValuesFilterFromSelection,
    clearFilter,
    distinctValuesForColumn,
    readFilterView,
    removeColumnCriterion,
    upsertColumnCriterion,
} from '../tinycld/calc/lib/filter'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

// seedSheet sets frozenRows: 2 by default so tests that put a header
// label in row 1 (range.startRow = 1) keep the same "header always
// visible" behavior they relied on before the implicit header
// carve-out was dropped. (frozenRows is a count, so 2 protects rows
// 0 and 1.) Tests that want a different freeze line can pass their own.
function seedSheet(doc: Y.Doc, sheetId: string, frozenRows = 2): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', sheetId)
    meta.set('position', 0)
    meta.set('rowCount', 100)
    meta.set('colCount', 10)
    if (frozenRows > 0) meta.set('frozenRows', frozenRows)
    sheetsMap.set(sheetId, meta)
}

function readRowHeight(doc: Y.Doc, sheetId: string, row: number): number | undefined {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    const heights = meta?.get('rowHeights')
    if (!(heights instanceof Y.Map)) return undefined
    const v = heights.get(String(row))
    return typeof v === 'number' ? v : undefined
}

describe('applyFilter', () => {
    it('hides rows that do not match a values criterion', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Cherry')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: { 1: { type: 'values', allowedValues: ['Apple', 'Cherry'] } },
                mode: 'range',
            },
            2
        )

        // Header at row 1 stays visible (frozenRows: 2 protects rows 0–1).
        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        // Banana hidden.
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })

    it('hides rows that fail a "gt" condition', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Score')
        setYCell(doc, 'sheet1', 2, 1, '50')
        setYCell(doc, 'sheet1', 3, 1, '20')
        setYCell(doc, 'sheet1', 4, 1, '90')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: { 1: { type: 'condition', condition: { op: 'gt', values: ['40'] } } },
                mode: 'range',
            },
            2
        )

        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })

    it('contains and isEmpty conditions work', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Name')
        setYCell(doc, 'sheet1', 2, 1, 'Alice')
        setYCell(doc, 'sheet1', 3, 1, 'Albert')
        setYCell(doc, 'sheet1', 4, 1, 'Bob')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: {
                    1: { type: 'condition', condition: { op: 'contains', values: ['Al'] } },
                },
                mode: 'range',
            },
            2
        )
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)

        clearFilter(doc, 'sheet1')

        // isEmpty: hide non-empty.
        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: { 1: { type: 'condition', condition: { op: 'isEmpty' } } },
                mode: 'range',
            },
            2
        )
        expect(readRowHeight(doc, 'sheet1', 2)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)
    })

    it('AND-combines multiple-column criteria', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Name')
        setYCell(doc, 'sheet1', 1, 2, 'Score')
        setYCell(doc, 'sheet1', 2, 1, 'Alice')
        setYCell(doc, 'sheet1', 2, 2, '90')
        setYCell(doc, 'sheet1', 3, 1, 'Alice')
        setYCell(doc, 'sheet1', 3, 2, '20')
        setYCell(doc, 'sheet1', 4, 1, 'Bob')
        setYCell(doc, 'sheet1', 4, 2, '90')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 2 },
                criteria: {
                    1: { type: 'values', allowedValues: ['Alice'] },
                    2: { type: 'condition', condition: { op: 'gt', values: ['50'] } },
                },
                mode: 'range',
            },
            2
        )

        // Only row 2 passes both (Alice with score 90).
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)
    })

    it('clearFilter restores rows including custom heights via savedHeights', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')

        // User set row 3 to a custom height before filtering.
        setYRowHeight(doc, 'sheet1', 3, 60)
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(60)

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
                criteria: { 1: { type: 'values', allowedValues: ['Apple'] } },
                mode: 'range',
            },
            2
        )
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)

        const view = readFilterView(doc, 'sheet1')
        expect(view).not.toBeNull()
        expect(view?.savedHeights[3]).toBe(60)

        clearFilter(doc, 'sheet1')
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(60)
        expect(readFilterView(doc, 'sheet1')).toBeNull()
    })

    it('distinctValuesForColumn returns sorted unique displays excluding header', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Apple')
        setYCell(doc, 'sheet1', 5, 1, 'Cherry')

        const distinct = distinctValuesForColumn(
            doc,
            'sheet1',
            { startRow: 1, endRow: 5, startCol: 1, endCol: 1 },
            1
        )
        expect(distinct).toEqual(['Apple', 'Banana', 'Cherry'])
    })
})

describe('applyValuesFilterFromSelection', () => {
    it('builds per-column values criteria and applies across the whole sheet', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1', 1)
        // Header row.
        setYCell(doc, 'sheet1', 0, 1, 'Name')
        setYCell(doc, 'sheet1', 0, 2, 'Score')
        // Selection rows 1–4: distinct values per column.
        setYCell(doc, 'sheet1', 1, 1, 'Alice')
        setYCell(doc, 'sheet1', 1, 2, '90')
        setYCell(doc, 'sheet1', 2, 1, 'Bob')
        setYCell(doc, 'sheet1', 2, 2, '80')
        setYCell(doc, 'sheet1', 3, 1, 'Alice')
        setYCell(doc, 'sheet1', 3, 2, '70')
        setYCell(doc, 'sheet1', 4, 1, 'Carol')
        setYCell(doc, 'sheet1', 4, 2, '60')
        // Below the selection: should still be evaluated against the
        // selection's distinct values.
        setYCell(doc, 'sheet1', 5, 1, 'Alice')
        setYCell(doc, 'sheet1', 5, 2, '90') // both match → visible
        setYCell(doc, 'sheet1', 6, 1, 'Dave')
        setYCell(doc, 'sheet1', 6, 2, '90') // name not in selection → hidden
        setYCell(doc, 'sheet1', 7, 1, 'Bob')
        setYCell(doc, 'sheet1', 7, 2, '50') // score not in selection → hidden

        applyValuesFilterFromSelection(
            doc,
            'sheet1',
            { startRow: 1, endRow: 4, startCol: 1, endCol: 2 },
            10,
            1
        )

        // Frozen row 0 is protected — never hidden.
        expect(readRowHeight(doc, 'sheet1', 0)).toBeUndefined()
        // Rows 1–4 (the selection) are all visible because their own
        // values were the source of the allowed set.
        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
        // Row 5: both values are in the allowed set.
        expect(readRowHeight(doc, 'sheet1', 5)).toBeUndefined()
        // Row 6: name 'Dave' not in selection → hidden.
        expect(readRowHeight(doc, 'sheet1', 6)).toBe(0)
        // Row 7: score '50' not in selection → hidden.
        expect(readRowHeight(doc, 'sheet1', 7)).toBe(0)
    })

    it('hides rows where one column does not match', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1', 1)
        setYCell(doc, 'sheet1', 0, 1, 'Name')
        setYCell(doc, 'sheet1', 0, 2, 'Score')
        setYCell(doc, 'sheet1', 1, 1, 'Alice')
        setYCell(doc, 'sheet1', 1, 2, '90')
        setYCell(doc, 'sheet1', 2, 1, 'Bob')
        setYCell(doc, 'sheet1', 2, 2, '80')
        // Row 3: name matches selection's set, score doesn't.
        setYCell(doc, 'sheet1', 3, 1, 'Alice')
        setYCell(doc, 'sheet1', 3, 2, '55')

        applyValuesFilterFromSelection(
            doc,
            'sheet1',
            { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
            10,
            1
        )

        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
    })

    it('leaves rows blank in every filtered column visible regardless of allowed set', () => {
        // Regression: when the source selection has no blank cells, the
        // allowed-values set excludes ''. A naive rowMatches would then
        // hide every populated-but-blank row below the source — which
        // makes "Filter from selection across the whole sheet" instantly
        // hide every untouched row and prevent the user from typing
        // into them. rowMatches must treat all-blank-in-filtered-cols
        // rows as visible; only rows with at least one populated
        // filtered-col cell are subject to the criteria check.
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1', 1)
        setYCell(doc, 'sheet1', 0, 1, 'Name')
        // Source rows 1-3 are all non-blank; allowed set is
        // {'Alice', 'Bob', 'Cherry'} with NO '' entry.
        setYCell(doc, 'sheet1', 1, 1, 'Alice')
        setYCell(doc, 'sheet1', 2, 1, 'Bob')
        setYCell(doc, 'sheet1', 3, 1, 'Cherry')
        // Row 5 has a value not in the allowed set — should be hidden.
        setYCell(doc, 'sheet1', 5, 1, 'Eve')
        // Row 7 is blank in the filtered column — should stay visible
        // because the row hasn't been written to yet.

        applyValuesFilterFromSelection(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            10,
            1
        )

        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined() // Alice
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined() // Bob
        expect(readRowHeight(doc, 'sheet1', 3)).toBeUndefined() // Cherry
        // Row 4 is blank — visible (would be hidden under the strict
        // "blank not in allowed set" semantics this rule replaces).
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
        // Row 5 has a populated cell that doesn't match — hidden.
        expect(readRowHeight(doc, 'sheet1', 5)).toBe(0)
        // Rows 6-9 are blank — visible.
        expect(readRowHeight(doc, 'sheet1', 6)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 7)).toBeUndefined()
    })

    it('counts blank cells as a valid value', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1', 1)
        setYCell(doc, 'sheet1', 0, 1, 'Name')
        // Selection includes a blank cell at (2, 1).
        setYCell(doc, 'sheet1', 1, 1, 'Alice')
        // Row 2: no cell set — blank.
        setYCell(doc, 'sheet1', 3, 1, 'Bob') // outside selection
        // Row 4: blank → should remain visible because '' is in the
        // allowed set captured from the selection.
        setYCell(doc, 'sheet1', 5, 1, 'Alice')

        applyValuesFilterFromSelection(
            doc,
            'sheet1',
            { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            10,
            1
        )

        // Allowed values are ['Alice', ''] (blanks included).
        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined() // Alice
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined() // blank
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0) // Bob — not allowed
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined() // blank
        expect(readRowHeight(doc, 'sheet1', 5)).toBeUndefined() // Alice
    })
})

describe('upsertColumnCriterion', () => {
    it('creates a fresh header-mode filterView on first call', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 2, 'Apple')
        setYCell(doc, 'sheet1', 2, 2, 'Banana')

        upsertColumnCriterion(
            doc,
            'sheet1',
            2,
            { type: 'condition', condition: { op: 'eq', values: ['Apple'] } },
            10,
            10,
            1
        )

        const view = readFilterView(doc, 'sheet1')
        expect(view).not.toBeNull()
        expect(view?.mode).toBe('header')
        expect(Object.keys(view?.criteria ?? {})).toEqual(['2'])
        expect(view?.criteria[2]).toEqual({
            type: 'condition',
            condition: { op: 'eq', values: ['Apple'] },
        })
    })

    it('merges a new column criterion and preserves savedHeights', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 2, 'Apple')
        setYCell(doc, 'sheet1', 2, 2, 'Banana')
        setYCell(doc, 'sheet1', 1, 3, 'Red')
        setYCell(doc, 'sheet1', 2, 3, 'Yellow')
        // Custom row height for a row we'll filter out — savedHeights
        // should capture it on the first apply and survive the second.
        setYRowHeight(doc, 'sheet1', 2, 45)

        upsertColumnCriterion(
            doc,
            'sheet1',
            2,
            { type: 'condition', condition: { op: 'eq', values: ['Apple'] } },
            10,
            10,
            1
        )

        const first = readFilterView(doc, 'sheet1')
        expect(first?.savedHeights[2]).toBe(45)

        upsertColumnCriterion(
            doc,
            'sheet1',
            3,
            { type: 'condition', condition: { op: 'eq', values: ['Red'] } },
            10,
            10,
            1
        )

        const view = readFilterView(doc, 'sheet1')
        expect(view?.mode).toBe('header')
        const cols = Object.keys(view?.criteria ?? {}).sort()
        expect(cols).toEqual(['2', '3'])
        // SavedHeights from the first apply are still there.
        expect(view?.savedHeights[2]).toBe(45)
    })

    it('refuses to mutate a range-mode filterView (no-op)', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Apple')
        setYCell(doc, 'sheet1', 2, 1, 'Banana')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
                criteria: { 1: { type: 'values', allowedValues: ['Apple'] } },
                mode: 'range',
            },
            1
        )

        const before = readFilterView(doc, 'sheet1')

        upsertColumnCriterion(
            doc,
            'sheet1',
            2,
            { type: 'condition', condition: { op: 'eq', values: ['X'] } },
            10,
            10,
            1
        )

        const after = readFilterView(doc, 'sheet1')
        expect(after?.mode).toBe('range')
        expect(Object.keys(after?.criteria ?? {})).toEqual(
            Object.keys(before?.criteria ?? {})
        )
    })
})

describe('removeColumnCriterion', () => {
    it('removes one criterion and keeps the filter active when others remain', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 2, 'Apple')
        setYCell(doc, 'sheet1', 2, 2, 'Banana')
        setYCell(doc, 'sheet1', 1, 3, 'Red')
        setYCell(doc, 'sheet1', 2, 3, 'Yellow')

        upsertColumnCriterion(
            doc,
            'sheet1',
            2,
            { type: 'condition', condition: { op: 'eq', values: ['Apple'] } },
            10,
            10,
            1
        )
        upsertColumnCriterion(
            doc,
            'sheet1',
            3,
            { type: 'condition', condition: { op: 'eq', values: ['Red'] } },
            10,
            10,
            1
        )

        removeColumnCriterion(doc, 'sheet1', 2, 1)

        const view = readFilterView(doc, 'sheet1')
        expect(view).not.toBeNull()
        expect(Object.keys(view?.criteria ?? {})).toEqual(['3'])
    })

    it('clears the entire filterView when the last criterion is removed', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 2, 'Apple')
        setYCell(doc, 'sheet1', 2, 2, 'Banana')

        upsertColumnCriterion(
            doc,
            'sheet1',
            2,
            { type: 'condition', condition: { op: 'eq', values: ['Apple'] } },
            10,
            10,
            1
        )

        removeColumnCriterion(doc, 'sheet1', 2, 1)

        expect(readFilterView(doc, 'sheet1')).toBeNull()
    })
})

describe('multi-value condition semantics', () => {
    it('eq with multiple values keeps any matching row visible (OR)', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Cherry')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: {
                    1: {
                        type: 'condition',
                        condition: { op: 'eq', values: ['Apple', 'Banana'] },
                    },
                },
                mode: 'range',
            },
            1
        )

        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)
    })

    it('contains with multiple values OR-combines substring matches', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple') // matches 'App'
        setYCell(doc, 'sheet1', 3, 1, 'Banana') // matches neither
        setYCell(doc, 'sheet1', 4, 1, 'Strawberry') // matches 'ber'

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: {
                    1: {
                        type: 'condition',
                        condition: { op: 'contains', values: ['App', 'ber'] },
                    },
                },
                mode: 'range',
            },
            1
        )

        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })

    it('neq with multiple values AND-of-negations (excludes all listed)', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Cherry')
        setYCell(doc, 'sheet1', 5, 1, 'Date')

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 5, startCol: 1, endCol: 1 },
                criteria: {
                    1: {
                        type: 'condition',
                        condition: { op: 'neq', values: ['Apple', 'Banana'] },
                    },
                },
                mode: 'range',
            },
            1
        )

        expect(readRowHeight(doc, 'sheet1', 2)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 5)).toBeUndefined()
    })

    it('gt with multiple values OR-combines numeric comparisons', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Score')
        setYCell(doc, 'sheet1', 2, 1, '40') // not > 50 and not > 80 → hidden
        setYCell(doc, 'sheet1', 3, 1, '60') // > 50 → visible
        setYCell(doc, 'sheet1', 4, 1, '90') // > 50 and > 80 → visible

        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
                criteria: {
                    1: {
                        type: 'condition',
                        condition: { op: 'gt', values: ['50', '80'] },
                    },
                },
                mode: 'range',
            },
            1
        )

        expect(readRowHeight(doc, 'sheet1', 2)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 3)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })
})

describe('wire-format back-compat', () => {
    it('criterionFromYMap reads old single-value condition as one-element values array', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')

        // Hand-build a filterView with the legacy single-`value` shape
        // a pre-redesign doc would have written.
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = sheetsMap.get('sheet1')
        if (meta == null) throw new Error('seed failed')

        const view = new Y.Map<unknown>()
        const range = new Y.Map<unknown>()
        range.set('startRow', 1)
        range.set('endRow', 2)
        range.set('startCol', 1)
        range.set('endCol', 1)
        view.set('range', range)
        const critMap = new Y.Map<unknown>()
        const critEntry = new Y.Map<unknown>()
        critEntry.set('type', 'condition')
        const cond = new Y.Map<unknown>()
        cond.set('op', 'eq')
        cond.set('value', 'Apple') // legacy single-value field
        critEntry.set('condition', cond)
        critMap.set('1', critEntry)
        view.set('criteria', critMap)
        meta.set('filterView', view)

        const read = readFilterView(doc, 'sheet1')
        expect(read).not.toBeNull()
        const criterion = read?.criteria[1]
        expect(criterion?.type).toBe('condition')
        if (criterion?.type === 'condition' && 'values' in criterion.condition) {
            expect(criterion.condition.op).toBe('eq')
            expect(criterion.condition.values).toEqual(['Apple'])
        } else {
            throw new Error('expected condition with values')
        }
    })
})

describe('frozen-row protection', () => {
    it('does not hide any row r < frozenRows even when criterion would exclude it', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1', 2)
        setYCell(doc, 'sheet1', 0, 1, 'TitleRow')
        setYCell(doc, 'sheet1', 1, 1, 'Subheader')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Cherry')

        // Criterion excludes 'TitleRow' and 'Subheader' (and Banana).
        applyFilter(
            doc,
            'sheet1',
            {
                range: { startRow: 0, endRow: 4, startCol: 1, endCol: 1 },
                criteria: { 1: { type: 'values', allowedValues: ['Apple', 'Cherry'] } },
                mode: 'range',
            },
            2
        )

        // Frozen rows 0 and 1: protected, never hidden.
        expect(readRowHeight(doc, 'sheet1', 0)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined()
        // Row 2: Apple → visible.
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        // Row 3: Banana → hidden.
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        // Row 4: Cherry → visible.
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })
})
