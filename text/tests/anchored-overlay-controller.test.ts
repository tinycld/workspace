import { describe, expect, it } from 'vitest'
import {
    type AnchoredOverlayRect,
    anchoredOverlayReducer,
    decodeUiMessage,
    initialAnchoredOverlayState,
    resolvePopoverPosition,
} from '../tinycld/text/lib/anchored-overlay/anchored-overlay-state'

// AnchoredOverlayController is the React layer; its state machine and
// the geometry helper are pure modules we can exercise in node without
// booting RN. The controller's render path is exercised by the
// SlashMenu Playwright suite; here we lock the protocol semantics:
//
//   - decodeUiMessage maps wire shapes to reducer actions (or rejects
//     malformed ones).
//   - the reducer's state transitions are sane against the protocol
//     (show → respond closes; popover-update updates payload only;
//     stale messages are ignored; dismiss-on-scroll closes any open
//     popover).
//   - resolvePopoverPosition produces the right anchor in normal +
//     bottom-overflow cases.

function makeRect(over: Partial<AnchoredOverlayRect> = {}): AnchoredOverlayRect {
    return { top: 100, left: 50, width: 8, height: 18, scrollX: 0, scrollY: 0, ...over }
}

describe('decodeUiMessage', () => {
    it('returns null for non-ui namespaces', () => {
        expect(
            decodeUiMessage({ namespace: 'app', type: 'init', payload: null })
        ).toBeNull()
    })

    it('returns null for unknown ui types', () => {
        expect(
            decodeUiMessage({ namespace: 'ui', type: 'random', payload: null })
        ).toBeNull()
    })

    it('rejects show-popover without a requestId', () => {
        expect(
            decodeUiMessage({
                namespace: 'ui',
                type: 'show-popover',
                payload: { kind: 'demo', rect: makeRect(), payload: {} },
            })
        ).toBeNull()
    })

    it('rejects show-popover with a non-object payload', () => {
        expect(
            decodeUiMessage({
                namespace: 'ui',
                type: 'show-popover',
                requestId: 'r1',
                payload: 'oops',
            })
        ).toBeNull()
    })

    it('rejects show-popover with a malformed rect', () => {
        expect(
            decodeUiMessage({
                namespace: 'ui',
                type: 'show-popover',
                requestId: 'r1',
                payload: { kind: 'demo', rect: { top: 'oops' }, payload: {} },
            })
        ).toBeNull()
    })

    it('decodes a valid show-popover into a show action', () => {
        const result = decodeUiMessage({
            namespace: 'ui',
            type: 'show-popover',
            requestId: 'r1',
            payload: {
                kind: 'slash-menu',
                rect: makeRect(),
                payload: { items: [], query: '', selectedIndex: 0 },
            },
        })
        expect(result).toEqual({
            type: 'show',
            request: {
                kind: 'slash-menu',
                requestId: 'r1',
                rect: makeRect(),
                payload: { items: [], query: '', selectedIndex: 0 },
            },
        })
    })

    it('decodes popover-update preserving the request id', () => {
        const result = decodeUiMessage({
            namespace: 'ui',
            type: 'popover-update',
            requestId: 'r1',
            payload: { items: [], query: 'he', selectedIndex: 1 },
        })
        expect(result).toEqual({
            type: 'update',
            requestId: 'r1',
            payload: { items: [], query: 'he', selectedIndex: 1 },
        })
    })

    it('decodes popover-dismiss-on-scroll', () => {
        const result = decodeUiMessage({
            namespace: 'ui',
            type: 'popover-dismiss-on-scroll',
            payload: null,
        })
        expect(result).toEqual({ type: 'dismiss-on-scroll' })
    })

    it('decodes popover-exited into a webview-exited action with the request id', () => {
        const result = decodeUiMessage({
            namespace: 'ui',
            type: 'popover-exited',
            requestId: 'r1',
            payload: null,
        })
        expect(result).toEqual({ type: 'webview-exited', requestId: 'r1' })
    })

    it('rejects popover-exited without a requestId', () => {
        expect(
            decodeUiMessage({
                namespace: 'ui',
                type: 'popover-exited',
                payload: null,
            })
        ).toBeNull()
    })
})

