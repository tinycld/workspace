package realtime

import (
	"bytes"
	"log/slog"
	"sync"
)

// sendBufferSize is the number of frames buffered per client. A slow
// reader that backs up past this many frames is dropped — that is, the
// broker prefers to disconnect a stuck client over blocking the room.
const sendBufferSize = 64

// Room holds the set of currently-connected clients for one (kind, id)
// pair plus the fan-out routing logic. Members access mu via add, remove,
// and the routing methods.
type Room struct {
	broker *Broker
	key    roomKey
	opts   RoomKindOptions

	// serverDoc is the broker's authoritative mirror of the room's
	// document state. Non-nil iff the room kind registered a
	// RuntimeProvider. When non-nil, every inbound MsgDocUpdate is
	// applied here before fan-out, and MsgSyncRequest replies are
	// served from EncodeStateAsUpdate. Closed exactly once on
	// teardown after the OnEmpty callback (if any) returns.
	serverDoc DocHandle

	mu sync.Mutex
	// nextSeq is the per-room monotonic seq counter for journal
	// Append calls. After construction it is mutated only by route
	// while holding r.mu. During newRoom it is written without the
	// lock — safe because the Room pointer has not yet been published
	// to the broker map. Starts at 0 and is incremented before each
	// append; the first appended seq is 1. After a successful Replay
	// on room bootstrap, nextSeq becomes max(replayedSeq) so
	// subsequent appends continue past what's already in the journal.
	nextSeq int64
	members map[*Client]struct{}
}

func newRoom(b *Broker, key roomKey, opts RoomKindOptions) *Room {
	r := &Room{
		broker:  b,
		key:     key,
		opts:    opts,
		members: map[*Client]struct{}{},
	}
	if opts.RuntimeProvider != nil {
		handle, err := opts.RuntimeProvider.NewDoc(key.id)
		if err != nil {
			// Construction failure falls back to pure-relay
			// behavior: clients can still join and fan out frames
			// among themselves; only the server-side mirror (and
			// therefore persistence) is disabled for this room.
			slog.Error(
				"realtime: DocRuntime.NewDoc failed; falling back to pure relay",
				"kind", key.kind, "roomID", key.id, "err", err,
			)
		} else {
			r.serverDoc = handle
			if opts.Journal != nil {
				// Fold any previously-journaled updates into the
				// freshly-bootstrapped Y.Doc. The bootstrap hook
				// (e.g. text's makeDocxBootstrap) has already seeded
				// the doc from the durable snapshot; Replay then
				// applies edits the server accepted but never
				// snapshotted. Order matters: snapshot first, WAL
				// second. If Replay fails partway, we keep the
				// room as-is (partial state) and log — better than
				// refusing the connection on a transient PB error.
				//
				// The closure advances nextSeq BEFORE attempting
				// ApplyUpdate so the in-memory counter always
				// reflects the durable journal's high-water mark,
				// not the doc's last-successful-apply. An apply
				// failure leaves a gap in the Y.Doc but preserves
				// the unique-seq invariant for subsequent appends.
				replayErr := opts.Journal.Replay(key.kind, key.id, func(seq int64, update []byte) error {
					if seq > r.nextSeq {
						r.nextSeq = seq
					}
					if applyErr := r.serverDoc.ApplyUpdate(update); applyErr != nil {
						return applyErr
					}
					return nil
				})
				if replayErr != nil {
					slog.Error(
						"realtime: journal replay failed; room continues with partial state",
						"kind", key.kind, "roomID", key.id, "err", replayErr,
					)
				}
			}
			if opts.OnRoomCreate != nil {
				opts.OnRoomCreate(key.id, handle, r)
			}
		}
	}
	return r
}

func (r *Room) add(c *Client) {
	c.room = r
	c.send = make(chan []byte, sendBufferSize)
	r.mu.Lock()
	r.members[c] = struct{}{}
	r.mu.Unlock()
}

