import NetInfo from '@react-native-community/netinfo'
import { useConnectivityStore } from '@tinycld/core/lib/stores/connectivity-store'
import { useEffect } from 'react'

const OFFLINE_DEBOUNCE_MS = 1500

export function useConnectivityDetector(): void {
    useEffect(() => {
        const { setOnline } = useConnectivityStore.getState()
        let offlineTimer: ReturnType<typeof setTimeout> | null = null

        const unsubscribe = NetInfo.addEventListener(state => {
            const reachable = state.isInternetReachable !== false
            const online = Boolean(state.isConnected) && reachable

            if (online) {
                if (offlineTimer) {
                    clearTimeout(offlineTimer)
                    offlineTimer = null
                }
                setOnline(true)
                return
            }

            if (offlineTimer) return
            offlineTimer = setTimeout(() => {
                setOnline(false)
                offlineTimer = null
            }, OFFLINE_DEBOUNCE_MS)
        })

        return () => {
            unsubscribe()
            if (offlineTimer) clearTimeout(offlineTimer)
        }
    }, [])
}
