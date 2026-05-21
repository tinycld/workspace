package mail

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// recomputeThreadMarkers refreshes the has_draft and has_attachments flags on
// the given mail_threads row by checking whether any of its messages still
// satisfy each predicate. Idempotent — only saves if a flag changed.
//
// Called from mail_messages create/update/delete hooks so the thread row
// always reflects the current state of its messages. The mail thread list
// reads these flags directly, avoiding a per-page mail_messages fetch just
// to render paperclip / draft icons.
func recomputeThreadMarkers(app core.App, threadID string) error {
	if threadID == "" {
		return nil
	}
	thread, err := app.FindRecordById("mail_threads", threadID)
	if err != nil {
		// Thread may have been deleted by a cascade ahead of this hook —
		// nothing to update.
		return nil
	}

	hasDraft, err := messageExists(app, threadID, "delivery_status = 'draft'")
	if err != nil {
		return err
	}
	hasAttachments, err := messageExists(app, threadID, "has_attachments = 1")
	if err != nil {
		return err
	}

	changed := false
	if thread.GetBool("has_draft") != hasDraft {
		thread.Set("has_draft", hasDraft)
		changed = true
	}
	if thread.GetBool("has_attachments") != hasAttachments {
		thread.Set("has_attachments", hasAttachments)
		changed = true
	}
	if !changed {
		return nil
	}
	return app.Save(thread)
}

func messageExists(app core.App, threadID, condition string) (bool, error) {
	var result struct {
		Found int `db:"found"`
	}
	err := app.DB().NewQuery(
		"SELECT EXISTS(SELECT 1 FROM mail_messages WHERE thread = {:threadID} AND " + condition + ") AS found",
	).Bind(map[string]any{"threadID": threadID}).One(&result)
	if err != nil {
		return false, err
	}
	return result.Found == 1, nil
}

// registerThreadMarkerHooks wires recomputeThreadMarkers into mail_messages
// lifecycle events. Bound from Register() so it runs alongside the other
// mail hooks.
func registerThreadMarkerHooks(app *pocketbase.PocketBase) {
	app.OnRecordAfterCreateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if err := recomputeThreadMarkers(app, e.Record.GetString("thread")); err != nil {
			app.Logger().Warn("recomputeThreadMarkers (create) failed", "thread", e.Record.GetString("thread"), "error", err)
		}
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if err := recomputeThreadMarkers(app, e.Record.GetString("thread")); err != nil {
			app.Logger().Warn("recomputeThreadMarkers (update) failed", "thread", e.Record.GetString("thread"), "error", err)
		}
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if err := recomputeThreadMarkers(app, e.Record.GetString("thread")); err != nil {
			app.Logger().Warn("recomputeThreadMarkers (delete) failed", "thread", e.Record.GetString("thread"), "error", err)
		}
		return e.Next()
	})
}
