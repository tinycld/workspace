package notify

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// allowedCommentCollections is the set of comment-table names the
// notify hook will dispatch for. Inserts referencing any other name
// are silently dropped — protecting against an attacker who manages
// to slip a bogus `comment_collection` value through the createRule.
// Each entry maps the comment table to its owning package's URL slug
// (e.g. `text_comments` → `text`), used to build the deep-link.
var allowedCommentCollections = map[string]string{
	"text_comments": "text",
	"calc_comments": "calc",
}

// RegisterCommentMentionHooks wires the OnRecordAfterCreateSuccess hook
// for comment_mentions. The hook validates the row, resolves the
// mentioned user + drive_item + org slug, then calls NotifyUser with a
// "comment_mention" payload pointing back at the doc.
func RegisterCommentMentionHooks(app *pocketbase.PocketBase) {
	registerCommentMentionHooksCore(app)
}

func registerCommentMentionHooksCore(app core.App) {
	app.OnRecordAfterCreateSuccess("comment_mentions").BindFunc(func(e *core.RecordEvent) error {
		mention := e.Record
		// Run notify off the request goroutine: external pushes can
		// stall, and a slow notify path shouldn't delay the insert
		// success response to the client.
		go handleCommentMention(app, mention)
		return e.Next()
	})
}

func handleCommentMention(app core.App, mention *core.Record) {
	commentCollection := mention.GetString("comment_collection")
	packageSlug, ok := allowedCommentCollections[commentCollection]
	if !ok {
		// Unknown comment_collection — silently drop. The allowlist
		// is the security boundary; logging at warn level so an
		// attacker probing the surface is visible without flooding
		// the log on legitimate (but unknown-to-this-build) packages.
		app.Logger().Warn("comment_mention: unknown comment_collection",
			"collection", commentCollection)
		return
	}

	mentionedUserOrgID := mention.GetString("mentioned_user_org")
	if mentionedUserOrgID == "" {
		return
	}

	mentionedUserOrg, err := app.FindRecordById("user_org", mentionedUserOrgID)
	if err != nil {
		app.Logger().Warn("comment_mention: mentioned user_org not found",
			"id", mentionedUserOrgID, "error", err)
		return
	}

	// Race guard: a user_org row can be deleted between the comment
	// insert and the notify dispatch. The relation has cascadeDelete,
	// so the mention row may have already been wiped, but the goroutine
	// might race ahead. Re-fetching here would re-trigger the same
	// failure; we just rely on the cascade and bail if the user_org
	// is gone.
	userID := mentionedUserOrg.GetString("user")
	orgID := mentionedUserOrg.GetString("org")
	if userID == "" || orgID == "" {
		return
	}

	// The comment author posted the mention; if the same user_org
	// somehow ends up as the mentioned party (e.g. a copy-paste), we
	// already dedupe self-mentions client-side in the mutations
	// factory. Defense in depth: skip here too if the comment author
	// equals the mentioned user_org.
	comment, err := app.FindRecordById(commentCollection, mention.GetString("comment_record"))
	if err != nil {
		app.Logger().Warn("comment_mention: comment record not found",
			"collection", commentCollection,
			"record", mention.GetString("comment_record"),
			"error", err)
		return
	}
	if comment.GetString("author") == mentionedUserOrgID {
		return
	}

	driveItemID := mention.GetString("drive_item")
	if driveItemID == "" {
		return
	}

	org, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		app.Logger().Warn("comment_mention: org not found",
			"id", orgID, "error", err)
		return
	}
	orgSlug := org.GetString("slug")
	if orgSlug == "" {
		return
	}

	// Build the deep-link. The `?thread=<id>` query param is read by
	// the document screen's useCommentsLifecycle hook to open the
	// drawer focused on the mentioned thread.
	threadID := commentThreadID(comment)
	appURL := strings.TrimRight(app.Settings().Meta.AppURL, "/")
	url := fmt.Sprintf("%s/a/%s/%s/%s?thread=%s", appURL, orgSlug, packageSlug, driveItemID, threadID)

	authorName := comment.GetString("author_name")
	if authorName == "" {
		authorName = "Someone"
	}

	title := fmt.Sprintf("%s mentioned you", authorName)
	body := truncate(comment.GetString("body"), 200)

	NotifyUser(app, NotifyParams{
		UserID:  userID,
		OrgID:   orgID,
		Type:    "comment_mention",
		Package: packageSlug,
		Title:   title,
		Body:    body,
		URL:     url,
		Meta: map[string]any{
			"commentCollection": commentCollection,
			"commentRecord":     comment.Id,
			"driveItem":         driveItemID,
			"threadId":          threadID,
		},
	})
}

// commentThreadID returns the root comment id for the thread. For
// replies, parent_comment points at the root; for the root itself,
// parent_comment is empty and the row's own id is the thread id.
func commentThreadID(comment *core.Record) string {
	parent := comment.GetString("parent_comment")
	if parent != "" {
		return parent
	}
	return comment.Id
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
