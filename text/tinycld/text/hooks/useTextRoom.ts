import { useAuth } from '@tinycld/core/lib/auth'
import { captureException } from '@tinycld/core/lib/errors'
import {
    type RealtimeRoomHandle,
    useRealtimeRoom,
} from '@tinycld/core/lib/realtime/use-realtime-room'
import { z } from 'zod'
import { colorForUser } from '../lib/color-for-user'

export const serverHelloSchema = z.object({
    readOnly: z.boolean(),
    importWarnings: z.array(
        z.object({
            code: z.string(),
            detail: z.string().optional(),
        })
    ),
})

export const serverSlotSchema = z.object({
    saveStatus: z.union([z.literal('ok'), z.literal('failed')]),
})

export type TextServerHello = z.infer<typeof serverHelloSchema>
export type TextServerSlot = z.infer<typeof serverSlotSchema>

const defaultHello: TextServerHello = { readOnly: false, importWarnings: [] }
const defaultSlot: TextServerSlot = { saveStatus: 'ok' }

// useTextRoom is the text-specific wrapper around core's useRealtimeRoom.
// It supplies the 'text-doc' roomKind and stamps the local awareness
// slot with the current user's identity so collaboration cursors render
// with a name + deterministic color. The same identity gets re-applied
// when useTextDocument mounts the editor — Tiptap's CollaborationCaret
// extension writes its `user` option into awareness.user on mount via
// setLocalStateField, so its `user` option must carry an identity
// PresenceAvatars accepts (id/name/color). Without the identity here,
// PresenceAvatars wouldn't render anything for the brief window between
// WS connect and editor mount; without the identity at the editor
// layer, CollaborationCaret would clobber this slot with its
// `{name: null, color: null}` default.
//
// The server (text/server) populates the room's Y.Doc from the source
// .docx before the first SyncReply goes out, so the client never needs
// to fetch or parse docx bytes.
//
// On native, the in-WebView editor opens its own realtime room
// connection inside the WebView's JS context (see
// use-document-editor.native.tsx for the architecture). This native-
// side room is kept open purely for:
//   - hello.readOnly: the share-role gate that disables the editor
//   - hello.importWarnings: surfaced via ImportWarningBanner
//   - slot.saveStatus: surfaced via the save-status indicator
// The native room's Y.Doc is NOT bound to the WebView editor; the
// WebView holds the canonical editing Y.Doc.
//
// Awareness cleanup: useRealtimeRoom's effect cleanup (see
// `packages/@tinycld/core/lib/realtime/use-realtime-room.ts`) already
// calls `awareness.setLocalState(null)` before tearing down the
// transport on unmount or roomKind/roomID change. That covers logout,
// route change, and tab close — remote peers see a clean awareness
// removal frame instead of a frozen ghost cursor. No additional
// cleanup is needed here.
//
// TODO(text-native v1.1): on native, the in-WebView editor opens a
// SEPARATE realtime connection with its OWN awareness identity. That
// means the local user appears as TWO collaborators to remote peers
// (one native client, one WebView client). To dedupe, either:
//   1. Suppress this native room's awareness slot (don't pass
//      initialAwareness) and route presence through a message-bus
//      relay from the WebView to PresenceAvatars.
//   2. Tag awareness records with a clientGroupId and dedupe in
//      PresenceAvatars.
// Option 1 is cleaner but requires touching the PresenceAvatars
// consumer. Picking the right approach depends on what other native
// callers need from the native-side room's awareness.
export function useTextRoom(driveItemId: string): RealtimeRoomHandle | null {
    const { user } = useAuth()
    const userId = user?.id ?? ''
    const userName = user?.name ?? ''

    return useRealtimeRoom({
        roomKind: 'text-doc',
        roomID: driveItemId,
        initialAwareness: userId
            ? {
                  user: { id: userId, name: userName, color: colorForUser(userId) },
                  cursor: null,
              }
            : null,
    })
}

// typedServerHello narrows the realtime room's opaque serverHello payload
// to the text-specific shape via zod, with safe defaults when the hello
// hasn't arrived yet, the room handle is still null, or the payload
// fails validation (e.g. a server-side schema drift). Parse failures
// route through captureException so a silently-discarded payload still
// surfaces in Sentry.
export function typedServerHello(room: RealtimeRoomHandle | null): TextServerHello {
    if (room == null || room.serverHello == null) {
        return defaultHello
    }
    const result = serverHelloSchema.safeParse(room.serverHello)
    if (!result.success) {
        captureException('useTextRoom.serverHello.parse', result.error, {
            payload: room.serverHello,
        })
        return defaultHello
    }
    return result.data
}

// typedServerSlot narrows the realtime room's opaque serverSlot payload
// via zod. Defaults to 'ok' so the SaveStatus indicator doesn't flash
// 'failed' before the first slot frame arrives; the SaveStatusIndicator
// layers its own Offline state on top when isConnected is false.
export function typedServerSlot(room: RealtimeRoomHandle | null): TextServerSlot {
    if (room == null || room.serverSlot == null) {
        return defaultSlot
    }
    const result = serverSlotSchema.safeParse(room.serverSlot)
    if (!result.success) {
        captureException('useTextRoom.serverSlot.parse', result.error, {
            payload: room.serverSlot,
        })
        return defaultSlot
    }
    return result.data
}
