/**
 * Central list of every user-facing notification event.
 * Keys follow `<domain>.<verb_past>`. Adding an entry here is step 1 of registering
 * an event — also add a matching entry to eventRegistry in ./registry.ts.
 */
export type NotificationEvents = {
    'mail.send_failed': { error: string }
    'mail.send_blocked_warn': { reason: string }
    'mail.send_blocked_error': { reason: string }
    'mail.attachments_rejected': { reason: string }
    'drive.save_succeeded': { name: string; folder: string }
    'drive.save_failed': { reason: string }
    'import.complete': { source: 'google-takeout' | 'csv'; count: number }
    'import.failed': { source: string; error: string }
    'mutation.error': { operation: string; error: string }
}

export type NotifyEventName = keyof NotificationEvents
