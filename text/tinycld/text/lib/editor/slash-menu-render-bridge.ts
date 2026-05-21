import type { exitSuggestion, SuggestionOptions } from '@tiptap/suggestion'
import type { SlashMenuCommand } from './slash-menu-commands'
import {
    serializeSlashMenuItems,
    slashMenuPluginKey,
    toAnchoredSlashMenuRect,
} from './slash-menu-shared'

// Bridge render strategy for SlashMenu. Posts ui.show-popover /
// popover-update / popover-exited messages out of the WebView; the
// host's AnchoredOverlayController renders the popover as a native
// Modal and replies via popover-result. Selections / dismissals come
// back through a 'message' listener installed on window+document for
// the lifetime of the open popover.
//
// Kept in its own module so:
//   - The store render strategy in slash-menu-render-store.ts has no
//     dependency on the WebView message protocol.
//   - The Extension wiring in slash-menu.ts is purely composition.
//   - Tests can import this factory directly and inject stubbed deps
//     without dragging the store / Extension imports along.

// Helper to post a 'ui' namespace message out of the WebView. Mirrors
// the postToNative helper in webview-editor/source/Editor.tsx. Silently
// no-ops outside the WebView (window.ReactNativeWebView is undefined
// on the host side).
export function defaultPostToHost(message: object) {
    const target = (globalThis as { window?: { ReactNativeWebView?: { postMessage: (s: string) => void } } })
        .window
    target?.ReactNativeWebView?.postMessage(JSON.stringify(message))
}

