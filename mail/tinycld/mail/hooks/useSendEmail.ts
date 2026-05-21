import { captureException, errorToString } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { notify } from '@tinycld/core/lib/notify'
import { PB_SERVER_ADDR, pb } from '@tinycld/core/lib/pocketbase'

interface SendEmailParams {
    mailbox_id: string
    alias_id?: string
    to: { name: string; email: string }[]
    cc?: { name: string; email: string }[]
    bcc?: { name: string; email: string }[]
    subject: string
    html_body: string
    text_body: string
    in_reply_to_message_id?: string
    attachments?: File[]
}

interface UseSendEmailOptions {
    onSuccess?: () => void
    onError?: (message: string) => void
}

export function useSendEmail({ onSuccess, onError }: UseSendEmailOptions = {}) {
    const mutation = useMutation({
        mutationFn: async (params: SendEmailParams) => {
            const { attachments, ...jsonFields } = params
            if (attachments?.length) {
                const formData = new FormData()
                formData.append('json', JSON.stringify(jsonFields))
                for (const file of attachments) {
                    formData.append('attachments', file, file.name)
                }
                const res = await fetch(`${PB_SERVER_ADDR}/api/mail/send`, {
                    method: 'POST',
                    headers: { Authorization: pb.authStore.token },
                    body: formData,
                })
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    throw new Error(data.message || `Send failed: ${res.status}`)
                }
                return await res.json()
            }

            return await pb.send('/api/mail/send', {
                method: 'POST',
                body: jsonFields,
            })
        },
        onSuccess,
        onError: (error: unknown) => {
            const message = errorToString(error)
            captureException('mail send failed', error)
            notify.emit({
                event: 'mail.send_failed',
                title: 'Send failed',
                body: message,
                durationMs: 8000,
                data: { error: message },
            })
            onError?.(message)
        },
    })

    return {
        send: mutation.mutate,
        isPending: mutation.isPending,
        error: mutation.error,
    }
}
