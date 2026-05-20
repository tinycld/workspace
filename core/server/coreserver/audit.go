package coreserver

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/audit"
)

// RegisterAuditHooks registers audit logging for core collections.
// Package-specific collections are registered by each package in its own
// Register() function using the tinycld.org/core/audit package directly.
func RegisterAuditHooks(app *pocketbase.PocketBase) {
	// orgs — the record IS the org
	audit.RegisterCollection(app, "orgs", &audit.CollectionConfig{
		ResolveOrg: func(_ core.App, record *core.Record) string {
			return record.Id
		},
		ExtractLabel: audit.LabelFromField("name"),
	})

	// Direct "org" field collections
	audit.RegisterCollection(app, "labels", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("name"),
	})
	audit.RegisterCollection(app, "settings", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromFields("app", "key"),
	})
	audit.RegisterCollection(app, "org_pkg_enabled", nil)

	// Org via user_org relation
	audit.RegisterCollection(app, "user_org", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("role"),
	})
	audit.RegisterCollections(app, []string{"label_assignments", "org_pkg_access"}, nil)
}
