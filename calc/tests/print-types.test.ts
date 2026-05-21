import { describe, expect, it } from 'vitest'
import { printConfigSchema } from '../tinycld/calc/lib/print/types'

describe('printConfigSchema', () => {
    it('accepts a fully-specified valid config', () => {
        const result = printConfigSchema.safeParse({
            scope: { sheets: 'current', range: 'used' },
            page: { orientation: 'portrait', scaling: 'fit-width', margins: 'normal' },
            layout: { showHeaders: false, showGridlines: true, repeatRows: null },
        })
        expect(result.success).toBe(true)
    })

    it('accepts a sheet-pick set with multiple ids', () => {
        const result = printConfigSchema.safeParse({
            scope: { sheets: { ids: ['sheet1', 'sheet3'] }, range: 'used' },
            page: { orientation: 'landscape', scaling: 'fit-page', margins: 'wide' },
            layout: {
                showHeaders: true,
                showGridlines: false,
                repeatRows: { from: 1, to: 2 },
            },
        })
        expect(result.success).toBe(true)
    })

    it('rejects a sheet-pick set with no ids', () => {
        const result = printConfigSchema.safeParse({
            scope: { sheets: { ids: [] }, range: 'used' },
            page: { orientation: 'portrait', scaling: 'actual', margins: 'normal' },
            layout: { showHeaders: false, showGridlines: true, repeatRows: null },
        })
        expect(result.success).toBe(false)
    })

    it('accepts repeatRows where from equals to (single-row repeat)', () => {
        const result = printConfigSchema.safeParse({
            scope: { sheets: 'current', range: 'used' },
            page: { orientation: 'portrait', scaling: 'actual', margins: 'normal' },
            layout: {
                showHeaders: false,
                showGridlines: true,
                repeatRows: { from: 3, to: 3 },
            },
        })
        expect(result.success).toBe(true)
    })

    it('rejects repeatRows where from > to', () => {
        const result = printConfigSchema.safeParse({
            scope: { sheets: 'current', range: 'used' },
            page: { orientation: 'portrait', scaling: 'actual', margins: 'normal' },
            layout: {
                showHeaders: false,
                showGridlines: true,
                repeatRows: { from: 5, to: 2 },
            },
        })
        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.error.issues.some(i => /from.*to/i.test(i.message))).toBe(
                true
            )
        }
    })

    it('rejects non-integer repeatRows', () => {
        const result = printConfigSchema.safeParse({
            scope: { sheets: 'current', range: 'used' },
            page: { orientation: 'portrait', scaling: 'actual', margins: 'normal' },
            layout: {
                showHeaders: false,
                showGridlines: true,
                repeatRows: { from: 1.5, to: 2 },
            },
        })
        expect(result.success).toBe(false)
    })
})
