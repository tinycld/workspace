import AsyncStorage from '@react-native-async-storage/async-storage'
import { captureException } from '@tinycld/core/lib/errors'
import {
    authStoreReady,
    fetchAndSeedUserOrg,
    getUserFromAuthStore,
    pb,
    preloadStores,
    seedUserOrg,
} from '@tinycld/core/lib/pocketbase'
import { create } from '@tinycld/core/lib/store'
import type { UserSession } from '@tinycld/core/lib/types'
import type { Orgs, UserOrg, Users } from '@tinycld/core/types/pbSchema'

interface UserOrgExpanded extends UserOrg {
    expand?: { org?: Orgs }
}

type AuthenticatedUser = UserSession

type LoginResult = {
    user: AuthenticatedUser | null
    error: string | null
}

const PRIMARY_ORG_STORAGE_KEY = 'tinycld_primary_org'

async function savePrimaryOrgToStorage(orgSlug: string): Promise<void> {
    try {
        await AsyncStorage.setItem(PRIMARY_ORG_STORAGE_KEY, orgSlug)
    } catch {
        // Storage might not be available
    }
}

export async function loadPrimaryOrgFromStorage(): Promise<string | null> {
    try {
        return await AsyncStorage.getItem(PRIMARY_ORG_STORAGE_KEY)
    } catch {
        return null
    }
}

async function clearPrimaryOrgStorage(): Promise<void> {
    try {
        await AsyncStorage.removeItem(PRIMARY_ORG_STORAGE_KEY)
    } catch {
        // Storage might not be available
    }
}

interface AuthStoreState {
    user: AuthenticatedUser | null
    hasHydrated: boolean

    initAuth: () => () => void
    login: (identifier: string, password: string) => Promise<LoginResult>
    logout: () => void
    refreshUser: () => Promise<void>
}

export const useAuthStore = create<AuthStoreState>()((set, get) => ({
    user: null,
    hasHydrated: false,

    initAuth: () => {
        // Hydrate auth and preload server data BEFORE flipping isLoggedIn.
        // The previous order set user first and then awaited preloads, which
        // left a window where components mounted with isLoggedIn=true against
        // empty TanStack DB collections — rendering as "everything empty"
        // until the user signed out and back in. We also wrap everything so
        // a failed preload (timeout, transient 5xx, EventSource hiccup) can't
        // strand the app with hasHydrated=false forever.
        const hydrate = async () => {
            try {
                await authStoreReady

                const primaryOrgSlug = await loadPrimaryOrgFromStorage()
                const currentUser = getUserFromAuthStore(primaryOrgSlug)

                if (currentUser) {
                    await fetchAndSeedUserOrg()
                    await preloadStores()
                    set({ user: currentUser })
                }
            } catch (err) {
                captureException('auth-store.initAuth hydration failed', err)
            } finally {
                set({ hasHydrated: true })
            }
        }

        hydrate()

        const unsubscribe = pb.authStore.onChange(() => {
            get().refreshUser()
        })
        return unsubscribe
    },

    login: async (identifier, password) => {
        pb.authStore.clear()
        try {
            const authData = await pb.collection('users').authWithPassword<
                Users & {
                    expand?: {
                        user_org_via_user?: UserOrgExpanded[]
                    }
                }
            >(identifier, password, {
                expand: 'user_org_via_user.org',
            })
            const userOrgs = authData.record.expand?.user_org_via_user ?? []
            const firstUserOrgWithSlug = userOrgs.find(uo => uo.expand?.org?.slug)

            if (!firstUserOrgWithSlug?.expand?.org) {
                pb.authStore.clear()
                return {
                    user: null,
                    error: 'No organization associated with this account',
                }
            }

            const primaryOrgSlug = firstUserOrgWithSlug.expand.org.slug

            const metadata = (authData.record as Users & { metadata?: Record<string, unknown> })
                .metadata
            const authenticatedUser: AuthenticatedUser = {
                id: authData.record.id,
                name: authData.record.name,
                email: authData.record.email,
                primaryOrgSlug,
                isDemo: !!(authData.record as Users & { is_demo?: boolean }).is_demo,
                isBetaTester: !!metadata?.isBetaTester,
            }

            const { expand: _, ...userOrgRecord } = firstUserOrgWithSlug
            await seedUserOrg(authData.record, firstUserOrgWithSlug.expand.org, userOrgRecord)

            await savePrimaryOrgToStorage(primaryOrgSlug)
            set({ user: authenticatedUser })
            await preloadStores()

            return { user: authenticatedUser, error: null }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to sign in'
            return { user: null, error: message }
        }
    },

    logout: () => {
        pb.realtime.unsubscribe()
        pb.authStore.clear()
        clearPrimaryOrgStorage()
        set({ user: null })
    },

    refreshUser: async () => {
        const primaryOrgSlug = await loadPrimaryOrgFromStorage()
        const currentUser = getUserFromAuthStore(primaryOrgSlug)
        if (!currentUser) {
            set({ user: null })
            await clearPrimaryOrgStorage()
            return
        }
        set({ user: currentUser })
    },
}))
