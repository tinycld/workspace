import type { NotifyEventName } from '@tinycld/core/lib/notify/events'

/** `'os'` is wired into the dispatcher but not yet used by any event — opt in when a future event needs native/browser push. */
export type ChannelName = 'toast' | 'bell' | 'os'
export type Variant = 'info' | 'success' | 'warning' | 'error'

export type EventConfig = {
    /** Channels fire in array order; failures in one do not block the next. */
    channels: ChannelName[]
    variant: Variant
}

/**
 * Policy: which channels fire for each event, and the visual variant to use.
 * TypeScript requires one entry per NotifyEventName.
 */
export const eventRegistry: Record<NotifyEventName, EventConfig> = {
    'mail.send_failed': { channels: ['toast'], variant: 'error' },
    'mail.send_blocked_warn': { channels: ['toast'], variant: 'warning' },
    'mail.send_blocked_error': { channels: ['toast'], variant: 'error' },
    'mail.attachments_rejected': { channels: ['toast'], variant: 'error' },
    'drive.save_succeeded': { channels: ['toast'], variant: 'success' },
    'drive.save_failed': { channels: ['toast'], variant: 'error' },
    'import.complete': { channels: ['toast', 'bell'], variant: 'success' },
    'import.failed': { channels: ['toast', 'bell'], variant: 'error' },
    'mutation.error': { channels: ['toast'], variant: 'error' },
}
