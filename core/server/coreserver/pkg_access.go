package coreserver

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterOrgPkgEnabledHooks adds authorization checks that PocketBase RQL
// alone cannot express: the requesting user must have admin+ role in the org.
func RegisterOrgPkgEnabledHooks(app *pocketbase.PocketBase) {
	check := func(e *core.RecordRequestEvent) error {
		if e.Auth == nil {
			return e.UnauthorizedError("Authentication required", nil)
		}

		orgId := e.Record.GetString("org")
		if orgId == "" {
			return e.BadRequestError("org is required", nil)
		}

		records, err := e.App.FindRecordsByFilter(
			"user_org",
			"user = {:userId} && org = {:orgId} && (role = 'admin' || role = 'owner')",
			"",
			1,
			0,
			map[string]any{"userId": e.Auth.Id, "orgId": orgId},
		)
		if err != nil || len(records) == 0 {
			return e.ForbiddenError("Org admin role required", nil)
		}

		return e.Next()
	}

	app.OnRecordCreateRequest("org_pkg_enabled").BindFunc(check)
	app.OnRecordUpdateRequest("org_pkg_enabled").BindFunc(check)
	app.OnRecordDeleteRequest("org_pkg_enabled").BindFunc(check)
}
