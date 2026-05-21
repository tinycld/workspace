import type { ComposeMode } from './useComposeState'

type Listener = () => void

const listeners = new Set<Listener>()

export const composeEvents = {
    emit() {
        listeners.forEach((listener) => {
            listener()
        })
    },
    subscribe(listener: Listener) {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    },
}

interface ComposeStateActions {
    mode: ComposeMode
    open: () => void
    close: () => void
}

// Translates a FAB / sidebar Compose press into a store transition. 'inline'
// (a reply on the thread-detail screen) is treated as a different intent than
// a new email — clear it before opening so the user gets a blank window.
// Existing open/minimized/maximized windows are left alone to preserve drafts.
export function handleNewComposeIntent(state: ComposeStateActions) {
    if (state.mode === 'inline') state.close()
    if (state.mode === 'closed' || state.mode === 'inline') state.open()
}
