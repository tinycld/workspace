package realtime

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// stubDoc is an in-memory DocHandle used by tests. It records every
// call so assertions can inspect what the broker did. The "state" is a
// running concatenation of every applied update, which is enough to
// verify EncodeStateAsUpdate returns what we put in via ApplyUpdate.
type stubDoc struct {
	mu             sync.Mutex
	roomID         string
	applied        [][]byte
	encodeCalls    int
	closed         bool
	closeErr       error
	applyErr       error
	encodeErr      error
	cannedEncoding []byte
}

func (d *stubDoc) ApplyUpdate(payload []byte) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.applyErr != nil {
		return d.applyErr
	}
	cp := make([]byte, len(payload))
	copy(cp, payload)
	d.applied = append(d.applied, cp)
	return nil
}

func (d *stubDoc) EncodeStateAsUpdate() ([]byte, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.encodeCalls++
	if d.encodeErr != nil {
		return nil, d.encodeErr
	}
	if d.cannedEncoding != nil {
		return d.cannedEncoding, nil
	}
	// Default: concat of all applied updates so a test can verify the
	// reply payload reflects what was applied.
	var out []byte
	for _, u := range d.applied {
		out = append(out, u...)
	}
	return out, nil
}

func (d *stubDoc) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	return d.closeErr
}

// stubRuntime hands out stubDocs and records what it created.
type stubRuntime struct {
	mu      sync.Mutex
	created map[string]*stubDoc

	// failNewDoc, if set, causes NewDoc to return this error so the
	// broker exercises its pure-relay fallback.
	failNewDoc error
}

func newStubRuntime() *stubRuntime { return &stubRuntime{created: map[string]*stubDoc{}} }

func (r *stubRuntime) NewDoc(roomID string) (DocHandle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failNewDoc != nil {
		return nil, r.failNewDoc
	}
	d := &stubDoc{roomID: roomID}
	r.created[roomID] = d
	return d, nil
}

func (r *stubRuntime) doc(roomID string) *stubDoc {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.created[roomID]
}

// startTestServerWithOpts mirrors startTestServer but registers the
// kind via RegisterRoomKindWith so all the new hooks are wired in.
func startTestServerWithOpts(t *testing.T, broker *Broker, opts RoomKindOptions) dialOpts {
	t.Helper()
	resetRegistry()
	if opts.Authorize == nil {
		opts.Authorize = allowAllAuth
	}
	RegisterRoomKindWith("test", opts)

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

// expectNoFrame asserts the connection sees no frame within d. Reading
// past the deadline is the success case; a successful read is a failure.
func expectNoFrame(t *testing.T, c *websocket.Conn, d time.Duration, msg string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatalf("%s: expected no frame within %s, but read one", msg, d)
	}
}

// TestServerDocAppliesDocUpdatesBeforeFanOut: every MsgDocUpdate must
// land in the server-side mirror, *and* still fan out to peers.
func TestServerDocAppliesDocUpdatesBeforeFanOut(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{RuntimeProvider: rt})

	a := dialClient(t, opts, "doc-room", "alice")
	b := dialClient(t, opts, "doc-room", "bob")
	time.Sleep(50 * time.Millisecond)

	payload := []byte("update-from-alice")
	writeFrame(t, a, MsgDocUpdate, payload)

	mt, p := readFrame(t, b, 1*time.Second)
	if mt != MsgDocUpdate {
		t.Fatalf("B expected DOC_UPDATE, got 0x%02x", mt)
	}
	if !bytes.Equal(p, payload) {
		t.Fatalf("B got wrong payload: %q", p)
	}

	doc := rt.doc("doc-room")
	if doc == nil {
		t.Fatal("expected runtime to have created a doc for room")
	}
	doc.mu.Lock()
	defer doc.mu.Unlock()
	if len(doc.applied) != 1 || !bytes.Equal(doc.applied[0], payload) {
		t.Fatalf("server doc did not see the update; applied=%v", doc.applied)
	}
}

