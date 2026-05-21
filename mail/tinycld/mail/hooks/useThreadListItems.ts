import { useQuery } from '@tanstack/react-query'
import { and, eq } from '@tanstack/db'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useEffect, useMemo, useRef } from 'react'
import type { ThreadListItem } from '../components/thread-list-item'
import { toThreadListItem } from '../components/thread-list-item'
import { useThreadListStore } from '../stores/thread-list-store'
import type { MailMessages, MailThreads, MailThreadState } from '../types'
import { useLabels } from './useLabels'
import { getMailboxLabel } from './useMailboxes'

export const UNIFIED_INBOX = '__all_inboxes__'

export const PAGE_SIZE = 100

interface UseThreadListItemsFilter {
    folder: string | null
    labels: string[]
    mailboxId: string
}

interface UseThreadListItemsOptions {
    page: number
}

/**
 * Loads the thread list for the current folder + filter at the given page,
 * fetching only that page from the server.
 *
 * Architecture:
 *   - mail_threads is on-demand. Pagination is driven by a one-shot
 *     pb.collection('mail_threads').getList(page, 100, ...) via React Query —
 *     pbtsdb's useLiveQuery doesn't support offsets. Realtime invalidation
 *     keeps the cached page fresh.
 *   - The server filter uses PocketBase back-relation syntax
 *     (mail_thread_state_via_thread.<field>) so server-side joins decide
 *     which threads belong in the current folder for the current user.
 *   - mail_thread_state stays eager (per-user, bounded). It supplies the
 *     read/starred/folder flags rendered alongside each row.
 *   - mail_messages is on-demand. Draft / attachment markers fetch only
 *     for the current page's thread ids — small bounded queries.
 */
