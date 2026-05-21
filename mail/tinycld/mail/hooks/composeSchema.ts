import { z } from '@tinycld/core/ui/form'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const namedEmailPattern = /^(.+)\s*<([^\s@]+@[^\s@]+\.[^\s@]+)>$/

function isValidRecipient(segment: string) {
    const namedMatch = segment.match(namedEmailPattern)
    if (namedMatch) return emailPattern.test(namedMatch[2])
    return emailPattern.test(segment)
}

function validateRecipients(value: string) {
    if (!value) return true
    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every(isValidRecipient)
}

export const composeSchema = z
    .object({
        to: z.string().min(1, 'At least one recipient is required'),
        cc: z.string(),
        bcc: z.string(),
        subject: z.string().min(1, 'Subject is required'),
    })
    .superRefine((data, ctx) => {
        if (data.to && !validateRecipients(data.to)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'One or more email addresses are invalid',
                path: ['to'],
            })
        }
        if (data.cc && !validateRecipients(data.cc)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'One or more Cc addresses are invalid',
                path: ['cc'],
            })
        }
        if (data.bcc && !validateRecipients(data.bcc)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'One or more Bcc addresses are invalid',
                path: ['bcc'],
            })
        }
    })

export type ComposeFormData = z.infer<typeof composeSchema>

export function parseRecipients(value: string) {
    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((segment) => {
            const namedMatch = segment.match(namedEmailPattern)
            if (namedMatch) return { name: namedMatch[1].trim(), email: namedMatch[2] }
            return { name: '', email: segment }
        })
}
