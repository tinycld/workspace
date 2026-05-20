import { eq } from '@tanstack/db'
import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo, useState } from 'react'
import { Text, TextInput, View } from 'react-native'

interface MemberCard {
    id: string
    firstName: string
    lastName: string
    email: string
    role: string
}

export default function DirectoryScreen() {
    const [searchQuery, setSearchQuery] = useState('')
    const [userOrgCollection] = useStore('user_org')
    const mutedColor = useThemeColor('muted-foreground')
    const placeholderColor = useThemeColor('field-placeholder')
    const primaryColor = useThemeColor('primary')
    const infoColor = useThemeColor('info')
    const successColor = useThemeColor('success')
    const warningColor = useThemeColor('warning')

    const badgeColors: Record<string, { bg: string; fg: string; border: string }> = {
        owner: {
            bg: hexToRgba(primaryColor, 0.12),
            fg: primaryColor,
            border: hexToRgba(primaryColor, 0.3),
        },
        admin: { bg: hexToRgba(infoColor, 0.12), fg: infoColor, border: hexToRgba(infoColor, 0.3) },
        member: {
            bg: hexToRgba(successColor, 0.12),
            fg: successColor,
            border: hexToRgba(successColor, 0.3),
        },
        guest: {
            bg: hexToRgba(warningColor, 0.12),
            fg: warningColor,
            border: hexToRgba(warningColor, 0.3),
        },
    }
    const defaultBadge = {
        bg: hexToRgba(mutedColor, 0.12),
        fg: mutedColor,
        border: hexToRgba(mutedColor, 0.3),
    }

    const { data: userOrgs } = useOrgLiveQuery((query, { orgId }) =>
        query.from({ user_org: userOrgCollection }).where(({ user_org }) => eq(user_org.org, orgId))
    )

    const members: MemberCard[] = useMemo(() => {
        if (!userOrgs) return []
        const result: MemberCard[] = []
        for (const uo of userOrgs) {
            const user = uo.expand?.user
            if (!user) continue
            const nameParts = (user.name || '').split(' ')
            result.push({
                id: uo.id,
                firstName: nameParts[0] || user.email.split('@')[0],
                lastName: nameParts.slice(1).join(' '),
                email: user.email,
                role: uo.role,
            })
        }
        return result
    }, [userOrgs])

    const filtered = useMemo(() => {
        if (!searchQuery) return members
        const q = searchQuery.toLowerCase()
        return members.filter((m) => {
            const fullName = `${m.firstName} ${m.lastName}`.toLowerCase()
            return fullName.includes(q) || m.email.toLowerCase().includes(q)
        })
    }, [members, searchQuery])

    return (
        <View className="flex-1 p-5 bg-background">
            <View className="flex-row justify-between items-center mb-4">
                <View className="flex-row items-center gap-2">
                    <Text className="text-2xl font-bold text-foreground">
                        Directory ({filtered.length})
                    </Text>
                    <HelpIcon topic="contacts:directory" size={18} />
                </View>
                {members.length > 5 ? (
                    <TextInput
                        placeholder="Search members..."
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        className="w-[250px] border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                        placeholderTextColor={placeholderColor}
                    />
                ) : null}
            </View>

            <View className="flex-row flex-wrap gap-4">
                {filtered.map((member) => {
                    const badge = badgeColors[member.role] ?? defaultBadge
                    return (
                        <View
                            key={member.id}
                            className="w-[220px] border border-border rounded-lg p-3 bg-background"
                        >
                            <View className="items-center gap-3">
                                <NameAvatar firstName={member.firstName} lastName={member.lastName} size={56} />
                                <View className="items-center gap-1">
                                    <Text
                                        className="text-base font-semibold text-foreground"
                                        numberOfLines={1}
                                    >
                                        {member.firstName} {member.lastName}
                                    </Text>
                                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                                        {member.email}
                                    </Text>
                                    <View
                                        className="px-2 py-0.5 rounded-md border mt-1"
                                        style={{
                                            backgroundColor: badge.bg,
                                            borderColor: badge.border,
                                        }}
                                    >
                                        <Text className="text-[11px] font-medium" style={{ color: badge.fg }}>
                                            {member.role}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>
                    )
                })}
            </View>

            {filtered.length === 0 ? (
                <View className="flex-1 items-center justify-center p-10">
                    <Text className="text-base text-muted-foreground">
                        No members found.
                    </Text>
                </View>
            ) : null}
        </View>
    )
}
