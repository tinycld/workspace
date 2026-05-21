import type { EditorMessage } from '@tinycld/core/lib/editor/message-bus/types'

// The rect a show-popover message carries: viewport coords inside the
// WebView + the WebView's scroll snapshot at capture time. Matches
// ImageSelection.rect's contract from Milestone B exactly so future
// 'ui' namespace popovers don't have to invent a second rect shape.
//
// scrollX/scrollY are preserved on the wire even though the controller
// doesn't currently use them — the policy is "dismiss on scroll" so
// the popover never lives long enough to need re-anchoring. They're
// here so a future re-anchor-on-scroll behavior change is wire-
// compatible.
export interface AnchoredOverlayRect {
    top: number
    left: number
    width: number
    height: number
    scrollX: number
    scrollY: number
}

// The request the WebView sends on 'show-popover'. The kind discriminates
// which registry entry renders the body (e.g. 'slash-menu' →
// SlashMenuPopover); the payload is whatever that kind's body needs.
//
// We deliberately leave payload typed as `unknown` here — the controller
// only routes it; the body component asserts a concrete shape at the
// render boundary. Erasing the type here keeps the state-machine pure
// and decoupled from any specific overlay kind.
export interface AnchoredOverlayRequest {
    kind: string
    requestId: string
    rect: AnchoredOverlayRect
    payload: unknown
}

// The state the controller renders against. open=null means no
// popover; open=non-null means the controller has accepted a
// show-popover and is awaiting a select/dismiss. The payload field
// is kept separate so popover-update messages can replace it without
// disturbing the kind/requestId/rect that opened the popover.
export interface AnchoredOverlayState {
    open: AnchoredOverlayRequest | null
}

// What the host sends back to the WebView. The action drives the
// suggestion plugin's behavior: 'select' applies the chosen entry
// and clears the trigger; 'dismiss' aborts.
export type AnchoredOverlayResponseAction = 'select' | 'dismiss'

// Reducer action types. Pure data — no side effects in the reducer
// itself; effects (postMessage to the WebView) live in the controller's
// react layer. This split keeps the state-machine trivially testable
// in node without booting RN.
export type AnchoredOverlayAction =
    | { type: 'show'; request: AnchoredOverlayRequest }
    | { type: 'update'; requestId: string; payload: unknown }
    | { type: 'respond'; requestId: string }
    | { type: 'dismiss-on-scroll' }
    | { type: 'dismiss-external' }
    | { type: 'webview-exited'; requestId: string }

export const initialAnchoredOverlayState: AnchoredOverlayState = { open: null }

// Pure reducer. The controller dispatches reducer actions in response
// to bus messages and user input; this function describes the legal
// state transitions and nothing else.
export function anchoredOverlayReducer(
    state: AnchoredOverlayState,
    action: AnchoredOverlayAction
): AnchoredOverlayState {
    switch (action.type) {
        case 'show':
            // Opening over an already-open popover is legal — the
            // WebView may send a new show-popover (e.g. a stale one
            // wins the race after a dismiss). The new request wins;
            // the old one's response-loop is just abandoned. The
            // controller's effect layer is responsible for sending a
            // popover-dismissed for the displaced request if the
            // protocol grows to need it.
            return { open: action.request }

        case 'update':
            // Stale updates (requestId mismatch — popover has since
            // closed, or has been replaced) are silently dropped.
            // The state-machine guarantees that a popover-update for
            // a no-longer-open request never modifies state.
            if (!state.open) return state
            if (state.open.requestId !== action.requestId) return state
            return { open: { ...state.open, payload: action.payload } }

        case 'respond':
            // Respond closes the popover IF the requestId matches.
            // Stale responds (controller already moved on, or this is
            // a duplicate) are no-ops.
            if (!state.open) return state
            if (state.open.requestId !== action.requestId) return state
            return { open: null }

        case 'dismiss-on-scroll':
            // Scroll dismisses any open popover without needing a
            // requestId match — the scroll event is package-global,
            // not request-specific.
            if (!state.open) return state
            return { open: null }

        case 'dismiss-external':
            // Backdrop-tap / programmatic dismiss path. Same semantics
            // as dismiss-on-scroll, but a distinct action so the
            // controller's effect layer can post the appropriate
            // popover-result back to the WebView. The reducer treats
            // them identically.
            if (!state.open) return state
            return { open: null }

        case 'webview-exited':
            // popover-exited from the WebView: the in-editor suggestion
            // plugin has wound down on its own (item selected, trigger
            // broken by typing space, Escape pressed). Close the overlay
            // if the requestId still matches; ignore stale exits for a
            // request the host has already moved past. No postMessage
            // needed — the WebView already knows it's done.
            if (!state.open) return state
            if (state.open.requestId !== action.requestId) return state
            return { open: null }
    }
}

