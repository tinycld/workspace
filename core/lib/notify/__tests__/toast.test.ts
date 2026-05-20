import { toastChannel } from '@tinycld/core/lib/notify/channels/toast'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('ToastChannel', () => {
    beforeEach(() => {
        useToastStore.setState({ toasts: [] })
    })

    afterEach(() => {
        useToastStore.setState({ toasts: [] })
    })

    it('inserts a toast with the correct variant, title, and body', () => {
        toastChannel.dispatch({
            event: 'mail.send_failed',
            title: 'Send failed',
            body: 'network timeout',
            variant: 'error',
        })
        const toasts = useToastStore.getState().toasts
        expect(toasts).toHaveLength(1)
        expect(toasts[0]).toMatchObject({
            title: 'Send failed',
            body: 'network timeout',
            variant: 'error',
        })
    })

    it('omits body when not provided', () => {
        toastChannel.dispatch({
            event: 'mail.send_failed',
            title: 'No body',
            variant: 'error',
        })
        const toasts = useToastStore.getState().toasts
        expect(toasts[0].title).toBe('No body')
        expect(toasts[0].body).toBeUndefined()
    })

    it('uses the default 4s duration when no override is provided', () => {
        toastChannel.dispatch({
            event: 'mail.send_failed',
            title: 'Default',
            variant: 'error',
        })
        expect(useToastStore.getState().toasts[0].duration).toBe(4000)
    })

    it('respects a durationMs override', () => {
        toastChannel.dispatch({
            event: 'mail.send_blocked_warn',
            title: 'Long read',
            variant: 'warning',
            durationMs: 8000,
        })
        expect(useToastStore.getState().toasts[0].duration).toBe(8000)
    })

    it('reports its channel name', () => {
        expect(toastChannel.name).toBe('toast')
    })
})
