import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useLocalSearchParams } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { CalendarMemberRowData } from '../../components/sharing/MemberRow'
import { MembersSection } from '../../components/sharing/MembersSection'
import type { CalendarRole } from '../../components/sharing/roles'

export default function CalendarSettingsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('calendar'))
    const fgColor = useThemeColor('foreground')

    const { user } = useAuth()

    const [calendarsCollection, membersCollection, userOrgsCollection, usersCollection] = useStore(
        'calendar_calendars',
        'calendar_members',
        'user_org',
        'users'
    )

    const { data: calendars } = useOrgLiveQuery(
        query =>
            query
                .from({ cal: calendarsCollection })
                .where(({ cal }) => eq(cal.id, id ?? '')),
        [id]
    )
    const calendar = calendars?.[0]

    const { data: memberRows } = useOrgLiveQuery(
        query =>
            query
                .from({ m: membersCollection })
                .join({ uo: userOrgsCollection }, ({ m, uo }) => eq(m.user_org, uo.id))
                .join({ u: usersCollection }, ({ uo, u }) => eq(uo.user, u.id))
                .where(({ m }) => eq(m.calendar, id ?? ''))
                .select(({ m, uo, u }) => ({
                    membershipId: m.id,
                    userOrgId: uo.id,
                    userId: uo.user,
                    role: m.role,
                    name: u.name,
                    email: u.email,
                })),
        [id]
    )

    const members: CalendarMemberRowData[] = (memberRows ?? []).map(r => ({
        membershipId: r.membershipId,
        userOrgId: r.userOrgId ?? '',
        userId: r.userId ?? '',
        name: r.name ?? '',
        email: r.email ?? '',
        role: r.role as CalendarRole,
        // Match against the auth user's id rather than user_org id —
        // useCurrentUserOrg has a multi-step async dependency that can be
        // null on first render, causing the screen to think the user
        // isn't a member of their own calendar (and silently rendering
        // it read-only).
        isCurrentUser: r.userId === user.id,
    }))

    const currentMember = members.find(m => m.isCurrentUser)
    const currentUserMembershipId = currentMember?.membershipId ?? null
    const currentUserRole: CalendarRole | null = currentMember?.role ?? null

    const [actionError, setActionError] = useState<string | null>(null)

    const updateRoleMutation = useMutation({
        mutationFn: mutation(function* (input: { membershipId: string; role: CalendarRole }) {
            yield membersCollection.update(input.membershipId, draft => {
                draft.role = input.role
            })
        }),
        onSuccess: () => setActionError(null),
        onError: error => {
            setActionError(error instanceof Error ? error.message : 'Failed to change role')
        },
    })

    const removeMemberMutation = useMutation({
        mutationFn: mutation(function* (membershipId: string) {
            yield membersCollection.delete(membershipId)
        }),
        onSuccess: () => setActionError(null),
        onError: error => {
            setActionError(error instanceof Error ? error.message : 'Failed to remove member')
        },
    })

    if (!id || !calendars) {
        // Live query still loading or no id at all — render nothing rather
        // than flashing a "not found" message that's wrong.
        return null
    }

    if (!calendar) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Calendar not found
                </Text>
                <Pressable onPress={navigateBack} className="mt-3">
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Go back
                    </Text>
                </Pressable>
            </View>
        )
    }

    return (
        <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            className="bg-background"
            keyboardShouldPersistTaps="handled"
        >
            <View className="flex-1 p-5 max-w-[760px] gap-6">
                <View className="flex-row items-center gap-3">
                    <Pressable onPress={navigateBack} hitSlop={8}>
                        <ArrowLeft size={22} color={fgColor} />
                    </Pressable>
                    <View className="flex-1 gap-0.5">
                        <Text
                            className="text-muted-foreground"
                            style={{ fontSize: 11, letterSpacing: 0.6 }}
                        >
                            Calendar
                        </Text>
                        <Text className="text-foreground" style={{ fontSize: 22, fontWeight: '700' }}>
                            {calendar.name}
                        </Text>
                    </View>
                </View>

                <MembersSection
                    calendarId={calendar.id}
                    members={members}
                    currentUserMembershipId={currentUserMembershipId}
                    currentUserRole={currentUserRole}
                    actionError={actionError}
                    onRoleChange={(membershipId, role) => {
                        setActionError(null)
                        updateRoleMutation.mutate({ membershipId, role })
                    }}
                    onRemove={membershipId => {
                        setActionError(null)
                        removeMemberMutation.mutate(membershipId)
                    }}
                />
            </View>
        </ScrollView>
    )
}