// Decode an 'ui' namespace message into an action this state-machine
// understands, or null if the message isn't routable. Lifting the
// decode out of the reducer keeps the action types untouched by wire-
// format details and makes them easy to construct in tests.
export function decodeUiMessage(message: EditorMessage): AnchoredOverlayAction | null {
    if (message.namespace !== 'ui') return null
    if (message.type === 'show-popover') {
        const payload = message.payload
        const requestId = message.requestId
        if (!requestId) return null
        if (payload === null || typeof payload !== 'object') return null
        const p = payload as {
            kind?: unknown
            rect?: unknown
            payload?: unknown
        }
        if (typeof p.kind !== 'string') return null
        if (!isValidRect(p.rect)) return null
        return {
            type: 'show',
            request: {
                kind: p.kind,
                requestId,
                rect: p.rect,
                payload: p.payload ?? null,
            },
        }
    }
    if (message.type === 'popover-update') {
        const requestId = message.requestId
        if (!requestId) return null
        return {
            type: 'update',
            requestId,
            payload: message.payload ?? null,
        }
    }
    if (message.type === 'popover-dismiss-on-scroll') {
        return { type: 'dismiss-on-scroll' }
    }
    if (message.type === 'popover-exited') {
        const requestId = message.requestId
        if (!requestId) return null
        return { type: 'webview-exited', requestId }
    }
    return null
}

// Narrow an unknown wire value into a fully-typed AnchoredOverlayRect.
// Defensive against partial / malformed messages — the WebView side
// constructs these from window.scrollX / getBoundingClientRect so
// numeric fields should always be present, but a single bad message
// shouldn't crash the controller.
function isValidRect(value: unknown): value is AnchoredOverlayRect {
    if (value === null || typeof value !== 'object') return false
    const r = value as Record<string, unknown>
    return (
        typeof r.top === 'number' &&
        typeof r.left === 'number' &&
        typeof r.width === 'number' &&
        typeof r.height === 'number' &&
        typeof r.scrollX === 'number' &&
        typeof r.scrollY === 'number'
    )
}

// Geometry helper used by the React controller — separated here so
// it's pure and trivially testable. Given the rect from the WebView
// (viewport coords + scroll snapshot) and the WebView's screen origin
// from .measure(), plus the viewport dimensions, returns the screen
// (top, left) where the popover should render.
//
// Flips above the caret when the estimated popover height would
// overflow the bottom of the viewport. Mirrors web's SlashMenu.web.tsx
// resolvePosition() heuristic so the two platforms feel the same.
export interface ResolvePositionInput {
    rect: AnchoredOverlayRect
    webViewOriginX: number
    webViewOriginY: number
    viewportWidth: number
    viewportHeight: number
    popoverWidth: number
    popoverHeightEstimate: number
    gap: number
}

export function resolvePopoverPosition(input: ResolvePositionInput): {
    top: number
    left: number
} {
    const {
        rect,
        webViewOriginX,
        webViewOriginY,
        viewportWidth,
        viewportHeight,
        popoverWidth,
        popoverHeightEstimate,
        gap,
    } = input

    // Anchor is the rect's *bottom* on the visible WebView (viewport
    // coords) — add the WebView's screen origin to translate to screen
    // coords. Web's resolvePosition uses bottom directly; here we
    // compute it from top + height because the wire shape preserves
    // only top/left + width/height (no separate bottom field).
    const anchorBottomScreen = webViewOriginY + rect.top + rect.height
    const anchorTopScreen = webViewOriginY + rect.top
    const anchorLeftScreen = webViewOriginX + rect.left

    const wouldOverflowBottom =
        anchorBottomScreen + gap + popoverHeightEstimate > viewportHeight

    const top = wouldOverflowBottom
        ? Math.max(8, anchorTopScreen - gap - popoverHeightEstimate)
        : anchorBottomScreen + gap

    const left = Math.min(
        Math.max(8, anchorLeftScreen),
        Math.max(8, viewportWidth - popoverWidth - 8)
    )

    return { top, left }
}
