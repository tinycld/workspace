import { describe, expect, it } from 'vitest'
import { PII_KEY_PATTERN, scrubPII } from './sentry-scrub'

describe('scrubPII', () => {
    it('removes top-level PII keys', () => {
        const input = { email: 'a@b.com', status: 500 }
        expect(scrubPII(input)).toEqual({ email: '[Filtered]', status: 500 })
    })

    it('removes nested PII keys', () => {
        const input = { user: { email: 'a@b.com', id: '1' } }
        expect(scrubPII(input)).toEqual({ user: { email: '[Filtered]', id: '1' } })
    })

    it('scrubs arrays element-wise', () => {
        const input = { contacts: [{ name: 'x', id: '1' }] }
        expect(scrubPII(input)).toEqual({ contacts: [{ name: '[Filtered]', id: '1' }] })
    })

    it('scrubs body, subject, filename, phone, address, content, title', () => {
        const input = {
            body: 'x',
            subject: 'x',
            filename: 'x',
            phone: 'x',
            address: 'x',
            content: 'x',
            title: 'x',
            ok: 'keep',
        }
        const out = scrubPII(input) as Record<string, unknown>
        expect(out.ok).toBe('keep')
        for (const k of ['body', 'subject', 'filename', 'phone', 'address', 'content', 'title']) {
            expect(out[k]).toBe('[Filtered]')
        }
    })

    it('handles null, undefined, primitives, cycles', () => {
        expect(scrubPII(null)).toBe(null)
        expect(scrubPII(undefined)).toBe(undefined)
        expect(scrubPII(42)).toBe(42)
        const a: Record<string, unknown> = {}
        a.self = a
        const out = scrubPII(a) as Record<string, unknown>
        expect(out.self).toBe('[Circular]')
    })

    it('PII_KEY_PATTERN is case-insensitive', () => {
        expect(PII_KEY_PATTERN.test('Email')).toBe(true)
        expect(PII_KEY_PATTERN.test('USER_EMAIL')).toBe(true)
        expect(PII_KEY_PATTERN.test('orgId')).toBe(false)
    })
})
