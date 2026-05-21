import { CommentComposer, type MentionSuggestion } from '@tinycld/core/ui/comments'
import { Modal, Pressable, Text } from 'react-native'

export interface NewCommentModalProps {
    isOpen: boolean
    isPending: boolean
    error: string | null
    onCancel: () => void
    onSubmit: (body: string) => void
    mentionSuggestions: MentionSuggestion[]
}

// Centered modal composer for starting a new comment thread. Owned by
// the screen so the modal lifecycle is the same regardless of which
// surface (toolbar button, context menu) triggered it.
export function NewCommentModal({
    isOpen,
    isPending,
    error,
    onCancel,
    onSubmit,
    mentionSuggestions,
}: NewCommentModalProps) {
    if (!isOpen) return null
    return (
        <Modal transparent animationType="fade" visible={isOpen} onRequestClose={onCancel}>
            <Pressable
                className="flex-1 items-center justify-center bg-black/30"
                onPress={onCancel}
            >
                <Pressable
                    onPress={e => e.stopPropagation?.()}
                    className="bg-background rounded-md p-4 min-w-[320px] max-w-[480px] border border-border"
                >
                    <Text className="text-sm font-semibold text-foreground mb-2">New comment</Text>
                    <CommentComposer
                        placeholder="Add a comment…"
                        submitLabel="Comment"
                        isPending={isPending}
                        error={error}
                        autoFocus
                        onCancel={onCancel}
                        onSubmit={onSubmit}
                        mentionSuggestions={mentionSuggestions}
                    />
                </Pressable>
            </Pressable>
        </Modal>
    )
}
