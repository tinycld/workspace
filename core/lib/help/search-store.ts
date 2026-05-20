import { create } from '../store'

interface HelpSearchState {
    isOpen: boolean
    // Current query string typed into the palette input.
    // Not persisted — opening the palette always starts fresh.
    query: string
    selectedIndex: number
    open: () => void
    close: () => void
    // toggle() flips open/closed without re-resetting an already-open
    // palette. Used by the Cmd+/ shortcut and the "?" launcher so a
    // mid-query keystroke or an outside-click+reopen race doesn't wipe
    // the user's input or cause a visible flicker.
    toggle: () => void
    setQuery: (q: string) => void
    setSelectedIndex: (i: number) => void
}

// Shared UI state for the help command palette (Cmd+/ / Ctrl+/).
// Kept in a Zustand store so the screen-level keybinding, the menubar
// item, and the toolbar's "?" launcher can all open the palette
// without prop-drilling. Query + selection are transient: closing the
// palette resets them, matching Spotlight-style UX.
export const useHelpSearchStore = create<HelpSearchState>(set => ({
    isOpen: false,
    query: '',
    selectedIndex: 0,
    open: () => set({ isOpen: true, query: '', selectedIndex: 0 }),
    close: () => set({ isOpen: false, query: '', selectedIndex: 0 }),
    toggle: () =>
        set(s => (s.isOpen ? { isOpen: false, query: '', selectedIndex: 0 } : { isOpen: true })),
    setQuery: q => set({ query: q, selectedIndex: 0 }),
    setSelectedIndex: i => set({ selectedIndex: i }),
}))
