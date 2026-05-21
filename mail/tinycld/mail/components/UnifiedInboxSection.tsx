import { SidebarItem } from '@tinycld/core/components/sidebar-primitives'
import { Inbox } from 'lucide-react-native'

interface Props {
    isActive: boolean
    unreadCount: number
    onPress: () => void
}

export function UnifiedInboxSection({ isActive, unreadCount, onPress }: Props) {
    return (
        <SidebarItem
            label="All Inboxes"
            icon={Inbox}
            badge={unreadCount > 0 ? unreadCount : undefined}
            isActive={isActive}
            closesDrawer
            onPress={onPress}
        />
    )
}
