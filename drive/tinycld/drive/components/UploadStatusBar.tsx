import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ActivityIndicator, Text, View } from 'react-native'
import { useUploadStore } from '../stores/upload-store'

// Reads upload state directly from the store rather than via useDrive() so
// progress ticks (~60ms) only re-render this bar, not the rest of the
// drive tree.
export function UploadStatusBar() {
    const accentColor = useThemeColor('primary')
    const uploadingFiles = useUploadStore((s) => s.uploadingFiles)

    const activeCount = uploadingFiles.filter((f) => f.status === 'pending' || f.status === 'uploading').length
    const errorCount = uploadingFiles.filter((f) => f.status === 'error').length

    // Mirror the previous gate: visible only while uploads are in flight or
    // have errored. Done entries linger in the store for ~3s for the
    // optimistic placeholder rows; we don't want a "complete" status sticking
    // around in the bar during that window.
    if (activeCount === 0 && errorCount === 0) return null

    const label =
        activeCount > 0
            ? `Uploading ${activeCount} file${activeCount !== 1 ? 's' : ''}...`
            : `${errorCount} upload${errorCount !== 1 ? 's' : ''} failed`

    return (
        <View className="flex-row items-center gap-2 px-4 py-2.5 border-t border-border bg-background">
            {activeCount > 0 && <ActivityIndicator size="small" color={accentColor} />}
            <Text className="text-foreground" style={{ fontSize: 13 }}>
                {label}
            </Text>
        </View>
    )
}
