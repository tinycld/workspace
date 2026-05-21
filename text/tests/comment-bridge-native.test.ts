// Unit tests for the native commentBridge — the host-side surface that
// drives the WebView's 'comment' namespace protocol. The hook itself
// is hard to instrument under vitest (TenTap bridges + WebView root
// pull react-native into the test process), so we exercise the pure
// helpers extracted from the hook:
//
//   createNativeCommentBridgeState — bookkeeping containers
//   dispatchCommentMessage         — incoming WebView -> host fan-out
//   createNativeCommentBridge      — outgoing host -> WebView API
//
// Together these are the full surface of what the hook does on the
// comment side. The hook wires them to the WebView's onMessage and
// to useWebViewEditor's postMessage; everything else is just refs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorMessage } from '@tinycld/core/lib/editor/message-bus/types'
import {
    createNativeCommentBridge,
    createNativeCommentBridgeState,
    dispatchCommentMessage,
    getPendingCounts,
} from '../tinycld/text/hooks/native-comment-bridge'

// --- helpers ----------------------------------------------------------

// Build a posted-message recorder. The bridge's `postMessage()` thunk
// returns the captured posting function so we can assert on what
// messages went over the WebView wire.
function makePoster(returnValue = true) {
    const fn = vi.fn().mockReturnValue(returnValue)
    return { fn, get: () => fn }
}

// Deterministic id generator for assertions about requestId
// round-tripping. The bridge accepts this through its options, so we
// don't have to patch pbtsdb's newRecordId globally.
function idGenerator() {
    let counter = 0
    return () => {
        counter += 1
        return `req-${counter}`
    }
}

// --- addComment / removeComment ---------------------------------------

describe('createNativeCommentBridge — outgoing messages', () => {
    it('posts comment.add when addComment is called without a range', () => {
        const poster = makePoster()
        const bridge = createNativeCommentBridge({
            state: createNativeCommentBridgeState(),
            postMessage: poster.get,
        })
        bridge.addComment('c1')
        expect(poster.fn).toHaveBeenCalledTimes(1)
        expect(poster.fn.mock.calls[0][0]).toEqual({
            namespace: 'comment',
            type: 'add',
            payload: { commentId: 'c1' },
        })
    })

    it('posts comment.add-with-range when addComment receives a range', () => {
        // The new-comment flow captures the selection BEFORE opening
        // the modal; by the time the user submits, the editor's
        // selection is gone (modal stole focus). add-with-range is
        // atomic — the WebView handles set-selection-then-add in one
        // message so the user can't move the cursor between two
        // posts.
        const poster = makePoster()
        const bridge = createNativeCommentBridge({
            state: createNativeCommentBridgeState(),
            postMessage: poster.get,
        })
        bridge.addComment('c1', { from: 3, to: 10 })
        expect(poster.fn).toHaveBeenCalledTimes(1)
        expect(poster.fn.mock.calls[0][0]).toEqual({
            namespace: 'comment',
            type: 'add-with-range',
            payload: { commentId: 'c1', range: { from: 3, to: 10 } },
        })
    })

    it('posts comment.remove when removeComment is called', () => {
        const poster = makePoster()
        const bridge = createNativeCommentBridge({
            state: createNativeCommentBridgeState(),
            postMessage: poster.get,
        })
        bridge.removeComment('c1')
        expect(poster.fn).toHaveBeenCalledWith({
            namespace: 'comment',
            type: 'remove',
            payload: { commentId: 'c1' },
        })
    })
})

// --- focusComment round-trip -----------------------------------------

