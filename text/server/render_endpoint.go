package text

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/packages/text/render"
	"tinycld.org/packages/text/translate"
)

// docxMimeType is the canonical Office Open XML wordprocessing
// MIME. The text render endpoint refuses any drive item with a
// different mime — a docx parser run on, say, a PDF would either
// 500 with an opaque error or, worse, leak garbled bytes through
// the renderer.
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// registerRenderAPI binds the text HTTP render endpoint. Called from
// Register at startup. The endpoint runs through the standard PB auth
// middleware (so re.Auth is non-nil) and additionally enforces drive
// share access via resolveShareRole — same predicate the realtime
// authorize uses.
//
// Mirrors calc/server/api.go::registerAPI verbatim. The two endpoints
// (/api/calc/render and /api/text/render) are deliberately structured
// the same so client-side `fetchRenderedHtml` can dispatch by mime
// without per-package branching.
func registerRenderAPI(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/text/render/{id}", func(re *core.RequestEvent) error {
			return handleRender(app, re)
		}).BindFunc(requireAuthText)
		return e.Next()
	})
}

// requireAuthText rejects unauthenticated requests with a 401. PB
// sets re.Auth from the Authorization header (Bearer token) or from
// the pb_auth cookie — both populated by core's serve middleware
// before our handler runs.
func requireAuthText(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}

// handleRender returns the rendered HTML fragment for the drive_item
// identified by `:id`. The response is a sanitized content fragment
// containing only `tinycld-text*` classes — no <html>, no <head>, no
// inline styles. Clients (preview iframe / print envelope) wrap it
// with their own CSS.
//
// Query params:
//   - images:  "url" (default) or "embed". Embed mode resolves any
//              non-data: image src through PocketBase's file system
//              and inlines the bytes as a base64 data URI. Used by
//              print where the renderer's output is handed to
//              expo-print (native) or a print iframe (web) that
//              can't carry the user's auth cookie to fetch images.
//
// ETag: derived from drive_item `updated` + renderer version. Honors
// `If-None-Match` → 304.
func handleRender(app core.App, re *core.RequestEvent) error {
	driveItemID := re.Request.PathValue("id")
	if driveItemID == "" {
		return re.BadRequestError("missing drive_item id", nil)
	}
	// resolveShareRole returns errNoShare for both "no row exists" and
	// "row belongs to a different org" — the role itself isn't needed
	// for render (read-only operation; viewers can render).
	if _, err := resolveShareRole(app, re.Auth.Id, driveItemID); err != nil {
		return re.ForbiddenError("no access to this drive item", nil)
	}
	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return re.NotFoundError("drive item not found", err)
	}
	// Mime validation: the renderer's pipeline (DocxToPMJSON →
	// PMJSONToHTML) is docx-only. Reading bytes from a PDF / image /
	// arbitrary blob and feeding them through DocxToPMJSON would
	// surface as an opaque 500 — return a clean 4xx instead so
	// callers can distinguish "wrong content type" from "renderer
	// crashed".
	if mt := item.GetString("mime_type"); mt != docxMimeType {
		return re.BadRequestError("not a docx", nil)
	}

	etag := renderETag(driveItemID, item.GetString("updated"))
	if match := re.Request.Header.Get("If-None-Match"); match == etag {
		re.Response.Header().Set("ETag", etag)
		re.Response.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
		re.Response.WriteHeader(304)
		return nil
	}

	images := translate.ImageMode(re.Request.URL.Query().Get("images"))
	if images == "" {
		images = translate.ImageModeURL
	}

	docxBytes, err := readDriveItemBytes(app, item)
	if err != nil {
		return re.InternalServerError("could not read file", err)
	}

	var fragment string
	if len(docxBytes) == 0 {
		fragment = `<article class="tinycld-text"></article>`
	} else {
		opts := translate.HTMLRenderOpts{Images: images}
		// Embed mode fetches image bytes from drive's filesystem. We
		// only wire the fetcher when needed; URL mode skips the
		// closure construction so docx-imported images (which carry
		// data: URIs already) pass through without any callback work.
		if images == translate.ImageModeEmbed {
			opts.EmbedFetcher = makeEmbedFetcher(app)
		}
		// DocxToHTML walks the parsed PMNode tree directly to HTML —
		// no JSON marshal/unmarshal in the render path. Warnings are
		// discarded here; the bootstrap path captures them on import.
		var renderErr error
		fragment, _, renderErr = translate.DocxToHTML(docxBytes, opts)
		if renderErr != nil {
			return re.InternalServerError("could not render document", renderErr)
		}
	}

	clean, err := render.Sanitize(fragment)
	if err != nil {
		return re.InternalServerError("could not sanitize render output", err)
	}

	re.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
	re.Response.Header().Set("ETag", etag)
	re.Response.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	_, _ = re.Response.Write([]byte(clean))
	return nil
}

