import { Text, View } from 'react-native'

export default function HomeTab() {
    return (
        <View className="flex-1 items-center justify-center p-5">
            <Text className="text-2xl font-bold mb-3 text-foreground">Home Tab</Text>
            <Text className="text-base text-center text-muted">
                This is a custom headless tab implementation using One's UI primitives.
            </Text>
        </View>
    )
}
