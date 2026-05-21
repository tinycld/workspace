package calc

import (
	"errors"
	"math"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
)

// roomKindCalc is the realtime roomKind name owned by this package.
// Each connection at /api/realtime/calc/<drive_item_id> is gated by
// the authorize handler registered below.
const roomKindCalc = "calc"

// errNoShare is returned when the user has no drive_shares row for the
// requested drive_item. It is the only kind of denial calc emits;
// distinguishing share roles (viewer vs. editor) happens client-side
// for now (a future save-back effort will enforce roles server-side).
var errNoShare = errors.New("calc: no drive_shares row for this user/item")

// registerRealtime is called once at startup from Register(). It plugs
// the calc authorize handler, the y-crdt Runtime, and the
// SaveCoordinator into core's realtime registry. The closures
// capture `app` so they can run share-access queries and persist
// XLSX bytes back to drive_items.
//
// Wiring:
//   - Authorize: enforces drive_shares membership before the WS
//     upgrade.
//   - RuntimeProvider: hands out per-room server-side Y.Doc handles.
//   - OnRoomCreate / OnDocUpdate / OnEmpty: the save coordinator
//     consumes broker events to drive debounce/ceiling/teardown
//     persistence.
//   - Runtime.SetBootstrap: server reads the drive_items xlsx and
//     populates the doc before the broker's first SyncReply, so
//     clients never see xlsx bytes.
func registerRealtime(app *pocketbase.PocketBase) {
	runtime := NewRuntime()
	runtime.SetBootstrap(makeXLSXBootstrap(app))

	journal := realtime.NewPocketBaseJournal(app)
	coordinator := realtime.NewSaveCoordinator(MakeProductionFlush(app))
	coordinator.SetJournal(roomKindCalc, journal)

	realtime.RegisterRoomKindWith(roomKindCalc, realtime.RoomKindOptions{
		Authorize: func(auth *core.Record, roomID string) error {
			if auth == nil || auth.Id == "" {
				return errNoShare
			}
			return checkDriveItemAccess(app, auth.Id, roomID)
		},
		RuntimeProvider: runtime,
		Journal:         journal,
		OnRoomCreate:    coordinator.OnRoomCreate,
		OnDocUpdate:     coordinator.OnDocUpdate,
		OnDocUpdateSeq:  coordinator.NoteSeq,
		OnEmpty:         coordinator.OnRoomEmpty,
	})

	// Cascade-clean WAL rows when a drive_items record (calc workbook)
	// is deleted. Scoped to room_kind = "calc"; other kinds register
	// their own parallel hook. math.MaxInt64 as the upper bound
	// effectively truncates every row regardless of seq.
	app.OnRecordAfterDeleteSuccess("drive_items").BindFunc(func(e *core.RecordEvent) error {
		if err := journal.Truncate(roomKindCalc, e.Record.Id, math.MaxInt64); err != nil {
			app.Logger().Warn("calc: WAL cleanup on drive_items delete failed",
				"itemID", e.Record.Id, "err", err)
		}
		return e.Next()
	})
}

// checkDriveItemAccess returns nil iff the user identified by userID has
// at least one drive_shares row connecting them (via any of their
// user_org records) to the given drive_item.
//
// Mirrors the shape of the PB RLS rule:
//
//	item.drive_shares_via_item.user_org.user ?= @request.auth.id
//
// We do the lookup directly against drive_shares rather than walking
// through drive_items because the room admission only cares whether
// *any* share row exists for this (user, item) pair — role-level
// distinctions are enforced elsewhere.
func checkDriveItemAccess(app *pocketbase.PocketBase, userID, driveItemID string) error {
	rows, err := app.FindRecordsByFilter(
		"drive_shares",
		"item = {:item} && user_org.user = {:user}",
		"",
		1,
		0,
		map[string]any{"item": driveItemID, "user": userID},
	)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoShare
	}
	return nil
}
