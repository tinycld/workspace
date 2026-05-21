import { create } from '@tinycld/core/lib/store'

type PromptDialog =
    | { type: 'closed' }
    | { type: 'new-folder' }
    | { type: 'rename'; itemId: string; currentName: string }

interface DialogTarget {
    id: string
    name: string
}

interface DriveUIState {
    selectedItemId: string | null
    /**
     * Item being shown in the preview modal. Lives in the store rather than
     * the URL because Expo Router's <Slot/> remounts on search-param changes
     * in some configurations, blowing away FlashList scroll position. The
     * modal mounts/unmounts based on this flag without touching the route.
     */
    previewItemId: string | null
    selectedIds: Set<string>
    lastSelectedId: string | null
    searchQuery: string
    promptDialog: PromptDialog
    promptKey: number
    moveTarget: DialogTarget | null
    shareTarget: DialogTarget | null
    uploadSheetOpen: boolean
    detailPanelOpen: boolean
    /**
     * Keyboard-driven focus index into the current file listing. Only
     * meaningful when `hasFocus` is true. Persisted across mount/unmount so
     * opening a file and returning lands back on the row the user was on
     * (still gated by hasFocus).
     */
    focusedIndex: number
    /**
     * Whether the user has affirmatively engaged the keyboard (j/k/arrow) to
     * focus a row. False on initial mount and after a listKey change so the
     * list opens with no row pre-selected.
     */
    hasFocus: boolean
}

interface DriveUIActions {
    selectItem: (itemId: string | null) => void
    openPreviewItem: (id: string) => void
    closePreviewItem: () => void
    selectSingle: (id: string) => void
    selectToggle: (id: string) => void
    selectRange: (id: string, orderedIds: string[]) => void
    clearSelection: () => void
    setSearchQuery: (query: string) => void
    openPrompt: (state: PromptDialog) => void
    closePrompt: () => void
    openMoveDialog: (id: string, name: string) => void
    closeMoveDialog: () => void
    openShareDialog: (id: string, name: string) => void
    closeShareDialog: () => void
    openUploadSheet: () => void
    closeUploadSheet: () => void
    toggleDetailPanel: () => void
    openDetailPanel: () => void
    closeDetailPanel: () => void
    /** Sets the focused index AND marks focus as user-engaged. */
    setFocusedIndex: (i: number | ((prev: number) => number)) => void
    /** Clears focus state without changing index (used on listKey change). */
    clearFocus: () => void
}

export type { DialogTarget, PromptDialog }

export const useDriveUIStore = create<DriveUIState & DriveUIActions>((set) => ({
    selectedItemId: null,
    previewItemId: null,
    selectedIds: new Set<string>(),
    lastSelectedId: null,
    searchQuery: '',
    promptDialog: { type: 'closed' },
    promptKey: 0,
    moveTarget: null,
    shareTarget: null,
    uploadSheetOpen: false,
    detailPanelOpen: false,
    focusedIndex: 0,
    hasFocus: false,

    selectItem: (itemId: string | null) => set({ selectedItemId: itemId }),

    openPreviewItem: (id: string) => set({ previewItemId: id }),
    closePreviewItem: () => set({ previewItemId: null }),

    selectSingle: (id: string) => set({ selectedIds: new Set([id]), lastSelectedId: id }),

    selectToggle: (id: string) =>
        set((prev) => {
            const next = new Set(prev.selectedIds)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return { selectedIds: next, lastSelectedId: id }
        }),

    selectRange: (id: string, orderedIds: string[]) =>
        set((prev) => {
            const anchor = prev.lastSelectedId
            if (!anchor) return { selectedIds: new Set([id]), lastSelectedId: id }
            const startIdx = orderedIds.indexOf(anchor)
            const endIdx = orderedIds.indexOf(id)
            if (startIdx === -1 || endIdx === -1) return { selectedIds: new Set([id]), lastSelectedId: id }
            const lo = Math.min(startIdx, endIdx)
            const hi = Math.max(startIdx, endIdx)
            const rangeIds = orderedIds.slice(lo, hi + 1)
            return { selectedIds: new Set([...prev.selectedIds, ...rangeIds]), lastSelectedId: id }
        }),

    clearSelection: () => set({ selectedIds: new Set<string>(), lastSelectedId: null }),

    setSearchQuery: (query: string) => set({ searchQuery: query }),

    openPrompt: (state: PromptDialog) => set((prev) => ({ promptDialog: state, promptKey: prev.promptKey + 1 })),

    closePrompt: () => set({ promptDialog: { type: 'closed' } }),

    openMoveDialog: (id: string, name: string) => set({ moveTarget: { id, name } }),

    closeMoveDialog: () => set({ moveTarget: null }),

    openShareDialog: (id: string, name: string) => set({ shareTarget: { id, name } }),

    closeShareDialog: () => set({ shareTarget: null }),

    openUploadSheet: () => set({ uploadSheetOpen: true }),

    closeUploadSheet: () => set({ uploadSheetOpen: false }),

    toggleDetailPanel: () => set((prev) => ({ detailPanelOpen: !prev.detailPanelOpen })),
    openDetailPanel: () => set({ detailPanelOpen: true }),
    closeDetailPanel: () => set({ detailPanelOpen: false }),
    setFocusedIndex: (next) =>
        set((state) => ({
            focusedIndex: typeof next === 'function' ? next(state.focusedIndex) : next,
            hasFocus: true,
        })),
    clearFocus: () => set({ focusedIndex: 0, hasFocus: false }),
}))
