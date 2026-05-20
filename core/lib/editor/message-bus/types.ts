// Cross-WebView message protocol used by any editor hook backed by
// TenTap's customSource pattern. TenTap's built-in messages keep their
// existing shape under namespaces 'core' and 'format' so TenTap's
// useBridgeState and built-in bridges continue to work unmodified.
// Additional namespaces are reserved for app-specific concerns:
//
//   'app'           - package-specific init/lifecycle (init payload, etc.)
//   'awareness'     - Yjs Awareness cursor/presence reporting
//   'comment'       - comment threads (reserved for v1.1; protected from
//                     future collision now)
//   'core'          - TenTap's CoreMessages (StateUpdate, EditorReady, etc.)
//   'find-replace'  - in-WebView find/replace plugin command + state
//                     channel (used by the text package's FindReplaceBar
//                     on native).
//   'format'        - TenTap's per-bridge format commands (ToggleBold, etc.)
//   'ui'            - the in-WebView editor asks the host to mediate UI
//                     (e.g. show a bottom sheet anchored to the selected
//                     image; an anchored popover for the slash menu).
//
// Adding a new namespace requires updating this file's union. Adding
// a new message type within an existing namespace is non-breaking.
//
// 'ui' namespace message types:
//
//   selection-changed  (WebView -> host, no response)
//     payload: { kind: 'image' | 'none', image?: ImageSelection }
//     Already in use since Milestone B.
//
//   show-popover  (WebView -> host, request)
//     payload: { kind: 'slash-menu' | string, rect, payload }
//       rect: { top, left, width, height, scrollX, scrollY } in viewport
//         coords + WebView scroll snapshot (matches ImageSelection.rect
//         contract from Milestone B).
//       payload: kind-specific data. For 'slash-menu': { items, query,
//         selectedIndex }.
//     The host renders an anchored overlay and answers via popover-result
//     keyed on requestId. Without requestId the message is malformed.
//
//   popover-result  (host -> WebView, response)
//     requestId echoes the show-popover's requestId.
//     payload: { action: 'select' | 'dismiss', payload?: kind-specific }
//       For 'slash-menu' select: payload is { commandId: string }.
//
//   popover-update  (WebView -> host, no response)
//     Updates the visible overlay's payload (e.g. items as the user types
//     more after the trigger). requestId of the original show-popover.
//     payload: same shape as show-popover.payload minus the kind+rect.
//     If the host has dismissed the popover, this is a no-op.
//
//   popover-exited  (WebView -> host, no response)
//     The WebView's suggestion plugin (or whatever drove the show-popover)
//     has exited on its own — user typed a space that broke the trigger,
//     selected an item, pressed Escape, etc. The host closes any overlay
//     still open for this requestId. If the host already dismissed
//     (backdrop tap), the message is a no-op.
//
//   popover-dismissed  (host -> WebView, no response)
//     Reserved for future use: a host that wants to programmatically
//     dismiss an overlay the WebView didn't initiate the close on (e.g.
//     navigation away, an external trigger). The host posts this so the
//     WebView can clean up its own suggestion-plugin state.
//     Currently unused — the WebView learns of dismissals via
//     popover-result with action='dismiss' instead. Kept here so adding
//     a host-initiated dismissal later doesn't reshuffle the protocol.
//
// 'find-replace' namespace message types:
//
//   host → WebView (no response):
//     set-query         payload: { query: string }
//     clear             payload: null
//     next              payload: null
//     prev              payload: null
//     replace-current   payload: { replacement: string }
//     replace-all       payload: { replacement: string }
//
//   WebView → host (broadcast on every plugin-state change):
//     state-update      payload: { matchCount: number,
//                                   currentIndex: number,
//                                   query: string }
//     The WebView posts this on every transaction whose effect on the
//     find-replace plugin state differs from the prior post (identity
//     skip via serialized payload comparison). The host's bar reads the
//     mirrored state from a Zustand store to render match counts and
//     dispatch commands through useWebViewEditor.postMessage.

export type EditorMessageNamespace =
    | 'app'
    | 'awareness'
    | 'comment'
    | 'core'
    | 'find-replace'
    | 'format'
    | 'ui'

export interface EditorMessage<TPayload = unknown> {
    namespace: EditorMessageNamespace
    type: string
    // Present iff this is a request expecting a response. Receiver
    // echoes the requestId in its response so the requester can
    // correlate.
    requestId?: string
    payload: TPayload
}

// Helpful constructor - most call sites won't bother with requestId.
export function makeMessage<T>(
    namespace: EditorMessageNamespace,
    type: string,
    payload: T,
    requestId?: string
): EditorMessage<T> {
    return requestId !== undefined
        ? { namespace, type, payload, requestId }
        : { namespace, type, payload }
}

// Discriminant guard for narrowing in handlers.
export function isMessageNamespace<N extends EditorMessageNamespace>(
    message: EditorMessage,
    namespace: N
): message is EditorMessage & { namespace: N } {
    return message.namespace === namespace
}
