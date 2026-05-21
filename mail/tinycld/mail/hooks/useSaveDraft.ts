import { errorToString } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { PB_SERVER_ADDR, pb } from '@tinycld/core/lib/pocketbase'

interface SaveDraftParams {
    mailbox_id: string
    alias_id?: string
    message_id?: string
    to?: { name: string; email: string }[]
    cc?: { name: string; email: string }[]
    bcc?: { name: string; email: string }[]
    subject?: string
    html_body: string
    text_body: string
    attachments?: File[]
}

interface UseSaveDraftOptions {
    onSuccess?: () => void
    onError?: (message: string) => void
}

export function useSaveDraft({ onSuccess, onError }: UseSaveDraftOptions = {}) {
    const mutation = useMutation({
        mutationFn: async (params: SaveDraftParams) => {
            const { attachments, ...jsonFields } = params

            if (attachments?.length) {
                const formData = new FormData()
                formData.append('json', JSON.stringify(jsonFields))
                for (const file of attachments) {
                    formData.append('attachments', file, file.name)
                }
                const res = await fetch(`${PB_SERVER_ADDR}/api/mail/draft`, {
                    method: 'POST',
                    headers: { Authorization: pb.authStore.token },
                    body: formData,
                })
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    throw new Error(data.message || `Draft save failed: ${res.status}`)
                }
                return await res.json()
            }

            return await pb.send('/api/mail/draft', {
                method: 'POST',
                body: jsonFields,
            })
        },
        onSuccess,
        onError: (error: unknown) => {
            onError?.(errorToString(error))
        },
    })

    return {
        saveDraft: mutation.mutate,
        isPending: mutation.isPending,
        error: mutation.error,
    }
}
