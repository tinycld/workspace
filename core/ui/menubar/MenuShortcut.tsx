import { Text, View } from 'react-native'

interface MenuShortcutProps {
    keys: string
}

export function MenuShortcut({ keys }: MenuShortcutProps) {
    return (
        <View className="ml-auto pl-6">
            <Text className="text-xs text-muted-foreground">{keys}</Text>
        </View>
    )
}
