package realtime

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupJournalTestApp materializes a TestApp with the realtime_doc_updates
// collection in place. tests.NewTestApp() runs Go-side PB migrations only —
// our JS-based create-realtime-doc-updates migration is not exercised here,
// so we rebuild the schema programmatically. The shape mirrors the one in
// 1860000000_create_realtime_doc_updates.js, including the (room_kind,
// room_id, seq) unique index that powers the duplicate-seq-fails behavior.
func setupJournalTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	if _, err := app.FindCollectionByNameOrId(JournalCollection); err == nil {
		return app
	}

	col := core.NewBaseCollection(JournalCollection)
	col.Fields.Add(&core.TextField{Name: "room_kind", Required: true, Max: 64})
	col.Fields.Add(&core.TextField{Name: "room_id", Required: true, Max: 64})
	col.Fields.Add(&core.NumberField{Name: "seq", Required: true, Min: ptrFloat(1), OnlyInt: true})
	col.Fields.Add(&core.TextField{Name: "update", Required: true, Max: 358400})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.AddIndex("idx_realtime_doc_updates_room_seq", true, "room_kind, room_id, seq", "")
	col.AddIndex("idx_realtime_doc_updates_room", false, "room_kind, room_id", "")
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s: %v", JournalCollection, err)
	}
	return app
}

func ptrFloat(v float64) *float64 { return &v }

