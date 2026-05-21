package text

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
)

// TestRegisterRealtimeRegisters confirms Register plugs the
// "text-doc" kind into the core realtime registry, and that the
// registered closure rejects nil auth without touching the DB. This
// mirrors calc/server/realtime_authorize_test.go.
func TestRegisterRealtimeRegisters(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	Register(app)

	authorize := realtime.LookupForTest(roomKindText)
	if authorize == nil {
		t.Fatalf("Register did not register the %q room kind", roomKindText)
	}

	if err := authorize(nil, "any-drive-item-id"); !errors.Is(err, errNoShare) {
		t.Fatalf("nil auth: expected errNoShare, got %v", err)
	}
}

// TestRegisterRealtimeDuplicatePanics confirms calling Register twice
// surfaces as a panic from realtime.RegisterRoomKindWith. Guards
// against accidental double-init at startup.
func TestRegisterRealtimeDuplicatePanics(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	Register(app)

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate RegisterRoomKindWith")
		}
	}()
	Register(app)
}

// TestAuthorize_DeniesNilAuth: a nil auth record must always be
// rejected; this is the unauthenticated-WS-upgrade guard.
func TestAuthorize_DeniesNilAuth(t *testing.T) {
	app := setupAuthTestApp(t)
	authFn := makeAuthorize(app)
	if err := authFn(nil, "any-id"); err == nil {
		t.Error("expected error for nil auth")
	} else if !errors.Is(err, errNoShare) {
		t.Errorf("nil auth: want errNoShare, got %v", err)
	}
}

// TestAuthorize_DeniesEmptyAuthID: an auth record with a blank Id
// (paranoia — this should never happen with a real PB user) must be
// treated the same as nil.
func TestAuthorize_DeniesEmptyAuthID(t *testing.T) {
	app := setupAuthTestApp(t)
	authFn := makeAuthorize(app)
	users, err := app.FindCollectionByNameOrId("_superusers")
	if err != nil {
		t.Fatalf("find _superusers: %v", err)
	}
	emptyAuth := core.NewRecord(users)
	if err := authFn(emptyAuth, "any-id"); err == nil {
		t.Error("expected error for empty auth Id")
	}
}

// TestAuthorize_DeniesMissingShares: an authenticated user with no
// drive_shares row for the requested item is denied.
func TestAuthorize_DeniesMissingShares(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "doc.docx")

	authFn := makeAuthorize(app)
	err := authFn(user, item.Id)
	if !errors.Is(err, errNoShare) {
		t.Errorf("missing shares: want errNoShare, got %v", err)
	}
}

// TestAuthorize_DeniesNonExistentItem: a request for a drive_item that
// doesn't exist is denied with errNoShare (not a DB error).
func TestAuthorize_DeniesNonExistentItem(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")

	authFn := makeAuthorize(app)
	err := authFn(user, "nonexistent-item-id")
	if !errors.Is(err, errNoShare) {
		t.Errorf("nonexistent item: want errNoShare, got %v", err)
	}
}

// TestAuthorize_GrantsEditor: an editor share row in the item's org
// grants access (no error from authorize).
func TestAuthorize_GrantsEditor(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "doc.docx")
	userOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, userOrgID, "editor")

	authFn := makeAuthorize(app)
	if err := authFn(user, item.Id); err != nil {
		t.Errorf("editor share: want nil, got %v", err)
	}
}

// TestAuthorize_GrantsViewer: a viewer share row grants admission
// (read-only is enforced separately via isReadOnlyForConn, not here).
func TestAuthorize_GrantsViewer(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "doc.docx")
	userOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, userOrgID, "viewer")

	authFn := makeAuthorize(app)
	if err := authFn(user, item.Id); err != nil {
		t.Errorf("viewer share: want nil, got %v", err)
	}
}

// TestAuthorize_DeniesCrossOrgShare: a share row in a different org
// than the item must NOT grant access. This is the org-isolation
// regression test — without the user_org.org constraint in the filter,
// a stale share from a previous org membership would silently grant
// edit access.
func TestAuthorize_DeniesCrossOrgShare(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	// Item belongs to org-bravo
	item := seedDriveItemInOrg(t, app, "org-bravo", "doc.docx")
	// But user's share row is keyed to a user_org in org-acme (stale
	// from a previous org membership).
	staleUserOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, staleUserOrgID, "editor")

	authFn := makeAuthorize(app)
	err := authFn(user, item.Id)
	if !errors.Is(err, errNoShare) {
		t.Errorf("cross-org share: want errNoShare, got %v", err)
	}
}

// TestResolveShareRole_PicksHighestPrivilege: when a user has both a
// viewer and an editor row for the same item (e.g. they were a viewer,
// then promoted, and the cleanup didn't remove the old row), the
// resolved role must be editor — owner > editor > viewer.
func TestResolveShareRole_PicksHighestPrivilege(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "doc.docx")
	userOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, userOrgID, "viewer")
	// Second share row — different user_org, same user, same item, but editor.
	secondUserOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, secondUserOrgID, "editor")

	role, err := resolveShareRole(app, user.Id, item.Id)
	if err != nil {
		t.Fatalf("resolveShareRole: %v", err)
	}
	if role != roleEditor {
		t.Errorf("role: want editor, got %q", role)
	}
}

// TestIsReadOnlyForConn covers the read-only signal that gets shipped
// in MsgServerHello. owner/editor → false; viewer → true; missing
// share or empty auth → true (fail closed).
func TestIsReadOnlyForConn(t *testing.T) {
	app := setupAuthTestApp(t)
	editor := mustCreateUser(t, app, "editor@example.com")
	viewer := mustCreateUser(t, app, "viewer@example.com")
	owner := mustCreateUser(t, app, "owner@example.com")
	stranger := mustCreateUser(t, app, "stranger@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "doc.docx")

	editorUO := seedUserOrg(t, app, editor.Id, "org-acme")
	seedShare(t, app, item.Id, editorUO, "editor")
	viewerUO := seedUserOrg(t, app, viewer.Id, "org-acme")
	seedShare(t, app, item.Id, viewerUO, "viewer")
	ownerUO := seedUserOrg(t, app, owner.Id, "org-acme")
	seedShare(t, app, item.Id, ownerUO, "owner")
	// stranger has no share

	cases := []struct {
		name   string
		authID string
		wantRO bool
	}{
		{"editor", editor.Id, false},
		{"owner", owner.Id, false},
		{"viewer", viewer.Id, true},
		{"stranger", stranger.Id, true},
		{"empty-auth", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			conn := realtime.NewClientForTest(c.authID)
			if got := isReadOnlyForConn(app, item.Id, conn); got != c.wantRO {
				t.Errorf("isReadOnlyForConn(%s): got %v, want %v", c.name, got, c.wantRO)
			}
		})
	}
}

// TestRoleCanWrite covers the canWrite predicate that drives
// isReadOnlyForConn: only owner and editor may write; viewer and any
// unrecognized role are read-only (fail closed).
func TestRoleCanWrite(t *testing.T) {
	cases := []struct {
		role shareRole
		want bool
	}{
		{roleOwner, true},
		{roleEditor, true},
		{roleViewer, false},
		{shareRole(""), false},
		{shareRole("admin"), false}, // unknown role → fail closed
	}
	for _, c := range cases {
		if got := c.role.canWrite(); got != c.want {
			t.Errorf("canWrite(%q): got %v, want %v", c.role, got, c.want)
		}
	}
}
