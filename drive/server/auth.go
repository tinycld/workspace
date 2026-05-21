package drive

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// errUnauthorized is returned by authenticateRequest when basic auth is
// missing, the identifier matches no user, or the password is wrong. The
// router-level WebDAV middleware translates it to a 401; nothing inside
// the golang.org/x/net/webdav FileSystem methods sees this error, so we
// don't need to make it WebDAV-shaped.
var errUnauthorized = errors.New("drive webdav: unauthorized")

// authenticateRequest validates HTTP Basic credentials against the users
// auth collection. The identifier may be either a bare username (e.g.
// "joe") or a full email (e.g. "joe@tinycld.org"); the discriminator is
// whether it contains '@'. This mirrors PocketBase's own identityFields
// = ['username', 'email'] for the users collection (see migration
// 1820000000_users_username_required.js).
func authenticateRequest(app *pocketbase.PocketBase, r *http.Request) (*core.Record, error) {
	identifier, password, ok := r.BasicAuth()
	if !ok || identifier == "" {
		return nil, errUnauthorized
	}

	var record *core.Record
	var err error
	if strings.Contains(identifier, "@") {
		record, err = app.FindAuthRecordByEmail("users", identifier)
	} else {
		record, err = app.FindFirstRecordByFilter(
			"users",
			"username = {:u}",
			map[string]any{"u": identifier},
		)
	}
	if err != nil || record == nil {
		return nil, errUnauthorized
	}

	if !record.ValidatePassword(password) {
		return nil, errUnauthorized
	}

	return record, nil
}
