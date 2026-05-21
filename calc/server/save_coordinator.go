package calc

import (
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
)

// MakeProductionFlush returns a FlushFn that calls the real
// SaveRoom against the given app. The loadComments dep is plumbed
// through so the saved xlsx carries the workbook's calc_comments rows
// as classic cell notes (one-way: app → xlsx).
func MakeProductionFlush(app core.App) realtime.FlushFn {
	loadComments := MakeProductionLoadComments(app)
	return func(driveItemID string, handle realtime.DocHandle) error {
		return SaveRoom(app, handle, driveItemID, loadComments)
	}
}
