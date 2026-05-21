import { describe, expect, it } from 'vitest'
import {
    cellAtPosition,
    clampGridSelection,
    GRID_PICKER_DEFAULT_COLS,
    GRID_PICKER_DEFAULT_ROWS,
    isCellHighlighted,
} from '../tinycld/text/components/table-grid-picker-model'

describe('clampGridSelection', () => {
    it('keeps in-bounds selections as-is', () => {
        expect(clampGridSelection({ row: 3, col: 4 }, 8, 10)).toEqual({ row: 3, col: 4 })
    })
    it('clamps to maxRows/maxCols', () => {
        expect(clampGridSelection({ row: 99, col: 99 }, 8, 10)).toEqual({ row: 8, col: 10 })
    })
    it('clamps to a minimum of 1×1', () => {
        expect(clampGridSelection({ row: 0, col: 0 }, 8, 10)).toEqual({ row: 1, col: 1 })
        expect(clampGridSelection({ row: -5, col: -5 }, 8, 10)).toEqual({ row: 1, col: 1 })
    })
})

describe('isCellHighlighted', () => {
    it('returns false when no selection is active', () => {
        expect(isCellHighlighted({ row: 1, col: 1 }, null)).toBe(false)
    })
    it('lights up every cell up to and including the selection corner', () => {
        const sel = { row: 3, col: 2 }
        expect(isCellHighlighted({ row: 1, col: 1 }, sel)).toBe(true)
        expect(isCellHighlighted({ row: 3, col: 2 }, sel)).toBe(true)
    })
    it('leaves cells outside the rectangle dark', () => {
        const sel = { row: 3, col: 2 }
        expect(isCellHighlighted({ row: 4, col: 2 }, sel)).toBe(false)
        expect(isCellHighlighted({ row: 3, col: 3 }, sel)).toBe(false)
    })
})

describe('cellAtPosition', () => {
    const stride = 20
    it('returns null for negative coordinates', () => {
        expect(cellAtPosition(-1, 5, stride, 8, 10)).toBeNull()
        expect(cellAtPosition(5, -1, stride, 8, 10)).toBeNull()
    })
    it('maps the top-left corner to (1,1)', () => {
        expect(cellAtPosition(0, 0, stride, 8, 10)).toEqual({ row: 1, col: 1 })
        expect(cellAtPosition(stride - 1, stride - 1, stride, 8, 10)).toEqual({ row: 1, col: 1 })
    })
    it('maps the middle of cell (3,5) to that cell', () => {
        expect(cellAtPosition(4 * stride + 5, 2 * stride + 5, stride, 8, 10)).toEqual({
            row: 3,
            col: 5,
        })
    })
    it('returns null beyond the grid bounds', () => {
        expect(cellAtPosition(15 * stride, 0, stride, 8, 10)).toBeNull()
        expect(cellAtPosition(0, 15 * stride, stride, 8, 10)).toBeNull()
    })
    it('returns null for non-positive cellSize', () => {
        expect(cellAtPosition(10, 10, 0, 8, 10)).toBeNull()
        expect(cellAtPosition(10, 10, -1, 8, 10)).toBeNull()
    })
})

describe('default dimensions', () => {
    it('match the canonical 10×8 picker', () => {
        expect(GRID_PICKER_DEFAULT_ROWS).toBe(8)
        expect(GRID_PICKER_DEFAULT_COLS).toBe(10)
    })
})
