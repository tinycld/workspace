import { addDays, isToday, startOfMonth, startOfWeek } from './useCalendarNavigation'

export interface MonthGridCell {
    date: Date
    isCurrentMonth: boolean
    isToday: boolean
}

export function getMonthGrid(monthDate: Date, weekStartDay = 0): MonthGridCell[] {
    const monthStart = startOfMonth(monthDate)
    const gridStart = startOfWeek(monthStart, weekStartDay)
    const currentMonth = monthDate.getMonth()

    // 6 rows of 7 days ensures consistent grid height regardless of month layout
    return Array.from({ length: 42 }, (_, i) => {
        const date = addDays(gridStart, i)
        return {
            date,
            isCurrentMonth: date.getMonth() === currentMonth,
            isToday: isToday(date),
        }
    })
}
