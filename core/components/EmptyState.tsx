import type { Href } from 'expo-router'
import { Link } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

interface EmptyStateActionPress {
    label: string
    onPress: () => void
}

interface EmptyStateActionHref {
    label: string
    href: Href
}

interface EmptyStateProps {
    message: string
    action?: EmptyStateActionPress | EmptyStateActionHref
}

export function EmptyState({ message, action }: EmptyStateProps) {
    return (
        <View className="flex-1 items-center justify-center p-5 gap-3">
            <Text className="text-lg text-muted">{message}</Text>
            {action ? <EmptyStateAction action={action} /> : null}
        </View>
    )
}

function EmptyStateAction({ action }: { action: EmptyStateActionPress | EmptyStateActionHref }) {
    if ('href' in action) {
        return (
            <Link href={action.href}>
                <Text className="text-lg font-semibold text-accent">{action.label}</Text>
            </Link>
        )
    }

    return (
        <Pressable onPress={action.onPress}>
            <Text className="text-lg font-semibold text-accent">{action.label}</Text>
        </Pressable>
    )
}
