/**
 * Runtime configuration that the app shell hands to `@tinycld/core` at
 * startup. Moves per-app details — branding, server
 * shortcuts, Sentry DSN, review-mode flags — out of hard-coded env reads
 * inside core and into a single injection point.
 *
 * Call ordering: `configureCore` MUST run before any other `@tinycld/core`
 * import is resolved, so config-reading modules inside core (like
 * `server-address.ts`) see the registered config on their first read.
 * The convention is that the app's root file imports a side-effect-only
 * module (e.g. `tinycld/lib/configure-core.ts`) that calls
 * `configureCore(appConfig)` at module-init time, BEFORE importing
 * anything else from `@tinycld/core`. ES modules execute in declared
 * source order during the import phase, so this works as long as the
 * configure-core import comes first in the file.
 *
 * `registerConfigListener` exists for late-arriving configuration in
 * test harnesses or hot-reload scenarios where the module-init ordering
 * isn't guaranteed. Production code should not rely on it.
 */
export interface CoreConfig {
    /** Human-readable brand name used in copy ("TinyCld", etc.). */
    brandName: string
    /**
     * Env-shortcut → absolute URL. The keys correspond to EXPO_PUBLIC_ENV
     * values ("dev", "app", "test", etc.). Web is usually derived at runtime;
     * see `webShortcut`.
     */
    serverShortcuts: Record<string, string>
    /**
     * Called when EXPO_PUBLIC_ENV === "web" to derive the server URL from
     * the current page. Typically `() => window.location.origin`.
     */
    webShortcut?: () => string | null
    /** Preferred default server URL shown on the connect screen. */
    defaultServer?: string
    /** Sentry DSN. When absent, Sentry init is skipped. */
    sentryDsn?: string
    /** Sentry environment tag (maps to EXPO_PUBLIC_ENV in the old world). */
    environment?: string
    /** Sentry release tag (maps to EXPO_PUBLIC_GIT_COMMIT). */
    release?: string
    /** When true, the app is an App Store review build. */
    reviewMode?: boolean
    /** Demo password auto-filled in review builds. */
    demoPassword?: string
    /** Optional email auto-filled alongside demoPassword. */
    demoEmail?: string
    /** Support URL shown in the About section. */
    supportUrl?: string
    /** Privacy policy URL shown in the About section. */
    privacyUrl?: string
    /** Public source URL (e.g. GitHub) shown in the About section. */
    sourceUrl?: string
}

let current: CoreConfig | null = null
const listeners = new Set<() => void>()

/**
 * Register app-level config with core. Must be called at most once, before
 * any core module reads config (typically at the top of the app's Expo
 * Router root layout, before `initSentry()` or the server-address gate).
 */
export function configureCore(config: CoreConfig): void {
    if (current) {
        throw new Error('configureCore called twice — only the app root should call this')
    }
    current = config
    for (const fn of listeners) fn()
}

/**
 * Read the registered config, panicking if none was set. Prefer
 * `getCoreConfigOptional` in consumers that need to tolerate the
 * current-monorepo case where no app has called `configureCore`.
 */
export function getCoreConfig(): CoreConfig {
    if (!current) {
        throw new Error('configureCore must be called before reading config')
    }
    return current
}

/**
 * Read the registered config, returning null when no app has called
 * `configureCore`. Consumers fall back to env vars in that case.
 */
export function getCoreConfigOptional(): CoreConfig | null {
    return current
}

/**
 * Subscribe to config being registered. Modules that run at import time
 * and depend on config (e.g. server-address's env-driven bootstrap) use
 * this to re-run their logic once configureCore fires.
 */
export function registerConfigListener(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
        listeners.delete(fn)
    }
}

/**
 * Test-only helper to reset the singleton between tests. Not exported from
 * the public index; tests reach in via the full path.
 */
export function __resetCoreConfigForTests(): void {
    current = null
    listeners.clear()
}
