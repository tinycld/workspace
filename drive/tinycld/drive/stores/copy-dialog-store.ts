import { create } from '@tinycld/core/lib/store'

interface PendingCopy {
    copyName: string
    sourceParentId: string
}

interface CopyDialogState {
    pendingCopy: PendingCopy | null
    openCopyDialog: (pending: PendingCopy) => void
    closeCopyDialog: () => void
}

// Shared store for the "Copy to folder" dialog flow. Packages that
// duplicate a drive_items row through a File → Make a copy menu
// (calc, text, …) push the desired copy name + source parent here
// from their file-actions hook; CopyToFolderDialog reads it to know
// when to render and what to pre-select.
export const useCopyDialogStore = create<CopyDialogState>()(set => ({
    pendingCopy: null,
    openCopyDialog: pending => set({ pendingCopy: pending }),
    closeCopyDialog: () => set({ pendingCopy: null }),
}))
