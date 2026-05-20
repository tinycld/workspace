import { osChannel } from '@tinycld/core/lib/notify/channels/os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/notifications', () => ({
    notify: vi.fn(() => Promise.resolve()),
}))

describe('OsChannel', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('forwards title/body/data to the platform notify helper', async () => {
        const { notify: osNotify } = await import('@tinycld/core/lib/notifications')
        await osChannel.dispatch({
            event: 'import.complete',
            title: 'Done',
            body: '42',
            data: { source: 'google-takeout', count: 42 },
            variant: 'success',
        })
        expect(osNotify).toHaveBeenCalledTimes(1)
        expect(osNotify).toHaveBeenCalledWith({
            title: 'Done',
            body: '42',
            data: { source: 'google-takeout', count: 42 },
        })
    })

    it('omits body and data when not provided', async () => {
        const { notify: osNotify } = await import('@tinycld/core/lib/notifications')
        await osChannel.dispatch({
            event: 'import.complete',
            title: 'Just a title',
            variant: 'success',
        })
        expect(osNotify).toHaveBeenCalledWith({
            title: 'Just a title',
            body: undefined,
            data: undefined,
        })
    })

    it('reports its channel name', () => {
        expect(osChannel.name).toBe('os')
    })
})
