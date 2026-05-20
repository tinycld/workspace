import { getCoreConfigOptional } from '@tinycld/core/lib/core-config'
import { getResolvedAddress } from '@tinycld/core/lib/server-address'
import Constants from 'expo-constants'
import { Linking, Pressable, Text, View } from 'react-native'

const DEFAULT_PRIVACY_URL = 'https://tinycld.org/privacy'
const DEFAULT_SOURCE_URL = 'https://github.com/tinycld/tinycld'

export function AboutSection() {
    const config = getCoreConfigOptional()
    const version = Constants.expoConfig?.version ?? 'unknown'
    const rawCommit = config?.release ?? 'dev'
    const commit = rawCommit.slice(0, 7)
    const server = getResolvedAddress() ?? 'not connected'
    const privacyUrl = config?.privacyUrl ?? DEFAULT_PRIVACY_URL
    const sourceUrl = config?.sourceUrl ?? DEFAULT_SOURCE_URL

    return (
        <View className="gap-3">
            <Text className="text-xl font-bold text-foreground">About</Text>
            <View className="rounded-xl border border-border bg-surface-secondary p-4 gap-2">
                <Row label="Version" value={`${version} (${commit})`} />
                <Row label="Server" value={server} />
                <Pressable onPress={() => Linking.openURL(privacyUrl)}>
                    <Text className="text-sm text-primary">Privacy policy</Text>
                </Pressable>
                <Pressable onPress={() => Linking.openURL(sourceUrl)}>
                    <Text className="text-sm text-primary">Source code (AGPL-3.0)</Text>
                </Pressable>
            </View>
        </View>
    )
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <View className="flex-row justify-between items-center">
            <Text className="text-sm text-muted-foreground">{label}</Text>
            <Text className="text-sm text-foreground" numberOfLines={1}>
                {value}
            </Text>
        </View>
    )
}
