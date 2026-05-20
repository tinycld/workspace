package coreserver

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"
)

// PoolAssets serves files from <releasesDir>/_static/<prefix>/<path>.
//
// The pool is a flat content-addressed store written by the entrypoint on
// each container start: every promoted release's _expo/static/ and assets/
// trees get merged into the same shared directory. Asset filenames are
// content-hashed by Expo's web build, so files from different releases
// coexist without collision (same name = same content).
//
// Stale tabs whose chunk filename is still present in the pool keep
// working across deploys; once the pool is pruned, the missing-chunk path
// 404s and the client reload picks up the active release.
//
// cacheControl is set on every successful response so callers can choose
// per-route policies (immutable for fully-hashed subtrees,
// shorter max-age for subtrees that include unhashed names like
// app-icon.png).
func PoolAssets(releasesDir, prefix, cacheControl string) func(*core.RequestEvent) error {
	root := filepath.Join(releasesDir, "_static", prefix)
	fs := os.DirFS(root)

	return func(e *core.RequestEvent) error {
		if e.Request.Method != http.MethodGet && e.Request.Method != http.MethodHead {
			return e.Next()
		}

		path := e.Request.PathValue("path")
		f, err := fs.Open(path)
		if err != nil {
			return e.NotFoundError("", nil)
		}
		f.Close()

		if cacheControl != "" {
			e.Response.Header().Set("Cache-Control", cacheControl)
		}
		return e.FileFS(fs, path)
	}
}
