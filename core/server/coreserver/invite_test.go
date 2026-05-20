package coreserver

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

func TestInviteMember_NewUser_ReturnsInviteURLAndDoesNotEmail(t *testing.T) {
	read := captureMailerOutput(t)

	// Build app and seed data BEFORE registering the lifecycle hook so the
	// owner's own membership creation does not trigger an invite email.
	app := setupInviteTestApp(t)

	owner := mustCreateUser(t, app, "owner@test.local", false)
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")

	// Register endpoint + lifecycle only after seed data is in place.
	registerInviteEndpointCore(app)
	registerInviteLifecycleCore(app)

	token, err := owner.NewAuthToken()
	if err != nil {
		t.Fatalf("NewAuthToken: %v", err)
	}

	bodyBytes, _ := json.Marshal(map[string]string{
		"username": "newhire",
		"email":    "newhire@example.com",
		"role":     "member",
		"orgId":    org.Id,
	})

	scenario := &tests.ApiScenario{
		Name:            "new-user invite returns inviteUrl and skips email",
		Method:          http.MethodPost,
		URL:             "/api/invite-member",
		Body:            strings.NewReader(string(bodyBytes)),
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"userId":`},
		// The handler's response is synchronous, but the endpoint also spawns a
		// notify.NotifyUser goroutine. Without this delay the goroutine races
		// the test app teardown and panics on closed app state — do not remove
		// without first refactoring the notify call to run synchronously.
		Delay: 150 * time.Millisecond,
		TestAppFactory: func(_ testing.TB) *tests.TestApp {
			return app
		},
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			tt := t.(*testing.T)

			var body map[string]any
			if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
				tt.Fatalf("decode response body: %v", err)
			}

			url, _ := body["inviteUrl"].(string)
			if !regexp.MustCompile(`/accept-invite/[0-9a-f]{64}$`).MatchString(url) {
				tt.Errorf("inviteUrl: got %q, want .../accept-invite/<64-hex>", url)
			}

			sends := read()
			if len(sends) != 0 {
				tt.Errorf("expected no emails on new-user invite, got %d: %v", len(sends), sends)
			}
		},
	}

	scenario.Test(t)
}

func TestInviteMember_NewUser_ByUsername_NoEmail(t *testing.T) {
	app := setupInviteTestApp(t)
	read := captureMailerOutput(t)

	owner := mustCreateUser(t, app, "owner-by-uname@test.local", false)
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")

	registerInviteEndpointCore(app)
	registerInviteLifecycleCore(app)

	tok, err := tokenForUser(app, owner)
	if err != nil {
		t.Fatal(err)
	}

	bodyBytes, _ := json.Marshal(map[string]string{
		"username": "newhire",
		"role":     "member",
		"orgId":    org.Id,
	})

	scenario := &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/invite-member",
		Body:                  strings.NewReader(string(bodyBytes)),
		Headers:               map[string]string{"Authorization": tok},
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"userId":`},
		Delay:                 150 * time.Millisecond,
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			tt := t.(*testing.T)
			body := readJSONBody(tt, res)
			uid, _ := body["userId"].(string)

			rec, err := app.FindRecordById("users", uid)
			if err != nil {
				tt.Fatal(err)
			}
			if got := rec.GetString("username"); got != "newhire" {
				tt.Errorf("username = %q, want %q", got, "newhire")
			}
			if got := rec.GetString("email"); got != "" {
				tt.Errorf("email = %q, want empty (none provided)", got)
			}
			if sends := read(); len(sends) != 0 {
				tt.Errorf("expected no emails, got %d", len(sends))
			}
		},
	}
	scenario.Test(t)
}

func TestInviteMember_RejectsDuplicateUsername(t *testing.T) {
	app := setupInviteTestApp(t)

	owner := mustCreateUser(t, app, "owner-dup@test.local", false)
	// Existing verified member with username "newhire".
	existing := mustCreateUser(t, app, "newhire@x.com", false) // DeriveUsername → "newhire"
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")
	// Make existing user an active member so re-inviting by username returns 400.
	newMembership(t, app, existing, org, "member", owner.Id)

	registerInviteEndpointCore(app)
	registerInviteLifecycleCore(app)

	tok, err := tokenForUser(app, owner)
	if err != nil {
		t.Fatal(err)
	}

	bodyBytes, _ := json.Marshal(map[string]string{
		"username": "newhire",
		"role":     "member",
		"orgId":    org.Id,
	})

	scenario := &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/invite-member",
		Body:                  strings.NewReader(string(bodyBytes)),
		Headers:               map[string]string{"Authorization": tok},
		ExpectedStatus:        http.StatusBadRequest,
		ExpectedContent:       []string{"already a member"},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

func TestInviteMember_RejectsMissingUsername(t *testing.T) {
	app := setupInviteTestApp(t)
	owner := mustCreateUser(t, app, "owner-missing@test.local", false)
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")

	registerInviteEndpointCore(app)
	registerInviteLifecycleCore(app)

	tok, err := tokenForUser(app, owner)
	if err != nil {
		t.Fatal(err)
	}

	bodyBytes, _ := json.Marshal(map[string]string{
		"role":  "member",
		"orgId": org.Id,
	})

	scenario := &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/invite-member",
		Body:                  strings.NewReader(string(bodyBytes)),
		Headers:               map[string]string{"Authorization": tok},
		ExpectedStatus:        http.StatusBadRequest,
		ExpectedContent:       []string{"required"},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}
