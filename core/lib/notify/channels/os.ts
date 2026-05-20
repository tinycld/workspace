import { notify as osNotify } from '@tinycld/core/lib/notifications'
import type { DispatchInput, NotifyChannel } from '@tinycld/core/lib/notify/channels/types'

export const osChannel: NotifyChannel = {
    name: 'os',
    async dispatch(input: DispatchInput) {
        await osNotify({
            title: input.title,
            body: input.body,
            data: input.data,
        })
    },
}
