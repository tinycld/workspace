import { checkVersion } from '@tinycld/core/lib/check-version'
import { useVersionStore } from '@tinycld/core/lib/stores/version-store'
import { useEffect } from 'react'
import { Platform } from 'react-native'

const POLL_INTERVAL_MS = 60 * 60 * 1000

export function useVersionCheck() {
    const setNewVersionAvailable = useVersionStore(s => s.setNewVersionAvailable)

    useEffect(() => {
        if (Platform.OS !== 'web') return
        const bootReleaseId = process.env.EXPO_PUBLIC_RELEASE_ID
        if (!bootReleaseId) return

        const run = () =>
            checkVersion({
                bootReleaseId,
                setNewVersionAvailable,
            })

        const interval = setInterval(run, POLL_INTERVAL_MS)

        const onVisible = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                run()
            }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisible)
        }

        return () => {
            clearInterval(interval)
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisible)
            }
        }
    }, [setNewVersionAvailable])
}
