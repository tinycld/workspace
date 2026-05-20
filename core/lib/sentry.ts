declare const __DEV__: boolean

import * as Sentry from '@sentry/react-native'
import { getCoreConfigOptional } from './core-config'
import { scrubPII } from './sentry-scrub'

let initialized = false

export function initSentry(): void {
    if (initialized) return
    const config = getCoreConfigOptional()
    const dsn = config?.sentryDsn
    if (__DEV__ || !dsn) return

    Sentry.init({
        dsn,
        environment: config?.environment ?? 'production',
        release: config?.release,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        beforeSend(event) {
            return scrubPII(event) as typeof event
        },
        beforeBreadcrumb(breadcrumb) {
            return scrubPII(breadcrumb) as typeof breadcrumb
        },
    })
    initialized = true
}

export function captureExceptionToSentry(
    context: string,
    error: unknown,
    extra?: Record<string, unknown>
): void {
    if (!initialized) return
    Sentry.withScope(scope => {
        scope.setTag('context', context)
        if (extra) scope.setExtras(scrubPII(extra))
        Sentry.captureException(error)
    })
}
