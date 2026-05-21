import { describe, expect, it } from 'vitest'
import { computeHandlePositions } from '../tinycld/calc/components/grid/selection-edge-handles-math'

describe('computeHandlePositions', () => {
    it('returns null for an unanchored selection', () => {
        const colOffsets = new Float64Array([0, 80, 160])
        const rowOffsets = new Float64Array([0, 20, 40])
        expect(computeHandlePositions(null, colOffsets, rowOffsets)).toBeNull()
    })

    it('returns corner coordinates for a single-cell selection', () => {
        const colOffsets = new Float64Array([0, 80, 160])
        const rowOffsets = new Float64Array([0, 20, 40])
        const range = { startRow: 1, startCol: 1, endRow: 1, endCol: 1 }
        const pos = computeHandlePositions(range, colOffsets, rowOffsets)
        expect(pos).toEqual({ left: 0, right: 80, top: 0, bottom: 20 })
    })

    it('returns corner coordinates for a multi-cell selection', () => {
        const colOffsets = new Float64Array([0, 80, 160, 240])
        const rowOffsets = new Float64Array([0, 20, 40, 60])
        const range = { startRow: 1, startCol: 1, endRow: 2, endCol: 2 }
        const pos = computeHandlePositions(range, colOffsets, rowOffsets)
        expect(pos).toEqual({ left: 0, right: 160, top: 0, bottom: 40 })
    })

    it('returns null when the rect collapses to zero width', () => {
        const colOffsets = new Float64Array([0, 0, 80])
        const rowOffsets = new Float64Array([0, 20])
        const range = { startRow: 1, startCol: 1, endRow: 1, endCol: 1 }
        expect(computeHandlePositions(range, colOffsets, rowOffsets)).toBeNull()
    })

    it('returns null when the rect collapses to zero height', () => {
        const colOffsets = new Float64Array([0, 80])
        const rowOffsets = new Float64Array([0, 0, 20])
        const range = { startRow: 1, startCol: 1, endRow: 1, endCol: 1 }
        expect(computeHandlePositions(range, colOffsets, rowOffsets)).toBeNull()
    })
})
