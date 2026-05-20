package coreserver

import (
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func RegisterHealthEndpoint(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/health", func(re *core.RequestEvent) error {
			return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
		})
		return e.Next()
	})
}
