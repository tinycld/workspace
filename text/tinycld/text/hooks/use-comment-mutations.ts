import { useBaseCommentMutations } from '@tinycld/core/lib/comments'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { TextComments } from '../types'

export interface AddCommentArgs {
    driveItemId: string
    commentId: string
    quotedText: string
    body: string
}

export interface ReplyArgs {
    driveItemId: string
    commentId: string
    quotedText: string
    parentId: string
    body: string
}

// Text-side comment mutations. Closes over the text_comments collection
// and shapes the insert with the comment_id anchor + quoted_text
// snapshot. Wired with the shared comment_mentions collection so any
// `[[@user_org_id]]` token in the body yields a notify-triggering row
// alongside the comment insert.
export function useCommentMutations() {
    const [textCommentsCollection, commentMentionsCollection] = useStore(
        'text_comments',
        'comment_mentions'
    )

    return useBaseCommentMutations<
        Omit<TextComments, 'created' | 'updated'>,
        AddCommentArgs,
        ReplyArgs
    >({
        insertRow: row => textCommentsCollection.insert(row),
        updateRow: (id, mutator) => textCommentsCollection.update(id, mutator),
        deleteRow: id => textCommentsCollection.delete(id),
        buildInsert: (base, args) => ({
            ...base,
            comment_id: args.commentId,
            quoted_text: args.quotedText,
        }),
        mentions: {
            commentCollection: 'text_comments',
            insertMention: row => commentMentionsCollection.insert(row),
        },
    })
}
