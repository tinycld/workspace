// Tests for the pure helpers behind NewPivotDialog. The component
// itself (NewPivotDialog.tsx) imports react-native and the form
// library, which vitest can't parse during the import phase — the
// helpers live in new-pivot-dialog-helpers.ts so we can exercise them
// directly here. Same pattern as pivot-banner-lines.ts /
// pivot-grid-view-state.ts / field-row-helpers.ts /
// pivot-side-panel-helpers.ts.
//
// What we verify:
//   - newPivotSchema accepts a valid (range, name) pair
//   - newPivotSchema rejects missing-sheet ranges with the dialog's
//     user-visible message ("Use the form ...")
//   - newPivotSchema rejects malformed ranges
//   - newPivotSchema rejects empty / whitespace-only sheet names
//   - buildInitialPivotDefinition produces an empty-but-valid def with
//     both grand-total toggles on, subtotals off
//   - makePivotId is deterministic for a given clock value and short
//   - defaultTargetSheetName mirrors Sheets ("Pivot of <name>") and
//     handles whitespace edge cases

import { describe, expect, it } from 'vitest'
import {
    buildInitialPivotDefinition,
    defaultTargetSheetName,
    makePivotId,
    newPivotSchema,
} from '../tinycld/calc/components/pivot/new-pivot-dialog-helpers'

describe('newPivotSchema', () => {
    it('accepts a valid range + name', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: 'Sheet1!A1:E100',
            targetSheetName: 'Pivot of Sheet1',
        })
        expect(r.success).toBe(true)
    })

    it('trims whitespace before validating', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: '  Sheet1!A1:E100  ',
            targetSheetName: '  Pivot  ',
        })
        expect(r.success).toBe(true)
        if (r.success) {
            expect(r.data.sourceRange).toBe('Sheet1!A1:E100')
            expect(r.data.targetSheetName).toBe('Pivot')
        }
    })

    it('rejects a range without a sheet separator', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: 'A1:B10',
            targetSheetName: 'Pivot',
        })
        expect(r.success).toBe(false)
        if (!r.success) {
            const msgs = r.error.issues.map(i => i.message)
            expect(msgs.some(m => m.includes('"Sheet1!A1:E100"'))).toBe(true)
        }
    })

    it('rejects a malformed range', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: 'Sheet1!notarange',
            targetSheetName: 'Pivot',
        })
        expect(r.success).toBe(false)
    })

    it('rejects an empty range', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: '',
            targetSheetName: 'Pivot',
        })
        expect(r.success).toBe(false)
    })

    it('rejects an empty target sheet name', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: 'Sheet1!A1:E100',
            targetSheetName: '',
        })
        expect(r.success).toBe(false)
    })

    it('rejects a whitespace-only target sheet name', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: 'Sheet1!A1:E100',
            targetSheetName: '   ',
        })
        expect(r.success).toBe(false)
    })

    it('accepts a quoted sheet name with spaces', () => {
        const r = newPivotSchema.safeParse({
            sourceRange: "'Sales 2025'!A1:E100",
            targetSheetName: 'Pivot',
        })
        expect(r.success).toBe(true)
    })
})

describe('buildInitialPivotDefinition', () => {
    it('produces a def with empty field lists and grand totals on', () => {
        const def = buildInitialPivotDefinition({
            id: 'p123',
            sourceRange: 'Sales!A1:E10',
            targetSheetName: 'Pivot of Sales',
        })
        expect(def.id).toBe('p123')
        expect(def.sourceRange).toBe('Sales!A1:E10')
        expect(def.targetSheetName).toBe('Pivot of Sales')
        expect(def.rows).toEqual([])
        expect(def.cols).toEqual([])
        expect(def.values).toEqual([])
        expect(def.filters).toEqual([])
        expect(def.filterSelections).toEqual({})
        expect(def.rowGrandTotals).toBe(true)
        expect(def.colGrandTotals).toBe(true)
        expect(def.rowSubtotals).toBe(false)
        expect(def.colSubtotals).toBe(false)
    })
})

describe('makePivotId', () => {
    it('is deterministic for a given clock value', () => {
        expect(makePivotId(1_700_000_000_000)).toBe(makePivotId(1_700_000_000_000))
    })

    it('starts with the "p" prefix', () => {
        expect(makePivotId(1)).toMatch(/^p[0-9a-z]+$/)
    })

    it('differs between distinct clock values', () => {
        expect(makePivotId(1)).not.toBe(makePivotId(2))
    })
})

describe('defaultTargetSheetName', () => {
    it('prefixes with "Pivot of"', () => {
        expect(defaultTargetSheetName('Sales')).toBe('Pivot of Sales')
    })

    it('trims the input', () => {
        expect(defaultTargetSheetName('  Sales  ')).toBe('Pivot of Sales')
    })

    it('falls back to "Pivot of Sheet" for an empty source name', () => {
        expect(defaultTargetSheetName('')).toBe('Pivot of Sheet')
        expect(defaultTargetSheetName('   ')).toBe('Pivot of Sheet')
    })
})
