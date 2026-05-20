import { useConnectivityStore } from '@tinycld/core/lib/stores/connectivity-store'
import { useEffect } from 'react'

const OFFLINE_DEBOUNCE_MS = 1500

export function useConnectivityDetector(): void {
    useEffect(() => {
        if (typeof window === 'undefined') return

        const { setOnline } = useConnectivityStore.getState()
        let offlineTimer: ReturnType<typeof setTimeout> | null = null

        setOnline(navigator.onLine)

        const handleOnline = () => {
            if (offlineTimer) {
                clearTimeout(offlineTimer)
                offlineTimer = null
            }
            setOnline(true)
        }

        const handleOffline = () => {
            if (offlineTimer) clearTimeout(offlineTimer)
            offlineTimer = setTimeout(() => {
                setOnline(false)
                offlineTimer = null
            }, OFFLINE_DEBOUNCE_MS)
        }

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            if (offlineTimer) clearTimeout(offlineTimer)
        }
    }, [])
}
