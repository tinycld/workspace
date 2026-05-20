import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import PocketBase from 'pocketbase'
import { useCallback, useRef, useState } from 'react'

export function useSuperUserPB() {
    const pbRef = useRef<PocketBase | null>(null)
    if (!pbRef.current) {
        pbRef.current = new PocketBase(PB_SERVER_ADDR)
    }
    const pb = pbRef.current

    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    const login = useCallback(
        async (email: string, password: string) => {
            setError(null)
            setIsLoading(true)
            try {
                await pb.collection('_superusers').authWithPassword(email, password)
                setIsAuthenticated(true)
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Authentication failed'
                setError(message)
            } finally {
                setIsLoading(false)
            }
        },
        [pb]
    )

    return {
        pb,
        login,
        isAuthenticated,
        error,
        isLoading,
    }
}
