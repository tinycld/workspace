import { describe, expect, it } from 'vitest'
import {
    applyCellRefInsertion,
    extendCellRefInsertion,
    formatRange,
    formatRef,
    isRefAcceptable,
} from '../tinycld/calc/lib/formula/cell-ref-insertion'

describe('isRefAcceptable', () => {
    it('false when draft does not start with =', () => {
        expect(isRefAcceptable('A1', 2)).toBe(false)
    })

    it('true right after =', () => {
        expect(isRefAcceptable('=', 1)).toBe(true)
    })

    it('true after open paren', () => {
        expect(isRefAcceptable('=SUM(', 5)).toBe(true)
    })

    it('true after comma', () => {
        expect(isRefAcceptable('=SUM(A1,', 8)).toBe(true)
    })

    it('true after a colon (extending a range)', () => {
        expect(isRefAcceptable('=A1:', 4)).toBe(true)
    })

    it('true after operators', () => {
        for (const op of ['+', '-', '*', '/', '&', '<', '>']) {
            expect(isRefAcceptable(`=A1${op}`, 4)).toBe(true)
        }
    })

    it('false in the middle of an identifier', () => {
        // "=AB" cursor at end — clicking would make "=ABA1" which is wrong
        expect(isRefAcceptable('=AB', 3)).toBe(false)
    })

    it('false inside a string literal', () => {
        expect(isRefAcceptable('="hi ', 5)).toBe(false)
    })

    it('false at cursor 0', () => {
        expect(isRefAcceptable('=', 0)).toBe(false)
    })
})

describe('formatRef', () => {
    it('produces A1 form', () => {
        expect(formatRef(1, 1)).toBe('A1')
        expect(formatRef(5, 2)).toBe('B5')
        expect(formatRef(1, 27)).toBe('AA1')
    })
})

describe('formatRange', () => {
    it('normalizes corner ordering', () => {
        expect(formatRange({ row: 3, col: 3 }, { row: 1, col: 1 })).toBe('A1:C3')
    })

    it('collapses single-cell range', () => {
        expect(formatRange({ row: 2, col: 2 }, { row: 2, col: 2 })).toBe('B2')
    })
})

describe('applyCellRefInsertion', () => {
    it('inserts at cursor and reports the slice', () => {
        const r = applyCellRefInsertion('=', 1, 'B5')
        expect(r.draft).toBe('=B5')
        expect(r.selection).toEqual({ start: 3, end: 3 })
        expect(r.insertedSlice).toEqual({ start: 1, end: 3 })
    })

    it('preserves text after the cursor', () => {
        const r = applyCellRefInsertion('=+1', 1, 'B5')
        expect(r.draft).toBe('=B5+1')
        expect(r.insertedSlice).toEqual({ start: 1, end: 3 })
    })
})

describe('extendCellRefInsertion', () => {
    it('replaces the previous slice with the new ref', () => {
        // Imagine we already inserted "B5" at slice [1,3]. Now extend to
        // a range "B5:B7".
        const r = extendCellRefInsertion('=B5', { start: 1, end: 3 }, 'B5:B7')
        expect(r.draft).toBe('=B5:B7')
        expect(r.selection).toEqual({ start: 6, end: 6 })
        expect(r.insertedSlice).toEqual({ start: 1, end: 6 })
    })

    it('handles trailing context after the slice', () => {
        const r = extendCellRefInsertion('=B5+1', { start: 1, end: 3 }, 'B5:C7')
        expect(r.draft).toBe('=B5:C7+1')
        expect(r.insertedSlice).toEqual({ start: 1, end: 6 })
    })
})
