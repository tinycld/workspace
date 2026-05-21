package text

import (
	"encoding/json"
	"math"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
	"tinycld.org/packages/text/translate"
)

// roomKindText is the realtime roomKind name owned by this package.
// Each connection at /api/realtime/text-doc/<drive_item_id> is gated
// by the authorize handler registered below.
const roomKindText = "text-doc"

// Register wires the text package's server-side hooks. Core's
// generator injects a call to this function from
// `server/package_extensions.go` once the package is linked.
//
// Wiring (mirrors calc's registerRealtime, plus the OnConnect hook
// new in M1 + M2):
//
//   - Authorize: enforces drive_shares membership before the WS
//     upgrade — same predicate as calc.
//   - RuntimeProvider: hands out per-room server-side Y.Doc handles
//     mounted on the package's Runtime; bootstrap reads the docx and
//     seeds the doc before the broker's first SyncReply.
//   - OnRoomCreate / OnDocUpdate / OnEmpty: the SaveCoordinator
//     consumes broker events to drive debounce/ceiling/teardown
//     persistence (Y.Doc -> docx -> drive_items.file).
//   - OnConnect: builds the per-client MsgServerHello payload
//     ({readOnly, importWarnings}) so the joining client can render
//     parse warnings as a banner and (eventually) gate writes.
func Register(app *pocketbase.PocketBase) {
	runtime := NewRuntime()
	runtime.SetBootstrap(makeDocxBootstrap(app, runtime))
	runtime.StartJanitor()

	journal := realtime.NewPocketBaseJournal(app)
	flush := makeProductionFlush(app, runtime)
	saveCoordinator := realtime.NewSaveCoordinator(flush)
	saveCoordinator.SetJournal(roomKindText, journal)

	realtime.RegisterRoomKindWith(roomKindText, realtime.RoomKindOptions{
		Authorize:       makeAuthorize(app),
		RuntimeProvider: runtime,
		Journal:         journal,
		OnRoomCreate:    saveCoordinator.OnRoomCreate,
		OnDocUpdate:     saveCoordinator.OnDocUpdate,
		OnDocUpdateSeq:  saveCoordinator.NoteSeq,
		OnEmpty:         saveCoordinator.OnRoomEmpty,
		OnConnect:       makeOnConnect(app, runtime),
	})

	// /api/text/render/:id — server-rendered HTML for previews +
	// print. Lives separately from the realtime registration because
	// it reads cold drive_item bytes, not live Y.Doc state. Mirrors
	// calc's registerAPI exactly.
	registerRenderAPI(app)

	// Cascade-clean WAL rows when a drive_items record (text doc) is
	// deleted. Scoped to room_kind = "text-doc"; other kinds (calc)
	// register their own parallel hook. math.MaxInt64 as the upper
	// bound effectively truncates every row regardless of seq.
	app.OnRecordAfterDeleteSuccess("drive_items").BindFunc(func(e *core.RecordEvent) error {
		if err := journal.Truncate(roomKindText, e.Record.Id, math.MaxInt64); err != nil {
			app.Logger().Warn("text: WAL cleanup on drive_items delete failed",
				"itemID", e.Record.Id, "err", err)
		}
		return e.Next()
	})
}

// serverHelloPayload is the JSON body of the MsgServerHello frame
// the broker sends to each freshly-joined client. The shape is
// stable wire contract: the M5 client decodes it via the symmetric
// TS type in @tinycld/text/lib/realtime.
//
//   - ReadOnly toggles the editor between read-only and editable mode.
//     True for viewer-role users or anyone whose share role can't be
//     resolved (fail closed); false for owner/editor.
//   - ImportWarnings is non-nil only for the connection that triggered
//     the bootstrap; later joiners on the same room see []. Each
//     warning is a {code, detail} pair the client renders as a
//     dismissable banner.
type serverHelloPayload struct {
	ReadOnly       bool                `json:"readOnly"`
	ImportWarnings []importWarningJSON `json:"importWarnings"`
}

// importWarningJSON mirrors translate.Warning but pins the wire shape
// so the client decoder doesn't have to know about the full Go type
// (Warning.Context is omitted from the wire intentionally — v1 has no
// consumer for it and shipping nil/empty maps confuses the JS side).
type importWarningJSON struct {
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

// makeOnConnect returns a ServerHelloFn that builds the per-client
// MsgServerHello payload: { readOnly, importWarnings }.
//
// Pops importWarnings from the runtime so only the first joiner of a
// freshly-bootstrapped room sees them — that's by design; the
// warnings describe an import event that happened once at room start,
// and a later reload should see a clean slate.
func makeOnConnect(app core.App, runtime *Runtime) realtime.ServerHelloFn {
	return func(roomID string, conn *realtime.Client) ([]byte, error) {
		readOnly := isReadOnlyForConn(app, roomID, conn)
		warnings := runtime.PopImportWarnings(roomID)
		payload := serverHelloPayload{
			ReadOnly:       readOnly,
			ImportWarnings: convertWarnings(warnings),
		}
		return json.Marshal(payload)
	}
}

// isReadOnlyForConn determines whether the connecting user has edit
// rights on the underlying drive_item, based on their highest-privilege
// drive_shares role:
//
//   - owner / editor → writable (returns false)
//   - viewer        → read-only (returns true)
//   - missing / unknown role → fail-closed read-only (returns true)
//
// The connection has already been admitted by makeAuthorize at this
// point, so any error from resolveShareRole here is unexpected — we
// log and return true (deny writes) rather than silently granting
// edit access on a transient DB error.
//
// Note: this is the CLIENT-side enforcement signal. The Yjs broker
// has no per-message write predicate today, so a viewer that ignores
// readOnly=true can still POST MsgDocUpdate frames. Until core grows
// a write-side filter, this gates the editor UI only — server-side
// rejection of viewer writes is a follow-up tracked in TODO.md.
func isReadOnlyForConn(app core.App, roomID string, conn *realtime.Client) bool {
	userID := conn.AuthID()
	if userID == "" {
		return true
	}
	role, err := resolveShareRole(app, userID, roomID)
	if err != nil {
		return true
	}
	return !role.canWrite()
}

// convertWarnings maps the internal translate.Warning slice to the
// wire shape. Always returns a non-nil slice (possibly empty) so the
// JSON marshals as `[]` instead of `null` — keeps client decode
// branchless.
func convertWarnings(in []translate.Warning) []importWarningJSON {
	out := make([]importWarningJSON, len(in))
	for i, w := range in {
		out[i] = importWarningJSON{Code: string(w.Code), Detail: w.Detail}
	}
	return out
}
