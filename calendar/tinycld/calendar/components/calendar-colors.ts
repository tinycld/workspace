import type { CalendarColorKey } from '../types'

const CALENDAR_COLORS: Record<CalendarColorKey, { bg: string; text: string }> = {
    blue: { bg: '#3b82f6', text: '#ffffff' },
    green: { bg: '#22c55e', text: '#ffffff' },
    red: { bg: '#ef4444', text: '#ffffff' },
    teal: { bg: '#14b8a6', text: '#ffffff' },
    purple: { bg: '#a855f7', text: '#ffffff' },
    orange: { bg: '#f97316', text: '#ffffff' },
    tomato: { bg: '#D50000', text: '#ffffff' },
    flamingo: { bg: '#E67C73', text: '#ffffff' },
    tangerine: { bg: '#F4511E', text: '#ffffff' },
    banana: { bg: '#E4C441', text: '#ffffff' },
    sage: { bg: '#33B679', text: '#ffffff' },
    basil: { bg: '#0B8043', text: '#ffffff' },
    peacock: { bg: '#039BE5', text: '#ffffff' },
    blueberry: { bg: '#3F51B5', text: '#ffffff' },
    lavender: { bg: '#7986CB', text: '#ffffff' },
    grape: { bg: '#8E24AA', text: '#ffffff' },
    graphite: { bg: '#616161', text: '#ffffff' },
}

export const CALENDAR_COLOR_KEYS = Object.keys(CALENDAR_COLORS) as CalendarColorKey[]

export const CALENDAR_COLOR_GRID: CalendarColorKey[][] = [
    ['tomato', 'flamingo', 'tangerine', 'banana', 'sage', 'basil'],
    ['peacock', 'blueberry', 'lavender', 'grape', 'graphite'],
    ['blue', 'green', 'red', 'teal', 'purple', 'orange'],
]

const DEFAULT_COLOR: CalendarColorKey = 'blue'

export function getCalendarColor(colorKey: string) {
    return CALENDAR_COLORS[colorKey as CalendarColorKey] ?? CALENDAR_COLORS[DEFAULT_COLOR]
}

export function getCalendarColorResolved(colorKey: string) {
    return getCalendarColor(colorKey)
}
