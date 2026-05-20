import type { NotifyChannel } from '@tinycld/core/lib/notify/channels/types'
import { __setChannelsForTests, notify } from '@tinycld/core/lib/notify/dispatcher'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Channel modules are imported eagerly by the dispatcher; stub their deps so
// loading this test does not require runtime env (pocketbase client, RN APIs).
vi.mock('@tinycld/core/lib/pocketbase', () => ({
    notificationsCollection: {
        insert: vi.fn(() => ({ isPersisted: { promise: Promise.resolve() } })),
    },
}))
vi.mock('@tinycld/core/lib/notifications', () => ({
    notify: vi.fn(() => Promise.resolve()),
}))
vi.mock('@tinycld/core/lib/stores/toast-store', () => ({
    useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}))

function makeChannel(name: NotifyChannel['name']): NotifyChannel {
    return { name, dispatch: vi.fn() }
}

describe('notify.emit', () => {
    afterEach(() => {
        __setChannelsForTests(null)
        vi.clearAllMocks()
    })

    it('dispatches to exactly the channels named in the registry', () => {
        const toast = makeChannel('toast')
        const bell = makeChannel('bell')
        const os = makeChannel('os')
        __setChannelsForTests({ toast, bell, os })

        notify.emit({
            event: 'import.complete',
            title: 'Done',
            body: '42 contacts',
            data: { source: 'google-takeout', count: 42 },
        })

        expect(toast.dispatch).toHaveBeenCalledTimes(1)
        expect(bell.dispatch).toHaveBeenCalledTimes(1)
        expect(os.dispatch).not.toHaveBeenCalled()
    })

    it('merges the registry variant into the dispatch input', () => {
        const toast = makeChannel('toast')
        __setChannelsForTests({ toast, bell: makeChannel('bell'), os: makeChannel('os') })

        notify.emit({ event: 'mail.send_failed', title: 'Oops', data: { error: 'timeout' } })

        expect(toast.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ variant: 'error', title: 'Oops' })
        )
    })

    it('catches a synchronous channel throw and still runs later channels', () => {
        const toast = makeChannel('toast')
        toast.dispatch = vi.fn(() => {
            throw new Error('boom')
        })
        const bell = makeChannel('bell')
        __setChannelsForTests({ toast, bell, os: makeChannel('os') })

        expect(() =>
            notify.emit({
                event: 'import.complete',
                title: 'x',
                data: { source: 'csv', count: 1 },
            })
        ).not.toThrow()
        expect(bell.dispatch).toHaveBeenCalled()
    })

    it('swallows a channel rejection without affecting others', async () => {
        const toast = makeChannel('toast')
        toast.dispatch = vi.fn(() => Promise.reject(new Error('async-boom')))
        const bell = makeChannel('bell')
        __setChannelsForTests({ toast, bell, os: makeChannel('os') })

        notify.emit({
            event: 'import.complete',
            title: 'x',
            data: { source: 'csv', count: 1 },
        })

        // allow microtasks to flush
        await new Promise(r => setTimeout(r, 0))
        expect(bell.dispatch).toHaveBeenCalled()
    })
})
