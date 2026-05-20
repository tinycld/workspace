package notify

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupCommentMentionTestApp builds the minimum collection graph the
// notify hook touches: users, orgs, user_org, drive_items, text_comments,
// comment_mentions, and notifications. NewTestApp() ships the standard
// PB users + collections (settings, etc.) but not the tinycld
// extensions, so we add them inline.
func setupCommentMentionTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	// Set an AppURL so the hook can build absolute deep links.
	settings := app.Settings()
	settings.Meta.AppURL = "https://app.test.local"
	if err := app.Save(settings); err != nil {
		t.Fatalf("save settings: %v", err)
	}

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
	if err := app.Save(userOrg); err != nil {
		t.Fatal(err)
	}

	driveItems := core.NewBaseCollection("drive_items")
	driveItems.Fields.Add(&core.TextField{Name: "name", Required: true})
	driveItems.Fields.Add(&core.RelationField{
		Name: "org", Required: true, CollectionId: orgs.Id, MaxSelect: 1,
	})
	if err := app.Save(driveItems); err != nil {
		t.Fatal(err)
	}

	textComments := core.NewBaseCollection("text_comments")
	textComments.Fields.Add(&core.RelationField{
		Name: "drive_item", Required: true, CollectionId: driveItems.Id, MaxSelect: 1,
	})
	textComments.Fields.Add(&core.TextField{Name: "comment_id"})
	textComments.Fields.Add(&core.TextField{Name: "quoted_text"})
	textComments.Fields.Add(&core.TextField{Name: "parent_comment"})
	textComments.Fields.Add(&core.TextField{Name: "body"})
	textComments.Fields.Add(&core.TextField{Name: "resolved_at"})
	textComments.Fields.Add(&core.RelationField{
		Name: "author", Required: true, CollectionId: userOrg.Id, MaxSelect: 1,
	})
	textComments.Fields.Add(&core.TextField{Name: "author_name"})
	if err := app.Save(textComments); err != nil {
		t.Fatal(err)
	}

	commentMentions := core.NewBaseCollection("comment_mentions")
	commentMentions.Fields.Add(&core.TextField{Name: "comment_collection", Required: true})
	commentMentions.Fields.Add(&core.TextField{Name: "comment_record", Required: true})
	commentMentions.Fields.Add(&core.RelationField{
		Name: "drive_item", Required: true, CollectionId: driveItems.Id, MaxSelect: 1,
	})
	commentMentions.Fields.Add(&core.RelationField{
		Name: "mentioned_user_org", Required: true, CollectionId: userOrg.Id, MaxSelect: 1,
	})
	if err := app.Save(commentMentions); err != nil {
		t.Fatal(err)
	}

	notifications := core.NewBaseCollection("notifications")
	notifications.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1,
	})
	notifications.Fields.Add(&core.RelationField{
		Name: "org", CollectionId: orgs.Id, MaxSelect: 1,
	})
	notifications.Fields.Add(&core.TextField{Name: "type"})
	notifications.Fields.Add(&core.TextField{Name: "package"})
	notifications.Fields.Add(&core.TextField{Name: "title"})
	notifications.Fields.Add(&core.TextField{Name: "body"})
	notifications.Fields.Add(&core.TextField{Name: "url"})
	notifications.Fields.Add(&core.JSONField{Name: "metadata"})
	notifications.Fields.Add(&core.BoolField{Name: "read"})
	notifications.Fields.Add(&core.BoolField{Name: "dismissed"})
	if err := app.Save(notifications); err != nil {
		t.Fatal(err)
	}

	return app
}

type mentionFixture struct {
	app          *tests.TestApp
	org          *core.Record
	authorUser   *core.Record
	authorUO     *core.Record
	mentionUser  *core.Record
	mentionUO    *core.Record
	driveItem    *core.Record
	commentRoot  *core.Record
}

