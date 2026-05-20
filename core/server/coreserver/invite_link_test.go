package coreserver

import (
    "net/http"
    "regexp"
    "strings"
    "testing"
    "time"

    "github.com/pocketbase/pocketbase/tests"
)

func TestInviteLink_Get_ReturnsLiveURL(t *testing.T) {
    app := setupInviteTestApp(t)

    owner := mustCreateUser(t, app, "owner@test.local", false)
    target := mustCreateUser(t, app, "pending@test.local", false)
    target.SetVerified(false)
    if err := app.Save(target); err != nil {
        t.Fatal(err)
    }
    org := mustCreateOrg(t, app)
    // owner needs an admin/owner user_org row
    newMembership(t, app, owner, org, "owner", "")
    uo := newMembership(t, app, target, org, "member", owner.Id)

    if _, err := mintInviteToken(app, target, org, "member"); err != nil {
        t.Fatal(err)
    }

    // Register the endpoint on the test app before running the scenario.
    RegisterInviteLinkEndpoints(app)

    authToken, err := tokenForUser(app, owner)
    if err != nil {
        t.Fatal(err)
    }

    scenario := &tests.ApiScenario{
        Name:            "GET invite-link returns live URL",
        Method:          http.MethodGet,
        URL:             "/api/invite-link/" + uo.Id,
        Headers:         map[string]string{"Authorization": authToken},
        ExpectedStatus:  http.StatusOK,
        ExpectedContent: []string{`"inviteUrl":`},
        TestAppFactory: func(_ testing.TB) *tests.TestApp {
            return app
        },
        DisableTestAppCleanup: true,
        AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
            tt := t.(*testing.T)
            body := readJSONBody(tt, res)
            url, _ := body["inviteUrl"].(string)
            if !regexp.MustCompile(`/accept-invite/[0-9a-f]{64}$`).MatchString(url) {
                tt.Errorf("inviteUrl: got %q, want .../accept-invite/<64-hex>", url)
            }
        },
    }
    scenario.Test(t)
}

func TestInviteLink_Get_404WhenNoLiveToken(t *testing.T) {
    app := setupInviteTestApp(t)
    RegisterInviteLinkEndpoints(app)

    owner := mustCreateUser(t, app, "owner@test.local", false)
    target := mustCreateUser(t, app, "pending@test.local", false)
    org := mustCreateOrg(t, app)
    newMembership(t, app, owner, org, "owner", "")
    uo := newMembership(t, app, target, org, "member", owner.Id)

    // No tokens minted.

    authToken, err := tokenForUser(app, owner)
    if err != nil {
        t.Fatal(err)
    }

    scenario := &tests.ApiScenario{
        Name:                  "GET invite-link 404 when no token",
        Method:                http.MethodGet,
        URL:                   "/api/invite-link/" + uo.Id,
        Headers:               map[string]string{"Authorization": authToken},
        ExpectedStatus:        http.StatusNotFound,
        ExpectedContent:       []string{`"error":`},
        TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
        DisableTestAppCleanup: true,
    }
    scenario.Test(t)
}

func TestInviteLink_Get_404WhenAllTokensExpired(t *testing.T) {
    app := setupInviteTestApp(t)
    RegisterInviteLinkEndpoints(app)

    owner := mustCreateUser(t, app, "owner@test.local", false)
    target := mustCreateUser(t, app, "pending@test.local", false)
    org := mustCreateOrg(t, app)
    newMembership(t, app, owner, org, "owner", "")
    uo := newMembership(t, app, target, org, "member", owner.Id)

    if _, err := mintInviteToken(app, target, org, "member"); err != nil {
        t.Fatal(err)
    }
    tokens, _ := app.FindRecordsByFilter("invite_tokens", "user = {:u}", "", 1, 0,
        map[string]any{"u": target.Id})
    tokens[0].Set("expires_at", time.Now().Add(-1*time.Hour).UTC().Format(time.RFC3339))
    if err := app.Save(tokens[0]); err != nil {
        t.Fatal(err)
    }

    authToken, err := tokenForUser(app, owner)
    if err != nil {
        t.Fatal(err)
    }

    scenario := &tests.ApiScenario{
        Name:                  "GET invite-link 404 when all tokens expired",
        Method:                http.MethodGet,
        URL:                   "/api/invite-link/" + uo.Id,
        Headers:               map[string]string{"Authorization": authToken},
        ExpectedStatus:        http.StatusNotFound,
        ExpectedContent:       []string{`"error":`},
        TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
        DisableTestAppCleanup: true,
    }
    scenario.Test(t)
}

