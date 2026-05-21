package text

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"tinycld.org/packages/text/translate"
)

// withFakeClock swaps the package-level `now` for a controllable clock
// and restores it on test cleanup. Returned setter accepts an absolute
// instant; janitor / TTL logic reads `now()` so this lets tests scrub
// time forward deterministically without sleeping.
func withFakeClock(t *testing.T) func(time.Time) {
	t.Helper()
	var (
		mu      sync.Mutex
		current = time.Now()
	)
	original := now
	now = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return current
	}
	t.Cleanup(func() { now = original })
	return func(at time.Time) {
		mu.Lock()
		current = at
		mu.Unlock()
	}
}

// TestRuntime_NewDocAndClose smoke-tests that we can create and close
// a Y.Doc through the runtime without a bootstrap hook (the test
// path; production always wires a bootstrap).
func TestRuntime_NewDocAndClose(t *testing.T) {
	runtime := NewRuntime()
	handle, err := runtime.NewDoc("test-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	if handle == nil {
		t.Fatal("NewDoc returned nil DocHandle")
	}
	if err := handle.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
	// Close should be idempotent — calling twice is not an error.
	if err := handle.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
}

// TestRuntime_NewDocDuplicateRejects confirms that a second NewDoc
// for the same roomID fails — the broker should never call NewDoc
// twice for one room, but a guard avoids silently overwriting state
// if it ever does.
func TestRuntime_NewDocDuplicateRejects(t *testing.T) {
	runtime := NewRuntime()
	if _, err := runtime.NewDoc("dup-room"); err != nil {
		t.Fatalf("first NewDoc: %v", err)
	}
	if _, err := runtime.NewDoc("dup-room"); err == nil {
		t.Fatal("expected error on duplicate NewDoc")
	}
}

