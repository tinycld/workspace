import { create } from '@tinycld/core/lib/store'

export interface ConnectivityState {
    isOnline: boolean
    isServerReachable: boolean
    setOnline: (online: boolean) => void
    setServerReachable: (reachable: boolean) => void
}

export const useConnectivityStore = create<ConnectivityState>()(set => ({
    isOnline: true,
    isServerReachable: true,
    setOnline: online => set({ isOnline: online }),
    setServerReachable: reachable => set({ isServerReachable: reachable }),
}))

export const selectIsOffline = (s: ConnectivityState) => !s.isOnline || !s.isServerReachable
