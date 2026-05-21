import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { CellRange } from '../tinycld/calc/hooks/grid-store'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { applyBorderPreset, resolveBorderPatch } from '../tinycld/calc/lib/border-presets'
import type { CellBorderEdge } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

function readBorders(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)?.borders
}

const range3x3: CellRange = { startRow: 2, endRow: 4, startCol: 2, endCol: 4 }
const range1x1: CellRange = { startRow: 1, endRow: 1, startCol: 1, endCol: 1 }

const blackThin: CellBorderEdge = { style: 'thin', color: '#000000' }
const redDashed: CellBorderEdge = { style: 'dashed', color: '#FF0000' }

describe('resolveBorderPatch — all', () => {
    it('every cell gets all four edges set to the picker edge', () => {
        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                expect(resolveBorderPatch('all', range3x3, r, c, blackThin)).toEqual({
                    top: blackThin,
                    right: blackThin,
                    bottom: blackThin,
                    left: blackThin,
                })
            }
        }
    })

    it('forwards the picker color and line style to every edge', () => {
        const patch = resolveBorderPatch('all', range3x3, 2, 2, redDashed)
        expect(patch?.top).toEqual(redDashed)
        expect(patch?.right).toEqual(redDashed)
    })
})

describe('resolveBorderPatch — none', () => {
    it('every cell gets all four edges false', () => {
        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                expect(resolveBorderPatch('none', range3x3, r, c, blackThin)).toEqual({
                    top: false,
                    right: false,
                    bottom: false,
                    left: false,
                })
            }
        }
    })
})

describe('resolveBorderPatch — outer', () => {
    it('top-left corner cell gets only top + left', () => {
        expect(resolveBorderPatch('outer', range3x3, 2, 2, blackThin)).toEqual({
            top: blackThin,
            left: blackThin,
        })
    })

    it('top-right corner cell gets only top + right', () => {
        expect(resolveBorderPatch('outer', range3x3, 2, 4, blackThin)).toEqual({
            top: blackThin,
            right: blackThin,
        })
    })

    it('bottom-left corner cell gets only bottom + left', () => {
        expect(resolveBorderPatch('outer', range3x3, 4, 2, blackThin)).toEqual({
            bottom: blackThin,
            left: blackThin,
        })
    })

    it('bottom-right corner cell gets only bottom + right', () => {
        expect(resolveBorderPatch('outer', range3x3, 4, 4, blackThin)).toEqual({
            bottom: blackThin,
            right: blackThin,
        })
    })

    it('top edge non-corner cell gets only top', () => {
        expect(resolveBorderPatch('outer', range3x3, 2, 3, blackThin)).toEqual({
            top: blackThin,
        })
    })

    it('bottom edge non-corner cell gets only bottom', () => {
        expect(resolveBorderPatch('outer', range3x3, 4, 3, blackThin)).toEqual({
            bottom: blackThin,
        })
    })

    it('left edge non-corner cell gets only left', () => {
        expect(resolveBorderPatch('outer', range3x3, 3, 2, blackThin)).toEqual({
            left: blackThin,
        })
    })

    it('right edge non-corner cell gets only right', () => {
        expect(resolveBorderPatch('outer', range3x3, 3, 4, blackThin)).toEqual({
            right: blackThin,
        })
    })

    it('interior cell returns null (no patch — preserve existing borders)', () => {
        expect(resolveBorderPatch('outer', range3x3, 3, 3, blackThin)).toBeNull()
    })

    it('1x1 range gets all four edges (every side faces outward)', () => {
        expect(resolveBorderPatch('outer', range1x1, 1, 1, blackThin)).toEqual({
            top: blackThin,
            right: blackThin,
            bottom: blackThin,
            left: blackThin,
        })
    })
})

