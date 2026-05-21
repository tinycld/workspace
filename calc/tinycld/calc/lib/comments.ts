import {
    type BaseCommentRow,
    buildThreads as buildThreadsCore,
    groupCommentsByKey,
    hasUnresolvedThreads,
    type Thread as ThreadCore,
} from '@tinycld/core/lib/comments'
import type { CalcComments } from '../types'

// CommentRow is the subset of fields the UI cares about. Stays
// compatible with the pbtsdb row shape (CalcComments) so we can pass
// liveQuery results through without copying.
export type CommentRow = Pick<
    CalcComments,
    | 'id'
    | 'drive_item'
    | 'sheet_id'
    | 'row'
    | 'col'
    | 'parent_comment'
    | 'body'
    | 'resolved_at'
    | 'author'
    | 'author_name'
    | 'created'
>

// Re-exported so calc consumers keep their `Thread` import unchanged.
export type Thread = ThreadCore<CommentRow>

// Compile-time guard: CommentRow must remain assignable to BaseCommentRow.
type _AssertBase = CommentRow extends BaseCommentRow ? true : never
const _checkBase: _AssertBase = true
void _checkBase

export function cellKey(sheetId: string, row: number, col: number): string {
    return `${sheetId}:${row}:${col}`
}

export function groupCommentsByCell(rows: CommentRow[]): Map<string, CommentRow[]> {
    return groupCommentsByKey(rows, r => cellKey(r.sheet_id, r.row, r.col))
}

export function buildThreads(rowsForCell: CommentRow[]): Thread[] {
    return buildThreadsCore(rowsForCell)
}

export function cellHasUnresolvedThreads(rowsForCell: CommentRow[] | undefined): boolean {
    return hasUnresolvedThreads(rowsForCell)
}
