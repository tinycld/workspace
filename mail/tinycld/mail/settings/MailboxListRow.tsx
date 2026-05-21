import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import type { MailboxListItem } from '../hooks/filterMailboxes'

interface Props {
    item: MailboxListItem
    isActive?: boolean
    onPress: () => void
}

function initials(item: MailboxListItem): string {
    const name = item.displayName || item.address
    const words = name.trim().split(/\s+/).filter(Boolean)
    const first = words[0] ?? ''
    if (first === '') return '?'
    if (words.length === 1) return first.slice(0, 2).toUpperCase()
    const second = words[1] ?? ''
    return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase()
}

function subtitle(item: MailboxListItem): string {
    const parts: string[] = []
    if (item.displayName && item.displayName !== item.address) parts.push(item.displayName)
    if (item.type === 'shared') {
        parts.push(`${item.memberCount} member${item.memberCount !== 1 ? 's' : ''}`)
    }
    if (item.aliasCount > 0) {
        parts.push(`${item.aliasCount} alias${item.aliasCount !== 1 ? 'es' : ''}`)
    }
    return parts.join(' \u00b7 ')
}

export function MailboxListRow({ item, isActive = false, onPress }: Props) {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const isShared = item.type === 'shared'
    const avatarBg = isShared ? `${primaryColor}1F` : `${mutedColor}26`
    const avatarFg = isShared ? primaryColor : mutedColor

    return (
        <Pressable
            onPress={onPress}
            className="flex-row items-center gap-3 rounded-lg p-3"
            style={{
                backgroundColor: isActive ? `${primaryColor}0F` : 'transparent',
            }}
        >
            <View
                className="rounded-lg items-center justify-center"
                style={{ width: 36, height: 36, backgroundColor: avatarBg }}
            >
                <Text style={{ color: avatarFg, fontWeight: '700', fontSize: 13 }}>{initials(item)}</Text>
            </View>
            <View className="flex-1" style={{ minWidth: 0 }}>
                <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                    {item.address}
                    <Text className="text-muted-foreground" style={{ fontWeight: '500' }}>
                        @{item.domainName}
                    </Text>
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {subtitle(item)}
                </Text>
            </View>
            <ChevronRight size={16} color={mutedColor} />
        </Pressable>
    )
}
