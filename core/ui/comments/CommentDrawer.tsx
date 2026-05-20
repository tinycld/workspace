import type { BaseCommentRow, Thread } from '@tinycld/core/lib/comments'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    Drawer,
    DrawerBackdrop,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerHeader,
} from '@tinycld/core/ui/drawer'
import { X } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CommentThread } from './CommentThread'
import type { MentionSuggestion } from './MentionInput'

// Each group in the drawer represents a single anchor (one cell, one
// text mark range, ...). Packages produce these from their per-anchor
// threads — e.g. calc maps `cellKey` → label = "Sheet1!B7".
export interface CommentDrawerGroup<R extends BaseCommentRow> {
    key: string
    label: string
    threads: Thread<R>[]
    // Optional: marks the group as orphaned. Per-group rather than
    // per-thread because the anchor itself is what's gone.
    isOrphaned?: boolean
    quotedText?: string | null
}

type FilterKind = 'open' | 'resolved' | 'orphaned'

export interface CommentDrawerProps<R extends BaseCommentRow> {
    isOpen: boolean
    onClose: () => void
    groups: CommentDrawerGroup<R>[]
    currentUserOrgId: string
    focusedThreadId?: string | null
    // Click on a group's header (or any non-action area) jumps to the
    // anchor in the host surface (scroll + select for calc; scroll +
    // mark-highlight for text).
    onJump?: (group: CommentDrawerGroup<R>) => void
    isReplyPending?: boolean
    replyError?: string | null
    onReply: (group: CommentDrawerGroup<R>, threadId: string, body: string) => void
    onEdit: (commentId: string, body: string) => void
    onDelete: (commentId: string) => void
    onResolve: (threadId: string) => void
    onReopen: (threadId: string) => void
    // Optional @-mention candidate pool, forwarded to every thread's
    // reply composer. When omitted, the reply composer falls back to
    // a plain textarea.
    mentionSuggestions?: MentionSuggestion[]
}

export function CommentDrawer<R extends BaseCommentRow>(props: CommentDrawerProps<R>) {
    const [filter, setFilter] = useState<FilterKind>('open')
    const iconColor = useThemeColor('foreground')

    const counts = useMemo(() => countByFilter(props.groups), [props.groups])
    const visible = useMemo(() => filterGroups(props.groups, filter), [props.groups, filter])

    return (
        <Drawer isOpen={props.isOpen} onClose={props.onClose} anchor="right" size="md">
            <DrawerBackdrop />
            <DrawerContent>
                <DrawerHeader>
                    <Text className="text-base font-semibold text-foreground">Comments</Text>
                    <DrawerCloseButton onPress={props.onClose} accessibilityLabel="Close comments">
                        <X size={18} color={iconColor} />
                    </DrawerCloseButton>
                </DrawerHeader>
                <View className="flex-row gap-2 pb-2">
                    <FilterChip
                        label="Open"
                        count={counts.open}
                        isActive={filter === 'open'}
                        onPress={() => setFilter('open')}
                    />
                    <FilterChip
                        label="Resolved"
                        count={counts.resolved}
                        isActive={filter === 'resolved'}
                        onPress={() => setFilter('resolved')}
                    />
                    {counts.orphaned > 0 ? (
                        <FilterChip
                            label="Orphaned"
                            count={counts.orphaned}
                            isActive={filter === 'orphaned'}
                            onPress={() => setFilter('orphaned')}
                        />
                    ) : null}
                </View>
                <DrawerBody>
                    {visible.length === 0 ? (
                        <View className="py-8 items-center">
                            <Text className="text-sm text-muted-foreground">
                                {emptyStateLabel(filter)}
                            </Text>
                        </View>
                    ) : (
                        visible.map(group => (
                            <GroupView
                                key={group.key}
                                group={group}
                                currentUserOrgId={props.currentUserOrgId}
                                focusedThreadId={props.focusedThreadId}
                                onJump={props.onJump}
                                isReplyPending={props.isReplyPending}
                                replyError={props.replyError}
                                onReply={props.onReply}
                                onEdit={props.onEdit}
                                onDelete={props.onDelete}
                                onResolve={props.onResolve}
                                onReopen={props.onReopen}
                                mentionSuggestions={props.mentionSuggestions}
                            />
                        ))
                    )}
                </DrawerBody>
            </DrawerContent>
        </Drawer>
    )
}

