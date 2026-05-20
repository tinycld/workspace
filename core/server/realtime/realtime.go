// Package realtime is a generic in-memory WebSocket room broker for
// Yjs collaboration. It fans out opaque binary frames between connected
// clients of the same room. Document state, awareness, and the
// y-protocols sync handshake all flow over the same connection,
// multiplexed by a 1-byte message-type tag.
//
// The broker does not interpret payloads. Each room kind plugs in its
// own Go authorize handler via RegisterRoomKind. Sheets is the first
// consumer; other packages (mail, calendar, drive) can use the same
// primitive for their own collaboration features.
//
// State is fully in-memory: when the last client of a room disconnects,
// the room is gone. There is no durability layer here — that is by
// design. Consumers who need persistent collaborative state must layer
// it on top (e.g. by exporting periodic snapshots to durable storage).
//
// Authorization invariant: the only server-enforced gate is the
// per-room-kind Authorize callback at connection time. Once admitted,
// peers can send any wire frames the protocol supports, and the broker
// fans them out unchanged. Yjs has no built-in granular access control
// (no field/key-level ACL inside a doc), so consumers that need
// finer-grained edit authorization must enforce it at a higher layer
// (typically the durability layer that decides what to persist).
//   ref: https://discuss.yjs.dev/t/common-concepts-best-practices/2436
package realtime

import (
	"sync"
	"time"
)

// MessageType identifies the kind of payload a frame carries. The broker
// only uses this for routing decisions; the payload bytes themselves are
// opaque.
type MessageType byte

const (
	// MsgDocUpdate carries a Yjs document update. Fanned out to every
	// other client in the room.
	MsgDocUpdate MessageType = 0x01
	// MsgAwarenessUpdate carries a y-protocols awareness update. Fanned
	// out to every other client in the room.
	MsgAwarenessUpdate MessageType = 0x02
	// MsgSyncRequest is sent by a joining client asking for current doc
	// state. Forwarded to one current peer (longest-connected).
	MsgSyncRequest MessageType = 0x03
	// MsgSyncReply carries the response to a SyncRequest. Forwarded only
	// to the original requester.
	MsgSyncReply MessageType = 0x04
	// MsgAssignID is the very first frame the server sends to a freshly
	// connected client. Its payload is empty; the routing-ID prefix
	// IS the assignment. Subsequent inbound frames from this client
	// must use the same prefix or the connection is closed.
	MsgAssignID MessageType = 0x05
	// MsgServerHello is sent by the server immediately after MsgAssignID
	// (and before sync) when the room kind has registered an OnConnect
	// ServerHelloFn. The payload is opaque JSON-typed bytes the kind
	// itself defines; clients must stash it on the room handle and
	// surface it to consumers (e.g. text uses it for {readOnly,
	// importWarnings}). Skipped entirely when OnConnect is nil.
	MsgServerHello MessageType = 0x06
	// MsgServerSlot is broadcast by the server to every member of a room
	// to surface room-wide state (e.g. saveStatus indicators) without
	// using y-protocols awareness. The payload is opaque JSON-typed bytes
	// the room kind defines; clients route it via onServerSlot, never
	// applying it to doc/awareness. See Room.PublishServerSlot.
	MsgServerSlot MessageType = 0x07
)

// clientIDLen is the fixed 16-byte UUID prefix on every wire frame.
// IDs are assigned by the server (sent as the first frame after
// connect via MsgAssignID); the server enforces that subsequent
// inbound frames use the assigned prefix, so peers cannot impersonate
// each other on the wire.
const clientIDLen = 16

// frameOverhead is clientID + msgType.
const frameOverhead = clientIDLen + 1

// Broker holds all currently-active rooms. One Broker instance per process
// is the expected deployment. New rooms spring into existence on first
// joiner and disappear when their last client leaves.
type Broker struct {
	mu    sync.Mutex
	rooms map[roomKey]*Room
}

type roomKey struct {
	kind string
	id   string
}

// NewBroker returns a freshly initialized Broker.
func NewBroker() *Broker {
	return &Broker{rooms: map[roomKey]*Room{}}
}

// join admits a Client to the named room, creating the room if necessary.
// The caller is responsible for having already authorized the connection.
// Once join returns, the client may send and receive frames; on
// disconnect, the caller must invoke (*Client).leave to remove it.
//
// On the first join into a (kind, id), the broker constructs the Room
// with whatever RoomKindOptions the kind registered. A kind that
// registered via the legacy RegisterRoomKind has no DocRuntime and no
// hooks, so the room behaves as a pure relay (the prior behavior).
func (b *Broker) join(kind, id string, c *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := roomKey{kind, id}
	room, ok := b.rooms[key]
	if !ok {
		// optionsFor returning ErrUnknownRoomKind is normally
		// impossible here because handleConnect already authorized
		// against the same registry. If it does happen (e.g. the
		// kind was unregistered between authorize and join), we
		// fall back to a zero-options room — no server doc, no
		// hooks — which is the safest behavior.
		opts, _ := optionsFor(kind)
		room = newRoom(b, key, opts)
		b.rooms[key] = room
	}
	room.add(c)
}

// removeRoom is called by a Room when its last client leaves. It clears
// the entry from the broker's map so that a subsequent join in that room
// starts from scratch.
func (b *Broker) removeRoom(key roomKey) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if room, ok := b.rooms[key]; ok && room.isEmpty() {
		delete(b.rooms, key)
	}
}

// roomCount returns the number of active rooms. Used in tests.
func (b *Broker) roomCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.rooms)
}

// lookupRoomForTest returns the room handle for (kind, id) or nil if no
// such room exists. Used by tests that need to call methods on the
// broker's Room directly (e.g. PublishServerSlot). Production code must
// not rely on this — joiners always go through the broker's join path.
func (b *Broker) lookupRoomForTest(kind, id string) *Room {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.rooms[roomKey{kind, id}]
}

// Client is one connected WebSocket. The transport-specific read/write
// loop lives in register.go and calls into Client to forward frames into
// the broker; the broker pushes frames out via Client.send.
type Client struct {
	id       [clientIDLen]byte
	room     *Room
	joinedAt time.Time

	// authID is the PocketBase user record id from the authenticated
	// WS upgrade. Empty in tests that bypass the production
	// handleConnect path. Consumers reach for this in OnConnect /
	// ServerHelloFn when the per-connection hello payload depends on
	// the user's identity (e.g. role-based read-only flags).
	authID string

	// send buffers frames the broker has decided this client should
	// receive. The transport reader pulls from this channel and writes
	// to the WebSocket. Buffer size is bounded so a slow client does
	// not pin memory; if the buffer overflows, the client is dropped.
	send chan []byte
}

// id of the client. Mostly used in tests; the byte prefix on each wire
// frame is the canonical identity at runtime.
func (c *Client) IDBytes() [clientIDLen]byte { return c.id }

// AuthID returns the PocketBase user record id associated with this
// connection. Empty for test clients constructed without going through
// the production handleConnect path.
func (c *Client) AuthID() string { return c.authID }

// NewClientForTest constructs a Client suitable for passing to a
// ServerHelloFn or similar callback in consumer-package tests. Only
// the auth id is populated; transport state is omitted. Production
// code must not call this.
func NewClientForTest(authID string) *Client {
	return &Client{authID: authID}
}
