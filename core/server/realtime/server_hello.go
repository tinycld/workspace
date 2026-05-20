package realtime

// ServerHelloFn is invoked by the broker once per inbound connection,
// immediately after a client is admitted to a room and assigned its
// routing ID, but before the y-protocols sync handshake runs. The
// returned bytes are sent as a MsgServerHello frame to that client only.
//
// roomID is the broker's room identifier (same string the kind's
// Authorize handler received). conn is the freshly-joined client; the
// callback may inspect conn.IDBytes() if the payload needs to reference
// the assigned ID. Returning a non-nil error logs and skips the frame
// (the connection continues; consumers must defensively render with no
// hello payload).
//
// A nil ServerHelloFn (the default) skips the frame entirely, preserving
// the existing protocol shape for kinds that don't need it (e.g. calc).
type ServerHelloFn func(roomID string, conn *Client) ([]byte, error)

// makeServerHelloFrame builds a MsgServerHello frame addressed to the
// given client. Wire shape: clientID(16) || msgType(1) || payload.
// Sender-ID prefix is the recipient's own ID — the routing layer
// doesn't care, but reusing the recipient's ID makes the frame
// self-consistent for any future protocol change that does validate
// sender identity.
func makeServerHelloFrame(id [clientIDLen]byte, payload []byte) []byte {
	frame := make([]byte, frameOverhead+len(payload))
	copy(frame[:clientIDLen], id[:])
	frame[clientIDLen] = byte(MsgServerHello)
	copy(frame[frameOverhead:], payload)
	return frame
}
