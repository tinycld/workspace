package coreserver

import (
	"log"
	"reflect"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// selfEditableUserFields lists the fields the record's own user is allowed
// to change via a direct API write. Profile-style fields only — `name` and
// `avatar`. Password / email changes flow through PocketBase's dedicated
// confirmation endpoints (requestPasswordReset, requestEmailChange) which
// don't go through this hook. `verified` is set by confirmVerification.
//
// `is_demo` is intentionally absent: a sandboxed user must not be able to
// lift their own restrictions.
var selfEditableUserFields = map[string]bool{
	"name":   true,
	"avatar": true,
}

// adminEditableUserFields lists the fields shared-org admins are allowed
// to modify on other users via the relaxed users.updateRule.
//
// We use an allowlist rather than a denylist so that future additions to the
// users collection (PB upgrades, new auth hooks) default to "rejected"
// instead of silently becoming admin-writable.
var adminEditableUserFields = map[string]bool{
	"name":    true,
	"avatar":  true,
	"is_demo": true,
}

// RegisterUsersDemoAuditHook writes an audit_logs entry every time the
// is_demo flag flips on a user record. Demo state changes are
// operationally interesting (App Review setup, prospect demos, accidental
// flips) and worth a forensic trail. We write directly rather than using
// the generic audit.RegisterCollection because we don't want every name
// or avatar tweak to spam the audit log — this captures only the demo
// transition.
func RegisterUsersDemoAuditHook(app *pocketbase.PocketBase) {
	registerUsersDemoAuditHookCore(app)
}

func registerUsersDemoAuditHookCore(app core.App) {
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		wasDemo := original.GetBool("is_demo")
		nextDemo := e.Record.GetBool("is_demo")

		// Run the rest of the chain first so audit only fires on a
		// successful update (rejections shouldn't leave a phantom log).
		if err := e.Next(); err != nil {
			return err
		}
		if wasDemo == nextDemo {
			return nil
		}

		auditCol, err := e.App.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			log.Printf("[demo-audit] missing audit_logs collection: %v", err)
			return nil
		}
		auditRec := core.NewRecord(auditCol)
		auditRec.Set("action", "users.demo_changed")
		auditRec.Set("resource_type", "users")
		auditRec.Set("resource_id", e.Record.Id)
		auditRec.Set("resource_label", e.Record.GetString("email"))
		auditRec.Set("metadata", map[string]any{
			"from": wasDemo,
			"to":   nextDemo,
		})
		if e.Auth != nil {
			auditRec.Set("actor", e.Auth.Id)
		}
		if err := e.App.Save(auditRec); err != nil {
			log.Printf("[demo-audit] failed to write audit entry: %v", err)
		}
		return nil
	})
}

// RegisterUsersFieldGuard rejects update requests on the users collection
// that fall outside two narrow paths:
//   - Self-edits: the record owner can change anything (PB's normal auth).
//   - Admin-edits: a caller who is an admin/owner of an org shared with the
//     target can change ONLY the allowlisted fields above.
//
// The relaxed users.updateRule (migration 1810000000) lets any shared-org
// member attempt an update so client code can use pbtsdb mutations directly;
// this hook narrows that to "shared-org admin, allowlisted field only".
// PocketBase's collection rules can't constrain which fields a write touches
// or join through user_org with a role filter — per-field policy lives here.
func RegisterUsersFieldGuard(app *pocketbase.PocketBase) {
	registerUsersFieldGuardCore(app)
}

// registerUsersFieldGuardCore is the core.App-typed body so tests can wire
// the hook into a *tests.TestApp directly. Callers in production go through
// RegisterUsersFieldGuard which takes the concrete *pocketbase.PocketBase.
func registerUsersFieldGuardCore(app core.App) {
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Auth == nil {
			return e.UnauthorizedError("Authentication required", nil)
		}

		// Superusers bypass the field allowlist. The guard exists to constrain
		// regular API clients (self-edits, org-admin edits); superusers already
		// bypass collection rules and are trusted with full administrative
		// writes (seed/reset scripts overwrite email/password on the demo
		// account, operators reset locked-out users, etc.).
		if e.Auth.IsSuperuser() {
			return e.Next()
		}

		original := e.Record.Original()
		isSelf := e.Auth.Id == e.Record.Id

		// Demo accounts are shared across anonymous visitors via /api/demo/start.
		// Letting one visitor self-edit the profile (name, avatar, ...) leaves
		// the change visible to every subsequent visitor until the nightly
		// reset wipes it. Reject self-edits outright; admin edits are still
		// allowed so an operator can flip is_demo back off if needed.
		if isSelf && original.GetBool("is_demo") {
			return e.ForbiddenError("Demo accounts are read-only", nil)
		}

		allowed := selfEditableUserFields
		if !isSelf {
			allowed = adminEditableUserFields
		}

		// Walk every field; reject the request if any non-allowed field
		// changed. reflect.DeepEqual handles every field type (string, bool,
		// *PasswordFieldValue, etc.) without us enumerating each.
		for _, field := range e.Record.Collection().Fields {
			name := field.GetName()
			if reflect.DeepEqual(e.Record.GetRaw(name), original.GetRaw(name)) {
				continue
			}
			if !allowed[name] {
				msg := "Only the record owner can change this field"
				if isSelf {
					// Sensitive fields (password, email, verified) go through
					// PB's dedicated confirmation endpoints, not direct
					// updates. is_demo is admin-only by design.
					msg = "This field cannot be changed via a direct update"
				}
				return e.ForbiddenError(msg, map[string]any{"field": name})
			}
		}

		// Self-edits don't need the org-admin check below.
		if isSelf {
			return e.Next()
		}

		// Verify the caller is an admin/owner of an org shared with the target.
		// Two queries beat a single SQL join: PB's record-level filter language
		// is friendlier than wrangling RawQuery here.
		callerOrgs, err := e.App.FindRecordsByFilter(
			"user_org",
			"user = {:caller} && (role = 'admin' || role = 'owner')",
			"",
			0,
			0,
			map[string]any{"caller": e.Auth.Id},
		)
		if err != nil || len(callerOrgs) == 0 {
			return e.ForbiddenError("Org admin role required", nil)
		}
		callerOrgIDs := make(map[string]bool, len(callerOrgs))
		for _, uo := range callerOrgs {
			callerOrgIDs[uo.GetString("org")] = true
		}

		targetOrgs, err := e.App.FindRecordsByFilter(
			"user_org",
			"user = {:target}",
			"",
			0,
			0,
			map[string]any{"target": e.Record.Id},
		)
		if err != nil {
			return e.ForbiddenError("Org admin role required", nil)
		}
		for _, uo := range targetOrgs {
			if callerOrgIDs[uo.GetString("org")] {
				return e.Next()
			}
		}

		return e.ForbiddenError("Org admin role required", nil)
	})
}
