import { and, eq } from '@tanstack/db'
import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { type Shortcut, useRegisterShortcut, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useScrollShadow } from '@tinycld/core/lib/use-scroll-shadow'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { Dimensions, Keyboard, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { type AttachmentGroup, AttachmentStrip } from '../components/AttachmentStrip'
import { EmailBody } from '../components/EmailBody'
import { EmailDetailToolbar } from '../components/EmailDetailToolbar'
import { MessageHeader, ThreadSubjectHeader } from '../components/EmailHeader'
import { InlineReply } from '../components/InlineReply'
import { NotFoundState } from '../components/NotFoundState'
import { filterOwnAddresses, pickDefaultFrom } from '../hooks/defaultFromIdentity'
import { useLabels, useThreadLabels } from '../hooks/useLabels'
import { useMailboxes } from '../hooks/useMailboxes'
import { useOpenReply } from '../hooks/useOpenReply'
import { useScrolledToBottom } from '../hooks/useScrolledToBottom'
import { useSendableIdentities } from '../hooks/useSendableIdentities'
import { useThreadActions } from '../hooks/useThreadActions'
import { useThreadNavigation } from '../hooks/useThreadNavigation'
import { useAttachmentPreviewStore } from '../stores/attachment-preview-store'
import { useAttachmentStripStore } from '../stores/attachment-strip-store'
import { useThreadExpansionStore } from '../stores/thread-expansion-store'
import { useThreadListContext } from '../stores/thread-list-store'
import type { MailMessages } from '../types'

function useAutoMarkAsRead(
    // biome-ignore lint/suspicious/noExplicitAny: pbtsdb collection type is deeply generic
    threadStateCollection: any,
    threadState: { id: string; is_read: boolean } | undefined,
    threadId: string
) {
    const markedRef = useRef<string | null>(null)
    const markAsRead = useMutation({
        mutationFn: mutation(function* (stateId: string) {
            yield threadStateCollection.update(stateId, (draft) => {
                draft.is_read = true
            })
        }),
    })
    if (threadState && !threadState.is_read && markedRef.current !== threadId) {
        markedRef.current = threadId
        markAsRead.mutate(threadState.id)
    }
}

export default function MailDetailScreen() {
    const { id = '' } = useLocalSearchParams<{ id: string }>()
    const openReply = useOpenReply()

    const [threadStateCollection, messagesCollection, threadsCollection] = useStore(
        'mail_thread_state',
        'mail_messages',
        'mail_threads'
    )

    const { data: threadStates } = useOrgLiveQuery(
        (query, { userOrgId }) =>
            query
                .from({ mail_thread_state: threadStateCollection })
                .where(({ mail_thread_state }) =>
                    and(eq(mail_thread_state.thread, id), eq(mail_thread_state.user_org, userOrgId))
                ),
        [id]
    )

    const threadState = threadStates?.[0]

    const { data: threads } = useOrgLiveQuery(
        (query) => query.from({ mail_threads: threadsCollection }).where(({ mail_threads }) => eq(mail_threads.id, id)),
        [id]
    )
    const thread = threads?.[0]

    const { personal, shared } = useMailboxes()
    const identities = useSendableIdentities()
    const userMailboxIds = new Set<string>()
    if (personal) userMailboxIds.add(personal.id)
    for (const mb of shared) userMailboxIds.add(mb.id)
    const hasAccess = !thread || userMailboxIds.has(thread.mailbox)

    const { data: messages } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_messages: messagesCollection })
                .where(({ mail_messages }) => eq(mail_messages.thread, id))
                .orderBy(({ mail_messages }) => mail_messages.date, 'asc'),
        [id]
    )

    const { labels: allLabels } = useLabels()
    const { labels, labelIds: threadLabelIds } = useThreadLabels(threadState?.id ?? '')

    useAutoMarkAsRead(threadStateCollection, threadState, id)

    const orgHref = useOrgHref()
    const initialFolderRef = useRef<string | null>(null)
    if (threadState?.folder && !initialFolderRef.current) {
        initialFolderRef.current = threadState.folder
    }
    const navigateBack = useNavigateBack(() => orgHref('mail', { folder: initialFolderRef.current ?? 'inbox' }))

    useShortcutScope('thread')
    const closeShortcut = useMemo<Shortcut>(
        () => ({
            id: 'mail.thread.close',
            keys: 'Escape',
            scope: 'thread',
            group: 'Mail',
            description: 'Close conversation',
            run: navigateBack,
        }),
        [navigateBack]
    )
    useRegisterShortcut(closeShortcut)

    const { archiveThread, spamThread, trashThread, moveThread, toggleRead, toggleStar, updateLabel } =
        useThreadActions(threadStateCollection, threadState, navigateBack)

    const { threadIds } = useThreadListContext()
    const { hasPrevious, hasNext, goToPrevious, goToNext } = useThreadNavigation(threadIds, id)

    const { isScrolled, onScroll: onScrollShadow } = useScrollShadow()
    const [dockHeight, setDockHeight] = useState(0)
    const [keyboardOffset, setKeyboardOffset] = useState(0)
    const dockRef = useRef<View | null>(null)
    const onDockLayout = useCallback((e: LayoutChangeEvent) => {
        setDockHeight(e.nativeEvent.layout.height)
    }, [])
    useEffect(() => {
        // The dock is `position: absolute, bottom: 0` of the screen root, but
        // the screen root usually doesn't extend to the actual screen bottom
        // (MobileTabBar / safe-area sit below). Measure how far below the
        // dock's parent bottom the screen actually extends, and subtract that
        // from the keyboard height so the dock rises exactly to the keyboard top.
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
        const showSub = Keyboard.addListener(showEvent, (e) => {
            dockRef.current?.measureInWindow((_x, y, _w, h) => {
                const screenH = Dimensions.get('screen').height
                const distanceBelowDockBottom = Math.max(0, screenH - (y + h))
                setKeyboardOffset(Math.max(0, e.endCoordinates.height - distanceBelowDockBottom))
            })
        })
        const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0))
        return () => {
            showSub.remove()
            hideSub.remove()
        }
    }, [])
    const {
        isAtBottom,
        onScroll: onScrollBottom,
        onContentSizeChange: onBottomContentSize,
        onLayout: onBottomLayout,
    } = useScrolledToBottom(dockHeight)
    const handleScroll = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            onScrollShadow(e)
            onScrollBottom(e)
        },
        [onScrollShadow, onScrollBottom]
    )
    const toggledMessages = useThreadExpansionStore((s) => s.toggled)
    const toggleExpanded = useThreadExpansionStore((s) => s.toggle)
    useThreadExpansionStore.getState().resetForThread(id)
    useAttachmentStripStore.getState().resetForThread(id)
    useAttachmentPreviewStore.getState().close()

    const messageList = messages ?? []
    const lastMessage = messageList[messageList.length - 1] as MailMessages | undefined

    const isMessageExpanded = (msg: MailMessages, index: number) => {
        const defaultExpanded = index === messageList.length - 1
        return toggledMessages.has(msg.id) ? !defaultExpanded : defaultExpanded
    }

    if (!threadState && !messages?.length) return <NotFoundState message="Email not found" />
    if (!hasAccess) return <NotFoundState message="Email not found" />

    const subject = messages?.[0]?.subject ?? ''

    const attachmentGroups: AttachmentGroup[] = messageList.flatMap((msg, index) => {
        if (!isMessageExpanded(msg, index)) return []
        if (!msg.has_attachments || !msg.attachments?.length) return []
        // attachment_thumbnail_map is added by the 1713000019 migration; the
        // generated schema may not include it yet on a fresh checkout, so read
        // it via a permissive accessor.
        const thumbnailMap = readThumbnailMap(msg)
        return [
            {
                messageId: msg.id,
                senderName: msg.sender_name,
                date: msg.date,
                filenames: msg.attachments as string[],
                thumbnailMap,
            },
        ]
    })

    const totalAttachmentCount = attachmentGroups.reduce((n, g) => n + g.filenames.length, 0)

    const mailboxId = thread?.mailbox ?? ''

    const handleForwardAll = () => {
        if (!lastMessage) return
        openReply({
            messageId: lastMessage.id,
            threadId: id,
            subject: `Fwd: ${subject}`,
            to: [],
            mailboxId,
            sentToAddresses: [
                ...(lastMessage.recipients_to ?? []).map((r) => r.email),
                ...(lastMessage.recipients_cc ?? []).map((r) => r.email),
            ],
        })
    }

    return (
        <View className="flex-1 bg-background" testID="mail-thread-detail">
            <ScreenHeader isScrolled={isScrolled}>
                <EmailDetailToolbar
                    threadState={threadState}
                    labels={allLabels}
                    threadLabelIds={threadLabelIds}
                    onBack={navigateBack}
                    onArchive={() => archiveThread.mutate()}
                    onSpam={() => spamThread.mutate()}
                    onTrash={() => trashThread.mutate()}
                    onMove={(folder) => moveThread.mutate(folder)}
                    onUpdateLabel={(labelId, add) => updateLabel.mutate({ labelId, add })}
                    onToggleRead={() => toggleRead.mutate()}
                    onToggleStar={() => toggleStar.mutate()}
                    onForwardAll={handleForwardAll}
                    onNewer={goToPrevious}
                    onOlder={goToNext}
                    hasNewer={hasPrevious}
                    hasOlder={hasNext}
                />
            </ScreenHeader>
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ flexGrow: 1, paddingBottom: dockHeight }}
                onScroll={handleScroll}
                onContentSizeChange={onBottomContentSize}
                onLayout={onBottomLayout}
                scrollEventThrottle={16}
            >
                <ThreadSubjectHeader subject={subject} labels={labels} />
                {messageList.map((msg, index) => {
                    const expanded = isMessageExpanded(msg, index)
                    return (
                        <View key={msg.id}>
                            <MessageHeader
                                senderName={msg.sender_name}
                                senderEmail={msg.sender_email}
                                date={msg.date}
                                isStarred={threadState?.is_starred}
                                deliveryStatus={msg.delivery_status}
                                bounceReason={msg.bounce_reason}
                                isExpanded={expanded}
                                onToggleExpand={() => toggleExpanded(msg.id)}
                                onToggleStar={() => toggleStar.mutate()}
                                onReply={() =>
                                    openReply({
                                        messageId: msg.id,
                                        threadId: id,
                                        subject: msg.subject,
                                        to: [{ name: msg.sender_name, email: msg.sender_email }],
                                        mailboxId,
                                        sentToAddresses: [
                                            ...(msg.recipients_to ?? []).map((r) => r.email),
                                            ...(msg.recipients_cc ?? []).map((r) => r.email),
                                        ],
                                    })
                                }
                                onReplyAll={() => {
                                    const replyAddresses = [
                                        ...(msg.recipients_to ?? []).map((r) => r.email),
                                        ...(msg.recipients_cc ?? []).map((r) => r.email),
                                    ]
                                    const defaultFrom = pickDefaultFrom({
                                        mode: 'reply',
                                        identities,
                                        replyToAddresses: replyAddresses,
                                    })
                                    const identity = identities.find((i) => i.mailboxId === defaultFrom.mailboxId)
                                    const rawTo = [
                                        { name: msg.sender_name, email: msg.sender_email },
                                        ...(msg.recipients_to ?? []),
                                        ...(msg.recipients_cc ?? []),
                                    ]
                                    const filteredTo = identity
                                        ? filterOwnAddresses({ identity, recipients: rawTo })
                                        : rawTo
                                    openReply({
                                        messageId: msg.id,
                                        threadId: id,
                                        subject: msg.subject,
                                        to: filteredTo,
                                        mailboxId,
                                        sentToAddresses: replyAddresses,
                                    })
                                }}
                                onForward={() =>
                                    openReply({
                                        messageId: msg.id,
                                        threadId: id,
                                        subject: `Fwd: ${msg.subject}`,
                                        to: [],
                                        mailboxId,
                                        sentToAddresses: [
                                            ...(msg.recipients_to ?? []).map((r) => r.email),
                                            ...(msg.recipients_cc ?? []).map((r) => r.email),
                                        ],
                                    })
                                }
                            />
                            {expanded ? (
                                <EmailBody
                                    collectionId="mail_messages"
                                    recordId={msg.id}
                                    filename={msg.body_html}
                                    cidMap={msg.cid_map}
                                />
                            ) : (
                                <CollapsedSnippet snippet={msg.snippet} onPress={() => toggleExpanded(msg.id)} />
                            )}
                        </View>
                    )
                })}
            </ScrollView>
            <View
                ref={dockRef}
                className="absolute left-0 right-0 bg-background"
                style={{ bottom: keyboardOffset }}
                pointerEvents="box-none"
                onLayout={onDockLayout}
            >
                <AttachmentStrip
                    collectionId="mail_messages"
                    groups={attachmentGroups}
                    totalCount={totalAttachmentCount}
                    isAtBottom={isAtBottom}
                />
                {lastMessage ? (
                    <InlineReply
                        messageId={lastMessage.id}
                        threadId={id}
                        subject={lastMessage.subject}
                        senderName={lastMessage.sender_name}
                        senderEmail={lastMessage.sender_email}
                        recipientsTo={lastMessage.recipients_to ?? []}
                        recipientsCc={lastMessage.recipients_cc ?? []}
                        mailboxId={mailboxId}
                    />
                ) : null}
            </View>
        </View>
    )
}

function CollapsedSnippet({ snippet, onPress }: { snippet: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress}>
            <View className="px-4 py-2 border-b border-border">
                <Text className="text-muted-foreground" style={{ fontSize: 13 }} numberOfLines={1}>
                    {snippet}
                </Text>
            </View>
        </Pressable>
    )
}

function readThumbnailMap(msg: unknown): Record<string, string> | undefined {
    const raw = (msg as { attachment_thumbnail_map?: unknown })?.attachment_thumbnail_map
    if (!raw || typeof raw !== 'object') return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length > 0 ? out : undefined
}
