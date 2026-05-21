import { useOrgHref } from '@tinycld/core/lib/org-routes'
import {
    type DriveItemFileActions,
    useDriveItemFileActions,
} from '@tinycld/drive/hooks/use-drive-item-file-actions'
import { router } from 'expo-router'
import { useCallback } from 'react'

export type WorkbookFileActions = DriveItemFileActions

// Thin wrapper over @tinycld/drive's shared file-actions hook that
// supplies calc's post-trash redirect target.
export function useWorkbookFileActions(workbookId: string): WorkbookFileActions {
    const orgHref = useOrgHref()
    const onTrashed = useCallback(() => {
        router.replace(orgHref('calc'))
    }, [orgHref])
    return useDriveItemFileActions({ itemId: workbookId, onTrashed })
}
