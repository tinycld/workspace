import { captureException } from '@tinycld/core/lib/errors'
import { useEffect } from 'react'
import { Platform } from 'react-native'

const RELOAD_THROTTLE_KEY = 'tinycld_chunk_reload_at'
const RELOAD_THROTTLE_MS = 30 * 1000

// useChunkLoadRecovery installs window-level listeners that catch failures
// to dynamic-import a JS chunk and full-reload the page. The web bundle's
// asset URLs are content-hashed and served from the cross-release pool;
// after a deploy, a tab whose chunk hash has been pruned from the pool
// will hit this path the next time it tries to lazy-load a route.
//
// Throttle: we record the last reload time in sessionStorage and skip a
// repeat reload within RELOAD_THROTTLE_MS so a genuine asset-server
// outage can't trigger a tight reload loop. In that case the error is
// still captured so we hear about it.
export function useChunkLoadRecovery() {
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (typeof window === 'undefined') return

        const onError = (event: ErrorEvent) => {
            if (!isChunkLoadError(event.error, event.message)) return
            recover('error', event.error ?? event.message)
        }

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (!isChunkLoadError(event.reason)) return
            recover('unhandledrejection', event.reason)
        }

        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onUnhandledRejection)
        return () => {
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onUnhandledRejection)
        }
    }, [])
}

// Exported for unit testing.
export function isChunkLoadError(error: unknown, message?: string): boolean {
    if (error && typeof error === 'object') {
        const e = error as { name?: unknown; message?: unknown }
        if (typeof e.name === 'string' && e.name === 'ChunkLoadError') return true
        if (typeof e.message === 'string' && messageLooksLikeChunkLoad(e.message)) return true
    }
    if (typeof message === 'string' && messageLooksLikeChunkLoad(message)) return true
    return false
}

// Match the messages thrown by browsers and bundlers when a dynamic
// import 404s. Webpack/Metro emit "Loading chunk N failed" or
// "ChunkLoadError"; native browser failures show as
// "Failed to fetch dynamically imported module" (Chrome/Firefox) or
// "Importing a module script failed" (Safari).
function messageLooksLikeChunkLoad(msg: string): boolean {
    return (
        msg.includes('Loading chunk') ||
        msg.includes('ChunkLoadError') ||
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('error loading dynamically imported module')
    )
}

function recover(source: 'error' | 'unhandledrejection', error: unknown) {
    const lastReloadAt = readThrottle()
    const now = Date.now()
    if (lastReloadAt && now - lastReloadAt < RELOAD_THROTTLE_MS) {
        // Suppress repeat reloads inside the throttle window — a genuine
        // asset-server outage shouldn't put us in a tight reload loop. We
        // still report so a Sentry alert surfaces if this keeps firing.
        captureException('chunk-load failure (suppressed reload)', error, {
            source,
            lastReloadAgeMs: now - lastReloadAt,
        })
        return
    }
    captureException('chunk-load failure', error, { source })
    writeThrottle(now)
    window.location.reload()
}

function readThrottle(): number | null {
    try {
        const v = window.sessionStorage.getItem(RELOAD_THROTTLE_KEY)
        if (!v) return null
        const n = Number.parseInt(v, 10)
        return Number.isFinite(n) ? n : null
    } catch {
        return null
    }
}

function writeThrottle(now: number): void {
    try {
        window.sessionStorage.setItem(RELOAD_THROTTLE_KEY, String(now))
    } catch {
        // sessionStorage may be unavailable (Safari private mode, disabled
        // storage). Acceptable: the worst case is a possible second reload.
    }
}
