import { bellChannel } from '@tinycld/core/lib/notify/channels/bell'
import { clearNotifyContext, setNotifyContext } from '@tinycld/core/lib/notify/context'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    notificationsCollection: {
        insert: vi.fn(() => ({ isPersisted: { promise: Promise.resolve() } })),
    },
}))

describe('BellChannel', () => {
    beforeEach(() => {
        clearNotifyContext()
    })

    afterEach(() => {
        vi.clearAllMocks()
        clearNotifyContext()
    })

    it('inserts a notification row with resolved context and input fields', async () => {
        setNotifyContext({ orgId: 'o1', userId: 'u1' })

        await bellChannel.dispatch({
            event: 'import.complete',
            title: 'Import done',
            body: '42 contacts',
            url: '/a/acme/contacts',
            data: { source: 'google-takeout', count: 42 },
            variant: 'success',
        })

        const { notificationsCollection } = await import('@tinycld/core/lib/pocketbase')
        const insertMock = notificationsCollection.insert as unknown as ReturnType<typeof vi.fn>
        expect(insertMock).toHaveBeenCalledTimes(1)
        const arg = insertMock.mock.calls[0][0]
        expect(arg).toMatchObject({
            user: 'u1',
            org: 'o1',
            type: 'import.complete',
            title: 'Import done',
            body: '42 contacts',
            url: '/a/acme/contacts',
            metadata: { source: 'google-takeout', count: 42 },
            read: false,
            dismissed: false,
        })
        expect(typeof arg.id).toBe('string')
    })

    it('no-ops and does not throw when context is missing', async () => {
        await expect(
            bellChannel.dispatch({
                event: 'import.complete',
                title: 'x',
                variant: 'success',
            })
        ).resolves.toBeUndefined()

        const { notificationsCollection } = await import('@tinycld/core/lib/pocketbase')
        expect(notificationsCollection.insert).not.toHaveBeenCalled()
    })

    it('defaults body, url, and metadata when the input omits them', async () => {
        setNotifyContext({ orgId: 'o1', userId: 'u1' })

        await bellChannel.dispatch({
            event: 'import.complete',
            title: 'Import done',
            variant: 'success',
        })

        const { notificationsCollection } = await import('@tinycld/core/lib/pocketbase')
        const insertMock = notificationsCollection.insert as unknown as ReturnType<typeof vi.fn>
        const arg = insertMock.mock.calls[0][0]
        expect(arg).toMatchObject({ body: '', url: '', metadata: {} })
    })

    it('reports its channel name', () => {
        expect(bellChannel.name).toBe('bell')
    })
})
