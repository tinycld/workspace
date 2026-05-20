package coreserver

import (
    "encoding/json"
    "net/http"
    "testing"

    "github.com/pocketbase/pocketbase/core"
)

// tokenForUser generates a PocketBase auth token string for the given user
// record, suitable for use in Authorization headers.
func tokenForUser(app core.App, user *core.Record) (string, error) {
    return user.NewAuthToken()
}

// readJSONBody decodes a JSON response body into a map. Fatals on decode error.
func readJSONBody(t *testing.T, res *http.Response) map[string]any {
    t.Helper()
    var body map[string]any
    if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
        t.Fatalf("decode response body: %v", err)
    }
    return body
}
