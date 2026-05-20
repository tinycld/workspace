package coreserver

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

const (
	demoLeadReasonMaxLen = 2000

	demoLeadSourceIntroModal = "intro_modal"
	demoLeadSourceBannerLink = "banner_link"
)

// RegisterDemoLead wires POST /api/demo/lead. The endpoint is unauthenticated
// because the demo welcome modal fires it from the shared demo identity (or
// before login completes); we trust the body's email field at face value
// because spam triage is handled out-of-band, not at write time. Returns
// 204 on success, 400 on a malformed/missing email.
func RegisterDemoLead(app *pocketbase.PocketBase) {
	registerDemoLeadCore(app)
}

func registerDemoLeadCore(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/demo/lead", func(re *core.RequestEvent) error {
			return handleDemoLead(app, re)
		})
		return e.Next()
	})
}

type demoLeadRequest struct {
	Email  string `json:"email"`
	Reason string `json:"reason"`
	Source string `json:"source"`
}

func handleDemoLead(app core.App, re *core.RequestEvent) error {
	var body demoLeadRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid body", err)
	}

	email := strings.TrimSpace(body.Email)
	if email == "" {
		return re.BadRequestError("email required", nil)
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return re.BadRequestError("invalid email", err)
	}

	reason := body.Reason
	if len(reason) > demoLeadReasonMaxLen {
		reason = reason[:demoLeadReasonMaxLen]
	}

	source := body.Source
	if source != demoLeadSourceIntroModal && source != demoLeadSourceBannerLink {
		source = demoLeadSourceIntroModal
	}

	collection, err := app.FindCollectionByNameOrId("demo_leads")
	if err != nil {
		return re.InternalServerError("demo lead store unavailable", err)
	}

	rec := core.NewRecord(collection)
	rec.Set("email", email)
	rec.Set("reason", reason)
	rec.Set("source", source)
	rec.Set("user_agent", re.Request.UserAgent())
	rec.Set("ip", re.RealIP())

	if err := app.Save(rec); err != nil {
		return re.InternalServerError("save demo lead", err)
	}

	re.Response.WriteHeader(http.StatusNoContent)
	return nil
}
