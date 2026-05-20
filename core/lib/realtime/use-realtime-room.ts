import { useEffect, useRef, useState } from 'react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { PB_SERVER_ADDR } from '../config'
import { captureException } from '../errors'
import { pb } from '../pocketbase'
import { RealtimeClient } from './client'

export interface UseRealtimeRoomOptions {
    // The roomKind name registered on the server side (matches the
    // string passed to realtime.RegisterRoomKind in Go). Determines
    // which authorize handler gates this connection. Empty string
    // disables the room (returns null).
    roomKind: string

    // Opaque identifier for the room within roomKind. For sheets this
    // is the drive_item.id. Empty string disables the room (returns
    // null) — useful while a parent is still loading the id from a
    // query.
    roomID: string

    // Initial awareness state to publish as soon as the connection
    // opens. Consumers fill this with their app-specific shape (user
    // identity, color, view-state). Pass null to leave the slot
    // empty; remote tabs will see only an empty Awareness entry.
    initialAwareness: Record<string, unknown> | null

    // onFirstJoinerBootstrap is called when:
    //   (a) the server's initial SYNC_REPLY says we're alone, OR
    //   (b) the SYNC_REPLY came from a peer but we still look empty
    //       (the peer was a stale ghost or had no state to share).
    //
    // Case (b) protects against rendering an empty doc just because
    // a misbehaving peer answered the handshake first. The consumer
    // decides what "empty" means for its schema via isEmpty.
    //
    // The hook flips isReady=true after the callback resolves (or
    // immediately, if no callback is given).
    onFirstJoinerBootstrap?: (doc: Y.Doc) => Promise<void> | void

    // isEmpty returns true when the doc has no consumer-meaningful
    // state. Used to decide whether onFirstJoinerBootstrap should run
    // even after a peer reply (case (b) above). Defaults to "no
    // top-level shared types defined yet," which is conservative and
    // works for any schema where the consumer's bootstrap creates at
    // least one top-level Y.Map / Y.Array.
    isEmpty?: (doc: Y.Doc) => boolean
}

export interface RealtimeRoomHandle {
    doc: Y.Doc
    awareness: Awareness
    // True after the initial sync handshake (or first-joiner
    // bootstrap) completes. Callers gate their UI on this — render a
    // loading state until then.
    isReady: boolean
    // True while the underlying WebSocket is open. Flips back to
    // false on disconnect and reconnect cycles. Useful for surfacing
    // "reconnecting…" affordances in the UI; orthogonal to isReady,
    // which only flips once.
    isConnected: boolean
    // serverHello carries the payload of the MsgServerHello frame the
    // broker sent on connect, JSON-parsed. Null until the frame
    // arrives. Schema is opaque (defined per room kind); consumers cast
    // to their kind-specific shape. On reconnect, this resets to null
    // and is repopulated when the new connection's hello arrives.
    serverHello: unknown
    // serverSlot carries the latest payload of a MsgServerSlot frame
    // (room-wide server state, e.g. saveStatus). Null until the first
    // frame arrives. Schema is opaque (defined per room kind); consumers
    // cast to their kind-specific shape. Resets to null on disconnect/
    // cleanup; updates on every incoming MsgServerSlot frame.
    serverSlot: unknown
}

