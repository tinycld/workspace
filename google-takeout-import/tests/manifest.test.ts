import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('google-takeout-import manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Google Takeout Import')
        expect(manifest.slug).toBe('google-takeout-import')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('contributes a settings panel', () => {
        expect(Array.isArray(manifest.settings)).toBe(true)
        expect(manifest.settings?.length).toBeGreaterThan(0)
        const panel = manifest.settings?.[0]
        expect(panel?.slug).toBe('google-takeout')
        expect(panel?.component).toBe('settings/takeout')
        expect(panel?.label).toBe('Import from Google')
    })

    it('is settings-only (no routes / nav / server)', () => {
        // The literal type doesn't include these fields at all; asserting
        // via `in` keeps the check runtime-only and TS-quiet.
        expect('routes' in manifest).toBe(false)
        expect('nav' in manifest).toBe(false)
        expect('server' in manifest).toBe(false)
    })
})
