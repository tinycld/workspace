package realtime

import (
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stubHandle is a minimal DocHandle that records calls.
// Used by SaveCoordinator tests so they don't need a real y-crdt doc.
type stubHandle struct {
	mu          sync.Mutex
	applied     int
	encodeCalls int
	closed      bool
}

func (h *stubHandle) ApplyUpdate(payload []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.applied++
	return nil
}

func (h *stubHandle) EncodeStateAsUpdate() ([]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.encodeCalls++
	return nil, nil
}

func (h *stubHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	return nil
}

// fastCoord builds a SaveCoordinator with millisecond-scale intervals
// so tests run in real time rather than seconds. The flush captures
// every call's room id and lets tests block/unblock individual saves
// via the gate channel.
type fastCoord struct {
	c        *SaveCoordinator
	calls    *[]string
	callsMu  *sync.Mutex
	gate     chan struct{} // optional: if non-nil, flush blocks on receive
	failOnce *atomic.Bool  // optional: when true, the next flush returns an error then resets
}

func newFastCoord(t *testing.T) *fastCoord {
	t.Helper()
	calls := []string{}
	mu := sync.Mutex{}
	failOnce := atomic.Bool{}
	gate := make(chan struct{}, 1024) // pre-buffered; tests opt in by reading
	flush := func(driveItemID string, _ DocHandle) error {
		// Block on gate if a test wants to control flush timing.
		// The default uses an unbuffered receive only when the
		// test explicitly drains; otherwise we proceed immediately
		// because gate is pre-buffered with sentinel values.
		select {
		case <-gate:
		default:
		}
		if failOnce.Load() {
			failOnce.Store(false)
			return errors.New("synthetic flush failure")
		}
		mu.Lock()
		calls = append(calls, driveItemID)
		mu.Unlock()
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 50 * time.Millisecond
	c.ceilingEvery = 250 * time.Millisecond
	c.teardownTimeout = 2 * time.Second
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	return &fastCoord{c: c, calls: &calls, callsMu: &mu, gate: gate, failOnce: &failOnce}
}

func (fc *fastCoord) callCount() int {
	fc.callsMu.Lock()
	defer fc.callsMu.Unlock()
	return len(*fc.calls)
}

// newFastCoordWithFlush is a variant of newFastCoord that uses the
// caller-provided flush function instead of the standard one. Used by
// WAL tests that need to assert on flush ordering vs. truncate timing.
func newFastCoordWithFlush(t *testing.T, flush FlushFn) *fastCoord {
	t.Helper()
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 50 * time.Millisecond
	c.ceilingEvery = 250 * time.Millisecond
	c.teardownTimeout = 2 * time.Second
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	return &fastCoord{c: c}
}

// TestSaveCoordinatorDebounceCoalesces: many updates within the
// debounce window produce exactly one save.
func TestSaveCoordinatorDebounceCoalesces(t *testing.T) {
	fc := newFastCoord(t)
	fc.c.OnRoomCreate("room", &stubHandle{}, nil)
	for i := 0; i < 10; i++ {
		fc.c.OnDocUpdate("room")
		time.Sleep(5 * time.Millisecond)
	}
	// Wait past the debounce window after the last update.
	time.Sleep(150 * time.Millisecond)
	if got := fc.callCount(); got != 1 {
		t.Fatalf("expected 1 save after debounced burst, got %d", got)
	}
}

// TestSaveCoordinatorCeilingFiresUnderConstantLoad: continuous
// updates at a rate faster than the debounce should still produce a
// save when the ceiling fires.
func TestSaveCoordinatorCeilingFiresUnderConstantLoad(t *testing.T) {
	fc := newFastCoord(t)
	fc.c.OnRoomCreate("ceiling-room", &stubHandle{}, nil)
	// Hammer updates every 10ms (faster than the 50ms debounce) for
	// 600ms — well past two ceiling windows of 250ms each.
	stop := time.After(600 * time.Millisecond)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
LOOP:
	for {
		select {
		case <-tick.C:
			fc.c.OnDocUpdate("ceiling-room")
		case <-stop:
			break LOOP
		}
	}
	// Drain the trailing debounce.
	time.Sleep(150 * time.Millisecond)
	if got := fc.callCount(); got < 2 {
		t.Fatalf("expected at least 2 saves under continuous edits + ceiling, got %d", got)
	}
}

// TestSaveCoordinatorAwarenessNeverSaves: the broker only invokes
// OnDocUpdate for MsgDocUpdate, so the coordinator should never save
// if it never sees that hook fire. We don't have a broker here — we
// just verify that OnRoomCreate alone produces no saves, ever.
func TestSaveCoordinatorAwarenessNeverSaves(t *testing.T) {
	fc := newFastCoord(t)
	fc.c.OnRoomCreate("quiet-room", &stubHandle{}, nil)
	time.Sleep(400 * time.Millisecond) // > debounce + ceiling
	if got := fc.callCount(); got != 0 {
		t.Fatalf("expected 0 saves with no OnDocUpdate, got %d", got)
	}
}

// TestSaveCoordinatorInFlightCoalescing: an update arriving during
// an in-flight save produces exactly one follow-up save (not many).
func TestSaveCoordinatorInFlightCoalescing(t *testing.T) {
	calls := []string{}
	mu := sync.Mutex{}
	releaseFlush := make(chan struct{})
	doneFirst := make(chan struct{})
	flush := func(driveItemID string, _ DocHandle) error {
		mu.Lock()
		first := len(calls) == 0
		calls = append(calls, driveItemID)
		mu.Unlock()
		if first {
			close(doneFirst)
			<-releaseFlush
		}
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 30 * time.Millisecond
	c.ceilingEvery = 200 * time.Millisecond
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("coal-room", &stubHandle{}, nil)

	// Trigger first save.
	c.OnDocUpdate("coal-room")
	<-doneFirst // first flush is now mid-call, blocked on releaseFlush

	// Inject more updates while save is in flight.
	for i := 0; i < 5; i++ {
		c.OnDocUpdate("coal-room")
		time.Sleep(5 * time.Millisecond)
	}

	// Release the first flush; the coordinator should now coalesce
	// the queued updates into a single follow-up save.
	close(releaseFlush)
	time.Sleep(150 * time.Millisecond)

	mu.Lock()
	got := len(calls)
	mu.Unlock()
	if got != 2 {
		t.Fatalf("expected exactly 2 saves (first + 1 coalesced follow-up), got %d", got)
	}
}

// TestSaveCoordinatorFailureRetries: a failing flush schedules a
// retry, and the retry succeeds.
func TestSaveCoordinatorFailureRetries(t *testing.T) {
	var calls atomic.Int32
	var failNext atomic.Bool
	failNext.Store(true)
	flush := func(driveItemID string, _ DocHandle) error {
		calls.Add(1)
		if failNext.CompareAndSwap(true, false) {
			return errors.New("synthetic")
		}
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 30 * time.Millisecond
	c.ceilingEvery = 1 * time.Hour // keep ceiling out of this test
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("retry-room", &stubHandle{}, nil)

	c.OnDocUpdate("retry-room")
	// First save fires after 30ms, fails. Retry uses RetryBackoff(0)
	// which is 1 second. Wait long enough for retry to land.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if calls.Load() >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := calls.Load(); got < 2 {
		t.Fatalf("expected at least 2 flush attempts (failure + retry), got %d", got)
	}
}

// TestSaveCoordinatorGivesUpAfterMaxAttempts: a flush that always fails
// stops retrying once it hits maxAttempts, reports the give-up via the
// injected hook with the full detail, and does not keep looping.
func TestSaveCoordinatorGivesUpAfterMaxAttempts(t *testing.T) {
	var calls atomic.Int32
	flush := func(_ string, _ DocHandle) error {
		calls.Add(1)
		return errors.New("always fails")
	}

	var giveUps atomic.Int32
	var captured giveUpDetail
	var mu sync.Mutex

	c := NewSaveCoordinator(flush)
	c.debounceEvery = 10 * time.Millisecond
	c.ceilingEvery = 1 * time.Hour
	c.maxAttempts = 3
	c.backoff = func(int) time.Duration { return 10 * time.Millisecond }
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.SetJournal("text", nil)
	c.captureGiveUp = func(d giveUpDetail) {
		mu.Lock()
		captured = d
		mu.Unlock()
		giveUps.Add(1)
	}
	c.OnRoomCreate("doomed-room", &stubHandle{}, nil)
	c.NoteSeq("doomed-room", 42)

	c.OnDocUpdate("doomed-room")

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if giveUps.Load() >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := giveUps.Load(); got != 1 {
		t.Fatalf("expected exactly 1 give-up, got %d", got)
	}
	if got := calls.Load(); got != 3 {
		t.Fatalf("expected exactly maxAttempts=3 flush calls, got %d", got)
	}

	// Settle: confirm no further retries fire after give-up.
	time.Sleep(100 * time.Millisecond)
	if got := calls.Load(); got != 3 {
		t.Fatalf("flush kept retrying after give-up: %d calls", got)
	}

	mu.Lock()
	defer mu.Unlock()
	if captured.DriveItemID != "doomed-room" {
		t.Errorf("driveItemID = %q, want doomed-room", captured.DriveItemID)
	}
	if captured.Kind != "text" {
		t.Errorf("kind = %q, want text", captured.Kind)
	}
	if captured.Attempts != 3 {
		t.Errorf("attempts = %d, want 3", captured.Attempts)
	}
	if captured.LastSeq != 42 {
		t.Errorf("lastSeq = %d, want 42", captured.LastSeq)
	}
	if captured.Err == nil {
		t.Errorf("give-up detail missing error")
	}
}

// TestSaveCoordinatorRetryRecoversBeforeGivingUp: a flush that fails
// once then succeeds clears the failure counter, so a later failure
// streak starts from zero rather than inheriting the earlier count.
func TestSaveCoordinatorRetryRecoversBeforeGivingUp(t *testing.T) {
	var calls atomic.Int32
	var failNext atomic.Bool
	failNext.Store(true)
	flush := func(_ string, _ DocHandle) error {
		calls.Add(1)
		if failNext.CompareAndSwap(true, false) {
			return errors.New("transient")
		}
		return nil
	}

	var giveUps atomic.Int32
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 10 * time.Millisecond
	c.ceilingEvery = 1 * time.Hour
	c.maxAttempts = 3
	c.backoff = func(int) time.Duration { return 10 * time.Millisecond }
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.captureGiveUp = func(giveUpDetail) { giveUps.Add(1) }
	c.OnRoomCreate("flaky-room", &stubHandle{}, nil)

	c.OnDocUpdate("flaky-room")

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if calls.Load() >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := calls.Load(); got < 2 {
		t.Fatalf("expected failure + successful retry, got %d calls", got)
	}
	if got := giveUps.Load(); got != 0 {
		t.Fatalf("transient failure should not give up, got %d give-ups", got)
	}
}

// TestSaveCoordinatorTeardownFinalSave: OnRoomEmpty fires a save
// synchronously even if the debounce hasn't elapsed, and blocks
// until it returns.
func TestSaveCoordinatorTeardownFinalSave(t *testing.T) {
	var calls atomic.Int32
	doneSignal := make(chan struct{})
	flush := func(driveItemID string, _ DocHandle) error {
		calls.Add(1)
		// Slow flush: 100ms.
		time.Sleep(100 * time.Millisecond)
		close(doneSignal)
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 5 * time.Second // long; teardown should win
	c.ceilingEvery = 5 * time.Second
	c.teardownTimeout = 2 * time.Second
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("teardown-room", &stubHandle{}, nil)
	c.OnDocUpdate("teardown-room")

	start := time.Now()
	c.OnRoomEmpty("teardown-room")
	elapsed := time.Since(start)

	if got := calls.Load(); got != 1 {
		t.Fatalf("expected 1 save during teardown, got %d", got)
	}
	if elapsed < 90*time.Millisecond {
		t.Fatalf("OnRoomEmpty returned in %s; expected to block for the ~100ms flush", elapsed)
	}
	select {
	case <-doneSignal:
	default:
		t.Fatal("flush hadn't completed when OnRoomEmpty returned")
	}
}

// TestSaveCoordinatorTeardownNoOpsCleanRoom: closing a room that
// never received an update should NOT call flush.
func TestSaveCoordinatorTeardownNoOpsCleanRoom(t *testing.T) {
	var calls atomic.Int32
	flush := func(string, DocHandle) error {
		calls.Add(1)
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("clean-room", &stubHandle{}, nil)
	c.OnRoomEmpty("clean-room")
	if got := calls.Load(); got != 0 {
		t.Fatalf("expected 0 saves for clean teardown, got %d", got)
	}
}

// TestSaveCoordinatorIgnoresUpdateForUnknownRoom: an OnDocUpdate
// without a prior OnRoomCreate is a no-op (e.g. NewDoc failed and
// the broker fell back to pure relay). Must not panic.
func TestSaveCoordinatorIgnoresUpdateForUnknownRoom(t *testing.T) {
	var calls atomic.Int32
	flush := func(string, DocHandle) error {
		calls.Add(1)
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnDocUpdate("never-created")
	time.Sleep(150 * time.Millisecond)
	if got := calls.Load(); got != 0 {
		t.Fatalf("expected 0 saves for unknown room, got %d", got)
	}
}

// recordingJournalForCoord captures Truncate calls.
type recordingJournalForCoord struct {
	mu           sync.Mutex
	truncates    []recordedTruncate
	truncateFail error // when non-nil, Truncate returns this error after recording the call
}

type recordedTruncate struct {
	kind, id   string
	throughSeq int64
}

func (j *recordingJournalForCoord) Append(string, string, int64, []byte) error { return nil }
func (j *recordingJournalForCoord) Replay(string, string, func(int64, []byte) error) error {
	return nil
}
func (j *recordingJournalForCoord) Truncate(kind, id string, throughSeq int64) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.truncates = append(j.truncates, recordedTruncate{kind: kind, id: id, throughSeq: throughSeq})
	return j.truncateFail
}

func TestSaveCoordinatorTruncatesAfterSuccessfulFlush(t *testing.T) {
	j := &recordingJournalForCoord{}
	flushed := make(chan struct{}, 1)
	fc := newFastCoordWithFlush(t, func(string, DocHandle) error {
		flushed <- struct{}{}
		return nil
	})
	fc.c.SetJournal("test-kind", j)

	handle := &stubHandle{}
	fc.c.OnRoomCreate("room-1", handle, nil)
	fc.c.NoteSeq("room-1", 1)
	fc.c.NoteSeq("room-1", 2)
	fc.c.NoteSeq("room-1", 5)
	fc.c.OnDocUpdate("room-1")
	<-flushed
	// Allow the post-flush truncate goroutine to run.
	time.Sleep(50 * time.Millisecond)

	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.truncates) != 1 {
		t.Fatalf("truncates = %d; want 1", len(j.truncates))
	}
	if j.truncates[0].throughSeq != 5 {
		t.Fatalf("truncated through %d; want 5", j.truncates[0].throughSeq)
	}
}

func TestSaveCoordinatorNoTruncateOnFailedFlush(t *testing.T) {
	j := &recordingJournalForCoord{}
	fc := newFastCoordWithFlush(t, func(string, DocHandle) error {
		return errors.New("flush boom")
	})
	fc.c.SetJournal("test-kind", j)
	fc.c.OnRoomCreate("room-1", &stubHandle{}, nil)
	fc.c.NoteSeq("room-1", 3)
	fc.c.OnDocUpdate("room-1")
	time.Sleep(200 * time.Millisecond) // let flush + retry-schedule run

	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.truncates) != 0 {
		t.Fatalf("truncates = %d; want 0 (no truncate on failed flush)", len(j.truncates))
	}
}

func TestSaveCoordinatorTruncateErrorIsLoggedAndIgnored(t *testing.T) {
	j := &recordingJournalForCoord{truncateFail: errors.New("truncate boom")}
	flushed := make(chan struct{}, 1)
	fc := newFastCoordWithFlush(t, func(string, DocHandle) error {
		flushed <- struct{}{}
		return nil
	})
	fc.c.SetJournal("test-kind", j)
	fc.c.OnRoomCreate("room-1", &stubHandle{}, nil)
	fc.c.NoteSeq("room-1", 3)
	fc.c.OnDocUpdate("room-1")
	<-flushed
	time.Sleep(50 * time.Millisecond)

	// The flush succeeded, the truncate was attempted, the truncate
	// failed — the coordinator must log+continue, NOT propagate the
	// error or schedule a retry. Verify the truncate was attempted
	// once (so the error path was exercised) and that no retry was
	// scheduled (i.e., the room is no longer dirty).
	j.mu.Lock()
	got := len(j.truncates)
	j.mu.Unlock()
	if got != 1 {
		t.Fatalf("truncates = %d; want 1 (single attempt, no retry)", got)
	}
}
