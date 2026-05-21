import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useMemo } from 'react'
import { type GestureResponderEvent, Pressable, Text, View } from 'react-native'
import { useCalendarEvents, useCalendarMap } from '../hooks/useCalendarEvents'
import { addDays, endOfDay, eventOverlapsRange } from '../hooks/useCalendarNavigation'
import { useCalendarView } from '../hooks/useCalendarView'
import { getMonthGrid, type MonthGridCell } from '../hooks/useMonthGrid'
import { type LayoutEvent, layoutMonthEvents, type MonthCellLayout } from '../layout'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'
import { MonthCell } from './MonthCell'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_VISIBLE_ROWS = 3
const MULTI_DAY_ROW_HEIGHT = 18
const DATE_HEADER_HEIGHT = 28

export function MonthView() {
    const { focusDate, openEventDetail, setViewMode, goToDate } = useCalendarView()
    const calendarMap = useCalendarMap()

    const grid = useMemo(() => getMonthGrid(focusDate), [focusDate])

    const gridStart = grid[0].date
    // Use endOfDay so events on the last cell aren't filtered out — see
    // eventOverlapsRange's exclusive right bound.
    const gridEnd = useMemo(() => endOfDay(grid[grid.length - 1].date), [grid])

    const { events, isLoading } = useCalendarEvents(gridStart, gridEnd)

    const rows = useMemo(() => {
        const result: MonthGridCell[][] = []
        for (let i = 0; i < grid.length; i += 7) {
            result.push(grid.slice(i, i + 7))
        }
        return result
    }, [grid])

    const eventMap = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

    const rowLayouts = useMemo(
        () =>
            rows.map((row) => {
                const weekStart = row[0].date
                const weekEndFull = endOfDay(addDays(weekStart, 6))

                const weekEvents = events.filter((e) => eventOverlapsRange(e, weekStart, weekEndFull))

                const layoutEvents: LayoutEvent[] = weekEvents.map((e) => ({
                    id: e.id,
                    start: new Date(e.start),
                    end: new Date(e.end),
                    allDay: e.all_day,
                }))

                return layoutMonthEvents(layoutEvents, weekStart, MAX_VISIBLE_ROWS)
            }),
        [rows, events]
    )

    const handleDatePress = (date: Date) => {
        goToDate(date)
        setViewMode('day')
    }

    if (isLoading && events.length === 0) return <LoadingState />

    return (
        <View className="flex-1 overflow-hidden">
            <View className="flex-row border-b border-border">
                {DAY_LABELS.map((label) => (
                    <View key={label} className="flex-1 items-center py-2">
                        <Text className="text-muted-foreground" style={{ fontSize: 12, fontWeight: '600' }}>
                            {label}
                        </Text>
                    </View>
                ))}
            </View>

            {rows.map((row, rowIndex) => {
                const cellLayoutMap = rowLayouts[rowIndex]

                return (
                    <View
                        key={row[0].date.toISOString()}
                        className="flex-1 flex-row relative overflow-hidden"
                        style={{
                            minHeight: 0,
                        }}
                    >
                        <MultiDayBars
                            cellLayoutMap={cellLayoutMap}
                            eventMap={eventMap}
                            calendarMap={calendarMap}
                            onEventPress={openEventDetail}
                        />
                        {row.map((cell, colIndex) => {
                            const cellLayout = cellLayoutMap.get(colIndex)
                            return (
                                <MonthCell
                                    key={cell.date.toISOString()}
                                    date={cell.date}
                                    isCurrentMonth={cell.isCurrentMonth}
                                    isToday={cell.isToday}
                                    cellLayout={cellLayout}
                                    eventMap={eventMap}
                                    onDatePress={handleDatePress}
                                    onEventPress={openEventDetail}
                                />
                            )
                        })}
                    </View>
                )
            })}
        </View>
    )
}

interface MultiDayBarsProps {
    cellLayoutMap: Map<number, MonthCellLayout>
    eventMap: Map<string, CalendarEvents>
    calendarMap: Map<string, { color: string }>
    onEventPress: (eventId: string, e: GestureResponderEvent) => void
}

function MultiDayBars({ cellLayoutMap, eventMap, calendarMap, onEventPress }: MultiDayBarsProps) {
    const rendered = new Set<string>()
    const bars: React.JSX.Element[] = []

    cellLayoutMap.forEach((cellLayout) => {
        for (const layout of cellLayout.layouts) {
            if (!layout.isAllDay || rendered.has(layout.id)) continue
            rendered.add(layout.id)

            const event = eventMap.get(layout.id)
            if (!event) continue

            const cal = calendarMap.get(event.calendar)
            const colors = getCalendarColorResolved(cal?.color ?? 'blue')
            const top = DATE_HEADER_HEIGHT + layout.row * MULTI_DAY_ROW_HEIGHT

            bars.push(
                <Pressable
                    key={layout.id}
                    onPress={(e) => onEventPress(layout.id, e)}
                    style={{
                        position: 'absolute',
                        top,
                        left: `${(layout.startCol / 7) * 100}%`,
                        width: `${(layout.span / 7) * 100}%`,
                        height: MULTI_DAY_ROW_HEIGHT - 2,
                        paddingHorizontal: 1,
                        zIndex: 2,
                    }}
                >
                    <View
                        className="flex-1 rounded-sm px-1 py-px overflow-hidden"
                        style={{
                            backgroundColor: colors.bg,
                        }}
                    >
                        <Text style={{ fontSize: 10, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                            {layout.isStart ? event.title : ''}
                        </Text>
                    </View>
                </Pressable>
            )
        }
    })

    return <>{bars}</>
}
