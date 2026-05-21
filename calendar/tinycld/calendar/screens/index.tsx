import { DayView } from '../components/DayView'
import { MonthView } from '../components/MonthView'
import { ScheduleView } from '../components/ScheduleView'
import { WeekView } from '../components/WeekView'
import { useCalendarView } from '../hooks/useCalendarView'

export default function CalendarScreen() {
    const { viewMode } = useCalendarView()

    if (viewMode === 'day') return <DayView />
    if (viewMode === 'week') return <WeekView />
    if (viewMode === 'schedule') return <ScheduleView />
    return <MonthView />
}
