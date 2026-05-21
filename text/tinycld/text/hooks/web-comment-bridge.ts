import type { Editor as TiptapEditor } from '@tiptap/react'
import type { DocumentCommentBridge } from './use-document-editor'

// Host-side comment bridge for the web variant of useDocumentEditor.
// Mirrors the split that native already has (hooks/native-comment-bridge.ts)
// so the two platforms keep symmetric file layouts: the hook orchestrates
// refs + effects, the factory builds the bridge object.
//
// The tap + removed handler Sets and the lastCommentIds tracking
// Set are owned by the hook (they need to survive across re-renders
// via refs), but the bridge's methods only need to mutate them — pass
// the Sets in as options and the factory closes over them. That keeps
// the factory pure (no hooks, easy to unit-test) without forcing the
// hook to plumb each handler-mutation through a callback.

export interface WebCommentBridgeOptions {
    tiptapEditor: TiptapEditor
    tapHandlers: Set<(commentId: string) => void>
    removedHandlers: Set<(commentIds: string[]) => void>
}

export function createWebCommentBridge(opts: WebCommentBridgeOptions): DocumentCommentBridge {
    const { tiptapEditor, tapHandlers, removedHandlers } = opts

    return {
        addComment: (commentId: string, range?: { from: number; to: number }) => {
            // When a range is provided we restore the selection before
            // applying the mark — the NewCommentButton flow captures
            // the user's selection *before* the modal opens, because
            // opening the modal steals focus and collapses ProseMirror's
            // selection to a single point. Without `setTextSelection`
            // the mark would land on a zero-width range (or whatever
            // the editor's last surviving range was), making the anchor
            // effectively useless.
            const chain = tiptapEditor.chain()
            if (range) chain.setTextSelection(range)
            chain.addComment(commentId).run()
        },
        removeComment: (commentId: string) => {
            tiptapEditor.chain().removeComment(commentId).run()
        },
        focusComment: (commentId: string) => {
            // Mark storage is populated on editor onCreate (see
            // comment-mark.ts) — `findComment` returns the first range
            // carrying the id, or null if it's been removed from the
            // doc. The Promise wrapping keeps the interface uniform
            // with native, which round-trips through the WebView
            // message bus.
            const storage = (tiptapEditor.storage as unknown as Record<string, unknown>)['tinycldComment'] as
                | { findComment?: (id: string) => { from: number; to: number } | null }
                | undefined
            const range = storage?.findComment?.(commentId) ?? null
            if (!range) return Promise.resolve(false)
            tiptapEditor.chain().setTextSelection(range).scrollIntoView().focus().run()
            return Promise.resolve(true)
        },
        getSelection: () => {
            const sel = tiptapEditor.state.selection
            if (sel.empty) return Promise.resolve(null)
            return Promise.resolve({ from: sel.from, to: sel.to })
        },
        onTap: handler => {
            tapHandlers.add(handler)
            return () => {
                tapHandlers.delete(handler)
            }
        },
        onRemoved: handler => {
            removedHandlers.add(handler)
            return () => {
                removedHandlers.delete(handler)
            }
        },
    }
}
