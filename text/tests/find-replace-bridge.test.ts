// Unit tests for the WebView-side find/replace bridge (the half that
// lives inside the WebView, in webview-editor/source/bridges/). The
// bridge installs window/document message listeners; we stub those
// at the global level rather than spinning up happy-dom, because the
// per-file `@vitest-environment` directive doesn't survive vitest's
// symlink resolution for sibling-package test files. We exercise its
// wire shapes — what messages it posts to native, and how it routes
// incoming host -> WebView messages onto the editor helpers. The
// bridge module pulls in the find-replace-plugin helpers
// (setFindQuery, findNext, etc.), so we stub the editor by passing
// in a duck-typed object whose state + dispatch are spies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findReplacePluginKey } from '../tinycld/text/lib/find-replace-plugin'
import { installFindReplaceBridge } from '../tinycld/text/webview-editor/source/bridges/find-replace-bridge'

// Minimal window/document stubs the bridge needs. EventTarget-like
// registries record listeners; dispatchMessage() fans out to every
// registered 'message' handler so we can drive the bridge's incoming
// pipeline.
interface ListenerRegistry {
    listeners: Map<string, Set<EventListener>>
    addEventListener: (event: string, fn: EventListener) => void
    removeEventListener: (event: string, fn: EventListener) => void
}

function makeRegistry(): ListenerRegistry {
    const listeners = new Map<string, Set<EventListener>>()
    return {
        listeners,
        addEventListener: (event, fn) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event)?.add(fn)
        },
        removeEventListener: (event, fn) => {
            listeners.get(event)?.delete(fn)
        },
    }
}

let stubWindow: ListenerRegistry
let stubDocument: ListenerRegistry

beforeEach(() => {
    stubWindow = makeRegistry()
    stubDocument = makeRegistry()
    vi.stubGlobal('window', stubWindow)
    vi.stubGlobal('document', stubDocument)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function postFromHost(message: unknown) {
    const data = JSON.stringify(message)
    const evt = { data } as unknown as MessageEvent
    for (const fn of stubWindow.listeners.get('message') ?? new Set<EventListener>()) {
        fn(evt as unknown as Event)
    }
}

// Minimal Editor stand-in. Real Tiptap editors are too heavy for unit
// tests; the bridge only touches editor.on/off (transaction events)
// and editor.state / editor.view.dispatch. The plugin helpers
// underneath dispatch a tr.setMeta(...) onto editor.view.dispatch, so
// we capture the meta payloads to assert against.
function makeFakeEditor(initialState: {
    matches?: Array<{ from: number; to: number }>
    currentIndex?: number
    query?: string
}) {
    const dispatched: Array<{ meta: unknown }> = []
    const txListeners = new Set<() => void>()
    // Tiptap exposes pluginState through prosemirror's
    // findReplacePluginKey.getState(state). We fake a plugin-state
    // map keyed by the spec.key (the PluginKey object itself).
    const pluginState = {
        query: initialState.query ?? '',
        matches: initialState.matches ?? [],
        currentIndex: initialState.currentIndex ?? 0,
    }
    const state = {
        // ProseMirror's PluginKey.getState uses an internal symbol
        // (key$). We can mimic by providing a `plugins[].getState(state)`
        // path the spec.key.getState walks. Simpler: expose a `_plugin`
        // map and patch findReplacePluginKey.getState to read it
        // directly. We do the patch at test scope via vi.spyOn on the
        // PluginKey object's getState method.
        _pluginState: pluginState,
        tr: {
            setMeta: (_key: unknown, meta: unknown) => {
                return { meta }
            },
        },
        doc: { descendants: () => undefined },
    }
    const editor = {
        state,
        view: {
            dispatch: (tr: { meta?: unknown }) => {
                dispatched.push({ meta: tr.meta })
            },
        },
        on: (event: string, handler: () => void) => {
            if (event === 'transaction') txListeners.add(handler)
        },
        off: (event: string, handler: () => void) => {
            if (event === 'transaction') txListeners.delete(handler)
        },
    } as unknown as Parameters<typeof installFindReplaceBridge>[0]
    return {
        editor,
        dispatched,
        pluginState,
        // Simulate a transaction by invoking every registered listener.
        triggerTransaction: () => {
            for (const handler of txListeners) handler()
        },
    }
}

// Patch findReplacePluginKey.getState so it reads our fake state's
// `_pluginState` instead of walking a real ProseMirror plugin map.
function patchPluginKey() {
    return vi
        .spyOn(findReplacePluginKey, 'getState')
        .mockImplementation((state: unknown) => {
            return (state as { _pluginState?: unknown })._pluginState as never
        })
}

// Build a poster recorder.
function makePoster() {
    const fn = vi.fn()
    return { fn, post: (msg: unknown) => fn(msg) }
}

// --- outgoing broadcasts ---------------------------------------------

describe('installFindReplaceBridge — outgoing state-update', () => {
    it('broadcasts an initial state-update immediately on install', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [], currentIndex: 0, query: '' })
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            expect(poster.fn).toHaveBeenCalledTimes(1)
            expect(poster.fn.mock.calls[0][0]).toEqual({
                namespace: 'find-replace',
                type: 'state-update',
                payload: { matchCount: 0, currentIndex: 0, query: '' },
            })
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('broadcasts state-update on transaction when plugin state changes', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [], currentIndex: 0, query: '' })
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            poster.fn.mockClear()
            fake.pluginState.matches = [{ from: 0, to: 3 }]
            fake.pluginState.query = 'foo'
            fake.triggerTransaction()
            expect(poster.fn).toHaveBeenCalledTimes(1)
            expect(poster.fn.mock.calls[0][0]).toEqual({
                namespace: 'find-replace',
                type: 'state-update',
                payload: { matchCount: 1, currentIndex: 0, query: 'foo' },
            })
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('skips identical state-update broadcasts (identity skip)', () => {
        // Typing in unrelated parts of the doc fires transactions that
        // don't move the find/replace plugin's state — the WebView
        // should NOT spam the host with no-op broadcasts.
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [], currentIndex: 0, query: '' })
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            poster.fn.mockClear()
            fake.triggerTransaction()
            fake.triggerTransaction()
            fake.triggerTransaction()
            expect(poster.fn).not.toHaveBeenCalled()
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('rebroadcasts when state moves back to a value that previously matched (no stale identity)', () => {
        // Identity skip uses the immediately-prior serialized payload,
        // so toggling between two states should always broadcast.
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [], currentIndex: 0, query: '' })
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            poster.fn.mockClear()
            fake.pluginState.query = 'foo'
            fake.pluginState.matches = [{ from: 0, to: 3 }]
            fake.triggerTransaction()
            fake.pluginState.query = ''
            fake.pluginState.matches = []
            fake.triggerTransaction()
            fake.pluginState.query = 'foo'
            fake.pluginState.matches = [{ from: 0, to: 3 }]
            fake.triggerTransaction()
            expect(poster.fn).toHaveBeenCalledTimes(3)
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })
})

