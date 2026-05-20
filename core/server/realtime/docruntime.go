package realtime

// DocRuntime is the contract a room kind implements when it wants the
// broker to maintain a long-lived server-side document mirror per room.
//
// Most room kinds don't need this — the broker is happy to be a pure
// relay that fans out opaque frames. But room kinds that need the
// server to persist or otherwise inspect document state register a
// DocRuntime via RoomKindOptions, and the broker then keeps a fresh
// DocHandle alive for each active room of that kind, applying every
// inbound MsgDocUpdate frame to it.
//
// DocRuntime intentionally does not depend on any specific CRDT
// library. The sheets package implements it on top of yjs running in a
// goja VM; a hypothetical future room kind could implement it on top
// of automerge, plain JSON, etc.
type DocRuntime interface {
	// NewDoc creates a fresh server-side document mirror for a newly
	// created room. roomID is the broker's stable identifier for the
	// room (e.g. a drive_items.id for sheets). Returns an opaque
	// handle the broker will retain for the room's lifetime, or an
	// error if construction failed (in which case the room falls back
	// to pure-relay behavior — joining clients still succeed).
	NewDoc(roomID string) (DocHandle, error)
}

// DocHandle is the broker's view of a single room's server-side
// document mirror. The broker calls ApplyUpdate for every inbound
// MsgDocUpdate, EncodeStateAsUpdate when a new joiner needs to be
// bootstrapped, and Close exactly once when the room empties.
//
// Implementations must be safe to call from multiple goroutines, since
// the broker may receive updates from different connections
// concurrently. Most implementations will simply hold an internal
// mutex.
type DocHandle interface {
	// ApplyUpdate folds an incoming yjs update payload (the bytes
	// after the frame's clientID + msgType prefix) into the
	// server-side mirror. A non-nil error means the update was
	// rejected — the broker logs and drops the frame; it does not
	// fan out a corrupt update to peers.
	ApplyUpdate(payload []byte) error

	// EncodeStateAsUpdate returns the bytes a new joiner needs to
	// catch up to the current state. The broker wraps these bytes in
	// a MsgSyncReply frame and sends them to the requester.
	EncodeStateAsUpdate() ([]byte, error)

	// Close releases any runtime resources tied to this room. Called
	// exactly once after the room has emptied and any final
	// persistence work has completed.
	Close() error
}
