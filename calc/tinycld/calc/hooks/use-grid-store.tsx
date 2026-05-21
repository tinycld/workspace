// React glue around the per-Grid Zustand store.
//
// Two consumers: the Grid component (creates the store via
// useMemo+createGridStore and wraps its subtree in the provider), and
// every descendant that wants to subscribe to a slice of state.
//
// useGridStore(selector) takes a selector that returns a primitive
// (boolean / string / number / null) whenever possible — that's what
// makes per-cell subscriptions cheap. For object slices, callers
// should pair the hook with useShallow from zustand/react/shallow.
//
// useGridStoreApi() returns the underlying StoreApi so callers can
// reach into getState()/subscribe() without going through React (used
// by imperative paths and by the awareness publisher effect).
import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { GridStore, GridStoreApi } from './grid-store'

const GridStoreContext = createContext<GridStoreApi | null>(null)

export interface GridStoreProviderProps {
    store: GridStoreApi
    children: ReactNode
}

export function GridStoreProvider({ store, children }: GridStoreProviderProps) {
    return <GridStoreContext.Provider value={store}>{children}</GridStoreContext.Provider>
}

// useGridStoreApi returns the raw StoreApi. Use sparingly — prefer
// useGridStore(selector) for subscriptions. Useful inside event
// callbacks that read live state without subscribing
// (store.getState().selectCell(...)) or for one-shot setup of
// awareness/peer broadcast at the Grid root.
export function useGridStoreApi(): GridStoreApi {
    const ctx = useContext(GridStoreContext)
    if (ctx == null) {
        throw new Error('useGridStoreApi must be used inside a <GridStoreProvider>')
    }
    return ctx
}

// useGridStore subscribes the calling component to the slice returned
// by `selector`. Re-renders only when the slice's reference (or
// primitive value) changes from one store update to the next.
export function useGridStore<T>(selector: (state: GridStore) => T): T {
    const store = useGridStoreApi()
    return useStore(store, selector)
}
