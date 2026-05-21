// Salvage helpers for Edit → Paste as Markdown.
//
// Each top-level markdown block is inserted in its own chain.run(). If
// the parsed PM tree is rejected by the schema (mark exclusivity,
// disallowed content, a thrown RangeError, …) the same block's
// *original markdown source* is inserted as a plain paragraph
// instead, so the user sees the failing chunk verbatim and the rest
// of the paste survives.
//
// These helpers live in their own module (not in EditMenu.tsx) so
// unit tests can import them without pulling in the menubar's
// gluestack/react-native UI imports.

import type { Editor as TiptapEditor } from '@tiptap/react'
import type { MarkdownBlock } from '../../lib/markdown/md-to-pm'

// Block-level content the Tiptap insertContent chain accepts.
type InsertContent = Parameters<TiptapEditor['commands']['insertContent']>[0]

export interface InsertResult {
    succeeded: number // blocks inserted as parsed PM
    salvaged: number // blocks inserted as a plaintext fallback after the parsed version failed
    failed: number // blocks where even the plaintext fallback was refused or unavailable
}

// Wraps a slice of original markdown source as a single plain
// paragraph node.
function plaintextParagraph(source: string) {
    return {
        type: 'paragraph',
        content: [{ type: 'text', text: source }],
    }
}

// Single best-effort insert at end-of-doc. Returns true on success,
// false on either a thrown exception (schema error from ProseMirror)
// or a chain that ran cleanly but refused the command.
function tryInsert(editor: TiptapEditor, node: InsertContent): boolean {
    try {
        const endPos = Math.max(0, editor.state.doc.content.size)
        return editor
            .chain()
            .focus()
            .setTextSelection(endPos)
            .insertContent(node)
            .run()
    } catch {
        return false
    }
}

// Insert each parsed block at end-of-doc in order. On rejection,
// retry with a plain-paragraph version of the block's source. Each
// block runs in its own chain so a single bad block doesn't abort
// the rest. tryInsert re-reads doc size before each insert so blocks
// land in source order at the moving tail.
export function insertBlocksSequentially(
    editor: TiptapEditor,
    blocks: MarkdownBlock[]
): InsertResult {
    let succeeded = 0
    let salvaged = 0
    let failed = 0
    for (const { block, source } of blocks) {
        if (tryInsert(editor, block as InsertContent)) {
            succeeded++
            continue
        }
        if (
            source.length > 0 &&
            tryInsert(editor, plaintextParagraph(source) as InsertContent)
        ) {
            salvaged++
            continue
        }
        failed++
    }
    return { succeeded, salvaged, failed }
}

// Last-resort total-failure path: drop the entire markdown source as a
// single plain paragraph so the user always gets something to work
// with, even on a catastrophic schema mismatch.
export function insertPlaintext(editor: TiptapEditor, source: string): boolean {
    if (source.length === 0) return false
    return tryInsert(editor, plaintextParagraph(source) as InsertContent)
}
