import { useMemo } from 'react'
import { mimeTypeToCategory } from '../components/file-icons'
import { useUploadStore } from '../stores/upload-store'
import type { DriveItemView, SidebarSection } from '../types'

interface UseUploadPlaceholdersParams {
    userOrgId: string
    activeSection: SidebarSection
    currentFolderId: string
    isSearchActive: boolean
    itemsById: Map<string, DriveItemView>
}

// Computes the list of in-flight upload rows to render alongside the
// current folder's items. Subscribes to useUploadStore directly, so
// the consumer (the drive screen) re-renders on progress ticks but
// the wider DriveContextValue does not.
export function useUploadPlaceholders({
    userOrgId,
    activeSection,
    currentFolderId,
    isSearchActive,
    itemsById,
}: UseUploadPlaceholdersParams): DriveItemView[] {
    const uploadingFiles = useUploadStore((s) => s.uploadingFiles)

    return useMemo<DriveItemView[]>(() => {
        if (isSearchActive) return []
        if (activeSection !== 'my-drive') return []
        return uploadingFiles
            .filter((u) => u.parentId === currentFolderId)
            .filter((u) => !itemsById.has(u.id))
            .map((u) => ({
                id: u.id,
                name: u.name,
                isFolder: false,
                mimeType: '',
                parentId: u.parentId,
                owner: 'me',
                ownerUserOrgId: userOrgId,
                updated: '',
                size: u.size,
                shared: false,
                starred: false,
                trashedAt: '',
                file: '',
                thumbnail: '',
                description: '',
                category: mimeTypeToCategory('', false),
                uploadStatus: u.status,
                uploadLoaded: u.loaded,
                uploadError: u.errorMessage,
            }))
    }, [uploadingFiles, currentFolderId, activeSection, isSearchActive, itemsById, userOrgId])
}
