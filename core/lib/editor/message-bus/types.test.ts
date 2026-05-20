import { describe, expect, it } from 'vitest'
import { type EditorMessage, isMessageNamespace, makeMessage } from './types'

describe('makeMessage', () => {
    it('builds a message without requestId by default', () => {
        const m = makeMessage('app', 'init', { token: 'abc' })
        expect(m).toEqual({ namespace: 'app', type: 'init', payload: { token: 'abc' } })
        expect('requestId' in m).toBe(false)
    })

    it('includes requestId when provided', () => {
        const m = makeMessage('core', 'GetJSON', undefined, 'req-1')
        expect(m.requestId).toBe('req-1')
    })

    it('round-trips through JSON.stringify / JSON.parse', () => {
        const m = makeMessage('awareness', 'cursor', { from: 3, to: 5 })
        const parsed = JSON.parse(JSON.stringify(m)) as EditorMessage<{
            from: number
            to: number
        }>
        expect(parsed.namespace).toBe('awareness')
        expect(parsed.type).toBe('cursor')
        expect(parsed.payload).toEqual({ from: 3, to: 5 })
    })

    it("builds a 'ui' namespace message with selection-changed type", () => {
        const m = makeMessage('ui', 'selection-changed', { kind: 'none' })
        expect(m).toEqual({
            namespace: 'ui',
            type: 'selection-changed',
            payload: { kind: 'none' },
        })
    })

    it("builds a 'ui' show-popover message with a requestId for response correlation", () => {
        const payload = {
            kind: 'slash-menu',
            rect: { top: 200, left: 50, width: 8, height: 18, scrollX: 0, scrollY: 0 },
            payload: { items: [], query: '', selectedIndex: 0 },
        }
        const m = makeMessage('ui', 'show-popover', payload, 'req-1')
        expect(m).toEqual({
            namespace: 'ui',
            type: 'show-popover',
            requestId: 'req-1',
            payload,
        })
    })

    it("builds a 'ui' popover-result message that echoes the request id", () => {
        const m = makeMessage(
            'ui',
            'popover-result',
            { action: 'select', payload: { commandId: 'heading-1' } },
            'req-1'
        )
        expect(m.namespace).toBe('ui')
        expect(m.type).toBe('popover-result')
        expect(m.requestId).toBe('req-1')
        expect(m.payload).toEqual({ action: 'select', payload: { commandId: 'heading-1' } })
    })

    it("builds a 'ui' popover-update message preserving the request id", () => {
        const m = makeMessage(
            'ui',
            'popover-update',
            { items: [], query: 'he', selectedIndex: 1 },
            'req-1'
        )
        expect(m.requestId).toBe('req-1')
        expect(m.type).toBe('popover-update')
    })

    it("builds a 'ui' popover-exited message (WebView -> host)", () => {
        const m = makeMessage('ui', 'popover-exited', null, 'req-1')
        expect(m.namespace).toBe('ui')
        expect(m.type).toBe('popover-exited')
        expect(m.requestId).toBe('req-1')
        expect(m.payload).toBeNull()
    })

    it("builds a 'ui' popover-dismissed message (host -> WebView, reserved)", () => {
        // popover-dismissed is reserved for future host-initiated
        // dismissals; today the WebView learns of dismissals via the
        // 'dismiss' action on popover-result. The makeMessage shape
        // still needs to compose so the protocol stays uniform.
        const m = makeMessage('ui', 'popover-dismissed', null, 'req-1')
        expect(m.namespace).toBe('ui')
        expect(m.type).toBe('popover-dismissed')
        expect(m.requestId).toBe('req-1')
        expect(m.payload).toBeNull()
    })

    it("builds a 'comment' focus-request message with payload + requestId", () => {
        // text's native commentBridge.focusComment posts this to ask
        // the WebView to scroll a marked range into view. The WebView
        // echoes the requestId in its focus-response so the host
        // can correlate.
        const m = makeMessage('comment', 'focus-request', { commentId: 'c1' }, 'req-7')
        expect(m).toEqual({
            namespace: 'comment',
            type: 'focus-request',
            requestId: 'req-7',
            payload: { commentId: 'c1' },
        })
    })

    it("builds a 'comment' focus-response message echoing the requestId", () => {
        const m = makeMessage('comment', 'focus-response', { found: true }, 'req-7')
        expect(m).toEqual({
            namespace: 'comment',
            type: 'focus-response',
            requestId: 'req-7',
            payload: { found: true },
        })
    })

    it("builds a 'comment' add-with-range message bundling the range payload", () => {
        // The atomic "set selection + add mark" wire type that avoids
        // the race where the user could move the cursor between two
        // separate posts.
        const m = makeMessage('comment', 'add-with-range', {
            commentId: 'c1',
            range: { from: 3, to: 10 },
        })
        expect(m).toEqual({
            namespace: 'comment',
            type: 'add-with-range',
            payload: { commentId: 'c1', range: { from: 3, to: 10 } },
        })
    })

    it("builds a 'find-replace' set-query message (host -> WebView)", () => {
        // Drives the in-WebView find/replace plugin to update its query
        // string. The WebView responds asynchronously by broadcasting a
        // state-update once the plugin's apply() reduces the new query
        // through collectMatches.
        const m = makeMessage('find-replace', 'set-query', { query: 'foo' })
        expect(m).toEqual({
            namespace: 'find-replace',
            type: 'set-query',
            payload: { query: 'foo' },
        })
    })

    it("builds a 'find-replace' clear message", () => {
        const m = makeMessage('find-replace', 'clear', null)
        expect(m).toEqual({ namespace: 'find-replace', type: 'clear', payload: null })
    })

    it("builds 'find-replace' next / prev messages", () => {
        const next = makeMessage('find-replace', 'next', null)
        const prev = makeMessage('find-replace', 'prev', null)
        expect(next.type).toBe('next')
        expect(prev.type).toBe('prev')
        expect(next.payload).toBeNull()
        expect(prev.payload).toBeNull()
    })

    it("builds 'find-replace' replace-current and replace-all messages with the replacement string", () => {
        const one = makeMessage('find-replace', 'replace-current', { replacement: 'bar' })
        const all = makeMessage('find-replace', 'replace-all', { replacement: 'bar' })
        expect(one.payload).toEqual({ replacement: 'bar' })
        expect(all.payload).toEqual({ replacement: 'bar' })
    })

    it("builds a 'find-replace' state-update broadcast (WebView -> host)", () => {
        // The WebView posts this on every transaction whose effect on
        // the plugin state differs from the prior post. The host's bar
        // reads it from a mirrored Zustand store to render match counts.
        const m = makeMessage('find-replace', 'state-update', {
            matchCount: 3,
            currentIndex: 1,
            query: 'foo',
        })
        expect(m).toEqual({
            namespace: 'find-replace',
            type: 'state-update',
            payload: { matchCount: 3, currentIndex: 1, query: 'foo' },
        })
    })
})

describe('isMessageNamespace', () => {
    it('narrows to a specific namespace and returns true for matches', () => {
        const m: EditorMessage = makeMessage('app', 'init', null)
        if (isMessageNamespace(m, 'app')) {
            const _check: 'app' = m.namespace
            expect(_check).toBe('app')
        } else {
            throw new Error('expected app namespace')
        }
    })

    it('returns false for mismatched namespaces', () => {
        const m: EditorMessage = makeMessage('core', 'StateUpdate', {})
        expect(isMessageNamespace(m, 'app')).toBe(false)
    })
})
