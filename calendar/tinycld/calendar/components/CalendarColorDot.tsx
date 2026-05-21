import { View } from 'react-native'
import { getCalendarColorResolved } from './calendar-colors'

interface CalendarColorDotProps {
    colorKey: string
    size?: number
}

export function CalendarColorDot({ colorKey, size = 10 }: CalendarColorDotProps) {
    const { bg } = getCalendarColorResolved(colorKey)
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }} />
}
