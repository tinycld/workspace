import { describe, expect, it } from 'vitest'
import { computeMailboxFolderCounts } from '../tinycld/mail/hooks/computeMailboxFolderCounts'
import { getMailboxLabel } from '../tinycld/mail/hooks/useMailboxes'
import type { MailMailboxes, MailThreadState, MailThreads } from '../tinycld/mail/types'

function thread(id: string, mailbox: string): MailThreads {
    return {
        id,
        mailbox,
        subject: '',
        snippet: '',
        message_count: 1,
        latest_date: '2024-01-01T00:00:00Z',
        participants: [],
        has_draft: false,
        has_attachments: false,
        created: '',
        updated: '',
    }
}

function state(overrides: Partial<MailThreadState>): MailThreadState {
    return {
        id: 's1',
        thread: 't1',
        user_org: 'uo1',
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        created: '',
        updated: '',
        ...overrides,
    }
}

function mailbox(overrides: Partial<MailMailboxes>): MailMailboxes {
    return {
        id: 'mb1',
        address: 'alice',
        domain: 'd1',
        display_name: 'Alice',
        name: 'Acme',
        type: 'personal',
        created: '',
        updated: '',
        ...overrides,
    }
}

describe('getMailboxLabel', () => {
    it('returns "Personal" for the personal mailbox regardless of display_name', () => {
        const mb = mailbox({ display_name: 'Alice', address: 'alice@x' })
        expect(getMailboxLabel(mb, true)).toBe('Personal')
    })

    it('returns display_name for shared mailboxes when set', () => {
        const mb = mailbox({ type: 'shared', display_name: 'Team Support', address: 'support@x' })
        expect(getMailboxLabel(mb, false)).toBe('Team Support')
    })

    it('falls back to address when display_name is empty for shared mailboxes', () => {
        const mb = mailbox({ type: 'shared', display_name: '', address: 'support@x' })
        expect(getMailboxLabel(mb, false)).toBe('support@x')
    })
})

describe('unified inbox unread aggregation', () => {
    it('sums inbox unread counts across every mailbox the user can see', () => {
        const threads = [
            thread('t1', 'mb_personal'),
            thread('t2', 'mb_shared_a'),
            thread('t3', 'mb_shared_a'),
            thread('t4', 'mb_shared_b'),
        ]
        const states = [
            state({ id: 's1', thread: 't1', folder: 'inbox', is_read: false }),
            state({ id: 's2', thread: 't2', folder: 'inbox', is_read: false }),
            state({ id: 's3', thread: 't3', folder: 'inbox', is_read: false }),
            state({ id: 's4', thread: 't4', folder: 'inbox', is_read: false }),
        ]

        const counts = computeMailboxFolderCounts(states, threads)
        let total = 0
        for (const c of counts.values()) total += c.inbox
        expect(total).toBe(4)
    })

    it('does not include read inbox threads in the unified unread count', () => {
        const threads = [thread('t1', 'mb1'), thread('t2', 'mb2')]
        const states = [
            state({ id: 's1', thread: 't1', folder: 'inbox', is_read: true }),
            state({ id: 's2', thread: 't2', folder: 'inbox', is_read: false }),
        ]

        const counts = computeMailboxFolderCounts(states, threads)
        let total = 0
        for (const c of counts.values()) total += c.inbox
        expect(total).toBe(1)
    })

    it('does not count threads outside the inbox folder', () => {
        const threads = [thread('t1', 'mb1'), thread('t2', 'mb1'), thread('t3', 'mb2')]
        const states = [
            state({ id: 's1', thread: 't1', folder: 'inbox', is_read: false }),
            state({ id: 's2', thread: 't2', folder: 'archive', is_read: false }),
            state({ id: 's3', thread: 't3', folder: 'spam', is_read: false }),
        ]

        const counts = computeMailboxFolderCounts(states, threads)
        let total = 0
        for (const c of counts.values()) total += c.inbox
        expect(total).toBe(1)
    })

    it('returns zero when the user has no inbox threads', () => {
        const counts = computeMailboxFolderCounts([], [])
        let total = 0
        for (const c of counts.values()) total += c.inbox
        expect(total).toBe(0)
    })
})
