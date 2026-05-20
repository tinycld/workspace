package coreserver

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Defaults for the nightly demo reset job. Override via env vars at runtime —
// production sets DEMO_RESET_ENABLED=1 in the container; dev environments
// leave it unset so the job is dormant on developer machines.
const (
	defaultDemoResetSchedule = "0 4 * * *"   // 04:00 server time, daily
	demoResetJobID           = "demoReset"
	demoResetTimeout         = 15 * time.Minute
)

// resetMu prevents overlapping runs if a previous reset is still in flight
// when the next tick fires. The reset re-runs every package's seed, which
// can take a couple minutes on a populated workspace, so a missed firing is
// acceptable; concurrent runs are not.
var resetMu sync.Mutex

// resetURL is the base URL the reset script should connect to. Captured at
// OnServe time because the script runs in a child process with no view of
// what address PB actually bound. Empty until the server starts; the cron
// won't fire before then in practice.
var (
	resetURLMu sync.RWMutex
	resetURL   string
)

// RegisterDemoReset wires a nightly cron job that wipes and re-seeds the
// singleton demo workspace. The job shells out to scripts/reset-demo.ts via
// bun, which already lives in the runtime image and has all node_modules and
// generated package wiring available.
//
// The job is opt-in: it only registers when DEMO_RESET_ENABLED is set to a
// truthy value ("1", "true"). The schedule defaults to 04:00 UTC daily and
// can be overridden with DEMO_RESET_SCHEDULE (standard 5-field cron).
func RegisterDemoReset(app *pocketbase.PocketBase) {
	if !demoResetEnabled() {
		return
	}

	schedule := os.Getenv("DEMO_RESET_SCHEDULE")
	if schedule == "" {
		schedule = defaultDemoResetSchedule
	}

	app.Cron().MustAdd(demoResetJobID, schedule, func() {
		runDemoReset(app)
	})

	// Capture the bound address once the server is serving. With autocert
	// (CertManager non-nil) we cannot reach the listener by IP because the
	// cert is issued for the configured domains; use the first SERVE_ON_DOMAINS
	// entry over HTTPS instead. Without autocert PB binds a plain HTTP
	// listener (default 127.0.0.1:7090) that we can hit directly.
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		url := deriveResetURL(e)
		resetURLMu.Lock()
		resetURL = url
		resetURLMu.Unlock()
		app.Logger().Info("demo reset target captured", "url", url)
		return e.Next()
	})

	app.Logger().Info("demo reset cron registered", "schedule", schedule)
}

func deriveResetURL(e *core.ServeEvent) string {
	if e.CertManager != nil {
		domains := DomainArgs()
		if len(domains) > 0 {
			return "https://" + domains[0]
		}
	}
	addr := e.Server.Addr
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// addr like ":7090" — split returns "" for host, which won't connect.
		return "http://127.0.0.1" + addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func demoResetEnabled() bool {
	v := os.Getenv("DEMO_RESET_ENABLED")
	return v == "1" || v == "true" || v == "TRUE"
}

func runDemoReset(app *pocketbase.PocketBase) {
	if !resetMu.TryLock() {
		app.Logger().Warn("demo reset skipped: previous run still in flight")
		return
	}
	defer resetMu.Unlock()

	scriptDir := resolveAppDir()
	ctx, cancel := context.WithTimeout(context.Background(), demoResetTimeout)
	defer cancel()

	resetURLMu.RLock()
	url := resetURL
	resetURLMu.RUnlock()
	if url == "" {
		app.Logger().Error("demo reset skipped: server not yet serving (resetURL empty)")
		return
	}

	cmd := exec.CommandContext(ctx, "bun", "run", "scripts/reset-demo.ts", "--url", url)
	cmd.Dir = scriptDir
	// Pass through env so ADMIN_USER_LOGIN / ADMIN_USER_PW configured for the
	// container reach the script. The bound URL is passed via --url because
	// the script's localhost default doesn't match autocert deployments
	// (which bind 80/443 instead of 127.0.0.1:7090).
	cmd.Env = os.Environ()

	app.Logger().Info("demo reset starting", "dir", scriptDir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		app.Logger().Error("demo reset failed", "err", err, "output", string(out))
		return
	}
	app.Logger().Info("demo reset succeeded", "output", string(out))
}

// resolveAppDir returns the directory that contains scripts/, package.json,
// and node_modules/. In the production container this is /app (next to the
// binary); during local dev the binary is built inside server/, so we walk
// up one level.
func resolveAppDir() string {
	ex, err := os.Executable()
	if err != nil {
		return "."
	}
	binDir := filepath.Dir(ex)
	if _, err := os.Stat(filepath.Join(binDir, "scripts", "reset-demo.ts")); err == nil {
		return binDir
	}
	parent := filepath.Dir(binDir)
	if _, err := os.Stat(filepath.Join(parent, "scripts", "reset-demo.ts")); err == nil {
		return parent
	}
	return binDir
}
