import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    notificationsCollection: {
        insert: vi.fn(() => ({ isPersisted: { promise: Promise.resolve() } })),
    },
}))
vi.mock('@tinycld/core/lib/notifications', () => ({
    notify: vi.fn(() => Promise.resolve()),
}))

describe('handleMutationErrorsWithForm', () => {
    beforeEach(() => {
        useToastStore.setState({ toasts: [] })
    })
    afterEach(() => {
        useToastStore.setState({ toasts: [] })
        vi.restoreAllMocks()
    })

    it('sets field errors when they match form fields', () => {
        const setError = vi.fn()
        const getValues = () => ({ email: '', name: '' })
        const handler = handleMutationErrorsWithForm({ setError, getValues })
        handler({
            response: { data: { data: { email: { code: 'x', message: 'required' } } } },
        })
        expect(setError).toHaveBeenCalledWith(
            'email',
            expect.objectContaining({ message: 'required' })
        )
        expect(useToastStore.getState().toasts).toHaveLength(0)
    })

    it('emits mutation.error for non-validation errors', () => {
        const setError = vi.fn()
        const getValues = () => ({ email: '' })
        const handler = handleMutationErrorsWithForm({
            setError,
            getValues,
            operation: 'save settings',
        })
        handler(new Error('Network unreachable'))
        const toasts = useToastStore.getState().toasts
        expect(toasts).toHaveLength(1)
        expect(toasts[0]).toMatchObject({
            title: 'Something went wrong',
            variant: 'error',
        })
        expect(toasts[0].body).toContain('Network unreachable')
        expect(setError).not.toHaveBeenCalled()
    })

    it('emits mutation.error when validation has fields the form does not know about', () => {
        const setError = vi.fn()
        const getValues = () => ({ email: '' })
        const handler = handleMutationErrorsWithForm({ setError, getValues })
        handler({
            response: {
                data: { data: { unknown_field: { code: 'x', message: 'bad' } } },
            },
        })
        expect(setError).not.toHaveBeenCalled()
        expect(useToastStore.getState().toasts).toHaveLength(1)
    })
})
