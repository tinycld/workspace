import { SidebarItem } from '@tinycld/core/components/sidebar-primitives'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    AlertTriangle,
    Archive,
    ChevronDown,
    ChevronRight,
    File,
    Inbox,
    Mail,
    Send,
    Star,
    Trash2,
} from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import type { FolderCounts } from '../hooks/useMailboxFolderCounts'
import { useMailSidebarStore } from '../stores/sidebar-store'

interface Props {
    mailboxId: string
    mailboxLabel: string
    defaultExpanded: boolean
    counts: FolderCounts
    activeMailboxId: string
    activeFolder: string | null
    onNavigate: (mailboxId: string, folder: string) => void
}

export function MailboxSidebarSection({
    mailboxId,
    mailboxLabel,
    defaultExpanded,
    counts,
    activeMailboxId,
    activeFolder,
    onNavigate,
}: Props) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')

    const isExpanded = useMailSidebarStore((s) => s.isExpanded(mailboxId, defaultExpanded))
    const toggle = useMailSidebarStore((s) => s.toggle)

    const aggregateUnread = counts.inbox

    const isActive = (folder: string) => activeMailboxId === mailboxId && activeFolder === folder

    const handleHeaderPress = () => {
        toggle(mailboxId, defaultExpanded)
        if (!isExpanded) onNavigate(mailboxId, 'inbox')
    }

    return (
        <View>
            <Pressable onPress={handleHeaderPress} className="flex-row gap-1 items-center pl-1 pr-3 py-2">
                {isExpanded ? (
                    <ChevronDown size={14} color={mutedColor} />
                ) : (
                    <ChevronRight size={14} color={mutedColor} />
                )}
                <Text className="flex-1" style={{ fontSize: 13, fontWeight: '600', color: fgColor }}>
                    {mailboxLabel}
                </Text>
                {!isExpanded && aggregateUnread > 0 && (
                    <Text style={{ fontSize: 12, color: mutedColor }}>{aggregateUnread}</Text>
                )}
            </Pressable>

            {isExpanded && (
                <View>
                    <SidebarItem
                        label="Inbox"
                        icon={Inbox}
                        badge={counts.inbox || undefined}
                        isActive={isActive('inbox')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'inbox')}
                    />
                    <SidebarItem
                        label="Starred"
                        icon={Star}
                        isActive={isActive('starred')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'starred')}
                    />
                    <SidebarItem
                        label="Sent"
                        icon={Send}
                        isActive={isActive('sent')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'sent')}
                    />
                    <SidebarItem
                        label="Drafts"
                        icon={File}
                        badge={counts.drafts || undefined}
                        isActive={isActive('drafts')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'drafts')}
                    />
                    <SidebarItem
                        label="All Mail"
                        icon={Mail}
                        isActive={isActive('all')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'all')}
                    />
                    <SidebarItem
                        label="Spam"
                        icon={AlertTriangle}
                        badge={counts.spam || undefined}
                        isActive={isActive('spam')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'spam')}
                    />
                    <SidebarItem
                        label="Trash"
                        icon={Trash2}
                        badge={counts.trash || undefined}
                        isActive={isActive('trash')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'trash')}
                    />
                    <SidebarItem
                        label="Archive"
                        icon={Archive}
                        isActive={isActive('archive')}
                        closesDrawer
                        onPress={() => onNavigate(mailboxId, 'archive')}
                    />
                </View>
            )}
        </View>
    )
}
