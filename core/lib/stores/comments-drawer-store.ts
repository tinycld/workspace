import { create } from '@tinycld/core/lib/store'

// Single drawer instance app-wide. The screen that mounts the drawer
// calls reset() when its driveItemId changes so state can't leak across
// documents. Not persisted — should always start closed.
interface CommentsDrawerState {
    isOpen: boolean
    packageSlug: string | null
    driveItemId: string | null
    focusedThreadId: string | null
    open: (args: { packageSlug: string; driveItemId: string; threadId?: string }) => void
    close: () => void
    focusThread: (threadId: string | null) => void
    reset: () => void
}

export const useCommentsDrawerStore = create<CommentsDrawerState>(set => ({
    isOpen: false,
    packageSlug: null,
    driveItemId: null,
    focusedThreadId: null,
    open: args =>
        set({
            isOpen: true,
            packageSlug: args.packageSlug,
            driveItemId: args.driveItemId,
            focusedThreadId: args.threadId ?? null,
        }),
    close: () => set({ isOpen: false, focusedThreadId: null }),
    focusThread: threadId => set({ focusedThreadId: threadId }),
    reset: () =>
        set({
            isOpen: false,
            packageSlug: null,
            driveItemId: null,
            focusedThreadId: null,
        }),
}))
