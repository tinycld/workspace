import { describe, expect, it } from 'vitest'
import {
    findPresetById,
    findPresetByNumFmt,
    NUMBER_FORMAT_PRESETS,
} from '../tinycld/calc/lib/number-format/presets'

// The presets registry is the source of truth for the format-picker
// menu and the four toolbar shortcut buttons ($, %, .0, .00). These
// tests pin the registry shape so accidental renames or removals fail
// fast before they hit a UI test.

describe('NUMBER_FORMAT_PRESETS', () => {
    it('every preset has a unique id', () => {
        const ids = NUMBER_FORMAT_PRESETS.map(p => p.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('contains the screenshot menu items', () => {
        const ids = new Set(NUMBER_FORMAT_PRESETS.map(p => p.id))
        for (const expected of [
            'automatic',
            'plain',
            'number',
            'percent',
            'scientific',
            'accounting',
            'financial',
            'currency',
            'currency-rounded',
            'date',
            'time',
            'datetime',
            'duration',
        ]) {
            expect(ids.has(expected), `missing preset: ${expected}`).toBe(true)
        }
    })

    it('automatic preset carries numFmt: null', () => {
        const auto = findPresetById('automatic')
        expect(auto?.numFmt).toBeNull()
    })

    it('plain preset carries the @ pattern', () => {
        const plain = findPresetById('plain')
        expect(plain?.numFmt).toBe('@')
    })

    it('every non-automatic preset has a non-null numFmt', () => {
        for (const p of NUMBER_FORMAT_PRESETS) {
            if (p.id === 'automatic') continue
            expect(p.numFmt, `preset ${p.id} should have a numFmt`).not.toBeNull()
        }
    })
})

describe('findPresetByNumFmt', () => {
    it('returns automatic for undefined input', () => {
        expect(findPresetByNumFmt(undefined)?.id).toBe('automatic')
    })

    it('matches a known pattern back to its preset', () => {
        expect(findPresetByNumFmt('#,##0.00')?.id).toBe('number')
        expect(findPresetByNumFmt('0.00%')?.id).toBe('percent')
        expect(findPresetByNumFmt('$#,##0.00')?.id).toBe('currency')
    })

    it('returns undefined for an unknown custom pattern', () => {
        expect(findPresetByNumFmt('"€"#,##0.00')).toBeUndefined()
    })
})

describe('findPresetById', () => {
    it('returns the registered preset for a known id', () => {
        expect(findPresetById('percent')?.label).toBe('Percent')
    })

    it('returns undefined for an unknown id', () => {
        expect(findPresetById('not-a-preset')).toBeUndefined()
    })
})