describe('anchoredOverlayReducer', () => {
    const sampleShow = decodeUiMessage({
        namespace: 'ui',
        type: 'show-popover',
        requestId: 'r1',
        payload: {
            kind: 'slash-menu',
            rect: makeRect(),
            payload: { items: [], query: '', selectedIndex: 0 },
        },
    })
    if (!sampleShow) throw new Error('test setup: sample show-popover should decode')

    it('starts closed (open: null)', () => {
        expect(initialAnchoredOverlayState).toEqual({ open: null })
    })

    it('show opens the popover with the request', () => {
        const next = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        expect(next.open).toEqual({
            kind: 'slash-menu',
            requestId: 'r1',
            rect: makeRect(),
            payload: { items: [], query: '', selectedIndex: 0 },
        })
    })

    it('respond closes the popover when requestId matches', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const closed = anchoredOverlayReducer(opened, {
            type: 'respond',
            requestId: 'r1',
        })
        expect(closed.open).toBeNull()
    })

    it('respond is a no-op when requestId does not match (stale select)', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const same = anchoredOverlayReducer(opened, {
            type: 'respond',
            requestId: 'r-stale',
        })
        expect(same).toBe(opened)
        expect(same.open?.requestId).toBe('r1')
    })

    it('respond is a no-op when no popover is open', () => {
        const same = anchoredOverlayReducer(initialAnchoredOverlayState, {
            type: 'respond',
            requestId: 'r1',
        })
        expect(same).toBe(initialAnchoredOverlayState)
    })

    it('update replaces the payload when requestId matches; rect/kind survive', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const updated = anchoredOverlayReducer(opened, {
            type: 'update',
            requestId: 'r1',
            payload: { items: [{ id: 'h1', label: 'Heading 1', iconName: 'Heading1' }], query: 'h', selectedIndex: 0 },
        })
        expect(updated.open?.kind).toBe('slash-menu')
        expect(updated.open?.requestId).toBe('r1')
        expect(updated.open?.rect).toEqual(makeRect())
        expect(updated.open?.payload).toEqual({
            items: [{ id: 'h1', label: 'Heading 1', iconName: 'Heading1' }],
            query: 'h',
            selectedIndex: 0,
        })
    })

    it('update is a no-op when requestId does not match', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const same = anchoredOverlayReducer(opened, {
            type: 'update',
            requestId: 'r-other',
            payload: { items: [{ id: 'x', label: 'x', iconName: 'x' }] },
        })
        expect(same).toBe(opened)
    })

    it('update is a no-op when no popover is open', () => {
        const same = anchoredOverlayReducer(initialAnchoredOverlayState, {
            type: 'update',
            requestId: 'r1',
            payload: { items: [] },
        })
        expect(same).toBe(initialAnchoredOverlayState)
    })

    it('dismiss-on-scroll closes any open popover regardless of requestId', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const closed = anchoredOverlayReducer(opened, { type: 'dismiss-on-scroll' })
        expect(closed.open).toBeNull()
    })

    it('dismiss-external closes any open popover', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const closed = anchoredOverlayReducer(opened, { type: 'dismiss-external' })
        expect(closed.open).toBeNull()
    })

    it('webview-exited closes the popover when requestId matches', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const closed = anchoredOverlayReducer(opened, {
            type: 'webview-exited',
            requestId: 'r1',
        })
        expect(closed.open).toBeNull()
    })

    it('webview-exited is a no-op when requestId does not match', () => {
        // The WebView exited for a request the host has already moved
        // past (e.g. the host opened a new popover via show-popover
        // before the old request's onExit landed). The stale exit
        // must not close the new popover.
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const same = anchoredOverlayReducer(opened, {
            type: 'webview-exited',
            requestId: 'r-stale',
        })
        expect(same).toBe(opened)
    })

    it('webview-exited is a no-op when no popover is open', () => {
        const same = anchoredOverlayReducer(initialAnchoredOverlayState, {
            type: 'webview-exited',
            requestId: 'r1',
        })
        expect(same).toBe(initialAnchoredOverlayState)
    })

    it('opening over an already-open popover replaces it', () => {
        const opened = anchoredOverlayReducer(initialAnchoredOverlayState, sampleShow)
        const newShow = decodeUiMessage({
            namespace: 'ui',
            type: 'show-popover',
            requestId: 'r2',
            payload: {
                kind: 'slash-menu',
                rect: makeRect({ top: 999 }),
                payload: { items: [], query: '', selectedIndex: 0 },
            },
        })
        if (!newShow) throw new Error('test setup: second show should decode')
        const replaced = anchoredOverlayReducer(opened, newShow)
        expect(replaced.open?.requestId).toBe('r2')
        expect(replaced.open?.rect.top).toBe(999)
    })
})

