import { create } from '@tinycld/core/lib/store'
import type { SlashMenuCommand } from '../editor/slash-menu-commands'

// Rect of the slash trigger character (the `/` the user typed) in
// viewport coordinates. The popover uses this to position itself
// just below the caret. Zero-rect fallbacks are tolerated — they
// would render in the top-left corner, which is obviously wrong, so
// the suggestion plugin guards against that before opening.
export interface SlashMenuAnchor {
    top: number
    left: number
    bottom: number
    right: number
    width: number
    height: number
}

interface SlashMenuState {
    isOpen: boolean
    query: string
    items: SlashMenuCommand[]
    anchor: SlashMenuAnchor | null
    selectedIndex: number
    // Invoked when the popover (or a keyboard handler) decides which
    // item to apply. The suggestion plugin sets this to a closure that
    // runs the chosen command's `run({ editor, range, … })`. The store
    // never knows about the editor directly — this keeps the popover
    // component fully decoupled from Tiptap internals.
    onSelect: ((cmd: SlashMenuCommand) => void) | null
    open: (args: {
        items: SlashMenuCommand[]
        query: string
        anchor: SlashMenuAnchor | null
        onSelect: (cmd: SlashMenuCommand) => void
    }) => void
    update: (args: { items: SlashMenuCommand[]; query: string; anchor: SlashMenuAnchor | null }) => void
    close: () => void
    setSelectedIndex: (index: number) => void
    moveSelection: (delta: number) => void
}

// Slash-menu popover state. One menu can be open at a time, so the
// store is a singleton at module scope. State is fully transient —
// nothing persists across reloads (the popover only exists for the
// few seconds between typing `/` and picking / dismissing).
export const useSlashMenuStore = create<SlashMenuState>((set, get) => ({
    isOpen: false,
    query: '',
    items: [],
    anchor: null,
    selectedIndex: 0,
    onSelect: null,
    open: ({ items, query, anchor, onSelect }) =>
        set({
            isOpen: true,
            items,
            query,
            anchor,
            onSelect,
            selectedIndex: 0,
        }),
    update: ({ items, query, anchor }) => {
        const prev = get().selectedIndex
        // Clamp selection into the new item range so a filter that
        // shrinks the list never strands the caret on a missing row.
        // The popover would otherwise render with selectedIndex=4 on
        // a 2-item list and respond to Enter by selecting nothing.
        const nextSelected = items.length === 0 ? 0 : Math.min(prev, items.length - 1)
        set({ items, query, anchor, selectedIndex: nextSelected })
    },
    close: () =>
        set({
            isOpen: false,
            items: [],
            query: '',
            anchor: null,
            selectedIndex: 0,
            onSelect: null,
        }),
    setSelectedIndex: index => set({ selectedIndex: index }),
    moveSelection: delta => {
        const { items, selectedIndex } = get()
        if (items.length === 0) return
        const next = (selectedIndex + delta + items.length) % items.length
        set({ selectedIndex: next })
    },
}))
