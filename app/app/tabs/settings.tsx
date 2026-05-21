import { Text, View } from 'react-native'

export default function SettingsTab() {
    return (
        <View className="flex-1 items-center justify-center p-5">
            <Text className="text-2xl font-bold mb-3 text-foreground">Settings Tab</Text>
            <Text className="text-base text-center text-muted">
                App settings and preferences go here.
            </Text>
        </View>
    )
}
