package text

import (
	"fmt"
	"io"

	"github.com/pocketbase/pocketbase/core"
	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/packages/text/translate"
)

// driveItemsCollection is the PocketBase collection where text
// document blobs live. The roomID handed to a text RealtimeRoom IS
// the drive_items.id — text shares drive's collection (text documents
// ARE drive_items with mime=docx).
const driveItemsCollection = "drive_items"

// MaxDocxBytes caps the size of a drive_items file the bootstrap loads
// into memory at 25 MiB. A pathological or hostile blob bigger than
// this is rejected with an error rather than being slurped via
// io.ReadAll; the bootstrap-failure path in Runtime.NewDoc then
// degrades to an empty Y.Doc with a Warn log.
const MaxDocxBytes = 25 * 1024 * 1024

// makeDocxBootstrap returns the runtime bootstrap closure. On first
// open of a text room, it loads the drive_items docx referenced by
// roomID, parses it via translate.DocxToPMJSON, and seeds the result
// into the freshly-minted server-side Y.Doc.
//
// The hook is invoked synchronously inside Runtime.NewDoc, before the
// broker delivers any SyncReply. So peers always see populated state
// regardless of join order.
//
// A drive_item with no attached file (newly-created, mid-upload) reads
// as zero bytes; the closure returns nil and the room continues with
// an empty Y.Doc. Subsequent edits flow normally; the flush will
// write a docx out from scratch on the first save.
//
// Parser warnings (tracked changes stripped, unsupported nodes coerced,
// etc.) are stashed on the runtime keyed by roomID for the OnConnect
// ServerHelloFn to surface to the joining client via MsgServerHello.
func makeDocxBootstrap(app core.App, runtime *Runtime) func(roomID string, doc *ycrdt.Doc) error {
	return func(roomID string, doc *ycrdt.Doc) error {
		item, err := app.FindRecordById(driveItemsCollection, roomID)
		if err != nil {
			return fmt.Errorf("text: load drive_items %s: %w", roomID, err)
		}
		docxBytes, err := readDriveItemBytes(app, item)
		if err != nil {
			return fmt.Errorf("text: read docx for %s: %w", roomID, err)
		}
		if len(docxBytes) == 0 {
			// Empty file; first edit populates the Y.Doc and the
			// flush serializes a fresh docx.
			return nil
		}

		pmJSON, warnings, err := translate.DocxToPMJSON(docxBytes)
		if err != nil {
			return fmt.Errorf("text: parse docx for %s: %w", roomID, err)
		}

		if err := translate.SeedFromPMJSON(doc, pmJSON); err != nil {
			return fmt.Errorf("text: seed Y.Doc for %s: %w", roomID, err)
		}

		runtime.SetImportWarnings(roomID, warnings)
		return nil
	}
}

// readDriveItemBytes loads the file attachment from a drive_items
// record. Mirrors calc/server/persist.go::readDriveItemBytes; the only
// divergence is the MaxDocxBytes cap enforced via readCappedBytes.
func readDriveItemBytes(app core.App, item *core.Record) ([]byte, error) {
	filename := item.GetString("file")
	if filename == "" {
		return nil, nil
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, fmt.Errorf("open filesystem: %w", err)
	}
	defer fsys.Close()

	key := item.BaseFilesPath() + "/" + filename
	rdr, err := fsys.GetReader(key)
	if err != nil {
		return nil, fmt.Errorf("get reader for %s: %w", key, err)
	}
	defer rdr.Close()

	return readCappedBytes(rdr, MaxDocxBytes)
}

// readCappedBytes reads from r up to limit+1 bytes; if the read
// returns more than `limit` bytes the source is over-sized and we
// surface an error instead of returning truncated content. Separated
// out so bootstrap_test.go can exercise the cap with a synthetic
// reader.
func readCappedBytes(r io.Reader, limit int64) ([]byte, error) {
	buf, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(buf)) > limit {
		return nil, fmt.Errorf("docx exceeds size cap of %d bytes", limit)
	}
	return buf, nil
}
