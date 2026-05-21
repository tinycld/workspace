import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type React from 'react'
import { useCallback, useMemo } from 'react'
import { type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useCalendarMap } from '../hooks/useCalendarEvents'
import { getTimeLabel, isToday } from '../hooks/useCalendarNavigation'
import { type LayoutEvent, layoutTimedEvents } from '../layout'
import type { CalendarEvents } from '../types'
import { CurrentTimeIndicator } from './CurrentTimeIndicator'
import { getCalendarColorResolved } from './calendar-colors'
import { EventBlock } from './EventBlock'

export const HOUR_HEIGHT = 60

interface TimeGridColumn {
    date: Date
    events: CalendarEvents[]
}

interface TimeGridProps {
    columns: TimeGridColumn[]
    startHour?: number
    endHour?: number
    onSlotPress: (date: Date, hour: number) => void
    onEventPress: (eventId: string, e: GestureResponderEvent) => void
}

function formatEventTime(event: CalendarEvents): string {
    const start = new Date(event.start)
    const hours = start.getHours()
    const minutes = start.getMinutes()
    const suffix = hours >= 12 ? 'PM' : 'AM'
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const minuteStr = minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : ''
    return `${displayHour}${minuteStr} ${suffix}`
}

function toLayoutEvents(events: CalendarEvents[]): LayoutEvent[] {
    return events.map((e) => ({
        id: e.id,
        start: new Date(e.start),
        end: new Date(e.end),
        allDay: e.all_day,
    }))
}

export function TimeGrid({ columns, startHour = 0, endHour = 23, onSlotPress, onEventPress }: TimeGridProps) {
    const borderColor = useThemeColor('border')
    const calendarMap = useCalendarMap()
    const totalHours = endHour - startHour + 1

    const scrollRef = useCallback(
        (node: ScrollView | null) => {
            if (!node) return
            const now = new Date()
            const currentHour = now.getHours()
            const scrollTarget = Math.max(0, (currentHour - startHour - 1) * HOUR_HEIGHT)
            node.scrollTo({ y: scrollTarget, animated: false })
        },
        [startHour]
    )

    const renderTimeLabels = useCallback(() => {
        const labels: React.JSX.Element[] = []
        for (let h = startHour; h <= endHour; h++) {
            labels.push(
                <View
                    key={h}
                    style={{
                        height: HOUR_HEIGHT,
                        justifyContent: 'flex-start',
                        alignItems: 'flex-end',
                        paddingRight: 8,
                    }}
                >
                    <Text className="text-muted-foreground" style={{ fontSize: 11, marginTop: -6 }}>
                        {h === startHour ? '' : getTimeLabel(h)}
                    </Text>
                </View>
            )
        }
        return labels
    }, [startHour, endHour])

    const columnLayouts = useMemo(
        () =>
            columns.map((col) => {
                const layoutEvents = toLayoutEvents(col.events)
                const layouts = layoutTimedEvents(layoutEvents, startHour, HOUR_HEIGHT)
                const layoutMap = new Map(layouts.map((l) => [l.id, l]))
                return { column: col, layoutMap }
            }),
        [columns, startHour]
    )

    const now = new Date()
    const currentTimeOffset = ((now.getHours() * 60 + now.getMinutes() - startHour * 60) / 60) * HOUR_HEIGHT

    return (
        <ScrollView ref={scrollRef} className="flex-1" showsVerticalScrollIndicator>
            <View className="flex-row">
                <View className="w-[50px]">{renderTimeLabels()}</View>

                <View className="flex-1 flex-row">
                    {columnLayouts.map(({ column, layoutMap }, colIndex) => {
                        const todayColumn = isToday(column.date)
                        return (
                            <View
                                key={column.date.toISOString()}
                                className="flex-1 relative"
                                style={{
                                    borderRightWidth: colIndex < columns.length - 1 ? 1 : 0,
                                    borderRightColor: colIndex < columns.length - 1 ? borderColor : undefined,
                                }}
                            >
                                {Array.from({ length: totalHours }, (_, i) => {
                                    const hour = startHour + i
                                    return (
                                        <Pressable
                                            key={hour}
                                            style={{
                                                height: HOUR_HEIGHT,
                                                borderBottomWidth: StyleSheet.hairlineWidth,
                                                borderBottomColor: borderColor,
                                            }}
                                            onPress={() => onSlotPress(column.date, hour)}
                                        />
                                    )
                                })}

                                {column.events.map((event) => {
                                    const layout = layoutMap.get(event.id)
                                    if (!layout) return null
                                    const cal = calendarMap.get(event.calendar)
                                    const colors = getCalendarColorResolved(cal?.color ?? 'blue')
                                    return (
                                        <EventBlock
                                            key={event.id}
                                            title={event.title}
                                            timeLabel={formatEventTime(event)}
                                            bgColor={colors.bg}
                                            textColor={colors.text}
                                            topOffset={layout.top}
                                            height={layout.height}
                                            left={layout.left}
                                            width={layout.width}
                                            onPress={(e) => onEventPress(event.id, e)}
                                        />
                                    )
                                })}

                                {todayColumn && <CurrentTimeIndicator topOffset={currentTimeOffset} />}
                            </View>
                        )
                    })}
                </View>
            </View>
        </ScrollView>
    )
}
