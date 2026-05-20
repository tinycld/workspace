import { ActivityIndicator, Image, View } from 'react-native'
import type { PreviewProps } from '../types'
import { useAuthedFileURL } from '../use-authed-file-url'

export function ImagePreview({ source }: PreviewProps) {
    const { url, isLoading } = useAuthedFileURL(source)

    if (isLoading) return <ActivityIndicator />
    if (!url) return null

    return (
        <View className="flex-1 items-center justify-center p-4">
            <Image source={{ uri: url }} className="w-full h-full" resizeMode="contain" />
        </View>
    )
}
