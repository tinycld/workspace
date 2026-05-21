import { create } from '@tinycld/core/lib/store'

export interface AnchorRect {
    x: number
    y: number
    width: number
    height: number
}

export type PopoverState =
    | { type: 'closed' }
    | { type: 'quick-create'; date: Date; hour: number }
    | { type: 'event-detail'; eventId: string; anchorRect?: AnchorRect }

interface CalendarUIState {
    popover: PopoverState
    visibleIds: string[]
    /**
     * Keyboard-driven focus index into the schedule view. Persisted so
     * navigating away from and back to the calendar preserves j/k position.
     */
    scheduleFocusedIndex: number
    openQuickCreate: (date: Date, hour: number) => void
    openEventDetail: (eventId: string, anchorRect?: AnchorRect) => void
    closePopover: () => void
    toggleCalendar: (id: string) => void
    showOnlyCalendar: (id: string) => void
    initVisibleIds: (ids: string[]) => void
    setScheduleFocusedIndex: (i: number | ((prev: number) => number)) => void
}

export const useCalendarUIStore = create<CalendarUIState>((set) => ({
    popover: { type: 'closed' },
    visibleIds: [],
    scheduleFocusedIndex: 0,

    openQuickCreate: (date, hour) => set({ popover: { type: 'quick-create', date, hour } }),

    openEventDetail: (eventId, anchorRect) => set({ popover: { type: 'event-detail', eventId, anchorRect } }),

    closePopover: () => set({ popover: { type: 'closed' } }),

    toggleCalendar: (id) =>
        set((state) => {
            const has = state.visibleIds.includes(id)
            return {
                visibleIds: has ? state.visibleIds.filter((v) => v !== id) : [...state.visibleIds, id],
            }
        }),

    showOnlyCalendar: (id) => set({ visibleIds: [id] }),

    initVisibleIds: (ids) =>
        set((state) => {
            if (state.visibleIds.length > 0) return state
            return { visibleIds: ids }
        }),

    setScheduleFocusedIndex: (next) =>
        set((state) => ({
            scheduleFocusedIndex: typeof next === 'function' ? next(state.scheduleFocusedIndex) : next,
        })),
}))
