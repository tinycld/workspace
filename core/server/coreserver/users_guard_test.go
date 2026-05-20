package coreserver

import (
	"strconv"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupGuardTestApp builds a TestApp with the orgs / user_org / is_demo
// schema the guard relies on. Programmatic rather than pb_test_data based
// (the latter doesn't ship in the repo); see aliases_test.go for the same
// pattern in the mail package.
func setupGuardTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	// Add is_demo to the bundled users auth collection. We set the relaxed
	// updateRule AFTER user_org is created, because the rule references the
	// back-relation `user_org_via_user` which only exists once user_org has
	// a `user` relation field pointing at users.
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.BoolField{Name: "is_demo"})
	if err := app.Save(users); err != nil {
		t.Fatalf("save users: %v", err)
	}

	orgs := core.NewBaseCollection("orgs")
	orgs.Fields.Add(&core.TextField{Name: "name", Required: true})
	orgs.Fields.Add(&core.TextField{Name: "slug", Required: true})
	if err := app.Save(orgs); err != nil {
		t.Fatalf("save orgs: %v", err)
	}

	userOrg := core.NewBaseCollection("user_org")
	userOrg.Fields.Add(&core.RelationField{
		Name: "org", Required: true, CollectionId: orgs.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	userOrg.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	userOrg.Fields.Add(&core.SelectField{
		Name: "role", Required: true, MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	if err := app.Save(userOrg); err != nil {
		t.Fatalf("save user_org: %v", err)
	}

	// Now safe to set the rule that references the back-relation.
	users, err = app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.UpdateRule = stringPtr(
		`@request.auth.id != "" && (id = @request.auth.id || ` +
			`user_org_via_user.org.user_org_via_org.user ?= @request.auth.id)`,
	)
	if err := app.Save(users); err != nil {
		t.Fatalf("save users updateRule: %v", err)
	}

	registerUsersFieldGuardCore(app)
	return app
}

func stringPtr(s string) *string { return &s }

func makeUser(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("username", uniqueDerivedUsername(t, app, email))
	r.Set("name", "Original Name")
	r.SetVerified(true)
	r.SetPassword("Password123!")
	if err := app.Save(r); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return r
}

// uniqueDerivedUsername derives a username from email and adds a numeric
// suffix if the base is already taken. Mirrors the production backfill so
// short prefixes like "ma@..." and "mb@..." (both → "user") don't collide.
func uniqueDerivedUsername(t *testing.T, app core.App, email string) string {
	t.Helper()
	base := DeriveUsername(email)
	candidate := base
	for i := 2; ; i++ {
		existing, _ := app.FindFirstRecordByFilter(
			"users", "username = {:u}", map[string]any{"u": candidate})
		if existing == nil {
			return candidate
		}
		candidate = base + strconv.Itoa(i)
	}
}

func makeOrg(t *testing.T, app core.App, name, slug string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("orgs")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("name", name)
	r.Set("slug", slug)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func makeMembership(t *testing.T, app core.App, user, org *core.Record, role string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("user_org")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("user", user.Id)
	r.Set("org", org.Id)
	r.Set("role", role)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// updateAsAuthenticated invokes the OnRecordUpdateRequest hook chain the
// way the API would. Reloads the target from the DB first so Record.Original()
// reflects the persisted state (PB's Save doesn't refresh originalData
// in-place, so a record that was Save()'d in test setup still reports its
// initial pre-Save values as Original — the API-side flow always loads
// fresh records from DB before applying writes).
func updateAsAuthenticated(
	t *testing.T,
	app *tests.TestApp,
	caller *core.Record,
	target *core.Record,
	mutate func(*core.Record),
) error {
	t.Helper()
	fresh, err := app.FindRecordById("users", target.Id)
	if err != nil {
		t.Fatalf("reload target: %v", err)
	}
	mutate(fresh)

	usersCol, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	e := &core.RecordRequestEvent{
		RequestEvent: &core.RequestEvent{Auth: caller, App: app},
		Record:       fresh,
	}
	// Tags() reads from the embedded baseCollectionEventData.Collection;
	// without it, the tagged hook filter would skip our handler.
	e.Collection = usersCol

	return app.OnRecordUpdateRequest("users").Trigger(e, func(_ *core.RecordRequestEvent) error {
		return app.Save(fresh)
	})
}

func TestUsersGuard_SelfCanEditNameAndAvatar(t *testing.T) {
	app := setupGuardTestApp(t)
	user := makeUser(t, app, "self@test.local")

	err := updateAsAuthenticated(t, app, user, user, func(r *core.Record) {
		r.Set("name", "New Name")
		r.Set("avatar", "")
	})
	if err != nil {
		t.Fatalf("self-edit of name/avatar should be allowed: %v", err)
	}

	// Reload and verify.
	fresh, _ := app.FindRecordById("users", user.Id)
	if fresh.GetString("name") != "New Name" {
		t.Errorf("name not saved, got %q", fresh.GetString("name"))
	}
}

func TestUsersGuard_SelfCannotEditIsDemo(t *testing.T) {
	app := setupGuardTestApp(t)
	user := makeUser(t, app, "self2@test.local")
	user.Set("is_demo", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	err := updateAsAuthenticated(t, app, user, user, func(r *core.Record) {
		r.Set("is_demo", false)
	})
	if err == nil {
		t.Fatal("self-edit of is_demo should have been rejected")
	}

	fresh, _ := app.FindRecordById("users", user.Id)
	if !fresh.GetBool("is_demo") {
		t.Error("is_demo should still be true after rejected edit")
	}
}

func TestUsersGuard_DemoUserCannotSelfEditAnything(t *testing.T) {
	app := setupGuardTestApp(t)
	user := makeUser(t, app, "demo@test.local")
	user.Set("is_demo", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	// Even fields that would normally be self-editable (name, avatar) must
	// be rejected — the demo account is shared across anonymous visitors,
	// so any persisted edit leaks to the next session.
	err := updateAsAuthenticated(t, app, user, user, func(r *core.Record) {
		r.Set("name", "Visitor Vandal")
	})
	if err == nil {
		t.Fatal("demo user self-edit of name should have been rejected")
	}

	fresh, _ := app.FindRecordById("users", user.Id)
	if fresh.GetString("name") != "Original Name" {
		t.Errorf("name should be unchanged, got %q", fresh.GetString("name"))
	}
}

func TestUsersGuard_AdminCanStillEditDemoUser(t *testing.T) {
	app := setupGuardTestApp(t)
	admin := makeUser(t, app, "demoadmin@test.local")
	target := makeUser(t, app, "demotarget@test.local")
	target.Set("is_demo", true)
	if err := app.Save(target); err != nil {
		t.Fatal(err)
	}
	org := makeOrg(t, app, "DemoCo", "democo")
	makeMembership(t, app, admin, org, "owner")
	makeMembership(t, app, target, org, "member")

	// The demo lockout only applies to self-edits; an org admin must still
	// be able to flip is_demo back off (e.g. operator reclaiming an account).
	err := updateAsAuthenticated(t, app, admin, target, func(r *core.Record) {
		r.Set("is_demo", false)
	})
	if err != nil {
		t.Fatalf("admin should still be able to clear is_demo on a demo user: %v", err)
	}

	fresh, _ := app.FindRecordById("users", target.Id)
	if fresh.GetBool("is_demo") {
		t.Error("is_demo should be false after admin clear")
	}
}

func TestUsersGuard_SelfCannotEditVerified(t *testing.T) {
	app := setupGuardTestApp(t)
	user := makeUser(t, app, "self3@test.local")
	user.SetVerified(false)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	err := updateAsAuthenticated(t, app, user, user, func(r *core.Record) {
		r.SetVerified(true)
	})
	if err == nil {
		t.Fatal("self-edit of verified should have been rejected")
	}

	fresh, _ := app.FindRecordById("users", user.Id)
	if fresh.Verified() {
		t.Error("verified should still be false after rejected edit")
	}
}

func TestUsersGuard_AdminCanFlipIsDemoOnSharedOrg(t *testing.T) {
	app := setupGuardTestApp(t)
	admin := makeUser(t, app, "admin@test.local")
	target := makeUser(t, app, "target@test.local")
	org := makeOrg(t, app, "Acme", "acme")
	makeMembership(t, app, admin, org, "admin")
	makeMembership(t, app, target, org, "member")

	err := updateAsAuthenticated(t, app, admin, target, func(r *core.Record) {
		r.Set("is_demo", true)
	})
	if err != nil {
		t.Fatalf("admin flipping is_demo on shared-org member should be allowed: %v", err)
	}

	fresh, _ := app.FindRecordById("users", target.Id)
	if !fresh.GetBool("is_demo") {
		t.Error("is_demo not persisted")
	}
}

func TestUsersGuard_AdminCannotEditNonAllowlistedField(t *testing.T) {
	app := setupGuardTestApp(t)
	admin := makeUser(t, app, "admin2@test.local")
	target := makeUser(t, app, "target2@test.local")
	org := makeOrg(t, app, "Acme2", "acme2")
	makeMembership(t, app, admin, org, "owner")
	makeMembership(t, app, target, org, "member")

	err := updateAsAuthenticated(t, app, admin, target, func(r *core.Record) {
		r.SetVerified(false) // not in adminEditableUserFields
	})
	if err == nil {
		t.Fatal("admin editing verified on another user should be rejected")
	}
}

func TestUsersGuard_AdminCannotEditPasswordOnAnotherUser(t *testing.T) {
	app := setupGuardTestApp(t)
	admin := makeUser(t, app, "admin3@test.local")
	target := makeUser(t, app, "target3@test.local")
	org := makeOrg(t, app, "Acme3", "acme3")
	makeMembership(t, app, admin, org, "admin")
	makeMembership(t, app, target, org, "member")

	err := updateAsAuthenticated(t, app, admin, target, func(r *core.Record) {
		r.SetPassword("HackedPassword!")
	})
	if err == nil {
		t.Fatal("admin setting another user's password should be rejected")
	}

	// Verify password didn't change by re-validating the original.
	fresh, _ := app.FindRecordById("users", target.Id)
	if !fresh.ValidatePassword("Password123!") {
		t.Error("original password should still validate")
	}
}

func TestUsersGuard_NonMemberAdminCannotEdit(t *testing.T) {
	app := setupGuardTestApp(t)
	otherAdmin := makeUser(t, app, "otheradmin@test.local")
	target := makeUser(t, app, "target4@test.local")
	orgA := makeOrg(t, app, "OrgA", "org-a")
	orgB := makeOrg(t, app, "OrgB", "org-b")
	makeMembership(t, app, otherAdmin, orgA, "admin")
	makeMembership(t, app, target, orgB, "member")

	err := updateAsAuthenticated(t, app, otherAdmin, target, func(r *core.Record) {
		r.Set("is_demo", true)
	})
	if err == nil {
		t.Fatal("admin in a different org should not be able to edit a target outside their org")
	}
}

func TestUsersGuard_PlainMemberCannotEditAnotherUser(t *testing.T) {
	app := setupGuardTestApp(t)
	memberA := makeUser(t, app, "ma@test.local")
	memberB := makeUser(t, app, "mb@test.local")
	org := makeOrg(t, app, "Co", "co")
	makeMembership(t, app, memberA, org, "member")
	makeMembership(t, app, memberB, org, "member")

	err := updateAsAuthenticated(t, app, memberA, memberB, func(r *core.Record) {
		r.Set("name", "tampered")
	})
	if err == nil {
		t.Fatal("non-admin member should not be able to edit another member")
	}
}

// Superusers (e.g. the seed/reset-demo CLI scripts authed as
// _superusers) need to overwrite fields outside the admin allowlist —
// notably email and password on the singleton demo account. Without a
// bypass the guard rejects the write with "Only the record owner can
// change this field" and the script falls back to a doomed create.
func TestUsersGuard_SuperuserCanEditAnyField(t *testing.T) {
	app := setupGuardTestApp(t)
	target := makeUser(t, app, "supertarget@test.local")

	su, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(su)
	superuser.SetEmail("super@test.local")
	superuser.SetPassword("Superuser1234!")
	if err := app.Save(superuser); err != nil {
		t.Fatalf("save superuser: %v", err)
	}

	err = updateAsAuthenticated(t, app, superuser, target, func(r *core.Record) {
		r.SetEmail("renamed@test.local")
		r.SetPassword("Rotated1234!")
		r.Set("name", "Operator Rewrite")
	})
	if err != nil {
		t.Fatalf("superuser write should bypass field allowlist: %v", err)
	}

	fresh, _ := app.FindRecordById("users", target.Id)
	if fresh.Email() != "renamed@test.local" {
		t.Errorf("email not saved, got %q", fresh.Email())
	}
	if !fresh.ValidatePassword("Rotated1234!") {
		t.Error("rotated password should validate")
	}
}

// seedAuditLogs adds the audit_logs collection so the demo-audit hook has
// somewhere to write. Mirrors the migration's shape minimally — only the
// fields the hook actually sets.
func seedAuditLogs(t *testing.T, app *tests.TestApp) {
	t.Helper()
	col := core.NewBaseCollection("audit_logs")
	col.Fields.Add(&core.TextField{Name: "action"})
	col.Fields.Add(&core.TextField{Name: "resource_type"})
	col.Fields.Add(&core.TextField{Name: "resource_id"})
	col.Fields.Add(&core.TextField{Name: "resource_label"})
	col.Fields.Add(&core.JSONField{Name: "metadata"})
	col.Fields.Add(&core.TextField{Name: "actor"})
	col.Fields.Add(&core.TextField{Name: "org"})
	col.Fields.Add(&core.TextField{Name: "ip_address"})
	col.Fields.Add(&core.TextField{Name: "user_agent"})
	if err := app.Save(col); err != nil {
		t.Fatalf("seed audit_logs: %v", err)
	}
}

func TestUsersDemoAuditHook_LogsOnFlip(t *testing.T) {
	app := setupGuardTestApp(t)
	seedAuditLogs(t, app)
	registerUsersDemoAuditHookCore(app)

	admin := makeUser(t, app, "auditadmin@test.local")
	target := makeUser(t, app, "auditmember@test.local")
	org := makeOrg(t, app, "AuditCo", "auditco")
	makeMembership(t, app, admin, org, "admin")
	makeMembership(t, app, target, org, "member")

	if err := updateAsAuthenticated(t, app, admin, target, func(r *core.Record) {
		r.Set("is_demo", true)
	}); err != nil {
		t.Fatalf("flip should succeed: %v", err)
	}

	logs, err := app.FindRecordsByFilter(
		"audit_logs",
		"action = 'users.demo_changed' && resource_id = {:rid}",
		"", 0, 0,
		map[string]any{"rid": target.Id},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(logs))
	}
	if logs[0].GetString("actor") != admin.Id {
		t.Errorf("actor mismatch: got %q want %q", logs[0].GetString("actor"), admin.Id)
	}
}

func TestUsersDemoAuditHook_NoLogWhenFlagUnchanged(t *testing.T) {
	app := setupGuardTestApp(t)
	seedAuditLogs(t, app)
	registerUsersDemoAuditHookCore(app)

	user := makeUser(t, app, "noflip@test.local")

	// A non-demo-flag self-edit (changing name) shouldn't write to audit_logs.
	if err := updateAsAuthenticated(t, app, user, user, func(r *core.Record) {
		r.Set("name", "Changed Name")
	}); err != nil {
		t.Fatal(err)
	}

	logs, err := app.FindAllRecords("audit_logs")
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 0 {
		t.Errorf("expected 0 audit entries for non-demo-flag change, got %d", len(logs))
	}
}

func TestUsersGuard_UnauthRejected(t *testing.T) {
	app := setupGuardTestApp(t)
	target := makeUser(t, app, "anyone@test.local")
	usersCol, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	target.Set("name", "tampered")
	e := &core.RecordRequestEvent{
		RequestEvent: &core.RequestEvent{Auth: nil, App: app},
		Record:       target,
	}
	e.Collection = usersCol

	err = app.OnRecordUpdateRequest("users").Trigger(e, func(_ *core.RecordRequestEvent) error {
		return app.Save(target)
	})
	if err == nil {
		t.Fatal("update without auth must be rejected")
	}
}
