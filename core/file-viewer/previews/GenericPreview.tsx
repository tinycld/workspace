import { formatBytes } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Download } from 'lucide-react-native'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { getFileIconForMime } from '../file-icons'
import { downloadFile } from '../file-url'
import type { PreviewProps } from '../types'
import { useAuthedFileURL } from '../use-authed-file-url'

export function GenericPreview({ source }: PreviewProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryFgColor = useThemeColor('primary-foreground')
    const { icon: FileIcon, color: iconColor } = getFileIconForMime(source.mimeType, mutedColor)
    const { url, isLoading } = useAuthedFileURL(source)

    if (isLoading) return <ActivityIndicator />

    return (
        <View className="flex-1 items-center justify-center p-8">
            <FileIcon size={80} color={iconColor} />
            <Text
                className="mt-4 text-foreground"
                style={{
                    fontSize: 20,
                    fontWeight: '600',
                }}
            >
                {source.displayName}
            </Text>
            <Text className="mt-1 text-muted-foreground" style={{ fontSize: 13 }}>
                {source.mimeType} · {formatBytes(source.size)}
            </Text>
            {url && (
                <Pressable
                    onPress={() => downloadFile(source)}
                    className="flex-row items-center gap-2 mt-5 px-5 py-3 rounded-lg bg-primary"
                >
                    <Download size={16} color={primaryFgColor} />
                    <Text className="text-primary-foreground" style={{ fontWeight: '600' }}>
                        Download
                    </Text>
                </Pressable>
            )}
        </View>
    )
}
