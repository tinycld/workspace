import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import {
    buildThreads,
    type CommentRow,
    cellHasUnresolvedThreads,
    cellKey,
    groupCommentsByCell,
    type Thread,
} from '../lib/comments'

export interface CellCommentsResult {
    rowsByCell: Map<string, CommentRow[]>
    hasUnresolved: (sheetId: string, row: number, col: number) => boolean
    getThreads: (sheetId: string, row: number, col: number) => Thread[]
}

// Subscribes to every comment row for a single workbook (drive_item),
// then groups them by cell once. The two consumer-facing helpers
// (hasUnresolved / getThreads) close over the grouped Map so per-cell
// reads stay O(1) and the work to (re)group on each PB tick is amortized
// across the whole sheet.
//
// Wired at the screen level so all cells share one subscription —
// per-cell useLiveQuery would issue O(visible cells) PB filters.
//
// We use useOrgLiveQuery for the bootstrap-only side effect: the wrapper
// gates the query until org context loads, preventing a cross-org flash
// while the user navigates between orgs. The query body itself does not
// filter by org — comments are scoped to a single drive_item, and PB
// rules already gate access via drive_shares_via_item, so the org
// dimension is redundant in the WHERE.
export function useCellComments(driveItemID: string): CellCommentsResult {
    const [calcCommentsCollection] = useStore('calc_comments')
    const { data: rows = [] } = useOrgLiveQuery(
        query =>
            query
                .from({ comment: calcCommentsCollection })
                .where(({ comment }) => eq(comment.drive_item, driveItemID)),
        [driveItemID]
    )

    return useMemo(() => {
        const rowsByCell = groupCommentsByCell(rows as CommentRow[])
        const hasUnresolved = (sheetId: string, row: number, col: number) =>
            cellHasUnresolvedThreads(rowsByCell.get(cellKey(sheetId, row, col)))
        const getThreads = (sheetId: string, row: number, col: number) =>
            buildThreads(rowsByCell.get(cellKey(sheetId, row, col)) ?? [])
        return { rowsByCell, hasUnresolved, getThreads }
    }, [rows])
}