// useRealtimeRoom owns one Y.Doc + Awareness pair, opens a WebSocket
// to /api/realtime/<roomKind>/<roomID>, runs the y-protocols/sync
// handshake, and either applies remote state from a peer or invokes
// onFirstJoinerBootstrap to seed an empty doc.
//
// The returned handle is null while the doc/awareness are still being
// constructed (one-frame race with the first effect tick), or while
// roomKind/roomID are empty. Callers should render a loading state
// until both `handle != null` and `handle.isReady`.
//
export function useRealtimeRoom({
    roomKind,
    roomID,
    initialAwareness,
    onFirstJoinerBootstrap,
    isEmpty = defaultIsEmpty,
}: UseRealtimeRoomOptions): RealtimeRoomHandle | null {
    const [isReady, setIsReady] = useState(false)
    const [isConnected, setIsConnected] = useState(false)
    const [serverHello, setServerHello] = useState<unknown>(null)
    const [serverSlot, setServerSlot] = useState<unknown>(null)
    const handleRef = useRef<{ doc: Y.Doc; awareness: Awareness; client: RealtimeClient } | null>(
        null
    )
    // Force a re-render once the doc + awareness are constructed. The
    // ref-only-mutation in the effect would otherwise be invisible to
    // React.
    const [, setBumpKey] = useState(0)

    // biome-ignore lint/correctness/useExhaustiveDependencies: initialAwareness and onFirstJoinerBootstrap are intentionally captured by closure on the first effect run only — we don't want to tear down and re-open the WS every time the caller hands us a new closure reference. roomKind/roomID gate the lifecycle.
    useEffect(() => {
        if (!roomKind || !roomID) return

        const wsURL = buildRealtimeURL(roomKind, roomID)

        const doc = new Y.Doc()
        const awareness = new Awareness(doc)
        if (initialAwareness != null) {
            awareness.setLocalState(initialAwareness)
        }

        let cancelled = false

        const client = new RealtimeClient({
            url: wsURL,
            doc,
            awareness,
            onOpen: () => {
                if (!cancelled) setIsConnected(true)
            },
            onClose: () => {
                if (!cancelled) {
                    setIsConnected(false)
                    setServerHello(null)
                    setServerSlot(null)
                }
            },
            onServerHello: payload => {
                if (cancelled) return
                try {
                    const text = new TextDecoder().decode(payload)
                    const parsed = text.length > 0 ? JSON.parse(text) : null
                    setServerHello(parsed)
                } catch (err) {
                    captureException('realtime: ServerHello JSON parse failed', err, {
                        roomKind,
                        roomID,
                    })
                    setServerHello(null)
                }
            },
            onServerSlot: payload => {
                if (cancelled) return
                try {
                    const text = new TextDecoder().decode(payload)
                    const parsed = text.length > 0 ? JSON.parse(text) : null
                    setServerSlot(parsed)
                } catch (err) {
                    captureException('realtime: ServerSlot JSON parse failed', err, {
                        roomKind,
                        roomID,
                    })
                    setServerSlot(null)
                }
            },
            onSyncReply: async hadPeer => {
                if (cancelled) return
                // Bootstrap when there is no peer at all OR when the
                // peer gave us a reply that left us with no state.
                // The latter happens if the room held a ghost peer
                // (a dead WS that hadn't been cleaned up server-side
                // yet) — falling back to the consumer's bootstrap
                // path keeps us from rendering an empty doc just
                // because we trusted a misbehaving peer.
                const needsBootstrap = !hadPeer || isEmpty(doc)
                if (needsBootstrap && onFirstJoinerBootstrap) {
                    try {
                        await onFirstJoinerBootstrap(doc)
                    } catch (err) {
                        // Surface to Sentry so silent empty-doc
                        // renders don't disappear into the void; the
                        // UI still falls through to its own empty
                        // state, but at least we'll see the cause.
                        captureException('realtime: bootstrap failed', err, {
                            roomKind,
                            roomID,
                        })
                    }
                }
                if (!cancelled) setIsReady(true)
            },
        })

        handleRef.current = { doc, awareness, client }
        setBumpKey(n => n + 1)
        client.connect()

        return () => {
            cancelled = true
            // Signal a clean leave to peers before tearing down the
            // transport. The awareness null-state emits a removal
            // frame that other clients can drop immediately, instead
            // of waiting for the server's heartbeat-loss broadcast.
            // ref: https://docs.yjs.dev/api/about-awareness
            try {
                awareness.setLocalState(null)
            } catch {
                // best effort — destroy below tears it down regardless
            }
            client.destroy()
            awareness.destroy()
            doc.destroy()
            handleRef.current = null
            setIsReady(false)
            setIsConnected(false)
            setServerHello(null)
            setServerSlot(null)
        }
    }, [roomKind, roomID])

    if (!handleRef.current) return null
    return {
        doc: handleRef.current.doc,
        awareness: handleRef.current.awareness,
        isReady,
        isConnected,
        serverHello,
        serverSlot,
    }
}

// defaultIsEmpty considers a Y.Doc empty when no top-level shared
// type has any content. This is a slightly-stronger signal than
// `share.size === 0` — applying a sync reply seeds `share` with the
// type names regardless of whether any content arrived, so we have
// to look inside.
//
// Consumers with unusual schemas (e.g. a Y.Text whose empty state is
// still meaningful) can override via the isEmpty option.
function defaultIsEmpty(doc: Y.Doc): boolean {
    if (doc.share.size === 0) return true
    for (const [, type] of doc.share) {
        if (type instanceof Y.Map && type.size > 0) return false
        if (type instanceof Y.Array && type.length > 0) return false
        if (type instanceof Y.Text && type.length > 0) return false
    }
    return true
}

// PB_SERVER_ADDR is the resolved PocketBase origin set during app
// init — same-origin on web, an explicit http(s):// URL on native
// (from the EXPO_PUBLIC_ENV → serverShortcuts mapping in coreConfig).
// Using it here keeps the realtime WS pointed at the same server as
// every other API call, on every platform.
function buildRealtimeURL(roomKind: string, roomID: string): string {
    const httpURL = `${PB_SERVER_ADDR}/api/realtime/${encodeURIComponent(roomKind)}/${encodeURIComponent(roomID)}`
    const wsURL = httpURL.replace(/^http/i, 'ws')
    // Browsers can't set custom headers on a WebSocket upgrade, so we
    // attach the PB auth token as a query param. The server's
    // handleConnect reads it via FindAuthRecordByToken when re.Auth
    // hasn't already been populated. React Native's WebSocket has the
    // same limitation, so the same token-in-query approach works.
    const token = pb.authStore.token
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ''
    return `${wsURL}${tokenQuery}`
}
