package coreserver

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// nonUsernameChar matches anything outside [a-z0-9_-]. We strip rather than
// escape so emails like "alice.b+tag@x.com" become "alicebtag" cleanly.
var nonUsernameChar = regexp.MustCompile(`[^a-z0-9_-]`)

// DeriveUsername turns an email (or arbitrary string) into a candidate
// username. Empty or too-short prefixes fall back to "user" — collision
// resolution then disambiguates ("user", "user2", "user3"). We don't pad
// short prefixes because the padding has no relationship to the original
// email and would mislead readers (a@x.com and b@y.com would both derive to
// 3-char placeholders).
func DeriveUsername(email string) string {
	prefix := email
	if at := strings.IndexByte(email, '@'); at >= 0 {
		prefix = email[:at]
	}
	prefix = strings.ToLower(prefix)
	prefix = nonUsernameChar.ReplaceAllString(prefix, "")
	if len(prefix) < 3 {
		return "user"
	}
	return prefix
}

var usernameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,31}$`)

// IsValidUsername enforces the rules the front-end also validates: lowercase
// alphanumeric with dash or underscore, 3..32 chars, must start with
// alphanumeric.
func IsValidUsername(s string) bool { return usernameRE.MatchString(s) }

// BackfillUsernames assigns a username to every users row that lacks one.
// Iteration order is creation-time stable; collisions resolve with numeric
// suffixes ("foo", "foo2", "foo3"). Used by the JS migration's parity check
// and any future re-backfill operation.
func BackfillUsernames(app core.App) error {
	rows, err := app.FindRecordsByFilter(
		"users", "username = ''", "created", 0, 0, nil,
	)
	if err != nil {
		return err
	}
	taken := map[string]bool{}
	all, err := app.FindRecordsByFilter("users", "username != ''", "", 0, 0, nil)
	if err != nil {
		return err
	}
	for _, r := range all {
		taken[r.GetString("username")] = true
	}
	for _, r := range rows {
		base := DeriveUsername(r.GetString("email"))
		candidate := base
		for i := 2; taken[candidate]; i++ {
			candidate = base + strconv.Itoa(i)
		}
		r.Set("username", candidate)
		taken[candidate] = true
		if err := app.Save(r); err != nil {
			return err
		}
	}
	return nil
}
