import { eq } from '@tanstack/db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useCallback, useMemo } from 'react'
import type { CalendarColorKey, CalendarWithGroup } from '../types'

export interface MembershipInfo {
    id: string
    role: 'owner' | 'editor' | 'viewer'
    color: CalendarColorKey | ''
}

export function useCalendarData() {
    const { orgSlug } = useOrgInfo()
    const userOrg = useCurrentUserOrg(orgSlug)
    const [calendarsCollection] = useStore('calendar_calendars')
    const [membersCollection] = useStore('calendar_members')

    const { data: allCalendars, isLoading: calendarsLoading } = useOrgLiveQuery((query, { orgId }) =>
        query.from({ cal: calendarsCollection }).where(({ cal }) => eq(cal.org, orgId))
    )

    const userOrgId = userOrg?.id ?? ''

    const { data: memberships, isLoading: membershipsLoading } = useOrgLiveQuery(
        (query) => query.from({ mem: membersCollection }).where(({ mem }) => eq(mem.user_org, userOrgId)),
        [userOrgId]
    )

    const membershipByCalendar = useMemo(
        () =>
            new Map(
                (memberships ?? []).map((m) => [
                    m.calendar,
                    { id: m.id, role: m.role, color: m.color } as MembershipInfo,
                ])
            ),
        [memberships]
    )

    const calendars = useMemo(
        () =>
            (allCalendars ?? []).map((cal) => {
                const membership = membershipByCalendar.get(cal.id)
                const group: CalendarWithGroup['group'] = cal.subscription_url
                    ? 'subscribed'
                    : membership?.role === 'owner'
                      ? 'mine'
                      : 'other'
                return {
                    ...cal,
                    color: membership?.color || cal.color,
                    group,
                } as CalendarWithGroup
            }),
        [allCalendars, membershipByCalendar]
    )

    const mineCalendars = useMemo(() => calendars.filter((c) => c.group === 'mine'), [calendars])
    const otherCalendars = useMemo(() => calendars.filter((c) => c.group === 'other'), [calendars])
    const subscribedCalendars = useMemo(() => calendars.filter((c) => c.group === 'subscribed'), [calendars])

    const calendarMap = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars])

    const isLoading = calendarsLoading || membershipsLoading

    const colorMutation = useMutation({
        mutationFn: mutation(function* ({ membershipId, color }: { membershipId: string; color: CalendarColorKey }) {
            yield membersCollection.update(membershipId, (draft) => {
                draft.color = color
            })
        }),
    })

    const setCalendarColor = useCallback(
        (calendarId: string, color: CalendarColorKey) => {
            const membership = membershipByCalendar.get(calendarId)
            if (membership) {
                colorMutation.mutate({ membershipId: membership.id, color })
            }
        },
        [membershipByCalendar, colorMutation]
    )

    return {
        calendars,
        mineCalendars,
        otherCalendars,
        subscribedCalendars,
        calendarMap,
        membershipByCalendar,
        setCalendarColor,
        isLoading,
    }
}
