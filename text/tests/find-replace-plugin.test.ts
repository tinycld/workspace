// Unit tests for the find/replace plugin's pure helpers.
// `collectMatches` is the core matcher (the only thing besides
// `_applyForTest` we expose for tests); we exercise it against a
// duck-typed ProseMirror doc that satisfies the descendants() shape.

import { describe, expect, it } from 'vitest'
import { collectMatches, _applyForTest } from '../tinycld/text/lib/find-replace-plugin'

// ProseMirror's `doc.descendants(visit)` walks every node and calls
// `visit(node, pos)`. For matching we only care about `node.isText`
// + `node.text`. A minimal fake gives us deterministic positions.
function fakeDoc(textRuns: Array<{ text: string; pos: number }>) {
    return {
        descendants(visit: (node: { isText: boolean; text?: string }, pos: number) => void) {
            for (const run of textRuns) {
                visit({ isText: true, text: run.text }, run.pos)
            }
        },
    } as unknown as Parameters<typeof collectMatches>[0]
}

describe('collectMatches', () => {
    it('returns [] for an empty query', () => {
        const doc = fakeDoc([{ text: 'hello world', pos: 0 }])
        expect(collectMatches(doc, '')).toEqual([])
    })

    it('finds all occurrences inside a single text run, in document order', () => {
        const doc = fakeDoc([{ text: 'foo foo foo', pos: 10 }])
        expect(collectMatches(doc, 'foo')).toEqual([
            { from: 10, to: 13 },
            { from: 14, to: 17 },
            { from: 18, to: 21 },
        ])
    })

    it('is case-insensitive', () => {
        const doc = fakeDoc([{ text: 'Foo FOO foo', pos: 0 }])
        expect(collectMatches(doc, 'foo')).toEqual([
            { from: 0, to: 3 },
            { from: 4, to: 7 },
            { from: 8, to: 11 },
        ])
    })

    it('returns [] when the needle is not present', () => {
        const doc = fakeDoc([{ text: 'hello world', pos: 0 }])
        expect(collectMatches(doc, 'absent')).toEqual([])
    })

    it('accumulates matches across multiple text runs', () => {
        const doc = fakeDoc([
            { text: 'foo', pos: 0 },
            { text: 'foo', pos: 100 },
        ])
        expect(collectMatches(doc, 'foo')).toEqual([
            { from: 0, to: 3 },
            { from: 100, to: 103 },
        ])
    })
})

describe('find/replace plugin reducer (_applyForTest)', () => {
    const empty = { query: '', matches: [], currentIndex: 0 }

    it('setQuery seeds the query + matches and resets currentIndex to 0', () => {
        const doc = fakeDoc([{ text: 'foo foo', pos: 0 }])
        const next = _applyForTest(empty, { setQuery: 'foo' }, doc)
        expect(next.query).toBe('foo')
        expect(next.matches).toHaveLength(2)
        expect(next.currentIndex).toBe(0)
    })

    it('clear meta resets to empty state', () => {
        const doc = fakeDoc([{ text: 'foo', pos: 0 }])
        const seeded = _applyForTest(empty, { setQuery: 'foo' }, doc)
        const cleared = _applyForTest(seeded, { clear: true }, doc)
        expect(cleared).toEqual(empty)
    })

    it('currentIndex meta wraps modulo match count', () => {
        const doc = fakeDoc([{ text: 'foo foo foo', pos: 0 }])
        const seeded = _applyForTest(empty, { setQuery: 'foo' }, doc)
        const fwd1 = _applyForTest(seeded, { currentIndex: 1 }, doc)
        expect(fwd1.currentIndex).toBe(1)
        const fwd3 = _applyForTest(seeded, { currentIndex: 3 }, doc)
        expect(fwd3.currentIndex).toBe(0)
        const back = _applyForTest(seeded, { currentIndex: -1 }, doc)
        expect(back.currentIndex).toBe(2)
    })

    it('docChanged with an active query rescans without losing currentIndex bounds', () => {
        const doc1 = fakeDoc([{ text: 'foo foo foo', pos: 0 }])
        const seeded = _applyForTest(empty, { setQuery: 'foo' }, doc1)
        const moved = _applyForTest(seeded, { currentIndex: 2 }, doc1)
        // Edit removes one match; currentIndex should clamp.
        const doc2 = fakeDoc([{ text: 'foo foo', pos: 0 }])
        const after = _applyForTest(moved, {}, doc2, true)
        expect(after.matches).toHaveLength(2)
        expect(after.currentIndex).toBe(1)
    })

    it('returns prev unchanged when no meta and doc has not changed', () => {
        const doc = fakeDoc([{ text: 'foo', pos: 0 }])
        const seeded = _applyForTest(empty, { setQuery: 'foo' }, doc)
        const after = _applyForTest(seeded, {}, doc, false)
        expect(after).toBe(seeded)
    })
})
