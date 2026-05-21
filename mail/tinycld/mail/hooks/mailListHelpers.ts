import { captureException } from '@tinycld/core/lib/errors'
import type { ThreadListItem } from '../components/thread-list-item'
import type { MailSearchResult } from './useMailSearch'

const FOLDER_TITLES: Record<string, string> = {
    'all-inboxes': 'All Inboxes',
}

export function stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, '')
}

export function prettifyFolderKey(key: string): string {
    if (FOLDER_TITLES[key]) return FOLDER_TITLES[key]
    return key
        .split('-')
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join(' ')
}

export function parseSearchParticipants(raw: string): { name: string; email: string }[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch (err) {
        captureException('mail.searchResultParticipants', err, { raw })
        return []
    }
}

export function searchResultToThreadListItem(result: MailSearchResult): ThreadListItem {
    const participants = parseSearchParticipants(result.participants)
    return {
        stateId: result.thread_id,
        threadId: result.thread_id,
        subject: result.subject,
        snippet: stripHtmlTags(result.snippet_highlight) || '',
        latestDate: result.latest_date,
        messageCount: result.message_count,
        senderName: participants[0]?.name ?? '',
        senderEmail: participants[0]?.email ?? '',
        participants,
        isRead: true,
        isStarred: false,
        labels: [],
        folder: 'search',
        hasDraft: false,
        hasAttachments: result.has_attachments ?? false,
    }
}
