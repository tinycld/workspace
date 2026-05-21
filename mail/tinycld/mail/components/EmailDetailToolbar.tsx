import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import {
    Archive,
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    FolderInput,
    Forward,
    ListFilter,
    Mail,
    MailOpen,
    Star,
    Tag,
    Trash2,
} from 'lucide-react-native'
import { useMemo } from 'react'
import type { MailThreadState } from '../types'
import { MenuActionItem } from './DropdownMenu'

interface LabelInfo {
    id: string
    name: string
    color: string
}

interface EmailDetailToolbarProps {
    threadState: MailThreadState | undefined
    labels: LabelInfo[]
    threadLabelIds: Set<string>
    onBack: () => void
    onArchive: () => void
    onSpam: () => void
    onTrash: () => void
    onMove: (folder: MailThreadState['folder']) => void
    onUpdateLabel: (labelId: string, add: boolean) => void
    onToggleRead: () => void
    onToggleStar: () => void
    onForwardAll: () => void
    onNewer?: () => void
    onOlder?: () => void
    hasNewer?: boolean
    hasOlder?: boolean
}

const MOVE_FOLDERS: { label: string; folder: MailThreadState['folder'] }[] = [
    { label: 'Inbox', folder: 'inbox' },
    { label: 'Sent', folder: 'sent' },
    { label: 'Drafts', folder: 'drafts' },
    { label: 'Spam', folder: 'spam' },
    { label: 'Trash', folder: 'trash' },
    { label: 'Archive', folder: 'archive' },
]

export function EmailDetailToolbar({
    threadState,
    labels,
    threadLabelIds,
    onBack,
    onArchive,
    onSpam,
    onTrash,
    onMove,
    onUpdateLabel,
    onToggleRead,
    onToggleStar,
    onForwardAll,
    onNewer,
    onOlder,
    hasNewer = false,
    hasOlder = false,
}: EmailDetailToolbarProps) {
    const isRead = threadState?.is_read ?? false
    const isStarred = threadState?.is_starred ?? false

    const ReadIcon = isRead ? MailOpen : Mail
    const readLabel = isRead ? 'Mark as unread' : 'Mark as read'

    const items: ToolbarItem[] = useMemo(
        () => [
            { type: 'button', key: 'back', icon: ArrowLeft, label: 'Back', onPress: onBack },
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
                    const isActive = threadLabelIds.has(lbl.id)
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
                key: 'read',
                icon: ReadIcon,
                label: readLabel,
                onPress: onToggleRead,
            },
            {
                type: 'button',
                key: 'star',
                icon: Star,
                label: isStarred ? 'Remove star' : 'Add star',
                onPress: onToggleStar,
            },
            {
                type: 'button',
                key: 'filter',
                icon: ListFilter,
                label: 'Filter messages like these',
                onPress: () => {},
                disabled: true,
            },
            {
                type: 'button',
                key: 'forward-all',
                icon: Forward,
                label: 'Forward all',
                onPress: onForwardAll,
            },
        ],
        [
            onBack,
            onArchive,
            onSpam,
            onTrash,
            onMove,
            labels,
            threadLabelIds,
            onUpdateLabel,
            ReadIcon,
            readLabel,
            onToggleRead,
            isStarred,
            onToggleStar,
            onForwardAll,
        ]
    )

    const rightItems: ToolbarItem[] = useMemo(
        () => [
            {
                type: 'button',
                key: 'newer',
                icon: ChevronLeft,
                label: 'Newer',
                onPress: onNewer ?? (() => {}),
                disabled: !hasNewer,
            },
            {
                type: 'button',
                key: 'older',
                icon: ChevronRight,
                label: 'Older',
                onPress: onOlder ?? (() => {}),
                disabled: !hasOlder,
            },
        ],
        [onNewer, onOlder, hasNewer, hasOlder]
    )

    return <ResponsiveToolbar items={items} rightItems={rightItems} />
}
