import { LoadingState } from '@tinycld/core/components/LoadingState'
import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { SwipeableRowProvider } from '@tinycld/core/components/SwipeableRow'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { captureException } from '@tinycld/core/lib/errors'
import type { HelpTopicId } from '@tinycld/core/lib/help/types'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'

import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { pb, queryClient } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useScrollShadow } from '@tinycld/core/lib/use-scroll-shadow'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Archive, Inbox, Send, Star, Tag, Trash2, TriangleAlert, X } from 'lucide-react-native'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { Pressable, RefreshControl, Text, View } from 'react-native'
import { ComposeFAB } from '../components/ComposeFAB'
import { EmailListToolbar } from '../components/EmailListToolbar'
import { EmailRow } from '../components/EmailRow'
import type { ThreadListItem } from '../components/thread-list-item'
import { prettifyFolderKey, searchResultToThreadListItem } from '../hooks/mailListHelpers'
import { useCompose } from '../hooks/useComposeState'
import { useMailBulkActions } from '../hooks/useMailBulkActions'
import { useMailboxes } from '../hooks/useMailboxes'
import { useMailListShortcuts } from '../hooks/useMailListShortcuts'
import { useMailSelection } from '../hooks/useMailSelection'
import { useMailSearchState } from '../hooks/useSearchState'
import { PAGE_SIZE, UNIFIED_INBOX, useThreadListItems } from '../hooks/useThreadListItems'

function useQueryParams() {
    const { folder, label, mailbox, page } = useLocalSearchParams<{
        folder?: string
        label?: string
        mailbox?: string
        page?: string
    }>()
    const labels = label ? label.split(',').filter(Boolean) : []
    const parsedPage = page ? Number.parseInt(page, 10) : 1
    return {
        folder: folder ?? null,
        labels,
        mailbox: mailbox ?? null,
        page: Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
    }
}

function EmptyState({ folderTitle, isVisible }: { folderTitle: string; isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <View className="flex-1 items-center justify-center p-8">
            <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                No conversations in {folderTitle}
            </Text>
        </View>
    )
}

const FOLDER_ICONS: Record<string, typeof Inbox> = {
    sent: Send,
    drafts: Archive,
    spam: TriangleAlert,
    trash: Trash2,
    starred: Star,
    archive: Archive,
    'all-inboxes': Inbox,
}

function LabelChip({
    label,
    onDismiss,
}: {
    label: { id: string; name: string; color: string }
    onDismiss: () => void
}) {
    return (
        <View
            className="flex-row items-center gap-2 px-3 rounded-lg border"
            style={{
                paddingVertical: 6,
                backgroundColor: `${label.color}14`,
                borderColor: `${label.color}30`,
            }}
        >
            <View
                className="size-2 rounded-full"
                style={{
                    backgroundColor: label.color,
                }}
            />
            <Text style={{ fontSize: 13, fontWeight: '600', color: label.color }}>{label.name}</Text>
            <Pressable onPress={onDismiss} hitSlop={8}>
                <X size={14} color={label.color} />
            </Pressable>
        </View>
    )
}

function ActiveViewBanner({
    isVisible,
    folder,
    labels,
    onDismissLabel,
}: {
    isVisible: boolean
    folder: string | null
    labels: { id: string; name: string; color: string }[]
    onDismissLabel: (labelId: string) => void
}) {
    const accentColor = useThemeColor('primary')
    const router = useRouter()
    const orgHref = useOrgHref()

    if (!isVisible) return null

    const isLabelView = labels.length > 0

    if (isLabelView) {
        return (
            <View className="flex-row px-4 py-2 items-center gap-2 flex-wrap">
                {labels.map((label) => (
                    <LabelChip key={label.id} label={label} onDismiss={() => onDismissLabel(label.id)} />
                ))}
            </View>
        )
    }

    const folderKey = folder ?? ''
    const displayName = prettifyFolderKey(folderKey)
    const FolderIcon = folder ? (FOLDER_ICONS[folder] ?? Tag) : Tag

    return (
        <View className="flex-row px-4 py-2 items-center gap-2">
            <View
                className="flex-row items-center gap-2 px-3 rounded-lg border"
                style={{
                    paddingVertical: 6,
                    backgroundColor: `${accentColor}14`,
                    borderColor: `${accentColor}30`,
                }}
            >
                <FolderIcon size={14} color={accentColor} />
                <Text className="text-primary" style={{ fontSize: 13, fontWeight: '600' }}>
                    {displayName}
                </Text>
                <Pressable onPress={() => router.replace(orgHref('mail'))} hitSlop={8}>
                    <X size={14} color={accentColor} />
                </Pressable>
            </View>
        </View>
    )
}