describe('resolveBorderPatch — top / bottom / left / right', () => {
    it('top row cells get only top', () => {
        expect(resolveBorderPatch('top', range3x3, 2, 2, blackThin)).toEqual({ top: blackThin })
        expect(resolveBorderPatch('top', range3x3, 2, 3, blackThin)).toEqual({ top: blackThin })
        expect(resolveBorderPatch('top', range3x3, 2, 4, blackThin)).toEqual({ top: blackThin })
    })

    it('non-top rows return null for the top preset', () => {
        expect(resolveBorderPatch('top', range3x3, 3, 3, blackThin)).toBeNull()
        expect(resolveBorderPatch('top', range3x3, 4, 2, blackThin)).toBeNull()
    })

    it('bottom row cells get only bottom', () => {
        expect(resolveBorderPatch('bottom', range3x3, 4, 2, blackThin)).toEqual({
            bottom: blackThin,
        })
    })

    it('left column cells get only left', () => {
        expect(resolveBorderPatch('left', range3x3, 3, 2, blackThin)).toEqual({
            left: blackThin,
        })
        expect(resolveBorderPatch('left', range3x3, 3, 3, blackThin)).toBeNull()
    })

    it('right column cells get only right', () => {
        expect(resolveBorderPatch('right', range3x3, 3, 4, blackThin)).toEqual({
            right: blackThin,
        })
        expect(resolveBorderPatch('right', range3x3, 3, 3, blackThin)).toBeNull()
    })
})

describe('resolveBorderPatch — inner', () => {
    it('center cell of a 3x3 gets all four interior edges', () => {
        expect(resolveBorderPatch('inner', range3x3, 3, 3, blackThin)).toEqual({
            top: blackThin,
            right: blackThin,
            bottom: blackThin,
            left: blackThin,
        })
    })

    it('top-left corner contributes only the inward-facing edges', () => {
        expect(resolveBorderPatch('inner', range3x3, 2, 2, blackThin)).toEqual({
            right: blackThin,
            bottom: blackThin,
        })
    })

    it('top-right corner gets only bottom + left', () => {
        expect(resolveBorderPatch('inner', range3x3, 2, 4, blackThin)).toEqual({
            bottom: blackThin,
            left: blackThin,
        })
    })

    it('1x1 range yields no inner patch', () => {
        expect(resolveBorderPatch('inner', range1x1, 1, 1, blackThin)).toBeNull()
    })
})

describe('resolveBorderPatch — innerH', () => {
    it('top-row cell gets only bottom (inward horizontal)', () => {
        expect(resolveBorderPatch('innerH', range3x3, 2, 3, blackThin)).toEqual({
            bottom: blackThin,
        })
    })

    it('middle-row cell gets both top and bottom', () => {
        expect(resolveBorderPatch('innerH', range3x3, 3, 3, blackThin)).toEqual({
            top: blackThin,
            bottom: blackThin,
        })
    })

    it('bottom-row cell gets only top', () => {
        expect(resolveBorderPatch('innerH', range3x3, 4, 3, blackThin)).toEqual({
            top: blackThin,
        })
    })
})

describe('resolveBorderPatch — innerV', () => {
    it('left-col cell gets only right', () => {
        expect(resolveBorderPatch('innerV', range3x3, 3, 2, blackThin)).toEqual({
            right: blackThin,
        })
    })

    it('middle-col cell gets both left and right', () => {
        expect(resolveBorderPatch('innerV', range3x3, 3, 3, blackThin)).toEqual({
            left: blackThin,
            right: blackThin,
        })
    })

    it('right-col cell gets only left', () => {
        expect(resolveBorderPatch('innerV', range3x3, 3, 4, blackThin)).toEqual({
            left: blackThin,
        })
    })
})

describe('applyBorderPreset — outer preserves interior borders', () => {
    it('does not touch a pre-existing interior border when applying outer', () => {
        const doc = new Y.Doc()
        // Pre-existing user-set border on the interior cell.
        setYCellStyle(doc, 'sheet1', 3, 3, {
            borders: {
                top: blackThin,
                right: blackThin,
                bottom: blackThin,
                left: blackThin,
            },
        })
        applyBorderPreset(doc, 'sheet1', range3x3, 'outer', blackThin)

        const interior = readBorders(doc, 'sheet1', 3, 3)
        expect(interior?.top).toEqual(blackThin)
        expect(interior?.right).toEqual(blackThin)
        expect(interior?.bottom).toEqual(blackThin)
        expect(interior?.left).toEqual(blackThin)
    })

    it('outer paints only the perimeter edges on a 3x3 range', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'outer', blackThin)

        // Top-left corner.
        const tl = readBorders(doc, 'sheet1', 2, 2)
        expect(tl?.top).toEqual(blackThin)
        expect(tl?.left).toEqual(blackThin)
        // Top-edge middle.
        const topMid = readBorders(doc, 'sheet1', 2, 3)
        expect(topMid?.top).toEqual(blackThin)
        expect(topMid?.bottom).toBeUndefined()
        expect(topMid?.left).toBeUndefined()
        // Bottom-right corner.
        const br = readBorders(doc, 'sheet1', 4, 4)
        expect(br?.bottom).toEqual(blackThin)
        expect(br?.right).toEqual(blackThin)
        // Interior cell — never written, so no style entry exists.
        expect(readBorders(doc, 'sheet1', 3, 3)).toBeUndefined()
    })

    it('forwards the picker edge (color + line style) to written cells', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'all', redDashed)
        const center = readBorders(doc, 'sheet1', 3, 3)
        expect(center?.top).toEqual(redDashed)
        expect(center?.right).toEqual(redDashed)
        expect(center?.bottom).toEqual(redDashed)
        expect(center?.left).toEqual(redDashed)
    })
})

