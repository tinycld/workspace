import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import type { HelpTopicId } from '@tinycld/core/lib/help/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    Archive,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    FolderInput,
    Mail,
    MailOpen,
    RefreshCw,
    Square,
    SquareCheck,
    SquareMinus,
    Star,
    Tag,
    Trash2,
} from 'lucide-react-native'
import { useMemo } from 'react'
import { Pressable, Text } from 'react-native'
import type { MailThreadState } from '../types'
import { MenuActionItem } from './DropdownMenu'

interface LabelInfo {
    id: string
    name: string
    color: string
}

interface EmailListToolbarProps {
    emailCount: number
    hasSelection: boolean
    selectedCount: number
    allSelected: boolean
    someSelected: boolean
    allSelectedRead: boolean
    allSelectedStarred: boolean
    labels: LabelInfo[]
    selectedItemLabelIds: Set<string>
    onToggleAll: () => void
    onArchive: () => void
    onSpam: () => void
    onTrash: () => void
    onToggleRead: (markAsRead: boolean) => void
    onMove: (folder: MailThreadState['folder']) => void
    onToggleStar: (star: boolean) => void
    onUpdateLabel: (labelId: string, add: boolean) => void
    onRefresh?: () => void
    isRefreshing?: boolean
    /** 1-based page number. */
    page: number
    /** Visible items on the current page. */
    pageSize: number
    /** Total threads across every page. */
    totalItems: number
    onPrevPage: () => void
    onNextPage: () => void
    helpTopic: HelpTopicId
}

export function EmailListToolbar(props: EmailListToolbarProps) {
    const breakpoint = useBreakpoint()

    if (breakpoint === 'mobile') return null

    if (props.hasSelection) return <BulkActionsToolbar {...props} />
    return <DefaultToolbar {...props} />
}

function helpRightItem(topic: HelpTopicId): ToolbarItem {
    return {
        type: 'custom',
        key: 'help',
        element: <HelpIcon topic={topic} size={18} />,
    }
}

function DefaultToolbar({
    emailCount,
    onToggleAll,
    onRefresh,
    isRefreshing,
    page,
    pageSize,
    totalItems,
    onPrevPage,
    onNextPage,
    helpTopic,
}: EmailListToolbarProps) {
    const mutedColor = useThemeColor('muted-foreground')

    const items: ToolbarItem[] = useMemo(
        () => [
            {
                type: 'custom',
                key: 'select-all',
                element: (
                    <Pressable className="p-2" onPress={onToggleAll}>
                        <Square size={18} color={mutedColor} />
                    </Pressable>
                ),
            },
            {
                type: 'button',
                key: 'refresh',
                icon: RefreshCw,
                label: 'Refresh',
                onPress: onRefresh ?? (() => {}),
                disabled: isRefreshing,
            },
        ],
        [onToggleAll, mutedColor, onRefresh, isRefreshing]
    )

    const paginationItems = usePaginationRightItems({
        emailCount,
        page,
        pageSize,
        totalItems,
        onPrevPage,
        onNextPage,
    })
    const rightItems = useMemo(
        () => [...paginationItems, helpRightItem(helpTopic)],
        [paginationItems, helpTopic]
    )

    return <ResponsiveToolbar items={items} rightItems={rightItems} />
}

const MOVE_FOLDERS: { label: string; folder: MailThreadState['folder'] }[] = [
    { label: 'Inbox', folder: 'inbox' },
    { label: 'Sent', folder: 'sent' },
    { label: 'Drafts', folder: 'drafts' },
    { label: 'Spam', folder: 'spam' },
    { label: 'Trash', folder: 'trash' },
    { label: 'Archive', folder: 'archive' },
]

