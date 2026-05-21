import { errorToString } from '@tinycld/core/lib/errors'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { FormErrorSummary, TextAreaInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Menu } from '@tinycld/core/ui/menu'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useCommentMutations } from '../../hooks/use-comment-mutations'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { CommentRow, Thread } from '../../lib/comments'
import { useCommentsContext } from './CommentsContext'

interface CommentPopoverProps {
    driveItemId: string
    sheetId: string
}

const replySchema = z.object({
    body: z.string().trim().min(1, 'Required').max(4000),
})

type ReplyFormValues = z.infer<typeof replySchema>

const editSchema = z.object({
    body: z.string().trim().min(1, 'Required').max(4000),
})

type EditFormValues = z.infer<typeof editSchema>

// Anchored at the cursor where the user opened the popover (or at the
// cell rect center for the keyboard shortcut path). Same Menu primitive
// the cell context menu uses, with a 0×0 trigger rect — see
// CellContextMenu.tsx for the pattern.
export function CommentPopover({ driveItemId, sheetId }: CommentPopoverProps) {
    const target = useGridStore(s => s.commentTarget)
    const store = useGridStoreApi()
    const ctx = useCommentsContext()

    const onClose = useCallback(() => store.getState().closeCommentPopover(), [store])
    const contentRef = useRef<View | null>(null)

    // Web: outside-click dismissal. Mirrors CellContextMenu's pattern.
    // The handler is registered on the next paint after open so the
    // pointerdown that opened the popover (still mid-flight in the
    // capture phase) doesn't immediately dismiss it. setTimeout(0) is
    // enough to defer past the in-flight event loop.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (target == null) return
        let attached = false
        const handler = (event: PointerEvent) => {
            const targetNode = event.target as Node | null
            const node = contentRef.current as unknown as Node | null
            if (targetNode && node?.contains(targetNode)) return
            onClose()
        }
        const t = setTimeout(() => {
            document.addEventListener('pointerdown', handler, true)
            attached = true
        }, 0)
        return () => {
            clearTimeout(t)
            if (attached) document.removeEventListener('pointerdown', handler, true)
        }
    }, [target, onClose])

    const isOpen = target != null
    const triggerPos = target
        ? { x: target.cursor.x, y: target.cursor.y, width: 0, height: 0 }
        : null

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    const threads = target && ctx ? ctx.getThreads(sheetId, target.cell.row, target.cell.col) : []

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                )}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    {target ? (
                        <PopoverBody
                            driveItemId={driveItemId}
                            sheetId={sheetId}
                            row={target.cell.row}
                            col={target.cell.col}
                            threads={threads}
                            onClose={onClose}
                        />
                    ) : null}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

interface PopoverBodyProps {
    driveItemId: string
    sheetId: string
    row: number
    col: number
    threads: Thread[]
    onClose: () => void
}