describe('createNativeCommentBridge — focusComment', () => {
    it('posts focus-request and resolves the Promise when WebView replies found=true', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.focusComment('c1')

        expect(poster.fn).toHaveBeenCalledTimes(1)
        expect(poster.fn.mock.calls[0][0]).toEqual({
            namespace: 'comment',
            type: 'focus-request',
            requestId: 'req-1',
            payload: { commentId: 'c1' },
        })

        // Simulate the WebView responding by dispatching a focus-response.
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'focus-response',
            requestId: 'req-1',
            payload: { found: true },
        })

        const found = await pending
        expect(found).toBe(true)
        // Resolver was cleaned up on resolve — no leak in the pending
        // map after the response lands.
        expect(state.focusPending.size).toBe(0)
    })

    it('resolves false when WebView replies found=false', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.focusComment('c1')
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'focus-response',
            requestId: 'req-1',
            payload: { found: false },
        })
        expect(await pending).toBe(false)
        expect(state.focusPending.size).toBe(0)
    })

    it('resolves false when WebView is not mounted yet', async () => {
        // postMessage returns false when there is no WebView. The
        // bridge fails closed so the caller can fall back to a
        // drawer-only focus rather than awaiting a response that will
        // never come.
        const poster = makePoster(false)
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const result = await bridge.focusComment('c1')
        expect(result).toBe(false)
        expect(state.focusPending.size).toBe(0)
    })

    it('correlates concurrent focusComment calls by requestId', async () => {
        // Two in-flight requests must not stomp on each other — the
        // WebView's response carries the requestId, and only the
        // matching resolver should fire.
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const first = bridge.focusComment('c1')
        const second = bridge.focusComment('c2')

        // Respond to the second one first — the first must remain
        // unresolved until its own response arrives.
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'focus-response',
            requestId: 'req-2',
            payload: { found: true },
        })
        expect(state.focusPending.size).toBe(1)
        expect(await second).toBe(true)

        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'focus-response',
            requestId: 'req-1',
            payload: { found: false },
        })
        expect(state.focusPending.size).toBe(0)
        expect(await first).toBe(false)
    })

    it('ignores focus-response with an unknown requestId', () => {
        // Late arrivals (e.g. after a timeout-style abort) must not
        // throw or fall into a stale resolver. Just no-op.
        const state = createNativeCommentBridgeState()
        expect(() =>
            dispatchCommentMessage(state, {
                namespace: 'comment',
                type: 'focus-response',
                requestId: 'never-sent',
                payload: { found: true },
            })
        ).not.toThrow()
        expect(state.focusPending.size).toBe(0)
    })
})

// --- getSelection round-trip -----------------------------------------

describe('createNativeCommentBridge — getSelection', () => {
    it('posts selection-request and resolves with the returned range', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.getSelection()
        expect(poster.fn).toHaveBeenCalledWith({
            namespace: 'comment',
            type: 'selection-request',
            requestId: 'req-1',
            payload: null,
        })
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'selection-response',
            requestId: 'req-1',
            payload: { range: { from: 4, to: 12 } },
        })
        expect(await pending).toEqual({ from: 4, to: 12 })
        expect(state.selectionPending.size).toBe(0)
    })

    it('resolves null when the WebView returns range=null (empty selection)', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.getSelection()
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'selection-response',
            requestId: 'req-1',
            payload: { range: null },
        })
        expect(await pending).toBeNull()
        expect(state.selectionPending.size).toBe(0)
    })

    it('resolves null when the WebView returns a malformed range', async () => {
        // Defensive: a missing from/to or wrong types must not crash
        // the new-comment flow's `if (!range) return` guard.
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.getSelection()
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'selection-response',
            requestId: 'req-1',
            payload: { range: { from: 'oops' } },
        } as unknown as EditorMessage)
        expect(await pending).toBeNull()
    })

    it('resolves null when the WebView is not mounted yet', async () => {
        const poster = makePoster(false)
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        expect(await bridge.getSelection()).toBeNull()
        expect(state.selectionPending.size).toBe(0)
    })
})

// --- onTap / onRemoved fan-out ---------------------------------------

describe('createNativeCommentBridge — incoming events', () => {
    it('fires every registered tap handler when WebView posts comment.tap', () => {
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: () => undefined,
        })
        const h1 = vi.fn()
        const h2 = vi.fn()
        bridge.onTap(h1)
        bridge.onTap(h2)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'tap',
            payload: { commentId: 'c1' },
        })
        expect(h1).toHaveBeenCalledWith('c1')
        expect(h2).toHaveBeenCalledWith('c1')
    })

    it('does not fire tap handlers when commentId is missing', () => {
        // Defensive: a malformed payload must not throw or invoke
        // handlers with undefined.
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: () => undefined,
        })
        const handler = vi.fn()
        bridge.onTap(handler)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'tap',
            payload: {},
        })
        expect(handler).not.toHaveBeenCalled()
    })

    it('fires removed handlers with the full commentIds array', () => {
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: () => undefined,
        })
        const handler = vi.fn()
        bridge.onRemoved(handler)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'removed',
            payload: { commentIds: ['c1', 'c2'] },
        })
        expect(handler).toHaveBeenCalledWith(['c1', 'c2'])
    })

    it('skips removed dispatch when the commentIds list is empty', () => {
        // Empty arrays would still cause every consumer to re-run an
        // O(n) merge for no change — short-circuit.
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: () => undefined,
        })
        const handler = vi.fn()
        bridge.onRemoved(handler)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'removed',
            payload: { commentIds: [] },
        })
        expect(handler).not.toHaveBeenCalled()
    })

    it('returns an unsubscribe function from onTap', () => {
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: () => undefined,
        })
        const handler = vi.fn()
        const unsubscribe = bridge.onTap(handler)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'tap',
            payload: { commentId: 'c1' },
        })
        expect(handler).toHaveBeenCalledTimes(1)
        unsubscribe()
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'tap',
            payload: { commentId: 'c2' },
        })
        expect(handler).toHaveBeenCalledTimes(1)
        expect(state.tapHandlers.size).toBe(0)
    })

    it('returns an unsubscribe function from onRemoved', () => {
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: () => undefined,
        })
        const handler = vi.fn()
        const unsubscribe = bridge.onRemoved(handler)
        unsubscribe()
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'removed',
            payload: { commentIds: ['c1'] },
        })
        expect(handler).not.toHaveBeenCalled()
        expect(state.removedHandlers.size).toBe(0)
    })
})

