import { eq } from '@tanstack/db'
import { buildThreads, groupCommentsByKey } from '@tinycld/core/lib/comments'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCommentsDrawerStore } from '@tinycld/core/lib/stores/comments-drawer-store'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import {
    CommentDrawer,
    type CommentDrawerGroup,
} from '@tinycld/core/ui/comments'
import { useMemo } from 'react'
import { useGridStoreApi } from '../../hooks/use-grid-store'
import { useCommentMutations } from '../../hooks/use-comment-mutations'
import type { CommentRow } from '../../lib/comments'
import { columnLabel } from '../../lib/workbook-types'

export interface CalcCommentDrawerProps {
    driveItemId: string
    sheets: ReadonlyArray<{ id: string; name: string }>
    activeSheetId: string
    onActivateSheet: (sheetId: string) => void
}

// Drawer mounted inside Grid (so it lives inside the GridStoreProvider
// and can call selectCell imperatively). Subscribes directly to the
// workbook's comment rows — independent of useCellComments so the
// drawer stays useful when no Grid is rendering (e.g. while a sheet
// transition is in flight). Grouping mirrors the popover's per-cell
// threads, labeled as "Sheet1!B7".
export function CalcCommentDrawer({
    driveItemId,
    sheets,
    activeSheetId,
    onActivateSheet,
}: CalcCommentDrawerProps) {
    const storeIsOpen = useCommentsDrawerStore(s => s.isOpen)
    const storeDriveItemId = useCommentsDrawerStore(s => s.driveItemId)
    const focusedThreadId = useCommentsDrawerStore(s => s.focusedThreadId)
    const close = useCommentsDrawerStore(s => s.close)
    const focusThread = useCommentsDrawerStore(s => s.focusThread)
    const isOpen = storeIsOpen && storeDriveItemId === driveItemId

    const [calcCommentsCollection] = useStore('calc_comments')
    const { data: rows = [] } = useOrgLiveQuery(
        query =>
            query
                .from({ comment: calcCommentsCollection })
                .where(({ comment }) => eq(comment.drive_item, driveItemId)),
        [driveItemId]
    )

    const { userOrgId } = useCurrentRole()
    const { reply, editBody, resolve, reopen, remove } = useCommentMutations()
    const gridStore = useGridStoreApi()

    const sheetNameById = useMemo(() => {
        const m = new Map<string, string>()
        for (const s of sheets) m.set(s.id, s.name)
        return m
    }, [sheets])

    const { groups, anchorByKey } = useMemo(
        () => buildGroups(rows as CommentRow[], sheetNameById),
        [rows, sheetNameById]
    )

    if (!isOpen) return null

    return (
        <CommentDrawer<CommentRow>
            isOpen={isOpen}
            onClose={close}
            groups={groups}
            currentUserOrgId={userOrgId}
            focusedThreadId={focusedThreadId}
            onJump={group => {
                const anchor = anchorByKey.get(group.key)
                if (!anchor) return
                if (anchor.sheetId !== activeSheetId) {
                    onActivateSheet(anchor.sheetId)
                }
                gridStore.getState().selectCell({ row: anchor.row, col: anchor.col })
                focusThread(group.threads[0]?.root.id ?? null)
            }}
            isReplyPending={reply.isPending}
            replyError={reply.error ? String(reply.error.message ?? reply.error) : null}
            onReply={(group, threadId, body) => {
                const anchor = anchorByKey.get(group.key)
                if (!anchor) return
                reply.mutate({
                    driveItemId,
                    sheetId: anchor.sheetId,
                    row: anchor.row,
                    col: anchor.col,
                    parentId: threadId,
                    body,
                })
            }}
            onEdit={(id, body) => editBody.mutate({ id, body })}
            onDelete={id => remove.mutate({ id })}
            onResolve={id => resolve.mutate({ id })}
            onReopen={id => reopen.mutate({ id })}
        />
    )
}

interface CalcAnchor {
    sheetId: string
    row: number
    col: number
}

function buildGroups(
    rows: CommentRow[],
    sheetNameById: Map<string, string>
): {
    groups: CommentDrawerGroup<CommentRow>[]
    anchorByKey: Map<string, CalcAnchor>
} {
    const byCell = groupCommentsByKey(rows, r => `${r.sheet_id}:${r.row}:${r.col}`)
    const groups: CommentDrawerGroup<CommentRow>[] = []
    const anchorByKey = new Map<string, CalcAnchor>()
    for (const [key, cellRows] of byCell) {
        const threads = buildThreads(cellRows)
        if (threads.length === 0) continue
        const first = cellRows[0]
        const anchor: CalcAnchor = {
            sheetId: first.sheet_id,
            row: first.row,
            col: first.col,
        }
        anchorByKey.set(key, anchor)
        const sheetName = sheetNameById.get(anchor.sheetId) ?? 'Sheet'
        groups.push({
            key,
            label: `${sheetName}!${columnLabel(anchor.col)}${anchor.row}`,
            threads,
        })
    }
    groups.sort((a, b) => {
        const aResolved = a.threads.every(t => t.resolvedAt != null) ? 1 : 0
        const bResolved = b.threads.every(t => t.resolvedAt != null) ? 1 : 0
        if (aResolved !== bResolved) return aResolved - bResolved
        return a.label.localeCompare(b.label)
    })
    return { groups, anchorByKey }
}
