import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { create } from '@tinycld/core/lib/store'

interface SaveToDriveState {
    /** The file the user wants to save, or null when the dialog is closed. */
    pendingSource: FilePreviewSource | null
    open: (source: FilePreviewSource) => void
    close: () => void
}

export const useSaveToDriveStore = create<SaveToDriveState>((set) => ({
    pendingSource: null,
    open: (source) => set({ pendingSource: source }),
    close: () => set({ pendingSource: null }),
}))
