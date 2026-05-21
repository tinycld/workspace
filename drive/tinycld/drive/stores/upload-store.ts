import { create } from '@tinycld/core/lib/store'

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'

export interface UploadingFile {
    id: string
    name: string
    parentId: string
    size: number
    loaded: number
    status: UploadStatus
    errorMessage?: string
}

interface UploadStoreState {
    uploadingFiles: UploadingFile[]
    add: (entries: UploadingFile[]) => void
    update: (id: string, patch: Partial<UploadingFile>) => void
    remove: (id: string) => void
    clearDoneById: (id: string) => void
}

/**
 * Shared upload state. Lives in a store rather than useState so every
 * component that calls useDrive() — toolbar, sidebar, screen — sees the same
 * list of in-flight uploads. The mutation logic in useFileUpload writes here;
 * useDriveItems and the placeholder rows read from here.
 */
export const useUploadStore = create<UploadStoreState>((set) => ({
    uploadingFiles: [],
    add: (entries) =>
        set((s) => ({
            uploadingFiles: [...s.uploadingFiles, ...entries],
        })),
    update: (id, patch) =>
        set((s) => ({
            uploadingFiles: s.uploadingFiles.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),
    remove: (id) =>
        set((s) => ({
            uploadingFiles: s.uploadingFiles.filter((f) => f.id !== id),
        })),
    clearDoneById: (id) =>
        set((s) => ({
            uploadingFiles: s.uploadingFiles.filter((f) => !(f.id === id && f.status === 'done')),
        })),
}))
