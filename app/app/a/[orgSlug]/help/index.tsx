import { searchHelpTopics } from '@tinycld/core/lib/help/search'
import type { HelpTopicId } from '@tinycld/core/lib/help/types'
import { useHelpGroups, useHelpTopics } from '@tinycld/core/lib/help/use-help-topics'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useRouter } from 'expo-router'
import { ChevronRight, Search } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'

export default function HelpHub() {
    const groups = useHelpGroups()
    const allTopics = useHelpTopics()
    const [query, setQuery] = useState('')
    const orgHref = useOrgHref()
    const router = useRouter()
    const mutedColor = useThemeColor('muted-foreground')
    const fieldFg = useThemeColor('field-foreground')
    const placeholderColor = useThemeColor('field-placeholder')

    const isSearching = query.trim().length > 0
    const results = useMemo(
        () => (isSearching ? searchHelpTopics(allTopics, query) : []),
        [isSearching, allTopics, query]
    )

    function openTopic(id: HelpTopicId) {
        const colon = id.indexOf(':')
        const pkg = id.slice(0, colon)
        const topic = id.slice(colon + 1)
        router.push(orgHref('help/[pkg]/[topic]', { pkg, topic }))
    }

    const hasContent = groups.length > 0

    return (
        <ScrollView className="flex-1 bg-background" contentContainerStyle={{ flexGrow: 1 }}>
            <View className="p-5 max-w-[720px] w-full">
                <Text className="mb-4 text-foreground text-[28px] font-bold">Help</Text>

                <View className="flex-row items-center gap-2 px-3 py-2 mb-5 rounded-lg bg-field border border-field-border">
                    <Search size={16} color={mutedColor} />
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search help topics"
                        placeholderTextColor={placeholderColor}
                        className="flex-1 text-base"
                        style={{ color: fieldFg }}
                        accessibilityLabel="Search help topics"
                    />
                </View>

                {!hasContent && (
                    <Text className="text-sm text-muted-foreground">
                        No help topics are available.
                    </Text>
                )}

                {hasContent &&
                    isSearching &&
                    (results.length === 0 ? (
                        <Text className="text-sm text-muted-foreground">
                            No topics match "{query}".
                        </Text>
                    ) : (
                        <View className="rounded-xl border overflow-hidden bg-surface-secondary border-border">
                            {results.map(({ topic }) => (
                                <HelpLink
                                    key={topic.id}
                                    title={topic.title}
                                    summary={topic.summary}
                                    onPress={() => openTopic(topic.id)}
                                />
                            ))}
                        </View>
                    ))}

                {hasContent &&
                    !isSearching &&
                    groups.map(group => (
                        <View key={group.pkgSlug} className="mb-5">
                            <Text
                                className="mb-2 text-primary text-[13px] font-semibold uppercase"
                                style={{ letterSpacing: 0.5 }}
                            >
                                {group.packageName}
                            </Text>
                            <View className="rounded-xl border overflow-hidden bg-surface-secondary border-border">
                                {group.topics.map(topic => (
                                    <HelpLink
                                        key={topic.id}
                                        title={topic.title}
                                        summary={topic.summary}
                                        onPress={() => openTopic(topic.id)}
                                    />
                                ))}
                            </View>
                        </View>
                    ))}
            </View>
        </ScrollView>
    )
}

function HelpLink({
    title,
    summary,
    onPress,
}: {
    title: string
    summary: string
    onPress: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    return (
        <Pressable
            onPress={onPress}
            className="flex-row items-center justify-between px-4 py-3.5"
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
            <View className="flex-1 pr-2">
                <Text className="text-foreground text-base">{title}</Text>
                <Text className="text-sm text-muted-foreground mt-0.5">{summary}</Text>
            </View>
            <ChevronRight size={18} color={mutedColor} />
        </Pressable>
    )
}
