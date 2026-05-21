import { Mark, type Range } from '@tiptap/core'

// Tiptap mark anchoring a comment thread to a range of text. The
// `commentId` attribute matches the `comment_id` column of the
// text_comments PB collection. The mark itself replicates through Yjs
// XmlFragment, which is the source of truth for the anchor position —
// concurrent edits migrate the range automatically.
//
// Two-way attribute round-tripping (parseHTML + renderHTML) is required:
// y-prosemirror serializes marks to HTML when fragments cross the
// y-prosemirror boundary, and ProseMirror reads them back through the
// same parser. Omitting either side drops the commentId on the first
// remote update.

export interface CommentRange {
    commentId: string
    from: number
    to: number
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        tinycldComment: {
            addComment: (commentId: string) => ReturnType
            removeComment: (commentId: string) => ReturnType
        }
    }
}

export interface CommentMarkStorage {
    findComment: (commentId: string) => Range | null
    getAllComments: () => CommentRange[]
}

export const CommentMark = Mark.create<unknown, CommentMarkStorage>({
    name: 'tinycldComment',
    inclusive: false,
    excludes: '',
    keepOnSplit: true,
    addAttributes() {
        return {
            commentId: {
                default: null,
                parseHTML: el => el.getAttribute('data-comment-id'),
                renderHTML: attrs => {
                    if (!attrs.commentId) return {}
                    return { 'data-comment-id': attrs.commentId as string }
                },
            },
        }
    },
    parseHTML() {
        return [{ tag: 'span[data-comment-id]' }]
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', { ...HTMLAttributes, class: 'tinycld-comment' }, 0]
    },
    addCommands() {
        return {
            addComment:
                (commentId: string) =>
                ({ commands }) =>
                    commands.setMark(this.name, { commentId }),
            removeComment:
                (commentId: string) =>
                ({ tr, state, dispatch }) => {
                    const ranges = collectCommentRanges(state.doc, commentId)
                    if (ranges.length === 0) return false
                    if (dispatch) {
                        const markType = state.schema.marks[this.name]
                        for (const r of ranges) {
                            tr.removeMark(r.from, r.to, markType)
                        }
                    }
                    return true
                },
        }
    },
    addStorage() {
        return {
            findComment: () => null,
            getAllComments: () => [],
        }
    },
    onCreate() {
        this.storage.findComment = (commentId: string) => {
            const ranges = collectCommentRanges(this.editor.state.doc, commentId)
            return ranges[0] ?? null
        }
        this.storage.getAllComments = () => collectAllCommentRanges(this.editor.state.doc)
    },
})

function collectCommentRanges(doc: ProseDoc, commentId: string): Range[] {
    const out: Range[] = []
    doc.descendants((node, pos) => {
        for (const mark of node.marks) {
            if (mark.type.name !== 'tinycldComment') continue
            if (mark.attrs.commentId !== commentId) continue
            out.push({ from: pos, to: pos + node.nodeSize })
        }
        return true
    })
    return out
}

function collectAllCommentRanges(doc: ProseDoc): CommentRange[] {
    const out: CommentRange[] = []
    doc.descendants((node, pos) => {
        for (const mark of node.marks) {
            if (mark.type.name !== 'tinycldComment') continue
            const commentId = mark.attrs.commentId as string | null
            if (!commentId) continue
            out.push({ commentId, from: pos, to: pos + node.nodeSize })
        }
        return true
    })
    return out
}

// Snapshots the set of commentIds present on marks in the doc. Plain
// Set so callers can diff before/after a transaction with new Set ops.
export function snapshotCommentIds(doc: ProseDoc): Set<string> {
    const ids = new Set<string>()
    doc.descendants(node => {
        for (const mark of node.marks) {
            if (mark.type.name !== 'tinycldComment') continue
            const id = mark.attrs.commentId as string | null
            if (id) ids.add(id)
        }
        return true
    })
    return ids
}

interface ProseNode {
    nodeSize: number
    readonly marks: ReadonlyArray<{ type: { name: string }; attrs: Record<string, unknown> }>
}

interface ProseDoc {
    descendants(fn: (node: ProseNode, pos: number) => boolean | void): void
}
