import * as fs from 'node:fs'
import * as path from 'node:path'

const EMAIL_LOG_PATH = path.join(import.meta.dirname, '..', '..', 'tmp', 'emails.log')

export interface CapturedEmail {
    timestamp: string
    to: { name?: string; email: string }[]
    cc?: { name?: string; email: string }[]
    bcc?: { name?: string; email: string }[]
    from?: string
    subject: string
    text?: string
    html?: string
    attachments?: number
}

export function readEmailLog(): CapturedEmail[] {
    if (!fs.existsSync(EMAIL_LOG_PATH)) return []
    const raw = fs.readFileSync(EMAIL_LOG_PATH, 'utf8')
    return raw
        .split('\n')
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l) as CapturedEmail)
}

export function clearEmailLog(): void {
    fs.mkdirSync(path.dirname(EMAIL_LOG_PATH), { recursive: true })
    fs.writeFileSync(EMAIL_LOG_PATH, '')
}

interface WaitOptions {
    timeoutMs?: number
    intervalMs?: number
    subjectMatch?: RegExp | string
}

// waitForEmailTo polls the log until an email matching the recipient (and
// optionally subject) shows up. Returns the matched email.
export async function waitForEmailTo(
    recipientEmail: string,
    opts: WaitOptions = {}
): Promise<CapturedEmail> {
    const timeoutMs = opts.timeoutMs ?? 15_000
    const intervalMs = opts.intervalMs ?? 250
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
        const emails = readEmailLog()
        const match = emails.find(e => {
            const matchesRecipient = e.to.some(
                r => r.email.toLowerCase() === recipientEmail.toLowerCase()
            )
            if (!matchesRecipient) return false
            if (opts.subjectMatch === undefined) return true
            if (typeof opts.subjectMatch === 'string') {
                return e.subject.includes(opts.subjectMatch)
            }
            return opts.subjectMatch.test(e.subject)
        })
        if (match) return match
        await new Promise(r => setTimeout(r, intervalMs))
    }

    const seen = readEmailLog()
        .map(e => `  to=${e.to.map(t => t.email).join(',')} subject=${e.subject}`)
        .join('\n')
    throw new Error(
        `Timed out after ${timeoutMs}ms waiting for email to ${recipientEmail}` +
            (opts.subjectMatch ? ` matching ${opts.subjectMatch}` : '') +
            `\nEmails seen so far:\n${seen || '  (none)'}`
    )
}

// Extracts the first http(s) link from an email's text or html body. For the
// invite flow we need to pluck the /accept-invite/{token} URL.
export function extractFirstLink(email: CapturedEmail, pattern?: RegExp): string {
    const haystack = `${email.text ?? ''}\n${email.html ?? ''}`
    const urlRegex = pattern ?? /https?:\/\/[^\s"'<>]+/
    const match = haystack.match(urlRegex)
    if (!match) {
        throw new Error(
            `No link matching ${urlRegex} found in email subject="${email.subject}"\nBody:\n${haystack}`
        )
    }
    return match[0]
}
