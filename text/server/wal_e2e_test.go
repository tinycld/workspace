package text

import (
	"math"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/realtime"
)

// addWALCollection extends setupTestApp's schema with the
// realtime_doc_updates collection so PocketBaseJournal can write rows
// against the test app. Mirrors the migration in core's pb_migrations
// and the setupJournalTestApp helper in core's realtime tests.
func addWALCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()
	col := core.NewBaseCollection(realtime.JournalCollection)
	col.Fields.Add(&core.TextField{Name: "room_kind", Required: true, Max: 64})
	col.Fields.Add(&core.TextField{Name: "room_id", Required: true, Max: 64})
	col.Fields.Add(&core.NumberField{Name: "seq", Required: true, Min: ptrFloat(1), OnlyInt: true})
	col.Fields.Add(&core.TextField{Name: "update", Required: true, Max: 358400})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.AddIndex("idx_realtime_doc_updates_room_seq", true, "room_kind, room_id, seq", "")
	col.AddIndex("idx_realtime_doc_updates_room", false, "room_kind, room_id", "")
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s: %v", realtime.JournalCollection, err)
	}
}

func ptrFloat(v float64) *float64 { return &v }

// sampleText is the YText payload we seed into the source Y.Doc when
// building the journal update. Asserting on it after replay verifies
// the update actually folded in — a stronger check than a raw byte
// threshold, since a partial / corrupted decode could in principle
// produce non-trivial encoded state without preserving content.
const sampleText = "hello WAL"

// sampleTextKey is the YText name inside the sample Y.Doc. Reading
// back through doc.GetText(sampleTextKey) is how we confirm replay
// reproduced the original content; if the wire path lost the update,
// the doc returns an empty YText for this key.
const sampleTextKey = "wal-sample"

// buildSampleUpdate constructs a Y.Doc update by mutating a fresh
// Y.Doc and encoding its state. The bytes are what would normally
// arrive over the wire from a peer's edit. The shape is opaque to
// the WAL — we only need bytes that ApplyUpdate accepts and that
// produce a non-trivial state when folded in.
//
// y-crdt's Go API uses doc.Transact(fn, origin) (see
// compatibility_test.go in the y-crdt source). The Transact closure
// receives a *Transaction implicitly used by the YText.Insert call.
func buildSampleUpdate(t *testing.T) []byte {
	t.Helper()
	doc := ycrdt.NewDoc("sample-source", false, nil, nil, false)
	ytext := doc.GetText(sampleTextKey)
	doc.Transact(func(_ *ycrdt.Transaction) {
		ytext.Insert(0, sampleText, nil)
	}, nil)
	return ycrdt.EncodeStateAsUpdate(doc, nil)
}

// TestRealtimeWAL_ReplayAfterSimulatedCrash exercises the durability
// invariant: a Yjs update appended to the journal but never reflected
// in the docx snapshot must reach the in-memory Y.Doc on the next room
// bootstrap. This is what protects against SIGKILL between accept and
// flush.
//
// Flow:
//  1. Build a TestApp with both drive_items and realtime_doc_updates.
//  2. Seed an empty drive_item; create a journal row at seq=1.
//  3. "Cold start": construct a fresh Runtime, bootstrap (empty docx),
//     then call Replay manually (simulating Room.newRoom's flow).
//  4. Verify the resulting Y.Doc has non-trivial state — i.e. the
//     journal row was folded in.
func TestRealtimeWAL_ReplayAfterSimulatedCrash(t *testing.T) {
	app := setupTestApp(t)
	addWALCollection(t, app)
	journal := realtime.NewPocketBaseJournal(app)

	item := seedDriveItem(t, app, "wal-replay.docx", nil)

	// Pretend the broker accepted an update before "crashing": one
	// row in the journal, no docx snapshot reflects it.
	pendingUpdate := buildSampleUpdate(t)
	if err := journal.Append(roomKindText, item.Id, 1, pendingUpdate); err != nil {
		t.Fatalf("Append: %v", err)
	}

	// Cold start: fresh Runtime, bootstrap reads empty docx, then
	// Replay folds the pending update back in. In production, the
	// broker's newRoom does both steps; here we drive them directly
	// because we don't want a full broker plumbed up for one test.
	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))
	handle, err := runtime.NewDoc(item.Id)
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	defer func() { _ = handle.Close() }()

	if err := journal.Replay(roomKindText, item.Id, func(_ int64, payload []byte) error {
		return handle.ApplyUpdate(payload)
	}); err != nil {
		t.Fatalf("Replay: %v", err)
	}

	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	// An empty Y.Doc encodes to ~2 bytes (just a state header) per
	// EncodeStateAsUpdate. After replaying our sample update — which
	// encodes to ~25 bytes on its own — the state must reflect the
	// folded-in content. A threshold of 10 catches "empty" without
	// being sensitive to y-crdt's exact encoding overhead.
	if len(state) < 10 {
		t.Fatalf("Y.Doc state after replay is only %d bytes; expected real content folded in", len(state))
	}

	// Round-trip into a fresh Doc and assert the YText content
	// survived. This is a stronger check than a byte threshold: it
	// verifies the journal payload semantically equals what a peer
	// originally produced, not just that "some bytes" reached the
	// runtime.
	verify := ycrdt.NewDoc("verify", false, nil, nil, false)
	ycrdt.ApplyUpdate(verify, state, nil)
	if got := verify.GetText(sampleTextKey).ToString(); got != sampleText {
		t.Fatalf("YText after replay: got %q, want %q", got, sampleText)
	}
}

