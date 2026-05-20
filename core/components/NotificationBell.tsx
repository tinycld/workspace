import { and, eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Bell } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

export function NotificationBell({ color }: { color: string }) {
    const [notificationsCollection] = useStore('notifications')
    const isOpen = useWorkspaceStore(s => s.isNotificationsOpen)
    const setOpen = useWorkspaceStore(s => s.setNotificationsOpen)

    const { data: unread } = useOrgLiveQuery(
        (query, { orgId }) =>
            query
                .from({ n: notificationsCollection })
                .where(({ n }) => and(eq(n.org, orgId), eq(n.read, false), eq(n.dismissed, false))),
        []
    )

    const unreadCount = unread?.length ?? 0

    return (
        <Pressable
            onPress={() => setOpen(!isOpen)}
            className="w-11 h-11 rounded-xl justify-center items-center relative"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
            <Bell size={22} color={color} />
            <UnreadBadge count={unreadCount} />
        </Pressable>
    )
}

function UnreadBadge({ count }: { count: number }) {
    if (count === 0) return null

    const label = count > 99 ? '99+' : String(count)

    return (
        <View className="absolute top-1 right-1 min-w-[18px] h-[18px] rounded-full bg-danger justify-center items-center px-1">
            <Text className="text-danger-foreground text-[10px] font-bold">{label}</Text>
        </View>
    )
}
