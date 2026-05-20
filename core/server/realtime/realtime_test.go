package realtime

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/pocketbase/pocketbase/core"
)

// dialOpts bundles a running test server's url with its server handle.
type dialOpts struct {
	server *httptest.Server
	url    string // ws://host/api/realtime/test/
}

// startTestServer mounts a minimal HTTP handler that drives runConnection
// directly. It bypasses the production handleConnect's PocketBase auth
// dependency: tests inject their own "user id" via the X-Test-User
// header, and the AuthorizeFn signature receives nil for *core.Record.
// This is fine because tests' handlers only care about roomID anyway —
// they're verifying broker behavior, not auth integration.
//
// Each call resets the registry first so prior tests don't leak.
func startTestServer(t *testing.T, broker *Broker, authFn AuthorizeFn) dialOpts {
	t.Helper()
	resetRegistry()
	if authFn != nil {
		RegisterRoomKind("test", authFn)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/realtime/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/realtime/"), "/")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		kind, roomID := parts[0], parts[1]

		fn, err := authorizeFor(kind)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if r.Header.Get("X-Test-User") == "" {
			http.Error(w, "no user", http.StatusUnauthorized)
			return
		}
		if err := fn(nil, roomID); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}

		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Logf("accept failed: %v", err)
			return
		}
		conn.SetReadLimit(defaultMaxFrameBytes)
		go runConnection(broker, Options{
			IdleTimeout:   defaultIdleTimeout,
			MaxFrameBytes: defaultMaxFrameBytes,
			PingInterval:  defaultPingInterval,
		}, kind, roomID, "", conn)
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/realtime/test/"
	return dialOpts{server: srv, url: url}
}

// testClient bundles a connection with its server-assigned ID. The
// dial helper consumes the initial MsgAssignID frame so test bodies
// see only the protocol traffic that follows.
type testClient struct {
	conn *websocket.Conn
	id   [clientIDLen]byte
}

// dialClient opens a WS to the given room as the given user, then
// reads the MsgAssignID frame and stashes the assigned ID. Returns a
// testClient that's auto-closed at test end.
func dialClient(t *testing.T, opts dialOpts, roomID, userID string) *testClient {
	t.Helper()
	hdr := http.Header{}
	hdr.Set("X-Test-User", userID)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, opts.url+roomID, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "test done") })

	// First frame must be the server-assigned ID.
	readCtx, rcancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer rcancel()
	typ, data, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("read assign frame failed: %v", err)
	}
	if typ != websocket.MessageBinary || len(data) < frameOverhead {
		t.Fatalf("expected binary assign frame, got typ=%v len=%d", typ, len(data))
	}
	if MessageType(data[clientIDLen]) != MsgAssignID {
		t.Fatalf("expected MsgAssignID as first frame, got 0x%02x", data[clientIDLen])
	}
	tc := &testClient{conn: conn}
	copy(tc.id[:], data[:clientIDLen])
	return tc
}

func writeFrame(t *testing.T, tc *testClient, msgType MessageType, payload []byte) {
	t.Helper()
	frame := make([]byte, frameOverhead+len(payload))
	copy(frame[:clientIDLen], tc.id[:])
	frame[clientIDLen] = byte(msgType)
	copy(frame[frameOverhead:], payload)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	if err := tc.conn.Write(ctx, websocket.MessageBinary, frame); err != nil {
		t.Fatalf("write failed: %v", err)
	}
}

func readFrame(t *testing.T, tc *testClient, timeout time.Duration) (MessageType, []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	typ, data, err := tc.conn.Read(ctx)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if typ != websocket.MessageBinary {
		t.Fatalf("expected binary frame, got %v", typ)
	}
	if len(data) < frameOverhead {
		t.Fatalf("frame too short: %d bytes", len(data))
	}
	return MessageType(data[clientIDLen]), data[frameOverhead:]
}

// allowAllAuth is the AuthorizeFn most tests use — admit everyone.
var allowAllAuth AuthorizeFn = func(_ *core.Record, _ string) error { return nil }

// TestRegistryUnknownKind: looking up an unregistered kind returns the sentinel.
func TestRegistryUnknownKind(t *testing.T) {
	resetRegistry()
	if _, err := authorizeFor("nope"); !errors.Is(err, ErrUnknownRoomKind) {
		t.Fatalf("expected ErrUnknownRoomKind, got %v", err)
	}
}

// TestRegistryDuplicatePanics: double-registration is a configuration mistake.
func TestRegistryDuplicatePanics(t *testing.T) {
	resetRegistry()
	RegisterRoomKind("dup", allowAllAuth)
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate registration")
		}
	}()
	RegisterRoomKind("dup", allowAllAuth)
}

