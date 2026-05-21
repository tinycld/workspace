import { useCommentsDrawerStore } from '@tinycld/core/lib/stores/comments-drawer-store'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { newRecordId } from 'pbtsdb/core'
import { useState } from 'react'
import { NewCommentModal } from '../components/comments/NewCommentModal'
import { useCommentMutations } from './use-comment-mutations'
import type { DocumentCommentBridge } from './use-document-editor'
import { useMentionSuggestions } from './use-mention-suggestions'

export interface UseNewCommentFlowArgs {
    driveItemId: string
    commentBridge: DocumentCommentBridge | null
    // True when the editor has no active range — both UI surfaces use
    // this to disable their trigger. The flow itself also re-checks
    // via getSelection() when start() runs, in case the toolbarState
    // snapshot is stale relative to the latest selection.
    selectionEmpty: boolean
    // When false (read-only document), nothing surfaces a way to start.
    editable: boolean
}

export interface NewCommentFlow {
    canStart: boolean
    isOpen: boolean
    start: () => void
    modal: React.ReactElement
}

// Owns the "new comment" composer modal and the mark-then-row flow.
// Used at the screen level so the toolbar button and the right-click
// context menu can both call start() — only one modal exists at a
// time and the mutation rollback path is shared.
export function useNewCommentFlow({
    driveItemId,
    commentBridge,
    selectionEmpty,
    editable,
}: UseNewCommentFlowArgs): NewCommentFlow {
    const [pendingRange, setPendingRange] = useState<{ from: number; to: number } | null>(null)
    const { add } = useCommentMutations()
    const openDrawer = useCommentsDrawerStore(s => s.open)
    const { userOrgId } = useCurrentRole()
    const mentionSuggestions = useMentionSuggestions(userOrgId)

    const canStart = editable && !selectionEmpty && commentBridge != null

    // getSelection is async because the native variant round-trips
    // through the WebView's message bus. The web variant resolves the
    // Promise synchronously, but awaiting in a fire-and-forget context
    // is cheap and keeps the call sites uniform across platforms.
    const start = () => {
        if (!canStart || !commentBridge) return
        void commentBridge.getSelection().then(range => {
            if (!range) return
            setPendingRange(range)
        })
    }

    const onCancel = () => {
        setPendingRange(null)
    }

    const onSubmit = (body: string) => {
        if (!commentBridge || !pendingRange) return
        const commentId = newRecordId()
        // Apply the mark first — passing the captured pendingRange so
        // the selection survives the modal's focus theft (the user's
        // visible selection on the page is gone by now). The PB row
        // lands second; on failure we strip the mark so we don't leave
        // a phantom underline with no thread behind it.
        commentBridge.addComment(commentId, pendingRange)
        add.mutate(
            {
                driveItemId,
                commentId,
                quotedText: '',
                body,
            },
            {
                onSuccess: () => {
                    openDrawer({ packageSlug: 'text', driveItemId })
                    setPendingRange(null)
                },
                onError: () => {
                    // PB rule rejection / network blip — roll back the
                    // mark so the doc doesn't accumulate orphaned
                    // marks for failed inserts. The composer stays
                    // open with the error surfaced by `add.error` so
                    // the user can retry without re-selecting.
                    commentBridge.removeComment(commentId)
                },
            }
        )
    }

    const isOpen = pendingRange != null

    const modal = (
        <NewCommentModal
            isOpen={isOpen}
            isPending={add.isPending}
            error={add.error ? String(add.error.message ?? add.error) : null}
            onCancel={onCancel}
            onSubmit={onSubmit}
            mentionSuggestions={mentionSuggestions}
        />
    )

    return { canStart, isOpen, start, modal }
}
