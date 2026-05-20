package coreserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

var (
	setupToken   string
	setupTokenMu sync.Mutex
)

func RegisterSetupBootstrap(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// Replace PB's default installer with our own setup URL
		e.InstallerFunc = func(_ core.App, _ *core.Record, baseURL string) error {
			token, err := generateToken(32)
			if err != nil {
				return fmt.Errorf("setup bootstrap: failed to generate token: %w", err)
			}

			setupTokenMu.Lock()
			setupToken = token
			setupTokenMu.Unlock()

			// Prefer TINYCLD_PUBLIC_URL when set so the printed URL matches
			// where the user actually browses (dev: scripts/dev.ts proxy on
			// 7100; prod: whatever public URL fronts PB). PB's baseURL is
			// the bind address, which is wrong whenever a reverse proxy
			// sits in front of the server.
			publicURL := strings.TrimRight(os.Getenv("TINYCLD_PUBLIC_URL"), "/")
			if publicURL == "" {
				publicURL = strings.TrimRight(baseURL, "/")
			}
			setupURL := fmt.Sprintf("%s/setup?token=%s", publicURL, token)
			printBoxed("First run setup, visit below URL to configure tinycld:", setupURL)
			return nil
		}

		e.Router.GET("/api/setup/check", func(re *core.RequestEvent) error {
			setupTokenMu.Lock()
			hasToken := setupToken != ""
			setupTokenMu.Unlock()
			return re.JSON(http.StatusOK, map[string]bool{"needsSetup": hasToken})
		})

		e.Router.POST("/api/setup/init", func(re *core.RequestEvent) error {
			return handleSetupInit(app, re)
		})

		return e.Next()
	})
}

type setupInitRequest struct {
	Token   string `json:"token"`
	AppName string `json:"appName"`
	Email   string `json:"email"`
	Password string `json:"password"`
	AppURL  string `json:"appUrl"`
}

func handleSetupInit(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	setupTokenMu.Lock()
	currentToken := setupToken
	setupTokenMu.Unlock()

	if currentToken == "" {
		return re.JSON(http.StatusForbidden, map[string]string{
			"error": "Setup has already been completed.",
		})
	}

	var req setupInitRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&req); err != nil {
		return re.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body.",
		})
	}

	if req.Token != currentToken {
		return re.JSON(http.StatusForbidden, map[string]string{
			"error": "Invalid setup token.",
		})
	}

	if req.Email == "" || req.Password == "" {
		return re.JSON(http.StatusBadRequest, map[string]string{
			"error": "Email and password are required.",
		})
	}

	setupTokenMu.Lock()
	tokenStillValid := setupToken != ""
	setupTokenMu.Unlock()
	if !tokenStillValid {
		return re.JSON(http.StatusForbidden, map[string]string{
			"error": "Setup has already been completed.",
		})
	}

	collection, err := app.FindCollectionByNameOrId("_superusers")
	if err != nil {
		return re.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to find superusers collection.",
		})
	}

	record := core.NewRecord(collection)
	record.SetEmail(req.Email)
	record.SetPassword(req.Password)
	record.SetVerified(true)

	if err := app.Save(record); err != nil {
		return re.JSON(http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to create superuser: %v", err),
		})
	}

	if req.AppName != "" {
		app.Settings().Meta.AppName = req.AppName
	}
	if req.AppURL != "" {
		app.Settings().Meta.AppURL = req.AppURL
	}
	if req.AppName != "" || req.AppURL != "" {
		if err := app.Save(app.Settings()); err != nil {
			log.Printf("Setup bootstrap: failed to save settings: %v", err)
		}
	}

	// Clear the token — one-time use
	setupTokenMu.Lock()
	setupToken = ""
	setupTokenMu.Unlock()

	authToken, err := record.NewAuthToken()
	if err != nil {
		return re.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Superuser created but failed to generate auth token.",
		})
	}

	return re.JSON(http.StatusOK, map[string]string{
		"authToken": authToken,
		"email":     req.Email,
	})
}

func generateToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func printBoxed(title, url string) {
	w := len(url) + 4
	if titleW := len(title) + 4; titleW > w {
		w = titleW
	}
	h := strings.Repeat("─", w)

	pad := func(s string) string {
		gap := w - len(s) - 2
		return "│ " + s + strings.Repeat(" ", gap) + " │"
	}

	fmt.Printf("\n┌%s┐\n", h)
	fmt.Printf("%s\n", pad(title))
	fmt.Printf("│%s│\n", strings.Repeat(" ", w))
	fmt.Printf("%s\n", pad(url))
	fmt.Printf("└%s┘\n\n", h)
}
