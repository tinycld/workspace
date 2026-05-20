import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('connectivity-store', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('starts online and server-reachable', async () => {
        const { useConnectivityStore, selectIsOffline } = await import(
            '../stores/connectivity-store'
        )
        const state = useConnectivityStore.getState()
        expect(state.isOnline).toBe(true)
        expect(state.isServerReachable).toBe(true)
        expect(selectIsOffline(state)).toBe(false)
    })

    it('reports offline when device is offline', async () => {
        const { useConnectivityStore, selectIsOffline } = await import(
            '../stores/connectivity-store'
        )
        useConnectivityStore.getState().setOnline(false)
        expect(selectIsOffline(useConnectivityStore.getState())).toBe(true)
    })

    it('reports offline when server is unreachable but device is online', async () => {
        const { useConnectivityStore, selectIsOffline } = await import(
            '../stores/connectivity-store'
        )
        useConnectivityStore.getState().setServerReachable(false)
        expect(selectIsOffline(useConnectivityStore.getState())).toBe(true)
    })

    it('returns to online when both signals recover', async () => {
        const { useConnectivityStore, selectIsOffline } = await import(
            '../stores/connectivity-store'
        )
        const { setOnline, setServerReachable } = useConnectivityStore.getState()
        setOnline(false)
        setServerReachable(false)
        expect(selectIsOffline(useConnectivityStore.getState())).toBe(true)
        setOnline(true)
        setServerReachable(true)
        expect(selectIsOffline(useConnectivityStore.getState())).toBe(false)
    })

    it('exposes selectIsOffline as a stable function reference', async () => {
        const a = await import('../stores/connectivity-store')
        const b = await import('../stores/connectivity-store')
        expect(a.selectIsOffline).toBe(b.selectIsOffline)
    })
})
