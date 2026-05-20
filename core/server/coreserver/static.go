package coreserver

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// binaryDir returns the directory containing the running executable, or
// the empty string for `go run` invocations (where os.Args[0] is a temp
// binary and the caller's cwd is the source tree). Used by the Default*
// helpers below to anchor relative paths next to the installed binary
// regardless of the cwd it was launched from.
func binaryDir() string {
	if strings.HasPrefix(os.Args[0], os.TempDir()) {
		return ""
	}
	return filepath.Dir(os.Args[0])
}

// DefaultPublicDir returns the default public dir relative to the running
// executable — "./public" when running via `go run` (tempdir binary) or
// next to the installed binary otherwise.
func DefaultPublicDir() string {
	if dir := binaryDir(); dir != "" {
		return filepath.Join(dir, "public")
	}
	return "./public"
}

// DefaultReleasesDir returns the default releases dir relative to the
// running executable — "./releases" when running via `go run` (tempdir
// binary) or next to the installed binary otherwise. The runtime
// entrypoint promotes per-deploy bundles into this directory; a `current`
// symlink there points at the active release.
func DefaultReleasesDir() string {
	if dir := binaryDir(); dir != "" {
		return filepath.Join(dir, "releases")
	}
	return "./releases"
}

// DefaultTypesDir returns the default location the server writes generated
// pbSchema.ts / pbZodSchema.ts to. In the standalone-member layout core is its
// own workspace member ( <workspace>/core ) and the app shell's binary lives at
// <workspace>/app/server/app, so core's types/ is two levels up from the
// binary dir and into the sibling core member: app/server → ../../core/types.
//
// TINYCLD_TYPES_DIR overrides this (CI/tests scanning a non-standard tree).
func DefaultTypesDir() string {
	if env := os.Getenv("TINYCLD_TYPES_DIR"); env != "" {
		return env
	}
	dir := binaryDir()
	if dir == "" {
		// `go run` / temp-built binary: cwd is the app dir (app/server's parent
		// is app/, whose sibling is core/). Resolve relative to cwd's parent.
		return filepath.Join("..", "core", "types")
	}
	// Binary at <ws>/app/server/app → <ws>/core/types
	return filepath.Join(dir, "..", "..", "core", "types")
}

// StaticWithFallback serves static files from dir, falling back to
// fallbackFile for missing paths (so SPA routing works).
func StaticWithFallback(dir string, fallbackFile string) func(*core.RequestEvent) error {
	fs := os.DirFS(dir)

	return func(e *core.RequestEvent) error {
		// Only serve static files for GET/HEAD — let WebDAV methods pass through
		if e.Request.Method != http.MethodGet && e.Request.Method != http.MethodHead {
			return e.Next()
		}

		path := e.Request.PathValue("path")
		if path == "" {
			path = "index.html"
		}

		f, err := fs.Open(path)
		if err == nil {
			f.Close()
			return e.FileFS(fs, path)
		}

		indexPath := path + "/index.html"
		f, err = fs.Open(indexPath)
		if err == nil {
			f.Close()
			return e.FileFS(fs, indexPath)
		}

		if fallbackFile != "" {
			return e.FileFS(fs, fallbackFile)
		}

		return e.NotFoundError("", nil)
	}
}

// StaticWithDynamicFallback serves static files from publicDir (the
// marketing website + any other in-image content), and on miss falls back
// to <releasesDir>/current/app.html (the SPA shell from the active
// release).
//
// When releasesDir is empty or its `current` symlink doesn't resolve to a
// readable app.html, the handler falls back to publicDir/app.html — the
// legacy behavior used in dev where the volume isn't mounted. Any path
// not present in either location returns 404.
func StaticWithDynamicFallback(publicDir, releasesDir string) func(*core.RequestEvent) error {
	publicFs := os.DirFS(publicDir)

	return func(e *core.RequestEvent) error {
		if e.Request.Method != http.MethodGet && e.Request.Method != http.MethodHead {
			return e.Next()
		}

		path := e.Request.PathValue("path")
		if path == "" {
			path = "index.html"
		}

		if f, err := publicFs.Open(path); err == nil {
			f.Close()
			return e.FileFS(publicFs, path)
		}

		indexPath := path + "/index.html"
		if f, err := publicFs.Open(indexPath); err == nil {
			f.Close()
			return e.FileFS(publicFs, indexPath)
		}

		// SPA fallback. Set no-store on app.html so a tab reload always
		// pulls the active release's shell rather than a cached copy that
		// may reference asset hashes the client has since dropped.
		if releasesDir != "" {
			currentApp := filepath.Join(releasesDir, "current", "app.html")
			if data, err := os.ReadFile(currentApp); err == nil {
				e.Response.Header().Set("Cache-Control", "no-store")
				e.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = e.Response.Write(data)
				return nil
			}
		}

		// Dev fallback: publicDir/app.html.
		if f, err := publicFs.Open("app.html"); err == nil {
			f.Close()
			e.Response.Header().Set("Cache-Control", "no-store")
			return e.FileFS(publicFs, "app.html")
		}

		return e.NotFoundError("", nil)
	}
}
