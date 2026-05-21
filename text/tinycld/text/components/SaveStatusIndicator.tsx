import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { AlertCircle, Check, CloudOff } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { saveStatusLabel, saveStatusState } from './save-status-state'

interface SaveStatusIndicatorProps {
    status: 'ok' | 'failed'
    isConnected: boolean
}

// Pinned status pill driven by the MsgServerSlot frame the text
// broker emits when its serialise + upload pipeline completes.
//
// While the WebSocket is disconnected the broker emits nothing, so
// the last-known saveStatus would otherwise stay 'ok' while local
// edits accumulate offline — misleading the user into thinking
// their work is persisted. The connection-aware Offline state wins
// over saveStatus (see save-status-state.ts) so the UI never
// claims "Saved" without a live link to the server.
export function SaveStatusIndicator({ status, isConnected }: SaveStatusIndicatorProps) {
    const successColor = useThemeColor('success')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted-foreground')
    const state = saveStatusState({ status, isConnected })

    if (state === 'offline') {
        return (
            <View className="flex-row items-center gap-1.5 px-2 py-1 rounded-full">
                <CloudOff size={12} color={mutedColor} />
                <Text className="text-xs text-muted-foreground">
                    {saveStatusLabel.offline}
                </Text>
            </View>
        )
    }

    if (state === 'saved') {
        return (
            <View className="flex-row items-center gap-1.5 px-2 py-1 rounded-full">
                <Check size={12} color={successColor} />
                <Text className="text-xs text-muted-foreground">
                    {saveStatusLabel.saved}
                </Text>
            </View>
        )
    }

    return (
        <View className="flex-row items-center gap-1.5 px-2 py-1 rounded-full bg-danger-soft">
            <AlertCircle size={12} color={dangerColor} />
            <Text className="text-xs text-danger">{saveStatusLabel.failed}</Text>
        </View>
    )
}
