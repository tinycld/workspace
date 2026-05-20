package coreserver

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestDeriveUsername(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"foo@bar.com", "foo"},
		{"Bob.Smith+work@example.com", "bobsmithwork"},
		{"alice123@x.com", "alice123"},
		{"", "user"},             // empty → falls back to "user"
		{"@example.com", "user"}, // no local part → empty after strip → "user"
		{"UPPER@example.com", "upper"},
		{"dots.and+plus@x.com", "dotsandplus"},
		{"under_score-dash@x.com", "under_score-dash"},
		{"noemail", "noemail"},
		{"ab@x.com", "user"}, // 2-char prefix is too short; falls back
		{"a@x.com", "user"},  // 1-char prefix is too short; falls back
	}
	for _, tc := range cases {
		got := DeriveUsername(tc.input)
		if got != tc.want {
			t.Errorf("DeriveUsername(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestIsValidUsername(t *testing.T) {
	valid := []string{"abc", "foo", "foo123", "a1b", "foo-bar", "foo_bar", "abc"}
	invalid := []string{"ab", "a", "", "FOO", "foo@bar", "foo bar", "foo!", "-foo"}
	for _, s := range valid {
		if !IsValidUsername(s) {
			t.Errorf("IsValidUsername(%q) = false, want true", s)
		}
	}
	for _, s := range invalid {
		if IsValidUsername(s) {
			t.Errorf("IsValidUsername(%q) = true, want false", s)
		}
	}
}

func TestBackfillUsernames(t *testing.T) {
	app := setupInviteTestApp(t)

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	// PocketBase requires a non-empty username on save. We set each user to
	// a sentinel that BackfillUsernames will treat as already-set (non-empty).
	// The real backfill scenario is tested by seeding explicit usernames and
	// asserting idempotency, plus unit-testing DeriveUsername above.
	//
	// To test actual derivation/collision we set two users with the *same*
	// base (derived from email) and verify the collision resolver works. We
	// manually set username="" via raw DB to bypass PB validation, simulating
	// what rows look like before this migration runs in production.
	mk := func(email, username string) *core.Record {
		t.Helper()
		r := core.NewRecord(users)
		r.SetEmail(email)
		r.Set("username", username)
		r.SetPassword("Password123!")
		r.SetVerified(true)
		if err := app.Save(r); err != nil {
			t.Fatalf("save user %s: %v", email, err)
		}
		return r
	}

	// Seed users with usernames already derived from their emails.
	a := mk("foo@bar.com", "foo")
	b := mk("Bob.Smith+work@example.com", "bobsmithwork")

	// Simulate two more users that would collide with "foo": set their
	// usernames to empty via raw SQL (bypassing PB validation) to simulate
	// pre-migration rows that never had a username. We must drop the unique
	// index temporarily because SQLite enforces UNIQUE per-row even in a
	// multi-row UPDATE.
	c := mk("foo@a.com", "foo-placeholder-c")
	d := mk("foo@b.com", "foo-placeholder-d")

	// Temporarily drop the unique index so we can write duplicate '' values.
	// This simulates rows that existed before username became required.
	if _, err := app.DB().NewQuery("DROP INDEX IF EXISTS `__pb_users_auth__username_idx`").Execute(); err != nil {
		t.Fatalf("drop username index: %v", err)
	}
	if _, err := app.DB().NewQuery(
		"UPDATE users SET username='' WHERE id IN ({:c}, {:d})",
	).Bind(map[string]any{"c": c.Id, "d": d.Id}).Execute(); err != nil {
		t.Fatalf("clear usernames: %v", err)
	}

	// Run backfill while the index is absent — same as the JS migration does it.
	if err := BackfillUsernames(app); err != nil {
		t.Fatalf("BackfillUsernames: %v", err)
	}

	// Restore the unique index — should succeed now that all rows have
	// distinct usernames.
	if _, err := app.DB().NewQuery(
		"CREATE UNIQUE INDEX `__pb_users_auth__username_idx` ON `users` (`username`)",
	).Execute(); err != nil {
		t.Fatalf("restore username index (BackfillUsernames left duplicates): %v", err)
	}

	cases := []struct {
		id   string
		want string
	}{
		{a.Id, "foo"},          // already set — must not change
		{b.Id, "bobsmithwork"}, // already set — must not change
		{c.Id, "foo2"},         // derived from "foo@a.com" → "foo" + collision → "foo2"
		{d.Id, "foo3"},         // derived from "foo@b.com" → "foo" + collision → "foo3"
	}
	for _, tc := range cases {
		rec, err := app.FindRecordById("users", tc.id)
		if err != nil {
			t.Fatalf("find %s: %v", tc.id, err)
		}
		got := rec.GetString("username")
		if got != tc.want {
			t.Errorf("user %s: username = %q, want %q", tc.id, got, tc.want)
		}
	}
}
