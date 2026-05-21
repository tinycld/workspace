import type { DriveItems, UserOrg } from '@tinycld/core/types/pbSchema'

// One PB row per posted comment / reply. The root of a thread has
// parent_comment empty; replies point at the root. resolved_at lives on
// the root only — replies inherit. author_name is snapshotted at write
// time so a removed user still renders with a name.
//
// comment_id matches the Tiptap mark's `commentId` attribute; the mark
// itself replicates through Yjs's XmlFragment and is the source of
// truth for anchor position. quoted_text snapshots the anchored text
// at insert time, used by the drawer when the anchor is orphaned.
export interface TextComments {
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
    updated: string
}

export type TextSchema = {
    text_comments: {
        type: TextComments
        relations: {
            drive_item: DriveItems
            parent_comment?: TextComments
            author: UserOrg
        }
    }
}
