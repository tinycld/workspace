import type { BaseCommentRow, Thread } from '@tinycld/core/lib/comments'
import { TextAreaInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CommentComposer } from './CommentComposer'
import type { MentionSuggestion } from './MentionInput'
import { renderMentionsToText } from './mention-input-helpers'

const editSchema = z.object({
    body: z.string().trim().min(1, 'Required').max(4000),
})
type EditValues = z.infer<typeof editSchema>

export interface CommentThreadProps<R extends BaseCommentRow> {
    thread: Thread<R>
    currentUserOrgId: string
    // Orphan badge: anchor (cell / mark / …) is gone from the source.
    // Text gets these via the editor's onTransaction listener; calc
    // leaves it false (cells are never orphaned).
    isOrphaned?: boolean
    quotedText?: string | null
    isReplyPending?: boolean
    replyError?: string | null
    onReply: (body: string) => void
    onEdit: (commentId: string, body: string) => void
    onDelete: (commentId: string) => void
    onResolve: () => void
    onReopen: () => void
    // When supplied, the reply composer opens an @-mention popover
    // (handled by CommentComposer). Read-mode display of mention
    // tokens lives separately (renderMentionsToText).
    mentionSuggestions?: MentionSuggestion[]
}

// Generic thread renderer: root + replies, edit/delete (own only),
// resolve/reopen on the root, inline reply composer. Used by the
// drawer; the calc popover can switch to this in a follow-up.
export function CommentThread<R extends BaseCommentRow>(props: CommentThreadProps<R>) {
    const { thread, isOrphaned } = props
    const isResolved = thread.resolvedAt != null
    const dim = isResolved || isOrphaned

    // Build the user_org → display name map once per render so every
    // CommentLine's mention rendering is O(1) per token.
    const nameByUserOrgId = useMemo(() => {
        const m = new Map<string, string>()
        for (const s of props.mentionSuggestions ?? []) {
            m.set(s.userOrgId, s.displayName)
        }
        return m
    }, [props.mentionSuggestions])

    return (
        <View className={`px-3 py-3 border-b border-border ${dim ? 'opacity-60' : ''}`}>
            {isOrphaned ? (
                <View className="mb-2">
                    <Text className="text-xs text-muted-foreground italic">Anchor removed</Text>
                    {props.quotedText ? (
                        <Text className="text-xs text-muted-foreground mt-0.5">
                            “{props.quotedText}”
                        </Text>
                    ) : null}
                </View>
            ) : null}
            <CommentLine
                comment={thread.root}
                isOwn={thread.root.author === props.currentUserOrgId}
                onEdit={props.onEdit}
                onDelete={props.onDelete}
                nameByUserOrgId={nameByUserOrgId}
            />
            {thread.replies.map(reply => (
                <View key={reply.id} className="mt-2 ml-3">
                    <CommentLine
                        comment={reply}
                        isOwn={reply.author === props.currentUserOrgId}
                        onEdit={props.onEdit}
                        onDelete={props.onDelete}
                        nameByUserOrgId={nameByUserOrgId}
                    />
                </View>
            ))}
            {isResolved ? (
                <View className="flex-row items-center justify-between mt-2">
                    <Text className="text-xs text-muted-foreground italic">
                        Resolved {formatTimestamp(thread.resolvedAt ?? '')}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={props.onReopen}
                        accessibilityLabel="Re-open comment"
                        className="px-2 py-1"
                    >
                        <Text className="text-xs font-semibold text-primary">Re-open</Text>
                    </Pressable>
                </View>
            ) : (
                <View className="mt-3">
                    <CommentComposer
                        placeholder="Reply…"
                        submitLabel="Reply"
                        isPending={props.isReplyPending}
                        error={props.replyError ?? null}
                        onSubmit={props.onReply}
                        mentionSuggestions={props.mentionSuggestions}
                    />
                    <View className="flex-row justify-end mt-1">
                        <Pressable
                            accessibilityRole="button"
                            onPress={props.onResolve}
                            accessibilityLabel="Resolve comment"
                            className="px-2 py-1"
                        >
                            <Text className="text-xs font-semibold text-primary">Resolve</Text>
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    )
}

interface CommentLineProps<R extends BaseCommentRow> {
    comment: R
    isOwn: boolean
    onEdit: (id: string, body: string) => void
    onDelete: (id: string) => void
    // user_org → display name map used to render `[[@id]]` tokens as
    // `@<displayName>`. Empty map = literal pass-through, which leaves
    // the raw token visible. Passing the map down (rather than the
    // suggestion list directly) lets the parent batch the lookup once
    // for every line.
    nameByUserOrgId: Map<string, string>
}

function CommentLine<R extends BaseCommentRow>(props: CommentLineProps<R>) {
    const { comment } = props
    const [editing, setEditing] = useState(false)
    const displayBody = useMemo(
        () => renderMentionsToText(comment.body, props.nameByUserOrgId),
        [comment.body, props.nameByUserOrgId]
    )
    const { control, handleSubmit, reset } = useForm<EditValues>({
        resolver: zodResolver(editSchema),
        defaultValues: { body: comment.body },
        mode: 'onChange',
    })

    const onSave = handleSubmit(values => {
        props.onEdit(comment.id, values.body)
        setEditing(false)
    })

    const onCancel = useCallback(() => {
        reset({ body: comment.body })
        setEditing(false)
    }, [reset, comment.body])

    if (editing) {
        return (
            <View>
                <TextAreaInput control={control} name="body" autoFocus numberOfLines={2} />
                <View className="flex-row justify-end gap-2 mt-1">
                    <Pressable
                        accessibilityRole="button"
                        onPress={onCancel}
                        accessibilityLabel="Cancel edit"
                        className="px-2 py-1"
                    >
                        <Text className="text-xs font-semibold text-muted-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={onSave}
                        accessibilityLabel="Save edit"
                        className="px-2 py-1"
                    >
                        <Text className="text-xs font-semibold text-primary">Save</Text>
                    </Pressable>
                </View>
            </View>
        )
    }

    return (
        <View>
            <View className="flex-row items-baseline gap-2">
                <Text className="text-xs font-semibold text-foreground">{comment.author_name}</Text>
                <Text className="text-xs text-muted-foreground">
                    {formatTimestamp(comment.created)}
                </Text>
                {props.isOwn ? (
                    <View className="flex-row gap-2 ml-auto">
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => setEditing(true)}
                            accessibilityLabel="Edit comment"
                        >
                            <Text className="text-xs text-muted-foreground">Edit</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => props.onDelete(comment.id)}
                            accessibilityLabel="Delete comment"
                        >
                            <Text className="text-xs text-danger">Delete</Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>
            <Text className="text-sm text-foreground mt-0.5">{displayBody}</Text>
        </View>
    )
}

function formatTimestamp(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
}