// TestBrokerFanOutSameRoom: A's DOC_UPDATE reaches B in the same room.
func TestBrokerFanOutSameRoom(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "room1", "alice")
	b := dialClient(t, opts, "room1", "bob")
	time.Sleep(50 * time.Millisecond)

	payload := []byte("hello-from-alice")
	writeFrame(t, a, MsgDocUpdate, payload)

	mt, p := readFrame(t, b, 1*time.Second)
	if mt != MsgDocUpdate {
		t.Fatalf("B expected DOC_UPDATE, got 0x%02x", mt)
	}
	if !bytes.Equal(p, payload) {
		t.Fatalf("B got wrong payload: %q", p)
	}
}

// TestBrokerNoFanOutAcrossRooms: a frame in room1 must NOT reach a client in room2.
func TestBrokerNoFanOutAcrossRooms(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "room1", "alice")
	c := dialClient(t, opts, "room2", "carol")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, a, MsgDocUpdate, []byte("scoped-to-room1"))

	cctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, _, err := c.conn.Read(cctx)
	if err == nil {
		t.Fatal("C in room2 received a frame from room1; cross-room fan-out leaked")
	}
}

// TestSyncRequestForwardedToPeer: B requests sync, A (the longest-connected
// peer) receives the SYNC_REQUEST.
func TestSyncRequestForwardedToPeer(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "syncroom", "alice")
	time.Sleep(50 * time.Millisecond)
	b := dialClient(t, opts, "syncroom", "bob")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, b, MsgSyncRequest, []byte("state-vector-bytes"))

	mt, p := readFrame(t, a, 1*time.Second)
	if mt != MsgSyncRequest {
		t.Fatalf("A expected SYNC_REQUEST, got 0x%02x", mt)
	}
	if !bytes.Equal(p, []byte("state-vector-bytes")) {
		t.Fatalf("A got wrong sync request payload: %q", p)
	}
}

// TestSyncRequestAlone: a sole joiner asking for sync gets an empty SYNC_REPLY.
func TestSyncRequestAlone(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "lonely", "alice")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, a, MsgSyncRequest, nil)

	mt, p := readFrame(t, a, 1*time.Second)
	if mt != MsgSyncReply {
		t.Fatalf("expected empty SYNC_REPLY, got 0x%02x", mt)
	}
	if len(p) != 0 {
		t.Fatalf("expected empty payload for alone-room reply, got %d bytes", len(p))
	}
}

// TestAuthorizeRejection: a handler that errors → handshake 403.
func TestAuthorizeRejection(t *testing.T) {
	broker := NewBroker()
	denyAll := AuthorizeFn(func(_ *core.Record, _ string) error {
		return errors.New("no")
	})
	opts := startTestServer(t, broker, denyAll)

	hdr := http.Header{}
	hdr.Set("X-Test-User", "user")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, resp, err := websocket.Dial(ctx, opts.url+"anrealtime", &websocket.DialOptions{HTTPHeader: hdr})
	if err == nil {
		t.Fatal("expected dial to fail with 403")
	}
	if resp == nil {
		t.Fatalf("expected an HTTP response with the failure, got nil")
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

// TestUnknownRoomKind: dialing a kind that hasn't been registered → 404.
func TestUnknownRoomKind(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	url := strings.Replace(opts.url, "/test/", "/nonexistent/", 1)

	hdr := http.Header{}
	hdr.Set("X-Test-User", "user")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, resp, err := websocket.Dial(ctx, url+"any", &websocket.DialOptions{HTTPHeader: hdr})
	if err == nil {
		t.Fatal("expected dial to fail")
	}
	if resp == nil || resp.StatusCode != http.StatusNotFound {
		got := 0
		if resp != nil {
			got = resp.StatusCode
		}
		t.Fatalf("expected 404, got %d", got)
	}
}

// TestRoomCleanup: when the last client leaves, the room is dropped from the broker.
func TestRoomCleanup(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "ephemeral", "alice")
	time.Sleep(50 * time.Millisecond)
	if got := broker.roomCount(); got != 1 {
		t.Fatalf("expected 1 room while client is connected, got %d", got)
	}
	_ = a.conn.Close(websocket.StatusNormalClosure, "test")

	// Server-side cleanup runs in runConnection's defer; wait for it.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if broker.roomCount() == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("room never cleaned up; count=%d", broker.roomCount())
}

// TestLeaveBroadcast: when A disconnects, B receives a leave frame.
func TestLeaveBroadcast(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "leaveroom", "alice")
	b := dialClient(t, opts, "leaveroom", "bob")
	time.Sleep(50 * time.Millisecond)

	_ = a.conn.Close(websocket.StatusNormalClosure, "alice leaves")

	// B should see a synthetic empty AWARENESS_UPDATE from A's id.
	mt, p := readFrame(t, b, 2*time.Second)
	if mt != MsgAwarenessUpdate {
		t.Fatalf("B expected AWARENESS_UPDATE leave frame, got 0x%02x", mt)
	}
	if len(p) != 0 {
		t.Fatalf("expected empty leave payload, got %d bytes", len(p))
	}
}

