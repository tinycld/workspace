import AsyncStorage from '@react-native-async-storage/async-storage'
import { QueryClient } from '@tanstack/react-query'
import { type MergedPackageSchema, tinycldConfig } from '@tinycld/app-generated/tinycld-config'
import { buildPackageStores } from '@tinycld/core/lib/packages/derive-stores'
import type { Orgs, Schema, UserOrg, Users } from '@tinycld/core/types/pbSchema'
import { BasicIndex, createCollection, createReactProvider, setLogger } from 'pbtsdb'
import PocketBase, { AsyncAuthStore } from 'pocketbase'
import { Platform } from 'react-native'
import { PB_SERVER_ADDR } from './config'
import { useConnectivityStore } from './stores/connectivity-store'
import type { UserSession } from './types'

export { eq } from '@tanstack/db'

// MergedSchema = core's Schema intersected with each linked package's schema.
// MergedPackageSchema is a PRECOMPUTED LITERAL intersection from the generated
// config (NOT derived from the config values) to avoid a circular type
// reference through coreStores. buildPackageStores wires stores from the config
// values at runtime.
type MergedSchema = Schema & MergedPackageSchema

if (Platform.OS !== 'web') {
    // Only polyfill EventSource on native — the browser has its own
    import('react-native-sse').then(mod => {
        global.EventSource = mod.default as unknown as typeof global.EventSource
    })
}

export { PB_SERVER_ADDR }

// Defer AsyncStorage access to avoid calling the native module during module evaluation,
// which crashes on React Native before the bridge is ready (AsyncStorage v3+)
const initialAuthPromise =
    typeof window !== 'undefined'
        ? new Promise<string | null>(resolve => {
              setTimeout(() => resolve(AsyncStorage.getItem('pb_auth')), 0)
          })
        : Promise.resolve(null)

const store = new AsyncAuthStore({
    save: async serialized => AsyncStorage.setItem('pb_auth', serialized),
    clear: async () => await AsyncStorage.removeItem('pb_auth'),
})

// AsyncAuthStore's own `initial` option runs through a private
// fire-and-forget _loadInitial that swallows errors, races consumers, and
// gives no readiness signal. Instead we hydrate explicitly: read storage,
// parse, call store.save(). authStoreReady resolves only after that
// completes, so anyone awaiting it sees a settled pb.authStore.
export const authStoreReady = initialAuthPromise.then(storedAuth => {
    if (!storedAuth) return
    try {
        const parsed = JSON.parse(storedAuth) as {
            token?: string
            record?: unknown
            model?: unknown
        }
        if (parsed.token) {
            store.save(parsed.token, (parsed.record ?? parsed.model) as never)
        }
    } catch {
        // Corrupt stored auth — leave the store empty and let the user
        // re-authenticate. Clearing storage avoids replaying the corruption
        // on next boot.
        AsyncStorage.removeItem('pb_auth')
    }
})

export const pb = new PocketBase(PB_SERVER_ADDR, store)

pb.autoCancellation(false)

const RECOVERY_WINDOW_MS = 10_000
const RECOVERY_THRESHOLD = 2
const sessionStart = Date.now()
let networkFailures = 0

function isNetworkLevelFailure(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const e = err as { status?: number; isAbort?: boolean; originalError?: unknown }
    if (e.isAbort) return false
    if (typeof e.status === 'number' && e.status > 0) return false
    return true
}

const origSend = pb.send.bind(pb)
pb.send = (async <T>(path: string, options: Parameters<typeof origSend>[1]) => {
    try {
        const result = (await origSend(path, options)) as T
        if (!useConnectivityStore.getState().isServerReachable) {
            useConnectivityStore.getState().setServerReachable(true)
        }
        networkFailures = 0
        return result
    } catch (err) {
        if (!isNetworkLevelFailure(err)) throw err
        networkFailures++
        // During the first RECOVERY_WINDOW_MS we require RECOVERY_THRESHOLD
        // failures before flipping, because the auth bootstrap can race
        // pb.send and produce a single spurious failure. After the window we
        // trust any single network-level failure.
        const inEarlyWindow = Date.now() - sessionStart <= RECOVERY_WINDOW_MS
        if (inEarlyWindow && networkFailures < RECOVERY_THRESHOLD) throw err
        useConnectivityStore.getState().setServerReachable(false)
        throw err
    }
}) as typeof pb.send

export function usePocketBase() {
    return pb
}

// Tear down the live PB session, then drop the resolved address so the
// next gate pass routes to the picker. Order matters: PB's RealtimeService
// auto-reconnects on EventSource error, and reconnect reads PB_SERVER_ADDR
// — clearing the address before disconnecting realtime trips the "address
// not resolved" guard. The auth-store's logout already does the realtime
// teardown + auth clear; we just need to add the address clear.
export async function disconnectServer() {
    const { useAuthStore } = await import('./stores/auth-store')
    useAuthStore.getState().logout()
    pb.cancelAllRequests()
    const { clearCached, setResolvedAddress } = await import('./server-address')
    await clearCached()
    setResolvedAddress(null)
}

setLogger({
    debug: () => {},
    info: (_msg, context) => {
        if (context) {
        } else {
        }
    },
    warn: (_msg, context) => {
        if (context) {
        } else {
        }
    },
    error: (_msg, context) => {
        if (context) {
        } else {
        }
    },
})

