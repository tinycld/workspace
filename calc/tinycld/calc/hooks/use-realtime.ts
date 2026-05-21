import { useAuth } from '@tinycld/core/lib/auth'
import {
    type RealtimeRoomHandle,
    useRealtimeRoom,
} from '@tinycld/core/lib/realtime/use-realtime-room'

export interface UseRealtimeOptions {
    // The drive_item.id used as the room identifier.
    workbookId: string
}

// useRealtime is the calc-specific wrapper around core's
// useRealtimeRoom. It supplies the "calc" roomKind and stamps the
// local awareness slot with calc-shaped initial state.
//
// The server (calc/server/bootstrap_hook.go) populates the room's Y.Doc
// from the source .xlsx before the first SyncReply goes out, so the
// client never needs to fetch or parse xlsx bytes.
export function useRealtime({ workbookId }: UseRealtimeOptions): RealtimeRoomHandle | null {
    const { user } = useAuth()
    return useRealtimeRoom({
        roomKind: 'calc',
        roomID: workbookId,
        initialAwareness: {
            user: { id: user.id, name: user.name, color: colorForUser(user.id) },
            sheetId: null,
            selection: null,
            editing: null,
        },
    })
}

// colorForUser produces a deterministic HSL color string from a user id.
// Same user → same color across sessions and across other users' views.
function colorForUser(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = (h * 31 + id.charCodeAt(i)) >>> 0
    }
    const hue = h % 360
    return `hsl(${hue}, 70%, 45%)`
}
