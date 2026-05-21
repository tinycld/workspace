import { useBaseCommentMutations } from '@tinycld/core/lib/comments'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { CalcComments } from '../types'

export interface AddCommentArgs {
    driveItemId: string
    sheetId: string
    row: number
    col: number
    body: string
}

export interface ReplyArgs extends AddCommentArgs {
    parentId: string
}

// Calc-side comment mutations. Closes over the calc_comments collection
// and shapes the insert with the cell anchor (sheet_id / row / col).
export function useCommentMutations() {
    const [calcCommentsCollection] = useStore('calc_comments')

    return useBaseCommentMutations<
        Omit<CalcComments, 'created' | 'updated'>,
        AddCommentArgs,
        ReplyArgs
    >({
        insertRow: row => calcCommentsCollection.insert(row),
        updateRow: (id, mutator) => calcCommentsCollection.update(id, mutator),
        deleteRow: id => calcCommentsCollection.delete(id),
        buildInsert: (base, args) => ({
            ...base,
            sheet_id: args.sheetId,
            row: args.row,
            col: args.col,
        }),
    })
}
