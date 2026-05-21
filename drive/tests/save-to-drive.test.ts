import { describe, expect, it } from 'vitest'
import { deduplicateName } from '../tinycld/drive/lib/deduplicate-name'

describe('deduplicateName', () => {
    it('returns the original name when not in use', () => {
        expect(deduplicateName('foo.pdf', new Set())).toBe('foo.pdf')
    })

    it('appends " (1)" before the extension on first collision', () => {
        expect(deduplicateName('foo.pdf', new Set(['foo.pdf']))).toBe('foo (1).pdf')
    })

    it('skips already-used numbered variants', () => {
        const used = new Set(['foo.pdf', 'foo (1).pdf', 'foo (2).pdf'])
        expect(deduplicateName('foo.pdf', used)).toBe('foo (3).pdf')
    })

    it('handles names without an extension', () => {
        expect(deduplicateName('README', new Set(['README']))).toBe('README (1)')
    })

    it('treats hidden files (no extension separator) as no-extension', () => {
        expect(deduplicateName('.env', new Set(['.env']))).toBe('.env (1)')
    })

    it('uses the rightmost dot as the extension separator', () => {
        expect(deduplicateName('archive.tar.gz', new Set(['archive.tar.gz']))).toBe(
            'archive.tar (1).gz'
        )
    })
})
