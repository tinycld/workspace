import { create } from '@tinycld/core/lib/store'

// Transient UI state for the SheetTabs strip:
//   - renamingId: which tab is currently in inline-rename mode (one
//     at a time; clicking another tab cancels the open editor).
//   - contextMenu: which tab a right-click context menu is open over,
//     plus the cursor position to anchor the popover.
//
// All of this is transient — never persisted, doesn't survive a reload.
// Keeping it in a Zustand store rather than React state lets the
// SheetTabs component, the rename input, and the context menu read +
// write the same fields without prop-drilling.
interface SheetTabsContextMenu {
    sheetId: string
    cursor: { x: number; y: number }
}

export interface SheetTabsState {
    renamingId: string | null
    startRename: (sheetId: string) => void
    cancelRename: () => void

    contextMenu: SheetTabsContextMenu | null
    openContextMenu: (sheetId: string, x: number, y: number) => void
    closeContextMenu: () => void

    showHidden: boolean
    setShowHidden: (next: boolean) => void
}

export const useSheetTabsStore = create<SheetTabsState>(set => ({
    renamingId: null,
    startRename: (sheetId: string) =>
        set({ renamingId: sheetId, contextMenu: null }),
    cancelRename: () => set({ renamingId: null }),

    contextMenu: null,
    openContextMenu: (sheetId: string, x: number, y: number) =>
        set({
            contextMenu: { sheetId, cursor: { x, y } },
            renamingId: null,
        }),
    closeContextMenu: () => set({ contextMenu: null }),

    showHidden: false,
    setShowHidden: (next: boolean) => set({ showHidden: next }),
}))
