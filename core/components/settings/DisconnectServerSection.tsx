import { disconnectServer } from '@tinycld/core/lib/pocketbase'
import { router } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

export function DisconnectServerSection() {
    async function onDisconnect() {
        await disconnectServer()
        router.replace('/connect')
    }

    return (
        <View className="gap-3">
            <Text className="text-xl font-bold text-foreground">Server</Text>
            <View className="rounded-xl border border-border bg-surface-secondary p-4 gap-2">
                <Text className="text-base font-semibold text-foreground">Disconnect server</Text>
                <Text className="text-[13px] text-muted-foreground">
                    Sign out and forget this server. Your account on the server is not deleted.
                </Text>
                <Pressable
                    onPress={onDisconnect}
                    className="self-start rounded-lg mt-1 px-3 py-2 border border-border"
                >
                    <Text className="text-foreground font-semibold">Disconnect</Text>
                </Pressable>
            </View>
        </View>
    )
}