interface GroupViewProps<R extends BaseCommentRow> {
    group: CommentDrawerGroup<R>
    currentUserOrgId: string
    focusedThreadId?: string | null
    onJump?: (group: CommentDrawerGroup<R>) => void
    isReplyPending?: boolean
    replyError?: string | null
    onReply: (group: CommentDrawerGroup<R>, threadId: string, body: string) => void
    onEdit: (commentId: string, body: string) => void
    onDelete: (commentId: string) => void
    onResolve: (threadId: string) => void
    onReopen: (threadId: string) => void
    mentionSuggestions?: MentionSuggestion[]
}

function GroupView<R extends BaseCommentRow>(props: GroupViewProps<R>) {
    const { group } = props
    return (
        <View className="mb-3 border border-border rounded-md overflow-hidden">
            <Pressable
                accessibilityRole="button"
                onPress={props.onJump ? () => props.onJump?.(group) : undefined}
                accessibilityLabel={`Jump to ${group.label}`}
                className="px-3 py-2 bg-surface-secondary border-b border-border"
            >
                <Text className="text-xs font-semibold text-foreground">{group.label}</Text>
            </Pressable>
            {group.threads.map(thread => (
                <CommentThread
                    key={thread.root.id}
                    thread={thread}
                    currentUserOrgId={props.currentUserOrgId}
                    isOrphaned={group.isOrphaned}
                    quotedText={group.quotedText}
                    isReplyPending={props.isReplyPending}
                    replyError={props.focusedThreadId === thread.root.id ? props.replyError : null}
                    onReply={body => props.onReply(group, thread.root.id, body)}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                    onResolve={() => props.onResolve(thread.root.id)}
                    onReopen={() => props.onReopen(thread.root.id)}
                    mentionSuggestions={props.mentionSuggestions}
                />
            ))}
        </View>
    )
}

interface FilterChipProps {
    label: string
    count: number
    isActive: boolean
    onPress: () => void
}

function FilterChip({ label, count, isActive, onPress }: FilterChipProps) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            accessibilityLabel={`Show ${label.toLowerCase()} comments`}
            className={`px-3 py-1 rounded-full border ${
                isActive ? 'bg-primary border-primary' : 'border-border'
            }`}
        >
            <Text
                className={`text-xs font-semibold ${
                    isActive ? 'text-primary-foreground' : 'text-foreground'
                }`}
            >
                {label} ({count})
            </Text>
        </Pressable>
    )
}

function countByFilter<R extends BaseCommentRow>(
    groups: CommentDrawerGroup<R>[]
): Record<FilterKind, number> {
    let open = 0
    let resolved = 0
    let orphaned = 0
    for (const g of groups) {
        if (g.isOrphaned) {
            orphaned += g.threads.length
            continue
        }
        for (const t of g.threads) {
            if (t.resolvedAt != null) resolved += 1
            else open += 1
        }
    }
    return { open, resolved, orphaned }
}

function filterGroups<R extends BaseCommentRow>(
    groups: CommentDrawerGroup<R>[],
    filter: FilterKind
): CommentDrawerGroup<R>[] {
    const out: CommentDrawerGroup<R>[] = []
    for (const g of groups) {
        const isGroupOrphaned = !!g.isOrphaned
        if (filter === 'orphaned') {
            if (isGroupOrphaned) out.push(g)
            continue
        }
        if (isGroupOrphaned) continue
        const wantResolved = filter === 'resolved'
        const threads = g.threads.filter(t => (t.resolvedAt != null) === wantResolved)
        if (threads.length > 0) out.push({ ...g, threads })
    }
    return out
}

function emptyStateLabel(filter: FilterKind): string {
    if (filter === 'resolved') return 'No resolved comments yet.'
    if (filter === 'orphaned') return 'No orphaned comments.'
    return 'No open comments.'
}
