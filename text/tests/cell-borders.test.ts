import { describe, expect, it } from 'vitest'
import {
    bordersAreEmpty,
    bordersToInlineStyle,
    bordersToInlineStyleString,
    type CellBorder,
    type CellBorders,
    DEFAULT_BORDER,
    edgesForPreset,
    EMPTY_BORDERS,
    parseBordersAttr,
} from '../tinycld/text/lib/cell-borders'

const solidEdge: CellBorder = { style: 'solid', widthPx: 1, color: null }
const dashedEdge: CellBorder = { style: 'dashed', widthPx: 2, color: '#ff0000' }

describe('edgesForPreset', () => {
    const range = { startRow: 0, endRow: 2, startCol: 0, endCol: 2 }

    it('all → every edge', () => {
        const out = edgesForPreset('all', { row: 1, col: 1 }, range, solidEdge)
        expect(out).toEqual({
            top: solidEdge,
            right: solidEdge,
            bottom: solidEdge,
            left: solidEdge,
        })
    })

    it('outer corner cell → only outer-touching edges', () => {
        const out = edgesForPreset('outer', { row: 0, col: 0 }, range, solidEdge)
        expect(out).toEqual({ top: solidEdge, left: solidEdge })
    })

    it('inner middle cell → all four edges', () => {
        const out = edgesForPreset('inner', { row: 1, col: 1 }, range, solidEdge)
        expect(out).toEqual({
            top: solidEdge,
            right: solidEdge,
            bottom: solidEdge,
            left: solidEdge,
        })
    })

    it("inner corner cell → only the edges that border another cell", () => {
        const out = edgesForPreset('inner', { row: 0, col: 0 }, range, solidEdge)
        expect(out).toEqual({ right: solidEdge, bottom: solidEdge })
    })

    it('horizontal middle cell → top + bottom only', () => {
        const out = edgesForPreset('horizontal', { row: 1, col: 1 }, range, solidEdge)
        expect(out).toEqual({ top: solidEdge, bottom: solidEdge })
    })

    it('vertical middle cell → left + right only', () => {
        const out = edgesForPreset('vertical', { row: 1, col: 1 }, range, solidEdge)
        expect(out).toEqual({ left: solidEdge, right: solidEdge })
    })

    it('top → only the top row gets a top edge', () => {
        expect(edgesForPreset('top', { row: 0, col: 1 }, range, solidEdge)).toEqual({
            top: solidEdge,
        })
        expect(edgesForPreset('top', { row: 1, col: 1 }, range, solidEdge)).toEqual({})
    })

    it("none → emits style='none' on every edge so the cell drops its default border", () => {
        const out = edgesForPreset('none', { row: 1, col: 1 }, range, solidEdge)
        const noneEdge = { style: 'none', widthPx: 0, color: null }
        expect(out).toEqual({
            top: noneEdge,
            right: noneEdge,
            bottom: noneEdge,
            left: noneEdge,
        })
    })

    it('single-cell range: outer == all', () => {
        const oneCell = { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }
        const out = edgesForPreset('outer', { row: 0, col: 0 }, oneCell, solidEdge)
        expect(out).toEqual({
            top: solidEdge,
            right: solidEdge,
            bottom: solidEdge,
            left: solidEdge,
        })
    })

    it('single-cell range: inner is a no-op', () => {
        const oneCell = { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }
        const out = edgesForPreset('inner', { row: 0, col: 0 }, oneCell, solidEdge)
        expect(out).toEqual({})
    })
})

describe('bordersToInlineStyle', () => {
    it('returns an empty object for null/empty borders', () => {
        expect(bordersToInlineStyle(null)).toEqual({})
        expect(bordersToInlineStyle(EMPTY_BORDERS)).toEqual({})
    })

    it('emits border-top/right/bottom/left as inline CSS keys', () => {
        const borders: CellBorders = {
            top: dashedEdge,
            right: null,
            bottom: null,
            left: solidEdge,
        }
        expect(bordersToInlineStyle(borders)).toEqual({
            borderTop: '2px dashed #ff0000',
            borderLeft: '1px solid currentColor',
        })
    })

    it("style='none' produces border-X: none, beating the default rule", () => {
        const borders: CellBorders = {
            top: { style: 'none', widthPx: 0, color: null },
            right: null,
            bottom: null,
            left: null,
        }
        expect(bordersToInlineStyle(borders)).toEqual({ borderTop: 'none' })
    })
})

describe('bordersToInlineStyleString round-trip', () => {
    it('produces a parsable style string', () => {
        const borders: CellBorders = {
            top: dashedEdge,
            right: null,
            bottom: null,
            left: null,
        }
        const s = bordersToInlineStyleString(borders)
        expect(s).toBe('border-top: 2px dashed #ff0000')
    })
})

describe('parseBordersAttr', () => {
    it('returns null for empty input', () => {
        expect(parseBordersAttr(null)).toBeNull()
        expect(parseBordersAttr('')).toBeNull()
    })

    it('round-trips a borders JSON blob', () => {
        const borders: CellBorders = {
            top: dashedEdge,
            right: null,
            bottom: solidEdge,
            left: null,
        }
        const json = JSON.stringify(borders)
        const parsed = parseBordersAttr(json)
        expect(parsed).toEqual(borders)
    })

    it('drops edges with an unknown style', () => {
        const json = JSON.stringify({
            top: { style: 'mystery', widthPx: 1, color: null },
            right: null,
            bottom: null,
            left: null,
        })
        const parsed = parseBordersAttr(json)
        // unknown style → that edge collapses to null
        expect(parsed?.top).toBeNull()
    })
})

describe('bordersAreEmpty', () => {
    it('treats null and an all-null map as empty', () => {
        expect(bordersAreEmpty(null)).toBe(true)
        expect(bordersAreEmpty(EMPTY_BORDERS)).toBe(true)
    })
    it("treats any non-null edge as non-empty (even style='none')", () => {
        const borders: CellBorders = {
            top: { style: 'none', widthPx: 0, color: null },
            right: null,
            bottom: null,
            left: null,
        }
        expect(bordersAreEmpty(borders)).toBe(false)
    })
})

describe('DEFAULT_BORDER', () => {
    it('is a 1px solid edge with no explicit color', () => {
        expect(DEFAULT_BORDER).toEqual({ style: 'solid', widthPx: 1, color: null })
    })
})
