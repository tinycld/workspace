// Salvage behaviour for Edit → Paste as Markdown. Verifies that:
//   - each parsed block is inserted in its own chain.run()
//   - a block that throws during insertContent falls back to its raw
//     markdown source as a plain paragraph (the "salvage" path)
//   - a block whose source is also rejected counts as failed
//   - the whole-paste plaintext fallback runs when zero blocks land
//
// Uses a hand-rolled stub of the Tiptap Editor surface (just the bits
// the salvage helpers touch) so the test doesn't need to spin up a
// real ProseMirror instance.

import { describe, expect, it } from 'vitest'
import type { Editor as TiptapEditor } from '@tiptap/react'
import {
    insertBlocksSequentially,
    insertPlaintext,
} from '../tinycld/text/components/menubar/paste-as-markdown'
import type { MarkdownBlock } from '../tinycld/text/lib/markdown/md-to-pm'

interface InsertCall {
    node: unknown
    pos: number
}

interface RejectRule {
    // Reject any insertContent call whose target node's `type` is
    // included here. Useful to simulate the StarterKit code-mark
    // exclusivity that motivated this whole feature.
    rejectTypes?: ReadonlySet<string>
    // Throw (rather than return false) on rejected inserts. Mirrors
    // ProseMirror's RangeError behaviour for schema-invalid trees.
    throwOnReject?: boolean
}

function makeStubEditor(rule: RejectRule = {}): {
    editor: TiptapEditor
    calls: InsertCall[]
    docSize: () => number
} {
    const calls: InsertCall[] = []
    let docSize = 0
    let pendingPos = 0
    let pendingNode: unknown = null

    const chain = {
        focus() {
            return chain
        },
        setTextSelection(pos: number) {
            pendingPos = pos
            return chain
        },
        insertContent(node: unknown) {
            pendingNode = node
            return chain
        },
        run() {
            const node = pendingNode as { type?: string } | null
            const type = node?.type
            const rejected =
                rule.rejectTypes !== undefined &&
                type !== undefined &&
                rule.rejectTypes.has(type)
            if (rejected && rule.throwOnReject) {
                pendingNode = null
                throw new RangeError(`Invalid collection of marks for node text: ${type}`)
            }
            if (rejected) {
                pendingNode = null
                return false
            }
            calls.push({ node: pendingNode, pos: pendingPos })
            docSize += 1
            pendingNode = null
            return true
        },
    }

    const editor = {
        state: { doc: { content: { get size() { return docSize } } } },
        chain: () => chain,
    } as unknown as TiptapEditor

    return { editor, calls, docSize: () => docSize }
}

function makeBlock(type: string, source: string): MarkdownBlock {
    return {
        block: { type, content: [{ type: 'text', text: source }] },
        source,
    }
}

describe('insertBlocksSequentially', () => {
    it('counts every block as succeeded when nothing rejects', () => {
        const { editor, calls } = makeStubEditor()
        const result = insertBlocksSequentially(editor, [
            makeBlock('heading', '# h'),
            makeBlock('paragraph', 'p'),
            makeBlock('bulletList', '- a'),
        ])
        expect(result).toEqual({ succeeded: 3, salvaged: 0, failed: 0 })
        expect(calls).toHaveLength(3)
        expect(calls.map(c => (c.node as { type: string }).type)).toEqual([
            'heading',
            'paragraph',
            'bulletList',
        ])
    })

    it('places blocks at the moving end-of-doc position', () => {
        const { editor, calls } = makeStubEditor()
        insertBlocksSequentially(editor, [
            makeBlock('heading', '# a'),
            makeBlock('paragraph', 'b'),
            makeBlock('paragraph', 'c'),
        ])
        // docSize increments by 1 per accepted insert; positions reflect
        // the size *before* that block's insert.
        expect(calls.map(c => c.pos)).toEqual([0, 1, 2])
    })

    it('falls back to plaintext paragraph when a block returns false', () => {
        // Reject all bulletList inserts. The plaintext fallback is
        // a `paragraph`, which is *not* in the reject set, so salvage
        // succeeds.
        const { editor, calls } = makeStubEditor({
            rejectTypes: new Set(['bulletList']),
        })
        const result = insertBlocksSequentially(editor, [
            makeBlock('paragraph', 'before'),
            makeBlock('bulletList', '- one\n- two'),
            makeBlock('paragraph', 'after'),
        ])
        expect(result).toEqual({ succeeded: 2, salvaged: 1, failed: 0 })
        // Salvaged call lands a paragraph carrying the original source.
        const salvageCall = calls.find(
            c => (c.node as { type: string }).type === 'paragraph' && /two/.test(
                ((c.node as { content?: [{ text?: string }] }).content?.[0]?.text ?? '')
            )
        )
        expect(salvageCall).toBeDefined()
    })

    it('falls back to plaintext when a block insert throws', () => {
        // Mirrors ProseMirror's "Invalid collection of marks" RangeError
        // path — the parsed block makes chain.run() throw, but a plain
        // paragraph rebuilt from the source slice is accepted.
        const { editor } = makeStubEditor({
            rejectTypes: new Set(['heading']),
            throwOnReject: true,
        })
        const result = insertBlocksSequentially(editor, [
            makeBlock('heading', '# broken'),
        ])
        expect(result).toEqual({ succeeded: 0, salvaged: 1, failed: 0 })
    })

    it('counts a block as failed if both parsed and plaintext are rejected', () => {
        const { editor } = makeStubEditor({
            rejectTypes: new Set(['heading', 'paragraph']),
        })
        const result = insertBlocksSequentially(editor, [
            makeBlock('heading', '# x'),
        ])
        expect(result).toEqual({ succeeded: 0, salvaged: 0, failed: 1 })
    })

    it('counts a block as failed when its source is empty (no fallback)', () => {
        // A block with no source slice (e.g. a malformed token without
        // a .map) can't be salvaged because there's no text to insert.
        const { editor } = makeStubEditor({ rejectTypes: new Set(['heading']) })
        const result = insertBlocksSequentially(editor, [
            { block: { type: 'heading' }, source: '' },
        ])
        expect(result).toEqual({ succeeded: 0, salvaged: 0, failed: 1 })
    })
})

describe('insertPlaintext', () => {
    it('inserts a paragraph carrying the source', () => {
        const { editor, calls } = makeStubEditor()
        const ok = insertPlaintext(editor, 'some markdown')
        expect(ok).toBe(true)
        expect(calls).toHaveLength(1)
        const node = calls[0].node as { type: string; content: [{ text: string }] }
        expect(node.type).toBe('paragraph')
        expect(node.content[0].text).toBe('some markdown')
    })

    it('returns false for empty source without touching the editor', () => {
        const { editor, calls } = makeStubEditor()
        const ok = insertPlaintext(editor, '')
        expect(ok).toBe(false)
        expect(calls).toHaveLength(0)
    })

    it('returns false (rather than throwing) if the editor rejects', () => {
        const { editor } = makeStubEditor({
            rejectTypes: new Set(['paragraph']),
            throwOnReject: true,
        })
        expect(insertPlaintext(editor, 'x')).toBe(false)
    })
})
