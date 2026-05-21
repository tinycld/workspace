import { describe, expect, it } from 'vitest'
import {
    cellInRange,
    parseSheetRange,
    parseSheetRanges,
} from '../tinycld/calc/lib/conditional-format/a1'
import {
    buildRuleRangeIndex,
    filterRulesForCell,
} from '../tinycld/calc/lib/conditional-format/range-index'
import type { CFRule } from '../tinycld/calc/lib/conditional-format/types'

describe('parseSheetRange', () => {
    it('single-cell anchor', () => {
        expect(parseSheetRange('A1')).toEqual({
            startRow: 1,
            startCol: 1,
            endRow: 1,
            endCol: 1,
        })
    })
    it('rectangle', () => {
        expect(parseSheetRange('A1:C3')).toEqual({
            startRow: 1,
            startCol: 1,
            endRow: 3,
            endCol: 3,
        })
    })
    it('reversed corners normalize', () => {
        expect(parseSheetRange('C3:A1')).toEqual({
            startRow: 1,
            startCol: 1,
            endRow: 3,
            endCol: 3,
        })
    })
    it('full-column range', () => {
        const r = parseSheetRange('B:B')
        expect(r?.startCol).toBe(2)
        expect(r?.endCol).toBe(2)
        expect(r?.startRow).toBe(1)
        expect(r && r.endRow > 1_000_000).toBe(true)
    })
    it('full-row range', () => {
        const r = parseSheetRange('5:5')
        expect(r?.startRow).toBe(5)
        expect(r?.endRow).toBe(5)
        expect(r?.startCol).toBe(1)
        expect(r && r.endCol >= 16384).toBe(true)
    })
    it('strips $ anchors', () => {
        expect(parseSheetRange('$A$1:$C$3')).toEqual({
            startRow: 1,
            startCol: 1,
            endRow: 3,
            endCol: 3,
        })
    })
    it('rejects garbage', () => {
        expect(parseSheetRange('')).toBeNull()
        expect(parseSheetRange('not a range')).toBeNull()
        expect(parseSheetRange('A1:')).toBeNull()
    })
})

describe('parseSheetRanges', () => {
    it('comma-separated', () => {
        const r = parseSheetRanges('A1:A10, C1:C10')
        expect(r).toHaveLength(2)
    })
    it('any malformed segment rejects the whole thing', () => {
        expect(parseSheetRanges('A1, garbage')).toBeNull()
    })
})

describe('cellInRange', () => {
    const range = { startRow: 2, startCol: 2, endRow: 4, endCol: 4 }
    it('cells inside', () => {
        expect(cellInRange(range, 2, 2)).toBe(true)
        expect(cellInRange(range, 4, 4)).toBe(true)
        expect(cellInRange(range, 3, 3)).toBe(true)
    })
    it('cells outside', () => {
        expect(cellInRange(range, 1, 2)).toBe(false)
        expect(cellInRange(range, 5, 5)).toBe(false)
    })
})

describe('filterRulesForCell', () => {
    const rules: CFRule[] = [
        {
            id: 'a',
            ranges: ['A1:A10'],
            condition: { type: 'isNotEmpty' },
            style: {},
        },
        {
            id: 'b',
            ranges: ['B:B', 'D1:D5'],
            condition: { type: 'isNotEmpty' },
            style: {},
        },
        {
            id: 'c',
            ranges: ['1:1'],
            condition: { type: 'isNotEmpty' },
            style: {},
        },
    ]
    const index = buildRuleRangeIndex(rules)

    it('returns rules that contain the cell, in priority order', () => {
        const matches = filterRulesForCell(index, 1, 1)
        expect(matches.map((r) => r.id)).toEqual(['a', 'c'])
    })
    it('multi-range rule matches via any of its ranges', () => {
        const matches = filterRulesForCell(index, 3, 4)
        expect(matches.map((r) => r.id)).toEqual(['b'])
    })
    it('returns empty when no rules match', () => {
        expect(filterRulesForCell(index, 20, 20)).toEqual([])
    })
})

describe('buildRuleRangeIndex', () => {
    it('skips rules whose ranges all fail to parse', () => {
        const index = buildRuleRangeIndex([
            { id: 'bad', ranges: ['', 'garbage'], condition: { type: 'isEmpty' }, style: {} },
        ])
        expect(index).toHaveLength(0)
    })
    it('preserves rule order', () => {
        const index = buildRuleRangeIndex([
            { id: 'second', ranges: ['A:A'], condition: { type: 'isEmpty' }, style: {} },
            { id: 'first', ranges: ['B:B'], condition: { type: 'isEmpty' }, style: {} },
        ])
        expect(index.map((e) => e.rule.id)).toEqual(['second', 'first'])
    })
})
