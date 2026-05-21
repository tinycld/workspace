import { Text, View } from 'react-native'

interface NotFoundStateProps {
    message: string
}

export function NotFoundState({ message }: NotFoundStateProps) {
    return (
        <View className="flex-1 items-center justify-center bg-background">
            <Text className="text-base text-muted">{message}</Text>
        </View>
    )
}
