import { useRemoteAwareness } from '@tinycld/core/lib/realtime/use-remote-awareness'
import { useMemo } from 'react'
import { Text, View } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'

interface PresenceUser {
    id: string
    name: string
    color: string
}

interface ParsedAwareness {
    user: PresenceUser
}

interface PresenceAvatarsProps {
    awareness: Awareness | null
    // Maximum number of avatar circles to render. Anything past the
    // limit collapses into a "+N" badge.
    max?: number
    size?: number
}

// PresenceAvatars renders a stacked row of initials representing the
// other users currently connected to the same realtime room. Generic
// over room kind — any awareness slot whose `user` field has
// {id, name, color} will appear.
//
// Server-published slots (text's saveStatus, future kinds) come through
// a separate channel (MsgServerSlot via onServerSlot) and never appear
// in y-protocols/awareness, so no special filtering is needed here. We
// still narrow on the parsed shape so a malformed slot (e.g. a peer
// using a different schema in the same room) is dropped cleanly.
export function PresenceAvatars({ awareness, max = 4, size = 24 }: PresenceAvatarsProps) {
    const options = useMemo(() => ({ parse: parseSlot, equals: sameUser }), [])
    const peers = useRemoteAwareness<ParsedAwareness>(awareness, options)

    if (peers.length === 0) return null

    const visible = peers.slice(0, max)
    const overflow = peers.length - visible.length

    return (
        <View className="flex-row items-center">
            {visible.map((peer, i) => (
                <Avatar key={peer.clientID} user={peer.state.user} size={size} offset={i} />
            ))}
            {overflow > 0 ? (
                <View
                    className="items-center justify-center bg-surface-secondary border border-background"
                    style={{
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        marginLeft: visible.length > 0 ? -size / 3 : 0,
                    }}
                >
                    <Text
                        className="text-foreground font-semibold"
                        style={{ fontSize: size * 0.4 }}
                    >
                        +{overflow}
                    </Text>
                </View>
            ) : null}
        </View>
    )
}

interface AvatarProps {
    user: PresenceUser
    size: number
    offset: number
}

function Avatar({ user, size, offset }: AvatarProps) {
    const initial = (user.name[0] ?? '?').toUpperCase()
    return (
        <View
            accessibilityRole="image"
            accessibilityLabel={user.name}
            className="items-center justify-center border border-background"
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: user.color,
                marginLeft: offset === 0 ? 0 : -size / 3,
            }}
        >
            <Text className="text-white font-semibold" style={{ fontSize: size * 0.42 }}>
                {initial}
            </Text>
        </View>
    )
}

function parseSlot(raw: unknown): ParsedAwareness | null {
    if (raw == null || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    const userObj = obj.user as Record<string, unknown> | undefined
    if (
        userObj == null ||
        typeof userObj.id !== 'string' ||
        typeof userObj.name !== 'string' ||
        typeof userObj.color !== 'string'
    ) {
        return null
    }
    return { user: { id: userObj.id, name: userObj.name, color: userObj.color } }
}

function sameUser(a: ParsedAwareness, b: ParsedAwareness): boolean {
    return a.user.id === b.user.id && a.user.name === b.user.name && a.user.color === b.user.color
}
