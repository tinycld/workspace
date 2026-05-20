import type { NotifyEventName } from '@tinycld/core/lib/notify/events'
import type { Variant } from '@tinycld/core/lib/notify/registry'

export type DispatchInput = {
    event: NotifyEventName
    title: string
    body?: string
    url?: string
    /** Per-call duration override (ms). ToastChannel default is 4000. */
    durationMs?: number
    data?: Record<string, unknown>
    variant: Variant
}

export interface NotifyChannel {
    readonly name: 'toast' | 'bell' | 'os'
    dispatch(input: DispatchInput): void | Promise<void>
}
