package coreserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/mailer"
)

// RegisterInviteLinkEndpoints wires the admin-facing endpoints that surface
// and manage invite links for pending memberships.
func RegisterInviteLinkEndpoints(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/invite-link/{userOrgId}", func(re *core.RequestEvent) error {
			return handleGetInviteLink(app, re)
		}).BindFunc(requireAuthCore)

		e.Router.POST("/api/invite-link/{userOrgId}/rotate", func(re *core.RequestEvent) error {
			return handleRotateInviteLink(app, re)
		}).BindFunc(requireAuthCore)

		e.Router.POST("/api/invite-link/{userOrgId}/send", func(re *core.RequestEvent) error {
			return handleSendInviteLink(app, re)
		}).BindFunc(requireAuthCore)

		return e.Next()
	})
}

// resolveUserOrgAsAdmin loads the user_org by ID and verifies the caller is an
// admin or owner of the same org. Returns the user_org record on success.
func resolveUserOrgAsAdmin(app core.App, re *core.RequestEvent) (*core.Record, error) {
	userOrgID := re.Request.PathValue("userOrgId")
	uo, err := app.FindRecordById("user_org", userOrgID)
	if err != nil || uo == nil {
		return nil, re.NotFoundError("membership not found", err)
	}
	authUser := re.Auth
	if authUser == nil {
		return nil, re.UnauthorizedError("Authentication required", nil)
	}
	admins, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:userId} && org = {:orgId} && (role = 'admin' || role = 'owner')",
		"", 1, 0,
		map[string]any{"userId": authUser.Id, "orgId": uo.GetString("org")},
	)
	if err != nil || len(admins) == 0 {
		return nil, re.ForbiddenError("You must be an admin or owner of this organization", nil)
	}
	return uo, nil
}

// liveTokenForUserOrg returns an unused, unexpired invite token for the
// user_org's user+org pair, or (nil, nil) if none exists. Rotation invalidates
// all prior tokens before minting a new one, so at most one live token exists
// at a time and ordering doesn't matter.
func liveTokenForUserOrg(app core.App, uo *core.Record) (*core.Record, error) {
	records, err := app.FindRecordsByFilter(
		"invite_tokens",
		"user = {:u} && org = {:o} && used_at = ''",
		"", 0, 0,
		map[string]any{"u": uo.GetString("user"), "o": uo.GetString("org")},
	)
	if err != nil {
		return nil, err
	}
	for _, r := range records {
		exp := r.GetDateTime("expires_at")
		if !exp.IsZero() && exp.Time().Before(time.Now()) {
			continue
		}
		return r, nil
	}
	return nil, nil
}

func handleGetInviteLink(app core.App, re *core.RequestEvent) error {
	uo, err := resolveUserOrgAsAdmin(app, re)
	if err != nil {
		return err
	}
	token, err := liveTokenForUserOrg(app, uo)
	if err != nil {
		return re.InternalServerError("Failed to look up invite token", err)
	}
	if token == nil {
		return re.JSON(http.StatusNotFound, map[string]any{"error": "no live invite link"})
	}
	return re.JSON(http.StatusOK, map[string]any{
		"inviteUrl": buildInviteURL(app, token.GetString("token")),
		"expiresAt": token.GetString("expires_at"),
	})
}

func handleRotateInviteLink(app core.App, re *core.RequestEvent) error {
	uo, err := resolveUserOrgAsAdmin(app, re)
	if err != nil {
		return err
	}
	userID := uo.GetString("user")
	orgID := uo.GetString("org")

	if err := invalidateExistingTokens(app, userID, orgID); err != nil {
		return re.InternalServerError("Failed to invalidate old tokens", err)
	}

	user, err := app.FindRecordById("users", userID)
	if err != nil {
		return re.InternalServerError("Failed to load user", err)
	}
	org, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		return re.InternalServerError("Failed to load org", err)
	}

	token, err := mintInviteToken(app, user, org, uo.GetString("role"))
	if err != nil {
		return re.InternalServerError("Failed to mint invite token", err)
	}

	return re.JSON(http.StatusOK, map[string]any{
		"inviteUrl": buildInviteURL(app, token),
	})
}

func handleSendInviteLink(app core.App, re *core.RequestEvent) error {
	uo, err := resolveUserOrgAsAdmin(app, re)
	if err != nil {
		return err
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSONBody(re, &body); err != nil {
		return re.BadRequestError("Invalid request body", err)
	}
	if err := validateAltEmail(body.Email); err != nil {
		return re.BadRequestError(err.Error(), err)
	}

	if IsDemoUser(app, re.Auth.Id) {
		return re.JSON(http.StatusServiceUnavailable, map[string]any{
			"error": "Email sending is disabled for demo accounts; copy the link manually.",
		})
	}

	token, err := liveTokenForUserOrg(app, uo)
	if err != nil {
		return re.InternalServerError("Failed to look up invite token", err)
	}
	if token == nil {
		return re.JSON(http.StatusConflict, map[string]any{
			"error": "no live invite link, rotate first",
		})
	}

	user, err := app.FindRecordById("users", uo.GetString("user"))
	if err != nil {
		return re.InternalServerError("Failed to load user", err)
	}
	org, err := app.FindRecordById("orgs", uo.GetString("org"))
	if err != nil {
		return re.InternalServerError("Failed to load org", err)
	}

	if err := sendInviteEmailTo(app, body.Email, user, org, uo.GetString("role"), token.GetString("token")); err != nil {
		return re.JSON(http.StatusBadGateway, map[string]any{
			"error": "failed to send invite email: " + err.Error(),
		})
	}

	return re.JSON(http.StatusOK, map[string]any{"delivered": true})
}

// validateAltEmail checks that an email looks like a real address before we
// hand it to the mailer.
func validateAltEmail(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return fmt.Errorf("email is required")
	}
	if _, err := mail.ParseAddress(s); err != nil {
		return fmt.Errorf("invalid email")
	}
	return nil
}

// decodeJSONBody is a small wrapper for parsing request bodies; callers map
// errors to BadRequestError.
func decodeJSONBody(re *core.RequestEvent, dst any) error {
	return json.NewDecoder(re.Request.Body).Decode(dst)
}

// sendInviteEmailTo builds the same invite email body sendNewInviteEmail uses,
// but addresses it to an arbitrary email instead of the user's account email.
func sendInviteEmailTo(app core.App, toEmail string, user *core.Record, org *core.Record, role, token string) error {
	link := buildInviteURL(app, token)

	orgName := org.GetString("name")
	userName := user.GetString("name")
	if userName == "" {
		userName = user.GetString("email")
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
		"%s,\n\nYou've been invited to join %s as a %s.\n\nSet your password: %s\n\nThe link expires in 7 days.\n",
		greeting(userName), orgName, role, link,
	)

	msg := &mailer.Message{
		To:      []mailer.Recipient{{Name: userName, Email: toEmail}},
		Subject: subject,
		HTML:    htmlBody,
		Text:    text,
	}
	return mailer.DefaultSender().Send(context.Background(), msg)
}
