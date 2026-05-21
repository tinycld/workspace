import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    publishUiMessage,
    resetUiMessageBus,
    subscribeUiMessage,
} from '../tinycld/text/lib/anchored-overlay/ui-message-bus'

// ui-message-bus is the fan-out point between the native useDocumentEditor's
// onUiMessage callback and the various host-side subscribers
// (AnchoredOverlayController today; future comment/mention popovers
// will tap the same bus). The tests pin three behaviors:
//
//   1. Subscribe + publish delivers the message to every handler that
//      was subscribed at publish time.
//   2. Unsubscribe (the function returned by subscribe) removes only
//      that handler — other subscribers continue to receive events.
//   3. resetUiMessageBus drops every handler. Used by other test files
//      to keep their suites independent.

beforeEach(() => {
    resetUiMessageBus()
})

describe('publishUiMessage + subscribeUiMessage', () => {
    it('delivers a published message to a subscribed handler', () => {
        const handler = vi.fn()
        subscribeUiMessage(handler)
        publishUiMessage({ namespace: 'ui', type: 'show-popover', payload: { kind: 'demo' } })
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith({
            namespace: 'ui',
            type: 'show-popover',
            payload: { kind: 'demo' },
        })
    })

    it('delivers the same message to every current subscriber', () => {
        const a = vi.fn()
        const b = vi.fn()
        const c = vi.fn()
        subscribeUiMessage(a)
        subscribeUiMessage(b)
        subscribeUiMessage(c)
        publishUiMessage({ namespace: 'ui', type: 'popover-update', payload: { n: 1 } })
        expect(a).toHaveBeenCalledTimes(1)
        expect(b).toHaveBeenCalledTimes(1)
        expect(c).toHaveBeenCalledTimes(1)
    })

    it('stops delivering to a handler after its unsubscribe is invoked', () => {
        const a = vi.fn()
        const b = vi.fn()
        const unsubA = subscribeUiMessage(a)
        subscribeUiMessage(b)
        publishUiMessage({ namespace: 'ui', type: 'event-1', payload: null })
        unsubA()
        publishUiMessage({ namespace: 'ui', type: 'event-2', payload: null })
        expect(a).toHaveBeenCalledTimes(1)
        expect(b).toHaveBeenCalledTimes(2)
    })

    it('keeps delivering to other subscribers when one handler throws', () => {
        const thrower = vi.fn(() => {
            throw new Error('boom')
        })
        const survivor = vi.fn()
        subscribeUiMessage(thrower)
        subscribeUiMessage(survivor)
        // The bus re-raises the thrown error so an upstream error
        // boundary can still see it, but the survivor must still
        // receive the event.
        expect(() => {
            publishUiMessage({ namespace: 'ui', type: 'x', payload: null })
        }).toThrowError('boom')
        expect(survivor).toHaveBeenCalledTimes(1)
    })

    it('resetUiMessageBus drops every subscriber', () => {
        const a = vi.fn()
        const b = vi.fn()
        subscribeUiMessage(a)
        subscribeUiMessage(b)
        resetUiMessageBus()
        publishUiMessage({ namespace: 'ui', type: 'after-reset', payload: null })
        expect(a).not.toHaveBeenCalled()
        expect(b).not.toHaveBeenCalled()
    })

    it('is idempotent against double-unsubscribe', () => {
        const handler = vi.fn()
        const unsub = subscribeUiMessage(handler)
        unsub()
        // A second unsubscribe is a no-op rather than throwing — the
        // controller's effect cleanup might fire after a manual reset.
        expect(() => unsub()).not.toThrow()
        publishUiMessage({ namespace: 'ui', type: 'x', payload: null })
        expect(handler).not.toHaveBeenCalled()
    })
})