// TestServerDocApplyErrorDropsFrame: if ApplyUpdate rejects an update,
// the broker must NOT fan it out — peers should not see corrupt state.
func TestServerDocApplyErrorDropsFrame(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{RuntimeProvider: rt})

	a := dialClient(t, opts, "drop-room", "alice")
	b := dialClient(t, opts, "drop-room", "bob")
	time.Sleep(50 * time.Millisecond)

	doc := rt.doc("drop-room")
	if doc == nil {
		t.Fatal("expected doc to exist")
	}
	doc.mu.Lock()
	doc.applyErr = errors.New("synthetic decode failure")
	doc.mu.Unlock()

	writeFrame(t, a, MsgDocUpdate, []byte("garbage"))

	expectNoFrame(t, b.conn, 200*time.Millisecond, "B should not see a rejected MsgDocUpdate")
}

// TestOnDocUpdateFiresOnlyForDocUpdates: the hook must NOT fire for
// awareness/sync frames — only MsgDocUpdate counts as a save trigger.
func TestOnDocUpdateFiresOnlyForDocUpdates(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	var fired atomic.Int32
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{
		RuntimeProvider: rt,
		OnDocUpdate:     func(string) { fired.Add(1) },
	})

	a := dialClient(t, opts, "hook-room", "alice")
	_ = dialClient(t, opts, "hook-room", "bob")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, a, MsgDocUpdate, []byte("doc-1"))
	writeFrame(t, a, MsgAwarenessUpdate, []byte("aware-1"))
	writeFrame(t, a, MsgSyncRequest, []byte("sync-1"))
	time.Sleep(100 * time.Millisecond)

	if got := fired.Load(); got != 1 {
		t.Fatalf("OnDocUpdate fired %d times; expected exactly 1 (doc-update only)", got)
	}
}

// TestOnRoomCreateFiresOncePerRoom: the create hook fires when the
// room is constructed (first joiner) and not again on subsequent joins.
func TestOnRoomCreateFiresOncePerRoom(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	var creates atomic.Int32
	var seenRoomID atomic.Value
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{
		RuntimeProvider: rt,
		OnRoomCreate: func(roomID string, _ DocHandle, _ *Room) {
			creates.Add(1)
			seenRoomID.Store(roomID)
		},
	})

	_ = dialClient(t, opts, "create-room", "alice")
	time.Sleep(50 * time.Millisecond)
	_ = dialClient(t, opts, "create-room", "bob")
	time.Sleep(50 * time.Millisecond)

	if got := creates.Load(); got != 1 {
		t.Fatalf("OnRoomCreate fired %d times; expected 1", got)
	}
	if id, _ := seenRoomID.Load().(string); id != "create-room" {
		t.Fatalf("OnRoomCreate received roomID=%q; expected create-room", id)
	}
}

// TestOnEmptyFiresOnceAfterLastClient: emptying the room fires the
// teardown hook exactly once and then closes the doc.
func TestOnEmptyFiresOnceAfterLastClient(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	var emptyCalls atomic.Int32
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{
		RuntimeProvider: rt,
		OnEmpty:         func(string) { emptyCalls.Add(1) },
	})

	a := dialClient(t, opts, "teardown-room", "alice")
	time.Sleep(50 * time.Millisecond)

	doc := rt.doc("teardown-room")
	if doc == nil {
		t.Fatal("expected doc to exist while room has members")
	}

	_ = a.conn.Close(websocket.StatusNormalClosure, "test done")

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if emptyCalls.Load() == 1 && broker.roomCount() == 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := emptyCalls.Load(); got != 1 {
		t.Fatalf("OnEmpty fired %d times; expected exactly 1", got)
	}
	doc.mu.Lock()
	closed := doc.closed
	doc.mu.Unlock()
	if !closed {
		t.Fatal("DocHandle.Close was not called after OnEmpty")
	}
}

