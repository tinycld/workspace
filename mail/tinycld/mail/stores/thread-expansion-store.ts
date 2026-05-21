import { create } from '@tinycld/core/lib/store'

interface ThreadExpansionState {
    /**
     * Message IDs whose expansion state has been toggled away from the
     * default (last-message-expanded, others-collapsed). Cleared whenever
     * a new thread is opened so each thread starts with default state.
     */
    toggled: Set<string>
    threadId: string | null
    /** Reset state to defaults for a newly-opened thread. */
    resetForThread: (threadId: string) => void
    /** Flip the override flag for a message. */
    toggle: (messageId: string) => void
}

export const useThreadExpansionStore = create<ThreadExpansionState>((set) => ({
    toggled: new Set(),
    threadId: null,
    resetForThread: (threadId) =>
        set((state) => (state.threadId === threadId ? state : { threadId, toggled: new Set() })),
    toggle: (messageId) =>
        set((state) => {
            const next = new Set(state.toggled)
            if (next.has(messageId)) {
                next.delete(messageId)
            } else {
                next.add(messageId)
            }
            return { toggled: next }
        }),
}))
