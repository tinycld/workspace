import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { addMonths, isSameDay } from '../hooks/useCalendarNavigation'
import { getMonthGrid } from '../hooks/useMonthGrid'

const DAY_LETTERS = [
    { key: 'sun', label: 'S' },
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
]

interface MiniCalendarProps {
    selectedDate: Date
    onDateSelect: (date: Date) => void
}

export function MiniCalendar({ selectedDate, onDateSelect }: MiniCalendarProps) {
    const [displayMonth, setDisplayMonth] = useState(
        () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    )
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const activeIndicatorColor = useThemeColor('active-indicator')

    const grid = getMonthGrid(displayMonth)

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

    const monthLabel = `${months[displayMonth.getMonth()]} ${displayMonth.getFullYear()}`

    return (
        <View className="px-3 py-2">
            <View className="flex-row justify-between items-center mb-2">
                <Text className="text-foreground" style={{ fontSize: 15, fontWeight: '600' }}>
                    {monthLabel}
                </Text>
                <View className="flex-row gap-2">
                    <Pressable onPress={() => setDisplayMonth((prev) => addMonths(prev, -1))} hitSlop={8}>
                        <ChevronLeft size={16} color={mutedColor} />
                    </Pressable>
                    <Pressable onPress={() => setDisplayMonth((prev) => addMonths(prev, 1))} hitSlop={8}>
                        <ChevronRight size={16} color={mutedColor} />
                    </Pressable>
                </View>
            </View>

            <View className="flex-row">
                {DAY_LETTERS.map((day) => (
                    <View key={day.key} className="items-center py-px" style={{ width: '14.28%' }}>
                        <Text className="text-muted-foreground" style={{ fontSize: 12, fontWeight: '600' }}>
                            {day.label}
                        </Text>
                    </View>
                ))}
            </View>

            <View className="flex-row flex-wrap">
                {grid.map((cell) => {
                    const isSelected = isSameDay(cell.date, selectedDate)
                    const cellKey = cell.date.toISOString().split('T')[0]

                    return (
                        <Pressable
                            key={cellKey}
                            className="items-center py-px"
                            style={{ width: '14.28%' }}
                            onPress={() => onDateSelect(cell.date)}
                        >
                            <View
                                className="rounded-full items-center justify-center"
                                style={{
                                    width: 28,
                                    height: 28,
                                    backgroundColor: cell.isToday
                                        ? primaryColor
                                        : isSelected
                                          ? `${activeIndicatorColor}30`
                                          : undefined,
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 13,
                                        fontWeight: cell.isToday ? '700' : undefined,
                                        color: cell.isToday
                                            ? primaryFgColor
                                            : cell.isCurrentMonth
                                              ? fgColor
                                              : mutedColor,
                                    }}
                                >
                                    {cell.date.getDate()}
                                </Text>
                            </View>
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}
