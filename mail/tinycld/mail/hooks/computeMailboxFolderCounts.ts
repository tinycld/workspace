import type { MailThreadState, MailThreads } from '../types'

export interface FolderCounts {
    inbox: number
    drafts: number
    sent: number
    starred: number
    trash: number
    spam: number
}

const EMPTY: FolderCounts = { inbox: 0, drafts: 0, sent: 0, starred: 0, trash: 0, spam: 0 }

/**
 * Pure: aggregate unread/draft/sent counts per mailbox by joining
 * thread_state rows against threads to get each thread's mailbox.
 *
 * For personal / per-user folders (inbox/drafts/trash/spam/starred) we count
 * the current user's thread_state rows. "inbox" only counts unread rows.
 * "sent" uses the same per-user rule here (sidebar aggregate); the shared-
 * mailbox Sent/Drafts widening for actual thread-list display is handled
 * separately in Task 15.
 */
export function computeMailboxFolderCounts(
    threadStates: MailThreadState[],
    threads: MailThreads[]
): Map<string, FolderCounts> {
    const threadToMailbox = new Map(threads.map((t) => [t.id, t.mailbox]))
    const counts = new Map<string, FolderCounts>()

    for (const s of threadStates) {
        const mailboxId = threadToMailbox.get(s.thread)
        if (!mailboxId) continue
        const c = counts.get(mailboxId) ?? { ...EMPTY }
        if (s.folder === 'inbox' && !s.is_read) c.inbox += 1
        if (s.folder === 'drafts') c.drafts += 1
        if (s.folder === 'sent') c.sent += 1
        if (s.is_starred) c.starred += 1
        if (s.folder === 'trash') c.trash += 1
        if (s.folder === 'spam') c.spam += 1
        counts.set(mailboxId, c)
    }

    return counts
}
