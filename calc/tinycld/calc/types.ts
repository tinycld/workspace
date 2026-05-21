import type { DriveItems, UserOrg } from '@tinycld/core/types/pbSchema'

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// One PB row per posted comment / reply. The root of a thread has
// parent_comment empty; replies point at the root. resolved_at lives on
// the root only — replies inherit. author_name is snapshotted at write
// time so a removed user still renders with a name.
export interface CalcComments {
    id: string
    drive_item: string
    sheet_id: string
    row: number
    col: number
    parent_comment: string
    body: string
    resolved_at: string
    author: string
    author_name: string
    created: string
    updated: string
}

export type CalcSchema = {
    calc_comments: {
        type: CalcComments
        relations: {
            drive_item: DriveItems
            parent_comment?: CalcComments
            author: UserOrg
        }
    }
}
