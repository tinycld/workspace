import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { useCalendarMap } from '../hooks/useCalendarEvents'
import { formatShortTime } from '../hooks/useCalendarNavigation'
import type { MonthCellLayout } from '../layout'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'

interface MonthCellProps {
    date: Date
    isCurrentMonth: boolean
    isToday: boolean
    cellLayout: MonthCellLayout | undefined
    eventMap: Map<string, CalendarEvents>
    onDatePress: (date: Date) => void
    onEventPress: (eventId: string, e: GestureResponderEvent) => void
}

export function MonthCell({
    date,
    isCurrentMonth,
    isToday,
    cellLayout,
    eventMap,
    onDatePress,
    onEventPress,
}: MonthCellProps) {
    const borderColor = useThemeColor('border')
    const calendarMap = useCalendarMap()
    const dateNum = date.getDate()
    const layouts = cellLayout?.layouts ?? []
    const overflowCount = cellLayout?.overflowCount ?? 0

    return (
        <Pressable
            className="flex-1 p-0.5 overflow-hidden"
            style={{
                borderRightWidth: StyleSheet.hairlineWidth,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor,
            }}
            onPress={() => onDatePress(date)}
        >
            <View
                className={`rounded-full items-center justify-center self-end mb-0.5 mr-0.5 ${isToday ? 'bg-primary' : ''}`}
                style={{ width: 24, height: 24 }}
            >
                <Text
                    className={
                        isToday
                            ? 'text-primary-foreground'
                            : isCurrentMonth
                              ? 'text-foreground'
                              : 'text-muted-foreground'
                    }
                    style={{ fontSize: 12, fontWeight: '500' }}
                >
                    {dateNum}
                </Text>
            </View>

            {layouts.map((layout) => {
                if (layout.isAllDay) return null

                const event = eventMap.get(layout.id)
                if (!event) return null

                const cal = calendarMap.get(event.calendar)
                const colors = getCalendarColorResolved(cal?.color ?? 'blue')

                if (event.all_day) {
                    return (
                        <Pressable key={event.id} onPress={(e) => onEventPress(event.id, e)}>
                            <View
                                className="rounded-sm px-1 py-px mb-px"
                                style={{
                                    backgroundColor: colors.bg,
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: '600',
                                        color: colors.text,
                                    }}
                                    numberOfLines={1}
                                >
                                    {event.title}
                                </Text>
                            </View>
                        </Pressable>
                    )
                }

                const timeStr = formatShortTime(new Date(event.start))

                return (
                    <Pressable key={event.id} onPress={(e) => onEventPress(event.id, e)}>
                        <View className="flex-row items-center gap-[3px] py-px">
                            <View
                                className="size-1.5 rounded-full"
                                style={{
                                    backgroundColor: colors.bg,
                                }}
                            />
                            <Text className="text-muted-foreground" style={{ fontSize: 10 }}>
                                {timeStr}
                            </Text>
                            <Text className="flex-1 text-foreground" style={{ fontSize: 11 }} numberOfLines={1}>
                                {event.title}
                            </Text>
                        </View>
                    </Pressable>
                )
            })}

            {overflowCount > 0 && (
                <Pressable onPress={() => onDatePress(date)}>
                    <Text
                        className="text-muted-foreground"
                        style={{
                            fontSize: 11,
                            fontWeight: '600',
                            paddingVertical: 2,
                            textAlign: 'center',
                        }}
                    >
                        +{overflowCount} more
                    </Text>
                </Pressable>
            )}
        </Pressable>
    )
}
