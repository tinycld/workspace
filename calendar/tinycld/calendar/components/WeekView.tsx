import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useCalendarEvents } from '../hooks/useCalendarEvents'
import {
    addDays,
    endOfDay,
    eventOverlapsRange,
    isToday,
    startOfWeek,
} from '../hooks/useCalendarNavigation'
import { useCalendarView } from '../hooks/useCalendarView'
import type { CalendarEvents } from '../types'
import { AllDayBar } from './AllDayBar'
import { DayColumnHeader } from './DayColumnHeader'
import { TimeGrid } from './TimeGrid'

function getEventsForDay(events: CalendarEvents[], date: Date): CalendarEvents[] {
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(date)
    dayEnd.setHours(23, 59, 59, 999)

    return events.filter((event) => eventOverlapsRange(event, dayStart, dayEnd))
}

export function WeekView() {
    const { focusDate, openQuickCreate, openEventDetail } = useCalendarView()
    const isMobile = useBreakpoint() === 'mobile'
    const dayCount = isMobile ? 3 : 7

    const rangeStart = useMemo(() => (isMobile ? focusDate : startOfWeek(focusDate)), [focusDate, isMobile])
    // Use endOfDay so events on the last shown day aren't filtered out —
    // see eventOverlapsRange's exclusive right bound.
    const rangeEnd = useMemo(
        () => endOfDay(addDays(rangeStart, dayCount - 1)),
        [rangeStart, dayCount]
    )
    const days = useMemo(
        () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
        [rangeStart, dayCount]
    )

    const { events, isLoading } = useCalendarEvents(rangeStart, rangeEnd)

    const { allDayEvents, columns } = useMemo(() => {
        const allDay = events.filter((e) => e.all_day)
        const timed = events.filter((e) => !e.all_day)
        const cols = days.map((date) => ({
            date,
            events: getEventsForDay(timed, date),
        }))
        return { allDayEvents: allDay, columns: cols }
    }, [events, days])

    if (isLoading && events.length === 0) return <LoadingState />

    return (
        <View className="flex-1">
            <View className="flex-row border-b border-border">
                <View style={{ width: 50 }} />
                {days.map((date) => (
                    <View key={date.toISOString()} className="flex-1 items-center">
                        <DayColumnHeader date={date} isToday={isToday(date)} />
                    </View>
                ))}
            </View>
            <AllDayBar
                events={allDayEvents}
                weekStart={rangeStart}
                dayCount={dayCount}
                onEventPress={openEventDetail}
            />
            <TimeGrid columns={columns} onSlotPress={openQuickCreate} onEventPress={openEventDetail} />
        </View>
    )
}
