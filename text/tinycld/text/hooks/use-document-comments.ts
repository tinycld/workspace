import { eq } from '@tanstack/db'
import {
    type BaseCommentRow,
    buildThreads,
    groupCommentsByKey,
    type Thread,
} from '@tinycld/core/lib/comments'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useEffect, useMemo, useState } from 'react'
import type { TextComments } from '../types'
import type { DocumentCommentBridge } from './use-document-editor'

// Subset of TextComments the UI cares about. Compatible with the
// pbtsdb row shape so liveQuery results pass through unchanged.
export type CommentRow = Pick<
    TextComments,
    | 'id'
    | 'drive_item'
    | 'comment_id'
    | 'quoted_text'
    | 'parent_comment'
    | 'body'
    | 'resolved_at'
    | 'author'
    | 'author_name'
    | 'created'
>

// Compile-time guard: CommentRow must satisfy BaseCommentRow so it
// flows through the core thread helpers without coercion.
type _AssertBase = CommentRow extends BaseCommentRow ? true : never
const _checkBase: _AssertBase = true
void _checkBase

export interface DocumentCommentsResult {
    rows: CommentRow[]
    threadsByCommentId: Map<string, Thread<CommentRow>[]>
    getThread: (commentId: string) => Thread<CommentRow>[]
    // Comment ids whose anchor mark vanished from the editor (the
    // underlying text was deleted, or an undo wiped the mark). The PB
    // row stays; the drawer marks the group orphaned and falls back to
    // `quoted_text` for context.
    orphanedCommentIds: Set<string>
}

// Subscribes to every text_comments row for a single document, then
// groups them by comment_id once. Per-marker reads come off the
// pre-built map so each <CommentMarker /> render is O(1).
//
// Wired at the screen level so all marks share one subscription.
// Wrap with useOrgLiveQuery for the bootstrap-gating side effect:
// queries stay disabled until org context loads, preventing a
// cross-org flash while the user navigates between documents in
// different orgs. The query body itself doesn't filter by org —
// text_comments rows are scoped to a single drive_item, and PB rules
// gate access through drive_shares_via_item.
export function useDocumentComments(
    driveItemId: string,
    commentBridge: DocumentCommentBridge | null
): DocumentCommentsResult {
    const [textCommentsCollection] = useStore('text_comments')
    const { data: rows = [] } = useOrgLiveQuery(
        query =>
            query
                .from({ comment: textCommentsCollection })
                .where(({ comment }) => eq(comment.drive_item, driveItemId)),
        [driveItemId]
    )

    const [orphanedCommentIds, setOrphanedCommentIds] = useState<Set<string>>(
        () => new Set()
    )

    useEffect(() => {
        setOrphanedCommentIds(new Set())
    }, [driveItemId])

    useEffect(() => {
        if (!commentBridge) return
        return commentBridge.onRemoved(removed => {
            if (removed.length === 0) return
            setOrphanedCommentIds(prev => {
                const next = new Set(prev)
                for (const id of removed) next.add(id)
                return next
            })
        })
    }, [commentBridge])

    return useMemo(() => {
        const typedRows = rows as CommentRow[]
        const byCommentId = groupCommentsByKey(typedRows, r => r.comment_id)
        const threadsByCommentId = new Map<string, Thread<CommentRow>[]>()
        for (const [commentId, group] of byCommentId) {
            threadsByCommentId.set(commentId, buildThreads(group))
        }
        const getThread = (commentId: string) =>
            threadsByCommentId.get(commentId) ?? []
        return {
            rows: typedRows,
            threadsByCommentId,
            getThread,
            orphanedCommentIds,
        }
    }, [rows, orphanedCommentIds])
}
