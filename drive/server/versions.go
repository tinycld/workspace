package drive

import (
	"io"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// snapshotCurrentFile creates a version record from the current file on a drive_items record.
// Skips silently if the item has no file attached.
// Version number assignment is done inside a transaction to prevent races.
func snapshotCurrentFile(app *pocketbase.PocketBase, itemRecord *core.Record, userOrgID, source, label string) error {
	filename := itemRecord.GetString("file")
	if filename == "" {
		return nil
	}

	reader, err := readFileContent(app, itemRecord)
	if err != nil {
		return err
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}

	f, err := filesystem.NewFileFromBytes(data, filename)
	if err != nil {
		return err
	}

	collection, err := app.FindCollectionByNameOrId("drive_item_versions")
	if err != nil {
		return err
	}

	return app.RunInTransaction(func(txApp core.App) error {
		var result struct {
			Max int `db:"max_ver"`
		}
		err := txApp.DB().
			NewQuery("SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM drive_item_versions WHERE item = {:item}").
			Bind(map[string]any{"item": itemRecord.Id}).
			One(&result)
		if err != nil {
			result.Max = 0
		}

		record := core.NewRecord(collection)
		record.Set("item", itemRecord.Id)
		record.Set("version_number", result.Max+1)
		record.Set("file", f)
		record.Set("size", itemRecord.GetInt("size"))
		record.Set("mime_type", itemRecord.GetString("mime_type"))
		record.Set("source", source)
		record.Set("label", label)
		record.Set("created_by", userOrgID)

		return txApp.Save(record)
	})
}
