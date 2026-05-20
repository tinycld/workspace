// Package audit provides audit logging for PocketBase record lifecycle events.
// It writes entries to the `audit_logs` collection with org resolution, field-level
// diffs, delete snapshots, and sensitive-field redaction.
//
// Core collections are registered by the main server. External packages register
// their own collections via RegisterCollection in their Register() function.
package audit

import (
	"fmt"
	"log"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// OrgResolver returns the org ID for a record, or "" if it cannot be determined.
type OrgResolver func(app core.App, record *core.Record) string

// LabelExtractor returns a human-readable label for a record.
type LabelExtractor func(record *core.Record) string

// CollectionConfig describes how to audit a single collection.
type CollectionConfig struct {
	// ResolveOrg returns the org ID for a record in this collection.
	// If nil, the default resolver is used (checks "org" field, then common
	// relation patterns like owner→user_org, calendar→org, etc.).
	ResolveOrg OrgResolver

	// ExtractLabel returns a display label for the record (e.g. contact name,
	// file name). If nil, the default extractor tries common fields (name,
	// title, label, address).
	ExtractLabel LabelExtractor
}

// Fields that should never appear in diffs.
var redactedFields = map[string]bool{
	"password":        true,
	"passwordConfirm": true,
	"tokenKey":        true,
	"keys":            true,
}

// System fields to skip in diffs.
var systemFields = map[string]bool{
	"id":      true,
	"created": true,
	"updated": true,
}

// RegisterCollection registers audit hooks for a single collection. Call this
// from a package's Register() function to add that package's collections to the
// audit log. Pass nil for config to use default org resolution and label extraction.
func RegisterCollection(app *pocketbase.PocketBase, collectionName string, config *CollectionConfig) {
	if config == nil {
		config = &CollectionConfig{}
	}

	resolveOrg := config.ResolveOrg
	if resolveOrg == nil {
		resolveOrg = DefaultOrgResolver
	}

	extractLabel := config.ExtractLabel
	if extractLabel == nil {
		extractLabel = DefaultLabelExtractor
	}

	app.OnRecordCreateRequest(collectionName).BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		go logCreate(app, e.Record, e.RequestEvent, collectionName, resolveOrg, extractLabel)
		return nil
	})

	app.OnRecordUpdateRequest(collectionName).BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		if err := e.Next(); err != nil {
			return err
		}
		go logUpdate(app, e.Record, original, e.RequestEvent, collectionName, resolveOrg, extractLabel)
		return nil
	})

	app.OnRecordDeleteRequest(collectionName).BindFunc(func(e *core.RecordRequestEvent) error {
		snapshot := BuildSnapshot(e.Record)
		recordID := e.Record.Id
		label := extractLabel(e.Record)
		orgID := resolveOrg(app, e.Record)
		if err := e.Next(); err != nil {
			return err
		}
		go logDelete(app, recordID, orgID, label, snapshot, e.RequestEvent, collectionName)
		return nil
	})
}

// RegisterCollections is a convenience for registering multiple collections
// that all share the same config.
func RegisterCollections(app *pocketbase.PocketBase, names []string, config *CollectionConfig) {
	for _, name := range names {
		RegisterCollection(app, name, config)
	}
}

func logCreate(app core.App, record *core.Record, re *core.RequestEvent, collectionName string, resolveOrg OrgResolver, extractLabel LabelExtractor) {
	orgID := resolveOrg(app, record)
	if orgID == "" {
		log.Printf("[audit] could not resolve org for %s/%s, skipping", collectionName, record.Id)
		return
	}

	auditRecord := newAuditRecord(app, orgID, "created", collectionName, record.Id, extractLabel(record))
	if auditRecord == nil {
		return
	}
	setRequestInfo(auditRecord, re)

	if err := app.Save(auditRecord); err != nil {
		log.Printf("[audit] failed to save audit log for %s/%s: %v", collectionName, record.Id, err)
	}
}

func logUpdate(app core.App, record *core.Record, original *core.Record, re *core.RequestEvent, collectionName string, resolveOrg OrgResolver, extractLabel LabelExtractor) {
	orgID := resolveOrg(app, record)
	if orgID == "" {
		log.Printf("[audit] could not resolve org for %s/%s, skipping", collectionName, record.Id)
		return
	}

	auditRecord := newAuditRecord(app, orgID, "updated", collectionName, record.Id, extractLabel(record))
	if auditRecord == nil {
		return
	}
	setRequestInfo(auditRecord, re)

	if original != nil {
		diff := ComputeDiff(original, record)
		if len(diff) > 0 {
			auditRecord.Set("changes", diff)
		}
	}

	if err := app.Save(auditRecord); err != nil {
		log.Printf("[audit] failed to save audit log for %s/%s: %v", collectionName, record.Id, err)
	}
}

