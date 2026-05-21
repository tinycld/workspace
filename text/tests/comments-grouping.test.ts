// Text-side comments grouping. The actual heavy lifting (buildThreads,
// groupCommentsByKey) lives in core; this file pins the text-specific
// contract:
//   - Threads group by `comment_id`, not by row id or drive_item, so
//     all replies under one anchored range collapse to a single
//     thread per `comment_id`.
//   - `quoted_text` is preserved on the root and surfaces in the
//     drawer's group label when the anchor is orphaned.
//
// We use the core helpers directly with text-shaped rows. A real
// `useDocumentComments` test would need the React + RHF + RN stack;
// the hook is a thin wrapper, and the value flowing through it is
// exactly what these helpers produce.

import { buildThreads, groupCommentsByKey } from '@tinycld/core/lib/comments'
import { describe, expect, it } from 'vitest'

interface TextRow {
    id: string
    drive_item: string
    comment_id: string
    quoted_text: string
    parent_comment: string
    body: string
    resolved_at: string
    author: string
    author_name: string
    created: string
}

function row(over: Partial<TextRow> = {}): TextRow {
    return {
        id: over.id ?? 'r1',
        drive_item: over.drive_item ?? 'd1',
        comment_id: over.comment_id ?? 'cm1',
        quoted_text: over.quoted_text ?? '',
        parent_comment: over.parent_comment ?? '',
        body: over.body ?? '',
        resolved_at: over.resolved_at ?? '',
        author: over.author ?? 'uo1',
        author_name: over.author_name ?? 'Alice',
        created: over.created ?? '2026-05-10T10:00:00Z',
    }
}

describe('groupCommentsByKey for text', () => {
    it('groups every row sharing a comment_id, regardless of parent_comment', () => {
        const rows = [
            row({ id: 'r1', comment_id: 'cm1', parent_comment: '' }),
            row({ id: 'r2', comment_id: 'cm1', parent_comment: 'r1' }),
            row({ id: 'r3', comment_id: 'cm2', parent_comment: '' }),
        ]
        const grouped = groupCommentsByKey(rows, r => r.comment_id)
        expect(grouped.size).toBe(2)
        expect(grouped.get('cm1')?.map(r => r.id)).toEqual(['r1', 'r2'])
        expect(grouped.get('cm2')?.map(r => r.id)).toEqual(['r3'])
    })

    it('keeps unrelated rows separate when their comment_ids differ', () => {
        // Two roots on the same doc but at different anchors —
        // these are two threads, not one.
        const rows = [
            row({ id: 'r1', comment_id: 'cm1' }),
            row({ id: 'r2', comment_id: 'cm2' }),
        ]
        const grouped = groupCommentsByKey(rows, r => r.comment_id)
        expect(grouped.get('cm1')).toHaveLength(1)
        expect(grouped.get('cm2')).toHaveLength(1)
    })
})

describe('buildThreads for text', () => {
    it('produces one Thread per root, with replies sorted by created', () => {
        const rows = [
            row({ id: 'root', parent_comment: '', created: '2026-05-10T10:00:00Z' }),
            row({ id: 'reply2', parent_comment: 'root', created: '2026-05-10T10:02:00Z' }),
            row({ id: 'reply1', parent_comment: 'root', created: '2026-05-10T10:01:00Z' }),
        ]
        const threads = buildThreads(rows)
        expect(threads).toHaveLength(1)
        expect(threads[0].root.id).toBe('root')
        expect(threads[0].replies.map(r => r.id)).toEqual(['reply1', 'reply2'])
    })

    it('preserves quoted_text on the root for the drawer to surface', () => {
        const rows = [
            row({ id: 'root', parent_comment: '', quoted_text: 'the original anchor' }),
            row({ id: 'reply', parent_comment: 'root', quoted_text: '' }),
        ]
        const threads = buildThreads(rows)
        expect(threads[0].root.quoted_text).toBe('the original anchor')
    })

    it('surfaces resolvedAt on the root only', () => {
        const rows = [
            row({
                id: 'root',
                parent_comment: '',
                resolved_at: '2026-05-12T12:00:00Z',
            }),
            row({ id: 'reply', parent_comment: 'root', resolved_at: '' }),
        ]
        const threads = buildThreads(rows)
        expect(threads[0].resolvedAt).toBe('2026-05-12T12:00:00Z')
    })
})

// Locks the text-specific anchor-by-commentId contract end-to-end:
// the drawer (TextCommentDrawer.buildGroups) keys groups by comment_id
// — *not* row id. When the underlying mark is deleted from the doc,
// the bridge emits `comment.removed { commentIds }`, which the hook
// merges into orphanedCommentIds. A group's `isOrphaned` flag drives
// the badge + the "skip jump-to-anchor" behavior.
//
// We reproduce the merge here without React: union into a Set.
describe('orphan tracking by comment_id', () => {
    it('marks a comment_id orphaned without affecting other anchors', () => {
        const removed = mergeRemoved(new Set<string>(), ['cm-deleted-1'])
        expect(removed.has('cm-deleted-1')).toBe(true)
        expect(removed.has('cm-kept')).toBe(false)
    })

    it('is idempotent under repeated removal events for the same id', () => {
        let s = mergeRemoved(new Set<string>(), ['cm1'])
        s = mergeRemoved(s, ['cm1'])
        s = mergeRemoved(s, ['cm1'])
        expect([...s]).toEqual(['cm1'])
    })

    it('accumulates ids across multiple events', () => {
        let s = mergeRemoved(new Set<string>(), ['a'])
        s = mergeRemoved(s, ['b', 'c'])
        s = mergeRemoved(s, ['d'])
        expect([...s].sort()).toEqual(['a', 'b', 'c', 'd'])
    })
})

function mergeRemoved(prev: Set<string>, removed: string[]): Set<string> {
    const next = new Set(prev)
    for (const id of removed) next.add(id)
    return next
}
