import { describe, expect, it } from 'vitest'
import {
    buildThreads,
    type CommentRow,
    cellHasUnresolvedThreads,
    cellKey,
    groupCommentsByCell,
} from '../tinycld/calc/lib/comments'

// Pure helpers over the calc_comments row shape. The UI hooks build on
// these — the tests pin the contract so a render-side regression
// (indicator stuck on, popover dropping replies) traces back here.

function row(over: Partial<CommentRow> = {}): CommentRow {
    return {
        id: over.id ?? 'r1',
        drive_item: over.drive_item ?? 'd1',
        sheet_id: over.sheet_id ?? 'sheet1',
        row: over.row ?? 1,
        col: over.col ?? 1,
        parent_comment: over.parent_comment ?? '',
        body: over.body ?? '',
        resolved_at: over.resolved_at ?? '',
        author: over.author ?? 'uo1',
        author_name: over.author_name ?? 'Alice',
        created: over.created ?? '2026-05-10T10:00:00Z',
    }
}

describe('groupCommentsByCell', () => {
    it('produces a Map keyed by sheet:row:col', () => {
        const rows: CommentRow[] = [
            row({ id: 'a', sheet_id: 'sheet1', row: 1, col: 1 }),
            row({ id: 'b', sheet_id: 'sheet1', row: 1, col: 1 }),
            row({ id: 'c', sheet_id: 'sheet1', row: 2, col: 1 }),
            row({ id: 'd', sheet_id: 'sheet2', row: 1, col: 1 }),
        ]
        const grouped = groupCommentsByCell(rows)
        expect(grouped.get(cellKey('sheet1', 1, 1))?.map(r => r.id)).toEqual(['a', 'b'])
        expect(grouped.get(cellKey('sheet1', 2, 1))?.map(r => r.id)).toEqual(['c'])
        expect(grouped.get(cellKey('sheet2', 1, 1))?.map(r => r.id)).toEqual(['d'])
    })
})

describe('buildThreads', () => {
    it('orders root + replies by created', () => {
        const root = row({ id: 'root', created: '2026-05-10T10:00:00Z' })
        const r1 = row({
            id: 'r1',
            parent_comment: 'root',
            created: '2026-05-10T10:00:01Z',
        })
        const r2 = row({
            id: 'r2',
            parent_comment: 'root',
            created: '2026-05-10T10:00:02Z',
        })
        // Pass replies in reverse order to confirm the helper sorts.
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

    it('handles multiple roots on the same cell sorted by created', () => {
        const a = row({ id: 'a', created: '2026-05-10T10:00:00Z' })
        const b = row({ id: 'b', created: '2026-05-10T11:00:00Z' })
        const threads = buildThreads([b, a])
        expect(threads.map(t => t.root.id)).toEqual(['a', 'b'])
    })
})

describe('cellHasUnresolvedThreads', () => {
    it('is false when there are no rows', () => {
        expect(cellHasUnresolvedThreads(undefined)).toBe(false)
        expect(cellHasUnresolvedThreads([])).toBe(false)
    })

    it('is true when at least one root is unresolved', () => {
        const rows = [row({ id: 'a' }), row({ id: 'b', resolved_at: '2026-05-10T11:00:00Z' })]
        expect(cellHasUnresolvedThreads(rows)).toBe(true)
    })

    it('is false when every root is resolved', () => {
        const rows = [
            row({ id: 'a', resolved_at: '2026-05-10T11:00:00Z' }),
            row({ id: 'b', resolved_at: '2026-05-10T12:00:00Z' }),
        ]
        expect(cellHasUnresolvedThreads(rows)).toBe(false)
    })

    it('ignores replies — only roots count', () => {
        const rows = [
            row({ id: 'root', resolved_at: '2026-05-10T11:00:00Z' }),
            // Reply with no resolved_at would be a false-positive if
            // the helper treated replies as standalone threads.
            row({ id: 'reply', parent_comment: 'root' }),
        ]
        expect(cellHasUnresolvedThreads(rows)).toBe(false)
    })
})