func logDelete(app core.App, recordID string, orgID string, label string, snapshot map[string]any, re *core.RequestEvent, collectionName string) {
	if orgID == "" {
		log.Printf("[audit] could not resolve org for %s/%s, skipping", collectionName, recordID)
		return
	}

	auditRecord := newAuditRecord(app, orgID, "deleted", collectionName, recordID, label)
	if auditRecord == nil {
		return
	}
	auditRecord.Set("snapshot", snapshot)
	setRequestInfo(auditRecord, re)

	if err := app.Save(auditRecord); err != nil {
		log.Printf("[audit] failed to save audit log for %s/%s: %v", collectionName, recordID, err)
	}
}

func newAuditRecord(app core.App, orgID string, action string, resourceType string, resourceID string, label string) *core.Record {
	auditCollection, err := app.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		log.Printf("[audit] could not find audit_logs collection: %v", err)
		return nil
	}

	r := core.NewRecord(auditCollection)
	r.Set("org", orgID)
	r.Set("action", action)
	r.Set("resource_type", resourceType)
	r.Set("resource_id", resourceID)
	r.Set("resource_label", label)
	return r
}

func setRequestInfo(auditRecord *core.Record, re *core.RequestEvent) {
	if re == nil {
		auditRecord.Set("metadata", map[string]any{"source": "system"})
		return
	}
	if re.Auth != nil && re.Auth.Collection().Name == "users" {
		auditRecord.Set("actor", re.Auth.Id)
	}
	auditRecord.Set("ip_address", re.RealIP())
	auditRecord.Set("user_agent", re.Request.UserAgent())
}

// --- Org resolvers ---

// DefaultOrgResolver checks common field patterns to resolve an org ID.
// It handles: direct "org" field, owner→user_org, user_org→org, and the
// "orgs" collection itself. For deeper chains (mail, calendar, drive),
// use ResolveViaRelation or write a custom resolver.
func DefaultOrgResolver(app core.App, record *core.Record) string {
	collectionName := record.Collection().Name

	if collectionName == "orgs" {
		return record.Id
	}

	if orgID := record.GetString("org"); orgID != "" {
		return orgID
	}

	// Via owner → user_org (contacts)
	if ownerID := record.GetString("owner"); ownerID != "" {
		return ResolveViaRelation(app, "user_org", ownerID, "org")
	}

	// Via user_org field (label_assignments, org_pkg_access)
	if userOrgID := record.GetString("user_org"); userOrgID != "" {
		return ResolveViaRelation(app, "user_org", userOrgID, "org")
	}

	return ""
}

// ResolveViaRelation loads a related record and reads a field from it.
// Useful for building custom OrgResolver chains.
func ResolveViaRelation(app core.App, collection string, id string, field string) string {
	rec, err := app.FindRecordById(collection, id)
	if err != nil {
		return ""
	}
	return rec.GetString(field)
}

// --- Label extractors ---

// DefaultLabelExtractor tries common display fields: name, title, label, address.
func DefaultLabelExtractor(record *core.Record) string {
	for _, field := range []string{"name", "title", "label", "address"} {
		if v := record.GetString(field); v != "" {
			return v
		}
	}
	return ""
}

// LabelFromField returns a LabelExtractor that reads a single field.
func LabelFromField(fieldName string) LabelExtractor {
	return func(record *core.Record) string {
		return record.GetString(fieldName)
	}
}

// LabelFromFields returns a LabelExtractor that joins multiple fields with ":".
func LabelFromFields(fieldNames ...string) LabelExtractor {
	return func(record *core.Record) string {
		parts := make([]string, 0, len(fieldNames))
		for _, f := range fieldNames {
			if v := record.GetString(f); v != "" {
				parts = append(parts, v)
			}
		}
		return strings.Join(parts, ":")
	}
}

// --- Diff / Snapshot utilities ---

// ComputeDiff compares original vs current record fields and returns changed fields.
func ComputeDiff(original *core.Record, current *core.Record) map[string]any {
	if original == nil {
		return nil
	}

	diff := map[string]any{}

	for _, field := range current.Collection().Fields {
		fieldName := field.GetName()
		if systemFields[fieldName] {
			continue
		}
		if redactedFields[fieldName] {
			oldVal := original.Get(fieldName)
			newVal := current.Get(fieldName)
			if fieldToString(oldVal) != fieldToString(newVal) {
				diff[fieldName] = map[string]any{"redacted": true}
			}
			continue
		}

		oldVal := original.Get(fieldName)
		newVal := current.Get(fieldName)

		if fieldToString(oldVal) != fieldToString(newVal) {
			diff[fieldName] = map[string]any{
				"before": oldVal,
				"after":  newVal,
			}
		}
	}

	return diff
}

// BuildSnapshot captures all non-system, non-redacted fields for delete events.
func BuildSnapshot(record *core.Record) map[string]any {
	snapshot := map[string]any{}

	for _, field := range record.Collection().Fields {
		fieldName := field.GetName()
		if systemFields[fieldName] {
			continue
		}
		if redactedFields[fieldName] {
			snapshot[fieldName] = "[redacted]"
			continue
		}
		snapshot[fieldName] = record.Get(fieldName)
	}

	return snapshot
}

func fieldToString(val any) string {
	if val == nil {
		return ""
	}
	switch v := val.(type) {
	case string:
		return v
	case []string:
		return strings.Join(v, ",")
	default:
		return fmt.Sprintf("%v", v)
	}
}
