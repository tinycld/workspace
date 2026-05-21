import { describe, expect, it, vi } from 'vitest'
import {
    parseSearchParticipants,
    prettifyFolderKey,
    searchResultToThreadListItem,
    stripHtmlTags,
} from '../tinycld/mail/hooks/mailListHelpers'

vi.mock('@tinycld/core/lib/errors', () => ({
    captureException: vi.fn(),
}))

describe('prettifyFolderKey', () => {
    it('returns the canonical title when one is registered', () => {
        expect(prettifyFolderKey('all-inboxes')).toBe('All Inboxes')
    })

    it('title-cases unknown single-word keys', () => {
        expect(prettifyFolderKey('inbox')).toBe('Inbox')
        expect(prettifyFolderKey('sent')).toBe('Sent')
    })

    it('title-cases each segment of an unregistered hyphenated key', () => {
        expect(prettifyFolderKey('shared-with-me')).toBe('Shared With Me')
    })

    it('handles an empty key without throwing', () => {
        expect(prettifyFolderKey('')).toBe('')
    })
})

describe('parseSearchParticipants', () => {
    it('parses a JSON-encoded participants array', () => {
        const raw = JSON.stringify([{ name: 'Ada', email: 'ada@example.com' }])
        expect(parseSearchParticipants(raw)).toEqual([{ name: 'Ada', email: 'ada@example.com' }])
    })

    it('returns [] for empty input', () => {
        expect(parseSearchParticipants('')).toEqual([])
    })

    it('returns [] when the JSON parses to a non-array', () => {
        expect(parseSearchParticipants('{"name":"Ada"}')).toEqual([])
        expect(parseSearchParticipants('null')).toEqual([])
    })

    it('returns [] on malformed JSON without throwing', () => {
        expect(parseSearchParticipants('not json')).toEqual([])
    })
})

describe('stripHtmlTags', () => {
    it('removes simple tags', () => {
        expect(stripHtmlTags('hello <b>world</b>')).toBe('hello world')
    })

    it('removes attributed tags', () => {
        expect(stripHtmlTags('<a href="x">link</a>')).toBe('link')
    })
})

describe('searchResultToThreadListItem', () => {
    function buildResult(
        overrides: Partial<Parameters<typeof searchResultToThreadListItem>[0]> = {}
    ) {
        return {
            thread_id: 't1',
            subject: 'Re: budget',
            subject_highlight: 'Re: budget',
            snippet_highlight: 'See the <em>numbers</em> attached.',
            latest_date: '2026-04-30T12:00:00Z',
            message_count: 3,
            mailbox_id: 'mb1',
            participants: JSON.stringify([
                { name: 'Ada', email: 'ada@example.com' },
                { name: 'Grace', email: 'grace@example.com' },
            ]),
            has_attachments: false,
            ...overrides,
        }
    }

    it('maps a well-formed search result onto a ThreadListItem', () => {
        const item = searchResultToThreadListItem(buildResult())
        expect(item.threadId).toBe('t1')
        expect(item.stateId).toBe('t1')
        expect(item.subject).toBe('Re: budget')
        expect(item.snippet).toBe('See the numbers attached.')
        expect(item.messageCount).toBe(3)
        expect(item.senderName).toBe('Ada')
        expect(item.senderEmail).toBe('ada@example.com')
        expect(item.participants).toHaveLength(2)
        expect(item.folder).toBe('search')
        expect(item.isRead).toBe(true)
    })

    it('survives malformed participants JSON with empty sender fields', () => {
        const item = searchResultToThreadListItem(buildResult({ participants: 'not json' }))
        expect(item.senderName).toBe('')
        expect(item.senderEmail).toBe('')
        expect(item.participants).toEqual([])
    })

    it('falls back to empty snippet when stripping leaves nothing', () => {
        const item = searchResultToThreadListItem(buildResult({ snippet_highlight: '<br/>' }))
        expect(item.snippet).toBe('')
    })

    it('forwards has_attachments so the paperclip indicator renders for matched threads with attachments', () => {
        expect(
            searchResultToThreadListItem(buildResult({ has_attachments: true })).hasAttachments
        ).toBe(true)
        expect(
            searchResultToThreadListItem(buildResult({ has_attachments: false })).hasAttachments
        ).toBe(false)
    })
})
