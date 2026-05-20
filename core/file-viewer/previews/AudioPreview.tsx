import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { getFileIconForMime } from '../file-icons'
import type { PreviewProps } from '../types'
import { useAuthedFileURL } from '../use-authed-file-url'
import { GenericPreview } from './GenericPreview'

export function AudioPreview(props: PreviewProps) {
    const { source } = props
    const mutedColor = useThemeColor('muted-foreground')
    const { icon: FileIcon, color: iconColor } = getFileIconForMime(source.mimeType, mutedColor)
    const { url, isLoading } = useAuthedFileURL(source)

    if (isLoading) return <ActivityIndicator />
    if (!url) return null

    if (Platform.OS === 'web') {
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
                <View className="w-full mt-6" style={{ maxWidth: 400 }}>
                    {/* biome-ignore lint/a11y/useMediaCaption: captions not available for user uploads */}
                    <audio src={url} controls style={{ width: '100%' }} />
                </View>
            </View>
        )
    }

    return <GenericPreview {...props} />
}