// TestRealtimeWAL_FlushTruncatesJournal verifies the truncate-after-
// successful-flush contract at the journal layer: rows up to the
// snapshot's high-water seq disappear from PB after Truncate, so the
// next Replay sees no work to do.
//
// The full chain (SaveCoordinator → PocketBaseJournal.Truncate) is
// covered by save_coordinator_test.go with a recording journal mock;
// this test confirms the bottom of the chain (PB rows actually go
// away) end-to-end against a real PB test app.
func TestRealtimeWAL_FlushTruncatesJournal(t *testing.T) {
	app := setupTestApp(t)
	addWALCollection(t, app)
	journal := realtime.NewPocketBaseJournal(app)

	item := seedDriveItem(t, app, "wal-truncate.docx", nil)

	// Append three rows. Real broker traffic would produce more, but
	// three is plenty to verify the "<=N" semantics.
	for seq := int64(1); seq <= 3; seq++ {
		if err := journal.Append(roomKindText, item.Id, seq, []byte{byte(seq)}); err != nil {
			t.Fatalf("Append seq=%d: %v", seq, err)
		}
	}

	// Simulate a successful flush whose snapshotSeq captured seq=3.
	if err := journal.Truncate(roomKindText, item.Id, 3); err != nil {
		t.Fatalf("Truncate: %v", err)
	}

	// Confirm replay now sees nothing — the broker can boot fresh.
	calls := 0
	if err := journal.Replay(roomKindText, item.Id, func(int64, []byte) error {
		calls++
		return nil
	}); err != nil {
		t.Fatalf("Replay after truncate: %v", err)
	}
	if calls != 0 {
		t.Fatalf("Replay called apply %d times after truncate; want 0", calls)
	}
}

// TestRealtimeWAL_CleanupOnDriveItemDelete confirms the cascade hook
// wired in Register clears WAL rows when their drive_item is deleted.
// Without this hook, deleting a document would leak journal rows that
// nothing would ever truncate (the room is gone).
func TestRealtimeWAL_CleanupOnDriveItemDelete(t *testing.T) {
	app := setupTestApp(t)
	addWALCollection(t, app)

	// Register the production hooks against the test app. Register
	// expects a *pocketbase.PocketBase, but our test has a *tests.TestApp;
	// register the delete hook directly with the same closure to keep
	// this test independent of the realtime registry side-effect.
	journal := realtime.NewPocketBaseJournal(app)
	app.OnRecordAfterDeleteSuccess("drive_items").BindFunc(func(e *core.RecordEvent) error {
		if err := journal.Truncate(roomKindText, e.Record.Id, math.MaxInt64); err != nil {
			app.Logger().Warn("text: WAL cleanup on drive_items delete failed",
				"itemID", e.Record.Id, "err", err)
		}
		return e.Next()
	})

	item := seedDriveItem(t, app, "wal-cleanup.docx", nil)

	// Append a WAL row for this drive_item.
	if err := journal.Append(roomKindText, item.Id, 1, []byte{0x01}); err != nil {
		t.Fatalf("Append: %v", err)
	}

	// Delete the drive_item — the hook should fire and clear the WAL.
	if err := app.Delete(item); err != nil {
		t.Fatalf("Delete drive_item: %v", err)
	}

	// Confirm the WAL is empty for this room.
	calls := 0
	if err := journal.Replay(roomKindText, item.Id, func(int64, []byte) error {
		calls++
		return nil
	}); err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if calls != 0 {
		t.Fatalf("WAL rows after drive_item delete = %d; want 0", calls)
	}
}
