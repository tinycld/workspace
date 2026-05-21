import { MemberAvatar } from '@tinycld/core/components/settings/members/MemberAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { type CalendarRole, ROLE_OPTIONS, roleLabel } from './roles'

export interface CalendarMemberRowData {
    membershipId: string
    userOrgId: string
    userId: string
    name: string
    email: string
    role: CalendarRole
    isCurrentUser: boolean
}

interface MemberRowProps {
    member: CalendarMemberRowData
    canEdit: boolean
    canRemove: boolean
    onRoleChange: (membershipId: string, role: CalendarRole) => void
    onRemove: (membershipId: string) => void
}

export function MemberRow({ member, canEdit, canRemove, onRoleChange, onRemove }: MemberRowProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const dangerColor = useThemeColor('danger')

    return (
        <View className="flex-row items-center gap-3 py-2.5 px-3">
            <MemberAvatar name={member.name} email={member.email} size={36} />

            <View className="flex-1">
                <View className="flex-row items-center gap-1.5">
                    <Text className="text-foreground font-medium" style={{ fontSize: 14 }}>
                        {member.name || member.email}
                    </Text>
                    {member.isCurrentUser ? (
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            (you)
                        </Text>
                    ) : null}
                </View>
                {member.name ? (
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {member.email}
                    </Text>
                ) : null}
            </View>

            {canEdit ? (
                <Menu>
                    <Menu.Trigger>
                        <Pressable className="flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background">
                            <Text className="text-foreground text-xs font-medium">
                                {roleLabel(member.role)}
                            </Text>
                            <ChevronDown size={14} color={mutedColor} />
                        </Pressable>
                    </Menu.Trigger>
                    <Menu.Portal>
                        <Menu.Overlay />
                        <Menu.Content presentation="popover" placement="bottom" align="end">
                            {ROLE_OPTIONS.map(opt => (
                                <Menu.Item
                                    key={opt.value}
                                    onPress={() => onRoleChange(member.membershipId, opt.value)}
                                >
                                    <Menu.ItemTitle>{opt.label}</Menu.ItemTitle>
                                </Menu.Item>
                            ))}
                        </Menu.Content>
                    </Menu.Portal>
                </Menu>
            ) : (
                <View className="px-2.5 py-1 rounded-md bg-surface-secondary">
                    <Text className="text-foreground text-xs font-medium">
                        {roleLabel(member.role)}
                    </Text>
                </View>
            )}

            {canRemove ? (
                <Pressable
                    onPress={() => onRemove(member.membershipId)}
                    hitSlop={8}
                    className="p-1.5 rounded-md"
                    accessibilityLabel={`Remove ${member.name || member.email}`}
                >
                    <X size={16} color={dangerColor} />
                </Pressable>
            ) : (
                <View style={{ width: 28, height: 28 }} />
            )}
        </View>
    )
}
