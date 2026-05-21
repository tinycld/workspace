package drive

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/textextract"
)

// extractAndIndexDriveItem extracts text from the file attached to a drive item
// and updates its FTS content. Designed to run in a goroutine.
func extractAndIndexDriveItem(app *pocketbase.PocketBase, record *core.Record) {
	if record.GetBool("is_folder") {
		return
	}

	filename := record.GetString("file")
	if filename == "" {
		return
	}

	mimeType := record.GetString("mime_type")
	if mimeType == "" {
		return
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		app.Logger().Warn("Drive FTS: failed to open filesystem",
			"id", record.Id, "error", err)
		return
	}
	defer fsys.Close()

	key := record.BaseFilesPath() + "/" + filename
	blob, err := fsys.GetReader(key)
	if err != nil {
		app.Logger().Warn("Drive FTS: failed to read file",
			"id", record.Id, "key", key, "error", err)
		return
	}
	defer blob.Close()

	text, err := textextract.Extract(blob, mimeType, textextract.MaxOutputBytes)
	if err != nil {
		app.Logger().Warn("Drive FTS: text extraction failed",
			"id", record.Id, "mime", mimeType, "error", err)
		return
	}

	if text == "" {
		return
	}

	updateFTSContent(app, record.Id, text)
}
