// Unit tests for the WebView-side format bridge (the half that lives
// inside the WebView, in webview-editor/source/bridges/). Mirrors the
// find-replace-bridge.test.ts pattern — stub window/document at the
// global level, drive the bridge's incoming pipeline via dispatchMessage,
// and assert on the synthesized Tiptap chain calls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFormatBridge } from '../tinycld/text/webview-editor/source/bridges/format-bridge'

// Minimal window/document stubs the bridge needs.
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

// Records of method invocations against a fake editor. The bridge calls
// `editor.chain().focus().<command>(args).run()` style chains; the fake
// captures the terminal command name + args and lets us assert on what
// got dispatched.
interface ChainCall {
    methods: Array<{ name: string; args: unknown[] }>
}

function makeFakeEditor() {
    const calls: ChainCall[] = []
    const commandsFocusCalls: number[] = []

    function makeChain(): ReturnType<typeof Object.assign> {
        const call: ChainCall = { methods: [] }
        const proxy: Record<string, unknown> = new Proxy(
            {},
            {
                get(_target, prop) {
                    if (prop === 'run') {
                        return () => {
                            calls.push(call)
                            return true
                        }
                    }
                    return (...args: unknown[]) => {
                        call.methods.push({ name: String(prop), args })
                        return proxy
                    }
                },
            }
        )
        return proxy as unknown as ReturnType<typeof Object.assign>
    }

    const setEditableCalls: boolean[] = []

    const editor = {
        chain: () => makeChain(),
        commands: {
            focus: () => {
                commandsFocusCalls.push(Date.now())
                return true
            },
        },
        setEditable: (next: boolean) => {
            setEditableCalls.push(next)
        },
    } as unknown as Parameters<typeof installFormatBridge>[0]

    return { editor, calls, commandsFocusCalls, setEditableCalls }
}

// --- TenTap-shape messages (no namespace) ----------------------------

describe('installFormatBridge — TenTap-shape (no namespace) messages', () => {
    it('routes toggle-bold to editor.chain().focus().toggleBold().run()', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ type: 'toggle-bold', payload: null })
        expect(fake.calls).toHaveLength(1)
        const methods = fake.calls[0].methods.map(m => m.name)
        expect(methods).toEqual(['focus', 'toggleBold'])
        bridge.destroy()
    })

    it('routes toggle-heading with payload as the level (TenTap convention)', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ type: 'toggle-heading', payload: 2 })
        expect(fake.calls).toHaveLength(1)
        const headingMethod = fake.calls[0].methods.find(m => m.name === 'toggleHeading')
        expect(headingMethod).toBeDefined()
        expect(headingMethod?.args).toEqual([{ level: 2 }])
        bridge.destroy()
    })

    it('routes set-link with a non-empty URL to setLink', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ type: 'set-link', payload: 'https://example.com' })
        expect(fake.calls).toHaveLength(1)
        const methods = fake.calls[0].methods.map(m => m.name)
        expect(methods).toEqual(['focus', 'extendMarkRange', 'setLink'])
        bridge.destroy()
    })

    it('routes set-link with empty string to unsetLink', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ type: 'set-link', payload: '' })
        expect(fake.calls).toHaveLength(1)
        const methods = fake.calls[0].methods.map(m => m.name)
        expect(methods).toEqual(['focus', 'extendMarkRange', 'unsetLink'])
        bridge.destroy()
    })

    it('routes set-editable into editor.setEditable directly', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ type: 'set-editable', payload: false })
        postFromHost({ type: 'set-editable', payload: true })
        expect(fake.setEditableCalls).toEqual([false, true])
        bridge.destroy()
    })
})

// --- format-namespace messages ---------------------------------------

