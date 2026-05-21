import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore as createVanillaStore, type StoreApi } from 'zustand/vanilla'

// Per-Grid-instance print-dialog store. The find-replace dialog uses
// the same pattern (see hooks/find/use-find-store) because Grid is
// documented as multi-instance: if a future caller mounts two Grids
// side-by-side, a global singleton would link their dialog state. The
// store is transient and not persisted — printing is one-shot and the
// dialog defaults reset every open.
export interface PrintDialogState {
    isOpen: boolean
    open: () => void
    close: () => void
}

export type PrintDialogStore = StoreApi<PrintDialogState>

export function createPrintDialogStore(): PrintDialogStore {
    return createVanillaStore<PrintDialogState>(set => ({
        isOpen: false,
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    }))
}

const PrintDialogContext = createContext<PrintDialogStore | null>(null)

export interface PrintDialogProviderProps {
    store: PrintDialogStore
    children: ReactNode
}

export function PrintDialogProvider({ store, children }: PrintDialogProviderProps) {
    return (
        <PrintDialogContext.Provider value={store}>{children}</PrintDialogContext.Provider>
    )
}

export function usePrintDialogStoreApi(): PrintDialogStore {
    const ctx = useContext(PrintDialogContext)
    if (ctx == null) {
        throw new Error(
            'usePrintDialogStoreApi must be used inside a <PrintDialogProvider>'
        )
    }
    return ctx
}

export function usePrintDialog<T>(selector: (s: PrintDialogState) => T): T {
    const store = usePrintDialogStoreApi()
    return useStore(store, selector)
}
