import type { DispatchInput, NotifyChannel } from '@tinycld/core/lib/notify/channels/types'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'

export const toastChannel: NotifyChannel = {
    name: 'toast',
    dispatch(input: DispatchInput) {
        useToastStore.getState().addToast({
            title: input.title,
            body: input.body,
            variant: input.variant,
            duration: input.durationMs ?? 4000,
        })
    },
}