describe('applyBorderPreset — none clears every cell', () => {
    it('clears all four edges on every cell in the range, even interior', () => {
        const doc = new Y.Doc()
        // Seed every cell with a full border.
        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                setYCellStyle(doc, 'sheet1', r, c, {
                    borders: {
                        top: blackThin,
                        right: blackThin,
                        bottom: blackThin,
                        left: blackThin,
                    },
                })
            }
        }
        applyBorderPreset(doc, 'sheet1', range3x3, 'none', blackThin)

        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                const b = readBorders(doc, 'sheet1', r, c)
                expect(b?.top).toBe(false)
                expect(b?.right).toBe(false)
                expect(b?.bottom).toBe(false)
                expect(b?.left).toBe(false)
            }
        }
    })
})

describe('applyBorderPreset — top/bottom only paint the edge row', () => {
    it('top paints only the top row', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'top', blackThin)
        expect(readBorders(doc, 'sheet1', 2, 2)?.top).toEqual(blackThin)
        expect(readBorders(doc, 'sheet1', 2, 4)?.top).toEqual(blackThin)
        expect(readBorders(doc, 'sheet1', 3, 3)).toBeUndefined()
        expect(readBorders(doc, 'sheet1', 4, 4)).toBeUndefined()
    })

    it('bottom paints only the bottom row', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'bottom', blackThin)
        expect(readBorders(doc, 'sheet1', 4, 2)?.bottom).toEqual(blackThin)
        expect(readBorders(doc, 'sheet1', 4, 4)?.bottom).toEqual(blackThin)
        expect(readBorders(doc, 'sheet1', 3, 3)).toBeUndefined()
        expect(readBorders(doc, 'sheet1', 2, 2)).toBeUndefined()
    })
})

describe('applyBorderPreset — inner', () => {
    it('inner paints only the interior crosshair', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'inner', blackThin)
        // Center cell — gets all four (its sides face other range cells).
        const center = readBorders(doc, 'sheet1', 3, 3)
        expect(center?.top).toEqual(blackThin)
        expect(center?.bottom).toEqual(blackThin)
        expect(center?.left).toEqual(blackThin)
        expect(center?.right).toEqual(blackThin)
        // Top-left corner contributes only inward (right + bottom).
        const tl = readBorders(doc, 'sheet1', 2, 2)
        expect(tl?.right).toEqual(blackThin)
        expect(tl?.bottom).toEqual(blackThin)
        expect(tl?.top).toBeUndefined()
        expect(tl?.left).toBeUndefined()
    })

    it('innerH paints only the horizontal interior lines', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'innerH', blackThin)
        const top = readBorders(doc, 'sheet1', 2, 3)
        expect(top?.bottom).toEqual(blackThin)
        expect(top?.top).toBeUndefined()
        const middle = readBorders(doc, 'sheet1', 3, 3)
        expect(middle?.top).toEqual(blackThin)
        expect(middle?.bottom).toEqual(blackThin)
        expect(middle?.left).toBeUndefined()
        expect(middle?.right).toBeUndefined()
    })

    it('innerV paints only the vertical interior lines', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'innerV', blackThin)
        const middle = readBorders(doc, 'sheet1', 3, 3)
        expect(middle?.left).toEqual(blackThin)
        expect(middle?.right).toEqual(blackThin)
        expect(middle?.top).toBeUndefined()
        expect(middle?.bottom).toBeUndefined()
    })
})
