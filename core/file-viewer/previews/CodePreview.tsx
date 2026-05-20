import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native'
import type { PreviewProps } from '../types'
import { useAuthedFileURL } from '../use-authed-file-url'

const MAX_PREVIEW_BYTES = 100_000

export function CodePreview({ source }: PreviewProps) {
    const { url, isLoading: urlLoading } = useAuthedFileURL(source)

    const { data: content, isLoading: contentLoading } = useQuery({
        queryKey: ['code-preview', url],
        queryFn: async () => {
            const resp = await fetch(url)
            const text = await resp.text()
            return text.slice(0, MAX_PREVIEW_BYTES)
        },
        enabled: Platform.OS === 'web' && !!url,
        staleTime: 60_000,
    })

    if (urlLoading || (Platform.OS === 'web' && contentLoading && url)) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator />
            </View>
        )
    }

    if (!url || content === undefined) {
        return (
            <View className="flex-1 items-center justify-center p-4">
                <Text className="text-muted-foreground">Cannot preview this file</Text>
            </View>
        )
    }

    return (
        <ScrollView className="flex-1 p-4">
            <Text className="text-foreground" style={{ fontSize: 13, fontFamily: 'monospace' }}>
                {content}
            </Text>
        </ScrollView>
    )
}
