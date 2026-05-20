import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { type Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { readSyncMessage, writeSyncStep1 } from 'y-protocols/sync'
import * as Y from 'yjs'

// Wire format: every frame is `clientID(16 bytes) || msgType(1 byte) || payload`.
// The clientID is assigned by the server: after WS open, the first
// inbound frame is MSG_ASSIGN_ID, whose 16-byte prefix IS the
// assignment. The client uses that ID as the prefix on every
// outgoing frame; the server validates and rejects mismatches.
const CLIENT_ID_LEN = 16
const FRAME_OVERHEAD = CLIENT_ID_LEN + 1

const MSG_DOC_UPDATE = 0x01
const MSG_AWARENESS_UPDATE = 0x02
const MSG_SYNC_REQUEST = 0x03
const MSG_SYNC_REPLY = 0x04
const MSG_ASSIGN_ID = 0x05
const MSG_SERVER_HELLO = 0x06
const MSG_SERVER_SLOT = 0x07

// Reconnect backoff: start small, cap so a long-down server doesn't
// hammer us. The backoff resets on a successful connect.
const RECONNECT_INITIAL_MS = 500
const RECONNECT_MAX_MS = 30_000

export interface RealtimeClientOptions {
    url: string
    doc: Y.Doc
    awareness: Awareness
    // onSyncReply fires once when the server returns the initial
    // SYNC_REPLY. `hadPeer` is true iff the reply carried real doc
    // state from another connected client. When false, the caller
    // is the sole connected client and (depending on the consumer)
    // may need to seed the doc itself — for example, sheets parses
    // an .xlsx blob to populate cells when no peer is present.
    onSyncReply?: (hadPeer: boolean) => void
    // onServerHello fires when the server sends a MsgServerHello frame
    // (immediately after MsgAssignID, before sync). Payload bytes are
    // opaque to the client; consumers JSON-parse and cast to their
    // kind-specific type. Fires at most once per connection (re-fires
    // on reconnect).
    onServerHello?: (payload: Uint8Array) => void
    // onServerSlot fires when the server broadcasts a room-wide state
    // update via Room.PublishServerSlot. Payload bytes are opaque to
    // the client; consumers JSON-parse and cast to their kind-specific
    // type. May fire multiple times per connection (every state change).
    onServerSlot?: (payload: Uint8Array) => void
    // onClose / onOpen are observability hooks, mostly for tests.
    onOpen?: () => void
    onClose?: () => void
}

// QueuedFrame is a frame the client wanted to send before the server
// assigned its ID. The connect-time queue is flushed in order once
// MSG_ASSIGN_ID arrives.
interface QueuedFrame {
    msgType: number
    payload: Uint8Array
}

// RealtimeClient speaks the realtime broker's wire protocol over a
// single WebSocket. It mounts onto a Y.Doc + Awareness pair, runs the
// y-protocols/sync handshake on connect, and bidirectionally streams
// document updates and awareness updates with REMOTE_ORIGIN-tagged
// echo suppression.
//
// The class is package-agnostic. Sheets is the first consumer; mail,
// calendar, drive can each instantiate their own RealtimeClient with a
// roomKind-specific URL and the same wire protocol.
export class RealtimeClient {
    private opts: RealtimeClientOptions
    private ws: WebSocket | null = null
    // Server-assigned routing ID. Null until MSG_ASSIGN_ID arrives.
    // While null, outbound frames are queued and flushed on assignment.
    private clientID: Uint8Array | null = null
    private destroyed = false
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectDelay = RECONNECT_INITIAL_MS
    private docUpdateHandler: (update: Uint8Array, origin: unknown) => void
    private awarenessUpdateHandler: (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown
    ) => void
    private syncReplyReceived = false
    private pendingFrames: QueuedFrame[] = []

    constructor(opts: RealtimeClientOptions) {
        this.opts = opts

        // Local doc updates → push as DOC_UPDATE frames. Both
        // network-applied origins (REMOTE_ORIGIN for routine updates,
        // SYNC_ORIGIN for handshake-applied state) are suppressed to
        // avoid echoing back what we just received. They're separate
        // sentinels so the undo manager and any future "is this a
        // handshake-time apply" predicate can distinguish them.
        this.docUpdateHandler = (update, origin) => {
            if (this.destroyed) return
            if (origin === REMOTE_ORIGIN || origin === SYNC_ORIGIN) return
            this.send(MSG_DOC_UPDATE, update)
        }
        opts.doc.on('update', this.docUpdateHandler)

        // Local awareness changes → push as AWARENESS_UPDATE frames.
        // Only encode the local client's slot; remote clients' state
        // round-trips through the server unchanged.
        this.awarenessUpdateHandler = (changes, origin) => {
            if (this.destroyed) return
            if (origin === REMOTE_ORIGIN || origin === SYNC_ORIGIN) return
            const ids = [...changes.added, ...changes.updated, ...changes.removed]
            // Only forward our own slot; receiving peers' echoes is the
            // server's job, and forwarding them back would create a
            // ping-pong.
            const localID = opts.awareness.clientID
            if (!ids.includes(localID)) return
            const payload = encodeAwarenessUpdate(opts.awareness, [localID])
            this.send(MSG_AWARENESS_UPDATE, payload)
        }
        opts.awareness.on('update', this.awarenessUpdateHandler)
    }

    connect(): void {
        if (this.destroyed) return
        const ws = new WebSocket(this.opts.url)
        ws.binaryType = 'arraybuffer'
        this.ws = ws

        ws.onopen = () => {
            if (this.destroyed) {
                ws.close()
                return
            }
            this.reconnectDelay = RECONNECT_INITIAL_MS
            this.opts.onOpen?.()
            // Don't start the y-protocols/sync handshake yet — we
            // can't send frames before the server assigns our ID.
            // The MSG_ASSIGN_ID handler kicks off the sync request.
        }

        ws.onmessage = evt => {
            this.onFrame(new Uint8Array(evt.data as ArrayBuffer))
        }

        ws.onclose = () => {
            // A reconnect drops the assigned ID — the server will issue
            // a new one on the next MSG_ASSIGN_ID.
            this.clientID = null
            this.syncReplyReceived = false
            this.pendingFrames = []
            this.opts.onClose?.()
            if (this.destroyed) return
            this.scheduleReconnect()
        }

        ws.onerror = () => {
            // The browser fires onclose right after onerror; let the
            // close handler do the reconnect bookkeeping.
        }
    }

    destroy(): void {
        this.destroyed = true
        this.opts.doc.off('update', this.docUpdateHandler)
        this.opts.awareness.off('update', this.awarenessUpdateHandler)
        if (this.reconnectTimer != null) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        if (this.ws != null) {
            try {
                this.ws.close()
            } catch {
                // best effort
            }
            this.ws = null
        }
    }

    private scheduleReconnect() {
        if (this.destroyed) return
        const delay = this.reconnectDelay
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.connect()
        }, delay)
    }

    private send(msgType: number, payload: Uint8Array): void {
        // Queue if we don't yet have an assigned ID; the queue is
        // drained the moment MSG_ASSIGN_ID arrives. Without queueing,
        // any awareness/doc update fired between WS-open and
        // ID-assignment would be silently lost.
        if (this.clientID == null) {
            this.pendingFrames.push({ msgType, payload })
            return
        }
        this.sendNow(msgType, payload)
    }

    private sendNow(msgType: number, payload: Uint8Array): void {
        const ws = this.ws
        if (ws == null || ws.readyState !== WebSocket.OPEN) return
        const id = this.clientID
        if (id == null) return
        const frame = new Uint8Array(FRAME_OVERHEAD + payload.length)
        frame.set(id, 0)
        frame[CLIENT_ID_LEN] = msgType
        frame.set(payload, FRAME_OVERHEAD)
        ws.send(frame)
    }

    private onFrame(frame: Uint8Array): void {
        if (frame.length < FRAME_OVERHEAD) return
        const senderID = frame.subarray(0, CLIENT_ID_LEN)
        const msgType = frame[CLIENT_ID_LEN]
        const payload = frame.subarray(FRAME_OVERHEAD)

        switch (msgType) {
            case MSG_ASSIGN_ID: {
                // Stash the assigned ID; flush any frames that local
                // doc/awareness handlers tried to send before it
                // arrived; then kick off the y-protocols/sync handshake.
                const id = new Uint8Array(CLIENT_ID_LEN)
                id.set(frame.subarray(0, CLIENT_ID_LEN))
                this.clientID = id

                const queued = this.pendingFrames
                this.pendingFrames = []
                for (const q of queued) {
                    this.sendNow(q.msgType, q.payload)
                }

                const enc = encoding.createEncoder()
                writeSyncStep1(enc, this.opts.doc)
                this.sendNow(MSG_SYNC_REQUEST, encoding.toUint8Array(enc))
                break
            }

            case MSG_SERVER_HELLO: {
                // Server-originated handshake state. Surface to consumer;
                // never apply to doc/awareness ourselves.
                this.opts.onServerHello?.(payload)
                break
            }

            case MSG_SERVER_SLOT: {
                // Server-originated room-wide state. Surface to consumer;
                // never apply to doc/awareness ourselves.
                this.opts.onServerSlot?.(payload)
                break
            }

            case MSG_DOC_UPDATE:
                Y.applyUpdate(this.opts.doc, payload, REMOTE_ORIGIN)
                break

            case MSG_AWARENESS_UPDATE:
                if (payload.length === 0) {
                    // Synthetic leave frame: a peer's connection
                    // closed. The server emits these so we can drop
                    // remote awareness slots even on ungraceful
                    // disconnect. We don't know which slot was theirs
                    // from the frame alone — the awareness layer will
                    // age it out via heartbeat absence, or the next
                    // refresh of their state will re-populate.
                    break
                }
                applyAwarenessUpdate(this.opts.awareness, payload, REMOTE_ORIGIN)
                break

            case MSG_SYNC_REQUEST: {
                // A peer is asking us for state. readSyncMessage on a
                // step1 payload reads our doc and writes a step2 reply
                // into replyEnc — it doesn't apply anything to our doc.
                // The SYNC_ORIGIN tag is irrelevant for step1 in
                // practice, but we use it consistently so any future
                // protocol change that does apply updates here flows
                // through the same suppression path as MSG_SYNC_REPLY.
                //
                // The wire shape for a SYNC_REPLY is:
                //   [our ID(16)] || msgType || [requester's ID(16)] || replyPayload
                // The broker uses the embedded target ID to deliver only
                // to the requester, so we have to prepend it here.
                const decoder = decoding.createDecoder(payload)
                const replyEnc = encoding.createEncoder()
                readSyncMessage(decoder, replyEnc, this.opts.doc, SYNC_ORIGIN)
                if (encoding.length(replyEnc) > 0) {
                    const replyPayload = encoding.toUint8Array(replyEnc)
                    const targeted = new Uint8Array(CLIENT_ID_LEN + replyPayload.length)
                    targeted.set(senderID, 0)
                    targeted.set(replyPayload, CLIENT_ID_LEN)
                    this.send(MSG_SYNC_REPLY, targeted)
                }
                break
            }

            case MSG_SYNC_REPLY: {
                const hadPeer = payload.length > 0
                if (hadPeer) {
                    // Apply the peer's doc state under SYNC_ORIGIN so
                    // the doc-update listener doesn't bounce these
                    // updates back over the wire (they came FROM the
                    // wire) and so the undo manager doesn't capture
                    // remote handshake state as a local undo step.
                    const decoder = decoding.createDecoder(payload)
                    const replyEnc = encoding.createEncoder()
                    readSyncMessage(decoder, replyEnc, this.opts.doc, SYNC_ORIGIN)
                    // SyncStep2's response (a SyncStep2 of our own) is
                    // typically empty; we ignore it.
                }
                if (!this.syncReplyReceived) {
                    this.syncReplyReceived = true
                    this.opts.onSyncReply?.(hadPeer)
                }
                break
            }
        }
    }
}

