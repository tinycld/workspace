package text

import (
	"errors"

	"github.com/pocketbase/pocketbase/core"
)

// errNoShare is returned when the user has no drive_shares row for the
// requested drive_item, OR when the share that exists belongs to a
// user_org whose org doesn't match the item's owning org (e.g. a stale
// share row from a previous org membership).
var errNoShare = errors.New("text: no drive_shares row for this user/item")

// shareRole is the subset of drive_shares.role values text cares about.
// Owners and editors may write; viewers may read but not write.
type shareRole string

const (
	roleOwner  shareRole = "owner"
	roleEditor shareRole = "editor"
	roleViewer shareRole = "viewer"
)

// canWrite reports whether the role grants edit access. Unknown roles
// (e.g. a future role this code hasn't been taught about) are treated
// as read-only by default — fail closed.
func (r shareRole) canWrite() bool {
	return r == roleOwner || r == roleEditor
}

// makeAuthorize returns the realtime.AuthorizeFn for "text-doc" rooms.
// roomID is a drive_items.id; the user may join iff they have at least
// one drive_shares row connecting them (via a user_org in the same org
// that owns the drive_item) to the given item.
//
// Org isolation: the share's user_org.org must equal the item's owning
// org. Without this check, a stale share row pointing at item X (added
// when X belonged to org A) would still grant access after the auth
// user has left org A and X has been moved to org B — PB SDK methods
// bypass API rules, so the implicit org filter from the collection
// rule does NOT apply here. We re-implement the predicate explicitly.
func makeAuthorize(app core.App) func(*core.Record, string) error {
	return func(auth *core.Record, roomID string) error {
		if auth == nil || auth.Id == "" {
			return errNoShare
		}
		_, err := resolveShareRole(app, auth.Id, roomID)
		return err
	}
}

// resolveShareRole returns the highest-privilege role the user holds
// against the given drive_item, or errNoShare if none. The lookup
// constrains user_org.org to the item's owning org so cross-org
// stale shares are not honored.
//
// When multiple share rows exist for the same (user, item) — e.g. an
// editor row added later than a viewer row — owner outranks editor,
// editor outranks viewer.
func resolveShareRole(app core.App, userID, driveItemID string) (shareRole, error) {
	item, err := app.FindRecordById("drive_items", driveItemID)
	if err != nil {
		// Either the item doesn't exist or the DB call failed; either
		// way the user can't access a room for a non-existent item.
		return "", errNoShare
	}
	orgID := item.GetString("org")
	if orgID == "" {
		return "", errNoShare
	}

	rows, err := app.FindRecordsByFilter(
		"drive_shares",
		"item = {:item} && user_org.user = {:user} && user_org.org = {:org}",
		"",
		0, // no limit — we want every matching share so we can pick the best role
		0,
		map[string]any{"item": driveItemID, "user": userID, "org": orgID},
	)
	if err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", errNoShare
	}

	best := shareRole("")
	for _, r := range rows {
		role := shareRole(r.GetString("role"))
		if rolePriority(role) > rolePriority(best) {
			best = role
		}
	}
	return best, nil
}

// rolePriority orders roles so resolveShareRole can pick the highest
// when several share rows exist. Unknown roles get priority 0; viewer
// 1; editor 2; owner 3.
func rolePriority(r shareRole) int {
	switch r {
	case roleOwner:
		return 3
	case roleEditor:
		return 2
	case roleViewer:
		return 1
	default:
		return 0
	}
}
