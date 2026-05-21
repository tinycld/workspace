import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('calc manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Calc')
        expect(manifest.slug).toBe('calc')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('has a description', () => {
        expect(manifest.description).toBe('Spreadsheets for your organization')
    })
})
