import { Pressable, Text, View } from 'react-native'
import { useHelpStore } from '../../lib/help/store'
import type { HelpTopic } from '../../lib/help/types'
import { useHelpGroupForPackage } from '../../lib/help/use-help-topics'

interface Props {
    pkgSlug: string
}

export function PackageTopicList({ pkgSlug }: Props) {
    const group = useHelpGroupForPackage(pkgSlug)
    const navigateToTopic = useHelpStore(s => s.navigateToTopic)
    const topics = group?.topics ?? []

    if (topics.length === 0) {
        return (
            <Text className="text-sm text-muted-foreground px-4">
                No topics in this package yet.
            </Text>
        )
    }

    return (
        <View>
            {topics.map((topic, index) => (
                <TopicRow
                    key={topic.id}
                    topic={topic}
                    isLast={index === topics.length - 1}
                    onPress={() => navigateToTopic(topic.id)}
                />
            ))}
        </View>
    )
}

interface RowProps {
    topic: HelpTopic
    isLast: boolean
    onPress: () => void
}

function TopicRow({ topic, isLast, onPress }: RowProps) {
    const borderClass = isLast ? '' : 'border-b border-border'
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Open help topic: ${topic.title}`}
            className={`px-4 py-3 ${borderClass} hover:bg-surface-secondary`}
        >
            <Text className="text-base font-medium text-foreground">{topic.title}</Text>
            <Text className="text-sm text-muted-foreground mt-1">{topic.summary}</Text>
        </Pressable>
    )
}