// remove drops a client from the room and releases the empty room back
// to the broker. broadcastLeave should be called separately by the
// transport layer once the client's send loop has stopped, so that
// remaining members get a synthetic "this user left" frame.
//
// When this drops the last member, the room invokes its OnEmpty
// callback (synchronously) before closing the server-side DocHandle.
// OnEmpty is allowed to take time (e.g. a final persistence flush);
// the broker's removeRoom call is what frees the room key, and that
// is intentionally deferred until OnEmpty returns so a quick rejoin
// of the same room observes a fresh slate.
func (r *Room) remove(c *Client) {
	r.mu.Lock()
	delete(r.members, c)
	empty := len(r.members) == 0
	r.mu.Unlock()
	close(c.send)
	if empty {
		if r.opts.OnEmpty != nil {
			r.opts.OnEmpty(r.key.id)
		}
		if r.serverDoc != nil {
			if err := r.serverDoc.Close(); err != nil {
				slog.Warn(
					"realtime: DocHandle.Close failed",
					"kind", r.key.kind, "roomID", r.key.id, "err", err,
				)
			}
			r.serverDoc = nil
		}
		r.broker.removeRoom(r.key)
	}
}

func (r *Room) isEmpty() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.members) == 0
}

// route handles a single frame the transport layer just read off `from`'s
// WebSocket. The frame is the full wire bytes (clientID || msgType || payload).
// The broker decides who else should receive it.
func (r *Room) route(from *Client, frame []byte) {
	if len(frame) < frameOverhead {
		return
	}
	msgType := MessageType(frame[clientIDLen])
	switch msgType {
	case MsgDocUpdate:
		payload := frame[frameOverhead:]
		limit := r.opts.MaxUpdateBytes
		if limit == 0 {
			limit = DefaultMaxUpdateBytes
		}
		if len(payload) > limit {
			slog.Warn(
				"realtime: MsgDocUpdate exceeds cap; dropping",
				"kind", r.key.kind, "roomID", r.key.id,
				"size", len(payload), "cap", limit,
			)
			return
		}
		// appendedSeq holds the seq that was minted and durably
		// appended for THIS frame, captured at append-time. It stays
		// 0 when no append occurred (Journal nil, serverDoc nil, or
		// the append failed and was rolled back). The OnDocUpdateSeq
		// hook below gates on appendedSeq > 0 so we never report a
		// seq that wasn't actually journaled by this call.
		var appendedSeq int64
		// Journal first: durably record the update before applying
		// it server-side or fanning out. A failed append rejects
		// the frame entirely — the sender's local Y.Doc retains
		// the edit, and a successful future update re-propagates.
		// This is the SIGKILL-survives invariant.
		//
		// Note on ordering: only seq minting is serialized under r.mu.
		// Append, ApplyUpdate, and fanOut run outside the lock, so under
		// concurrent route calls peers may observe updates fanned out in
		// non-seq order. This is correct: Yjs updates are CRDT-commutative,
		// and Replay sorts by seq, so the durable state and the in-memory
		// Y.Doc converge regardless of inter-goroutine interleaving.
		if r.opts.Journal != nil && r.serverDoc != nil {
			r.mu.Lock()
			r.nextSeq++
			seq := r.nextSeq
			r.mu.Unlock()
			if err := r.opts.Journal.Append(r.key.kind, r.key.id, seq, payload); err != nil {
				slog.Warn(
					"realtime: journal append failed; dropping MsgDocUpdate",
					"kind", r.key.kind, "roomID", r.key.id, "seq", seq, "err", err,
				)
				// Roll back the seq so the next attempt reuses it.
				r.mu.Lock()
				if r.nextSeq == seq {
					r.nextSeq--
				}
				r.mu.Unlock()
				return
			}
			appendedSeq = seq
		}
		// Apply to the server-side mirror first so a malformed update
		// fails fast and we don't fan out a corrupt frame to peers.
		// If no server mirror is configured, the broker is in pure-
		// relay mode for this kind and we just forward.
		if r.serverDoc != nil {
			if err := r.serverDoc.ApplyUpdate(payload); err != nil {
				slog.Warn(
					"realtime: ApplyUpdate rejected an inbound MsgDocUpdate; dropping frame",
					"kind", r.key.kind, "roomID", r.key.id, "err", err,
				)
				return
			}
		}
		r.fanOut(from, frame)
		if r.opts.OnDocUpdate != nil {
			r.opts.OnDocUpdate(r.key.id)
		}
		if r.opts.OnDocUpdateSeq != nil && appendedSeq > 0 {
			r.opts.OnDocUpdateSeq(r.key.id, appendedSeq)
		}
	case MsgAwarenessUpdate:
		r.fanOut(from, frame)
	case MsgSyncRequest:
		// If a server-side mirror is configured, the server is the
		// source of truth: build a SyncReply directly from the
		// mirror and send it to the requester. Skip the peer-bounce
		// path entirely.
		if r.serverDoc != nil {
			state, err := r.serverDoc.EncodeStateAsUpdate()
			if err != nil {
				slog.Warn(
					"realtime: EncodeStateAsUpdate failed; falling back to peer bounce",
					"kind", r.key.kind, "roomID", r.key.id, "err", err,
				)
			} else {
				deliver(from, makeServerSyncReply(state))
				return
			}
		}
		// Fall back to the legacy pure-relay path: forward to one
		// current peer (longest-connected).
		peer := r.pickSyncPeer(from)
		if peer != nil {
			deliver(peer, frame)
			return
		}
		// No peer: the requester is alone. Send back an empty reply so
		// the client knows to fall back to its bootstrap path
		// (e.g. parsing the .xlsx for sheets).
		deliver(from, makeEmptySyncReply())
	case MsgSyncReply:
		// SyncReply targets one specific client by ID. The first
		// clientID prefix in the frame is the *replying* peer (whoever
		// they are); the recipient is identified by an additional
		// 16-byte target ID immediately after the message-type tag.
		if len(frame) < frameOverhead+clientIDLen {
			return
		}
		var target [clientIDLen]byte
		copy(target[:], frame[frameOverhead:frameOverhead+clientIDLen])
		// Strip the routing target from the frame the recipient sees;
		// the recipient only needs the sender ID + reply payload.
		// Single allocation + two copies into pre-sized buffer
		// instead of two appends.
		stripped := make([]byte, len(frame)-clientIDLen)
		copy(stripped, frame[:frameOverhead])
		copy(stripped[frameOverhead:], frame[frameOverhead+clientIDLen:])
		r.deliverByID(target, stripped)
	}
}

