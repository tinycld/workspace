// Shared comment shapes. Each package's row type (CalcComments,
// TextComments, future drive_comments) extends BaseCommentRow with its
// own anchor columns (cell coords, mark id, etc.). Threading + resolve
// state live here so the grouping/resolve helpers work across packages.

export interface BaseCommentRow {
    id: string
    drive_item: string
    parent_comment: string
    body: string
    resolved_at: string
    author: string
    author_name: string
    created: string
}

export interface Thread<R extends BaseCommentRow = BaseCommentRow> {
    root: R
    replies: R[]
    resolvedAt: string | null
}
