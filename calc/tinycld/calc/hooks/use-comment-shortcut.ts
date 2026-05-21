import { useEffect } from 'react'
import { Platform } from 'react-native'
import { primaryAnchor } from '../lib/selection-range'
import type { GridStoreApi } from './grid-store'

// Cmd/Ctrl+Alt+M opens the comment popover on the currently-selected
// cell. Web-only — physical Cmd+Alt on touch devices is rare and the
// listener attaches to window, which doesn't exist on native runtimes.
//
// Anchoring: keyboard-triggered popovers don't have a cursor, so we use
// the viewport center as a conservative fallback. The Menu component
// edge-flips so the popover stays on screen regardless. Per-cell
// screen-coords would require plumbing the body's window-rect through
// here, which is more wiring than v1 needs.
export function useCommentShortcut(store: GridStoreApi, readOnly: boolean) {
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (readOnly) return
        if (typeof window === 'undefined') return

        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return
            if (!e.altKey) return
            if (e.key !== 'm' && e.key !== 'M') return
            const state = store.getState()
            const anchor = primaryAnchor(state.selection)
            if (anchor == null) return
            // Avoid intercepting when the user is typing in the cell
            // editor or formula bar — Cmd+Alt+M during an edit should
            // belong to whatever the input wants to do (or, more
            // commonly, nothing).
            if (state.editSession != null) return
            e.preventDefault()
            const x = window.innerWidth / 2
            const y = window.innerHeight / 2
            store.getState().openCommentPopover(anchor.row, anchor.col, x, y)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [store, readOnly])
}
