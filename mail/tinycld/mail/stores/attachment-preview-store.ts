import { create } from '@tinycld/core/lib/store'

interface ActiveAttachment {
    messageId: string
    fileName: string
}

interface AttachmentPreviewState {
    /** Identity of the open attachment, or null when closed. */
    active: ActiveAttachment | null
    open: (messageId: string, fileName: string) => void
    close: () => void
    setActive: (active: ActiveAttachment | null) => void
}

export const useAttachmentPreviewStore = create<AttachmentPreviewState>((set) => ({
    active: null,
    open: (messageId, fileName) => set({ active: { messageId, fileName } }),
    close: () => set({ active: null }),
    setActive: (active) => set({ active }),
}))
