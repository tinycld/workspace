import type { EditorResult } from '@tinycld/core/lib/editor/types'
import type { Editor as TiptapEditor } from '@tiptap/react'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { FindReplaceController } from '../lib/find-replace-controller'

export interface UseDocumentEditorOptions {
    yDoc: Y.Doc
    awareness: Awareness
    user?: { id?: string; name: string; color: string }
    editable?: boolean
    placeholder?: string
    // Forwarded to the native variant which uses it to open the in-
    // WebView realtime connection. Web variant ignores.
    driveItemId?: string
    // Invoked by the slash menu's "Image" entry. The host owns the
    // file/URL picker + drive upload pipeline and routes the resulting
    // src back through `commands.insertImage`. Web-only; native
    // ignores.
    onRequestInsertImage?: () => void
}

// Host-side surface for the comment system. Both variants implement
// the same interface, but the native one routes everything through
// the WebView's message-bus 'comment' namespace. The web variant
// binds directly to the in-page Tiptap editor.
//
// `focusComment` and `getSelection` return Promises because native's
// implementation is a request/response round-trip; the web variant
// resolves synchronously but returns a Promise to keep the interface
// uniform across platforms. `addComment` and `removeComment` are
// fire-and-forget — the mark application is a single WebView message
// with no host-side response needed.
//
// Unmount caveat (native only): a Promise returned by `focusComment`
// or `getSelection` that's still in flight when the editor unmounts
// will never resolve — the WebView is torn down before posting its
// response. Callers should either `void` the result (TextCommentDrawer's
// onJump does this) or guard their `await` with a mounted-flag pattern.
// The leaked resolver is cheap (one Map entry) and doesn't block
// teardown.
//
// Returns null until the underlying editor (Tiptap on web, WebView on
// native) is ready. Consumers should check `commentBridge != null`
// before invoking methods — web waits for Tiptap to mount; native
// waits for the WebView's TenTap-ready signal (the `isReady` flag on
// the EditorResult) so a tap that lands in the brief window before
// the WebView's message listener installs doesn't silently drop the
// request.
export interface DocumentCommentBridge {
    // Apply the comment mark. When `range` is provided the selection is
    // restored to it before the mark is set — required when the call
    // site is a button/modal that has moved focus off the editor,
    // collapsing ProseMirror's selection. Without `range`, falls back
    // to whatever selection the editor currently holds. Native sends
    // `comment.add-with-range` (one round trip, race-free) instead of
    // a setSelection + add pair so the user can't move the cursor
    // between the two.
    addComment: (commentId: string, range?: { from: number; to: number }) => void
    removeComment: (commentId: string) => void
    // Scroll the marked range into view and select it. Resolves with
    // false when the mark isn't present in the doc (e.g. the anchor is
    // orphaned) so the caller can fall back to a drawer-only focus.
    focusComment: (commentId: string) => Promise<boolean>
    getSelection: () => Promise<{ from: number; to: number } | null>
    onTap: (handler: (commentId: string) => void) => () => void
    onRemoved: (handler: (commentIds: string[]) => void) => () => void
}

// The web variant exposes the raw Tiptap editor so web-only consumers
// (FileMenu's markdown export, EditMenu's paste-as-markdown) can walk
// the ProseMirror doc directly. `tiptapEditor` is null on native,
// where the WebView owns the canonical editor and the host shell has
// no ProseMirror dispatch handle. Live word count rides
// toolbarState.wordCount on both platforms — no editor handle needed.
//
// `findReplaceEditor` is the platform-agnostic FindReplaceController
// the FindReplaceBar consumes. Both variants implement it: web wraps
// the in-process Tiptap editor's state + dispatch; native posts
// commands across the WebView and reads state from a host-side
// mirror store. The name is kept for compatibility with existing
// consumers (the underlying type changed from FindReplaceEditor to
// FindReplaceController in D.3 — a future cleanup pass can rename).
export interface DocumentEditorResult extends EditorResult {
    tiptapEditor: TiptapEditor | null
    findReplaceEditor: FindReplaceController | null
    commentBridge: DocumentCommentBridge | null
}

export function useDocumentEditor(options: UseDocumentEditorOptions): DocumentEditorResult