func TestInviteLink_Get_403WhenCallerIsMember(t *testing.T) {
    app := setupInviteTestApp(t)
    RegisterInviteLinkEndpoints(app)

    plainMember := mustCreateUser(t, app, "member@test.local", false)
    target := mustCreateUser(t, app, "pending@test.local", false)
    org := mustCreateOrg(t, app)
    newMembership(t, app, plainMember, org, "member", "") // not admin/owner
    uo := newMembership(t, app, target, org, "member", plainMember.Id)

    if _, err := mintInviteToken(app, target, org, "member"); err != nil {
        t.Fatal(err)
    }

    authToken, err := tokenForUser(app, plainMember)
    if err != nil {
        t.Fatal(err)
    }

    scenario := &tests.ApiScenario{
        Name:                  "GET invite-link 403 for non-admin",
        Method:                http.MethodGet,
        URL:                   "/api/invite-link/" + uo.Id,
        Headers:               map[string]string{"Authorization": authToken},
        ExpectedStatus:        http.StatusForbidden,
        ExpectedContent:       []string{`"message"`},
        TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
        DisableTestAppCleanup: true,
    }
    scenario.Test(t)
}

func TestInviteLink_Send_DeliversToAltEmailNotAccountEmail(t *testing.T) {
	app := setupInviteTestApp(t)
	RegisterInviteLinkEndpoints(app)
	read := captureMailerOutput(t)

	owner := mustCreateUser(t, app, "owner@test.local", false)
	target := mustCreateUser(t, app, "pending@example.com", false) // dead inbox
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")
	uo := newMembership(t, app, target, org, "member", owner.Id)
	if _, err := mintInviteToken(app, target, org, "member"); err != nil {
		t.Fatal(err)
	}

	authToken, err := tokenForUser(app, owner)
	if err != nil {
		t.Fatal(err)
	}

	scenario := &tests.ApiScenario{
		Name:                  "POST send delivers to alt email",
		Method:                http.MethodPost,
		URL:                   "/api/invite-link/" + uo.Id + "/send",
		Body:                  strings.NewReader(`{"email":"alt@known-good.example"}`),
		Headers:               map[string]string{"Authorization": authToken, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"delivered":`},
		Delay:                 50 * time.Millisecond,
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			tt := t.(*testing.T)
			sends := read()
			if len(sends) != 1 {
				tt.Fatalf("expected 1 send, got %d: %v", len(sends), sends)
			}
			to, _ := sends[0]["to"].([]any)
			if len(to) == 0 {
				tt.Fatalf("send had no recipients: %v", sends[0])
			}
			first, _ := to[0].(map[string]any)
			got, _ := first["email"].(string)
			if got != "alt@known-good.example" {
				tt.Errorf("recipient: got %q, want %q", got, "alt@known-good.example")
			}
			if got == "pending@example.com" {
				tt.Fatalf("send leaked to account email — that's the bug we're fixing")
			}
		},
	}
	scenario.Test(t)
}

func TestInviteLink_Send_400OnInvalidEmail(t *testing.T) {
	app := setupInviteTestApp(t)
	RegisterInviteLinkEndpoints(app)

	owner := mustCreateUser(t, app, "owner@test.local", false)
	target := mustCreateUser(t, app, "pending@example.com", false)
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")
	uo := newMembership(t, app, target, org, "member", owner.Id)
	if _, err := mintInviteToken(app, target, org, "member"); err != nil {
		t.Fatal(err)
	}

	authToken, err := tokenForUser(app, owner)
	if err != nil {
		t.Fatal(err)
	}

	cases := []string{`{"email":""}`, `{"email":"not-an-email"}`, `{}`}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			scenario := &tests.ApiScenario{
				Name:                  "POST send 400 on invalid email: " + body,
				Method:                http.MethodPost,
				URL:                   "/api/invite-link/" + uo.Id + "/send",
				Body:                  strings.NewReader(body),
				Headers:               map[string]string{"Authorization": authToken, "Content-Type": "application/json"},
				ExpectedStatus:        http.StatusBadRequest,
				ExpectedContent:       []string{`"message":`},
				TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
				DisableTestAppCleanup: true,
			}
			scenario.Test(t)
		})
	}
}

func TestInviteLink_Send_409WhenNoLiveToken(t *testing.T) {
	app := setupInviteTestApp(t)
	RegisterInviteLinkEndpoints(app)

	owner := mustCreateUser(t, app, "owner@test.local", false)
	target := mustCreateUser(t, app, "pending@example.com", false)
	org := mustCreateOrg(t, app)
	newMembership(t, app, owner, org, "owner", "")
	uo := newMembership(t, app, target, org, "member", owner.Id)
	// No tokens minted.

	authToken, err := tokenForUser(app, owner)
	if err != nil {
		t.Fatal(err)
	}

	scenario := &tests.ApiScenario{
		Name:                  "POST send 409 when no live token",
		Method:                http.MethodPost,
		URL:                   "/api/invite-link/" + uo.Id + "/send",
		Body:                  strings.NewReader(`{"email":"alt@known-good.example"}`),
		Headers:               map[string]string{"Authorization": authToken, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusConflict,
		ExpectedContent:       []string{`"error":`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

func TestInviteLink_Send_503ForDemoCaller(t *testing.T) {
	app := setupInviteTestApp(t)
	RegisterInviteLinkEndpoints(app)
	read := captureMailerOutput(t)

	demoOwner := mustCreateUser(t, app, "demoowner@test.local", true) // is_demo=true
	target := mustCreateUser(t, app, "pending@example.com", false)
	org := mustCreateOrg(t, app)
	newMembership(t, app, demoOwner, org, "owner", "")
	uo := newMembership(t, app, target, org, "member", demoOwner.Id)
	if _, err := mintInviteToken(app, target, org, "member"); err != nil {
		t.Fatal(err)
	}

	authToken, err := tokenForUser(app, demoOwner)
	if err != nil {
		t.Fatal(err)
	}

	scenario := &tests.ApiScenario{
		Name:                  "POST send 503 for demo caller",
		Method:                http.MethodPost,
		URL:                   "/api/invite-link/" + uo.Id + "/send",
		Body:                  strings.NewReader(`{"email":"alt@known-good.example"}`),
		Headers:               map[string]string{"Authorization": authToken, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusServiceUnavailable,
		ExpectedContent:       []string{`"error":`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			tt := t.(*testing.T)
			if entries := read(); len(entries) != 0 {
				tt.Errorf("demo caller send must not write to mailer; got %d entries", len(entries))
			}
		},
	}
	scenario.Test(t)
}

func TestInviteLink_Rotate_ReturnsNewURLAndInvalidatesOld(t *testing.T) {
    app := setupInviteTestApp(t)
    RegisterInviteLinkEndpoints(app)

    owner := mustCreateUser(t, app, "owner@test.local", false)
    target := mustCreateUser(t, app, "pending@test.local", false)
    org := mustCreateOrg(t, app)
    newMembership(t, app, owner, org, "owner", "")
    uo := newMembership(t, app, target, org, "member", owner.Id)

    oldToken, err := mintInviteToken(app, target, org, "member")
    if err != nil {
        t.Fatal(err)
    }

    authToken, err := tokenForUser(app, owner)
    if err != nil {
        t.Fatal(err)
    }

    scenario := &tests.ApiScenario{
        Name:                  "POST invite-link/rotate returns new URL",
        Method:                http.MethodPost,
        URL:                   "/api/invite-link/" + uo.Id + "/rotate",
        Headers:               map[string]string{"Authorization": authToken},
        ExpectedStatus:        http.StatusOK,
        ExpectedContent:       []string{`"inviteUrl":`},
        TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
        DisableTestAppCleanup: true,
        AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
            tt := t.(*testing.T)
            body := readJSONBody(tt, res)
            url, _ := body["inviteUrl"].(string)
            if strings.Contains(url, oldToken) {
                tt.Errorf("rotate returned old token; url=%q oldToken=%q", url, oldToken)
            }
            if !regexp.MustCompile(`/accept-invite/[0-9a-f]{64}$`).MatchString(url) {
                tt.Errorf("inviteUrl: got %q, want .../accept-invite/<64-hex>", url)
            }

            old, err := app.FindFirstRecordByFilter(
                "invite_tokens", "token = {:t}", map[string]any{"t": oldToken},
            )
            if err != nil {
                tt.Fatal(err)
            }
            if old.GetString("used_at") == "" {
                tt.Errorf("expected old token to have used_at set")
            }
        },
    }
    scenario.Test(t)
}