// TestIDMismatchClosesConnection: a client whose outbound prefix
// doesn't match its server-assigned ID is disconnected. Defends
// against client bugs and against a malicious peer trying to spoof
// another peer's identity on the wire.
func TestIDMismatchClosesConnection(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "spoofroom", "alice")
	time.Sleep(50 * time.Millisecond)

	// Build a frame with a deliberately wrong prefix (all 0xFF).
	frame := make([]byte, frameOverhead)
	for i := range clientIDLen {
		frame[i] = 0xFF
	}
	frame[clientIDLen] = byte(MsgDocUpdate)

	wctx, wcancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer wcancel()
	_ = a.conn.Write(wctx, websocket.MessageBinary, frame)

	// Server must close with StatusPolicyViolation specifically. A
	// generic "any error" assertion would also pass for unrelated
	// failures (test-server teardown, idle timeout) and miss
	// regressions where any inbound frame causes a close.
	rctx, rcancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer rcancel()
	_, _, err := a.conn.Read(rctx)
	if err == nil {
		t.Fatal("expected the connection to be closed after ID mismatch, got a successful read")
	}
	var ce websocket.CloseError
	if !errors.As(err, &ce) {
		t.Fatalf("expected a websocket.CloseError, got %T: %v", err, err)
	}
	if ce.Code != websocket.StatusPolicyViolation {
		t.Fatalf("expected StatusPolicyViolation (1008), got %d (%q)", ce.Code, ce.Reason)
	}
}

// recordingJournal captures Append calls so tests can assert ordering
// and content. Safe for concurrent use.
type recordingJournal struct {
	mu      sync.Mutex
	appends []recordedAppend
	fail    error
}

type recordedAppend struct {
	kind, id string
	seq      int64
	payload  []byte
}

func (j *recordingJournal) Append(kind, id string, seq int64, update []byte) error {
	if j.fail != nil {
		return j.fail
	}
	cp := make([]byte, len(update))
	copy(cp, update)
	j.mu.Lock()
	defer j.mu.Unlock()
	j.appends = append(j.appends, recordedAppend{kind: kind, id: id, seq: seq, payload: cp})
	return nil
}

func (j *recordingJournal) Replay(kind, id string, apply func(int64, []byte) error) error {
	return nil
}

func (j *recordingJournal) Truncate(kind, id string, throughSeq int64) error {
	return nil
}

// stubDocRuntime hands out stubHandle instances. Used by tests to
// exercise journal interplay without requiring a real Y.Doc.
type stubDocRuntime struct{}

func (stubDocRuntime) NewDoc(roomID string) (DocHandle, error) {
	return &stubHandle{}, nil
}

func TestRoomRouteAppendsBeforeFanout(t *testing.T) {
	j := &recordingJournal{}
	kind := "test-kind-wal-append"
	RegisterRoomKindWith(kind, RoomKindOptions{
		Authorize:       allowAllAuth,
		RuntimeProvider: stubDocRuntime{},
		Journal:         j,
	})
	t.Cleanup(func() { unregisterRoomKindForTest(kind) })

	b := NewBroker()
	c1 := &Client{joinedAt: time.Now()}
	c2 := &Client{joinedAt: time.Now()}
	b.join(kind, "room-1", c1)
	b.join(kind, "room-1", c2)

	room := b.lookupRoomForTest(kind, "room-1")
	if room == nil {
		t.Fatalf("room not created")
	}

	payload := []byte{0xAA, 0xBB, 0xCC}
	frame := make([]byte, frameOverhead+len(payload))
	frame[clientIDLen] = byte(MsgDocUpdate)
	copy(frame[frameOverhead:], payload)
	room.route(c1, frame)

	j.mu.Lock()
	appends := append([]recordedAppend(nil), j.appends...)
	j.mu.Unlock()
	if len(appends) != 1 {
		t.Fatalf("appends = %d; want 1", len(appends))
	}
	got := appends[0]
	if got.kind != kind || got.id != "room-1" {
		t.Fatalf("append kind/id = %s/%s; want %s/room-1", got.kind, got.id, kind)
	}
	if got.seq != 1 {
		t.Fatalf("append seq = %d; want 1", got.seq)
	}
	if string(got.payload) != string(payload) {
		t.Fatalf("append payload = %v; want %v", got.payload, payload)
	}

	// Confirm the fan-out also happened — the test name claims "before
	// fanout", so verify both halves.
	select {
	case fanned := <-c2.send:
		if len(fanned) != len(frame) || string(fanned[frameOverhead:]) != string(payload) {
			t.Fatalf("c2 received unexpected frame: %v", fanned)
		}
	case <-time.After(50 * time.Millisecond):
		t.Fatalf("c2 did not receive fanned-out frame")
	}
}