function SearchResultsHeader({ total, isSearching }: { total: number; isSearching: boolean }) {
    return (
        <View className="px-3 py-2">
            <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                {isSearching ? 'Searching...' : `${total} result${total !== 1 ? 's' : ''}`}
            </Text>
        </View>
    )
}

function helpTopicForView(
    folder: string | null,
    labelCount: number,
    isSearchActive: boolean
): HelpTopicId {
    if (isSearchActive) return 'mail:search'
    if (labelCount > 0) return 'mail:labels'
    if (folder === null || folder === 'inbox' || folder === 'all-inboxes') return 'mail:reading-threads'
    return 'mail:folders'
}

export default function MailListScreen() {
    const { folder, labels, mailbox, page } = useQueryParams()
    const router = useRouter()
    const orgHref = useOrgHref()
    const breakpoint = useBreakpoint()
    const { userOrgId } = useCurrentRole()
    const { isScrolled, onScroll } = useScrollShadow()
    const { openDraft } = useCompose()
    const search = useMailSearchState()
    const { personal, shared } = useMailboxes()
    const unifiedAvailable = (personal ? 1 : 0) + shared.length >= 2
    const isDefaultView = folder === null && mailbox === null && labels.length === 0
    const isUnifiedView = folder === 'all-inboxes' || (isDefaultView && unifiedAvailable)
    const mailboxId = isUnifiedView ? UNIFIED_INBOX : (mailbox ?? personal?.id ?? '')

    // mail_folder_counts is a view collection (no realtime). Refetch on
    // folder/mailbox/label change so the sidebar self-heals on every nav.
    const labelKey = labels.join(',')
    useEffect(() => {
        queryClient.invalidateQueries({ queryKey: ['mail_folder_counts'] })
    }, [folder, mailbox, labelKey])

    const {
        items,
        labels: allLabels,
        labelMap,
        draftByThread,
        threadMap,
        threadStateCollection,
        isLoading,
        totalItems,
    } = useThreadListItems(
        userOrgId,
        {
            folder,
            labels,
            mailboxId,
        },
        { page }
    )

    const navigateToPage = useCallback(
        (nextPage: number) => {
            const params: Record<string, string> = {}
            if (folder) params.folder = folder
            if (mailbox) params.mailbox = mailbox
            if (labels.length > 0) params.label = labels.join(',')
            if (nextPage > 1) params.page = String(nextPage)
            router.replace(orgHref('mail', params))
        },
        [router, orgHref, folder, mailbox, labels]
    )

    const handlePrevPage = useCallback(() => {
        if (page > 1) navigateToPage(page - 1)
    }, [navigateToPage, page])

    const handleNextPage = useCallback(() => {
        if (page * PAGE_SIZE < totalItems) navigateToPage(page + 1)
    }, [navigateToPage, page, totalItems])

    const [isRefreshing, setIsRefreshing] = useState(false)
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true)
        try {
            await queryClient.invalidateQueries()
        } finally {
            setIsRefreshing(false)
        }
    }, [])

    const selection = useMailSelection(items, folder, labels)
    const bulkActions = useMailBulkActions(threadStateCollection, selection.selectedItems, selection.clearSelection)

    const listRef = useRef<FlashListRef<ThreadListItem>>(null)
    const scrollToFocusedIndex = useCallback((index: number) => {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
    }, [])

    const { focusedIndex } = useMailListShortcuts({
        items,
        router,
        toggleSelect: selection.toggle,
        isEnabled: !search.isActive,
        folder,
        labels,
        onFocusIndex: scrollToFocusedIndex,
    })

    const selectedItemLabelIds = useMemo(() => {
        if (selection.selectedItems.length === 0) return new Set<string>()
        const sets = selection.selectedItems.map((item) => new Set(item.labels.map((l) => l.id)))
        const firstIds = Array.from(sets[0])
        const intersection = new Set<string>(firstIds.filter((id) => sets.every((s) => s.has(id))))
        return intersection
    }, [selection.selectedItems])

    const toggleStar = useMutation({
        mutationFn: mutation(function* ({ stateId, currentStarred }: { stateId: string; currentStarred: boolean }) {
            yield threadStateCollection.update(stateId, (draft) => {
                draft.is_starred = !currentStarred
            })
        }),
    })

    const archiveThread = useMutation({
        mutationFn: mutation(function* ({ stateId, folder }: { stateId: string; folder: string }) {
            yield threadStateCollection.update(stateId, (draft) => {
                draft.folder = folder === 'archive' ? 'inbox' : 'archive'
            })
        }),
    })

    const trashThread = useMutation({
        mutationFn: mutation(function* ({ stateId, folder }: { stateId: string; folder: string }) {
            yield threadStateCollection.update(stateId, (draft) => {
                draft.folder = folder === 'trash' ? 'inbox' : 'trash'
            })
        }),
    })

    const toggleRead = useMutation({
        mutationFn: mutation(function* ({ stateId, currentRead }: { stateId: string; currentRead: boolean }) {
            yield threadStateCollection.update(stateId, (draft) => {
                draft.is_read = !currentRead
            })
        }),
    })

    const handleDraftPress = useCallback(
        async (item: ThreadListItem) => {
            const draft = draftByThread.get(item.threadId)
            if (!draft) return

            const htmlBody = draft.body_html
                ? await fetch(pb.files.getURL({ collectionId: 'mail_messages', id: draft.id }, draft.body_html))
                      .then((r) => r.text())
                      .catch((err) => {
                          captureException('mail.openDraft.fetchBody', err, { messageId: draft.id })
                          return ''
                      })
                : ''

            const draftThread = threadMap.get(draft.thread)
            openDraft({
                messageId: draft.id,
                threadId: item.threadId,
                subject: draft.subject ?? '',
                to: draft.recipients_to ?? [],
                cc: draft.recipients_cc ?? [],
                bcc: [],
                htmlBody,
                textBody: draft.snippet ?? '',
                mailboxId: draftThread?.mailbox ?? '',
                aliasId: draft.alias || null,
            })
        },
        [draftByThread, threadMap, openDraft]
    )

    const searchItems = useMemo(() => search.results.map(searchResultToThreadListItem), [search.results])

    const activeLabels = useMemo(
        () =>
            labels
                .map((id) => labelMap.get(id))
                .filter((l): l is { id: string; name: string; color: string } => l != null),
        [labels, labelMap]
    )

    const folderKey = folder ?? 'inbox'
    const folderTitle =
        activeLabels.length > 0 ? activeLabels.map((l) => l.name).join(', ') : prettifyFolderKey(folderKey)

    const isMobile = breakpoint === 'mobile'

    const isNonDefaultView =
        labels.length > 0 || (!!folder && folder !== 'inbox' && folder !== 'all-inboxes')
    const showActiveViewBanner = isMobile && isNonDefaultView

    const dismissLabel = useCallback(
        (labelId: string) => {
            const remaining = labels.filter((id) => id !== labelId)
            if (remaining.length === 0) {
                router.replace(orgHref('mail'))
            } else {
                router.replace(orgHref('mail', { label: remaining.join(',') }))
            }
        },
        [labels, router, orgHref]
    )

    const getItemType = useCallback(() => (isMobile ? 'mobile' : 'desktop'), [isMobile])

    const renderRow = useCallback(
        ({ item, index }: { item: ThreadListItem; index: number }) => (
            <MailListRow
                item={item}
                index={index}
                isMobile={isMobile}
                isFocused={index === focusedIndex}
                isSelected={selection.selectedIds.has(item.stateId)}
                onToggleSelect={selection.toggle}
                onToggleStar={toggleStar.mutate}
                onArchive={archiveThread.mutate}
                onTrash={trashThread.mutate}
                onToggleRead={toggleRead.mutate}
                onDraftPress={handleDraftPress}
            />
        ),
        [
            isMobile,
            focusedIndex,
            selection.selectedIds,
            selection.toggle,
            toggleStar.mutate,
            archiveThread.mutate,
            trashThread.mutate,
            toggleRead.mutate,
            handleDraftPress,
        ]
    )

    if (search.isActive) {
        return (
            <View className="flex-1">
                <SearchResultsHeader total={search.total} isSearching={search.isSearching} />
                {search.isSearching && searchItems.length === 0 ? (
                    <LoadingState />
                ) : searchItems.length === 0 ? (
                    <View className="flex-1 items-center justify-center p-8">
                        <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                            No results found
                        </Text>
                    </View>
                ) : (
                    <SwipeableRowProvider>
                        <FlashList
                            data={searchItems}
                            keyExtractor={(item) => item.threadId}
                            renderItem={({ item }) => <EmailRow email={item} isMobile={isMobile} />}
                        />
                    </SwipeableRowProvider>
                )}
            </View>
        )
    }

    const isEmpty = items.length === 0
    const showEmptyState = isEmpty && !isLoading
    const showLoadingState = isEmpty && isLoading
    const helpTopic = helpTopicForView(folder, labels.length, search.isActive)

    return (
        <View className="flex-1">
            <ActiveViewBanner
                isVisible={showActiveViewBanner}
                folder={folder}
                labels={activeLabels}
                onDismissLabel={dismissLabel}
            />
            <ScreenHeader isScrolled={isScrolled}>
                <EmailListToolbar
                    emailCount={items.length}
                    hasSelection={selection.hasSelection}
                    selectedCount={selection.selectedCount}
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    allSelectedRead={selection.allSelectedRead}
                    allSelectedStarred={selection.allSelectedStarred}
                    labels={allLabels}
                    selectedItemLabelIds={selectedItemLabelIds}
                    onToggleAll={selection.toggleAll}
                    onArchive={() => bulkActions.archiveSelected.mutate()}
                    onSpam={() => bulkActions.spamSelected.mutate()}
                    onTrash={() => bulkActions.trashSelected.mutate()}
                    onToggleRead={(markAsRead) => bulkActions.toggleReadSelected.mutate({ markAsRead })}
                    onMove={(folder) => bulkActions.moveSelected.mutate(folder)}
                    onToggleStar={(star) => bulkActions.toggleStarSelected.mutate({ star })}
                    onUpdateLabel={(labelId, add) => bulkActions.updateLabelsSelected.mutate({ labelId, add })}
                    onRefresh={handleRefresh}
                    isRefreshing={isRefreshing}
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalItems={totalItems}
                    onPrevPage={handlePrevPage}
                    onNextPage={handleNextPage}
                    helpTopic={helpTopic}
                />
            </ScreenHeader>
            {showLoadingState && <LoadingState />}
            <EmptyState folderTitle={folderTitle} isVisible={showEmptyState} />
            {!isEmpty && (
                <SwipeableRowProvider>
                    <FlashList
                        ref={listRef}
                        data={items}
                        keyExtractor={(item) => item.stateId}
                        getItemType={getItemType}
                        onScroll={onScroll}
                        scrollEventThrottle={16}
                        renderItem={renderRow}
                        refreshControl={
                            isMobile ? (
                                <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
                            ) : undefined
                        }
                    />
                </SwipeableRowProvider>
            )}
            <ComposeFAB isVisible={isMobile} />
        </View>
    )
}

