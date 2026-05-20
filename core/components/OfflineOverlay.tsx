import { disconnectServer } from '@tinycld/core/lib/pocketbase'
import { getResolvedAddress, probe } from '@tinycld/core/lib/server-address'
import { useConnectivityStore } from '@tinycld/core/lib/stores/connectivity-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { router } from 'expo-router'
import { ServerOff, WifiOff } from 'lucide-react-native'
import { useEffect } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'

const RECHECK_INTERVAL_MS = 5_000
const PROBE_TIMEOUT_MS = 3_000

export function OfflineOverlay() {
    const isOnline = useConnectivityStore(s => s.isOnline)
    const isServerReachable = useConnectivityStore(s => s.isServerReachable)
    const warningColor = useThemeColor('warning')

    // While the server-unreachable card is showing AND the device claims
    // to have network, poll /api/health so we can self-dismiss when the
    // server comes back. Skip when the OS says we're offline — there's
    // no point burning network calls that will fail on the radio level.
    const shouldPoll = isOnline && !isServerReachable
    useEffect(() => {
        if (!shouldPoll) return
        let cancelled = false

        async function check() {
            const address = getResolvedAddress()
            if (!address) return
            try {
                await probe(address, PROBE_TIMEOUT_MS)
                if (cancelled) return
                useConnectivityStore.getState().setServerReachable(true)
            } catch {
                // still down — wait for the next tick
            }
        }

        check()
        const id = setInterval(check, RECHECK_INTERVAL_MS)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [shouldPoll])

    if (isOnline && isServerReachable) return null

    // Two distinct failure modes deserve distinct copy:
    // - device offline (no wifi/cell): tell the user to reconnect; we'll
    //   self-dismiss when the OS reports network back.
    // - device online but PB unreachable: a stale or wrong server URL is
    //   the most common cause. Show the address and a way to change it.
    const deviceOffline = !isOnline
    const address = getResolvedAddress()
    const addressLabel = address ? (hostLabel(address) ?? address) : null

    const isWeb = Platform.OS === 'web'
    const fillStyle = isWeb
        ? ({ position: 'fixed', inset: 0 } as unknown as object)
        : { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 }

    return (
        <View
            testID="offline-overlay"
            style={{ ...fillStyle, zIndex: 10001, alignItems: 'center', justifyContent: 'center' }}
            className="bg-warning-soft"
            pointerEvents="auto"
        >
            <View
                className="bg-background border-border max-w-sm w-[88%] rounded-2xl border p-6"
                style={
                    isWeb
                        ? { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }
                        : {
                              elevation: 6,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 4 },
                              shadowOpacity: 0.12,
                              shadowRadius: 12,
                          }
                }
            >
                <View className="items-center gap-4">
                    {deviceOffline ? (
                        <WifiOff size={36} color={warningColor} />
                    ) : (
                        <ServerOff size={36} color={warningColor} />
                    )}
                    <Text className="text-lg font-semibold text-foreground text-center">
                        {deviceOffline ? "You're offline" : "Can't reach the server"}
                    </Text>
                    <Text className="text-sm text-muted-foreground text-center">
                        {deviceOffline
                            ? "Reconnect to keep working. We'll dismiss this automatically once you're back online."
                            : addressLabel
                              ? `Unable to reach ${addressLabel}.`
                              : 'Unable to reach the server.'}
                    </Text>
                    {!deviceOffline && <ChangeServerButton />}
                </View>
            </View>
        </View>
    )
}

function ChangeServerButton() {
    async function onPress() {
        // disconnectServer tears down realtime + in-flight requests before
        // dropping the address — necessary because PB's RealtimeService
        // tries to auto-reconnect, and reconnecting after the address is
        // cleared throws "PB_SERVER_ADDR accessed before resolved".
        await disconnectServer()
        router.replace('/connect?backTo=/')
    }
    return (
        <Pressable onPress={onPress} accessibilityRole="button" className="mt-2">
            <Text className="text-sm font-medium text-primary underline">Change server</Text>
        </Pressable>
    )
}

function hostLabel(url: string): string | null {
    try {
        const u = new URL(url)
        return u.host || null
    } catch {
        return null
    }
}