// fanOut writes frame to every member of the room except `from`.
func (r *Room) fanOut(from *Client, frame []byte) {
	r.mu.Lock()
	peers := make([]*Client, 0, len(r.members))
	for c := range r.members {
		if c != from {
			peers = append(peers, c)
		}
	}
	r.mu.Unlock()
	for _, c := range peers {
		deliver(c, frame)
	}
}

// pickSyncPeer chooses the longest-connected peer that isn't the requester.
// Returns nil if no peer exists.
func (r *Room) pickSyncPeer(from *Client) *Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best *Client
	for c := range r.members {
		if c == from {
			continue
		}
		if best == nil || c.joinedAt.Before(best.joinedAt) {
			best = c
		}
	}
	return best
}

// deliverByID sends frame to the room member whose id matches target.
func (r *Room) deliverByID(target [clientIDLen]byte, frame []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for c := range r.members {
		if bytes.Equal(c.id[:], target[:]) {
			deliver(c, frame)
			return
		}
	}
}

// broadcastLeave synthesizes a frame announcing that `c` has disconnected
// and fans it out to remaining members. Called by the transport once the
// client's read/write loop has finished.
//
// Convention: a leave is signaled as an awareness frame from `c` with a
// zero-byte payload. The y-protocols/awareness encoding for "remove this
// client" is what clients should send on graceful close, but we send our
// own zero-length frame as a fallback so that ungraceful disconnects (TCP
// reset, killed tab) also surface to peers.
func (r *Room) broadcastLeave(c *Client) {
	frame := make([]byte, frameOverhead)
	copy(frame[:clientIDLen], c.id[:])
	frame[clientIDLen] = byte(MsgAwarenessUpdate)
	r.fanOut(c, frame)
}

// deliver pushes a frame to a client's send buffer. If the buffer is
// full, the frame is dropped — the read loop in register.go is expected
// to detect a stuck client via separate liveness checks.
func deliver(c *Client, frame []byte) {
	select {
	case c.send <- frame:
	default:
		// Buffer overflow: drop. A persistently slow client will be
		// disconnected by the transport's idle/keepalive logic.
	}
}

// makeEmptySyncReply builds a "you are alone, no peers" reply. The
// route handler delivers it to the requester directly by pointer, so
// no target ID is needed inside the frame. The sender-ID prefix is
// left as 16 zero bytes; the client doesn't validate inbound sender
// IDs (only outbound), so this is a routing detail rather than an
// authenticated marker.
func makeEmptySyncReply() []byte {
	frame := make([]byte, frameOverhead)
	frame[clientIDLen] = byte(MsgSyncReply)
	return frame
}

