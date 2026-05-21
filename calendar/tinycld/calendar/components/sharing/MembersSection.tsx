import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { UserPlus } from 'lucide-react-native'
import { useState } from 'react'
import { View, Text } from 'react-native'
import { AddMemberDialog } from './AddMemberDialog'
import { type CalendarMemberRowData, MemberRow } from './MemberRow'
import type { CalendarRole } from './roles'

interface MembersSectionProps {
    calendarId: string
    members: CalendarMemberRowData[]
    currentUserMembershipId: string | null
    currentUserRole: CalendarRole | null
    actionError: string | null
    onRoleChange: (membershipId: string, role: CalendarRole) => void
    onRemove: (membershipId: string) => void
}

export function MembersSection({
    calendarId,
    members,
    currentUserMembershipId,
    currentUserRole,
    actionError,
    onRoleChange,
    onRemove,
}: MembersSectionProps) {
    const fgColor = useThemeColor('foreground')
    const [dialogOpen, setDialogOpen] = useState(false)

    const isOwner = currentUserRole === 'owner'
    const ownerCount = members.filter(m => m.role === 'owner').length
    const existingUserOrgIds = new Set(members.map(m => m.userOrgId))

    return (
        <View className="gap-3">
            <Text className="text-foreground font-semibold" style={{ fontSize: 18 }}>
                Shared with
            </Text>

            {actionError ? (
                <View className="px-3 py-2 rounded-md bg-danger-soft">
                    <Text className="text-danger text-sm">{actionError}</Text>
                </View>
            ) : null}

            <View className="rounded-xl border border-border overflow-hidden bg-surface-secondary">
                {members.map((member, index) => {
                    const isLastOwner = member.role === 'owner' && ownerCount === 1
                    return (
                        <View
                            key={member.membershipId}
                            className={index > 0 ? 'border-t border-border' : ''}
                        >
                            <MemberRow
                                member={member}
                                canEdit={isOwner && !isLastOwner}
                                canRemove={isOwner && !isLastOwner}
                                onRoleChange={onRoleChange}
                                onRemove={onRemove}
                            />
                        </View>
                    )
                })}
            </View>

            {isOwner ? (
                <View className="self-start">
                    <Button onPress={() => setDialogOpen(true)} size="sm" variant="outline">
                        <UserPlus size={14} color={fgColor} />
                        <ButtonText>Add people</ButtonText>
                    </Button>
                </View>
            ) : null}

            <AddMemberDialog
                isVisible={dialogOpen}
                calendarId={calendarId}
                existingUserOrgIds={existingUserOrgIds}
                onClose={() => setDialogOpen(false)}
            />
        </View>
    )
}
