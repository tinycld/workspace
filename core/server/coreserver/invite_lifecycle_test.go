package coreserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests cover the demo-gated invite-email flow. The mailer's LogSender
// (the default fallback when no Postmark token is configured) writes a JSON
// line per send to the file at TINYCLD_EMAIL_LOG. We point that env var at a
// per-test temp file and assert on what does (or doesn't) get written.

func setupInviteTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.Add(&core.BoolField{Name: "is_demo"})
	if err := app.Save(users); err != nil {
		t.Fatal(err)
	}

	orgs := core.NewBaseCollection("orgs")
	orgs.Fields.Add(&core.TextField{Name: "name", Required: true})
	orgs.Fields.Add(&core.TextField{Name: "slug", Required: true})
	if err := app.Save(orgs); err != nil {
		t.Fatal(err)
	}

	// invite_tokens collection — minimal shape used by mintInviteToken.
	tokens := core.NewBaseCollection("invite_tokens")
	tokens.Fields.Add(&core.TextField{Name: "token", Required: true})
	tokens.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1,
	})
	tokens.Fields.Add(&core.RelationField{
		Name: "org", Required: true, CollectionId: orgs.Id, MaxSelect: 1,
	})
	tokens.Fields.Add(&core.TextField{Name: "role", Required: true})
	tokens.Fields.Add(&core.TextField{Name: "expires_at"})
	tokens.Fields.Add(&core.TextField{Name: "used_at"})
	if err := app.Save(tokens); err != nil {
		t.Fatal(err)
	}

	userOrg := core.NewBaseCollection("user_org")
	userOrg.Fields.Add(&core.RelationField{
		Name: "org", Required: true, CollectionId: orgs.Id, MaxSelect: 1,
	})
	userOrg.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1,
	})
	userOrg.Fields.Add(&core.SelectField{
		Name: "role", Required: true, MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	userOrg.Fields.Add(&core.RelationField{
		Name: "created_by", CollectionId: users.Id, MaxSelect: 1,
	})
	if err := app.Save(userOrg); err != nil {
		t.Fatal(err)
	}

	return app
}

// captureMailerOutput configures the LogSender to append every send to a
// per-test temp file via TINYCLD_EMAIL_LOG, returning a reader function.
// Calls before this setup run won't be captured; calls after t.Cleanup are
// still appended but no longer read.
func captureMailerOutput(t *testing.T) func() []map[string]any {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mail.log")
	prev := os.Getenv("TINYCLD_EMAIL_LOG")
	t.Setenv("TINYCLD_EMAIL_LOG", path)
	t.Cleanup(func() { _ = os.Setenv("TINYCLD_EMAIL_LOG", prev) })

	return func() []map[string]any {
		data, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			t.Fatal(err)
		}
		var out []map[string]any
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if line == "" {
				continue
			}
			var entry map[string]any
			if err := json.Unmarshal([]byte(line), &entry); err != nil {
				t.Fatalf("decode mail log line %q: %v", line, err)
			}
			out = append(out, entry)
		}
		return out
	}
}

func TestInviteLifecycle_NonDemoInviter_UnverifiedTarget_DoesNotEmail(t *testing.T) {
	app := setupInviteTestApp(t)
	read := captureMailerOutput(t)

	inviter := mustCreateUser(t, app, "boss@test.local", false)
	target := mustCreateUser(t, app, "newbie@test.local", false)
	target.SetVerified(false)
	if err := app.Save(target); err != nil {
		t.Fatal(err)
	}
	org := mustCreateOrg(t, app)

	uo := newMembership(t, app, target, org, "member", inviter.Id)
	handleUserOrgInvite(app, uo)

	sends := read()
	if len(sends) != 0 {
		t.Fatalf("expected 0 emails for unverified target via lifecycle hook, got %d: %v", len(sends), sends)
	}
}

func TestInviteLifecycle_DemoInviter_UnverifiedTarget_DoesNothing(t *testing.T) {
	app := setupInviteTestApp(t)
	read := captureMailerOutput(t)

	inviter := mustCreateUser(t, app, "demoboss@test.local", true)
	target := mustCreateUser(t, app, "newbie2@test.local", false)
	target.SetVerified(false)
	if err := app.Save(target); err != nil {
		t.Fatal(err)
	}
	org := mustCreateOrg(t, app)

	uo := newMembership(t, app, target, org, "member", inviter.Id)
	handleUserOrgInvite(app, uo)

	sends := read()
	if len(sends) != 0 {
		t.Errorf("demo inviter unverified target: expected 0 sends, got %d: %v", len(sends), sends)
	}

	// The lifecycle hook should not have minted a token either — that's the
	// endpoint's job now.
	tokens, err := app.FindRecordsByFilter(
		"invite_tokens",
		"user = {:u} && org = {:o}",
		"", 0, 0,
		map[string]any{"u": target.Id, "o": org.Id},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 0 {
		t.Errorf("expected 0 tokens minted by lifecycle hook, got %d", len(tokens))
	}
}

func TestInvite_DemoInviter_VerifiedTarget_SkipsEmail(t *testing.T) {
	app := setupInviteTestApp(t)
	read := captureMailerOutput(t)

	inviter := mustCreateUser(t, app, "demoboss2@test.local", true)
	target := mustCreateUser(t, app, "existing@test.local", false)
	target.SetVerified(true) // already verified -> existing-member email path
	if err := app.Save(target); err != nil {
		t.Fatal(err)
	}
	org := mustCreateOrg(t, app)

	uo := newMembership(t, app, target, org, "member", inviter.Id)
	handleUserOrgInvite(app, uo)

	if sends := read(); len(sends) != 0 {
		t.Errorf("demo inviter -> verified target should send no email, got %d: %v",
			len(sends), sends)
	}
}

func TestInvite_NonDemoInviter_VerifiedTarget_SendsAddedEmail(t *testing.T) {
	app := setupInviteTestApp(t)
	read := captureMailerOutput(t)

	inviter := mustCreateUser(t, app, "regularboss@test.local", false)
	target := mustCreateUser(t, app, "existing2@test.local", false)
	target.SetVerified(true)
	if err := app.Save(target); err != nil {
		t.Fatal(err)
	}
	org := mustCreateOrg(t, app)

	uo := newMembership(t, app, target, org, "member", inviter.Id)
	handleUserOrgInvite(app, uo)

	sends := read()
	if len(sends) != 1 {
		t.Fatalf("expected 1 email, got %d: %v", len(sends), sends)
	}
	subject, _ := sends[0]["subject"].(string)
	if !strings.Contains(subject, "added") {
		t.Errorf("expected 'added' subject for verified-existing user, got %q", subject)
	}
}

func mustCreateOrg(t *testing.T, app core.App) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("orgs")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("name", "Acme")
	r.Set("slug", "acme")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func newMembership(
	t *testing.T,
	app core.App,
	user, org *core.Record,
	role, createdBy string,
) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("user_org")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("user", user.Id)
	r.Set("org", org.Id)
	r.Set("role", role)
	r.Set("created_by", createdBy)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}