// TestRuntime_EncodeStateAsUpdateOnEmptyDoc returns non-nil bytes
// even for a fresh doc — y-crdt's state-update for an empty doc is
// a small header that the broker ships verbatim.
func TestRuntime_EncodeStateAsUpdateOnEmptyDoc(t *testing.T) {
	runtime := NewRuntime()
	handle, err := runtime.NewDoc("encode-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	defer func() { _ = handle.Close() }()

	bytes, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if bytes == nil {
		t.Fatal("EncodeStateAsUpdate returned nil bytes for empty doc")
	}
}

// TestRuntime_ClosedHandleRejectsOps ensures the broker can't call
// into a closed handle (defense against teardown races).
func TestRuntime_ClosedHandleRejectsOps(t *testing.T) {
	runtime := NewRuntime()
	handle, err := runtime.NewDoc("closed-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	if err := handle.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if err := handle.ApplyUpdate([]byte{0x00}); err == nil {
		t.Error("ApplyUpdate on closed handle should error")
	}
	if _, err := handle.EncodeStateAsUpdate(); err == nil {
		t.Error("EncodeStateAsUpdate on closed handle should error")
	}
}

// TestRuntime_ApplyUpdateRejectsOversizedPayload guards the
// MaxApplyUpdateBytes cap. A hostile client sending a 100 MiB frame
// would otherwise burn allocations inside y-crdt's ApplyUpdate before
// the recover guard could trip.
func TestRuntime_ApplyUpdateRejectsOversizedPayload(t *testing.T) {
	runtime := NewRuntime()
	handle, err := runtime.NewDoc("oversize-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	defer func() { _ = handle.Close() }()

	oversized := make([]byte, MaxApplyUpdateBytes+1)
	if err := handle.ApplyUpdate(oversized); err == nil {
		t.Fatal("ApplyUpdate accepted a payload larger than MaxApplyUpdateBytes")
	}

	// A payload exactly at the cap is allowed past the size check.
	// y-crdt will log + ignore malformed bytes (the contract the
	// recover guard backstops), so we don't assert a successful
	// apply — only that the size gate didn't reject.
	atCap := make([]byte, MaxApplyUpdateBytes)
	_ = handle.ApplyUpdate(atCap)
}

// TestRuntime_ImportWarnings round-trips warnings through Set/Pop —
// the OnConnect path's contract.
func TestRuntime_ImportWarnings(t *testing.T) {
	runtime := NewRuntime()
	want := []translate.Warning{
		{Code: translate.WarningTrackedChanges},
		{Code: translate.WarningComments, Detail: "3 comments dropped"},
	}
	runtime.SetImportWarnings("room-1", want)

	got := runtime.PopImportWarnings("room-1")
	if len(got) != 2 {
		t.Fatalf("PopImportWarnings = %d entries, want 2", len(got))
	}
	if got[0].Code != translate.WarningTrackedChanges {
		t.Errorf("got[0].Code = %q, want %q", got[0].Code, translate.WarningTrackedChanges)
	}
	if got[1].Code != translate.WarningComments || got[1].Detail != "3 comments dropped" {
		t.Errorf("got[1] = %+v, want comments + detail", got[1])
	}

	// Pop drains the entry — second call returns nil.
	if got2 := runtime.PopImportWarnings("room-1"); got2 != nil {
		t.Errorf("PopImportWarnings second call = %+v, want nil", got2)
	}
}

// TestRuntime_PopImportWarningsAbsentRoom returns nil for a room
// that never had warnings recorded — the OnConnect handler must
// tolerate this for non-bootstrap connections.
func TestRuntime_PopImportWarningsAbsentRoom(t *testing.T) {
	runtime := NewRuntime()
	if got := runtime.PopImportWarnings("never-set"); got != nil {
		t.Errorf("PopImportWarnings for absent room = %+v, want nil", got)
	}
}

// TestRuntime_EvictIdleDoc verifies the janitor closes a handle whose
// lastActivity is older than MaxIdleDuration. Drives the clock with a
// fake `now` instead of sleeping; calls evictIdleDocs directly so the
// test doesn't depend on the goroutine wakeup interval.
func TestRuntime_EvictIdleDoc(t *testing.T) {
	setClock := withFakeClock(t)
	t0 := time.Date(2026, time.May, 15, 12, 0, 0, 0, time.UTC)
	setClock(t0)

	runtime := NewRuntime()
	defer runtime.Stop()

	handle, err := runtime.NewDoc("idle-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}

	// Doc registered, lastActivity = t0.
	setClock(t0.Add(MaxIdleDuration + time.Minute))
	runtime.evictIdleDocs()

	// After eviction the handle should be Closed and the registry empty.
	if err := handle.ApplyUpdate([]byte{0x00}); err == nil {
		t.Error("ApplyUpdate after eviction should fail (handle closed)")
	}
	runtime.mu.Lock()
	_, stillRegistered := runtime.docs["idle-room"]
	runtime.mu.Unlock()
	if stillRegistered {
		t.Error("evicted handle is still registered in runtime.docs")
	}
}

// TestRuntime_ActiveDocSurvivesEvict ensures a handle that's been
// touched within MaxIdleDuration is NOT evicted. Otherwise an active
// editing session would get killed mid-flight.
func TestRuntime_ActiveDocSurvivesEvict(t *testing.T) {
	setClock := withFakeClock(t)
	t0 := time.Date(2026, time.May, 15, 12, 0, 0, 0, time.UTC)
	setClock(t0)

	runtime := NewRuntime()
	defer runtime.Stop()

	handle, err := runtime.NewDoc("active-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	defer func() { _ = handle.Close() }()

	// Time advances most-but-not-all of MaxIdleDuration, then activity
	// resets the clock; the doc should not be evicted.
	setClock(t0.Add(MaxIdleDuration - time.Minute))
	if _, err := handle.EncodeStateAsUpdate(); err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}

	setClock(t0.Add(MaxIdleDuration + time.Minute))
	runtime.evictIdleDocs()

	runtime.mu.Lock()
	_, stillRegistered := runtime.docs["active-room"]
	runtime.mu.Unlock()
	if !stillRegistered {
		t.Error("active handle was evicted")
	}
}

// TestRuntime_ImportWarningsTTL verifies entries older than the TTL
// are evicted by the janitor (and that PopImportWarnings honors the
// TTL on a stale entry).
func TestRuntime_ImportWarningsTTL(t *testing.T) {
	setClock := withFakeClock(t)
	t0 := time.Date(2026, time.May, 15, 12, 0, 0, 0, time.UTC)
	setClock(t0)

	runtime := NewRuntime()
	runtime.SetImportWarnings("room-x", []translate.Warning{
		{Code: translate.WarningTrackedChanges},
	})

	// Just past TTL → janitor must evict.
	setClock(t0.Add(ImportWarningsTTL + time.Minute))
	runtime.evictStaleImportWarnings()

	runtime.importWarningsMu.Lock()
	_, present := runtime.importWarnings["room-x"]
	runtime.importWarningsMu.Unlock()
	if present {
		t.Error("evictStaleImportWarnings did not drop the stale entry")
	}

	// Sanity: a freshly-set entry is NOT evicted on the same scan.
	setClock(t0)
	runtime.SetImportWarnings("room-y", []translate.Warning{
		{Code: translate.WarningComments},
	})
	runtime.evictStaleImportWarnings()
	if got := runtime.PopImportWarnings("room-y"); len(got) != 1 {
		t.Errorf("fresh entry was evicted: got %+v", got)
	}
}

// TestRuntime_ImportWarningsOverflow exercises the MaxImportWarningRooms
// cap: adding the (cap+1)th entry should evict the oldest entry.
func TestRuntime_ImportWarningsOverflow(t *testing.T) {
	setClock := withFakeClock(t)
	t0 := time.Date(2026, time.May, 15, 12, 0, 0, 0, time.UTC)
	setClock(t0)

	original := MaxImportWarningRooms
	MaxImportWarningRooms = 3
	t.Cleanup(func() { MaxImportWarningRooms = original })

	runtime := NewRuntime()
	// Insert four entries with strictly-increasing timestamps so the
	// oldest (room-0) is unambiguous.
	for i := 0; i < 4; i++ {
		setClock(t0.Add(time.Duration(i) * time.Second))
		runtime.SetImportWarnings(fmt.Sprintf("room-%d", i),
			[]translate.Warning{{Code: translate.WarningComments}})
	}

	// room-0 should have been evicted; rooms 1-3 should remain.
	if got := runtime.PopImportWarnings("room-0"); got != nil {
		t.Errorf("expected oldest entry to be evicted, got %+v", got)
	}
	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("room-%d", i)
		if got := runtime.PopImportWarnings(id); len(got) != 1 {
			t.Errorf("%s evicted unexpectedly: got %+v", id, got)
		}
	}
}

// TestRuntime_StopWithoutJanitor confirms Stop is safe even when
// StartJanitor was never called (a common shape in tests that don't
// care about background eviction).
func TestRuntime_StopWithoutJanitor(t *testing.T) {
	runtime := NewRuntime()
	done := make(chan struct{})
	go func() {
		runtime.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop blocked indefinitely with no janitor running")
	}
}

// TestRuntime_StopJoinsJanitor confirms Stop drains the janitor
// goroutine — a second call to Stop must be a no-op (idempotent).
func TestRuntime_StopJoinsJanitor(t *testing.T) {
	original := JanitorInterval
	JanitorInterval = 10 * time.Millisecond
	t.Cleanup(func() { JanitorInterval = original })

	runtime := NewRuntime()
	runtime.StartJanitor()

	done := make(chan struct{})
	go func() {
		runtime.Stop()
		runtime.Stop() // idempotent — second call returns immediately.
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not return")
	}
}
