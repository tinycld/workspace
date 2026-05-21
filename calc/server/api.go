package calc

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/packages/calc/render"
)

// registerAPI binds the calc HTTP endpoints. Called from Register at
// startup. Each endpoint runs through the standard PocketBase auth
// middleware (so re.Auth is non-nil) and additionally enforces drive
// share access via checkDriveItemAccess — same gate the realtime
// authorize uses.
func registerAPI(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/calc/render/{id}", func(re *core.RequestEvent) error {
			return handleRender(app, re)
		}).BindFunc(requireAuthCalc)
		return e.Next()
	})
}

// requireAuthCalc rejects unauthenticated requests with a 401. PB sets
// re.Auth from the Authorization header (Bearer token) or from the
// pb_auth cookie — both are populated transparently by core's serve
// middleware before our handler runs.
func requireAuthCalc(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}

// handleRender returns the rendered HTML fragment for the drive_item
// identified by `:id`. The response is a sanitized content fragment
// containing only `tinycld-calc*` classes — no <html>, no <head>, no
// inline styles. Clients (preview iframe / print envelope) wrap it
// with their own CSS.
//
// Query params:
//   - sheet:   sheet name to render (default: all visible sheets, or
//              the first visible sheet when scope=selection).
//   - range:   A1 range string to clip to (default: full used range).
//   - scope:   "all" (default) or "selection".
//   - images:  "url" (default) or "embed". Reserved for the future
//              image-extraction pass; the calc renderer currently
//              emits cell text only.
//
// ETag: derived from drive_item `updated` + renderer version. Honors
// `If-None-Match` → 304.
func handleRender(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	driveItemID := re.Request.PathValue("id")
	if driveItemID == "" {
		return re.BadRequestError("missing drive_item id", nil)
	}
	if err := checkDriveItemAccess(app, re.Auth.Id, driveItemID); err != nil {
		return re.ForbiddenError("no access to this drive item", nil)
	}
	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return re.NotFoundError("drive item not found", err)
	}

	etag := renderETag(driveItemID, item.GetString("updated"))
	if match := re.Request.Header.Get("If-None-Match"); match == etag {
		re.Response.Header().Set("ETag", etag)
		re.Response.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
		re.Response.WriteHeader(304)
		return nil
	}

	q := re.Request.URL.Query()
	opts := render.RenderOpts{
		Sheet:  q.Get("sheet"),
		Range:  q.Get("range"),
		Scope:  render.Scope(q.Get("scope")),
		Images: render.ImageMode(q.Get("images")),
	}

	xlsxBytes, err := readDriveItemBytes(app, item)
	if err != nil {
		return re.InternalServerError("could not read file", err)
	}
	var html string
	if len(xlsxBytes) == 0 {
		html = `<section class="tinycld-calc"></section>`
	} else {
		model, err := ReadWorkbookFromXLSX(xlsxBytes, 0, 0)
		if err != nil {
			return re.InternalServerError("could not parse spreadsheet", err)
		}
		html, err = render.RenderHTML(workbookForRender(model), opts)
		if err != nil {
			// Caller-input errors (bad range, unknown sheet, unsupported
			// scope) surface as render.ErrBadRequest; the renderer
			// classifies them so the HTTP layer can choose the right
			// status. Everything else stays a 500 — that's an internal
			// bug or sanitizer issue the operator needs to see.
			if errors.Is(err, render.ErrBadRequest) {
				return re.BadRequestError(err.Error(), err)
			}
			return re.InternalServerError("could not render spreadsheet", err)
		}
	}

	re.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
	re.Response.Header().Set("ETag", etag)
	re.Response.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	_, _ = re.Response.Write([]byte(html))
	return nil
}

// renderETag derives an opaque ETag for a render request. Composed of
// the renderer version + the drive_item's `updated` timestamp so the
// cached preview invalidates both when the file changes and when the
// renderer itself does.
func renderETag(driveItemID, updated string) string {
	sum := sha256.Sum256([]byte(driveItemID + "|" + updated + "|" + render.RendererVersion))
	return fmt.Sprintf(`"%s"`, hex.EncodeToString(sum[:16]))
}