describe('resolvePopoverPosition', () => {
    const baseInput = {
        webViewOriginX: 0,
        webViewOriginY: 100,
        viewportWidth: 400,
        viewportHeight: 800,
        popoverWidth: 260,
        popoverHeightEstimate: 320,
        gap: 4,
    }

    it('anchors below the rect when there is room', () => {
        // rect bottom = top(200) + height(18) = 218 in viewport coords;
        // + webViewOriginY(100) = 318 in screen coords; + gap(4) = 322
        // popoverHeightEstimate(320) means bottom edge would land at
        // 642, well under viewportHeight(800). Anchor below.
        const out = resolvePopoverPosition({
            ...baseInput,
            rect: makeRect({ top: 200, left: 50, height: 18 }),
        })
        expect(out.top).toBe(322)
        expect(out.left).toBe(50)
    })

    it('flips above the rect when the popover would overflow the viewport bottom', () => {
        // rect bottom at screen y=798; +4 gap +320 estimate = 1122,
        // overflows viewportHeight=800. Flip above: top = anchorTop -
        // gap - estimate = (100 + 680) - 4 - 320 = 456.
        const out = resolvePopoverPosition({
            ...baseInput,
            rect: makeRect({ top: 680, left: 50, height: 18 }),
        })
        expect(out.top).toBe(456)
    })

    it('clamps left to keep the popover on screen when the anchor is too far right', () => {
        // viewportWidth=400, popoverWidth=260, so max-allowed left =
        // 400 - 260 - 8 = 132. An anchor at 300 should clamp to 132.
        const out = resolvePopoverPosition({
            ...baseInput,
            rect: makeRect({ top: 200, left: 300, height: 18 }),
        })
        expect(out.left).toBe(132)
    })

    it('clamps left to 8 when the anchor is at the very left edge', () => {
        const out = resolvePopoverPosition({
            ...baseInput,
            rect: makeRect({ top: 200, left: 0, height: 18 }),
        })
        expect(out.left).toBe(8)
    })

    it('uses the WebView origin so a non-zero pageX/pageY shifts the popover', () => {
        // WebView shifted by (50, 200); a rect at viewport (200, 50) →
        // screen anchorTop = 200 + 200 = 400, anchorBottom = 418, +4
        // gap = 422.
        const out = resolvePopoverPosition({
            ...baseInput,
            webViewOriginX: 50,
            webViewOriginY: 200,
            rect: makeRect({ top: 200, left: 50, height: 18 }),
        })
        expect(out.top).toBe(422)
        expect(out.left).toBe(Math.min(Math.max(8, 100), Math.max(8, 400 - 260 - 8))) // 100
    })

    it('walked example from the brief produces expected screen position (pageX=0, pageY=100; rect 200,50 → 50,300)', () => {
        // Brief: "WebView with pageX=0, pageY=100, rect.top=200,
        // rect.left=50 → screen position should be (50, 300)". The
        // brief's example is the screen position of the *anchor*
        // (rect.top), which is what users intuitively expect for "the
        // popover goes here". Our impl anchors below the rect, so the
        // *top edge* of the popover lands at anchorBottomScreen + gap.
        // For an h=18 rect: anchorBottomScreen=318, +4 = 322.
        const out = resolvePopoverPosition({
            ...baseInput,
            webViewOriginX: 0,
            webViewOriginY: 100,
            rect: makeRect({ top: 200, left: 50, height: 18 }),
        })
        // The popover's TOP edge is below the caret rect; the anchor
        // referenced in the brief (50, 300) corresponds to the rect's
        // origin in screen space — which is (pageX + rect.left,
        // pageY + rect.top) = (0+50, 100+200) = (50, 300). Verify the
        // popover sits *just below* that anchor.
        const anchorScreenTop = 100 + 200
        const anchorScreenBottom = anchorScreenTop + 18
        expect(out.top).toBe(anchorScreenBottom + 4)
        expect(out.left).toBe(50)
    })
})
