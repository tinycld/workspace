import { ChooseFolderDialog } from './ChooseFolderDialog'
import { useCopyDriveItem } from '../lib/copy-drive-item'
import { useCopyDialogStore } from '../stores/copy-dialog-store'

interface CopyToFolderDialogProps {
    // Source item id. The dialog only inspects the copy-dialog store
    // (open/close + the desired copy name + the source's current
    // parent), so the item id is passed in separately by the host
    // screen rather than re-resolved from the store.
    itemId: string
    // Called after the new copy is created; the host screen typically
    // navigates to the new item's detail route.
    onCopied: (newItemId: string) => void
}

// CopyToFolderDialog presents the "Choose a folder" picker pre-
// selected at the source item's current parent, and on confirm runs
// the useCopyDriveItem mutation. On success it calls onCopied with
// the new row id so the host can navigate (or otherwise react).
//
// The dialog is opened by useDriveItemFileActions.makeCopy, which
// pushes `{ copyName, sourceParentId }` into useCopyDialogStore.
// Mount this once alongside the host package's other detail-screen
// dialogs.
export function CopyToFolderDialog({ itemId, onCopied }: CopyToFolderDialogProps) {
    const pending = useCopyDialogStore(s => s.pendingCopy)
    const close = useCopyDialogStore(s => s.closeCopyDialog)
    const copyDriveItem = useCopyDriveItem()

    if (pending == null) return null

    const handleMove = (targetFolderId: string) => {
        copyDriveItem.mutate(
            {
                sourceItemId: itemId,
                newName: pending.copyName,
                parentId: targetFolderId,
            },
            {
                onSuccess: result => onCopied(result.itemId),
            }
        )
    }

    return (
        <ChooseFolderDialog
            open
            itemName={pending.copyName}
            excludeId=""
            initialSelectedId={pending.sourceParentId}
            onMove={handleMove}
            onClose={close}
            title={`Copy "${pending.copyName}" to`}
            confirmLabel="Copy here"
        />
    )
}
