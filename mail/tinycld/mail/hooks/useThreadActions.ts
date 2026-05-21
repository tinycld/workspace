import type { Transaction } from '@tanstack/react-db'
import { captureException } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useLabelMutations } from '@tinycld/core/ui/hooks/useLabelMutations'
import type { MailThreadState } from '../types'

interface ThreadStateCollection {
    update(id: string | number, callback: (draft: MailThreadState) => void): Transaction<Record<string, unknown>>
}

export function useThreadActions(
    // biome-ignore lint/suspicious/noExplicitAny: pbtsdb collection type is deeply generic; narrowing it is impractical
    threadStateCollection: any,
    threadState: MailThreadState | undefined,
    onNavigateBack: () => void
) {
    const col: ThreadStateCollection = threadStateCollection
    const { assignLabel, unassignLabel } = useLabelMutations()

    const onError = (error: unknown) => {
        captureException('Thread action failed', error)
    }

    const archiveThread = useMutation({
        mutationFn: mutation(function* () {
            if (!threadState) return
            yield col.update(threadState.id, (draft) => {
                draft.folder = 'archive'
            })
        }),
        onSuccess: onNavigateBack,
        onError,
    })

    const spamThread = useMutation({
        mutationFn: mutation(function* () {
            if (!threadState) return
            yield col.update(threadState.id, (draft) => {
                draft.folder = 'spam'
            })
        }),
        onSuccess: onNavigateBack,
        onError,
    })

    const trashThread = useMutation({
        mutationFn: mutation(function* () {
            if (!threadState) return
            yield col.update(threadState.id, (draft) => {
                draft.folder = 'trash'
            })
        }),
        onSuccess: onNavigateBack,
        onError,
    })

    const moveThread = useMutation({
        mutationFn: mutation(function* (folder: MailThreadState['folder']) {
            if (!threadState) return
            yield col.update(threadState.id, (draft) => {
                draft.folder = folder
            })
        }),
        onSuccess: onNavigateBack,
        onError,
    })

    const toggleRead = useMutation({
        mutationFn: mutation(function* () {
            if (!threadState) return
            yield col.update(threadState.id, (draft) => {
                draft.is_read = !draft.is_read
            })
        }),
        onError,
    })

    const toggleStar = useMutation({
        mutationFn: mutation(function* () {
            if (!threadState) return
            yield col.update(threadState.id, (draft) => {
                draft.is_starred = !draft.is_starred
            })
        }),
        onError,
    })

    const updateLabel = {
        mutate: ({ labelId, add }: { labelId: string; add: boolean }) => {
            if (!threadState) return
            if (add) {
                assignLabel.mutate({
                    labelId,
                    recordId: threadState.id,
                    collection: 'mail_thread_state',
                })
            } else {
                unassignLabel.mutate({
                    labelId,
                    recordId: threadState.id,
                    collection: 'mail_thread_state',
                })
            }
        },
    }

    return {
        archiveThread,
        spamThread,
        trashThread,
        moveThread,
        toggleRead,
        toggleStar,
        updateLabel,
    }
}
