import { create } from '@tinycld/core/lib/store'
import { useCallback } from 'react'

// Single-open-at-a-time registry for tinycld's dropdown menus —
// menubars (File/Edit/View/…), toolbar pickers, color pickers, and
// any other dropdown that should yield to a sibling rather than
// stack on top of it. Opening any registered menu implicitly closes
// whichever was open before.
//
// A menu opts in by calling useOpenMenu(id) instead of useState. The
// returned [isOpen, setOpen] mirrors useState's signature so the
// Menu component's controlled-mode API (isOpen / onOpenChange) wires
// in unchanged.
//
// Outside-click closing is handled by a single document-level handler
// installed once per consumer surface (see useOpenMenuOutsideClick).
// Mark every menu portal subtree with data-tinycld-menu="content" so
// the handler can recognise clicks that should NOT close (clicks on
// items inside the popover, on submenu pop-outs, etc).

interface OpenMenuState {
    openId: string | null
    open: (id: string) => void
    close: () => void
}

export const useOpenMenuStore = create<OpenMenuState>()(set => ({
    openId: null,
    open: id => set({ openId: id }),
    close: () => set({ openId: null }),
}))

// Drop-in replacement for `const [isOpen, setIsOpen] = useState(false)`
// that participates in the exclusive-open registry.
export function useOpenMenu(id: string): readonly [boolean, (next: boolean) => void] {
    const isOpen = useOpenMenuStore(s => s.openId === id)
    const open = useOpenMenuStore(s => s.open)
    const close = useOpenMenuStore(s => s.close)
    const setOpen = useCallback(
        (next: boolean) => {
            if (next) open(id)
            else close()
        },
        [id, open, close]
    )
    return [isOpen, setOpen] as const
}
