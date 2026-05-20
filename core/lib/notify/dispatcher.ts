import { bellChannel } from '@tinycld/core/lib/notify/channels/bell'
import { osChannel } from '@tinycld/core/lib/notify/channels/os'
import { toastChannel } from '@tinycld/core/lib/notify/channels/toast'
import type { DispatchInput, NotifyChannel } from '@tinycld/core/lib/notify/channels/types'
import type { NotificationEvents, NotifyEventName } from '@tinycld/core/lib/notify/events'
import { eventRegistry } from '@tinycld/core/lib/notify/registry'
import { captureExceptionToSentry as captureException } from '@tinycld/core/lib/sentry'

export type NotifyInput<K extends NotifyEventName = NotifyEventName> = {
    event: K
    title: string
    body?: string
    url?: string
    /** Per-call duration override (ms) for toast display. Defaults to 4000. */
    durationMs?: number
    data?: NotificationEvents[K]
}

type ChannelMap = Record<NotifyChannel['name'], NotifyChannel>

const defaultChannels: ChannelMap = {
    toast: toastChannel,
    bell: bellChannel,
    os: osChannel,
}

let activeChannels: ChannelMap = defaultChannels

/** Test-only: swap the channel map. Pass null to restore defaults. */
export function __setChannelsForTests(map: ChannelMap | null) {
    activeChannels = map ?? defaultChannels
}

function emit<K extends NotifyEventName>(input: NotifyInput<K>): void {
    const config = eventRegistry[input.event]
    if (!config) {
        captureException('notify.dispatcher', new Error(`unknown event: ${input.event}`))
        return
    }

    const dispatchInput: DispatchInput = {
        event: input.event,
        title: input.title,
        body: input.body,
        url: input.url,
        durationMs: input.durationMs,
        data: input.data as Record<string, unknown> | undefined,
        variant: config.variant,
    }

    for (const channelName of config.channels) {
        const channel = activeChannels[channelName]
        try {
            const result = channel.dispatch(dispatchInput)
            if (result instanceof Promise) {
                result.catch(err => {
                    captureException('notify.channel.rejected', err, { channel: channelName })
                })
            }
        } catch (err) {
            captureException('notify.channel.threw', err, { channel: channelName })
        }
    }
}

export const notify = { emit }
