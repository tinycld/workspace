package realtime

import (
	"bytes"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// TestServerHello_DeliveredAfterAssignID: when a kind registers an
// OnConnect handler, the broker must invoke it once per joining client
// and deliver the returned bytes as a MsgServerHello frame immediately
// after MsgAssignID (which dialClient consumes for us). The next frame
// the test sees on the wire is therefore the hello frame itself.
func TestServerHello_DeliveredAfterAssignID(t *testing.T) {
	broker := NewBroker()
	wantPayload := []byte(`{"readOnly":false,"importWarnings":[]}`)
	var calls atomic.Int32
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{
		OnConnect: func(roomID string, conn *Client) ([]byte, error) {
			calls.Add(1)
			if roomID != "hello-room" {
				t.Errorf("OnConnect saw roomID=%q, want hello-room", roomID)
			}
			if conn == nil {
				t.Error("OnConnect received nil *Client")
			}
			return wantPayload, nil
		},
	})

	a := dialClient(t, opts, "hello-room", "alice")

	mt, payload := readFrame(t, a, 1*time.Second)
	if mt != MsgServerHello {
		t.Fatalf("expected MsgServerHello (0x%02x), got 0x%02x", MsgServerHello, mt)
	}
	if !bytes.Equal(payload, wantPayload) {
		t.Fatalf("hello payload mismatch: got %q want %q", payload, wantPayload)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("OnConnect invoked %d times; expected exactly 1", got)
	}
}

// TestServerHello_NotSentWhenOnConnectNil: a kind without an OnConnect
// handler must NOT receive a MsgServerHello frame — the protocol shape
// is preserved for kinds (calc, future relays) that don't need it.
// Driving a SyncRequest after dialClient returns a SyncReply (the
// alone-room reply) and never a hello frame.
func TestServerHello_NotSentWhenOnConnectNil(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "no-hello-room", "alice")
	time.Sleep(50 * time.Millisecond)
	writeFrame(t, a, MsgSyncRequest, nil)

	mt, _ := readFrame(t, a, 1*time.Second)
	if mt == MsgServerHello {
		t.Fatalf("received unexpected MsgServerHello when OnConnect is nil")
	}
	if mt != MsgSyncReply {
		t.Fatalf("expected MsgSyncReply (alone-room), got 0x%02x", mt)
	}
}

// TestServerHello_OnConnectErrorSkipsFrameButContinues: if OnConnect
// returns an error, the broker logs and skips the hello frame but
// keeps the connection alive — the client falls through to sync.
func TestServerHello_OnConnectErrorSkipsFrameButContinues(t *testing.T) {
	broker := NewBroker()
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{
		OnConnect: func(_ string, _ *Client) ([]byte, error) {
			return nil, errors.New("synthetic OnConnect failure")
		},
	})

	a := dialClient(t, opts, "err-room", "alice")
	time.Sleep(50 * time.Millisecond)
	writeFrame(t, a, MsgSyncRequest, nil)

	mt, _ := readFrame(t, a, 1*time.Second)
	if mt == MsgServerHello {
		t.Fatal("expected NO hello frame when OnConnect errors")
	}
	if mt != MsgSyncReply {
		t.Fatalf("expected MsgSyncReply (alone-room) after errored OnConnect, got 0x%02x", mt)
	}
}

// TestPublishServerSlot_BroadcastsToAllMembers: calling
// Room.PublishServerSlot synthesizes a MsgServerSlot frame whose sender
// prefix is the reserved serverSlotID and whose payload is the
// caller-supplied bytes. Every member of the room receives it,
// including the room author — there is no "from" client to exclude.
func TestPublishServerSlot_BroadcastsToAllMembers(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "slot-room", "alice")
	b := dialClient(t, opts, "slot-room", "bob")
	// Wait for both clients to be admitted to the room before publishing
	// — broker.join runs on a separate goroutine per connection.
	room := waitForRoomMembers(t, broker, "test", "slot-room", 2, 1*time.Second)

	wantPayload := []byte(`{"saveStatus":"saving"}`)
	room.PublishServerSlot(wantPayload)

	for name, tc := range map[string]*testClient{"alice": a, "bob": b} {
		mt, p := readFrame(t, tc, 1*time.Second)
		if mt != MsgServerSlot {
			t.Fatalf("%s: expected MsgServerSlot from server slot, got 0x%02x", name, mt)
		}
		if !bytes.Equal(p, wantPayload) {
			t.Fatalf("%s: server-slot payload mismatch: got %q want %q", name, p, wantPayload)
		}
	}
}

// waitForRoomMembers polls broker.lookupRoomForTest until the room has
// at least `want` members, or the deadline elapses. Returns the room
// handle. Replaces fixed-duration sleeps for deterministic test
// ordering — these tests run on localhost; member admission settles
// in microseconds typically.
func waitForRoomMembers(t *testing.T, broker *Broker, kind, roomID string, want int, timeout time.Duration) *Room {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		room := broker.lookupRoomForTest(kind, roomID)
		if room != nil {
			room.mu.Lock()
			n := len(room.members)
			room.mu.Unlock()
			if n >= want {
				return room
			}
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("waitForRoomMembers: timeout waiting for %d members in (%q,%q)", want, kind, roomID)
	return nil
}

// TestIsReservedClientID_ReservedRange: the helper used by UI consumers
// to filter out server-slot IDs from presence rendering must return
// true for serverSlotID and false for ordinary IDs.
func TestIsReservedClientID_ReservedRange(t *testing.T) {
	if !IsReservedClientID(serverSlotID) {
		t.Fatal("serverSlotID itself should be flagged reserved")
	}
	var ordinary [clientIDLen]byte
	for i := range ordinary {
		ordinary[i] = byte(i)
	}
	if IsReservedClientID(ordinary) {
		t.Fatal("an ordinary all-low-byte ID was flagged reserved")
	}
}
