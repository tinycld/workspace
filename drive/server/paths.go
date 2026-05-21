package drive

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// parsePath strips the /drive/{orgSlug}/ prefix and returns the org slug
// and the remaining path segments. The empty-string slug indicates the
// WebDAV root (/drive or /drive/), in which case the handler enumerates
// the orgs the authenticated user belongs to.
//
// Inputs are run through path.Clean first, which collapses //, ., and ..
// segments. If a traversal sequence escapes the /drive prefix entirely
// (e.g. "/drive/../../etc/passwd" cleans to "/etc/passwd"), this returns
// the empty slug — i.e. the handler treats it as the WebDAV root rather
// than as a slug-named org, so authenticated traversal can't accidentally
// land on a real org outside the request's intent.
//
// For example: "/drive/acme/Documents/report.pdf" → ("acme", ["Documents", "report.pdf"])
func parsePath(name string) (orgSlug string, segments []string) {
	name = path.Clean(name)
	if name != "/drive" && !strings.HasPrefix(name, "/drive/") {
		return "", nil
	}
	name = strings.TrimPrefix(name, "/drive")
	name = strings.TrimPrefix(name, "/")

	if name == "" || name == "." {
		return "", nil
	}

	parts := strings.SplitN(name, "/", 2)
	orgSlug = parts[0]

	if len(parts) < 2 || parts[1] == "" {
		return orgSlug, nil
	}

	remaining := strings.Trim(parts[1], "/")
	if remaining == "" {
		return orgSlug, nil
	}

	return orgSlug, strings.Split(remaining, "/")
}

// resolveOrg finds the org record for a given slug.
func resolveOrg(app *pocketbase.PocketBase, slug string) (*core.Record, error) {
	records, err := app.FindRecordsByFilter(
		"orgs",
		"slug = {:slug}",
		"", 1, 0,
		map[string]any{"slug": slug},
	)
	if err != nil || len(records) == 0 {
		return nil, os.ErrNotExist
	}
	return records[0], nil
}

// resolveItemIDByPath resolves the drive_items.id at the end of a path
// in a single SQL roundtrip via a recursive CTE driven by a JSON array
// of segment names. Returns os.ErrNotExist if any segment doesn't
// resolve. Empty segments return ("", nil) to signal the org root.
//
// The N+1 hazard this replaces: the per-segment filter loop did one
// FindRecordsByFilter per segment. Finder hammers Stat during PROPFIND
// walks, so depth-D paths cost O(N·D) round trips for a directory of
// N children. The CTE is one query regardless of depth; the caller
// pays one more FindRecordById to hydrate the *core.Record (or skips
// it entirely if it just needs the ID).
func resolveItemIDByPath(app *pocketbase.PocketBase, orgID string, segments []string) (id string, isFolder bool, err error) {
	if len(segments) == 0 {
		return "", false, nil
	}

	segsJSON, err := json.Marshal(segments)
	if err != nil {
		return "", false, err
	}

	var row struct {
		ID       string `db:"id"`
		Idx      int    `db:"idx"`
		IsFolder bool   `db:"is_folder"`
	}

	const q = `
WITH RECURSIVE
  segs(idx, name) AS (
    SELECT CAST(key AS INTEGER), value FROM json_each({:segs})
  ),
  walk(idx, id, is_folder) AS (
    SELECT segs.idx, di.id, di.is_folder
      FROM segs
      JOIN drive_items di
        ON di.org = {:org} AND di.parent = '' AND di.name = segs.name AND segs.idx = 0
    UNION ALL
    SELECT segs.idx, di.id, di.is_folder
      FROM segs, walk
      JOIN drive_items di
        ON di.org = {:org} AND di.parent = walk.id AND di.name = segs.name AND segs.idx = walk.idx + 1
  )
SELECT idx, id, is_folder FROM walk ORDER BY idx DESC LIMIT 1`

	err = app.DB().NewQuery(q).Bind(dbx.Params{
		"segs": string(segsJSON),
		"org":  orgID,
	}).One(&row)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, os.ErrNotExist
	}
	if err != nil {
		return "", false, err
	}

	// idx counts from 0; matched-all-segments means idx == len(segments) - 1.
	if row.Idx != len(segments)-1 {
		return "", false, os.ErrNotExist
	}
	return row.ID, row.IsFolder, nil
}

// resolveItemByPath walks the path segments to find the drive_items
// record. Returns nil if the path resolves to the org root (no
// segments). Two queries total: the recursive CTE in
// resolveItemIDByPath, then FindRecordById to hydrate.
func resolveItemByPath(app *pocketbase.PocketBase, orgID string, segments []string) (*core.Record, error) {
	if len(segments) == 0 {
		return nil, nil
	}
	id, _, err := resolveItemIDByPath(app, orgID, segments)
	if err != nil {
		return nil, err
	}
	record, err := app.FindRecordById("drive_items", id)
	if err != nil {
		return nil, os.ErrNotExist
	}
	return record, nil
}

// resolveParentByPath resolves the parent folder for a given path.
// Returns the parent's drive_items ID (empty for the org root) and the
// final segment name. The parent must exist and be a folder.
//
// Callers (Mkdir, openForWrite, Rename) only ever read the parent's ID,
// so this skips hydrating the full *core.Record and stays at one SQL
// roundtrip via the recursive CTE.
func resolveParentByPath(app *pocketbase.PocketBase, orgID string, segments []string) (parentID, name string, err error) {
	if len(segments) == 0 {
		return "", "", os.ErrNotExist
	}

	name = segments[len(segments)-1]
	parentSegments := segments[:len(segments)-1]

	if len(parentSegments) == 0 {
		return "", name, nil
	}

	id, isFolder, err := resolveItemIDByPath(app, orgID, parentSegments)
	if err != nil {
		return "", "", os.ErrNotExist
	}
	if !isFolder {
		return "", "", os.ErrNotExist
	}
	return id, name, nil
}
