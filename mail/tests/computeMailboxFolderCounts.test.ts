import { describe, expect, it } from 'vitest'
import { computeMailboxFolderCounts } from '../tinycld/mail/hooks/computeMailboxFolderCounts'
import type { MailThreadState, MailThreads } from '../tinycld/mail/types'

function t(id: string, mailbox: string): MailThreads {
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

function st(overrides: Partial<MailThreadState>): MailThreadState {
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

describe('computeMailboxFolderCounts', () => {
    it('keeps personal and shared counts separate', () => {
        const threads = [t('t1', 'mb1'), t('t2', 'mb2')]
        const states = [
            st({ id: 's1', thread: 't1', folder: 'inbox', is_read: false }),
            st({ id: 's2', thread: 't2', folder: 'inbox', is_read: false }),
        ]
        const got = computeMailboxFolderCounts(states, threads)
        expect(got.get('mb1')?.inbox).toBe(1)
        expect(got.get('mb2')?.inbox).toBe(1)
    })

    it('inbox counts only unread', () => {
        const threads = [t('t1', 'mb1'), t('t2', 'mb1')]
        const states = [
            st({ id: 's1', thread: 't1', folder: 'inbox', is_read: true }),
            st({ id: 's2', thread: 't2', folder: 'inbox', is_read: false }),
        ]
        const got = computeMailboxFolderCounts(states, threads)
        expect(got.get('mb1')?.inbox).toBe(1)
    })

    it('counts drafts and sent regardless of read state', () => {
        const threads = [t('t1', 'mb1'), t('t2', 'mb1')]
        const states = [
            st({ id: 's1', thread: 't1', folder: 'drafts', is_read: true }),
            st({ id: 's2', thread: 't2', folder: 'sent', is_read: true }),
        ]
        const got = computeMailboxFolderCounts(states, threads)
        expect(got.get('mb1')?.drafts).toBe(1)
        expect(got.get('mb1')?.sent).toBe(1)
    })

    it('counts starred across folders', () => {
        const threads = [t('t1', 'mb1'), t('t2', 'mb1')]
        const states = [
            st({ id: 's1', thread: 't1', folder: 'inbox', is_starred: true }),
            st({ id: 's2', thread: 't2', folder: 'sent', is_starred: true }),
        ]
        const got = computeMailboxFolderCounts(states, threads)
        expect(got.get('mb1')?.starred).toBe(2)
    })

    it('skips thread_states whose thread has no matching thread row', () => {
        const threads: MailThreads[] = []
        const states = [st({ id: 's1', thread: 't_missing', folder: 'inbox' })]
        const got = computeMailboxFolderCounts(states, threads)
        expect(got.size).toBe(0)
    })

    it('returns empty map for empty inputs', () => {
        expect(computeMailboxFolderCounts([], []).size).toBe(0)
    })
})
