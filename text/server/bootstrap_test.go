package text

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

// TestBootstrap_LoadsAndSeeds parses feature-test.docx through the
// runtime + bootstrap chain, then verifies the resulting Y.Doc has
// non-trivial state. EncodeStateAsUpdate on a freshly-bootstrapped
// doc with real content should be substantially larger than an empty
// doc's state header.
func TestBootstrap_LoadsAndSeeds(t *testing.T) {
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

	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if len(state) < 100 {
		t.Errorf("Y.Doc looks empty after bootstrap (state size %d); expected > 100", len(state))
	}
}

// TestBootstrap_EmptyFileLeavesEmptyDoc confirms a drive_item with no
// file (e.g. just-created, mid-upload) is tolerated: the bootstrap
// closure short-circuits, the room is created with an empty Y.Doc, and
// the first edit will populate it.
func TestBootstrap_EmptyFileLeavesEmptyDoc(t *testing.T) {
	app := setupTestApp(t)
	item := seedDriveItem(t, app, "empty.docx", nil)

	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))

	handle, err := runtime.NewDoc(item.Id)
	if err != nil {
		t.Fatalf("NewDoc on empty drive_item: %v", err)
	}
	defer func() { _ = handle.Close() }()

	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	// A fresh / empty Y.Doc encodes to a tiny header. Anything beyond
	// a few dozen bytes would suggest the bootstrap accidentally
	// stamped content.
	if len(state) > 50 {
		t.Errorf("Y.Doc unexpectedly populated for empty file (state size %d)", len(state))
	}
}

// TestBootstrap_CorruptDocxLogsAndContinues confirms the runtime
// contract: bootstrap errors are logged but do NOT abort room creation
// (see Runtime.NewDoc). A non-docx blob causes the parser to error;
// the room continues with an empty Y.Doc, and a peer-driven SyncRequest
// path can still recover.
func TestBootstrap_CorruptDocxLogsAndContinues(t *testing.T) {
	app := setupTestApp(t)
	garbage := []byte("this is not a docx file, just plain text")
	item := seedDriveItem(t, app, "broken.docx", garbage)

	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))

	handle, err := runtime.NewDoc(item.Id)
	if err != nil {
		t.Fatalf("NewDoc on corrupt docx unexpectedly errored: %v", err)
	}
	defer func() { _ = handle.Close() }()

	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	// Bootstrap failed → empty Y.Doc → tiny encoded state.
	if len(state) > 50 {
		t.Errorf("Y.Doc unexpectedly populated for corrupt docx (state size %d)", len(state))
	}

	// And no warnings should have been stashed (the failure path
	// returns before the SetImportWarnings call).
	if w := runtime.PopImportWarnings(item.Id); w != nil {
		t.Errorf("PopImportWarnings after corrupt-docx bootstrap: want nil, got %+v", w)
	}
}

// TestBootstrap_MissingDriveItemLogsAndContinues confirms the same
// log-and-continue contract for the FindRecordById failure mode (room
// id doesn't correspond to any drive_items row — should never happen
// in production since the broker rejects unknown rooms upstream, but
// the runtime is defensive anyway).
func TestBootstrap_MissingDriveItemLogsAndContinues(t *testing.T) {
	app := setupTestApp(t)

	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))

	handle, err := runtime.NewDoc("nonexistent-drive-item-id")
	if err != nil {
		t.Fatalf("NewDoc on missing drive_item unexpectedly errored: %v", err)
	}
	defer func() { _ = handle.Close() }()

	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if len(state) > 50 {
		t.Errorf("Y.Doc unexpectedly populated for missing drive_item (state size %d)", len(state))
	}
}

// TestReadCappedBytes_OverLimit ensures a reader that produces more
// than MaxDocxBytes is rejected. Bypasses PocketBase's filesystem
// indirection so the cap is exercised directly.
func TestReadCappedBytes_OverLimit(t *testing.T) {
	// A small limit keeps the test allocation tiny; the cap path is
	// identical regardless of the limit's numeric value.
	const limit = int64(1024)
	src := bytes.NewReader(make([]byte, limit+1))

	if _, err := readCappedBytes(src, limit); err == nil {
		t.Fatal("expected size-cap error, got nil")
	} else if !strings.Contains(err.Error(), "exceeds size cap") {
		t.Errorf("error %q does not mention the size cap", err)
	}
}

// TestReadCappedBytes_AtLimit confirms a reader sitting exactly at the
// limit succeeds — the cap is a strict greater-than check so we don't
// accidentally reject the equality case.
func TestReadCappedBytes_AtLimit(t *testing.T) {
	const limit = int64(1024)
	src := bytes.NewReader(make([]byte, limit))

	buf, err := readCappedBytes(src, limit)
	if err != nil {
		t.Fatalf("readCappedBytes at limit: %v", err)
	}
	if int64(len(buf)) != limit {
		t.Errorf("readCappedBytes at limit returned %d bytes, want %d", len(buf), limit)
	}
}

// TestReadCappedBytes_PropagatesReadError surfaces an underlying read
// error rather than masquerading as a cap violation.
func TestReadCappedBytes_PropagatesReadError(t *testing.T) {
	src := failingReader{err: io.ErrUnexpectedEOF}
	if _, err := readCappedBytes(src, 1024); err == nil {
		t.Fatal("expected read error, got nil")
	}
}

// failingReader always returns its configured error from Read. Used to
// verify readCappedBytes propagates upstream failures rather than
// masking them.
type failingReader struct{ err error }

func (f failingReader) Read(_ []byte) (int, error) { return 0, f.err }
