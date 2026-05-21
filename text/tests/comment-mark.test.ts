// Unit tests for the Tiptap comment mark's pure helpers. We don't
// instantiate a real ProseMirror schema; the only exported helper
// (snapshotCommentIds) only relies on doc.descendants + node.marks,
// so a duck-typed doc covers the surface.

import { describe, expect, it } from 'vitest'
import { snapshotCommentIds } from '../tinycld/text/lib/editor/comment-mark'

interface FakeMark {
    type: { name: string }
    attrs: Record<string, unknown>
}

interface FakeNode {
    nodeSize: number
    marks: FakeMark[]
}

function fakeDoc(nodes: Array<{ marks: FakeMark[] }>): Parameters<typeof snapshotCommentIds>[0] {
    return {
        descendants(visit: (node: FakeNode, pos: number) => boolean | void) {
            let pos = 0
            for (const n of nodes) {
                visit({ nodeSize: 1, marks: n.marks }, pos)
                pos += 1
            }
        },
    } as unknown as Parameters<typeof snapshotCommentIds>[0]
}

function comment(id: string): FakeMark {
    return { type: { name: 'tinycldComment' }, attrs: { commentId: id } }
}

function bold(): FakeMark {
    return { type: { name: 'bold' }, attrs: {} }
}

describe('snapshotCommentIds', () => {
    it('returns empty set when no comment marks are present', () => {
        const doc = fakeDoc([{ marks: [bold()] }, { marks: [] }])
        expect(snapshotCommentIds(doc)).toEqual(new Set())
    })

    it('collects each commentId once even if it appears on multiple nodes', () => {
        const doc = fakeDoc([
            { marks: [comment('c1')] },
            { marks: [comment('c1'), bold()] },
            { marks: [bold()] },
        ])
        expect(snapshotCommentIds(doc)).toEqual(new Set(['c1']))
    })

    it('collects every distinct commentId', () => {
        const doc = fakeDoc([
            { marks: [comment('c1')] },
            { marks: [comment('c2')] },
            { marks: [comment('c3'), bold()] },
        ])
        expect(snapshotCommentIds(doc)).toEqual(new Set(['c1', 'c2', 'c3']))
    })

    it('ignores comment marks with null/empty commentId', () => {
        const doc = fakeDoc([
            { marks: [{ type: { name: 'tinycldComment' }, attrs: { commentId: null } }] },
            { marks: [{ type: { name: 'tinycldComment' }, attrs: { commentId: '' } }] },
            { marks: [comment('c1')] },
        ])
        expect(snapshotCommentIds(doc)).toEqual(new Set(['c1']))
    })

    it('supports diffing two snapshots to detect removed mark ids', () => {
        const before = snapshotCommentIds(
            fakeDoc([{ marks: [comment('a')] }, { marks: [comment('b')] }])
        )
        const after = snapshotCommentIds(fakeDoc([{ marks: [comment('a')] }]))
        const removed = [...before].filter(id => !after.has(id))
        expect(removed).toEqual(['b'])
    })
})
