package coreserver

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// RegisterSentry initializes the Sentry client and binds router middleware
// that captures returned handler errors, panics, and any 5xx response that
// reaches the client without producing an error value (e.g. handlers that
// write directly to ResponseWriter, like the go-webdav CalDAV library).
//
// Must run before any OnServe handlers register routes — middleware bound
// after a route is added does not apply to it. Register() calls this first.
//
// When SENTRY_DSN is empty the SDK still functions but events are dropped,
// so the middleware is a no-op in dev. The panic recovery still re-panics
// regardless, so PB's normal 500 response path is unaffected.
func RegisterSentry(app *pocketbase.PocketBase) {
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:              os.Getenv("SENTRY_DSN"),
		Environment:      GetEnvironment(),
		TracesSampleRate: 0.2,
		AttachStacktrace: true,
	}); err != nil {
		log.Printf("Sentry initialization failed: %v", err)
	}

	registerSentryMiddlewareCore(app)
}

// registerSentryMiddlewareCore binds the per-request capture logic. Split
// from RegisterSentry so tests can drive it against tests.TestApp (core.App)
// without invoking the global Init.
func registerSentryMiddlewareCore(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.BindFunc(sentryMiddleware)
		return e.Next()
	})
}

// sentrySkipPaths are request paths fully excluded from Sentry — no
// breadcrumbs and no error/5xx capture. Liveness and health probes hit
// often enough that a flapping dependency or a mid-rollout deploy would
// drown real signal otherwise. PB serves /api/health by default; other
// probe paths can be added at test time.
var sentrySkipPaths = map[string]bool{
	"/api/health": true,
}

func sentryMiddleware(re *core.RequestEvent) error {
	path := re.Request.URL.Path
	if sentrySkipPaths[path] {
		return re.Next()
	}

	hub := sentry.CurrentHub().Clone()
	ctx := sentry.SetHubOnContext(re.Request.Context(), hub)
	re.Request = re.Request.WithContext(ctx)

	method := re.Request.Method

	hub.Scope().SetTag("http.method", method)
	hub.Scope().SetTag("http.route", path)
	if re.Auth != nil {
		hub.Scope().SetUser(sentry.User{ID: re.Auth.Id})
	}

	sniff := &errorBodySniffer{ResponseWriter: re.Response}
	re.Response = sniff

	defer func() {
		if r := recover(); r != nil {
			hub.RecoverWithContext(ctx, r)
			hub.Flush(2 * time.Second)
			panic(r)
		}
	}()

	err := re.Next()

	status := re.Status()

	hub.AddBreadcrumb(&sentry.Breadcrumb{
		Type:     "http",
		Category: "request",
		Data: map[string]any{
			"method": method,
			"path":   path,
			"status": status,
		},
		Level: sentry.LevelInfo,
	}, nil)

	if err != nil {
		var apiErr *router.ApiError
		if errors.As(err, &apiErr) && apiErr.Status < 500 {
			return err
		}
		captureErr := err
		if apiErr != nil {
			if raw, ok := apiErr.RawData().(error); ok {
				captureErr = raw
			}
		}
		hub.CaptureException(captureErr)
		return err
	}

	if status >= 500 {
		hub.WithScope(func(scope *sentry.Scope) {
			scope.SetLevel(sentry.LevelError)
			scope.SetTag("http.status", fmt.Sprintf("%d", status))
			if body := sniff.Body(); body != "" {
				scope.SetContext("response", map[string]any{"body": body})
			}
			hub.CaptureMessage(fmt.Sprintf("HTTP %d %s %s", status, method, path))
		})
	}

	return nil
}

// errorBodySniffer wraps an http.ResponseWriter to capture the first chunk
// of the response body when status is >= 500. Handlers that call
// http.Error or write a short text/plain message directly to the writer
// (the go-webdav CalDAV path is one) bypass PB's error mapping, so the
// only signal a router-level middleware can attach to is the body itself.
//
// We only retain the body when status >= 500 — error responses are short,
// and capturing successful responses would waste memory and risk PII.
//
// All Write/WriteHeader calls pass through to the underlying writer
// unchanged; this is purely an observer.
type errorBodySniffer struct {
	http.ResponseWriter
	status  int
	capture bool
	buf     strings.Builder
}

const errorBodyCaptureLimit = 4096

func (w *errorBodySniffer) WriteHeader(code int) {
	w.status = code
	w.capture = code >= 500
	w.ResponseWriter.WriteHeader(code)
}

func (w *errorBodySniffer) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	if w.capture && w.buf.Len() < errorBodyCaptureLimit {
		remaining := errorBodyCaptureLimit - w.buf.Len()
		chunk := p
		if len(chunk) > remaining {
			chunk = chunk[:remaining]
		}
		w.buf.Write(chunk)
	}
	return w.ResponseWriter.Write(p)
}

// Body returns the captured response body when status was >= 500, with
// trailing whitespace trimmed (http.Error appends a trailing newline).
// Returns the empty string when nothing was captured.
func (w *errorBodySniffer) Body() string {
	return strings.TrimRight(w.buf.String(), "\r\n")
}

// Unwrap exposes the underlying ResponseWriter so PB's getStatus and
// getWritten helpers (and http.ResponseController) can walk past this
// wrapper to PB's own status/write tracker. Without it, re.Status()
// would return 0 even after a 500 was written.
func (w *errorBodySniffer) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// Flush, Hijack, and Push forward to the underlying ResponseWriter when it
// implements the corresponding optional interface. PB's own ResponseWriter
// supports all three; without these passthroughs, handlers like the SSE
// event stream would silently lose flush/hijack capability.
func (w *errorBodySniffer) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *errorBodySniffer) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func (w *errorBodySniffer) Push(target string, opts *http.PushOptions) error {
	if p, ok := w.ResponseWriter.(http.Pusher); ok {
		return p.Push(target, opts)
	}
	return http.ErrNotSupported
}
