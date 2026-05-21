import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { FindStore, FindStoreApi } from './use-find-store'

const FindStoreContext = createContext<FindStoreApi | null>(null)

export interface FindStoreProviderProps {
    store: FindStoreApi
    children: ReactNode
}

export function FindStoreProvider({ store, children }: FindStoreProviderProps) {
    return <FindStoreContext.Provider value={store}>{children}</FindStoreContext.Provider>
}

export function useFindStoreApi(): FindStoreApi {
    const ctx = useContext(FindStoreContext)
    if (ctx == null) {
        throw new Error('useFindStoreApi must be used inside a <FindStoreProvider>')
    }
    return ctx
}

export function useFindStore<T>(selector: (s: FindStore) => T): T {
    const store = useFindStoreApi()
    return useStore(store, selector)
}
