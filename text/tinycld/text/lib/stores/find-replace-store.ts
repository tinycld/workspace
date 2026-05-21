import { create } from '@tinycld/core/lib/store'

interface FindReplaceState {
    isOpen: boolean
    // Last find/replace strings persist across open/close in the same
    // session — matches the Cmd+F UX in browsers and other editors.
    findQuery: string
    replaceQuery: string
    open: () => void
    close: () => void
    setFindQuery: (q: string) => void
    setReplaceQuery: (q: string) => void
}

// Shared UI state for the Cmd+F find/replace bar. Kept in a Zustand
// store (per project convention) so the screen-level keybindings can
// open the bar without prop-drilling through the editor toolbar tree.
// State is transient (not persisted to AsyncStorage) — find/replace
// queries shouldn't survive a reload.
export const useFindReplaceStore = create<FindReplaceState>(set => ({
    isOpen: false,
    findQuery: '',
    replaceQuery: '',
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    setFindQuery: q => set({ findQuery: q }),
    setReplaceQuery: q => set({ replaceQuery: q }),
}))
