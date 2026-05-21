package text

import (
	"os"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// fixtureDocxPath points at the user-curated docx fixture under
// text/tests/assets. Read with os.ReadFile because go:embed paths
// cannot escape the containing package.
const fixtureDocxPath = "../tests/assets/feature-test.docx"

// loadFixtureDocx reads a fixture file from text/tests/assets/. Used
// by bootstrap_test.go and flush_test.go to feed real .docx bytes into
// the runtime + bootstrap chain.
func loadFixtureDocx(t *testing.T, name string) []byte {
	t.Helper()
	path := "../tests/assets/" + name
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("loadFixtureDocx %s: %v", path, err)
	}
	if len(bytes) == 0 {
		t.Fatalf("loadFixtureDocx %s: empty file", path)
	}
	return bytes
}

// setupTestApp creates a tests.TestApp with a minimal drive_items
// collection (just enough to seed a docx blob, re-read it after flush,
// and exercise the bootstrap path). Real production schemas have many
// more fields; we synthesize the bits the bootstrap + flush touch.
//
// Mirrors calc/server/persist_test.go::setupPersistTestApp — both
// packages need the same minimal drive_items shape because both
// bootstrap from and flush back to the same drive collection.
func setupTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("tests.NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	items := core.NewBaseCollection(driveItemsCollection)
	items.Fields.Add(&core.TextField{Name: "name"})
	items.Fields.Add(&core.FileField{
		Name:    "file",
		MaxSize: 50 << 20, // 50 MiB — a real document may be large
	})
	items.Fields.Add(&core.NumberField{Name: "size"})
	items.Fields.Add(&core.TextField{Name: "org"})
	// mime_type is read by render_endpoint.go's mime-validation gate.
	// Real drive_items records carry this field (defined in the drive
	// sibling's migration); tests need it present so the render
	// handler's docx-only check has something to compare against.
	items.Fields.Add(&core.TextField{Name: "mime_type"})
	if err := app.Save(items); err != nil {
		t.Fatalf("save drive_items collection: %v", err)
	}
	return app
}

// setupAuthTestApp builds on setupTestApp by also creating the user_org
// and drive_shares collections needed to exercise the authorize path.
// The drive_items field stays text-typed for `org` (rather than a real
// relation) because we don't need referential integrity in tests —
// equality is sufficient for the share lookup.
func setupAuthTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app := setupTestApp(t)

	userOrg := core.NewBaseCollection("user_org")
	userOrg.Fields.Add(&core.TextField{Name: "user", Required: true})
	userOrg.Fields.Add(&core.TextField{Name: "org", Required: true})
	if err := app.Save(userOrg); err != nil {
		t.Fatalf("save user_org collection: %v", err)
	}

	shares := core.NewBaseCollection("drive_shares")
	shares.Fields.Add(&core.TextField{Name: "item", Required: true})
	shares.Fields.Add(&core.RelationField{
		Name:          "user_org",
		Required:      true,
		CollectionId:  userOrg.Id,
		MaxSelect:     1,
		CascadeDelete: true,
	})
	shares.Fields.Add(&core.SelectField{
		Name:      "role",
		Required:  true,
		Values:    []string{"owner", "editor", "viewer"},
		MaxSelect: 1,
	})
	if err := app.Save(shares); err != nil {
		t.Fatalf("save drive_shares collection: %v", err)
	}
	return app
}

// seedDriveItemInOrg creates a drive_items record tagged to the given org
// and returns its saved record. Used by authorize tests where the org
// alignment between item and share matters.
func seedDriveItemInOrg(t *testing.T, app *tests.TestApp, orgID, name string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(driveItemsCollection)
	if err != nil {
		t.Fatalf("find drive_items collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("size", 0)
	rec.Set("org", orgID)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_item record: %v", err)
	}
	return rec
}

// seedUserOrg creates a user_org row binding the user to the org and
// returns its saved record id.
func seedUserOrg(t *testing.T, app *tests.TestApp, userID, orgID string) string {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("user_org")
	if err != nil {
		t.Fatalf("find user_org collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("user", userID)
	rec.Set("org", orgID)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save user_org record: %v", err)
	}
	return rec.Id
}

// seedShare creates a drive_shares row binding the user_org row to the
// drive_item with the given role.
func seedShare(t *testing.T, app *tests.TestApp, itemID, userOrgID, role string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("drive_shares")
	if err != nil {
		t.Fatalf("find drive_shares collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("item", itemID)
	rec.Set("user_org", userOrgID)
	rec.Set("role", role)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_shares record: %v", err)
	}
}

// seedDriveItem creates a drive_items record with the given file bytes
// attached and returns the saved record. The record's Id is what the
// broker would hand to NewDoc as roomID in production.
func seedDriveItem(t *testing.T, app *tests.TestApp, name string, content []byte) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(driveItemsCollection)
	if err != nil {
		t.Fatalf("find drive_items collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("size", len(content))
	if len(content) > 0 {
		f, err := filesystem.NewFileFromBytes(content, name)
		if err != nil {
			t.Fatalf("NewFileFromBytes: %v", err)
		}
		rec.Set("file", f)
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_item record: %v", err)
	}
	return rec
}

// mustCreateUser creates a minimal _superusers record (the built-in
// auth collection in PB's test harness) and returns it as a *core.Record
// suitable for passing to makeAuthorize. Used by authorize_test.go's
// integration tests; the share-grant path is not exercised here (it
// would require populating user_org + drive_shares too).
func mustCreateUser(t *testing.T, app *tests.TestApp, email string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("_superusers")
	if err != nil {
		t.Fatalf("find _superusers collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("email", email)
	rec.Set("password", "test-password-1234")
	if err := app.Save(rec); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return rec
}
