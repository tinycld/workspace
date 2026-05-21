import { create } from '@tinycld/core/lib/store'

interface ThreadListStoreState {
    threadIds: string[]
    setThreadIds: (ids: string[]) => void
    /**
     * Keyboard-driven focus index into the current mail list. Only meaningful
     * when `hasFocus` is true. Persisted across mount/unmount so round-tripping
     * list → conversation → Escape lands back on the row the user was on
     * (still gated by hasFocus).
     */
    focusedIndex: number
    /**
     * Whether the user has affirmatively engaged the keyboard (j/k/arrow) to
     * focus a row. False on initial mount and after a folder/label change so
     * the list opens with no row pre-selected.
     */
    hasFocus: boolean
    /** Sets the focused index AND marks focus as user-engaged. */
    setFocusedIndex: (i: number | ((prev: number) => number)) => void
    /** Clears focus state without changing index (used on folder/label change). */
    clearFocus: () => void
}

export const useThreadListStore = create<ThreadListStoreState>((set) => ({
    threadIds: [],
    setThreadIds: (ids) => set({ threadIds: ids }),
    focusedIndex: 0,
    hasFocus: false,
    setFocusedIndex: (next) =>
        set((state) => ({
            focusedIndex: typeof next === 'function' ? next(state.focusedIndex) : next,
            hasFocus: true,
        })),
    clearFocus: () => set({ focusedIndex: 0, hasFocus: false }),
}))

export function useThreadListContext() {
    return useThreadListStore()
}
