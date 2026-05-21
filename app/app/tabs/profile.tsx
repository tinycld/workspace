import { Text, View } from 'react-native'

export default function ProfileTab() {
    return (
        <View className="flex-1 items-center justify-center p-5">
            <Text className="text-2xl font-bold mb-3 text-foreground">Profile Tab</Text>
            <Text className="text-base text-center text-muted">
                Your profile information goes here.
            </Text>
        </View>
    )
}
