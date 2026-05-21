import { create } from '@tinycld/core/lib/store'

interface AttachmentStripState {
    threadId: string | null
    expanded: boolean
    expand: () => void
    collapse: () => void
    toggle: () => void
    resetForThread: (threadId: string) => void
}

export const useAttachmentStripStore = create<AttachmentStripState>((set, get) => ({
    threadId: null,
    expanded: false,
    expand: () => set({ expanded: true }),
    collapse: () => set({ expanded: false }),
    toggle: () => set((state) => ({ expanded: !state.expanded })),
    resetForThread: (threadId) => {
        if (get().threadId === threadId) return
        set({ threadId, expanded: false })
    },
}))
