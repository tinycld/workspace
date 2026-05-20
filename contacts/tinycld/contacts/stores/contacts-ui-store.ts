import { asyncStorage, create, persist } from '@tinycld/core/lib/store'

export type SortField = 'first_name' | 'last_name' | 'email' | 'phone' | 'company'
export type SortDirection = 'asc' | 'desc'

interface ContactsUIState {
    /**
     * Keyboard-driven focus index into the current contact listing. Only
     * meaningful when `hasFocus` is true; otherwise no row should appear
     * focused. Persisted so opening a contact and returning lands back on the
     * row the user was on (still gated by hasFocus, which is transient).
     */
    focusedIndex: number
    /**
     * Whether the user has affirmatively engaged the keyboard (j/k/arrow) to
     * focus a row. False on initial mount and after a listKey change so the
     * list opens with no row pre-selected.
     */
    hasFocus: boolean
    /** Sets the focused index AND marks focus as user-engaged. */
    setFocusedIndex: (i: number | ((prev: number) => number)) => void
    /** Clears focus state without changing index (used on listKey change). */
    clearFocus: () => void

    sortField: SortField
    sortDirection: SortDirection
    setSort: (field: SortField, direction?: SortDirection) => void
    /** If `field` is already active, flip direction; otherwise set field, asc. */
    toggleSort: (field: SortField) => void
}

export const useContactsUIStore = create<ContactsUIState>()(
    persist(
        (set) => ({
            focusedIndex: 0,
            hasFocus: false,
            setFocusedIndex: (next) =>
                set((state) => ({
                    focusedIndex: typeof next === 'function' ? next(state.focusedIndex) : next,
                    hasFocus: true,
                })),
            clearFocus: () => set({ focusedIndex: 0, hasFocus: false }),

            sortField: 'first_name',
            sortDirection: 'asc',
            setSort: (field, direction = 'asc') => set({ sortField: field, sortDirection: direction }),
            toggleSort: (field) =>
                set((state) =>
                    state.sortField === field
                        ? { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' }
                        : { sortField: field, sortDirection: 'asc' }
                ),
        }),
        {
            name: 'tinycld_contacts_ui',
            storage: asyncStorage,
            // Don't persist focusedIndex/hasFocus — transient interaction state.
            partialize: (s) => ({ sortField: s.sortField, sortDirection: s.sortDirection }),
        }
    )
)
