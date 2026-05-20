package contacts

import (
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func authenticateRequest(app *pocketbase.PocketBase, r *http.Request) (*core.Record, error) {
	username, password, ok := r.BasicAuth()
	if !ok {
		return nil, errUnauthorized
	}

	record, err := app.FindAuthRecordByEmail("users", username)
	if err != nil {
		return nil, errUnauthorized
	}

	if !record.ValidatePassword(password) {
		return nil, errUnauthorized
	}

	return record, nil
}

// requireAuth is a middleware that ensures the request has a valid auth token.
func requireAuth(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}

type authError struct{}

func (e *authError) Error() string { return "unauthorized" }

var errUnauthorized = &authError{}
