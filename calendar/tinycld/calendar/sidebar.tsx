import {
    SidebarActionButton,
    SidebarDivider,
    SidebarItem,
    SidebarNav,
} from '@tinycld/core/components/sidebar-primitives'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useGlobalSearchParams, useRouter } from 'expo-router'
import { CalendarDays, Columns3, Grid3X3, Link2, List } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { View } from 'react-native'
import { CalendarList } from './components/CalendarList'
import { MiniCalendar } from './components/MiniCalendar'
import { SubscriptionDialog } from './components/SubscriptionDialog'
import { useVisibleCalendars } from './hooks/useCalendarEvents'
import { parseDate, toDateString } from './hooks/useCalendarNavigation'
import type { ViewMode } from './hooks/useCalendarView'

const VIEW_MODE_OPTIONS: { mode: ViewMode; label: string; icon: typeof List }[] = [
    { mode: 'schedule', label: 'Schedule', icon: List },
    { mode: 'day', label: 'Day', icon: CalendarDays },
    { mode: 'week', label: '3 Day', icon: Columns3 },
    { mode: 'month', label: 'Month', icon: Grid3X3 },
]

interface CalendarSidebarProps {
    isCollapsed: boolean
}

export default function CalendarSidebar(props: CalendarSidebarProps) {
    return <CalendarSidebarInner {...props} />
}

function CalendarSidebarInner(_props: CalendarSidebarProps) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const { calendars, visibleIds, toggleCalendar, setCalendarColor, showOnlyCalendar } =
        useVisibleCalendars()
    const { view, date } = useGlobalSearchParams<{ view?: string; date?: string }>()
    const isMobile = useBreakpoint() === 'mobile'
    const setDrawerOpen = useWorkspaceStore((s) => s.setDrawerOpen)
    const [subscribeOpen, setSubscribeOpen] = useState(false)

    const [calendarsCollection] = useStore('calendar_calendars')

    const selectedDate = useMemo(() => parseDate(date), [date])

    const handleDateSelect = (d: Date) => {
        router.push(orgHref('calendar', { view: view ?? 'week', date: toDateString(d) }))
        if (isMobile) setTimeout(() => setDrawerOpen(false), 500)
    }

    const handleCreate = () => {
        router.push(orgHref('calendar/[id]', { id: 'new' }))
    }

    const handleViewModeSelect = (mode: ViewMode) => {
        router.push(orgHref('calendar', { view: mode, date: date ?? toDateString(new Date()) }))
    }

    const refreshMutation = useMutation({
        mutationFn: mutation(function* (calendarId: string) {
            yield calendarsCollection.update(calendarId, (draft) => {
                draft.subscription_error = ''
                draft.subscription_last_sync = ''
            })
        }),
    })

    const handleRefreshSubscription = useCallback(
        (calendarId: string) => refreshMutation.mutate(calendarId),
        [refreshMutation]
    )

    const deleteCalendarMutation = useMutation({
        mutationFn: mutation(function* (calendarId: string) {
            yield calendarsCollection.delete(calendarId)
        }),
    })

    const handleDeleteCalendar = useCallback(
        (calendarId: string) => deleteCalendarMutation.mutate(calendarId),
        [deleteCalendarMutation]
    )

    // Settings & sharing is shown for every calendar the user has access
    // to; the screen itself renders read-only for non-owners and a
    // not-found state for non-members, so permission logic stays in one
    // place rather than being mirrored in the menu.
    const handleOpenSettings = useCallback(
        (calendarId: string) => {
            router.push(orgHref('calendar/settings/[id]', { id: calendarId }))
            if (isMobile) setTimeout(() => setDrawerOpen(false), 500)
        },
        [router, orgHref, isMobile, setDrawerOpen]
    )

    return (
        <SidebarNav>
            {isMobile && (
                <>
                    <View className="px-2 py-1">
                        {VIEW_MODE_OPTIONS.map((opt) => (
                            <SidebarItem
                                key={opt.mode}
                                label={opt.label}
                                icon={opt.icon}
                                isActive={view === opt.mode}
                                closesDrawer
                                onPress={() => handleViewModeSelect(opt.mode)}
                            />
                        ))}
                    </View>
                    <SidebarDivider />
                </>
            )}

            {!isMobile && <SidebarActionButton label="+ Create" onPress={handleCreate} />}

            <MiniCalendar selectedDate={selectedDate} onDateSelect={handleDateSelect} />

            <SidebarDivider />

            <CalendarList
                calendars={calendars}
                visibleIds={visibleIds}
                onToggle={toggleCalendar}
                onColorChange={setCalendarColor}
                onShowOnly={showOnlyCalendar}
                onRefreshSubscription={handleRefreshSubscription}
                onDeleteCalendar={handleDeleteCalendar}
                onOpenSettings={handleOpenSettings}
            />

            <SidebarDivider />

            <SidebarItem label="Subscribe to calendar" icon={Link2} onPress={() => setSubscribeOpen(true)} />

            <SubscriptionDialog open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />
        </SidebarNav>
    )
}
