import { captureException } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCallback } from 'react'

interface UseRenameDocumentResult {
    rename: (newName: string) => void
    isPending: boolean
    error: unknown
    reset: () => void
}

// Wraps a single drive_items.name update for the document-title inline
// editor. We keep this separate from useDocumentFileActions because
// the inline title needs reactive isPending/error to drive its loading
// + error states, and the shared fileActions surface intentionally
// hides that to keep its callers simple.
export function useRenameDocument(documentId: string): UseRenameDocumentResult {
    const [driveItemsCollection] = useStore('drive_items')

    const renameMutation = useMutation({
        mutationFn: mutation(function* (newName: string) {
            yield driveItemsCollection.update(documentId, draft => {
                draft.name = newName
            })
        }),
        onError: error => {
            captureException('text.renameDocument', error, { documentId })
        },
    })

    const rename = useCallback(
        (newName: string) => renameMutation.mutate(newName),
        [renameMutation]
    )

    return {
        rename,
        isPending: renameMutation.isPending,
        error: renameMutation.error,
        reset: renameMutation.reset,
    }
}
