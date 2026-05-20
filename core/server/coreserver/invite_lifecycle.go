package coreserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	htmltpl "html"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/mailer"
)

const (
	inviteTokenTTL  = 7 * 24 * time.Hour
	inviteTokenSize = 32 // bytes; hex-encoded to 64 chars
	brandColor      = "#0d9488"
)

// RegisterInviteLifecycle wires a hook that emails invited users after
// a user_org membership row is created. For brand-new users (verified=false),
// it mints an invite_tokens row and emails a password-set link. For existing
// users, it emails a simple "you've been added" notice linking to the org.
func RegisterInviteLifecycle(app *pocketbase.PocketBase) {
	registerInviteLifecycleCore(app)
}

func registerInviteLifecycleCore(app core.App) {
	app.OnRecordAfterCreateSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		userOrg := e.Record
		go handleUserOrgInvite(app, userOrg)
		return e.Next()
	})
}

func handleUserOrgInvite(app core.App, userOrg *core.Record) {
	userID := userOrg.GetString("user")
	orgID := userOrg.GetString("org")
	role := userOrg.GetString("role")
	inviterID := userOrg.GetString("created_by")

	user, err := app.FindRecordById("users", userID)
	if err != nil {
		app.Logger().Warn("invite lifecycle: failed to find user",
			"userID", userID, "error", err)
		return
	}
	org, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		app.Logger().Warn("invite lifecycle: failed to find org",
			"orgID", orgID, "error", err)
		return
	}

	// Demo inviters: skip the outbound email but still mint the token so the
	// invited record exists and the demo flow looks complete from the UI.
	suppressEmail := IsDemoUser(app, inviterID)

	if user.GetBool("verified") {
		if !suppressEmail {
			sendExistingMemberEmail(app, user, org, role)
		}
		return
	}

	// Brand-new (unverified) users are handled by the admin-delivered invite flow:
	// POST /api/invite-member mints the token and returns the URL in its response.
	// The admin shares it manually, or via POST /api/invite-link/:userOrgId/send.
	// This hook used to also mint a token + email here; both responsibilities now
	// belong to the endpoint.
}

// invalidateExistingTokens marks all unused invite tokens for a user+org as used.
func invalidateExistingTokens(app core.App, userID, orgID string) error {
	tokens, err := app.FindRecordsByFilter(
		"invite_tokens",
		"user = {:userId} && org = {:orgId} && used_at = ''",
		"",
		0,
		0,
		map[string]any{"userId": userID, "orgId": orgID},
	)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, t := range tokens {
		t.Set("used_at", now)
		if err := app.Save(t); err != nil {
			return err
		}
	}
	return nil
}

func mintInviteToken(app core.App, user *core.Record, org *core.Record, role string) (string, error) {
	tokenBytes := make([]byte, inviteTokenSize)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)

	col, err := app.FindCollectionByNameOrId("invite_tokens")
	if err != nil {
		return "", fmt.Errorf("find invite_tokens collection: %w", err)
	}

	record := core.NewRecord(col)
	record.Set("token", token)
	record.Set("user", user.Id)
	record.Set("org", org.Id)
	record.Set("role", role)
	record.Set("expires_at", time.Now().Add(inviteTokenTTL).UTC().Format(time.RFC3339))

	if err := app.Save(record); err != nil {
		return "", fmt.Errorf("save invite token: %w", err)
	}
	return token, nil
}

func sendNewInviteEmail(app core.App, user *core.Record, org *core.Record, role, token string) {
	appURL := strings.TrimRight(app.Settings().Meta.AppURL, "/")
	link := fmt.Sprintf("%s/accept-invite/%s", appURL, token)

	orgName := org.GetString("name")
	userEmail := user.GetString("email")
	userName := user.GetString("name")
	if userName == "" {
		userName = userEmail
	}

	subject := fmt.Sprintf("You've been invited to %s", orgName)
	htmlBody := buildInviteEmailHTML(inviteEmailData{
		Greeting:   greeting(userName),
		OrgName:    orgName,
		Role:       role,
		CTALabel:   "Set your password",
		CTALink:    link,
		Intro:      fmt.Sprintf("You've been invited to join <strong>%s</strong> as a <strong>%s</strong>. To get started, set a password for your account.", htmlEscape(orgName), htmlEscape(role)),
		Footer:     "If you weren't expecting this invitation, you can safely ignore this email. The link expires in 7 days.",
		CopyPrompt: "Or copy this link into your browser:",
	})
	text := fmt.Sprintf(
		"%s,\n\nYou've been invited to join %s as a %s.\n\nSet your password: %s\n\nThe link expires in 7 days. If you weren't expecting this invitation, you can safely ignore this email.\n",
		greeting(userName), orgName, role, link,
	)

	send(app, userName, userEmail, subject, htmlBody, text)
}

