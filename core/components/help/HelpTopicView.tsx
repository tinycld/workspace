import { Text, View } from 'react-native'
import type { HelpTopic } from '../../lib/help/types'
import { MarkdownRenderer } from './MarkdownRenderer'

interface Props {
    topic: HelpTopic
    showTitle?: boolean
}

export function HelpTopicView({ topic, showTitle = true }: Props) {
    return (
        <View>
            {showTitle && (
                <View className="mb-3">
                    <Text className="text-2xl font-bold text-foreground">{topic.title}</Text>
                    <Text className="text-sm text-muted-foreground mt-1">{topic.summary}</Text>
                </View>
            )}
            <MarkdownRenderer body={topic.body} />
        </View>
    )
}
