import { View } from 'react-native'

interface CurrentTimeIndicatorProps {
    topOffset: number
}

export function CurrentTimeIndicator({ topOffset }: CurrentTimeIndicatorProps) {
    return (
        <View
            className="absolute left-0 right-0 flex-row items-center"
            style={{
                top: topOffset,
                zIndex: 10,
                pointerEvents: 'none',
            }}
        >
            <View className="size-2.5 rounded-full bg-danger" style={{ marginLeft: -5 }} />
            <View className="flex-1 bg-danger" style={{ height: 2 }} />
        </View>
    )
}
