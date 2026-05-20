import { pb } from '@tinycld/core/lib/pocketbase'
import { useAuthStore } from '@tinycld/core/lib/stores/auth-store'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

export { loadPrimaryOrgFromStorage } from '@tinycld/core/lib/stores/auth-store'

export class AuthRequiredError extends Error {
    constructor(message = 'Authentication required') {
        super(message)
        this.name = 'AuthRequiredError'
    }
}

interface UserShape {
    id: string
    name: string
    email: string
    primaryOrgSlug?: string
    isDemo: boolean
}

type AuthActions = {
    login: (
        email: string,
        password: string
    ) => Promise<{
        user: UserShape | null
        error: string | null
    }>
    logout: () => void
}

type AuthenticatedContext = AuthActions & {
    isLoggedIn: true
    user: UserShape
}

type AuthContextType =
    | (AuthActions & {
          isLoggedIn: true
          user: UserShape
          isInitializing: boolean
      })
    | (AuthActions & {
          isLoggedIn: false
          user: null
          isInitializing: boolean
      })

export function AuthProvider({ children }: { children: ReactNode }) {
    const initAuth = useAuthStore(s => s.initAuth)

    useEffect(() => {
        const unsubscribe = initAuth()
        return unsubscribe
    }, [initAuth])

    return <>{children}</>
}

export function useAuth(): AuthenticatedContext
export function useAuth(options: { throwIfAnon: true }): AuthenticatedContext
export function useAuth(options: { throwIfAnon: false }): AuthContextType
export function useAuth(options?: {
    throwIfAnon: boolean
}): AuthenticatedContext | AuthContextType {
    const user = useAuthStore(s => s.user)
    const hasHydrated = useAuthStore(s => s.hasHydrated)
    const login = useAuthStore(s => s.login)
    const logout = useAuthStore(s => s.logout)

    const isLoggedIn = !!user && !!pb.authStore.token
    const throwIfAnon = options?.throwIfAnon ?? true

    const context: AuthContextType = isLoggedIn
        ? { login, logout, user, isLoggedIn: true, isInitializing: !hasHydrated }
        : { login, logout, user: null, isLoggedIn: false, isInitializing: !hasHydrated }

    if (throwIfAnon) {
        if (!context.user) {
            return {
                ...context,
                isLoggedIn: false,
                user: { id: '', name: '', email: '', isDemo: false },
            } as unknown as AuthenticatedContext
        }
        return context as AuthenticatedContext
    }

    return context
}