func TestRoomRouteAppendFailureDropsFrame(t *testing.T) {
	j := &recordingJournal{fail: errors.New("journal boom")}
	kind := "test-kind-wal-fail"
	RegisterRoomKindWith(kind, RoomKindOptions{
		Authorize:       allowAllAuth,
		RuntimeProvider: stubDocRuntime{},
		Journal:         j,
	})
	t.Cleanup(func() { unregisterRoomKindForTest(kind) })

	b := NewBroker()
	c1 := &Client{joinedAt: time.Now()}
	c2 := &Client{joinedAt: time.Now()}
	b.join(kind, "room-1", c1)
	b.join(kind, "room-1", c2)
	room := b.lookupRoomForTest(kind, "room-1")
	if room == nil {
		t.Fatalf("room not created")
	}

	// Get the stub handle so we can check that ApplyUpdate was NOT called.
	sh := room.serverDoc.(*stubHandle)

	payload := []byte{0x01}
	frame := make([]byte, frameOverhead+len(payload))
	frame[clientIDLen] = byte(MsgDocUpdate)
	copy(frame[frameOverhead:], payload)
	room.route(c1, frame)

	sh.mu.Lock()
	applied := sh.applied
	sh.mu.Unlock()
	if applied != 0 {
		t.Fatalf("ApplyUpdate called %d times after journal failure; want 0", applied)
	}

	// c2 should not have received the dropped frame.
	select {
	case <-c2.send:
		t.Fatalf("c2 received fanned-out frame despite journal failure")
	case <-time.After(20 * time.Millisecond):
		// no frame — correct
	}
}

func TestRoomRouteOversizeFrameDropped(t *testing.T) {
	j := &recordingJournal{}
	kind := "test-kind-wal-cap"
	RegisterRoomKindWith(kind, RoomKindOptions{
		Authorize:       allowAllAuth,
		RuntimeProvider: stubDocRuntime{},
		Journal:         j,
		MaxUpdateBytes:  4,
	})
	t.Cleanup(func() { unregisterRoomKindForTest(kind) })

	b := NewBroker()
	c1 := &Client{joinedAt: time.Now()}
	c2 := &Client{joinedAt: time.Now()}
	b.join(kind, "room-1", c1)
	b.join(kind, "room-1", c2)
	room := b.lookupRoomForTest(kind, "room-1")
	if room == nil {
		t.Fatalf("room not created")
	}

	payload := []byte{1, 2, 3, 4, 5} // 5 bytes > 4 cap
	frame := make([]byte, frameOverhead+len(payload))
	frame[clientIDLen] = byte(MsgDocUpdate)
	copy(frame[frameOverhead:], payload)
	room.route(c1, frame)

	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.appends) != 0 {
		t.Fatalf("appends = %d; want 0 (oversize frame must not reach journal)", len(j.appends))
	}
}

// TestRoomRouteAwarenessNotJournaled verifies the journal block is
// scoped to MsgDocUpdate and never sees awareness frames. Awareness is
// ephemeral by design.
func TestRoomRouteAwarenessNotJournaled(t *testing.T) {
	j := &recordingJournal{}
	kind := "test-kind-wal-awareness"
	RegisterRoomKindWith(kind, RoomKindOptions{
		Authorize:       allowAllAuth,
		RuntimeProvider: stubDocRuntime{},
		Journal:         j,
	})
	t.Cleanup(func() { unregisterRoomKindForTest(kind) })

	b := NewBroker()
	c1 := &Client{joinedAt: time.Now()}
	c2 := &Client{joinedAt: time.Now()}
	b.join(kind, "room-1", c1)
	b.join(kind, "room-1", c2)
	room := b.lookupRoomForTest(kind, "room-1")
	if room == nil {
		t.Fatalf("room not created")
	}

	payload := []byte("cursor:42")
	frame := make([]byte, frameOverhead+len(payload))
	frame[clientIDLen] = byte(MsgAwarenessUpdate)
	copy(frame[frameOverhead:], payload)
	room.route(c1, frame)

	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.appends) != 0 {
		t.Fatalf("appends = %d; want 0 (awareness frames must not reach journal)", len(j.appends))
	}
}
