import { describe, expect, it } from 'vitest'
import type { BaseCommentRow } from '../comments'
import { buildThreads, groupCommentsByKey, hasUnresolvedThreads } from '../comments'

// Pure helpers shared across @tinycld/calc and @tinycld/text. Pins the
// generic contract; package-level tests cover the package-specific
// anchor keys (cellKey for calc, commentId for text).

interface TestRow extends BaseCommentRow {
    anchor: string
}

function row(over: Partial<TestRow> = {}): TestRow {
    return {
        id: over.id ?? 'r1',
        drive_item: over.drive_item ?? 'd1',
        anchor: over.anchor ?? 'a1',
        parent_comment: over.parent_comment ?? '',
        body: over.body ?? '',
        resolved_at: over.resolved_at ?? '',
        author: over.author ?? 'uo1',
        author_name: over.author_name ?? 'Alice',
        created: over.created ?? '2026-05-10T10:00:00Z',
    }
}

describe('groupCommentsByKey', () => {
    it('partitions rows by the caller-supplied key', () => {
        const rows: TestRow[] = [
            row({ id: 'a', anchor: 'x' }),
            row({ id: 'b', anchor: 'x' }),
            row({ id: 'c', anchor: 'y' }),
        ]
        const grouped = groupCommentsByKey(rows, r => r.anchor)
        expect(grouped.get('x')?.map(r => r.id)).toEqual(['a', 'b'])
        expect(grouped.get('y')?.map(r => r.id)).toEqual(['c'])
    })
})

describe('buildThreads', () => {
    it('orders root + replies by created', () => {
        const root = row({ id: 'root', created: '2026-05-10T10:00:00Z' })
        const r1 = row({ id: 'r1', parent_comment: 'root', created: '2026-05-10T10:00:01Z' })
        const r2 = row({ id: 'r2', parent_comment: 'root', created: '2026-05-10T10:00:02Z' })
        const threads = buildThreads([r2, r1, root])
        expect(threads).toHaveLength(1)
        expect(threads[0].root.id).toBe('root')
        expect(threads[0].replies.map(r => r.id)).toEqual(['r1', 'r2'])
    })

    it('marks resolvedAt from the root only', () => {
        const root = row({ id: 'root', resolved_at: '2026-05-10T11:00:00Z' })
        const reply = row({ id: 'reply', parent_comment: 'root' })
        const [thread] = buildThreads([root, reply])
        expect(thread.resolvedAt).toBe('2026-05-10T11:00:00Z')
    })

    it('drops orphan replies with no matching root', () => {
        const orphan = row({ id: 'orphan', parent_comment: 'nope' })
        expect(buildThreads([orphan])).toEqual([])
    })

    it('sorts multiple roots by created', () => {
        const a = row({ id: 'a', created: '2026-05-10T10:00:00Z' })
        const b = row({ id: 'b', created: '2026-05-10T11:00:00Z' })
        expect(buildThreads([b, a]).map(t => t.root.id)).toEqual(['a', 'b'])
    })

    it('breaks created ties by id for deterministic ordering', () => {
        const a = row({ id: 'a', created: '2026-05-10T10:00:00Z' })
        const b = row({ id: 'b', created: '2026-05-10T10:00:00Z' })
        expect(buildThreads([b, a]).map(t => t.root.id)).toEqual(['a', 'b'])
    })
})

describe('hasUnresolvedThreads', () => {
    it('is false when there are no rows', () => {
        expect(hasUnresolvedThreads(undefined)).toBe(false)
        expect(hasUnresolvedThreads([])).toBe(false)
    })

    it('is true when at least one root is unresolved', () => {
        const rows = [row({ id: 'a' }), row({ id: 'b', resolved_at: '2026-05-10T11:00:00Z' })]
        expect(hasUnresolvedThreads(rows)).toBe(true)
    })

    it('is false when every root is resolved', () => {
        const rows = [
            row({ id: 'a', resolved_at: '2026-05-10T11:00:00Z' }),
            row({ id: 'b', resolved_at: '2026-05-10T12:00:00Z' }),
        ]
        expect(hasUnresolvedThreads(rows)).toBe(false)
    })

    it('ignores replies — only roots count', () => {
        const rows = [
            row({ id: 'root', resolved_at: '2026-05-10T11:00:00Z' }),
            row({ id: 'reply', parent_comment: 'root' }),
        ]
        expect(hasUnresolvedThreads(rows)).toBe(false)
    })
})
