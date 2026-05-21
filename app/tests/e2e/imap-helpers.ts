import { ImapFlow } from 'imapflow'
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './helpers'

const IMAP_PORT = 1193

interface ImapMessage {
    uid: number
    subject: string
    from: string
    date: Date | null
    flags: Set<string>
}

interface ComposeOptions {
    from: string
    to: string
    subject: string
    body: string
    messageId?: string
}

function createImapClient(): ImapFlow {
    return new ImapFlow({
        host: '127.0.0.1',
        port: IMAP_PORT,
        secure: false,
        doSTARTTLS: false,
        logger: false,
        auth: {
            user: TEST_USER_EMAIL,
            pass: TEST_USER_PASSWORD,
        },
    })
}

export async function withImapClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = createImapClient()
    await client.connect()
    try {
        return await fn(client)
    } finally {
        await client.logout()
    }
}

export async function listMailboxes(
    client: ImapFlow
): Promise<{ name: string; specialUse: string }[]> {
    const list = await client.list()
    return list.map(mb => ({
        name: mb.path,
        specialUse: mb.specialUse || '',
    }))
}

/**
 * Finds the personal INBOX path — handles both single-mailbox ("INBOX")
 * and multi-mailbox ("Test User/INBOX") layouts. Throws if not found.
 */
export function findPersonalInbox(mailboxes: { name: string; specialUse: string }[]): string {
    const bare = mailboxes.find(mb => mb.name === 'INBOX')
    if (bare) return bare.name

    const prefixed = mailboxes.find(
        mb => mb.name.endsWith('/INBOX') && !mb.name.startsWith('Support')
    )
    if (prefixed) return prefixed.name

    throw new Error(`No personal INBOX found in: ${mailboxes.map(m => m.name).join(', ')}`)
}

export async function listMessages(client: ImapFlow, folder: string): Promise<ImapMessage[]> {
    const lock = await client.getMailboxLock(folder)
    try {
        const messages: ImapMessage[] = []
        for await (const msg of client.fetch('1:*', {
            uid: true,
            envelope: true,
            flags: true,
        })) {
            messages.push({
                uid: msg.uid,
                subject: msg.envelope?.subject || '',
                from: msg.envelope?.from?.[0]?.address || '',
                date: msg.envelope?.date ?? null,
                flags: msg.flags ?? new Set(),
            })
        }
        return messages
    } finally {
        lock.release()
    }
}

export async function fetchMessageBySubject(
    client: ImapFlow,
    folder: string,
    subject: string
): Promise<ImapMessage | null> {
    const messages = await listMessages(client, folder)
    return messages.find(m => m.subject === subject) ?? null
}

export async function appendMessage(
    client: ImapFlow,
    folder: string,
    { from, to, subject, body, messageId }: ComposeOptions
): Promise<{ uid: number }> {
    const date = new Date().toUTCString()
    const headers = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Date: ${date}`,
        `Content-Type: text/plain; charset=utf-8`,
    ]
    if (messageId) headers.push(`Message-ID: ${messageId}`)
    const raw = [...headers, '', body].join('\r\n')

    const result = await client.append(folder, Buffer.from(raw), ['\\Seen'])

    if (!result) return { uid: 0 }
    return { uid: result.uid ?? Number(result.uidValidity) ?? 0 }
}

export async function deleteMessage(client: ImapFlow, folder: string, uid: number): Promise<void> {
    const lock = await client.getMailboxLock(folder)
    try {
        await client.messageFlagsAdd({ uid }, ['\\Deleted'], { uid: true })
        await client.messageDelete({ uid }, { uid: true })
    } finally {
        lock.release()
    }
}

export async function moveMessage(
    client: ImapFlow,
    source: string,
    uid: number,
    dest: string
): Promise<void> {
    const lock = await client.getMailboxLock(source)
    try {
        await client.messageMove({ uid }, dest, { uid: true })
    } finally {
        lock.release()
    }
}
