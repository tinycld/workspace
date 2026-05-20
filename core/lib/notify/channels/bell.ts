import type { DispatchInput, NotifyChannel } from '@tinycld/core/lib/notify/channels/types'
import { getNotifyContext } from '@tinycld/core/lib/notify/context'
import { notificationsCollection } from '@tinycld/core/lib/pocketbase'
import { captureExceptionToSentry as captureException } from '@tinycld/core/lib/sentry'
import { newRecordId } from 'pbtsdb/core'

export const bellChannel: NotifyChannel = {
    name: 'bell',
    async dispatch(input: DispatchInput) {
        const ctx = getNotifyContext()
        if (!ctx) {
            captureException(
                'notify.bell.no_context',
                new Error(`skipped "${input.event}" — no org/user context`)
            )
            return
        }

        const tx = notificationsCollection.insert({
            id: newRecordId(),
            user: ctx.userId,
            org: ctx.orgId,
            type: input.event,
            package: 'core',
            title: input.title,
            body: input.body ?? '',
            url: input.url ?? '',
            metadata: input.data ?? {},
            read: false,
            dismissed: false,
        })
        await tx.isPersisted.promise
    },
}
