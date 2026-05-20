import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ActivityIndicator, Text, View } from 'react-native'

interface LoadingStateProps {
    /** Optional caption shown under the spinner. Omit for a bare indicator. */
    message?: string
    /** Indicator size. Defaults to "large" to match a full-pane loading state. */
    size?: 'small' | 'large'
}

/**
 * Shared full-pane loading state — a centered spinner with an optional caption.
 * Matches the visual weight of EmptyState so swapping between them on a
 * loading → empty → populated transition stays in place.
 */
export function LoadingState({ message, size = 'large' }: LoadingStateProps) {
    const accent = useThemeColor('primary')

    return (
        <View className="flex-1 items-center justify-center p-5 gap-3">
            <ActivityIndicator size={size} color={accent} />
            {message ? <Text className="text-sm text-muted-foreground">{message}</Text> : null}
        </View>
    )
}
