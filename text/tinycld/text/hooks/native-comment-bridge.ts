import { type EditorMessage, makeMessage } from '@tinycld/core/lib/editor/message-bus/types'
import { newRecordId } from 'pbtsdb/core'
import type { DocumentCommentBridge } from './use-document-editor'

// Internal bookkeeping for the native bridge: subscriber sets fan out
// tap/removed events to host handlers; pending-request maps correlate
// each round-trip across the WebView message bus.
//
// Pending entries carry both the resolver and a timeout handle. In
// normal operation the WebView replies and we clear the timeout before
// resolving. If the WebView tears down or crashes mid-flight the
// timeout fires, drops the map entry, and resolves the Promise with
// the documented "not found" sentinel — keeping callers from awaiting
// forever and the Map from leaking.
//
// Exposed as a typed interface (not just `unknown`) so tests can poke
// at the same state the bridge does — assert resolver cleanup, drive
// handler invocations, etc. The hook keeps these in refs so they
// survive renders without forcing the WebView to remount.
export interface NativeCommentBridgeState {
    tapHandlers: Set<(commentId: string) => void>
    removedHandlers: Set<(commentIds: string[]) => void>
    selectionPending: Map<
        string,
        {
            resolve: (range: { from: number; to: number } | null) => void
            timeout: ReturnType<typeof setTimeout>
        }
    >
    focusPending: Map<
        string,
        {
            resolve: (found: boolean) => void
            timeout: ReturnType<typeof setTimeout>
        }
    >
}

export function createNativeCommentBridgeState(): NativeCommentBridgeState {
    return {
        tapHandlers: new Set(),
        removedHandlers: new Set(),
        selectionPending: new Map(),
        focusPending: new Map(),
    }
}

// Timeout for the WebView -> host round-trips. Five seconds matches
// the lib/server-address probe timeout (the only other timeout precedent
// in core). The exact value isn't load-bearing — the WebView normally
// answers in milliseconds; this only protects against the WebView being
// torn down before posting its response.
const PENDING_REQUEST_TIMEOUT_MS = 5000

// PostMessage signature matches useWebViewEditor's `postMessage`:
// returns `true` when the WebView received the message, `false` when
// the WebView isn't mounted yet (or the bridge isn't ready). The
// bridge fails closed on `false` so callers can degrade gracefully.
export type PostCommentMessage = (message: EditorMessage) => boolean

// ID generator is injected so unit tests can produce deterministic
// requestIds without monkey-patching pbtsdb.
export interface NativeCommentBridgeOptions {
    state: NativeCommentBridgeState
    postMessage: () => PostCommentMessage | undefined
    generateRequestId?: () => string
}

// Dispatch a single WebView -> host comment-namespace message into the
// state's subscriber sets / pending-request maps. Extracted out of the
// hook for direct testing — the hook's onCommentMessage closure is
// just a thin wrapper that hands `msg` over to this function.
export function dispatchCommentMessage(
    state: NativeCommentBridgeState,
    msg: EditorMessage
): void {
    if (msg.type === 'tap') {
        const { commentId } = (msg.payload ?? {}) as { commentId?: string }
        if (!commentId) return
        for (const handler of state.tapHandlers) handler(commentId)
        return
    }
    if (msg.type === 'removed') {
        const { commentIds } = (msg.payload ?? {}) as { commentIds?: string[] }
        if (!Array.isArray(commentIds) || commentIds.length === 0) return
        for (const handler of state.removedHandlers) handler(commentIds)
        return
    }
    if (msg.type === 'selection-response') {
        const { requestId } = msg
        if (!requestId) return
        const entry = state.selectionPending.get(requestId)
        if (!entry) return
        state.selectionPending.delete(requestId)
        clearTimeout(entry.timeout)
        const payload = (msg.payload ?? {}) as { range?: { from?: number; to?: number } | null }
        const range = payload.range
        if (range && typeof range.from === 'number' && typeof range.to === 'number') {
            entry.resolve({ from: range.from, to: range.to })
        } else {
            entry.resolve(null)
        }
        return
    }
    if (msg.type === 'focus-response') {
        const { requestId } = msg
        if (!requestId) return
        const entry = state.focusPending.get(requestId)
        if (!entry) return
        state.focusPending.delete(requestId)
        clearTimeout(entry.timeout)
        const found = (msg.payload as { found?: boolean })?.found === true
        entry.resolve(found)
        return
    }
}

