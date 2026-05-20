package contacts

import (
	"context"
	"net/http"
	"strings"

	"github.com/emersion/go-webdav/carddav"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/audit"
)

func Register(app *pocketbase.PocketBase) {
	// Audit logging for contacts
	audit.RegisterCollection(app, "contacts", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			ownerID := record.GetString("owner")
			if ownerID == "" {
				return ""
			}
			return audit.ResolveViaRelation(a, "user_org", ownerID, "org")
		},
		ExtractLabel: func(record *core.Record) string {
			first := record.GetString("first_name")
			last := record.GetString("last_name")
			return strings.TrimSpace(first + " " + last)
		},
	})

	// FTS sync hooks for contacts
	app.OnRecordAfterCreateSuccess("contacts").BindFunc(func(e *core.RecordEvent) error {
		syncContactToFTS(app, e.Record, "create")
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("contacts").BindFunc(func(e *core.RecordEvent) error {
		syncContactToFTS(app, e.Record, "update")
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("contacts").BindFunc(func(e *core.RecordEvent) error {
		syncContactToFTS(app, e.Record, "delete")
		return e.Next()
	})

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		backend := &CardDAVBackend{app: app}
		handler := carddav.Handler{Backend: backend, Prefix: "/carddav"}

		serveCardDAV := func(re *core.RequestEvent) error {
			// Require Basic Auth — send 401 challenge if missing
			_, _, ok := re.Request.BasicAuth()
			if !ok {
				re.Response.Header().Set("WWW-Authenticate", `Basic realm="TinyCld CardDAV"`)
				http.Error(re.Response, "Authentication required", http.StatusUnauthorized)
				return nil
			}

			ctx := context.WithValue(re.Request.Context(), httpRequestKey, re.Request)
			handler.ServeHTTP(re.Response, re.Request.WithContext(ctx))
			return nil
		}

		e.Router.Any("/carddav/{path...}", serveCardDAV)
		e.Router.Any("/carddav", serveCardDAV)

		e.Router.Any("/.well-known/carddav", func(re *core.RequestEvent) error {
			http.Redirect(re.Response, re.Request, "/carddav/", http.StatusMovedPermanently)
			return nil
		})

		// Contacts search endpoint (requires auth)
		e.Router.GET("/api/contacts/search", func(re *core.RequestEvent) error {
			return handleContactSearch(app, re)
		}).BindFunc(requireAuth)

		return e.Next()
	})

	// Auto-generate vcard_uid for contacts created via the web UI
	app.OnRecordCreate("contacts").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("vcard_uid") == "" {
			e.Record.Set("vcard_uid", "urn:uuid:"+uuid.NewString())
		}
		return e.Next()
	})
}
