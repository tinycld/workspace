import { ActivityIndicator, Text, View } from 'react-native'

interface ReconnectingIndicatorProps {
    isVisible: boolean
}

// Pinned status pill shown in the document header when the realtime
// websocket is disconnected (server restart, transient network blip,
// laptop sleep). The reconnect logic in core's RealtimeClient handles
// the retry backoff; this just surfaces the in-progress state to the
// user so unsaved edits don't feel mysterious.
export function ReconnectingIndicator({ isVisible }: ReconnectingIndicatorProps) {
    if (!isVisible) return null
    return (
        <View className="flex-row items-center gap-1.5 px-2 py-1 rounded-full bg-surface-secondary">
            <ActivityIndicator size="small" />
            <Text className="text-xs text-muted-foreground">Reconnecting…</Text>
        </View>
    )
}
