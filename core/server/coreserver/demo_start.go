package coreserver

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Identifiers for the singleton demo identity. Both the email and the org
// slug are stable so the front door always lands on the same record set —
// repeated /api/demo/start hits sign the caller into the same playground.
const (
	demoUserEmail    = "demo@tinycld.org"
	demoUserUsername = "demo"
	demoUserName     = "Demo Tour"
	demoOrgName      = "Demo Workspace"
	demoOrgSlug      = "demo"
)

// RegisterDemoStart wires POST /api/demo/start. The endpoint is unauthenticated
// because it is the entry point a logged-out marketing-site visitor uses to
// land in the app without registering. It (1) finds-or-creates a single shared
// demo user flagged is_demo=true, (2) finds-or-creates a "demo" org with the
// user as a member, and (3) returns a PocketBase-shaped { token, record }
// auth response so the client can drop it straight into pb.authStore.
func RegisterDemoStart(app *pocketbase.PocketBase) {
	registerDemoStartCore(app)
}

func registerDemoStartCore(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/demo/start", func(re *core.RequestEvent) error {
			return handleDemoStart(app, re)
		})
		return e.Next()
	})
}

func handleDemoStart(app core.App, re *core.RequestEvent) error {
	var user *core.Record
	if err := app.RunInTransaction(func(txApp core.App) error {
		u, err := ensureDemoUser(txApp)
		if err != nil {
			return fmt.Errorf("ensure demo user: %w", err)
		}
		if err := ensureDemoOrgMembership(txApp, u); err != nil {
			return fmt.Errorf("ensure demo org: %w", err)
		}
		user = u
		return nil
	}); err != nil {
		return re.InternalServerError("demo start failed", err)
	}

	// Re-fetch outside the transaction so the response sees the committed
	// row state (apis.RecordAuthResponse-like semantics).
	live, err := app.FindRecordById("users", user.Id)
	if err != nil {
		return re.InternalServerError("demo start failed", err)
	}

	token, err := live.NewAuthToken()
	if err != nil {
		return re.InternalServerError("demo start failed", err)
	}

	// Mint the response by hand rather than via apis.RecordAuthResponse:
	// the demo flow is a controlled bypass and must never trigger MFA, auth
	// alerts, or auth-rule checks (the demo collection has them enabled in
	// production for human-credential auth, but they have no meaning here).
	// Shape mirrors PocketBase's standard auth response so the client can
	// import it directly into pb.authStore via authStore.save(token, record).
	return re.JSON(http.StatusOK, map[string]any{
		"token":  token,
		"record": live.PublicExport(),
	})
}

// ensureDemoUser returns the singleton demo user, creating one when absent.
// The is_demo flag is the linchpin: every outbound-effect chokepoint
// (mail send, invite emails, drive-share emails, push) consults
// IsDemoUser before writing to the wire, so demo sessions can exercise the
// full app surface without anything actually leaving the server.
func ensureDemoUser(app core.App) (*core.Record, error) {
	existing, err := app.FindFirstRecordByFilter(
		"users", "username = {:u}", dbx.Params{"u": demoUserUsername})
	if err == nil && existing != nil {
		return existing, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("look up demo user: %w", err)
	}

	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, fmt.Errorf("find users collection: %w", err)
	}

	rec := core.NewRecord(collection)
	rec.Set("username", demoUserUsername)
	rec.SetEmail(demoUserEmail)
	// Make the email visible in PublicExport so the auth response carries
	// it back to the client. The demo address is published on the marketing
	// site anyway — there is no privacy gain from hiding it on the user
	// record, and the front-end uses email to label the session.
	rec.Set("emailVisibility", true)
	rec.Set("name", demoUserName)
	rec.SetVerified(true)
	pwd, err := randomHex(32)
	if err != nil {
		return nil, fmt.Errorf("generate demo password: %w", err)
	}
	rec.SetPassword(pwd)
	rec.Set("is_demo", true)

	if err := app.Save(rec); err != nil {
		return nil, fmt.Errorf("save demo user: %w", err)
	}
	return rec, nil
}

// ensureDemoOrgMembership guarantees the demo user is a member (role=owner)
// of an org with slug "demo". The slug is stable because the front-end
// redirects to /a/{slug} after auth, so a moving target would break the
// post-auth landing.
func ensureDemoOrgMembership(app core.App, user *core.Record) error {
	org, err := app.FindFirstRecordByFilter("orgs", "slug = {:slug}", dbx.Params{"slug": demoOrgSlug})
	switch {
	case err == nil:
		users := org.GetStringSlice("users")
		if !contains(users, user.Id) {
			org.Set("users", append(users, user.Id))
			if err := app.Save(org); err != nil {
				return fmt.Errorf("update demo org users: %w", err)
			}
		}
	case errors.Is(err, sql.ErrNoRows):
		orgCol, err := app.FindCollectionByNameOrId("orgs")
		if err != nil {
			return fmt.Errorf("find orgs collection: %w", err)
		}
		org = core.NewRecord(orgCol)
		org.Set("name", demoOrgName)
		org.Set("slug", demoOrgSlug)
		org.Set("users", []string{user.Id})
		if err := app.Save(org); err != nil {
			return fmt.Errorf("save demo org: %w", err)
		}
	default:
		return fmt.Errorf("look up demo org: %w", err)
	}

	existing, err := app.FindFirstRecordByFilter(
		"user_org",
		"user = {:uid} && org = {:oid}",
		dbx.Params{"uid": user.Id, "oid": org.Id},
	)
	if err == nil && existing != nil {
		return nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("look up demo membership: %w", err)
	}

	userOrgCol, err := app.FindCollectionByNameOrId("user_org")
	if err != nil {
		return fmt.Errorf("find user_org collection: %w", err)
	}
	membership := core.NewRecord(userOrgCol)
	membership.Set("user", user.Id)
	membership.Set("org", org.Id)
	membership.Set("role", "owner")
	if err := app.Save(membership); err != nil {
		return fmt.Errorf("save demo user_org: %w", err)
	}
	return nil
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