export function useThreadListItems(
    userOrgId: string,
    filter: UseThreadListItemsFilter,
    { page }: UseThreadListItemsOptions = { page: 1 }
) {
    const [
        threadStateCollection,
        messagesCollection,
        assignmentsCollection,
        mailboxesCollection,
        membersCollection,
    ] = useStore(
        'mail_thread_state',
        'mail_messages',
        'label_assignments',
        'mail_mailboxes',
        'mail_mailbox_members'
    )

    const { labels, labelMap } = useLabels()

    const { data: threadStates, isLoading: threadStatesLoading } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_thread_state: threadStateCollection })
                .where(({ mail_thread_state }) => eq(mail_thread_state.user_org, userOrgId)),
        [userOrgId]
    )

    const { data: allAssignments, isLoading: assignmentsLoading } = useOrgLiveQuery((query, { userOrgId }) =>
        query
            .from({ label_assignments: assignmentsCollection })
            .where(({ label_assignments }) =>
                and(eq(label_assignments.collection, 'mail_thread_state'), eq(label_assignments.user_org, userOrgId))
            )
    )

    const { data: allMailboxes } = useOrgLiveQuery((query) => query.from({ mail_mailboxes: mailboxesCollection }))

    const { data: userMemberships } = useOrgLiveQuery((query, { userOrgId }) =>
        query
            .from({ mail_mailbox_members: membersCollection })
            .where(({ mail_mailbox_members }) => eq(mail_mailbox_members.user_org, userOrgId))
    )

    const { data: targetMailbox } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_mailboxes: mailboxesCollection })
                .where(({ mail_mailboxes }) => eq(mail_mailboxes.id, filter.mailboxId)),
        [filter.mailboxId]
    )
    const mailboxType = targetMailbox?.[0]?.type ?? 'personal'

    const { data: coMembers } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_mailbox_members: membersCollection })
                .where(({ mail_mailbox_members }) => eq(mail_mailbox_members.mailbox, filter.mailboxId)),
        [filter.mailboxId]
    )

    const isUnified = filter.mailboxId === UNIFIED_INBOX

    // The mailbox-id set the page query restricts threads to. For unified inbox
    // it's every mailbox the user belongs to; otherwise just the active one.
    const visibleMailboxIds = useMemo(() => {
        if (!isUnified) return [filter.mailboxId]
        const ids = new Set<string>()
        for (const m of userMemberships ?? []) ids.add(m.mailbox)
        return [...ids]
    }, [isUnified, filter.mailboxId, userMemberships])

    const folderKey = filter.folder ?? 'inbox'
    const userOrgIdsForFolder = useMemo(() => {
        // For shared mailboxes' Sent / Drafts views, we widen to co-members
        // so the team sees each others' outbound activity. Personal folders
        // and inbox/starred/etc. always scope to the active user.
        const widenSharedTeam =
            mailboxType === 'shared' && (filter.folder === 'sent' || filter.folder === 'drafts')
        if (!widenSharedTeam) return [userOrgId]
        const ids = new Set<string>([userOrgId])
        for (const m of coMembers ?? []) ids.add(m.user_org)
        return [...ids]
    }, [mailboxType, filter.folder, userOrgId, coMembers])

    const pageQueryEnabled =
        visibleMailboxIds.length > 0 && (isUnified ? !!userMemberships : true)

    const pageQueryKey = useMemo(
        () => [
            'mail_threads_page',
            userOrgId,
            filter.mailboxId,
            filter.folder ?? 'inbox',
            visibleMailboxIds.slice().sort().join(','),
            userOrgIdsForFolder.slice().sort().join(','),
            page,
        ],
        [userOrgId, filter.mailboxId, filter.folder, visibleMailboxIds, userOrgIdsForFolder, page]
    )

    const { data: pageResult, isLoading: pageLoading } = useQuery({
        queryKey: pageQueryKey,
        enabled: pageQueryEnabled,
        queryFn: async () => {
            const filterStr = buildThreadsFilter({
                mailboxIds: visibleMailboxIds,
                userOrgIds: userOrgIdsForFolder,
                folder: filter.folder,
            })
            return pb.collection('mail_threads').getList<MailThreads>(page, PAGE_SIZE, {
                filter: filterStr,
                sort: '-latest_date',
                skipTotal: false,
            })
        },
    })

    const pageThreads = useMemo(() => pageResult?.items ?? [], [pageResult])
    const totalItems = pageResult?.totalItems ?? 0
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))

    // Draft messages we may need to populate the compose window when the user
    // clicks a draft row. Scoped to the user's visible mailboxes via the
    // thread relation — drafts are sparse so the result set stays small.
    // The "does this thread have a draft?" marker on rows comes from the
    // mail_threads.has_draft denormalized column, not this query.
    //
    // PocketBase's relation-traversal filter (thread.mailbox) isn't expressible
    // through tanstack/db's query builder, so this query goes direct to PB
    // through React Query rather than useLiveQuery. Realtime is unnecessary
    // because we only consult the cache when the user clicks a draft row;
    // the draft icon itself comes from has_draft on the thread.
    const draftQueryKey = useMemo(
        () => ['mail_drafts_for_mailboxes', visibleMailboxIds.slice().sort().join(',')],
        [visibleMailboxIds]
    )
    const { data: draftMessagesResp } = useQuery({
        queryKey: draftQueryKey,
        enabled: visibleMailboxIds.length > 0,
        queryFn: async () => {
            const mbClause =
                visibleMailboxIds.length === 1
                    ? `thread.mailbox = ${quote(visibleMailboxIds[0])}`
                    : `(${visibleMailboxIds.map((id) => `thread.mailbox = ${quote(id)}`).join(' || ')})`
            return pb.collection('mail_messages').getFullList<MailMessages>({
                filter: `delivery_status = "draft" && ${mbClause}`,
            })
        },
    })
    const draftMessages = draftMessagesResp ?? []

    // Local indexes against the (eager) supporting data.
    const stateByThread = useMemo(() => {
        const map = new Map<string, MailThreadState>()
        for (const s of (threadStates ?? []) as MailThreadState[]) {
            map.set(s.thread, s)
        }
        return map
    }, [threadStates])

    const assignmentsByRecord = useMemo(() => {
        const map = new Map<string, string[]>()
        for (const a of allAssignments ?? []) {
            const list = map.get(a.record_id) ?? []
            list.push(a.label)
            map.set(a.record_id, list)
        }
        return map
    }, [allAssignments])

    const draftByThread = useMemo(() => {
        const map = new Map<string, MailMessages>()
        for (const msg of draftMessages) map.set(msg.thread, msg)
        return map
    }, [draftMessages])

    const threadMap = useMemo(() => {
        const map = new Map<string, MailThreads>()
        for (const t of pageThreads) map.set(t.id, t)
        return map
    }, [pageThreads])

    const mailboxLabelMap = useMemo(() => {
        if (!isUnified || !allMailboxes || !userMemberships) return null
        const myMailboxIds = new Set(userMemberships.map((m) => m.mailbox))
        const map = new Map<string, string>()
        for (const mb of allMailboxes) {
            if (!myMailboxIds.has(mb.id)) continue
            map.set(mb.id, getMailboxLabel(mb, mb.type === 'personal'))
        }
        return map
    }, [isUnified, allMailboxes, userMemberships])

    // Build the visible items — server already returned them in latest_date
    // desc order, so we render in iteration order.
    const items: ThreadListItem[] = useMemo(() => {
        const out: ThreadListItem[] = []
        for (const thread of pageThreads) {
            const state = stateByThread.get(thread.id)
            if (!state) continue // shouldn't happen — server filter requires a state row
            const labelIds = assignmentsByRecord.get(state.id) ?? []
            const stateLabels = labelIds
                .map((id) => labelMap.get(id))
                .filter((l): l is { id: string; name: string; color: string } => l != null)
            const mailboxLabel = isUnified ? mailboxLabelMap?.get(thread.mailbox) : undefined
            out.push(
                toThreadListItem(
                    state,
                    thread,
                    stateLabels,
                    thread.has_draft ?? false,
                    thread.has_attachments ?? false,
                    mailboxLabel
                )
            )
        }

        // Label intersection: filter to threads tagged with all selected labels.
        if (filter.labels.length > 0) {
            return out.filter((item) => filter.labels.every((id) => item.labels.some((l) => l.id === id)))
        }
        return out
    }, [
        pageThreads,
        stateByThread,
        assignmentsByRecord,
        labelMap,
        isUnified,
        mailboxLabelMap,
        filter.labels,
    ])

    // First-load gate: page query + always-needed support queries.
    const isLoading = pageLoading || threadStatesLoading || assignmentsLoading

    // Publish the visible thread IDs so the conversation detail screen can
    // navigate prev/next within the same page.
    const setThreadIds = useThreadListStore((s) => s.setThreadIds)
    const prevIdsKeyRef = useRef('')
    useEffect(() => {
        const ids = items.map((i) => i.threadId)
        const key = ids.join(',')
        if (key !== prevIdsKeyRef.current) {
            prevIdsKeyRef.current = key
            setThreadIds(ids)
        }
    }, [items, setThreadIds])

    return {
        items,
        labels,
        labelMap,
        draftByThread,
        threadMap,
        threadStateCollection,
        isLoading,
        page,
        totalPages,
        totalItems,
    }
}

