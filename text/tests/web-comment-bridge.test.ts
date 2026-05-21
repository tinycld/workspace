// Unit tests for the host-side web comment bridge factory. Mirrors
// comment-bridge-native.test.ts in scope — the factory itself is pure
// (no hooks), so we feed it a fake TiptapEditor with just enough shape
// to record chain method calls + answer storage / selection queries.

import { describe, expect, it, vi } from 'vitest'
import { createWebCommentBridge } from '../tinycld/text/hooks/web-comment-bridge'

// Reusable chain-call recorder mirroring the format-bridge.test.ts
// pattern: a Proxy intercepts every chained method, accumulating
// method names + args until .run() drains the call into the result
// list.
interface ChainCall {
    methods: Array<{ name: string; args: unknown[] }>
}

function makeChainRecorder(calls: ChainCall[]) {
    return () => {
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
        return proxy
    }
}

function makeFakeEditor(opts?: {
    storedComments?: Record<string, { from: number; to: number }>
    selection?: { from: number; to: number; empty: boolean }
}) {
    const calls: ChainCall[] = []
    const storage = {
        tinycldComment: {
            findComment: (id: string) => {
                if (!opts?.storedComments) return null
                return opts.storedComments[id] ?? null
            },
        },
    }
    const editor = {
        chain: makeChainRecorder(calls),
        state: {
            selection: {
                from: opts?.selection?.from ?? 0,
                to: opts?.selection?.to ?? 0,
                empty: opts?.selection?.empty ?? true,
            },
        },
        storage,
    } as unknown as Parameters<typeof createWebCommentBridge>[0]['tiptapEditor']
    return { editor, calls }
}

// --- addComment -------------------------------------------------------

describe('createWebCommentBridge — addComment', () => {
    it('calls editor.chain().addComment(commentId).run() when no range is supplied', () => {
        const fake = makeFakeEditor()
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        bridge.addComment('c1')
        expect(fake.calls).toHaveLength(1)
        const names = fake.calls[0].methods.map(m => m.name)
        expect(names).toEqual(['addComment'])
        expect(fake.calls[0].methods[0].args).toEqual(['c1'])
    })

    it('restores the selection before applying the mark when a range is supplied', () => {
        const fake = makeFakeEditor()
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        bridge.addComment('c1', { from: 4, to: 10 })
        expect(fake.calls).toHaveLength(1)
        const names = fake.calls[0].methods.map(m => m.name)
        expect(names).toEqual(['setTextSelection', 'addComment'])
        expect(fake.calls[0].methods[0].args).toEqual([{ from: 4, to: 10 }])
    })
})

// --- removeComment ----------------------------------------------------

describe('createWebCommentBridge — removeComment', () => {
    it('calls editor.chain().removeComment(commentId).run()', () => {
        const fake = makeFakeEditor()
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        bridge.removeComment('c1')
        expect(fake.calls).toHaveLength(1)
        const names = fake.calls[0].methods.map(m => m.name)
        expect(names).toEqual(['removeComment'])
        expect(fake.calls[0].methods[0].args).toEqual(['c1'])
    })
})

// --- focusComment -----------------------------------------------------

describe('createWebCommentBridge — focusComment', () => {
    it('resolves false when the mark storage returns null for the id', async () => {
        const fake = makeFakeEditor({ storedComments: {} })
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        const result = await bridge.focusComment('c1')
        expect(result).toBe(false)
        expect(fake.calls).toHaveLength(0)
    })

    it('selects + scrolls + focuses when the mark exists, then resolves true', async () => {
        const fake = makeFakeEditor({
            storedComments: { c1: { from: 4, to: 12 } },
        })
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        const result = await bridge.focusComment('c1')
        expect(result).toBe(true)
        expect(fake.calls).toHaveLength(1)
        const names = fake.calls[0].methods.map(m => m.name)
        expect(names).toEqual(['setTextSelection', 'scrollIntoView', 'focus'])
        expect(fake.calls[0].methods[0].args).toEqual([{ from: 4, to: 12 }])
    })
})

// --- getSelection -----------------------------------------------------

describe('createWebCommentBridge — getSelection', () => {
    it('resolves null when the editor selection is empty', async () => {
        const fake = makeFakeEditor({
            selection: { from: 5, to: 5, empty: true },
        })
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        expect(await bridge.getSelection()).toBeNull()
    })

    it('resolves with the {from,to} range when the selection is non-empty', async () => {
        const fake = makeFakeEditor({
            selection: { from: 5, to: 11, empty: false },
        })
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers: new Set(),
        })
        expect(await bridge.getSelection()).toEqual({ from: 5, to: 11 })
    })
})

// --- onTap / onRemoved fan-out ---------------------------------------

describe('createWebCommentBridge — handler registration', () => {
    it('returns an unsubscribe from onTap and removes the handler from the Set', () => {
        const fake = makeFakeEditor()
        const tapHandlers = new Set<(commentId: string) => void>()
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers,
            removedHandlers: new Set(),
        })
        const handler = vi.fn()
        const unsubscribe = bridge.onTap(handler)
        expect(tapHandlers.size).toBe(1)
        unsubscribe()
        expect(tapHandlers.size).toBe(0)
    })

    it('returns an unsubscribe from onRemoved and removes the handler from the Set', () => {
        const fake = makeFakeEditor()
        const removedHandlers = new Set<(commentIds: string[]) => void>()
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers: new Set(),
            removedHandlers,
        })
        const handler = vi.fn()
        const unsubscribe = bridge.onRemoved(handler)
        expect(removedHandlers.size).toBe(1)
        unsubscribe()
        expect(removedHandlers.size).toBe(0)
    })

    it('lets the hook drive every onTap handler through the shared Set', () => {
        // The factory adds to a Set the hook owns; the hook's DOM-click
        // effect fans out by iterating the same Set. Verify the Set
        // identity round-trips so the hook can iterate without needing
        // a getter on the bridge.
        const fake = makeFakeEditor()
        const tapHandlers = new Set<(commentId: string) => void>()
        const bridge = createWebCommentBridge({
            tiptapEditor: fake.editor,
            tapHandlers,
            removedHandlers: new Set(),
        })
        const handler = vi.fn()
        bridge.onTap(handler)
        // The hook would iterate tapHandlers like this:
        for (const h of tapHandlers) h('c1')
        expect(handler).toHaveBeenCalledWith('c1')
    })
})
