package drive

import (
	"errors"
	"net/http"
	"testing"
)

// TestAuthenticateRequestNoCreds proves that a request with no Basic
// Authorization header returns errUnauthorized without touching the DB.
// We can call authenticateRequest with a nil *pocketbase.PocketBase
// because the basic-auth check happens before any DB call. This guard
// is what lets the WebDAV middleware translate the error to a 401
// without crashing or leaking server state.
func TestAuthenticateRequestNoCreds(t *testing.T) {
	r, _ := http.NewRequest("PROPFIND", "/drive/", nil)
	if _, err := authenticateRequest(nil, r); !errors.Is(err, errUnauthorized) {
		t.Errorf("got %v, want errUnauthorized", err)
	}
}

// TestAuthenticateRequestEmptyIdentifier guards a subtle quirk: stdlib
// http.Request.BasicAuth() returns ok=true even for "Basic Og==" (empty
// username, empty password). The function must reject it without a DB
// call so we can't accidentally match a record whose username/email is
// empty (which shouldn't exist, but defense in depth).
func TestAuthenticateRequestEmptyIdentifier(t *testing.T) {
	r, _ := http.NewRequest("PROPFIND", "/drive/", nil)
	r.SetBasicAuth("", "")
	if _, err := authenticateRequest(nil, r); !errors.Is(err, errUnauthorized) {
		t.Errorf("got %v, want errUnauthorized", err)
	}
}
