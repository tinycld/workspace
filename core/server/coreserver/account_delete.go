package coreserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

type accountDeleteRequest struct {
	Email string `json:"email"`
}

const deletedEmailDomain = "@deleted.tinycld.org"

func RegisterAccountDelete(app *pocketbase.PocketBase) {
	registerAccountDeleteCore(app)
}

func registerAccountDeleteCore(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/account/delete", func(re *core.RequestEvent) error {
			return handleAccountDelete(app, re)
		}).BindFunc(requireAuthCore)
		return e.Next()
	})
}

func handleAccountDelete(app core.App, re *core.RequestEvent) error {
	authRecord := re.Auth
	if authRecord == nil || authRecord.Collection().Name != "users" {
		return re.UnauthorizedError("Authentication required", nil)
	}

	var req accountDeleteRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&req); err != nil {
		return re.BadRequestError("Invalid request body", err)
	}

	currentEmail := strings.ToLower(strings.TrimSpace(authRecord.GetString("email")))
	providedEmail := strings.ToLower(strings.TrimSpace(req.Email))
	if providedEmail == "" || providedEmail != currentEmail {
		return re.BadRequestError("email confirmation does not match", nil)
	}

	if err := app.RunInTransaction(func(txApp core.App) error {
		// 1. Remove this user's user_org rows so they disappear from org member
		//    lists and access-rules that key on user_org no longer match.
		memberships, err := txApp.FindRecordsByFilter(
			"user_org",
			"user = {:uid}",
			"-created",
			0, 0,
			map[string]any{"uid": authRecord.Id},
		)
		if err != nil {
			return fmt.Errorf("load user_org rows: %w", err)
		}
		for _, m := range memberships {
			if err := txApp.Delete(m); err != nil {
				return fmt.Errorf("delete user_org %s: %w", m.Id, err)
			}
		}

		// 2. Remove this user from every orgs.users multi-relation (if that
		//    field exists — it is an optional relation added by the schema).
		orgsCollection, collErr := txApp.FindCollectionByNameOrId("orgs")
		if collErr == nil && orgsCollection.Fields.GetByName("users") != nil {
			ownedOrgs, err := txApp.FindRecordsByFilter(
				"orgs",
				"users ~ {:uid}",
				"-created",
				0, 0,
				map[string]any{"uid": authRecord.Id},
			)
			if err != nil {
				return fmt.Errorf("load owning orgs: %w", err)
			}
			for _, org := range ownedOrgs {
				users := org.GetStringSlice("users")
				kept := make([]string, 0, len(users))
				for _, u := range users {
					if u != authRecord.Id {
						kept = append(kept, u)
					}
				}
				org.Set("users", kept)
				if err := txApp.Save(org); err != nil {
					return fmt.Errorf("update org %s users: %w", org.Id, err)
				}
			}
		}

		// 3. Overwrite PII on the user record and invalidate the session.
		sentinelEmail := fmt.Sprintf("deleted-%s%s", authRecord.Id, deletedEmailDomain)
		randomPwd, err := randomHex(32)
		if err != nil {
			return fmt.Errorf("generate random password: %w", err)
		}

		authRecord.SetEmail(sentinelEmail)
		authRecord.Set("name", "Deleted user")
		authRecord.Set("avatar", "")
		authRecord.SetVerified(false)
		authRecord.SetPassword(randomPwd)
		authRecord.RefreshTokenKey()

		if err := txApp.Save(authRecord); err != nil {
			return fmt.Errorf("save anonymized user: %w", err)
		}
		return nil
	}); err != nil {
		return re.InternalServerError("account delete failed", err)
	}

	return re.NoContent(204)
}

func randomHex(nBytes int) (string, error) {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