describe('installFormatBridge — format namespace messages', () => {
    it('routes insert-table with rows/cols', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ namespace: 'format', type: 'insert-table', payload: { rows: 3, cols: 4 } })
        expect(fake.calls).toHaveLength(1)
        const insertTable = fake.calls[0].methods.find(m => m.name === 'insertTable')
        expect(insertTable).toBeDefined()
        expect(insertTable?.args).toEqual([{ rows: 3, cols: 4, withHeaderRow: true }])
        bridge.destroy()
    })

    it('routes set-text-align for legal align values', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ namespace: 'format', type: 'set-text-align', payload: 'center' })
        expect(fake.calls).toHaveLength(1)
        const setAlign = fake.calls[0].methods.find(m => m.name === 'setTextAlign')
        expect(setAlign).toBeDefined()
        expect(setAlign?.args).toEqual(['center'])
        bridge.destroy()
    })

    it('drops set-text-align for illegal align values without throwing', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ namespace: 'format', type: 'set-text-align', payload: 'middle' })
        expect(fake.calls).toHaveLength(0)
        bridge.destroy()
    })

    it('routes update-image-attrs with width/height/wrap', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({
            namespace: 'format',
            type: 'update-image-attrs',
            payload: { wrap: 'left', width: 200, height: 150 },
        })
        expect(fake.calls).toHaveLength(1)
        const updateAttrs = fake.calls[0].methods.find(m => m.name === 'updateAttributes')
        expect(updateAttrs).toBeDefined()
        expect(updateAttrs?.args).toEqual([
            'image',
            { wrap: 'left', width: 200, height: 150 },
        ])
        bridge.destroy()
    })

    it('skips update-image-attrs when no valid fields are present', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({
            namespace: 'format',
            type: 'update-image-attrs',
            payload: { width: 'oops', height: -5 },
        })
        expect(fake.calls).toHaveLength(0)
        bridge.destroy()
    })

    it('routes set-cell-shading by calling editor.commands.focus() first', () => {
        // The bridge focuses the editor and then delegates to applyCellShading,
        // which inspects the live editor state. We can't easily fake the full
        // ProseMirror state from a unit test, so we just assert that the
        // bridge reached the focus step — the applyCellShading internals are
        // covered by cell-shading.test.ts directly.
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        try {
            postFromHost({
                namespace: 'format',
                type: 'set-cell-shading',
                payload: { color: '#ffeeaa' },
            })
        } catch {
            // applyCellShading throws on a stub editor that lacks ProseMirror
            // state — irrelevant for verifying the dispatcher's routing.
        }
        expect(fake.commandsFocusCalls.length).toBeGreaterThanOrEqual(1)
        bridge.destroy()
    })
})

// --- namespace gating ------------------------------------------------

describe('installFormatBridge — namespace gating', () => {
    it('ignores messages with namespace app / comment / find-replace / ui', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ namespace: 'app', type: 'init', payload: {} })
        postFromHost({ namespace: 'comment', type: 'add', payload: { commentId: 'c1' } })
        postFromHost({
            namespace: 'find-replace',
            type: 'set-query',
            payload: { query: 'x' },
        })
        postFromHost({ namespace: 'ui', type: 'document-scroll', payload: null })
        expect(fake.calls).toHaveLength(0)
        bridge.destroy()
    })

    it('ignores messages without a type', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        postFromHost({ namespace: 'format', payload: { rows: 1, cols: 1 } })
        expect(fake.calls).toHaveLength(0)
        bridge.destroy()
    })

    it('ignores non-JSON message events', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        const evt = { data: 'not json {' } as unknown as MessageEvent
        for (const fn of stubWindow.listeners.get('message') ?? new Set<EventListener>()) {
            fn(evt as unknown as Event)
        }
        expect(fake.calls).toHaveLength(0)
        bridge.destroy()
    })
})

// --- teardown --------------------------------------------------------

describe('installFormatBridge — destroy', () => {
    it('removes its listeners on destroy', () => {
        const fake = makeFakeEditor()
        const bridge = installFormatBridge(fake.editor, () => undefined)
        bridge.destroy()
        // After destroy, posting a message should not produce a chain call.
        postFromHost({ type: 'toggle-bold', payload: null })
        expect(fake.calls).toHaveLength(0)
    })
})
