import { useHelpGroupForPackage } from '@tinycld/core/lib/help/use-help-topics'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'

export default function PackageHelpIndex() {
    const { pkg } = useLocalSearchParams<{ pkg: string }>()
    const group = useHelpGroupForPackage(pkg)
    const orgHref = useOrgHref()
    const router = useRouter()
    const mutedColor = useThemeColor('muted-foreground')

    if (!group) {
        return (
            <View className="flex-1 bg-background p-5">
                <Text className="text-foreground text-2xl font-bold mb-2">Help not available</Text>
                <Text className="text-muted-foreground text-sm">
                    No help topics are installed for "{pkg}".
                </Text>
            </View>
        )
    }

    return (
        <ScrollView className="flex-1 bg-background" contentContainerStyle={{ flexGrow: 1 }}>
            <View className="p-5 max-w-[720px] w-full">
                <Text className="mb-4 text-foreground text-[28px] font-bold">
                    {group.packageName} help
                </Text>
                <View className="rounded-xl border overflow-hidden bg-surface-secondary border-border">
                    {group.topics.map(topic => (
                        <Pressable
                            key={topic.id}
                            onPress={() =>
                                router.push(
                                    orgHref('help/[pkg]/[topic]', {
                                        pkg: group.pkgSlug,
                                        topic: topic.topicId,
                                    })
                                )
                            }
                            className="flex-row items-center justify-between px-4 py-3.5"
                            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                        >
                            <View className="flex-1 pr-2">
                                <Text className="text-foreground text-base">{topic.title}</Text>
                                <Text className="text-sm text-muted-foreground mt-0.5">
                                    {topic.summary}
                                </Text>
                            </View>
                            <ChevronRight size={18} color={mutedColor} />
                        </Pressable>
                    ))}
                </View>
            </View>
        </ScrollView>
    )
}
