package text

import (
	"fmt"
	"io"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"tinycld.org/core/realtime"
	"tinycld.org/packages/text/translate"
)

// makeProductionFlush returns a FlushFn that the SaveCoordinator
// invokes for each text room. The flow is:
//
//  1. Snapshot the Y.Doc as ProseMirror JSON via translate.PMJSONFromYDoc.
//  2. Convert to .docx bytes via translate.PMJSONToDocx.
//  3. Reload the drive_items record and overwrite its `file` field.
//
// The returned closure is safe to call concurrently for different
// rooms; the SaveCoordinator never re-enters the same room concurrently.
//
// PMJSONToDocx wraps WordZero, which has historically panicked on
// malformed inputs. Concurrent calls from different rooms are
// serialized inside the translate package via numberingMu — WordZero's
// NumberingManager is a process-global singleton. The named-return +
// deferred recover here converts any remaining panic into an error so
// the SaveCoordinator's retry/backoff path can handle it instead of
// the broker goroutine going down.
func makeProductionFlush(app core.App, _ *Runtime) realtime.FlushFn {
	return func(driveItemID string, handle realtime.DocHandle) (returnedErr error) {
		defer func() {
			if r := recover(); r != nil {
				app.Logger().Error("text: flush panicked",
					"driveItemID", driveItemID, "panic", r)
				returnedErr = fmt.Errorf("text: flush panicked for %s: %v", driveItemID, r)
			}
		}()

		if handle == nil {
			return fmt.Errorf("text: flush called with nil handle for %s", driveItemID)
		}
		th, ok := handle.(*textDocHandle)
		if !ok {
			return fmt.Errorf("text: flush expected *textDocHandle, got %T", handle)
		}

		th.mu.Lock()
		closed := th.closed
		doc := th.doc
		th.mu.Unlock()
		if closed || doc == nil {
			return fmt.Errorf("text: flush on closed room %s", driveItemID)
		}

		pmJSON, err := translate.PMJSONFromYDoc(doc)
		if err != nil {
			return fmt.Errorf("text: serialize Y.Doc for %s: %w", driveItemID, err)
		}

		docxBytes, _, err := translate.PMJSONToDocxWithResolver(pmJSON, makeDriveImageResolver(app))
		if err != nil {
			return fmt.Errorf("text: PMJSONToDocx for %s: %w", driveItemID, err)
		}
		if len(docxBytes) == 0 {
			return fmt.Errorf("text: PMJSONToDocx produced empty bytes for %s", driveItemID)
		}

		item, err := app.FindRecordById(driveItemsCollection, driveItemID)
		if err != nil {
			return fmt.Errorf("text: load drive_items %s: %w", driveItemID, err)
		}

		// Reuse the original filename so URLs / mime detection stay
		// consistent. PocketBase will rename the on-disk blob to a
		// fresh hash on save, so the prior blob isn't overwritten in
		// place.
		filename := item.GetString("file")
		if filename == "" {
			filename = "untitled.docx"
		}
		fileRef, err := filesystem.NewFileFromBytes(docxBytes, filename)
		if err != nil {
			return fmt.Errorf("text: build filesystem.File for %s: %w", driveItemID, err)
		}
		item.Set("file", fileRef)
		item.Set("size", len(docxBytes))

		if err := app.Save(item); err != nil {
			return fmt.Errorf("text: save drive_items %s: %w", driveItemID, err)
		}
		return nil
	}
}

// makeDriveImageResolver returns the ImageResolver the docx emitter uses
// to embed inserted images. The editor stores inserted images as
// /api/files/drive_items/<id>/<file> URLs (keeping the Y.Doc small);
// docx needs the actual bytes, so this reads them straight off the
// drive_items record via the PocketBase filesystem. We read the record's
// current `file` field rather than the name parsed from the URL, so an
// image whose blob was re-uploaded after insertion still resolves to the
// live bytes instead of 404ing on a stale name.
func makeDriveImageResolver(app core.App) translate.ImageResolver {
	return func(driveItemID, _ string) ([]byte, error) {
		item, err := app.FindRecordById(driveItemsCollection, driveItemID)
		if err != nil {
			return nil, fmt.Errorf("find drive_items %s: %w", driveItemID, err)
		}
		stored := item.GetString("file")
		if stored == "" {
			return nil, fmt.Errorf("drive_items %s has no file", driveItemID)
		}

		fsys, err := app.NewFilesystem()
		if err != nil {
			return nil, fmt.Errorf("open filesystem: %w", err)
		}
		defer fsys.Close()

		reader, err := fsys.GetReader(item.BaseFilesPath() + "/" + stored)
		if err != nil {
			return nil, fmt.Errorf("read drive_items %s file %s: %w", driveItemID, stored, err)
		}
		defer reader.Close()

		data, err := io.ReadAll(reader)
		if err != nil {
			return nil, fmt.Errorf("read drive_items %s bytes: %w", driveItemID, err)
		}
		return data, nil
	}
}
