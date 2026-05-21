import { LoadingState } from '@tinycld/core/components/LoadingState'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo, useState } from 'react'
import { FlatList, type GestureResponderEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useCalendarEvents, useCalendarMap } from '../hooks/useCalendarEvents'
import {
    addDays,
    endOfDay,
    isToday as checkIsToday,
    eventOverlapsRange,
    getShortDayName,
    toDateString,
} from '../hooks/useCalendarNavigation'
import { useCalendarView } from '../hooks/useCalendarView'
import { useCalendarUIStore } from '../stores/calendar-ui-store'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'

const SCHEDULE_DAYS = 30

interface DayRow {
    key: string
    date: Date
    events: CalendarEvents[]
    today: boolean
}

function formatTimeRange(event: CalendarEvents): string {
    if (event.all_day) return 'All day'
    const start = new Date(event.start)
    const end = new Date(event.end)
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${fmt(start)} – ${fmt(end)}`
}

function EventCard({
    event,
    isFocused,
    onPress,
}: {
    event: CalendarEvents
    isFocused: boolean
    onPress: (id: string, e: GestureResponderEvent) => void
}) {
    const calendarMap = useCalendarMap()
    const activeIndicator = useThemeColor('active-indicator')
    const cal = calendarMap.get(event.calendar)
    const colors = getCalendarColorResolved(cal?.color ?? 'blue')
    const [isHovered, setIsHovered] = useState(false)

    // Event cards already carry the calendar's color stripe on the left,
    // so use an outline ring rather than an inset stripe for focus/hover.
    const highlight =
        Platform.OS === 'web' && (isFocused || isHovered)
            ? ({
                  boxShadow: `0 0 0 ${isFocused ? 2 : 1}px ${activeIndicator}`,
              } as Record<string, unknown>)
            : null

    const hoverWebProps =
        Platform.OS === 'web'
            ? {
                  onMouseEnter: () => setIsHovered(true),
                  onMouseLeave: () => setIsHovered(false),
              }
            : {}

    return (
        <Pressable
            className="flex-row rounded-lg overflow-hidden"
            onPress={(e) => onPress(event.id, e)}
            style={highlight}
            {...hoverWebProps}
        >
            <View style={{ width: 4, backgroundColor: colors.bg }} />
            <View className="flex-1 py-2 px-2.5 bg-surface-secondary">
                <Text
                    className="text-foreground"
                    style={{ fontSize: 14, fontWeight: '600', marginBottom: 2 }}
                    numberOfLines={1}
                >
                    {event.title}
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                    {formatTimeRange(event)}
                </Text>
                {event.location ? (
                    <Text className="text-muted-foreground" style={{ fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                        {event.location}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    )
}

function DaySection({
    row,
    focusedEventId,
    onEventPress,
    onEmptyPress,
}: {
    row: DayRow
    focusedEventId: string | null
    onEventPress: (id: string, e: GestureResponderEvent) => void
    onEmptyPress: (date: Date) => void
}) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')

    return (
        <View
            className="flex-row py-3 px-4 gap-4 border-border"
            style={{
                borderBottomWidth: StyleSheet.hairlineWidth,
            }}
        >
            <View className="w-[44px] items-center">
                <Text
                    style={{
                        fontSize: 11,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        marginBottom: 2,
                        color: row.today ? primaryColor : mutedColor,
                    }}
                >
                    {getShortDayName(row.date)}
                </Text>
                <View
                    className="size-8 rounded-full items-center justify-center"
                    style={{
                        backgroundColor: row.today ? primaryColor : undefined,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 18,
                            fontWeight: '500',
                            color: row.today ? primaryFgColor : fgColor,
                        }}
                    >
                        {row.date.getDate()}
                    </Text>
                </View>
            </View>
            <View className="flex-1 gap-1.5 justify-center">
                {row.events.length > 0 ? (
                    row.events.map((event) => (
                        <EventCard
                            key={event.id}
                            event={event}
                            isFocused={event.id === focusedEventId}
                            onPress={onEventPress}
                        />
                    ))
                ) : (
                    <Pressable onPress={() => onEmptyPress(row.date)}>
                        <Text style={{ fontSize: 13, fontStyle: 'italic', color: mutedColor }}>Nothing planned</Text>
                    </Pressable>
                )}
            </View>
        </View>
    )
}

export function ScheduleView() {
    const { focusDate, openQuickCreate, openEventDetail } = useCalendarView()
    const endDate = useMemo(() => endOfDay(addDays(focusDate, SCHEDULE_DAYS - 1)), [focusDate])
    const { events, isLoading } = useCalendarEvents(focusDate, endDate)

    const rows = useMemo(() => {
        const result: DayRow[] = []
        for (let i = 0; i < SCHEDULE_DAYS; i++) {
            const date = addDays(focusDate, i)
            const dayStart = new Date(date)
            dayStart.setHours(0, 0, 0, 0)
            const dayEnd = new Date(date)
            dayEnd.setHours(23, 59, 59, 999)
            const dayEvents = events
                .filter((e) => eventOverlapsRange(e, dayStart, dayEnd))
                .sort((a, b) => {
                    if (a.all_day && !b.all_day) return -1
                    if (!a.all_day && b.all_day) return 1
                    return new Date(a.start).getTime() - new Date(b.start).getTime()
                })
            result.push({
                key: toDateString(date),
                date,
                events: dayEvents,
                today: checkIsToday(date),
            })
        }
        return result
    }, [focusDate, events])

    const flatEvents = useMemo(() => rows.flatMap((r) => r.events), [rows])

    const { focusedId } = useScheduleShortcuts({
        events: flatEvents,
        openEventDetail,
        onNewEvent: () => openQuickCreate(new Date(), 9),
    })

    const handleEmptyPress = (date: Date) => {
        openQuickCreate(date, 9)
    }

    if (isLoading && flatEvents.length === 0) return <LoadingState />

    return (
        <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={({ item }) => (
                <DaySection
                    row={item}
                    focusedEventId={focusedId}
                    onEventPress={openEventDetail}
                    onEmptyPress={handleEmptyPress}
                />
            )}
            className="flex-1"
        />
    )
}

interface ScheduleShortcutsArgs {
    events: CalendarEvents[]
    openEventDetail: (id: string, e: GestureResponderEvent) => void
    onNewEvent: () => void
}

function useScheduleShortcuts({ events, openEventDetail, onNewEvent }: ScheduleShortcutsArgs) {
    const storedIndex = useCalendarUIStore((s) => s.scheduleFocusedIndex)
    const setFocusedIndex = useCalendarUIStore((s) => s.setScheduleFocusedIndex)
    useShortcutScope('list')

    const focusedIndex = events.length === 0 ? 0 : Math.min(storedIndex, events.length - 1)
    const focusedId = events[focusedIndex]?.id ?? null

    const shortcuts = useMemo<Shortcut[]>(
        () => [
            {
                id: 'calendar.schedule.next',
                keys: 'j',
                scope: 'list',
                group: 'Calendar',
                description: 'Next event',
                run: () => setFocusedIndex((i) => Math.min(i + 1, Math.max(events.length - 1, 0))),
            },
            {
                id: 'calendar.schedule.prev',
                keys: 'k',
                scope: 'list',
                group: 'Calendar',
                description: 'Previous event',
                run: () => setFocusedIndex((i) => Math.max(i - 1, 0)),
            },
            {
                id: 'calendar.schedule.open',
                keys: 'Enter',
                scope: 'list',
                group: 'Calendar',
                description: 'Open event',
                run: () => {
                    if (!focusedId) return
                    openEventDetail(focusedId, {
                        nativeEvent: {},
                    } as unknown as GestureResponderEvent)
                },
            },
            {
                id: 'calendar.schedule.new',
                keys: 'Shift+C',
                scope: 'list',
                group: 'Calendar',
                description: 'New event',
                run: () => onNewEvent(),
            },
        ],
        [events.length, focusedId, openEventDetail, onNewEvent, setFocusedIndex]
    )

    useRegisterShortcuts(shortcuts)

    return { focusedId }
}
