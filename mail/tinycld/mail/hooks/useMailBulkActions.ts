import type { Transaction } from '@tanstack/react-db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useLabelMutations } from '@tinycld/core/ui/hooks/useLabelMutations'
import type { ThreadListItem } from '../components/thread-list-item'
import type { MailThreadState } from '../types'

interface ThreadStateCollection {
    update(id: string | number, callback: (draft: MailThreadState) => void): Transaction<Record<string, unknown>>
}

export function useMailBulkActions(
    // biome-ignore lint/suspicious/noExplicitAny: pbtsdb collection type is deeply generic; narrowing it is impractical
    threadStateCollection: any,
    selectedItems: ThreadListItem[],
    clearSelection: () => void
) {
    const col: ThreadStateCollection = threadStateCollection
    const { assignLabel, unassignLabel } = useLabelMutations()

    const archiveSelected = useMutation({
        mutationFn: mutation(function* () {
            yield selectedItems.map((item) =>
                col.update(item.stateId, (draft) => {
                    draft.folder = 'archive'
                })
            )
        }),
        onSuccess: clearSelection,
    })

    const spamSelected = useMutation({
        mutationFn: mutation(function* () {
            yield selectedItems.map((item) =>
                col.update(item.stateId, (draft) => {
                    draft.folder = 'spam'
                })
            )
        }),
        onSuccess: clearSelection,
    })

    const trashSelected = useMutation({
        mutationFn: mutation(function* () {
            yield selectedItems.map((item) =>
                col.update(item.stateId, (draft) => {
                    draft.folder = 'trash'
                })
            )
        }),
        onSuccess: clearSelection,
    })

    const toggleReadSelected = useMutation<void, Error, { markAsRead: boolean }>({
        mutationFn: mutation(function* ({ markAsRead }) {
            yield selectedItems.map((item) =>
                col.update(item.stateId, (draft) => {
                    draft.is_read = markAsRead
                })
            )
        }),
        onSuccess: clearSelection,
    })

    const moveSelected = useMutation<void, Error, MailThreadState['folder']>({
        mutationFn: mutation(function* (folder) {
            yield selectedItems.map((item) =>
                col.update(item.stateId, (draft) => {
                    draft.folder = folder
                })
            )
        }),
        onSuccess: clearSelection,
    })

    const toggleStarSelected = useMutation<void, Error, { star: boolean }>({
        mutationFn: mutation(function* ({ star }) {
            yield selectedItems.map((item) =>
                col.update(item.stateId, (draft) => {
                    draft.is_starred = star
                })
            )
        }),
        onSuccess: clearSelection,
    })

    const updateLabelsSelected = {
        mutate: ({ labelId, add }: { labelId: string; add: boolean }) => {
            for (const item of selectedItems) {
                if (add) {
                    assignLabel.mutate({
                        labelId,
                        recordId: item.stateId,
                        collection: 'mail_thread_state',
                    })
                } else {
                    unassignLabel.mutate({
                        labelId,
                        recordId: item.stateId,
                        collection: 'mail_thread_state',
                    })
                }
            }
            clearSelection()
        },
    }

    return {
        archiveSelected,
        spamSelected,
        trashSelected,
        toggleReadSelected,
        moveSelected,
        toggleStarSelected,
        updateLabelsSelected,
    }
}