func sendExistingMemberEmail(app core.App, user *core.Record, org *core.Record, role string) {
	appURL := strings.TrimRight(app.Settings().Meta.AppURL, "/")
	slug := org.GetString("slug")
	link := fmt.Sprintf("%s/a/%s", appURL, slug)

	orgName := org.GetString("name")
	userEmail := user.GetString("email")
	userName := user.GetString("name")
	if userName == "" {
		userName = userEmail
	}

	subject := fmt.Sprintf("You've been added to %s", orgName)
	htmlBody := buildInviteEmailHTML(inviteEmailData{
		Greeting:   greeting(userName),
		OrgName:    orgName,
		Role:       role,
		CTALabel:   fmt.Sprintf("Open %s", orgName),
		CTALink:    link,
		Intro:      fmt.Sprintf("You've been added to <strong>%s</strong> as a <strong>%s</strong>. Sign in with your existing account to get started.", htmlEscape(orgName), htmlEscape(role)),
		Footer:     "If you didn't expect to join this organization, please contact your admin.",
		CopyPrompt: "Or copy this link into your browser:",
	})
	text := fmt.Sprintf(
		"%s,\n\nYou've been added to %s as a %s. Sign in with your existing account to get started.\n\n%s\n",
		greeting(userName), orgName, role, link,
	)

	send(app, userName, userEmail, subject, htmlBody, text)
}

func send(app core.App, toName, toEmail, subject, htmlBody, textBody string) {
	msg := &mailer.Message{
		To:      []mailer.Recipient{{Name: toName, Email: toEmail}},
		Subject: subject,
		HTML:    htmlBody,
		Text:    textBody,
	}
	if err := mailer.DefaultSender().Send(context.Background(), msg); err != nil {
		app.Logger().Error("invite lifecycle: failed to send email",
			"to", toEmail, "subject", subject, "error", err)
	}
}

func greeting(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Hi"
	}
	return "Hi " + name
}

func htmlEscape(s string) string {
	return htmltpl.EscapeString(s)
}

type inviteEmailData struct {
	Greeting   string
	OrgName    string
	Role       string
	Intro      string
	CTALabel   string
	CTALink    string
	CopyPrompt string
	Footer     string
}

func buildInviteEmailHTML(d inviteEmailData) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>%s</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%%;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 16px 40px;border-top:4px solid %s;">
              <p style="margin:0 0 8px 0;font-size:14px;color:#78716c;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">Invitation to %s</p>
              <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:600;color:#1c1917;">%s,</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 8px 40px;">
              <p style="margin:0;font-size:16px;line-height:1.6;color:#44403c;">%s</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <a href="%s" style="display:inline-block;padding:12px 24px;background:%s;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">%s</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 32px 40px;">
              <p style="margin:16px 0 4px 0;font-size:13px;color:#78716c;">%s</p>
              <p style="margin:0;font-size:13px;color:#44403c;word-break:break-all;"><a href="%s" style="color:%s;text-decoration:none;">%s</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #e7e5e4;background:#fafaf9;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#78716c;">%s</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
		htmlEscape(d.OrgName),
		brandColor,
		htmlEscape(d.OrgName),
		htmlEscape(d.Greeting),
		d.Intro,
		htmlEscape(d.CTALink),
		brandColor,
		htmlEscape(d.CTALabel),
		htmlEscape(d.CopyPrompt),
		htmlEscape(d.CTALink),
		brandColor,
		htmlEscape(d.CTALink),
		htmlEscape(d.Footer),
	)
}