func seedMentionFixture(t *testing.T) *mentionFixture {
	t.Helper()
	app := setupCommentMentionTestApp(t)

	usersCol, _ := app.FindCollectionByNameOrId("users")
	authorUser := core.NewRecord(usersCol)
	authorUser.SetEmail("author@test.local")
	authorUser.Set("name", "Alice")
	authorUser.SetVerified(true)
	authorUser.SetPassword("Password123!")
	if err := app.Save(authorUser); err != nil {
		t.Fatal(err)
	}

	mentionUser := core.NewRecord(usersCol)
	mentionUser.SetEmail("mention@test.local")
	mentionUser.Set("name", "Bob")
	mentionUser.SetVerified(true)
	mentionUser.SetPassword("Password123!")
	if err := app.Save(mentionUser); err != nil {
		t.Fatal(err)
	}

	orgsCol, _ := app.FindCollectionByNameOrId("orgs")
	org := core.NewRecord(orgsCol)
	org.Set("name", "Acme")
	org.Set("slug", "acme")
	if err := app.Save(org); err != nil {
		t.Fatal(err)
	}

	userOrgCol, _ := app.FindCollectionByNameOrId("user_org")
	authorUO := core.NewRecord(userOrgCol)
	authorUO.Set("org", org.Id)
	authorUO.Set("user", authorUser.Id)
	authorUO.Set("role", "member")
	if err := app.Save(authorUO); err != nil {
		t.Fatal(err)
	}

	mentionUO := core.NewRecord(userOrgCol)
	mentionUO.Set("org", org.Id)
	mentionUO.Set("user", mentionUser.Id)
	mentionUO.Set("role", "member")
	if err := app.Save(mentionUO); err != nil {
		t.Fatal(err)
	}

	driveCol, _ := app.FindCollectionByNameOrId("drive_items")
	driveItem := core.NewRecord(driveCol)
	driveItem.Set("name", "doc.txt")
	driveItem.Set("org", org.Id)
	if err := app.Save(driveItem); err != nil {
		t.Fatal(err)
	}

	tcCol, _ := app.FindCollectionByNameOrId("text_comments")
	commentRoot := core.NewRecord(tcCol)
	commentRoot.Set("drive_item", driveItem.Id)
	commentRoot.Set("comment_id", "cm_xyz")
	commentRoot.Set("parent_comment", "")
	commentRoot.Set("body", "hi [[@"+mentionUO.Id+"]]")
	commentRoot.Set("author", authorUO.Id)
	commentRoot.Set("author_name", "Alice")
	if err := app.Save(commentRoot); err != nil {
		t.Fatal(err)
	}

	return &mentionFixture{
		app:         app,
		org:         org,
		authorUser:  authorUser,
		authorUO:    authorUO,
		mentionUser: mentionUser,
		mentionUO:   mentionUO,
		driveItem:   driveItem,
		commentRoot: commentRoot,
	}
}

// runHookSync invokes handleCommentMention directly (bypassing the
// goroutine in the registered hook) so tests don't have to race on a
// time.Sleep. The hook itself is just `go handleCommentMention(...)`
// so this preserves the same code path.
func runHookSync(t *testing.T, app core.App, mention *core.Record) {
	t.Helper()
	handleCommentMention(app, mention)
}

// findLatestNotification returns the single notification record for
// the user, or nil if none exists. Fails the test if multiple are
// present — every test should be in a clean state.
func findLatestNotification(t *testing.T, app core.App, userID string) *core.Record {
	t.Helper()
	records, err := app.FindRecordsByFilter(
		"notifications",
		"user = {:userId}",
		"",
		10, 0,
		map[string]any{"userId": userID},
	)
	if err != nil {
		t.Fatalf("find notifications: %v", err)
	}
	if len(records) == 0 {
		return nil
	}
	if len(records) > 1 {
		t.Fatalf("expected at most one notification, got %d", len(records))
	}
	return records[0]
}

func mkMention(t *testing.T, app core.App, f *mentionFixture, collection string) *core.Record {
	t.Helper()
	cmCol, _ := app.FindCollectionByNameOrId("comment_mentions")
	mention := core.NewRecord(cmCol)
	mention.Set("comment_collection", collection)
	mention.Set("comment_record", f.commentRoot.Id)
	mention.Set("drive_item", f.driveItem.Id)
	mention.Set("mentioned_user_org", f.mentionUO.Id)
	if err := app.Save(mention); err != nil {
		t.Fatal(err)
	}
	return mention
}

func TestCommentMention_AllowlistRejectsUnknownCollection(t *testing.T) {
	f := seedMentionFixture(t)
	mention := mkMention(t, f.app, f, "bogus_collection")
	runHookSync(t, f.app, mention)
	if got := findLatestNotification(t, f.app, f.mentionUser.Id); got != nil {
		t.Errorf("expected no notification for unknown collection, got %v", got.Id)
	}
}

func TestCommentMention_HappyPathWritesNotification(t *testing.T) {
	f := seedMentionFixture(t)
	mention := mkMention(t, f.app, f, "text_comments")
	runHookSync(t, f.app, mention)
	n := findLatestNotification(t, f.app, f.mentionUser.Id)
	if n == nil {
		t.Fatal("expected notification, got none")
	}
	if got := n.GetString("type"); got != "comment_mention" {
		t.Errorf("type = %q, want comment_mention", got)
	}
	if got := n.GetString("package"); got != "text" {
		t.Errorf("package = %q, want text", got)
	}
	if got := n.GetString("org"); got != f.org.Id {
		t.Errorf("org = %q, want %q", got, f.org.Id)
	}
	wantURL := "https://app.test.local/a/acme/text/" + f.driveItem.Id + "?thread=" + f.commentRoot.Id
	if got := n.GetString("url"); got != wantURL {
		t.Errorf("url = %q, want %q", got, wantURL)
	}
}