interface MailListRowProps {
    item: ThreadListItem
    index: number
    isMobile: boolean
    isFocused: boolean
    isSelected: boolean
    onToggleSelect: (stateId: string) => void
    onToggleStar: (args: { stateId: string; currentStarred: boolean }) => void
    onArchive: (args: { stateId: string; folder: string }) => void
    onTrash: (args: { stateId: string; folder: string }) => void
    onToggleRead: (args: { stateId: string; currentRead: boolean }) => void
    onDraftPress: (item: ThreadListItem) => void
}

const MailListRow = memo(function MailListRow({
    item,
    index,
    isMobile,
    isFocused,
    isSelected,
    onToggleSelect,
    onToggleStar,
    onArchive,
    onTrash,
    onToggleRead,
    onDraftPress,
}: MailListRowProps) {
    const handleToggleSelect = useCallback(() => onToggleSelect(item.stateId), [onToggleSelect, item.stateId])
    const handleToggleStar = useCallback(
        () => onToggleStar({ stateId: item.stateId, currentStarred: item.isStarred }),
        [onToggleStar, item.stateId, item.isStarred]
    )
    const handleArchive = useCallback(
        () => onArchive({ stateId: item.stateId, folder: item.folder }),
        [onArchive, item.stateId, item.folder]
    )
    const handleTrash = useCallback(
        () => onTrash({ stateId: item.stateId, folder: item.folder }),
        [onTrash, item.stateId, item.folder]
    )
    const handleToggleRead = useCallback(
        () => onToggleRead({ stateId: item.stateId, currentRead: item.isRead }),
        [onToggleRead, item.stateId, item.isRead]
    )
    const handlePress = useMemo(() => (item.hasDraft ? () => onDraftPress(item) : undefined), [item, onDraftPress])

    return (
        <EmailRow
            email={item}
            isMobile={isMobile}
            index={index}
            isFocused={isFocused}
            isSelected={isSelected}
            onToggleSelect={handleToggleSelect}
            onToggleStar={handleToggleStar}
            onPress={handlePress}
            onArchive={handleArchive}
            onTrash={handleTrash}
            onToggleRead={handleToggleRead}
        />
    )
})
