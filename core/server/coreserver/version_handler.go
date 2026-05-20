package coreserver

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// VersionHandler returns the current release id as JSON: {"releaseId": "..."}.
// Reads /<releasesDir>/current/release-id.txt on every request — the file
// is ~32 bytes and the OS page cache makes this effectively free.
//
// `Cache-Control: no-store` so reverse proxies and browsers always see the
// fresh value; this endpoint exists specifically to detect deploys.
func VersionHandler(releasesDir string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		path := filepath.Join(releasesDir, "current", "release-id.txt")
		b, err := os.ReadFile(path)
		if err != nil {
			return e.InternalServerError("release-id.txt missing", err)
		}

		e.Response.Header().Set("Cache-Control", "no-store")
		return e.JSON(http.StatusOK, map[string]string{
			"releaseId": strings.TrimSpace(string(b)),
		})
	}
}