function BulkActionsToolbar({
    emailCount,
    selectedCount,
    allSelected,
    someSelected,
    allSelectedRead,
    allSelectedStarred,
    labels,
    selectedItemLabelIds,
    onToggleAll,
    onArchive,
    onSpam,
    onTrash,
    onToggleRead,
    onMove,
    onToggleStar,
    onUpdateLabel,
    page,
    pageSize,
    totalItems,
    onPrevPage,
    onNextPage,
    helpTopic,
}: EmailListToolbarProps) {
    const foregroundColor = useThemeColor('foreground')
    const primaryColor = useThemeColor('primary')

    const SelectIcon = allSelected ? SquareCheck : someSelected ? SquareMinus : Square

    const ReadIcon = allSelectedRead ? MailOpen : Mail
    const readLabel = allSelectedRead ? 'Mark as unread' : 'Mark as read'

    const items: ToolbarItem[] = useMemo(
        () => [
            {
                type: 'custom',
                key: 'select-all',
                element: (
                    <Pressable className="p-2" onPress={onToggleAll}>
                        <SelectIcon size={18} color={primaryColor} />
                    </Pressable>
                ),
            },
            {
                type: 'custom',
                key: 'selected-count',
                element: (
                    <Text style={{ fontSize: 13, marginHorizontal: 4, color: foregroundColor }}>
                        {selectedCount} selected
                    </Text>
                ),
            },
            { type: 'button', key: 'archive', icon: Archive, label: 'Archive', onPress: onArchive },
            {
                type: 'button',
                key: 'spam',
                icon: CircleAlert,
                label: 'Report spam',
                onPress: onSpam,
            },
            { type: 'button', key: 'trash', icon: Trash2, label: 'Delete', onPress: onTrash },
            { type: 'separator' },
            {
                type: 'button',
                key: 'read',
                icon: ReadIcon,
                label: readLabel,
                onPress: () => onToggleRead(!allSelectedRead),
            },
            {
                type: 'menu',
                key: 'move',
                icon: FolderInput,
                label: 'Move to',
                children: MOVE_FOLDERS.map(({ label, folder }) => (
                    <MenuActionItem key={folder} label={label} onPress={() => onMove(folder)} />
                )),
            },
            {
                type: 'menu',
                key: 'labels',
                icon: Tag,
                label: 'Labels',
                children: labels.map((lbl) => {
                    const isActive = selectedItemLabelIds.has(lbl.id)
                    return (
                        <MenuActionItem
                            key={lbl.id}
                            label={lbl.name}
                            colorDot={lbl.color}
                            isActive={isActive}
                            onPress={() => onUpdateLabel(lbl.id, !isActive)}
                        />
                    )
                }),
            },
            {
                type: 'button',
                key: 'star',
                icon: Star,
                label: allSelectedStarred ? 'Remove star' : 'Add star',
                onPress: () => onToggleStar(!allSelectedStarred),
            },
        ],
        [
            onToggleAll,
            SelectIcon,
            primaryColor,
            foregroundColor,
            selectedCount,
            onArchive,
            onSpam,
            onTrash,
            ReadIcon,
            readLabel,
            allSelectedRead,
            onToggleRead,
            onMove,
            labels,
            selectedItemLabelIds,
            onUpdateLabel,
            allSelectedStarred,
            onToggleStar,
        ]
    )

    const paginationItems = usePaginationRightItems({
        emailCount,
        page,
        pageSize,
        totalItems,
        onPrevPage,
        onNextPage,
    })
    const rightItems = useMemo(
        () => [...paginationItems, helpRightItem(helpTopic)],
        [paginationItems, helpTopic]
    )

    return <ResponsiveToolbar items={items} rightItems={rightItems} />
}

interface PaginationParams {
    emailCount: number
    page: number
    pageSize: number
    totalItems: number
    onPrevPage: () => void
    onNextPage: () => void
}

function usePaginationRightItems({
    emailCount,
    page,
    pageSize,
    totalItems,
    onPrevPage,
    onNextPage,
}: PaginationParams): ToolbarItem[] {
    const mutedColor = useThemeColor('muted-foreground')

    const text = useMemo(() => {
        if (totalItems === 0 && emailCount === 0) return 'No conversations'
        const start = (page - 1) * pageSize + 1
        const end = start + Math.max(0, emailCount - 1)
        const total = totalItems > 0 ? totalItems : emailCount
        return `${start}–${end} of ${total}`
    }, [emailCount, page, pageSize, totalItems])

    const hasPrev = page > 1
    const hasNext = totalItems > 0 ? page * pageSize < totalItems : false

    return useMemo(
        () => [
            {
                type: 'custom',
                key: 'pagination-text',
                element: <Text style={{ fontSize: 12, marginRight: 4, color: mutedColor }}>{text}</Text>,
            },
            {
                type: 'button',
                key: 'newer',
                icon: ChevronLeft,
                label: 'Newer',
                onPress: onPrevPage,
                disabled: !hasPrev,
            },
            {
                type: 'button',
                key: 'older',
                icon: ChevronRight,
                label: 'Older',
                onPress: onNextPage,
                disabled: !hasNext,
            },
        ],
        [mutedColor, text, hasPrev, hasNext, onPrevPage, onNextPage]
    )
}
