package text

import (
	"testing"
)

// TestFlush_PersistsToDrive runs a full save cycle: bootstrap a doc
// from the fixture, run the production flush, fetch the drive_item
// back, and verify the file blob and size were updated.
func TestFlush_PersistsToDrive(t *testing.T) {
	app := setupTestApp(t)
	fixture := loadFixtureDocx(t, "feature-test.docx")
	item := seedDriveItem(t, app, "feature-test.docx", fixture)

	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))
	handle, err := runtime.NewDoc(item.Id)
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	defer func() { _ = handle.Close() }()

	flush := makeProductionFlush(app, runtime)
	if err := flush(item.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	updated, err := app.FindRecordById(driveItemsCollection, item.Id)
	if err != nil {
		t.Fatalf("re-fetch: %v", err)
	}
	if updated.GetString("file") == "" {
		t.Error("drive_item file is empty after flush")
	}
	if updated.GetInt("size") <= 0 {
		t.Errorf("drive_item size is non-positive (%d) after flush", updated.GetInt("size"))
	}

	// Read the file bytes back to confirm flush wrote a real docx.
	bytesAfter, err := readDriveItemBytes(app, updated)
	if err != nil {
		t.Fatalf("readDriveItemBytes after flush: %v", err)
	}
	if len(bytesAfter) == 0 {
		t.Fatal("file bytes empty after flush")
	}
	// docx files are ZIP containers; the ZIP signature is "PK\x03\x04".
	if len(bytesAfter) < 4 || string(bytesAfter[:2]) != "PK" {
		t.Errorf("flushed bytes don't look like a docx (zip header missing): first bytes %v", bytesAfter[:min(4, len(bytesAfter))])
	}
}

// TestFlush_NilHandleReturnsErr is the misuse-guard test mirroring
// calc's TestSaveRoomNilHandleReturnsError. A nil handle should error
// rather than panic.
func TestFlush_NilHandleReturnsErr(t *testing.T) {
	app := setupTestApp(t)
	runtime := NewRuntime()
	flush := makeProductionFlush(app, runtime)
	if err := flush("any-id", nil); err == nil {
		t.Fatal("expected nil-handle to error")
	}
}

// TestFlush_ClosedHandleReturnsErr confirms a flush against a closed
// handle surfaces an error rather than crashing the SaveCoordinator.
func TestFlush_ClosedHandleReturnsErr(t *testing.T) {
	app := setupTestApp(t)
	item := seedDriveItem(t, app, "x.docx", []byte{})

	runtime := NewRuntime()
	handle, err := runtime.NewDoc(item.Id)
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	if err := handle.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	flush := makeProductionFlush(app, runtime)
	if err := flush(item.Id, handle); err == nil {
		t.Fatal("expected closed-handle to error")
	}
}

// TestFlush_MissingDriveItemReturnsErr: passing a roomID that no
// drive_items row matches must surface the FindRecordById failure
// (rather than silently no-op).
func TestFlush_MissingDriveItemReturnsErr(t *testing.T) {
	app := setupTestApp(t)
	fixture := loadFixtureDocx(t, "feature-test.docx")
	item := seedDriveItem(t, app, "feature-test.docx", fixture)

	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))
	handle, err := runtime.NewDoc(item.Id)
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	defer func() { _ = handle.Close() }()

	flush := makeProductionFlush(app, runtime)
	if err := flush("nonexistent-id", handle); err == nil {
		t.Fatal("expected missing-drive-item to error")
	}
}

// TestSaveCoordinator_DebounceCadence is intentionally skipped:
// SaveCoordinator's interval fields (debounceEvery, ceilingEvery,
// teardownTimeout) are unexported, so a test in this package can't
// shrink them without time.Sleep'ing through the production defaults
// (3s + 15s) — too flaky and too slow to be useful as a regression
// guard. Cadence behavior is owned by core's save_coordinator_test.go,
// which is in the same package and can mutate the fields directly.
//
// A v2 ergonomics improvement would be to add a small public
// Configure / WithIntervals constructor to SaveCoordinator and let
// downstream packages drive cadence tests directly. Track separately.
func TestSaveCoordinator_DebounceCadence(t *testing.T) {
	t.Skip("SaveCoordinator interval fields are unexported; cadence is exercised in core's save_coordinator_test.go")
}
