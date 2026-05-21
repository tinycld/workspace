import { useAuth } from '@tinycld/core/lib/auth'
import type { RealtimeRoomHandle } from '@tinycld/core/lib/realtime/use-realtime-room'
import { colorForUser } from '../lib/color-for-user'
import { useDocumentEditor } from './use-document-editor'
import { typedServerHello, typedServerSlot } from './useTextRoom'

// useTextDocument wires the realtime room's Y.Doc + Awareness into the
// shared document editor and surfaces the text-specific server slot
// state (saveStatus) alongside the editor result.
//
// User identity: CollaborationCaret writes its `user` option into
// `awareness.user` on mount via setLocalStateField, unconditionally
// (it defaults to `{ name: null, color: null }` when no user option
// is supplied). That clobbers whatever useTextRoom seeded into the
// awareness slot via `initialAwareness`. So we pass the same
// {id, name, color} shape here — CollaborationCaret then writes a
// valid identity, and PresenceAvatars' parseSlot accepts it.
//
// driveItemId is forwarded to the native editor variant, which uses
// it to open its own realtime connection inside the WebView (the
// native-side `room` is for serverHello/serverSlot only — its Y.Doc
// is not bound to the WebView editor). The web variant ignores it.
export function useTextDocument(
    room: RealtimeRoomHandle,
    driveItemId: string,
    options: { onRequestInsertImage?: () => void } = {}
) {
    const { user } = useAuth()
    const hello = typedServerHello(room)
    const slot = typedServerSlot(room)
    const editorResult = useDocumentEditor({
        yDoc: room.doc,
        awareness: room.awareness,
        editable: !hello.readOnly,
        driveItemId,
        onRequestInsertImage: options.onRequestInsertImage,
        user: user
            ? { id: user.id, name: user.name, color: colorForUser(user.id) }
            : undefined,
    })
    return {
        ...editorResult,
        saveStatus: slot.saveStatus,
        // `tiptapEditor` is the raw Tiptap Editor (web) or null (native).
        // Forwarded so the FileMenu's markdown export, EditMenu's
        // paste-as-markdown, and similar web-only consumers can walk the
        // ProseMirror doc directly without a bridge round-trip. (Word
        // count moved off this surface in Milestone D.1 — it now rides
        // toolbarState.wordCount on both platforms.)
        tiptapEditor: editorResult.tiptapEditor,
    }
}