// TestSyncRequestServedFromServerDoc: when a server-side doc is
// configured, the broker replies with the EncodeStateAsUpdate output
// wrapped in a y-protocols sync step2 envelope, and does NOT bounce
// the request to a peer.
//
// The envelope shape is: varuint(1) || varuint(len(state)) || state.
// Without it the client's readSyncMessage would misinterpret the raw
// state bytes as a y-protocols message tag.
func TestSyncRequestServedFromServerDoc(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{RuntimeProvider: rt})

	a := dialClient(t, opts, "sync-room", "alice")
	time.Sleep(50 * time.Millisecond)
	writeFrame(t, a, MsgDocUpdate, []byte("seed-state"))
	time.Sleep(50 * time.Millisecond)

	b := dialClient(t, opts, "sync-room", "bob")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, b, MsgSyncRequest, []byte("state-vector"))
	mt, p := readFrame(t, b, 1*time.Second)
	if mt != MsgSyncReply {
		t.Fatalf("expected MsgSyncReply from server, got 0x%02x", mt)
	}
	wantEnvelope := encodeSyncStep2([]byte("seed-state"))
	if !bytes.Equal(p, wantEnvelope) {
		t.Fatalf("expected wrapped sync step2 envelope %q, got %q", wantEnvelope, p)
	}

	// Alice must NOT have received a forwarded SyncRequest, since
	// the server should have served it directly.
	expectNoFrame(t, a.conn, 200*time.Millisecond, "Alice received a SyncRequest the server should have served itself")
}

// TestPureRelayKindStillWorks: a kind registered via the legacy
// RegisterRoomKind (no DocRuntime, no hooks) continues to behave as a
// pure relay — the regression guard for existing room kinds.
func TestPureRelayKindStillWorks(t *testing.T) {
	broker := NewBroker()
	opts := startTestServer(t, broker, allowAllAuth)

	a := dialClient(t, opts, "relay-room", "alice")
	b := dialClient(t, opts, "relay-room", "bob")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, a, MsgDocUpdate, []byte("relay-payload"))

	mt, p := readFrame(t, b, 1*time.Second)
	if mt != MsgDocUpdate {
		t.Fatalf("expected DOC_UPDATE, got 0x%02x", mt)
	}
	if !bytes.Equal(p, []byte("relay-payload")) {
		t.Fatalf("got wrong payload: %q", p)
	}

	// SyncRequest still bounces to a peer (legacy behavior),
	// because no server-side doc is configured.
	writeFrame(t, b, MsgSyncRequest, []byte("from-bob"))
	mtA, pA := readFrame(t, a, 1*time.Second)
	if mtA != MsgSyncRequest {
		t.Fatalf("expected SyncRequest forwarded to A, got 0x%02x", mtA)
	}
	if !bytes.Equal(pA, []byte("from-bob")) {
		t.Fatalf("got wrong sync request payload: %q", pA)
	}
}

// TestNewDocFailureFallsBackToPureRelay: if the runtime fails to mint
// a doc, the room should still admit clients and fan out frames. Only
// the server-side mirror (and downstream persistence) is degraded.
func TestNewDocFailureFallsBackToPureRelay(t *testing.T) {
	broker := NewBroker()
	rt := newStubRuntime()
	rt.failNewDoc = errors.New("intentional NewDoc failure")
	var docUpdates atomic.Int32
	opts := startTestServerWithOpts(t, broker, RoomKindOptions{
		RuntimeProvider: rt,
		OnDocUpdate:     func(string) { docUpdates.Add(1) },
	})

	a := dialClient(t, opts, "fallback-room", "alice")
	b := dialClient(t, opts, "fallback-room", "bob")
	time.Sleep(50 * time.Millisecond)

	writeFrame(t, a, MsgDocUpdate, []byte("still-fans-out"))
	mt, p := readFrame(t, b, 1*time.Second)
	if mt != MsgDocUpdate {
		t.Fatalf("expected DOC_UPDATE fan-out even with NewDoc failure, got 0x%02x", mt)
	}
	if !bytes.Equal(p, []byte("still-fans-out")) {
		t.Fatalf("got wrong payload: %q", p)
	}

	// OnDocUpdate fires regardless of whether the mirror exists; the
	// saver itself can decide what to do when there's no handle.
	time.Sleep(50 * time.Millisecond)
	if got := docUpdates.Load(); got != 1 {
		t.Fatalf("OnDocUpdate fired %d times; expected 1 (hook fires regardless of mirror state)", got)
	}
}