const queryClient = new QueryClient()

const newCollection = createCollection<MergedSchema>(pb, queryClient)

const indexing = {
    collectionOptions: {
        autoIndex: 'eager' as const,
        defaultIndexType: BasicIndex,
    },
}

const users = newCollection('users', {
    omitOnInsert: ['created', 'updated', 'password', 'tokenKey'],
    ...indexing,
})

const orgs = newCollection('orgs', {
    omitOnInsert: ['created', 'updated'],
    ...indexing,
})

const user_org = newCollection('user_org', {
    omitOnInsert: ['created', 'updated'],
    expand: {
        user: users,
        org: orgs,
    },
    ...indexing,
})

const settings = newCollection('settings', {
    omitOnInsert: ['created', 'updated'],
    expand: { org: orgs },
    ...indexing,
})

const user_preferences = newCollection('user_preferences', {
    omitOnInsert: ['created', 'updated'],
    expand: { user: users },
    ...indexing,
})

const labels = newCollection('labels', {
    omitOnInsert: ['created', 'updated'],
    expand: { org: orgs, user_org },
    ...indexing,
})

const label_assignments = newCollection('label_assignments', {
    omitOnInsert: ['created', 'updated'],
    expand: { label: labels, user_org },
    ...indexing,
})

const org_pkg_access = newCollection('org_pkg_access', {
    omitOnInsert: ['created', 'updated'],
    expand: { user_org },
    ...indexing,
})

const pkg_registry = newCollection('pkg_registry', {
    omitOnInsert: ['created', 'updated'],
    ...indexing,
})

const org_pkg_enabled = newCollection('org_pkg_enabled', {
    omitOnInsert: ['created', 'updated'],
    expand: { org: orgs },
    ...indexing,
})

const audit_logs = newCollection('audit_logs', {
    omitOnInsert: ['created', 'updated'],
    expand: { actor: users },
    ...indexing,
})

const pkg_install_log = newCollection('pkg_install_log', {
    omitOnInsert: ['created', 'updated'],
    expand: { initiated_by: users },
    ...indexing,
})

const notifications = newCollection('notifications', {
    omitOnInsert: ['created', 'updated'],
    expand: { user: users, org: orgs },
    ...indexing,
})
export const notificationsCollection = notifications

// NOTE: the `comment_mentions` store registration was removed in the new
// standalone-core layout because the collection is created by a feature
// package's migration (drive's create_comment_mentions), not core's own — so
// core can't unconditionally register it when that package isn't linked. The
// comment-mutations factory takes the collection as a parameter, so nothing in
// core hard-depends on a core-owned store here. Re-introducing comments as a
// first-class core feature (with its own migration) is tracked as a follow-up.

const coreStores = {
    users,
    orgs,
    user_org,
    settings,
    user_preferences,
    labels,
    label_assignments,
    org_pkg_access,
    pkg_registry,
    org_pkg_enabled,
    audit_logs,
    pkg_install_log,
    notifications,
}
export type CoreStores = typeof coreStores

const stores = {
    ...coreStores,
    ...buildPackageStores(tinycldConfig, newCollection, coreStores),
}

const { Provider: PBTSDBProvider, useStore } = createReactProvider(stores)

export function getUserFromAuthStore(primaryOrgSlug?: string | null): UserSession | null {
    const authRecord = pb.authStore.record as Users | null
    const authToken = pb.authStore.token

    if (!authRecord || !authToken || !pb.authStore.isValid) {
        return null
    }

    const metadata = (authRecord as Users & { metadata?: Record<string, unknown> }).metadata
    return {
        id: authRecord.id,
        name: authRecord.name,
        email: authRecord.email,
        primaryOrgSlug: primaryOrgSlug ?? undefined,
        isDemo: !!(authRecord as Users & { is_demo?: boolean }).is_demo,
        isBetaTester: !!metadata?.isBetaTester,
    }
}

export async function seedUserOrg(userRecord: Users, orgRecord: Orgs, userOrgRecord: UserOrg) {
    await Promise.all([stores.users.preload(), stores.orgs.preload(), stores.user_org.preload()])
    stores.users.utils?.writeUpsert(userRecord)
    stores.orgs.utils?.writeUpsert(orgRecord)
    stores.user_org.utils?.writeUpsert(userOrgRecord)
}

export async function preloadStores() {
    await Promise.all([
        stores.orgs.preload(),
        stores.user_org.preload(),
        stores.org_pkg_access.preload(),
        stores.pkg_registry.preload(),
        stores.org_pkg_enabled.preload(),
    ])
}

export async function fetchAndSeedUserOrg() {
    await Promise.all([stores.users.preload(), stores.orgs.preload(), stores.user_org.preload()])
    const userOrgs = await pb.collection('user_org').getFullList<UserOrg>()
    for (const userOrgRecord of userOrgs) {
        stores.user_org.utils?.writeUpsert(userOrgRecord)
    }
}

export async function clearStores() {
    for (const s of Object.values(stores)) {
        await s.cleanup()
    }
}

export { PBTSDBProvider, queryClient, stores, useStore }
