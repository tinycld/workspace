import { Text, View } from 'react-native'
import { getShortDayName } from '../hooks/useCalendarNavigation'

interface DayColumnHeaderProps {
    date: Date
    isToday: boolean
}

export function DayColumnHeader({ date, isToday }: DayColumnHeaderProps) {
    const dayName = getShortDayName(date)
    const dateNum = date.getDate()

    return (
        <View className="items-center py-2 gap-1">
            <Text
                className={isToday ? 'text-primary' : 'text-muted-foreground'}
                style={{ fontSize: 11, fontWeight: '600' }}
            >
                {dayName}
            </Text>
            <View
                className={`rounded-full items-center justify-center ${isToday ? 'bg-primary' : ''}`}
                style={{ width: 28, height: 28 }}
            >
                <Text
                    className={isToday ? 'text-primary-foreground' : 'text-foreground'}
                    style={{ fontSize: 16, fontWeight: '600' }}
                >
                    {dateNum}
                </Text>
            </View>
        </View>
    )
}
