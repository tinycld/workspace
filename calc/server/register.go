package calc

import (
	"github.com/pocketbase/pocketbase"
)

// Register wires server-side hooks for the Sheets package. Core's
// generator injects a call to this function from `server/package_extensions.go`
// once the package is linked.
//
// Typical responsibilities:
//   - Register audit hooks for your collections (see tinycld.org/core/audit).
//   - Bind record lifecycle hooks via `app.OnRecordCreate("...").BindFunc(...)`.
//   - Register HTTP endpoints via `app.OnServe().BindFunc(...)`.
//
// See contacts/server/register.go or calendar/server/register.go for richer
// examples.
func Register(app *pocketbase.PocketBase) {
	registerRealtime(app)
	registerAPI(app)
}
