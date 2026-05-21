import type { CalendarEvents } from '../types'

export function addDays(date: Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
}

export function addWeeks(date: Date, weeks: number): Date {
    return addDays(date, weeks * 7)
}

export function addMonths(date: Date, months: number): Date {
    const result = new Date(date)
    result.setMonth(result.getMonth() + months)
    return result
}

export function startOfWeek(date: Date, startDay = 0): Date {
    const result = new Date(date)
    result.setHours(0, 0, 0, 0)
    const day = result.getDay()
    const diff = (day - startDay + 7) % 7
    result.setDate(result.getDate() - diff)
    return result
}

export function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function endOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

/**
 * Returns a new Date set to the last representable instant of the same day
 * (23:59:59.999). Use when passing an end-of-range to eventOverlapsRange
 * — the overlap check is exclusive on the right time bound, so a midnight
 * Date for "end of Saturday" would silently drop every event after 00:00:00
 * on Saturday (the entire day).
 */
export function endOfDay(date: Date): Date {
    const result = new Date(date)
    result.setHours(23, 59, 59, 999)
    return result
}

export function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isToday(date: Date): boolean {
    return isSameDay(date, new Date())
}

export function getDaysInMonth(date: Date): number {
    return endOfMonth(date).getDate()
}

export function getWeekDays(weekStart: Date): Date[] {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export function formatDateLabel(date: Date, viewMode: 'day' | 'week' | 'month' | 'schedule'): string {
    const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ]
    if (viewMode === 'month') {
        return `${months[date.getMonth()]} ${date.getFullYear()}`
    }
    if (viewMode === 'day') {
        return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
    }
    return `${months[date.getMonth()]} ${date.getFullYear()}`
}

export function getTimeLabel(hour: number): string {
    const h = ((hour % 24) + 24) % 24
    if (h === 0) return '12 AM'
    if (h < 12) return `${h} AM`
    if (h === 12) return '12 PM'
    return `${h - 12} PM`
}

const SHORT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export function getShortDayName(date: Date): string {
    return SHORT_DAYS[date.getDay()]
}

export function eventOverlapsRange(event: CalendarEvents, rangeStart: Date, rangeEnd: Date): boolean {
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    if (event.all_day) {
        const allDayStart = new Date(eventStart)
        allDayStart.setHours(0, 0, 0, 0)
        const allDayEnd = new Date(eventEnd)
        allDayEnd.setHours(23, 59, 59, 999)
        return allDayStart <= rangeEnd && allDayEnd >= rangeStart
    }
    return eventStart < rangeEnd && eventEnd > rangeStart
}

export function formatShortTime(date: Date): string {
    const hour = date.getHours() % 12 || 12
    const minutes = date.getMinutes()
    return minutes > 0 ? `${hour}:${String(minutes).padStart(2, '0')}` : `${hour}`
}

export function toDateString(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

export function parseDate(str: string | undefined): Date {
    if (!str) return new Date()
    // Append time to force local-time parsing (bare YYYY-MM-DD parses as UTC)
    const parsed = new Date(`${str}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) {
        return new Date()
    }
    return parsed
}
