import { describe, expect, it } from 'vitest'
import { mergeCellStyles } from '../tinycld/calc/lib/cell-style-render'

describe('mergeCellStyles', () => {
    it('returns undefined when both sides are absent', () => {
        expect(mergeCellStyles(undefined, undefined)).toBeUndefined()
    })

    it('returns the present side when the other is absent', () => {
        const base = { font: { bold: true } }
        expect(mergeCellStyles(base, undefined)).toBe(base)
        expect(mergeCellStyles(undefined, base)).toBe(base)
    })

    it('overlay wins per font leaf', () => {
        const base = { font: { bold: true, color: '#000000' } }
        const overlay = { font: { color: '#FF0000' } }
        const out = mergeCellStyles(base, overlay)
        expect(out?.font?.bold).toBe(true)
        expect(out?.font?.color).toBe('#FF0000')
    })

    it('overlay fill replaces base fill leaves but preserves untouched ones', () => {
        const base = { fill: { type: 'pattern' as const, pattern: 'solid', fgColor: '#000' } }
        const overlay = { fill: { fgColor: '#FFF' } }
        const out = mergeCellStyles(base, overlay)
        expect(out?.fill?.fgColor).toBe('#FFF')
        expect(out?.fill?.pattern).toBe('solid')
    })

    it('numFmt: overlay wins, base preserved when overlay absent', () => {
        expect(mergeCellStyles({ numFmt: '#,##0' }, { numFmt: '0.00' })?.numFmt).toBe('0.00')
        expect(mergeCellStyles({ numFmt: '#,##0' }, {})?.numFmt).toBe('#,##0')
    })

    it('mixes groups from both sides', () => {
        const base = { font: { bold: true } }
        const overlay = { fill: { fgColor: '#FF0000' } }
        const out = mergeCellStyles(base, overlay)
        expect(out?.font?.bold).toBe(true)
        expect(out?.fill?.fgColor).toBe('#FF0000')
    })

    it('borders: overlay edge wholesale replaces base edge', () => {
        const base = {
            borders: {
                top: { style: 'thin' as const, color: '#000' },
                bottom: { style: 'thin' as const, color: '#000' },
            },
        }
        const overlay = {
            borders: { top: { style: 'thick' as const, color: '#F00' } },
        }
        const out = mergeCellStyles(base, overlay)
        expect(out?.borders?.top).toEqual({ style: 'thick', color: '#F00' })
        // bottom comes from base unchanged
        expect(out?.borders?.bottom).toEqual({ style: 'thin', color: '#000' })
    })
})