// Diagnostic helper for inspecting the bridge's in-flight requests.
// Useful for log output in development when investigating why a
// round-trip didn't complete (e.g. a focusComment call that timed out
// versus one that's still pending). Not load-bearing — read-only.
export function getPendingCounts(
    state: NativeCommentBridgeState
): { selectionPending: number; focusPending: number } {
    return {
        selectionPending: state.selectionPending.size,
        focusPending: state.focusPending.size,
    }
}

// Build the host-side DocumentCommentBridge against an injected
// poster + state. The poster is read through a closure (not captured
// once) because useWebViewEditor's postMessage isn't ref-stable —
// the hook plumbs the latest one in via a `() => current` thunk so
// the bridge identity can stay frozen across renders.
export function createNativeCommentBridge(
    options: NativeCommentBridgeOptions
): DocumentCommentBridge {
    const { state, postMessage } = options
    const generateRequestId = options.generateRequestId ?? newRecordId

    return {
        addComment: (commentId, range) => {
            const message = range
                ? makeMessage('comment', 'add-with-range', { commentId, range })
                : makeMessage('comment', 'add', { commentId })
            postMessage()?.(message)
        },
        removeComment: commentId => {
            postMessage()?.(makeMessage('comment', 'remove', { commentId }))
        },
        focusComment: commentId =>
            new Promise<boolean>(resolve => {
                const requestId = generateRequestId()
                // Schedule a timeout that resolves with the documented
                // "not found" sentinel if the WebView never replies
                // (typically because it tore down mid-flight). The
                // resolver-table entry's timeout handle is cleared by
                // dispatchCommentMessage on a successful response.
                const timeout = setTimeout(() => {
                    const entry = state.focusPending.get(requestId)
                    if (!entry) return
                    state.focusPending.delete(requestId)
                    entry.resolve(false)
                }, PENDING_REQUEST_TIMEOUT_MS)
                state.focusPending.set(requestId, { resolve, timeout })
                const poster = postMessage()
                const sent =
                    poster?.(
                        makeMessage('comment', 'focus-request', { commentId }, requestId)
                    ) ?? false
                if (sent !== true) {
                    // WebView not mounted yet — fail closed so the
                    // caller can fall back. Drop the resolver so the
                    // map doesn't accumulate orphans.
                    state.focusPending.delete(requestId)
                    clearTimeout(timeout)
                    resolve(false)
                }
            }),
        getSelection: () =>
            new Promise<{ from: number; to: number } | null>(resolve => {
                const requestId = generateRequestId()
                const timeout = setTimeout(() => {
                    const entry = state.selectionPending.get(requestId)
                    if (!entry) return
                    state.selectionPending.delete(requestId)
                    entry.resolve(null)
                }, PENDING_REQUEST_TIMEOUT_MS)
                state.selectionPending.set(requestId, { resolve, timeout })
                const poster = postMessage()
                const sent =
                    poster?.(makeMessage('comment', 'selection-request', null, requestId)) ??
                    false
                if (sent !== true) {
                    state.selectionPending.delete(requestId)
                    clearTimeout(timeout)
                    resolve(null)
                }
            }),
        onTap: handler => {
            state.tapHandlers.add(handler)
            return () => {
                state.tapHandlers.delete(handler)
            }
        },
        onRemoved: handler => {
            state.removedHandlers.add(handler)
            return () => {
                state.removedHandlers.delete(handler)
            }
        },
    }
}