// Build a PocketBase filter expression for the paginated mail_threads query.
// Uses back-relation syntax (mail_thread_state_via_thread.<field>) so the
// server joins state and threads itself — no need to pre-fetch thread ids.
function buildThreadsFilter(params: {
    mailboxIds: string[]
    userOrgIds: string[]
    folder: string | null
}): string {
    const clauses: string[] = []

    if (params.mailboxIds.length === 1) {
        clauses.push(`mailbox = ${quote(params.mailboxIds[0])}`)
    } else {
        clauses.push(`(${params.mailboxIds.map((id) => `mailbox = ${quote(id)}`).join(' || ')})`)
    }

    // Each thread must have a thread_state row owned by one of the relevant
    // user_orgs (just the user normally; widened to co-members on shared
    // mailbox sent/drafts views).
    if (params.userOrgIds.length === 1) {
        clauses.push(
            `mail_thread_state_via_thread.user_org ?= ${quote(params.userOrgIds[0])}`
        )
    } else {
        clauses.push(
            `(${params.userOrgIds.map((id) => `mail_thread_state_via_thread.user_org ?= ${quote(id)}`).join(' || ')})`
        )
    }

    // Folder semantics mirror computeMailboxFolderCounts:
    //   inbox    — folder='inbox' (no unread restriction; the row visibility
    //              isn't a count, the unread is a row-level visual)
    //   starred  — is_starred=true (any folder)
    //   all      — every state row for the user, no folder restriction
    //   <other>  — folder=<value>
    const folder = params.folder ?? 'inbox'
    if (folder === 'starred') {
        clauses.push('mail_thread_state_via_thread.is_starred ?= true')
    } else if (folder === 'all' || folder === 'all-inboxes') {
        // No folder restriction beyond having a state row in the right scope.
    } else {
        clauses.push(`mail_thread_state_via_thread.folder ?= ${quote(folder)}`)
    }

    return clauses.join(' && ')
}

// PocketBase filter values — same shape as pb.filter() but inline so we don't
// need an extra round-trip through the filter helper.
function quote(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