func TestCommentMention_ReplyDeepLinksToRootThread(t *testing.T) {
	f := seedMentionFixture(t)

	// Create a reply pointing at the root. Mentions on a reply should
	// deep-link to the root (so the drawer opens with the whole thread
	// in view), not to the reply id.
	tcCol, _ := f.app.FindCollectionByNameOrId("text_comments")
	reply := core.NewRecord(tcCol)
	reply.Set("drive_item", f.driveItem.Id)
	reply.Set("comment_id", "cm_xyz")
	reply.Set("parent_comment", f.commentRoot.Id)
	reply.Set("body", "ping [[@"+f.mentionUO.Id+"]]")
	reply.Set("author", f.authorUO.Id)
	reply.Set("author_name", "Alice")
	if err := f.app.Save(reply); err != nil {
		t.Fatal(err)
	}

	cmCol, _ := f.app.FindCollectionByNameOrId("comment_mentions")
	mention := core.NewRecord(cmCol)
	mention.Set("comment_collection", "text_comments")
	mention.Set("comment_record", reply.Id)
	mention.Set("drive_item", f.driveItem.Id)
	mention.Set("mentioned_user_org", f.mentionUO.Id)
	if err := f.app.Save(mention); err != nil {
		t.Fatal(err)
	}

	runHookSync(t, f.app, mention)

	n := findLatestNotification(t, f.app, f.mentionUser.Id)
	if n == nil {
		t.Fatal("expected notification, got none")
	}
	wantURL := "https://app.test.local/a/acme/text/" + f.driveItem.Id + "?thread=" + f.commentRoot.Id
	if got := n.GetString("url"); got != wantURL {
		t.Errorf("url = %q, want %q (reply should deep-link to root)", got, wantURL)
	}
}

func TestCommentMention_SkipsSelfMention(t *testing.T) {
	f := seedMentionFixture(t)

	// Author mentions themselves. The client-side mutations factory
	// already drops these, but defense in depth lives here too.
	cmCol, _ := f.app.FindCollectionByNameOrId("comment_mentions")
	mention := core.NewRecord(cmCol)
	mention.Set("comment_collection", "text_comments")
	mention.Set("comment_record", f.commentRoot.Id)
	mention.Set("drive_item", f.driveItem.Id)
	mention.Set("mentioned_user_org", f.authorUO.Id)
	if err := f.app.Save(mention); err != nil {
		t.Fatal(err)
	}
	runHookSync(t, f.app, mention)

	if got := findLatestNotification(t, f.app, f.authorUser.Id); got != nil {
		t.Errorf("expected no self-mention notification, got %v", got.Id)
	}
}

func TestCommentMention_HookIsRegisteredAndFiresAsync(t *testing.T) {
	// Smoke test: the hook should fire via OnRecordAfterCreateSuccess.
	// It runs async (goroutine), so this test gives it a brief window
	// to land. The other tests use the sync helper so they don't have
	// to race; this one exercises the actual registration path.
	f := seedMentionFixture(t)
	registerCommentMentionHooksCore(f.app)

	cmCol, _ := f.app.FindCollectionByNameOrId("comment_mentions")
	mention := core.NewRecord(cmCol)
	mention.Set("comment_collection", "text_comments")
	mention.Set("comment_record", f.commentRoot.Id)
	mention.Set("drive_item", f.driveItem.Id)
	mention.Set("mentioned_user_org", f.mentionUO.Id)
	if err := f.app.Save(mention); err != nil {
		t.Fatal(err)
	}

	// Poll briefly so the goroutine has a chance to land. Plain
	// time.Sleep would be flaky on slow CI; loop with a backoff and
	// give up after ~1s.
	deadline := time.Now().Add(time.Second)
	var n *core.Record
	for time.Now().Before(deadline) {
		records, err := f.app.FindRecordsByFilter(
			"notifications",
			"user = {:userId}",
			"",
			10, 0,
			map[string]any{"userId": f.mentionUser.Id},
		)
		if err == nil && len(records) > 0 {
			n = records[0]
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if n == nil {
		t.Fatal("expected notification to be written by registered hook within 1s")
	}
}

