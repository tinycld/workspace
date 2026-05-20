import { notify } from '@tinycld/core/lib/notify'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The dispatcher imports all three channel modules eagerly. In a node/vitest
// environment bellChannel and osChannel transitively load modules that throw
// (pocketbase needs EXPO_PUBLIC_ENV; notifications loads web-push). We only
// care about the toast path here, so stub the other channels' external deps.
vi.mock('@tinycld/core/lib/pocketbase', () => ({
    notificationsCollection: {
        insert: vi.fn(() => ({ isPersisted: { promise: Promise.resolve() } })),
    },
}))
vi.mock('@tinycld/core/lib/notifications', () => ({
    notify: vi.fn(() => Promise.resolve()),
}))

describe('notify end-to-end (toast path)', () => {
    beforeEach(() => {
        useToastStore.setState({ toasts: [] })
    })
    afterEach(() => {
        useToastStore.setState({ toasts: [] })
    })

    it('import.complete lands a success toast through the real toast store', () => {
        notify.emit({
            event: 'import.complete',
            title: 'Import done',
            body: '42 contacts',
            data: { source: 'google-takeout', count: 42 },
        })
        const toasts = useToastStore.getState().toasts
        expect(toasts).toHaveLength(1)
        expect(toasts[0]).toMatchObject({
            title: 'Import done',
            body: '42 contacts',
            variant: 'success',
        })
        // BellChannel also fires for this event but no-ops without notify context.
    })

    it('mail.send_failed lands an error toast', () => {
        notify.emit({
            event: 'mail.send_failed',
            title: 'Send failed',
            body: 'network timeout',
            data: { error: 'timeout' },
        })
        expect(useToastStore.getState().toasts[0]).toMatchObject({
            title: 'Send failed',
            variant: 'error',
        })
    })

    it('mutation.error lands an error toast', () => {
        notify.emit({
            event: 'mutation.error',
            title: 'Something went wrong',
            body: 'validation failed',
            data: { operation: 'create contact', error: 'validation failed' },
        })
        expect(useToastStore.getState().toasts[0]).toMatchObject({
            title: 'Something went wrong',
            variant: 'error',
        })
    })
})
