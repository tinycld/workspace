package calc

import (
	"fmt"

	"github.com/pocketbase/pocketbase"
	ycrdt "github.com/skyterra/y-crdt"
)

// makeXLSXBootstrap returns the runtime bootstrap closure. On first
// open of a calc room, it loads the drive_items xlsx referenced by
// roomID, parses it into a WorkbookModel, and stamps the result into
// the freshly-minted server-side Y.Doc.
//
// The hook is invoked synchronously inside Runtime.NewDoc, before the
// broker delivers any SyncReply. So peers always see populated state
// regardless of join order — eliminating the prior client-side first-
// joiner-bootstrap path that required clients to parse xlsx bytes.
//
// A drive_item with no attached file (newly-created, mid-upload) reads
// as zero bytes; the closure returns nil and the room continues with
// an empty Y.Doc. Subsequent edits flow normally; SaveRoom will write
// the xlsx out from scratch on the first save.
func makeXLSXBootstrap(app *pocketbase.PocketBase) func(roomID string, doc *ycrdt.Doc) error {
	return func(roomID string, doc *ycrdt.Doc) error {
		item, err := app.FindRecordById(driveItemsCollection, roomID)
		if err != nil {
			return fmt.Errorf("load drive_items %s: %w", roomID, err)
		}
		xlsxBytes, err := readDriveItemBytes(app, item)
		if err != nil {
			return fmt.Errorf("read xlsx for %s: %w", roomID, err)
		}
		if len(xlsxBytes) == 0 {
			// Even an empty workbook needs the pivots map registered,
			// so a peer that adds the first pivot has the type visible
			// in the next EncodeStateAsUpdate (e.g. when the same
			// client re-creates its doc on a route change).
			doc.GetMap("pivots")
			return nil
		}
		model, err := ReadWorkbookFromXLSX(xlsxBytes, 0, 0)
		if err != nil {
			return fmt.Errorf("parse xlsx for %s: %w", roomID, err)
		}
		if err := BootstrapYDocFromWorkbook(doc, model); err != nil {
			return fmt.Errorf("populate Y.Doc for %s: %w", roomID, err)
		}
		return nil
	}
}