func TestPocketBaseJournalAppendOne(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	payload := []byte{0x01, 0x02, 0x03}
	if err := j.Append("text-doc", "room-1", 1, payload); err != nil {
		t.Fatalf("Append: %v", err)
	}
	records, err := app.FindRecordsByFilter("realtime_doc_updates",
		"room_kind = {:k} && room_id = {:id}", "seq", 0, 0,
		map[string]any{"k": "text-doc", "id": "room-1"})
	if err != nil {
		t.Fatalf("FindRecordsByFilter: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("got %d rows; want 1", len(records))
	}
	gotSeq := records[0].GetInt("seq")
	if gotSeq != 1 {
		t.Fatalf("seq = %d; want 1", gotSeq)
	}
}

func TestPocketBaseJournalAppendDuplicateSeqFails(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	if err := j.Append("text-doc", "room-1", 1, []byte("a")); err != nil {
		t.Fatalf("first Append: %v", err)
	}
	err := j.Append("text-doc", "room-1", 1, []byte("b"))
	if err == nil {
		t.Fatalf("expected error on duplicate seq, got nil")
	}
}

func TestPocketBaseJournalAppendDifferentRoomsOK(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	if err := j.Append("text-doc", "room-1", 1, []byte("a")); err != nil {
		t.Fatalf("Append room-1: %v", err)
	}
	if err := j.Append("text-doc", "room-2", 1, []byte("b")); err != nil {
		t.Fatalf("Append room-2: %v", err)
	}
}

func TestPocketBaseJournalReplayOrdering(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	for seq, payload := range [][]byte{nil, {0x01}, {0x02}, {0x03}, {0x04}} {
		if seq == 0 {
			continue
		}
		if err := j.Append("text-doc", "room-1", int64(seq), payload); err != nil {
			t.Fatalf("Append %d: %v", seq, err)
		}
	}
	var got []int64
	err := j.Replay("text-doc", "room-1", func(seq int64, _ []byte) error {
		got = append(got, seq)
		return nil
	})
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	want := []int64{1, 2, 3, 4}
	if len(got) != len(want) {
		t.Fatalf("got %d entries; want %d (%v)", len(got), len(want), got)
	}
	for i, g := range got {
		if g != want[i] {
			t.Fatalf("entry %d: seq = %d; want %d", i, g, want[i])
		}
	}
}

func TestPocketBaseJournalReplayPayload(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	original := []byte{0x99, 0x88, 0x77, 0x66, 0x55}
	if err := j.Append("text-doc", "room-1", 1, original); err != nil {
		t.Fatalf("Append: %v", err)
	}
	var got []byte
	err := j.Replay("text-doc", "room-1", func(_ int64, payload []byte) error {
		got = payload
		return nil
	})
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if string(got) != string(original) {
		t.Fatalf("payload = %v; want %v", got, original)
	}
}

func TestPocketBaseJournalReplayStopsOnError(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	for seq := int64(1); seq <= 3; seq++ {
		if err := j.Append("text-doc", "room-1", seq, []byte{byte(seq)}); err != nil {
			t.Fatalf("Append %d: %v", seq, err)
		}
	}
	calls := 0
	want := fmt.Errorf("apply boom")
	err := j.Replay("text-doc", "room-1", func(seq int64, _ []byte) error {
		calls++
		if seq == 2 {
			return want
		}
		return nil
	})
	if err == nil || err.Error() != want.Error() {
		t.Fatalf("Replay err = %v; want %v", err, want)
	}
	if calls != 2 {
		t.Fatalf("apply called %d times; want 2 (must stop on first error)", calls)
	}
}

func TestPocketBaseJournalReplayEmptyRoomNoCalls(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	calls := 0
	err := j.Replay("text-doc", "missing", func(int64, []byte) error {
		calls++
		return nil
	})
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if calls != 0 {
		t.Fatalf("apply called %d times; want 0", calls)
	}
}

func TestPocketBaseJournalReplayIgnoresOtherRooms(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	if err := j.Append("text-doc", "room-1", 1, []byte("a")); err != nil {
		t.Fatalf("Append room-1: %v", err)
	}
	if err := j.Append("text-doc", "room-2", 1, []byte("b")); err != nil {
		t.Fatalf("Append room-2: %v", err)
	}
	if err := j.Append("calc-doc", "room-1", 1, []byte("c")); err != nil {
		t.Fatalf("Append calc-doc room-1: %v", err)
	}
	got := []string{}
	err := j.Replay("text-doc", "room-1", func(_ int64, payload []byte) error {
		got = append(got, string(payload))
		return nil
	})
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if len(got) != 1 || got[0] != "a" {
		t.Fatalf("Replay returned %v; want [a]", got)
	}
}

func TestPocketBaseJournalTruncateDropsRowsAtOrBelowSeq(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	for seq := int64(1); seq <= 5; seq++ {
		if err := j.Append("text-doc", "room-1", seq, []byte{byte(seq)}); err != nil {
			t.Fatalf("Append %d: %v", seq, err)
		}
	}
	if err := j.Truncate("text-doc", "room-1", 3); err != nil {
		t.Fatalf("Truncate: %v", err)
	}
	var remaining []int64
	err := j.Replay("text-doc", "room-1", func(seq int64, _ []byte) error {
		remaining = append(remaining, seq)
		return nil
	})
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	want := []int64{4, 5}
	if len(remaining) != len(want) {
		t.Fatalf("remaining = %v; want %v", remaining, want)
	}
	for i, r := range remaining {
		if r != want[i] {
			t.Fatalf("remaining[%d] = %d; want %d", i, r, want[i])
		}
	}
}

func TestPocketBaseJournalTruncateBelowMinIsNoop(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	if err := j.Append("text-doc", "room-1", 5, []byte("a")); err != nil {
		t.Fatalf("Append: %v", err)
	}
	if err := j.Truncate("text-doc", "room-1", 3); err != nil {
		t.Fatalf("Truncate: %v", err)
	}
	calls := 0
	if err := j.Replay("text-doc", "room-1", func(int64, []byte) error {
		calls++
		return nil
	}); err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if calls != 1 {
		t.Fatalf("rows after no-op truncate = %d; want 1", calls)
	}
}

func TestPocketBaseJournalTruncateScopedToRoom(t *testing.T) {
	app := setupJournalTestApp(t)
	j := NewPocketBaseJournal(app)
	if err := j.Append("text-doc", "room-1", 1, []byte("a")); err != nil {
		t.Fatalf("Append room-1: %v", err)
	}
	if err := j.Append("text-doc", "room-2", 1, []byte("b")); err != nil {
		t.Fatalf("Append room-2: %v", err)
	}
	if err := j.Truncate("text-doc", "room-1", 99); err != nil {
		t.Fatalf("Truncate: %v", err)
	}
	calls := 0
	if err := j.Replay("text-doc", "room-2", func(int64, []byte) error {
		calls++
		return nil
	}); err != nil {
		t.Fatalf("Replay room-2: %v", err)
	}
	if calls != 1 {
		t.Fatalf("room-2 rows after truncating room-1 = %d; want 1", calls)
	}
}
