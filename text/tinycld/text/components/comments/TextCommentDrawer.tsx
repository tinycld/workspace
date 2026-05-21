import type { Thread } from '@tinycld/core/lib/comments'
import { useCommentsDrawerStore } from '@tinycld/core/lib/stores/comments-drawer-store'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { CommentDrawer, type CommentDrawerGroup } from '@tinycld/core/ui/comments'
import { useMemo } from 'react'
import { useCommentMutations } from '../../hooks/use-comment-mutations'
import type { CommentRow, DocumentCommentsResult } from '../../hooks/use-document-comments'
import type { DocumentCommentBridge } from '../../hooks/use-document-editor'
import { useMentionSuggestions } from '../../hooks/use-mention-suggestions'

export interface TextCommentDrawerProps {
    driveItemId: string
    documentComments: DocumentCommentsResult
    commentBridge: DocumentCommentBridge | null
}

// Drawer mounted at the document screen level. Groups threads by
// comment_id (each anchored mark range owns one or more threads),
// labels groups with the first comment's body truncated for context,
// and falls back to quoted_text when an anchor is orphaned. Jumping
// asks the bridge to focus the marked range; orphaned groups skip
// the jump.
export function TextCommentDrawer({
    driveItemId,
    documentComments,
    commentBridge,
}: TextCommentDrawerProps) {
    const isOpen = useCommentsDrawerStore(s => s.isOpen)
    const storeDriveItemId = useCommentsDrawerStore(s => s.driveItemId)
    const focusedThreadId = useCommentsDrawerStore(s => s.focusedThreadId)
    const close = useCommentsDrawerStore(s => s.close)
    const focusThread = useCommentsDrawerStore(s => s.focusThread)

    const drawerIsOpen = isOpen && storeDriveItemId === driveItemId

    const { userOrgId } = useCurrentRole()
    const { reply, editBody, resolve, reopen, remove } = useCommentMutations()
    const mentionSuggestions = useMentionSuggestions(userOrgId)

    const { threadsByCommentId, orphanedCommentIds } = documentComments

    const groups = useMemo(
        () => buildGroups(threadsByCommentId, orphanedCommentIds),
        [threadsByCommentId, orphanedCommentIds]
    )

    if (!drawerIsOpen) return null

    return (
        <CommentDrawer<CommentRow>
            isOpen={drawerIsOpen}
            onClose={close}
            groups={groups}
            currentUserOrgId={userOrgId}
            focusedThreadId={focusedThreadId}
            onJump={group => {
                focusThread(group.threads[0]?.root.id ?? null)
                if (group.isOrphaned) return
                // Ask the bridge to scroll the marked range into view
                // and select it. `focusComment` resolves with false
                // when the mark is missing from the doc — that
                // shouldn't happen here because we already skipped
                // orphaned groups, but race conditions (a peer removed
                // the text between the last paint and the click) can
                // land us here; the drawer's focusThread is still
                // meaningful. Native rounds through the WebView, so
                // we fire-and-forget the Promise.
                void commentBridge?.focusComment(group.key)
            }}
            isReplyPending={reply.isPending}
            replyError={reply.error ? String(reply.error.message ?? reply.error) : null}
            onReply={(group, threadId, body) => {
                const commentId = group.key
                const quotedText = group.quotedText ?? ''
                reply.mutate({
                    driveItemId,
                    commentId,
                    quotedText,
                    parentId: threadId,
                    body,
                })
            }}
            onEdit={(id, body) => editBody.mutate({ id, body })}
            onDelete={id => remove.mutate({ id })}
            onResolve={id => resolve.mutate({ id })}
            onReopen={id => reopen.mutate({ id })}
            mentionSuggestions={mentionSuggestions}
        />
    )
}

function buildGroups(
    threadsByCommentId: Map<string, Thread<CommentRow>[]>,
    orphanedCommentIds: Set<string>
): CommentDrawerGroup<CommentRow>[] {
    const groups: CommentDrawerGroup<CommentRow>[] = []
    for (const [commentId, threads] of threadsByCommentId) {
        if (threads.length === 0) continue
        const isOrphaned = orphanedCommentIds.has(commentId)
        const quoted = threads[0]?.root.quoted_text ?? ''
        const label = makeLabel(threads[0]?.root.body ?? '', quoted)
        groups.push({
            key: commentId,
            label,
            threads,
            isOrphaned,
            quotedText: quoted || null,
        })
    }
    groups.sort((a, b) => {
        const aOrphaned = a.isOrphaned ? 1 : 0
        const bOrphaned = b.isOrphaned ? 1 : 0
        if (aOrphaned !== bOrphaned) return aOrphaned - bOrphaned
        const aResolved = a.threads.every(t => t.resolvedAt != null) ? 1 : 0
        const bResolved = b.threads.every(t => t.resolvedAt != null) ? 1 : 0
        if (aResolved !== bResolved) return aResolved - bResolved
        return a.label.localeCompare(b.label)
    })
    return groups
}

function makeLabel(body: string, quoted: string): string {
    const source = body || quoted
    const trimmed = source.replace(/\s+/g, ' ').trim()
    if (trimmed.length <= 40) return trimmed || 'Comment'
    return `${trimmed.slice(0, 40)}…`
}