// --- incoming messages routed onto editor helpers --------------------

describe('installFindReplaceBridge — incoming host -> WebView messages', () => {
    it('routes set-query into a setMeta transaction with setQuery meta', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            fake.dispatched.length = 0
            postFromHost({ namespace: 'find-replace', type: 'set-query', payload: { query: 'foo' } })
            expect(fake.dispatched).toHaveLength(1)
            expect(fake.dispatched[0].meta).toEqual({ setQuery: 'foo' })
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('routes clear into a clear-meta transaction', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            fake.dispatched.length = 0
            postFromHost({ namespace: 'find-replace', type: 'clear', payload: null })
            expect(fake.dispatched).toHaveLength(1)
            expect(fake.dispatched[0].meta).toEqual({ clear: true })
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('routes next/prev into cycle-match dispatches (no-op when no matches)', () => {
        const restore = patchPluginKey()
        try {
            // findNext/findPrev short-circuit when matches.length === 0,
            // so dispatch should NOT be called.
            const fake = makeFakeEditor({ matches: [], currentIndex: 0 })
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            fake.dispatched.length = 0
            postFromHost({ namespace: 'find-replace', type: 'next', payload: null })
            postFromHost({ namespace: 'find-replace', type: 'prev', payload: null })
            expect(fake.dispatched).toHaveLength(0)
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('ignores messages from other namespaces', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            fake.dispatched.length = 0
            postFromHost({ namespace: 'comment', type: 'add', payload: { commentId: 'c1' } })
            postFromHost({ namespace: 'ui', type: 'document-scroll', payload: null })
            expect(fake.dispatched).toHaveLength(0)
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('ignores set-query without a string query payload', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            fake.dispatched.length = 0
            postFromHost({ namespace: 'find-replace', type: 'set-query', payload: {} })
            postFromHost({
                namespace: 'find-replace',
                type: 'set-query',
                payload: { query: 42 },
            })
            expect(fake.dispatched).toHaveLength(0)
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })

    it('ignores replace-current / replace-all without a string replacement', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [{ from: 0, to: 3 }], currentIndex: 0 })
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            fake.dispatched.length = 0
            postFromHost({ namespace: 'find-replace', type: 'replace-current', payload: {} })
            postFromHost({ namespace: 'find-replace', type: 'replace-all', payload: {} })
            expect(fake.dispatched).toHaveLength(0)
            bridge.destroy()
        } finally {
            restore.mockRestore()
        }
    })
})

// --- teardown --------------------------------------------------------

describe('installFindReplaceBridge — destroy', () => {
    it('removes its listeners on destroy', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const poster = makePoster()
            const bridge = installFindReplaceBridge(fake.editor, poster.post)
            poster.fn.mockClear()
            bridge.destroy()
            // After destroy, a transaction event should not produce a
            // broadcast, and host messages should be ignored.
            fake.triggerTransaction()
            postFromHost({ namespace: 'find-replace', type: 'set-query', payload: { query: 'x' } })
            expect(poster.fn).not.toHaveBeenCalled()
            expect(fake.dispatched.length).toBe(0)
        } finally {
            restore.mockRestore()
        }
    })
})
