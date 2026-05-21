// Unit tests for the host-side native FindReplaceController. The
// controller is the surface the bar consumes — getState() reads the
// mirror store, commands post messages to the WebView. We exercise:
//   - every command produces the right namespace+type+payload
//   - getState reads from the store
//   - dispatchFindReplaceMessage routes state-update into the store

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    dispatchFindReplaceMessage,
    makeNativeFindReplaceController,
} from '../tinycld/text/lib/native-find-replace-controller'
import { useFindReplaceStateStore } from '../tinycld/text/lib/stores/find-replace-state-store'

function resetStore() {
    useFindReplaceStateStore.setState({ matchCount: 0, currentIndex: 0, query: '' })
}

beforeEach(() => resetStore())

// --- outgoing commands -----------------------------------------------

describe('makeNativeFindReplaceController — outgoing messages', () => {
    it('setQuery posts find-replace.set-query with the query string', () => {
        const post = vi.fn().mockReturnValue(true)
        const c = makeNativeFindReplaceController(post)
        c.setQuery('foo')
        expect(post).toHaveBeenCalledWith({
            namespace: 'find-replace',
            type: 'set-query',
            payload: { query: 'foo' },
        })
    })

    it('clear posts find-replace.clear with null payload', () => {
        const post = vi.fn().mockReturnValue(true)
        const c = makeNativeFindReplaceController(post)
        c.clear()
        expect(post).toHaveBeenCalledWith({
            namespace: 'find-replace',
            type: 'clear',
            payload: null,
        })
    })

    it('next posts find-replace.next with null payload', () => {
        const post = vi.fn().mockReturnValue(true)
        const c = makeNativeFindReplaceController(post)
        c.next()
        expect(post).toHaveBeenCalledWith({
            namespace: 'find-replace',
            type: 'next',
            payload: null,
        })
    })

    it('prev posts find-replace.prev with null payload', () => {
        const post = vi.fn().mockReturnValue(true)
        const c = makeNativeFindReplaceController(post)
        c.prev()
        expect(post).toHaveBeenCalledWith({
            namespace: 'find-replace',
            type: 'prev',
            payload: null,
        })
    })

    it('replaceCurrent posts find-replace.replace-current with the replacement', () => {
        const post = vi.fn().mockReturnValue(true)
        const c = makeNativeFindReplaceController(post)
        c.replaceCurrent('bar')
        expect(post).toHaveBeenCalledWith({
            namespace: 'find-replace',
            type: 'replace-current',
            payload: { replacement: 'bar' },
        })
    })

    it('replaceAll posts find-replace.replace-all with the replacement', () => {
        const post = vi.fn().mockReturnValue(true)
        const c = makeNativeFindReplaceController(post)
        c.replaceAll('bar')
        expect(post).toHaveBeenCalledWith({
            namespace: 'find-replace',
            type: 'replace-all',
            payload: { replacement: 'bar' },
        })
    })

    it('fires-and-forgets — a falsy post return does not throw', () => {
        // The WebView may not be mounted yet on first render. Commands
        // are idempotent on the WebView side, so the caller doesn't
        // care about the send result.
        const post = vi.fn().mockReturnValue(false)
        const c = makeNativeFindReplaceController(post)
        expect(() => {
            c.setQuery('foo')
            c.next()
            c.replaceAll('x')
        }).not.toThrow()
    })
})

// --- getState reads from the mirror store ----------------------------

describe('makeNativeFindReplaceController — getState', () => {
    it('reads the latest store state on each call', () => {
        const c = makeNativeFindReplaceController(() => true)
        expect(c.getState()).toEqual({ matchCount: 0, currentIndex: 0, query: '' })
        useFindReplaceStateStore.setState({ matchCount: 5, currentIndex: 2, query: 'foo' })
        expect(c.getState()).toEqual({ matchCount: 5, currentIndex: 2, query: 'foo' })
    })
})

// --- dispatchFindReplaceMessage --------------------------------------

describe('dispatchFindReplaceMessage', () => {
    it('routes a state-update message into the store', () => {
        dispatchFindReplaceMessage({
            namespace: 'find-replace',
            type: 'state-update',
            payload: { matchCount: 4, currentIndex: 1, query: 'bar' },
        })
        const s = useFindReplaceStateStore.getState()
        expect(s.matchCount).toBe(4)
        expect(s.currentIndex).toBe(1)
        expect(s.query).toBe('bar')
    })

    it('ignores non-state-update message types', () => {
        useFindReplaceStateStore.setState({ matchCount: 9, currentIndex: 0, query: 'x' })
        dispatchFindReplaceMessage({
            namespace: 'find-replace',
            type: 'set-query',
            payload: { query: 'foo' },
        })
        // No change — the host doesn't ingest its own outbound types.
        const s = useFindReplaceStateStore.getState()
        expect(s.matchCount).toBe(9)
        expect(s.query).toBe('x')
    })

    it('ignores malformed payloads (missing fields, wrong types)', () => {
        useFindReplaceStateStore.setState({ matchCount: 9, currentIndex: 0, query: 'x' })
        dispatchFindReplaceMessage({
            namespace: 'find-replace',
            type: 'state-update',
            payload: {},
        })
        dispatchFindReplaceMessage({
            namespace: 'find-replace',
            type: 'state-update',
            payload: { matchCount: '3', currentIndex: 0, query: 'foo' },
        })
        dispatchFindReplaceMessage({
            namespace: 'find-replace',
            type: 'state-update',
            payload: null,
        })
        const s = useFindReplaceStateStore.getState()
        expect(s.matchCount).toBe(9)
        expect(s.currentIndex).toBe(0)
        expect(s.query).toBe('x')
    })

    it('ignores messages from other namespaces (defensive)', () => {
        // The single host caller already pre-filters by namespace, but
        // the function is exported and unit-tested standalone — it
        // defends against a future caller that forgets the filter.
        useFindReplaceStateStore.setState({ matchCount: 9, currentIndex: 0, query: 'x' })
        dispatchFindReplaceMessage({
            namespace: 'comment',
            type: 'state-update',
            payload: { matchCount: 4, currentIndex: 1, query: 'wrong' },
        })
        dispatchFindReplaceMessage({
            namespace: 'ui',
            type: 'state-update',
            payload: { matchCount: 4, currentIndex: 1, query: 'wrong' },
        })
        const s = useFindReplaceStateStore.getState()
        expect(s.matchCount).toBe(9)
        expect(s.currentIndex).toBe(0)
        expect(s.query).toBe('x')
    })
})
