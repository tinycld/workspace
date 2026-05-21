import type { Editor } from '@tiptap/react'
import {
    clearFind,
    findNext,
    findPrev,
    type FindReplaceEditor,
    findReplacePluginKey,
    replaceAll,
    replaceCurrent,
    setFindQuery,
} from '../../../lib/find-replace-plugin'

// Find/replace bridge for the text WebView. Owns the
// namespace='find-replace' half of the message-bus protocol declared
// in @tinycld/core/lib/editor/message-bus/types.ts:
//
//   host → WebView (no response)
//     set-query           { query }            — drive the plugin's query
//     clear               null                 — drop query + decorations
//     next                null                 — cycle forward
//     prev                null                 — cycle backward
//     replace-current     { replacement }      — replace the active match
//     replace-all         { replacement }      — replace every match
//
//   WebView → host (no response)
//     state-update        { matchCount, currentIndex, query }
//
// The WebView listens to its plugin state and broadcasts state-update
// on every transaction whose effect on (matchCount, currentIndex,
// query) differs from the prior broadcast. The host's
// useFindReplaceStateStore mirrors the payload and the FindReplaceBar
// reads through useFindReplaceControllerState.
//
// An initial broadcast fires immediately after installation so the
// host's mirror is populated even before the first transaction —
// otherwise the bar would render '0/0' for a frame after open.

type PostToNative = (message: unknown) => void

export interface FindReplaceBridge {
    destroy: () => void
}

export function installFindReplaceBridge(
    editor: Editor,
    postToNative: PostToNative
): FindReplaceBridge {
    // The find-replace-plugin helpers expect a FindReplaceEditor shape
    // ({ state, dispatch }), but a Tiptap Editor exposes dispatch as
    // `editor.view.dispatch`. Adapt with a small wrapper that reads
    // state lazily so each helper sees the latest transaction state.
    const findReplaceEditor: FindReplaceEditor = {
        get state() {
            return editor.state
        },
        dispatch: tr => {
            editor.view.dispatch(tr)
        },
    }

    let lastSerialized = ''

    function broadcast(): void {
        const s = findReplacePluginKey.getState(editor.state)
        if (!s) return
        const payload = {
            matchCount: s.matches.length,
            currentIndex: s.currentIndex,
            query: s.query,
        }
        const serialized = JSON.stringify(payload)
        if (serialized === lastSerialized) return
        lastSerialized = serialized
        postToNative({ namespace: 'find-replace', type: 'state-update', payload })
    }

    function onTransaction(): void {
        broadcast()
    }

    function onMessage(evt: MessageEvent): void {
        if (typeof evt.data !== 'string') return
        let parsed: { namespace?: string; type?: string; payload?: unknown }
        try {
            parsed = JSON.parse(evt.data) as {
                namespace?: string
                type?: string
                payload?: unknown
            }
        } catch {
            return
        }
        if (parsed.namespace !== 'find-replace' || !parsed.type) return
        switch (parsed.type) {
            case 'set-query': {
                const { query } = (parsed.payload ?? {}) as { query?: string }
                if (typeof query !== 'string') return
                setFindQuery(findReplaceEditor, query)
                return
            }
            case 'clear':
                clearFind(findReplaceEditor)
                return
            case 'next':
                findNext(findReplaceEditor)
                return
            case 'prev':
                findPrev(findReplaceEditor)
                return
            case 'replace-current': {
                const { replacement } = (parsed.payload ?? {}) as { replacement?: string }
                if (typeof replacement !== 'string') return
                replaceCurrent(findReplaceEditor, replacement)
                return
            }
            case 'replace-all': {
                const { replacement } = (parsed.payload ?? {}) as { replacement?: string }
                if (typeof replacement !== 'string') return
                replaceAll(findReplaceEditor, replacement)
                return
            }
        }
    }

    editor.on('transaction', onTransaction)
    window.addEventListener('message', onMessage)
    document.addEventListener('message', onMessage as EventListener)

    // Broadcast initial state so the host's store is populated even if
    // there's no transaction before the first query. Without this the
    // bar's first render after opening would show '0/0' (the store's
    // default) for one frame before the next transaction.
    broadcast()

    return {
        destroy: () => {
            editor.off('transaction', onTransaction)
            window.removeEventListener('message', onMessage)
            document.removeEventListener('message', onMessage as EventListener)
        },
    }
}