// REMOTE_ORIGIN tags routine updates received from the network (peer
// doc/awareness updates after the initial handshake completes). The
// doc/awareness `update` listeners suppress fan-out for this origin
// to avoid echoing what we just received.
export const REMOTE_ORIGIN: unique symbol = Symbol('realtime:remote')

// SYNC_ORIGIN tags updates applied during the y-protocols/sync
// handshake (initial state transfer between peers). Functionally
// behaves like REMOTE_ORIGIN — fan-out suppressed, undo manager
// excluded — but is a separate sentinel so consumers can distinguish
// "ongoing remote edits" from "this was the initial state load."
// Kept distinct so future protocol changes that apply updates during
// sync don't accidentally cause divergence by sharing one sentinel
// with two semantically different roles.
export const SYNC_ORIGIN: unique symbol = Symbol('realtime:sync')

// LOCAL_ORIGIN tags transactions that originate from the local user's
// direct edits (e.g. typing into a cell). Consumers should pass this
// to `doc.transact(fn, LOCAL_ORIGIN)` so the undo manager can
// allowlist it. Without an explicit origin, yjs defaults to `null`
// for transactions — which works but is brittle (any other yjs
// integration that also uses `null` would be conflated with our
// edits).
export const LOCAL_ORIGIN: unique symbol = Symbol('realtime:local')
