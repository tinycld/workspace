import { and, eq } from '@tanstack/db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { router } from 'expo-router'
import { newRecordId } from 'pbtsdb/core'
import { useCallback } from 'react'
import { useCopyDialogStore } from '../stores/copy-dialog-store'

export interface DriveItemFileActions {
    rename: (newName: string) => void
    makeCopy: (copyName: string) => void
    moveToTrash: () => void
    openDriveDetails: () => void
}

interface UseDriveItemFileActionsParams {
    itemId: string
    // Called after the item is moved to trash. Packages pass their own
    // index route (e.g. orgHref('calc'), orgHref('text')) so the user
    // isn't left staring at the trashed item.
    onTrashed: () => void
}

// Self-contained wrappers around the drive_items collection for any
// "this row backs my package's document" workflow (calc workbooks,
// text documents, …). Mutations flow through pbtsdb directly; folder
// picking + duplication are delegated to the CopyToFolderDialog +
// useCopyDriveItem flow, which this hook opens via the shared
// useCopyDialogStore.
//
// `rename` writes the new name through pbtsdb. `moveToTrash` mirrors
// drive's `trashMutation` flow — writes a `trashed_at` timestamp onto
// a `drive_item_state` row keyed by (item, user_org), upserting if
// needed, then calls onTrashed so the caller can navigate away.
//
// `makeCopy` doesn't mutate immediately — it stashes the desired
// copy name plus the source item's current parent in the copy-dialog
// store, which CopyToFolderDialog reads to open the folder picker
// pre-selected at the source's folder. The picker fires the real
// useCopyDriveItem mutation when the user confirms.
export function useDriveItemFileActions(
    params: UseDriveItemFileActionsParams
): DriveItemFileActions {
    const { itemId, onTrashed } = params
    const [driveItemsCollection, driveItemStateCollection] = useStore(
        'drive_items',
        'drive_item_state'
    )
    const orgSlug = useOrgSlug()
    const userOrg = useCurrentUserOrg(orgSlug)
    const userOrgId = userOrg?.id ?? ''
    const orgHref = useOrgHref()
    const openCopyDialog = useCopyDialogStore(s => s.openCopyDialog)

    const { data: existingStateRows = [] } = useOrgLiveQuery(
        (query, scope) =>
            query
                .from({ state: driveItemStateCollection })
                .where(({ state }) =>
                    and(eq(state.item, itemId), eq(state.user_org, scope.userOrgId))
                ),
        [itemId]
    )
    const existingState = existingStateRows[0]

    const { data: itemRows = [] } = useOrgLiveQuery(
        (query, scope) =>
            query
                .from({ item: driveItemsCollection })
                .where(({ item }) => and(eq(item.org, scope.orgId), eq(item.id, itemId)))
                .select(({ item }) => ({ parent: item.parent })),
        [itemId]
    )
    const sourceParentId = itemRows[0]?.parent ?? ''

    const renameMutation = useMutation({
        mutationFn: mutation(function* (newName: string) {
            yield driveItemsCollection.update(itemId, draft => {
                draft.name = newName
            })
        }),
    })

    const rename = useCallback(
        (newName: string) => renameMutation.mutate(newName),
        [renameMutation]
    )

    const makeCopy = useCallback(
        (copyName: string) => {
            openCopyDialog({ copyName, sourceParentId })
        },
        [openCopyDialog, sourceParentId]
    )

    const trashMutation = useMutation({
        mutationFn: mutation(function* () {
            const trashedAt = new Date().toISOString()
            if (existingState) {
                yield driveItemStateCollection.update(existingState.id, draft => {
                    draft.trashed_at = trashedAt
                })
            } else {
                yield driveItemStateCollection.insert({
                    id: newRecordId(),
                    item: itemId,
                    user_org: userOrgId,
                    is_starred: false,
                    trashed_at: trashedAt,
                    last_viewed_at: '',
                })
            }
        }),
        onSuccess: onTrashed,
    })

    const moveToTrash = useCallback(() => trashMutation.mutate(), [trashMutation])

    const openDriveDetails = useCallback(() => {
        router.push(orgHref('drive', { item: itemId }))
    }, [orgHref, itemId])

    return { rename, makeCopy, moveToTrash, openDriveDetails }
}
