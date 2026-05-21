import { useFolderTreeQuery } from '../hooks/use-folder-tree-query'
import { useSaveToDrive } from '../lib/save-to-drive'
import { useSaveToDriveStore } from '../stores/save-to-drive-store'
import type { FolderTreeNode } from '../types'
import { ChooseFolderDialog } from './ChooseFolderDialog'

const ROOT_FOLDER_LABEL = 'My Files'

function findFolderName(tree: FolderTreeNode[], id: string): string | null {
    for (const node of tree) {
        if (node.item.id === id) return node.item.name
        const found = findFolderName(node.children, id)
        if (found) return found
    }
    return null
}

/**
 * Mounted once at app boot via DriveProvider. Listens for an open request on
 * the SaveToDrive store, presents drive's standard folder picker, and runs
 * the save mutation against the chosen folder.
 */
export function SaveToDriveDialog() {
    const pendingSource = useSaveToDriveStore(s => s.pendingSource)
    const close = useSaveToDriveStore(s => s.close)
    const saveMutation = useSaveToDrive()
    // Keep the tree on hand so the success toast can name the picked
    // folder. The dialog itself will share this query via the
    // `folderTree` prop, skipping the dialog's internal lookup.
    const folderTree = useFolderTreeQuery({ enabled: pendingSource !== null })

    const handleSave = (parentId: string) => {
        if (!pendingSource) return
        const parentName =
            parentId === ''
                ? ROOT_FOLDER_LABEL
                : (findFolderName(folderTree, parentId) ?? ROOT_FOLDER_LABEL)
        saveMutation.mutate({ source: pendingSource, parentId, parentName })
    }

    return (
        <ChooseFolderDialog
            open={pendingSource !== null}
            itemName={pendingSource?.displayName ?? ''}
            excludeId=""
            folderTree={folderTree}
            onMove={handleSave}
            onClose={close}
            title={pendingSource ? `Save “${pendingSource.displayName}” to Drive` : 'Save to Drive'}
            confirmLabel="Save here"
        />
    )
}
