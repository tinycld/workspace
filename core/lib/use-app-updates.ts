import { captureException } from '@tinycld/core/lib/errors'
import { useAuthStore } from '@tinycld/core/lib/stores/auth-store'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import * as Updates from 'expo-updates'
import { useEffect } from 'react'
import { AppState, type AppStateStatus, Platform } from 'react-native'

declare const __DEV__: boolean

const LAUNCH_DELAY_MS = 3000
// Time the "Update ready" toast is on screen before reloadAsync swaps the JS
// bundle. Anything under ~1s and the toast renders for a few frames before
// the JS context is killed, which is worse than no toast at all. 1.5s is
// long enough to register the message and short enough not to feel sluggish.
const TOAST_VISIBLE_BEFORE_RELOAD_MS = 1500

// Flip the EAS Update channel header per user. Beta-flagged users on the same
// production binary fetch from the preview channel; everyone else stays on
// production. The override is global so we re-set it before every check —
// cheap, and it means a user whose flag flips mid-session syncs correctly the
// next time we check (foreground or relaunch).
function syncUpdateChannel(): void {
    const user = useAuthStore.getState().user
    const channel = user?.isBetaTester ? 'preview' : 'production'
    Updates.setUpdateRequestHeadersOverride({
        'expo-channel-name': channel,
    })
}

async function checkAndApplyUpdate(): Promise<void> {
    if (__DEV__ || Platform.OS === 'web') return

    try {
        syncUpdateChannel()
        const result = await Updates.checkForUpdateAsync()
        if (!result.isAvailable) return

        const fetched = await Updates.fetchUpdateAsync()
        if (!fetched.isNew) return

        // Surface a toast first so the imminent white flash from reloadAsync
        // has context — without it the screen blinks and the user has no idea
        // why. Delay the reload by TOAST_VISIBLE_BEFORE_RELOAD_MS so the toast
        // is actually on screen long enough to read.
        useToastStore.getState().addToast({
            title: 'Update ready',
            body: 'Restarting to apply the latest version…',
            variant: 'info',
            duration: TOAST_VISIBLE_BEFORE_RELOAD_MS + 500,
        })
        await new Promise(resolve => setTimeout(resolve, TOAST_VISIBLE_BEFORE_RELOAD_MS))

        // Cold-launch reload: the new bundle is staged and active immediately.
        // Foreground reload feels surprising mid-task, but the alternative (silent
        // staging until next cold launch) means a user can hit a known bug and
        // never see the fix while their session is open. Trade off in favor of
        // delivery — we only get here when a real update was published since the
        // app was last foregrounded, so the interruption is information, not noise.
        await Updates.reloadAsync()
    } catch (error) {
        captureException('use-app-updates.check', error)
    }
}

export function useAppUpdates(): void {
    useEffect(() => {
        if (__DEV__ || Platform.OS === 'web') return

        const launchTimer = setTimeout(checkAndApplyUpdate, LAUNCH_DELAY_MS)

        const handleAppStateChange = (next: AppStateStatus) => {
            if (next === 'active') {
                checkAndApplyUpdate()
            }
        }
        const subscription = AppState.addEventListener('change', handleAppStateChange)

        return () => {
            clearTimeout(launchTimer)
            subscription.remove()
        }
    }, [])
}