function PopoverBody({ driveItemId, sheetId, row, col, threads, onClose }: PopoverBodyProps) {
    const { add, reply, editBody, resolve, reopen, remove } = useCommentMutations()
    const { userOrgId } = useCurrentRole()

    // Prefer the most-recent unresolved thread so the "Re-open" path
    // doesn't accidentally reopen the oldest one when multiple resolved
    // threads exist on the cell. Falls back to the most-recent thread
    // overall when nothing is unresolved.
    const activeThread =
        [...threads].reverse().find(t => t.resolvedAt == null) ??
        threads[threads.length - 1] ??
        null
    const isResolved = activeThread != null && activeThread.resolvedAt != null

    const {
        control,
        handleSubmit,
        reset,
        formState: { errors, isSubmitted },
    } = useForm<ReplyFormValues>({
        resolver: zodResolver(replySchema),
        defaultValues: { body: '' },
        mode: 'onChange',
    })

    const onSubmit = handleSubmit(values => {
        if (activeThread == null) {
            add.mutate(
                { driveItemId, sheetId, row, col, body: values.body },
                {
                    onSuccess: () => {
                        reset({ body: '' })
                    },
                }
            )
            return
        }
        reply.mutate(
            {
                driveItemId,
                sheetId,
                row,
                col,
                parentId: activeThread.root.id,
                body: values.body,
            },
            {
                onSuccess: () => {
                    reset({ body: '' })
                },
            }
        )
    })

    const onResolve = useCallback(() => {
        if (activeThread == null) return
        resolve.mutate({ id: activeThread.root.id }, { onSuccess: onClose })
    }, [activeThread, resolve, onClose])

    const onReopen = useCallback(() => {
        if (activeThread == null) return
        reopen.mutate({ id: activeThread.root.id })
    }, [activeThread, reopen])

    const submitError = add.error ?? reply.error
    const submitErrorText = submitError ? errorToString(submitError) : null

    return (
        <View style={{ width: 320, maxHeight: 480 }}>
            <View className="flex-row items-center justify-between px-3 py-2 border-b border-border">
                <Text className="text-sm font-semibold text-foreground">Comments</Text>
                {activeThread ? (
                    isResolved ? (
                        <Pressable
                            onPress={onReopen}
                            accessibilityLabel="Re-open comment"
                            className="px-2 py-1"
                        >
                            <Text className="text-xs font-semibold text-primary">Re-open</Text>
                        </Pressable>
                    ) : (
                        <Pressable
                            onPress={onResolve}
                            accessibilityLabel="Resolve comment"
                            className="px-2 py-1"
                        >
                            <Text className="text-xs font-semibold text-primary">Resolve</Text>
                        </Pressable>
                    )
                ) : null}
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
                {threads.length === 0 ? (
                    <View className="px-3 py-4">
                        <Text className="text-xs text-muted-foreground">
                            Be the first to comment
                        </Text>
                    </View>
                ) : (
                    threads.map(thread => (
                        <ThreadView
                            key={thread.root.id}
                            thread={thread}
                            currentUserOrgId={userOrgId}
                            onEdit={(id, body) => editBody.mutate({ id, body })}
                            onDelete={id => remove.mutate({ id })}
                        />
                    ))
                )}
            </ScrollView>
            <View className="px-3 py-2 border-t border-border">
                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                {submitErrorText ? (
                    <Text className="text-xs text-danger mb-2">{submitErrorText}</Text>
                ) : null}
                <TextAreaInput
                    control={control}
                    name="body"
                    placeholder={activeThread ? 'Reply…' : 'Add a comment…'}
                    autoFocus
                    numberOfLines={3}
                />
                <View className="flex-row justify-end gap-2 mt-2">
                    <Pressable
                        onPress={onClose}
                        accessibilityLabel="Cancel comment"
                        className="px-3 py-1.5 rounded-md"
                    >
                        <Text className="text-xs font-semibold text-muted-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={onSubmit}
                        accessibilityLabel="Post comment"
                        className="px-3 py-1.5 rounded-md bg-primary"
                        disabled={add.isPending || reply.isPending}
                        style={{ opacity: add.isPending || reply.isPending ? 0.6 : 1 }}
                    >
                        <Text className="text-xs font-semibold text-primary-foreground">
                            {activeThread ? 'Reply' : 'Comment'}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

interface ThreadViewProps {
    thread: Thread
    currentUserOrgId: string
    onEdit: (id: string, body: string) => void
    onDelete: (id: string) => void
}

function ThreadView({ thread, currentUserOrgId, onEdit, onDelete }: ThreadViewProps) {
    const dim = thread.resolvedAt != null
    return (
        <View className={`px-3 py-2 ${dim ? 'opacity-60' : ''}`}>
            <CommentLine
                comment={thread.root}
                isOwn={thread.root.author === currentUserOrgId}
                onEdit={onEdit}
                onDelete={onDelete}
            />
            {thread.replies.map(reply => (
                <View key={reply.id} className="mt-2 ml-2">
                    <CommentLine
                        comment={reply}
                        isOwn={reply.author === currentUserOrgId}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                </View>
            ))}
            {thread.resolvedAt != null && (
                <Text className="text-xs text-muted-foreground italic mt-1">
                    Resolved {formatTimestamp(thread.resolvedAt)}
                </Text>
            )}
        </View>
    )
}

interface CommentLineProps {
    comment: CommentRow
    isOwn: boolean
    onEdit: (id: string, body: string) => void
    onDelete: (id: string) => void
}

function CommentLine({ comment, isOwn, onEdit, onDelete }: CommentLineProps) {
    const [editing, setEditing] = useState(false)
    const { control, handleSubmit, reset } = useForm<EditFormValues>({
        resolver: zodResolver(editSchema),
        defaultValues: { body: comment.body },
        mode: 'onChange',
    })

    const onSave = handleSubmit(values => {
        onEdit(comment.id, values.body)
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
                <View className="flex-row justify-end gap-2">
                    <Pressable
                        onPress={onCancel}
                        accessibilityLabel="Cancel edit"
                        className="px-2 py-1"
                    >
                        <Text className="text-xs font-semibold text-muted-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
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
                {isOwn ? (
                    <View className="flex-row gap-2 ml-auto">
                        <Pressable
                            onPress={() => setEditing(true)}
                            accessibilityLabel="Edit comment"
                        >
                            <Text className="text-xs text-muted-foreground">Edit</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => onDelete(comment.id)}
                            accessibilityLabel="Delete comment"
                        >
                            <Text className="text-xs text-danger">Delete</Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>
            <Text className="text-sm text-foreground mt-0.5">{comment.body}</Text>
        </View>
    )
}

function formatTimestamp(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
}
