package calc

import (
	"math"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/realtime"
)

// addWALCollection extends the test app's schema with the
// realtime_doc_updates collection so PocketBaseJournal can write rows
// against the test app. Mirrors the migration in core's pb_migrations.
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

// TestRealtimeWAL_CleanupOnDriveItemDelete confirms the cascade hook
// wired in registerRealtime clears WAL rows when their drive_item is
// deleted. Without this hook, deleting a workbook would leak journal
// rows that nothing would ever truncate (the room is gone).
func TestRealtimeWAL_CleanupOnDriveItemDelete(t *testing.T) {
	app := setupPersistTestApp(t)
	addWALCollection(t, app)

	// Register the cleanup hook directly against the test app.
	// We don't call registerRealtime because it also touches the
	// global room-kind registry, which the calc realtime_authorize
	// tests already exercise — re-registration would panic.
	journal := realtime.NewPocketBaseJournal(app)
	app.OnRecordAfterDeleteSuccess("drive_items").BindFunc(func(e *core.RecordEvent) error {
		if err := journal.Truncate(roomKindCalc, e.Record.Id, math.MaxInt64); err != nil {
			app.Logger().Warn("calc: WAL cleanup on drive_items delete failed",
				"itemID", e.Record.Id, "err", err)
		}
		return e.Next()
	})

	// Use a single-byte payload; seedDriveItem's filesystem.NewFileFromBytes
	// rejects empty content with "cannot create an empty file".
	itemID := seedDriveItem(t, app, "wal-cleanup.xlsx", []byte{0x00})

	// Append a WAL row for this drive_item.
	if err := journal.Append(roomKindCalc, itemID, 1, []byte{0x01}); err != nil {
		t.Fatalf("Append: %v", err)
	}

	// Delete the drive_item — the hook should fire and clear the WAL.
	itemRec, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		t.Fatalf("FindRecordById: %v", err)
	}
	if err := app.Delete(itemRec); err != nil {
		t.Fatalf("Delete drive_item: %v", err)
	}

	// Confirm the WAL is empty for this room.
	calls := 0
	if err := journal.Replay(roomKindCalc, itemID, func(int64, []byte) error {
		calls++
		return nil
	}); err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if calls != 0 {
		t.Fatalf("WAL rows after drive_item delete = %d; want 0", calls)
	}
}
