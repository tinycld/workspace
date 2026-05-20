import { describe, expect, it } from 'vitest'
import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { contactSchema } from '~/tinycld/contacts/components/contactSchema'

describe('contactSchema', () => {
    it('requires a first name', () => {
        const result = contactSchema.safeParse({
            first_name: '',
            last_name: '',
            email: '',
            phone: '',
            company: '',
            job_title: '',
            notes: '',
            favorite: false,
        })
        expect(result.success).toBe(false)
    })

    it('accepts a valid contact', () => {
        const result = contactSchema.safeParse({
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.com',
            phone: '',
            company: '',
            job_title: '',
            notes: '',
            favorite: true,
        })
        expect(result.success).toBe(true)
    })
})

describe('cross-package import from @tinycld/core', () => {
    it('resolves a core util', () => {
        expect(hexToRgba('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
    })
})
