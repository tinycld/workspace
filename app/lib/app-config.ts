import type { CoreConfig } from '@tinycld/core'

// Minimal app config for the ./new dev app. Web resolves the PB address from
// the page origin (the dev proxy / app server routes /api to PocketBase
// same-origin). Sentry/review-mode/demo are intentionally omitted for the spike.
export const appConfig: CoreConfig = {
    brandName: 'TinyCld',
    serverShortcuts: {},
    webShortcut: () => (typeof window !== 'undefined' ? window.location.origin : null),
    defaultServer: 'http://localhost:7100',
    privacyUrl: 'https://tinycld.org/privacy',
    sourceUrl: 'https://github.com/tinycld/tinycld',
}