// makeServerSyncReply builds a SyncReply frame whose payload is the
// server-side mirror's encoded state, wrapped in a y-protocols/sync
// "step2" envelope so the client's readSyncMessage handler dispatches
// it correctly.
//
// The y-protocols sync wire shape for step2 is:
//
//	varUint(messageYjsSyncStep2 == 1) || varUint8Array(updateBytes)
//
// Without this envelope, the raw update bytes are interpreted by the
// client as a y-protocols message — and for an empty server-side doc
// the leading byte happens to parse as messageYjsSyncStep1 (==0),
// triggering a degenerate decode path that throws "Unexpected end of
// array". Sender-ID prefix is left zero for the same reason as
// makeEmptySyncReply.
func makeServerSyncReply(state []byte) []byte {
	envelope := encodeSyncStep2(state)
	frame := make([]byte, frameOverhead+len(envelope))
	frame[clientIDLen] = byte(MsgSyncReply)
	copy(frame[frameOverhead:], envelope)
	return frame
}

// encodeSyncStep2 writes the y-protocols/sync step2 envelope: a
// varuint message-type tag (==1) followed by a length-prefixed copy
// of the update bytes. Mirrors writeSyncStep2 in y-protocols/sync.js.
func encodeSyncStep2(update []byte) []byte {
	const messageYjsSyncStep2 = 1
	out := make([]byte, 0, 1+varUintSize(uint64(len(update)))+len(update))
	out = appendVarUint(out, messageYjsSyncStep2)
	out = appendVarUint(out, uint64(len(update)))
	out = append(out, update...)
	return out
}

// appendVarUint writes lib0-compatible varuint encoding (7 bits per
// byte little-endian, MSB set on continuation). lib0/encoding's
// writeVarUint produces the same bytes.
func appendVarUint(dst []byte, n uint64) []byte {
	for n >= 0x80 {
		dst = append(dst, byte(n)|0x80)
		n >>= 7
	}
	return append(dst, byte(n))
}

// varUintSize returns how many bytes appendVarUint would write for n.
func varUintSize(n uint64) int {
	size := 1
	for n >= 0x80 {
		n >>= 7
		size++
	}
	return size
}

// serverSlotID is the reserved 16-byte client-ID under which the broker
// itself publishes room-wide state via PublishServerSlot. Placed at
// 0xFF... so it cannot collide with crypto/rand-generated client IDs
// (which are uniformly distributed across the full 16-byte space, but
// the probability of randomly hitting all-0xFF except a 16-bit suffix
// is 2^-112 — well below any realistic deployment).
//
// Clients that render presence avatars must filter out this ID (and
// any future reserved IDs in the same prefix range).
var serverSlotID = [clientIDLen]byte{
	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x01,
}

// IsReservedClientID reports whether the given 16-byte ID is in the
// reserved range used for server-published slots. UI consumers (e.g.
// presence-avatar renderers) must skip slots with reserved IDs.
func IsReservedClientID(id [clientIDLen]byte) bool {
	for i := 0; i < clientIDLen-2; i++ {
		if id[i] != 0xFF {
			return false
		}
	}
	return true
}

// PublishServerSlot broadcasts a server-originated state payload to
// every member of the room. The frame is constructed with the reserved
// serverSlotID as its sender prefix and tagged MsgServerSlot, then
// fanned out via the existing broadcaster.
//
// Used by consumers (text, future packages) that need to surface
// room-wide server state — e.g. saveStatus indicators. Clients route
// this frame to a dedicated onServerSlot callback rather than the
// y-protocols awareness layer, so payload format is consumer-defined.
//
// MsgServerSlot is the routing-level signal that the frame is
// server-originated; the serverSlotID sender prefix is kept for
// self-consistency and so UI presence renderers can also filter it
// out via IsReservedClientID.
func (r *Room) PublishServerSlot(payload []byte) {
	frame := make([]byte, frameOverhead+len(payload))
	copy(frame[:clientIDLen], serverSlotID[:])
	frame[clientIDLen] = byte(MsgServerSlot)
	copy(frame[frameOverhead:], payload)
	// fanOut(nil, frame) — passing nil as `from` excludes nobody;
	// every member receives the frame.
	r.fanOut(nil, frame)
}
