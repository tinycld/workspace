import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useCalendarEvents } from '../hooks/useCalendarEvents'
import { endOfDay, isToday } from '../hooks/useCalendarNavigation'
import { useCalendarView } from '../hooks/useCalendarView'
import { AllDayBar } from './AllDayBar'
import { DayColumnHeader } from './DayColumnHeader'
import { TimeGrid } from './TimeGrid'

export function DayView() {
    const { focusDate, openQuickCreate, openEventDetail } = useCalendarView()
    const { events, isLoading } = useCalendarEvents(focusDate, endOfDay(focusDate))

    const { allDayEvents, timedEvents } = useMemo(() => {
        const allDay = events.filter((e) => e.all_day)
        const timed = events.filter((e) => !e.all_day)
        return { allDayEvents: allDay, timedEvents: timed }
    }, [events])

    const columns = useMemo(() => [{ date: focusDate, events: timedEvents }], [focusDate, timedEvents])

    if (isLoading && events.length === 0) return <LoadingState />

    return (
        <View className="flex-1">
            <DayColumnHeader date={focusDate} isToday={isToday(focusDate)} />
            <AllDayBar events={allDayEvents} weekStart={focusDate} dayCount={1} onEventPress={openEventDetail} />
            <TimeGrid columns={columns} onSlotPress={openQuickCreate} onEventPress={openEventDetail} />
        </View>
    )
}