// Generate a request id for show-popover messages. The host echoes it
// in popover-result so we can correlate the response back to the
// in-flight suggestion-plugin instance. crypto.randomUUID would also
// work but isn't guaranteed in the WebView's content world; Date.now +
// random tail is enough to disambiguate inside one editing session.
export function defaultNewRequestId(): string {
    return `slash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Dependency-injected factory for the bridge render strategy. Used
// both by the extension (with the production helpers) and by tests
// (with stubbed postMessage + newRequestId so the wire shape is easy
// to assert without a real WebView).
export interface SlashMenuBridgeDeps {
    postToHost: (message: object) => void
    newRequestId: () => string
    exitSuggestion: typeof exitSuggestion
}

export function createSlashMenuBridgeRender(
    deps: SlashMenuBridgeDeps
): NonNullable<SuggestionOptions<SlashMenuCommand>['render']> {
    return () => {
        let currentRequestId: string | null = null
        // SuggestionOptions.command takes { editor, range, props }; but
        // SuggestionProps.command (handed to render callbacks via the
        // props arg) is the wrapped form `(item: TSelected) => void` —
        // the suggestion plugin internally captures editor + range and
        // hands us a closure that takes only the selected item. We
        // store that wrapped form here.
        let currentCommand: ((item: SlashMenuCommand) => void) | null = null
        let currentItems: SlashMenuCommand[] = []
        let selectedIndex = 0
        let editorView: import('@tiptap/pm/view').EditorView | null = null

        const onHostMessage = (evt: MessageEvent) => {
            if (typeof evt.data !== 'string') return
            let parsed: {
                namespace?: string
                type?: string
                requestId?: string
                payload?: unknown
            }
            try {
                parsed = JSON.parse(evt.data)
            } catch {
                return
            }
            if (parsed.namespace !== 'ui' || parsed.type !== 'popover-result') return
            if (!currentRequestId || parsed.requestId !== currentRequestId) return
            const payload = parsed.payload as
                | { action?: string; payload?: { commandId?: string } }
                | null
                | undefined
            const action = payload?.action
            if (action === 'select') {
                const commandId = payload?.payload?.commandId
                const picked = currentItems.find(c => c.id === commandId)
                if (picked && currentCommand) {
                    currentCommand(picked)
                }
                currentRequestId = null
            } else if (action === 'dismiss') {
                if (editorView) {
                    try {
                        deps.exitSuggestion(editorView, slashMenuPluginKey)
                    } catch {
                        // exitSuggestion can throw if the plugin
                        // state has already been cleared by an
                        // intervening transaction. Safe to ignore.
                    }
                }
                currentRequestId = null
            }
        }

        return {
            onStart: props => {
                currentCommand = props.command
                currentItems = props.items
                selectedIndex = 0
                currentRequestId = deps.newRequestId()
                editorView = props.editor.view
                const rect = toAnchoredSlashMenuRect(props.clientRect?.() ?? null)
                if (!rect) {
                    currentRequestId = null
                    return
                }
                // Assumption: at most one slash-menu suggestion plugin
                // instance is active per WebView at a time. The
                // SuggestionOptions plugin key (slashMenuPluginKey)
                // guarantees that — but if a future feature introduces
                // a second suggestion plugin sharing the same key, each
                // would install its own listener pair and the
                // requestId routing would get confused. New suggestion
                // plugins (mentions, emoji) MUST use distinct plugin
                // keys and distinct popover kinds.
                if (typeof window !== 'undefined') {
                    window.addEventListener('message', onHostMessage)
                    document.addEventListener('message', onHostMessage as EventListener)
                }
                deps.postToHost({
                    namespace: 'ui',
                    type: 'show-popover',
                    requestId: currentRequestId,
                    payload: {
                        kind: 'slash-menu',
                        rect,
                        payload: {
                            items: serializeSlashMenuItems(props.items),
                            query: props.query,
                            selectedIndex,
                        },
                    },
                })
            },
            onUpdate: props => {
                currentCommand = props.command
                currentItems = props.items
                if (selectedIndex >= props.items.length) {
                    selectedIndex = props.items.length === 0 ? 0 : props.items.length - 1
                }
                if (!currentRequestId) return
                deps.postToHost({
                    namespace: 'ui',
                    type: 'popover-update',
                    requestId: currentRequestId,
                    payload: {
                        items: serializeSlashMenuItems(props.items),
                        query: props.query,
                        selectedIndex,
                    },
                })
            },
            onKeyDown: ({ event }) => {
                if (!currentRequestId) return false
                if (event.key === 'ArrowDown') {
                    if (currentItems.length === 0) return false
                    selectedIndex = (selectedIndex + 1) % currentItems.length
                    deps.postToHost({
                        namespace: 'ui',
                        type: 'popover-update',
                        requestId: currentRequestId,
                        payload: {
                            items: serializeSlashMenuItems(currentItems),
                            query: '',
                            selectedIndex,
                        },
                    })
                    event.preventDefault()
                    return true
                }
                if (event.key === 'ArrowUp') {
                    if (currentItems.length === 0) return false
                    selectedIndex =
                        (selectedIndex - 1 + currentItems.length) % currentItems.length
                    deps.postToHost({
                        namespace: 'ui',
                        type: 'popover-update',
                        requestId: currentRequestId,
                        payload: {
                            items: serializeSlashMenuItems(currentItems),
                            query: '',
                            selectedIndex,
                        },
                    })
                    event.preventDefault()
                    return true
                }
                if (event.key === 'Enter') {
                    const item = currentItems[selectedIndex]
                    if (!item) return false
                    currentCommand?.(item)
                    event.preventDefault()
                    return true
                }
                if (event.key === 'Escape') {
                    if (editorView) {
                        try {
                            deps.exitSuggestion(editorView, slashMenuPluginKey)
                        } catch {
                            // see onHostMessage above.
                        }
                    }
                    event.preventDefault()
                    return true
                }
                return false
            },
            onExit: () => {
                if (currentRequestId) {
                    // popover-exited is WebView -> host: the suggestion
                    // plugin is gone (user typed past the trigger, picked
                    // an item, hit Escape, …) so the host can close any
                    // overlay still open for this requestId. Distinct
                    // from popover-dismissed (host -> WebView, reserved
                    // for host-initiated dismissals) so the protocol
                    // direction is unambiguous on both ends.
                    deps.postToHost({
                        namespace: 'ui',
                        type: 'popover-exited',
                        requestId: currentRequestId,
                        payload: null,
                    })
                }
                if (typeof window !== 'undefined') {
                    window.removeEventListener('message', onHostMessage)
                    document.removeEventListener('message', onHostMessage as EventListener)
                }
                currentRequestId = null
                currentCommand = null
                currentItems = []
                selectedIndex = 0
                editorView = null
            },
        }
    }
}
