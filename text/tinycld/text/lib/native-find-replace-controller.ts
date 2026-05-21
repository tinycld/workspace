import { type EditorMessage, makeMessage } from '@tinycld/core/lib/editor/message-bus/types'
import type { FindReplaceController } from './find-replace-controller'
import { useFindReplaceStateStore } from './stores/find-replace-state-store'

// Native FindReplaceController. Reads observable state from the
// mirror store (use-document-editor.native.tsx populates the store
// from WebView 'find-replace.state-update' broadcasts) and posts
// commands across the WebView via the supplied postMessage. The
// poster returns true on a successful send, false when the WebView
// isn't mounted yet; this controller fires-and-forgets either way —
// commands are idempotent on the WebView side (set-query is just a
// transaction meta, next/prev no-op when there are no matches, etc.)
// so a dropped message during mount just means the next user action
// resends.
type PostMessage = (message: EditorMessage) => boolean

export function makeNativeFindReplaceController(
    postMessage: PostMessage
): FindReplaceController {
    return {
        getState: () => {
            const s = useFindReplaceStateStore.getState()
            return { matchCount: s.matchCount, currentIndex: s.currentIndex, query: s.query }
        },
        setQuery: query => {
            postMessage(makeMessage('find-replace', 'set-query', { query }))
        },
        clear: () => {
            postMessage(makeMessage('find-replace', 'clear', null))
        },
        next: () => {
            postMessage(makeMessage('find-replace', 'next', null))
        },
        prev: () => {
            postMessage(makeMessage('find-replace', 'prev', null))
        },
        replaceCurrent: replacement => {
            postMessage(makeMessage('find-replace', 'replace-current', { replacement }))
        },
        replaceAll: replacement => {
            postMessage(makeMessage('find-replace', 'replace-all', { replacement }))
        },
    }
}

// Dispatch a single WebView -> host find-replace message into the
// state-mirror store. The native hook's onFindReplaceMessage closure
// is a thin wrapper around this; extracted for direct testing.
//
// The single host caller (use-document-editor.native.tsx) already
// pre-filters by namespace, but the function is exported and
// unit-tested standalone so it does its own check in case a future
// caller forgets — defense in depth, costs one string compare.
export function dispatchFindReplaceMessage(message: EditorMessage): void {
    if (message.namespace !== 'find-replace') return
    if (message.type !== 'state-update') return
    const payload = message.payload
    if (payload === null || typeof payload !== 'object') return
    const p = payload as { matchCount?: unknown; currentIndex?: unknown; query?: unknown }
    if (
        typeof p.matchCount !== 'number' ||
        typeof p.currentIndex !== 'number' ||
        typeof p.query !== 'string'
    ) {
        return
    }
    useFindReplaceStateStore
        .getState()
        .setState({ matchCount: p.matchCount, currentIndex: p.currentIndex, query: p.query })
}
