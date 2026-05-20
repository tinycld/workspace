import { ActivityIndicator, Platform, View } from 'react-native'
import type { PreviewProps } from '../types'
import { useAuthedFileURL } from '../use-authed-file-url'
import { GenericPreview } from './GenericPreview'

export function VideoPreview(props: PreviewProps) {
    const { url, isLoading } = useAuthedFileURL(props.source)

    if (isLoading) return <ActivityIndicator />
    if (!url) return null

    if (Platform.OS === 'web') {
        return (
            <View className="flex-1 items-center justify-center">
                {/* biome-ignore lint/a11y/useMediaCaption: captions not available for user uploads */}
                <video src={url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </View>
        )
    }

    return <GenericPreview {...props} />
}