// --- ignored message types -------------------------------------------

describe('dispatchCommentMessage — ignored types', () => {
    it('ignores unknown message types without throwing', () => {
        const state = createNativeCommentBridgeState()
        expect(() =>
            dispatchCommentMessage(state, {
                namespace: 'comment',
                type: 'never-heard-of-this-one',
                payload: { surprise: true },
            })
        ).not.toThrow()
    })

    it('ignores selection-response without a requestId', () => {
        const state = createNativeCommentBridgeState()
        expect(() =>
            dispatchCommentMessage(state, {
                namespace: 'comment',
                type: 'selection-response',
                payload: { range: null },
            })
        ).not.toThrow()
    })
})

// --- pending-request timeouts ----------------------------------------

describe('createNativeCommentBridge — pending-request timeouts', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('resolves focusComment with false after 5s if the WebView never replies', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.focusComment('c1')
        // Entry is in the map immediately, before the timer fires.
        expect(state.focusPending.size).toBe(1)
        vi.advanceTimersByTime(5000)
        const result = await pending
        expect(result).toBe(false)
        // Map is cleaned up — no leak after the timer fires.
        expect(state.focusPending.size).toBe(0)
    })

    it('resolves getSelection with null after 5s if the WebView never replies', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.getSelection()
        expect(state.selectionPending.size).toBe(1)
        vi.advanceTimersByTime(5000)
        expect(await pending).toBeNull()
        expect(state.selectionPending.size).toBe(0)
    })

    it('cancels the timeout when focus-response arrives in time (no double-fire)', async () => {
        // The response handler clears the timeout before resolving. If
        // the timeout still fires after the response, calling delete()
        // on an already-removed key is a no-op (Map.delete returns
        // false), and clearTimeout() on a fired-and-cleaned-up timer
        // is also a no-op — so the assertion is just "no extra
        // resolutions, no exceptions thrown".
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.focusComment('c1')
        // Response arrives in 1s — well before the 5s timeout.
        vi.advanceTimersByTime(1000)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'focus-response',
            requestId: 'req-1',
            payload: { found: true },
        })
        expect(await pending).toBe(true)
        // Push past the 5s mark — the cancelled timer must NOT
        // re-resolve or throw.
        vi.advanceTimersByTime(10_000)
        expect(state.focusPending.size).toBe(0)
    })

    it('cancels the timeout when selection-response arrives in time', async () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const pending = bridge.getSelection()
        vi.advanceTimersByTime(2000)
        dispatchCommentMessage(state, {
            namespace: 'comment',
            type: 'selection-response',
            requestId: 'req-1',
            payload: { range: { from: 3, to: 7 } },
        })
        expect(await pending).toEqual({ from: 3, to: 7 })
        vi.advanceTimersByTime(10_000)
        expect(state.selectionPending.size).toBe(0)
    })

    it('cancels the timeout when WebView reports postMessage failed (fail-closed path)', async () => {
        // postMessage returns false (no WebView) — bridge resolves
        // false immediately AND clears the timer so a fake-timer
        // advance later doesn't leak through.
        const poster = makePoster(false)
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        const result = await bridge.focusComment('c1')
        expect(result).toBe(false)
        // No pending entry left over, and advancing time mustn't crash.
        expect(state.focusPending.size).toBe(0)
        vi.advanceTimersByTime(10_000)
        expect(state.focusPending.size).toBe(0)
    })
})

// --- getPendingCounts diagnostic --------------------------------------

describe('getPendingCounts', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('reports zero counts on a fresh state', () => {
        const state = createNativeCommentBridgeState()
        expect(getPendingCounts(state)).toEqual({ selectionPending: 0, focusPending: 0 })
    })

    it('reports the live size of each pending map', () => {
        const poster = makePoster()
        const state = createNativeCommentBridgeState()
        const bridge = createNativeCommentBridge({
            state,
            postMessage: poster.get,
            generateRequestId: idGenerator(),
        })
        void bridge.focusComment('c1')
        void bridge.focusComment('c2')
        void bridge.getSelection()
        expect(getPendingCounts(state)).toEqual({ selectionPending: 1, focusPending: 2 })
    })
})