// renderETag derives an opaque ETag for a render request. Composed
// of the renderer version + the drive_item's `updated` timestamp so
// the cached preview invalidates both when the file changes and when
// the renderer itself does. Mirrors calc/server/api.go::renderETag
// verbatim — same formula, different RendererVersion namespace.
func renderETag(driveItemID, updated string) string {
	sum := sha256.Sum256([]byte(driveItemID + "|" + updated + "|" + render.RendererVersion))
	return fmt.Sprintf(`"%s"`, hex.EncodeToString(sum[:16]))
}

// makeEmbedFetcher returns an EmbedFetcher that resolves PocketBase
// file URLs to their stored bytes. The fetcher is constructed per
// request so it captures the live app instance; failure to fetch
// any single image drops only that image (returns an error to the
// translate package, which translates to an empty src and the image
// is omitted) rather than failing the whole render.
//
// The fetcher accepts:
//
//   - Absolute http(s) URLs that look like PocketBase file URLs of
//     the form .../api/files/<collection>/<recordId>/<filename>?…
//     The host portion is ignored — we use the path to look up the
//     same file in this server's filesystem.
//
// Anything else (off-domain URLs, malformed inputs) returns an
// error so the renderer drops the image rather than embedding an
// untrusted URL we can't verify.
func makeEmbedFetcher(app core.App) translate.EmbedFetcher {
	return func(src string) (string, []byte, error) {
		coll, recID, fileName, ok := parseDriveFileURL(src)
		if !ok {
			return "", nil, fmt.Errorf("text render: unsupported embed source")
		}
		record, err := app.FindRecordById(coll, recID)
		if err != nil {
			return "", nil, err
		}
		fsys, err := app.NewFilesystem()
		if err != nil {
			return "", nil, err
		}
		defer fsys.Close()
		key := record.BaseFilesPath() + "/" + fileName
		rdr, err := fsys.GetReader(key)
		if err != nil {
			return "", nil, err
		}
		defer rdr.Close()
		buf, err := readCappedBytes(rdr, MaxDocxBytes)
		if err != nil {
			return "", nil, err
		}
		return mimeFromFilename(fileName), buf, nil
	}
}

// parseDriveFileURL extracts (collection, recordID, fileName) from a
// PocketBase file URL of the shape:
//
//	scheme://host[:port]/api/files/<collection>/<recordId>/<filename>[?token=…]
//
// Returns ok=false for anything else, including relative paths and
// missing path segments. We deliberately don't require a specific
// scheme/host because dev deploys vary; the file existence check
// happens via app.FindRecordById which enforces that the record is
// in this PocketBase instance.
func parseDriveFileURL(src string) (collection, recordID, fileName string, ok bool) {
	// Strip query string.
	if idx := indexByte(src, '?'); idx >= 0 {
		src = src[:idx]
	}
	// Find /api/files/ anchor.
	anchor := "/api/files/"
	idx := indexSubstr(src, anchor)
	if idx < 0 {
		return "", "", "", false
	}
	rest := src[idx+len(anchor):]
	// Split into <collection>/<recordId>/<filename>.
	first := indexByte(rest, '/')
	if first <= 0 {
		return "", "", "", false
	}
	collection = rest[:first]
	rest = rest[first+1:]
	second := indexByte(rest, '/')
	if second <= 0 {
		return "", "", "", false
	}
	recordID = rest[:second]
	fileName = rest[second+1:]
	if fileName == "" {
		return "", "", "", false
	}
	return collection, recordID, fileName, true
}

// mimeFromFilename returns a conservative MIME type for an image
// filename. Only the raster formats the sanitizer's data: URI
// allowlist permits are returned (png / jpeg / gif / webp); anything
// else falls back to image/png so the renderer's downstream sanitizer
// doesn't reject the data: URI outright. The actual image bytes are
// what the browser uses to decode, not the MIME hint — the latter
// only steers <img> rendering.
func mimeFromFilename(name string) string {
	dot := lastIndexByte(name, '.')
	if dot < 0 {
		return "image/png"
	}
	ext := lowerASCII(name[dot:])
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}
	return "image/png"
}

// Tiny string helpers kept local so this file doesn't pull in
// strings/bytes for trivial operations.

func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func lastIndexByte(s string, c byte) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func indexSubstr(s, sub string) int {
	if len(sub) == 0 {
		return 0
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func lowerASCII(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}
