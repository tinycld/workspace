import { useOrgHref } from '@tinycld/core/lib/org-routes'
import {
    type DriveItemFileActions,
    useDriveItemFileActions,
} from '@tinycld/drive/hooks/use-drive-item-file-actions'
import { router } from 'expo-router'
import { useCallback } from 'react'

export type DocumentFileActions = DriveItemFileActions

// Thin wrapper over drive's shared file-actions hook with text's
// post-trash redirect target.
export function useDocumentFileActions(documentId: string): DocumentFileActions {
    const orgHref = useOrgHref()
    const onTrashed = useCallback(() => {
        router.replace(orgHref('text'))
    }, [orgHref])
    return useDriveItemFileActions({ itemId: documentId, onTrashed })
}
