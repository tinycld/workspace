import { HelpTopicView } from '@tinycld/core/components/help/HelpTopicView'
import type { HelpTopicId } from '@tinycld/core/lib/help/types'
import { useHelpTopic } from '@tinycld/core/lib/help/use-help-topics'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'

export default function HelpTopicPermalink() {
    const { pkg, topic } = useLocalSearchParams<{ pkg: string; topic: string }>()
    const id = `${pkg}:${topic}` as HelpTopicId
    const helpTopic = useHelpTopic(id)

    if (!helpTopic) {
        return (
            <View className="flex-1 bg-background p-5">
                <Text className="text-foreground text-2xl font-bold mb-2">Topic not found</Text>
                <Text className="text-muted-foreground text-sm">
                    The help topic "{id}" is not installed.
                </Text>
            </View>
        )
    }

    return (
        <ScrollView className="flex-1 bg-background" contentContainerStyle={{ flexGrow: 1 }}>
            <View className="p-5 max-w-[720px] w-full">
                <HelpTopicView topic={helpTopic} />
            </View>
        </ScrollView>
    )
}
