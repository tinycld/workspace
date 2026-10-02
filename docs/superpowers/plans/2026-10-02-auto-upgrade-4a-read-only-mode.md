# Auto-upgrade 4a (core read-only mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tinycld server can enter and leave a read-only mode. While the mode is on, the server refuses writes with `503 read_only`, and the client retries those writes. This lets a second process migrate the shared database while the first one still serves reads.

**Architecture:** A new core package `tinycld.org/core/readonly` holds one process-wide flag and has these parts:
- `Enter`, `Leave` and `Active`.
- An HTTP middleware that refuses unsafe methods while the flag is set.
- A `SIGUSR2` handler that calls `Enter`.

`coreserver.RegisterSharedEarly` binds the middleware before Sentry's middleware, so both the single-org app and a hosted tenant get the mode, and a refused write never becomes a Sentry event. On the client, a fetch wrapper set in `pb.beforeSend` retries a refused request after `Retry-After`, up to 3 times. Every REST call the SDK and pbtsdb make goes through it.

**Tech Stack:** Go (PocketBase fork, `tinycld.org/core`), TypeScript (`@tinycld/core`, PocketBase JS SDK 0.26, vitest).

**Spec:** `docs/superpowers/specs/2026-10-01-auto-upgrade-4-zero-downtime-restarts-design.md`, section "Shared rule: the write pause". Part 4 is split into plans: 4a (this plan), then 4b (hosted tenant swap), 4c (router handoff) and 4d (single-tenant supervisor). 4b and 4d consume this plan's `readonly.Enter`/`readonly.Leave`.

## Global Constraints

- **Repo and branch:** `tinycld` (`~/code/tinycld/tinycld`), branch `feat/read-only-mode`, created from `main`. The hosting work in 4b uses the same branch name so that CI resolves core, or it waits for this PR to merge.
- **Spec values, verbatim:**
  - "while the mode is on, every non-`GET`/`HEAD`/`OPTIONS` request to `/api/` gets `503` with `Retry-After: 2` and a JSON body `{"code": "read_only"}`. Realtime subscriptions stay open."
  - "Two triggers turn it on: `SIGUSR2`, and an internal call."
  - "The client retries a `503 read_only` mutation after `Retry-After`, up to 3 times, before it shows an error."
- **Decisions this plan makes where the spec is silent.** The controller surfaces them to the user.
  1. `POST /api/realtime` is let through. It only sets the subscriptions of an open SSE stream and writes no record. Without it, a client that reconnects during the pause could not subscribe again.
  2. The body also carries `"message": "The server is updating. Try again in a moment."`. The PocketBase SDK uses `message` as the error text, so a write that still fails after 3 retries shows a clear toast. This needs no change to `errors.ts`.
  3. The retry is in the fetch layer (`pb.beforeSend` → `options.fetch`), not in `useMutation`. A refused request never reached a handler, so sending it again is safe. Running a multi-step mutation again from the start is not safe: steps that already succeeded would repeat. The fetch layer also covers pbtsdb's own requests.
  4. `SIGUSR2` only enters the mode. There is no leave signal: a stray or repeated signal must never re-open writes. `Leave` is an internal call only.
  5. Only `/api/` is covered, as the spec says. DAV writes (CalDAV, CardDAV, WebDAV) and mail delivery are not paused. Plan 4b decides whether its swap window needs them.
- Core must not name hosting, a package, or a deployment type. The package says "a supervising process", never "router" or "hosting".
- **Go:**
  - Use `logging.ForPackage("readonly")` for logs; never `fmt.Print*`.
  - Comments explain why.
  - `go test ./...` from `core/server` must pass, and `gofmt -l .` must print nothing.
- **TypeScript:**
  - Use biome, 4-space indent, single quotes, and no `any`.
  - `pnpm exec tinycld-pkg check` from `~/code/tinycld/tinycld` must pass.
- **Before every commit:**
  - `git branch --show-current` must print `feat/read-only-mode`.
  - Stage explicit paths only.
  - Commit messages never mention Claude.

## Out of scope (later plans)

- **Plan 4b, router side:**
  - The cfg.sock route through which the router puts a tenant into, and out of, read-only mode.
  - The swap itself.
  - Not counting `503 read_only` in the router's 5xx signal (`internal/traffic`), so a swap does not raise an org's 5xx ratio.
- **Plan 4d:** `requestRestart` under a supervisor.
- A help topic. The mode lasts seconds, and users see at most a retry or a toast.

## File map

| File | Responsibility |
|---|---|
| `core/server/readonly/readonly.go` (new) | flag, `Enter`/`Leave`/`Active`, `Middleware`, `Register` |
| `core/server/readonly/signal_unix.go` (new) | `SIGUSR2` → `Enter` |
| `core/server/readonly/signal_other.go` (new) | no-op on non-unix builds |
| `core/server/readonly/readonly_test.go` (new) | middleware + signal tests |
| `core/server/coreserver/server.go` | `RegisterSharedEarly` calls `readonly.Register(app)` before `RegisterSentry(app)` |
| `core/server/coreserver/readonly_wiring_test.go` (new) | the mode refuses before Sentry sees the request |
| `core/lib/read-only-retry.ts` (new) | `withReadOnlyRetry(fetchImpl, sleep)` |
| `core/lib/read-only-retry.test.ts` (new) | retry tests |
| `core/lib/pocketbase.ts` | `pb.beforeSend` sets `options.fetch` |

---

### Task 1: `readonly` package (server)

**Files:**
- Create: `core/server/readonly/readonly.go`, `core/server/readonly/signal_unix.go`, `core/server/readonly/signal_other.go`
- Test: `core/server/readonly/readonly_test.go`

**Interfaces:**
- Produces:
  - `func Enter()`: idempotent, logs once when it switches on.
  - `func Leave()`: idempotent, logs once when it switches off.
  - `func Active() bool`
  - `func Middleware(re *core.RequestEvent) error`
  - `func Register(app core.App)`: binds `Middleware` on `OnServe`, and on unix starts the `SIGUSR2` handler.
  - `const RetryAfterSeconds = 2`
  - `const Code = "read_only"`

- [ ] **Step 1: Write the failing tests**

```go
package readonly

import (
	"net/http"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// scenario runs one request against a test app with the middleware bound and
// routes that answer 200 for any method, so a 503 can only come from the mode.
func scenario(t *testing.T, method, url string, active bool, wantStatus int, wantBody []string) {
	t.Helper()
	if active {
		Enter()
	} else {
		Leave()
	}
	t.Cleanup(Leave)
	s := &tests.ApiScenario{
		Method:          method,
		URL:             url,
		ExpectedStatus:  wantStatus,
		ExpectedContent: wantBody,
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			Register(app)
			app.OnServe().BindFunc(func(e *core.ServeEvent) error {
				ok := func(re *core.RequestEvent) error { return re.String(http.StatusOK, "handled") }
				for _, p := range []string{"/api/x", "/elsewhere"} {
					e.Router.Any(p, ok)
				}
				return e.Next()
			})
			return app
		},
	}
	if wantStatus == http.StatusOK {
		s.ExpectedContent = []string{"handled"}
	}
	s.Test(t)
}

func TestMiddlewareRefusesWritesWhileActive(t *testing.T) {
	for _, m := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
		scenario(t, m, "/api/x", true, http.StatusServiceUnavailable, []string{`"code":"read_only"`, `"message":"The server is updating. Try again in a moment."`})
	}
}

func TestMiddlewareLetsReadsThrough(t *testing.T) {
	for _, m := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		scenario(t, m, "/api/x", true, http.StatusOK, nil)
	}
}

func TestMiddlewareInactivePassesWrites(t *testing.T) {
	scenario(t, http.MethodPost, "/api/x", false, http.StatusOK, nil)
}

func TestMiddlewareOnlyCoversAPI(t *testing.T) {
	scenario(t, http.MethodPost, "/elsewhere", true, http.StatusOK, nil)
}

func TestMiddlewareSetsRetryAfter(t *testing.T) {
	Enter()
	t.Cleanup(Leave)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	Register(app)
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/x", func(re *core.RequestEvent) error { return re.NoContent(http.StatusOK) })
		return e.Next()
	})
	(&tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/x",
		ExpectedStatus:        http.StatusServiceUnavailable,
		ExpectedContent:       []string{`"code":"read_only"`},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			if got := res.Header.Get("Retry-After"); got != "2" {
				t.Fatalf("Retry-After = %q, want 2", got)
			}
		},
	}).Test(t)
}

// POST /api/realtime only sets which topics an open stream carries; a client
// that reconnects during the pause must be able to subscribe again.
func TestMiddlewareLetsRealtimeSubscribe(t *testing.T) {
	Enter()
	t.Cleanup(Leave)
	(&tests.ApiScenario{
		Method:         http.MethodPost,
		URL:            "/api/realtime",
		Body:           strings.NewReader(`{"clientId":"missing","subscriptions":[]}`),
		ExpectedStatus: http.StatusNotFound, // PocketBase's own answer for an unknown client: not 503
		ExpectedContent: []string{`"data":{}`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			Register(app)
			return app
		},
	}).Test(t)
}

func TestEnterLeave(t *testing.T) {
	Leave()
	Enter()
	Enter()
	if !Active() {
		t.Fatal("Enter did not switch the mode on")
	}
	Leave()
	if Active() {
		t.Fatal("Leave did not switch the mode off")
	}
}

func TestSIGUSR2Enters(t *testing.T) {
	Leave()
	t.Cleanup(Leave)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	Register(app)
	if err := syscall.Kill(syscall.Getpid(), syscall.SIGUSR2); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !Active() {
		if time.Now().After(deadline) {
			t.Fatal("SIGUSR2 did not enter read-only mode")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
```

For the `/api/realtime` case, check PocketBase's real answer for an unknown `clientId` in the fork at `../third_party/pocketbase/apis/realtime.go`. Set `ExpectedStatus` and `ExpectedContent` to that answer. The assertion that matters is "not 503".

`TestSIGUSR2Enters` is unix-only. Put it in `readonly_unix_test.go` with `//go:build unix`.

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./readonly -v`
Expected: build failure (package empty).

- [ ] **Step 3: Implement**

`readonly.go`:

```go
// Package readonly lets a server stop accepting writes for a short time while
// it keeps serving reads. A supervising process uses it when a second server
// process is about to migrate the same database: the first one must not write
// against a schema it does not know, but its users should keep reading.
//
// The mode is process-wide. It is switched on by Enter (or SIGUSR2) and off
// only by Leave: a signal can open the pause but never close it, so a stray
// or repeated signal cannot re-open writes in the middle of a migration.
package readonly

import (
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/logging"
)

var log = logging.ForPackage("readonly")

const (
	Code              = "read_only"
	RetryAfterSeconds = 2
	message           = "The server is updating. Try again in a moment."
)

var active atomic.Bool

func Enter() {
	if active.CompareAndSwap(false, true) {
		log.Info("read-only mode on: writes are refused until the mode is left")
	}
}

func Leave() {
	if active.CompareAndSwap(true, false) {
		log.Info("read-only mode off: writes are accepted again")
	}
}

func Active() bool { return active.Load() }

// Register binds the middleware and the SIGUSR2 trigger. Bind it before any
// middleware that reports 5xx responses: a refused write is expected during a
// pause and must not reach error reporting.
func Register(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.BindFunc(Middleware)
		return e.Next()
	})
	watchSignal()
}

// Middleware refuses every unsafe request to /api/ while the mode is on.
// POST /api/realtime is let through: it only sets which topics an open SSE
// stream carries and writes no record, and a client that reconnects during
// the pause needs it to subscribe again.
func Middleware(re *core.RequestEvent) error {
	if !active.Load() || safe(re.Request.Method) {
		return re.Next()
	}
	path := re.Request.URL.Path
	if !strings.HasPrefix(path, "/api/") || path == "/api/realtime" {
		return re.Next()
	}
	re.Response.Header().Set("Retry-After", strconv.Itoa(RetryAfterSeconds))
	return re.JSON(http.StatusServiceUnavailable, map[string]string{"code": Code, "message": message})
}

func safe(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}
```

`signal_unix.go`:

```go
//go:build unix

package readonly

import (
	"os"
	"os/signal"
	"sync"
	"syscall"
)

var watchOnce sync.Once

// watchSignal makes SIGUSR2 enter read-only mode. Without a handler, SIGUSR2
// would terminate the process, so it is installed once, at registration.
func watchSignal() {
	watchOnce.Do(func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGUSR2)
		go func() {
			for range ch {
				Enter()
			}
		}()
	})
}
```

`signal_other.go`:

```go
//go:build !unix

package readonly

func watchSignal() {}
```

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./readonly -v -race`, then `go test ./...` and `gofmt -l .`

- [ ] **Step 5: Commit**

```bash
git add core/server/readonly
git commit -m "feat(readonly): refuse writes during a pause, keep serving reads"
```

---

### Task 2: Every server composition gets the mode

**Files:**
- Modify: `core/server/coreserver/server.go` (`RegisterSharedEarly`)
- Test: `core/server/coreserver/readonly_wiring_test.go`

**Interfaces:**
- Consumes: `readonly.Register`, `readonly.Enter`, `readonly.Leave` (Task 1). Also `captureSentry` and `registerSentryMiddlewareCore` in `coreserver/sentry_test.go`.

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/readonly"
)

// A write refused during a pause is expected, not an error: Sentry must not
// hear about it. registerSharedMiddleware binds read-only first for that.
func TestReadOnlyRefusesBeforeSentry(t *testing.T) {
	get, cleanup := captureSentry(t)
	defer cleanup()
	readonly.Enter()
	t.Cleanup(readonly.Leave)

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	registerSharedMiddleware(app)
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/x", func(re *core.RequestEvent) error { return re.NoContent(http.StatusOK) })
		return e.Next()
	})
	(&tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/x",
		ExpectedStatus:        http.StatusServiceUnavailable,
		ExpectedContent:       []string{`"code":"read_only"`},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
	if events := get(); len(events) != 0 {
		t.Fatalf("Sentry got %d events for a refused write", len(events))
	}
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./coreserver -run TestReadOnlyRefusesBeforeSentry -v`
Expected: build failure (`registerSharedMiddleware` undefined).

- [ ] **Step 3: Implement**

In `server.go`, add:

```go
// registerSharedMiddleware binds the router middleware every composition
// shares, in the order that matters: read-only first, so a write refused
// during a pause never reaches Sentry's 5xx capture; then Sentry, which must
// see every other request.
func registerSharedMiddleware(app core.App) {
	readonly.Register(app)
	registerSentryMiddlewareCore(app)
}
```

In `RegisterSentry`, keep the public function, but make `RegisterSharedEarly` call the new helper in place of `RegisterSentry(app)`:

```go
	// Read-only mode, then Sentry: see registerSharedMiddleware.
	registerSharedMiddleware(app)
```

Delete the old `RegisterSentry(app)` call in `RegisterSharedEarly`, and keep the comment that explains why Sentry binds early. If `RegisterSentry` then has no callers, delete it and update its doc reference in `sentry.go`. Run `grep -rn "RegisterSentry(" ~/code/tinycld --include='*.go'` first. A caller in another repo, such as hosting's tenantboot, means `RegisterSentry` stays.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./coreserver -v -run 'TestReadOnly|TestSentry|TestComposition'`, then `go test ./...` and `gofmt -l .`. The core composition parity tests must still pass. If one lists hooks or middleware by name, update its expectation. Then also run hosting's parity tests: `cd ~/code/tinycld/hosting && go test ./tenantboot -run Parity`. Hosting resolves core through `../tinycld`, so this tests the change in place. They must pass, because both compositions call `RegisterSharedEarly`.

- [ ] **Step 5: Commit**

```bash
git add core/server/coreserver/server.go core/server/coreserver/readonly_wiring_test.go core/server/coreserver/sentry.go
git commit -m "feat(coreserver): every composition gets read-only mode, bound before Sentry"
```

---

### Task 3: The client retries a refused write

**Files:**
- Create: `core/lib/read-only-retry.ts`
- Test: `core/lib/read-only-retry.test.ts`
- Modify: `core/lib/pocketbase.ts` (`pb.beforeSend`)

**Interfaces:**
- Produces:
  - `export type Fetch = (url: RequestInfo | URL, config?: RequestInit) => Promise<Response>`
  - `export const READ_ONLY_MAX_RETRIES = 3`
  - `export function retryAfterMs(header: string | null): number`: the `Retry-After` header in ms. Missing, invalid or non-positive → 2000 ms. Capped at 10 000 ms.
  - `export function withReadOnlyRetry(fetchImpl: Fetch, sleep?: (ms: number) => Promise<void>): Fetch`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { READ_ONLY_MAX_RETRIES, retryAfterMs, withReadOnlyRetry } from './read-only-retry'

function readOnly(retryAfter = '2') {
    return new Response(JSON.stringify({ code: 'read_only', message: 'updating' }), {
        status: 503,
        headers: { 'Retry-After': retryAfter, 'Content-Type': 'application/json' },
    })
}

function ok() {
    return new Response('{}', { status: 200 })
}

describe('retryAfterMs', () => {
    it('reads seconds', () => expect(retryAfterMs('3')).toBe(3000))
    it('defaults a missing or bad header to 2 s', () => {
        expect(retryAfterMs(null)).toBe(2000)
        expect(retryAfterMs('soon')).toBe(2000)
        expect(retryAfterMs('0')).toBe(2000)
    })
    it('caps a long wait at 10 s', () => expect(retryAfterMs('600')).toBe(10000))
})

describe('withReadOnlyRetry', () => {
    it('retries a read_only 503 after Retry-After and returns the success', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(readOnly('1')).mockResolvedValueOnce(ok())
        const sleep = vi.fn().mockResolvedValue(undefined)
        const res = await withReadOnlyRetry(fetchImpl, sleep)('/api/x', { method: 'POST', body: '{}' })
        expect(res.status).toBe(200)
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        expect(fetchImpl.mock.calls[1]).toEqual(['/api/x', { method: 'POST', body: '{}' }])
        expect(sleep).toHaveBeenCalledWith(1000)
    })

    it('gives up after 3 retries and returns the last 503', async () => {
        const fetchImpl = vi.fn().mockImplementation(async () => readOnly())
        const sleep = vi.fn().mockResolvedValue(undefined)
        const res = await withReadOnlyRetry(fetchImpl, sleep)('/api/x', { method: 'POST' })
        expect(res.status).toBe(503)
        expect(fetchImpl).toHaveBeenCalledTimes(1 + READ_ONLY_MAX_RETRIES)
    })

    it('does not retry another 503', async () => {
        const other = new Response(JSON.stringify({ code: 'other' }), { status: 503 })
        const fetchImpl = vi.fn().mockResolvedValue(other)
        const sleep = vi.fn()
        const res = await withReadOnlyRetry(fetchImpl, sleep)('/api/x', { method: 'POST' })
        expect(res.status).toBe(503)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
    })

    it('does not retry a 503 whose body is not JSON', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('down', { status: 503 }))
        const res = await withReadOnlyRetry(fetchImpl, vi.fn())('/api/x', { method: 'POST' })
        expect(res.status).toBe(503)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('stops when the request was aborted', async () => {
        const controller = new AbortController()
        const fetchImpl = vi.fn().mockImplementation(async () => {
            controller.abort()
            return readOnly()
        })
        const res = await withReadOnlyRetry(fetchImpl, vi.fn().mockResolvedValue(undefined))('/api/x', {
            method: 'POST',
            signal: controller.signal,
        })
        expect(res.status).toBe(503)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('leaves the caller a readable body', async () => {
        const fetchImpl = vi.fn().mockImplementation(async () => readOnly())
        const res = await withReadOnlyRetry(fetchImpl, vi.fn().mockResolvedValue(undefined))('/api/x', {
            method: 'POST',
        })
        await expect(res.json()).resolves.toMatchObject({ code: 'read_only' })
    })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/read-only-retry.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement**

`core/lib/read-only-retry.ts`:

```ts
// A server briefly refuses writes while a new server process migrates the
// database it shares with the old one (503 with code read_only). The request
// never reached a handler, so sending the same request again is safe; doing
// it here, under every REST call the SDK and pbtsdb make, keeps the pause
// invisible to users unless it outlasts the retries.

export type Fetch = (url: RequestInfo | URL, config?: RequestInit) => Promise<Response>

export const READ_ONLY_MAX_RETRIES = 3
const DEFAULT_RETRY_AFTER_MS = 2000
const MAX_RETRY_AFTER_MS = 10000

export function retryAfterMs(header: string | null): number {
    const seconds = Number(header)
    if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_MS
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

async function isReadOnly(res: Response): Promise<boolean> {
    if (res.status !== 503) return false
    try {
        const body: unknown = await res.clone().json()
        return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === 'read_only'
    } catch {
        return false
    }
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function withReadOnlyRetry(fetchImpl: Fetch, sleep: (ms: number) => Promise<void> = wait): Fetch {
    return async (url, config) => {
        let res = await fetchImpl(url, config)
        for (let attempt = 0; attempt < READ_ONLY_MAX_RETRIES; attempt++) {
            if (config?.signal?.aborted || !(await isReadOnly(res))) return res
            await sleep(retryAfterMs(res.headers.get('Retry-After')))
            res = await fetchImpl(url, config)
        }
        return res
    }
}
```

In `core/lib/pocketbase.ts`:

```ts
import { withReadOnlyRetry } from '@tinycld/core/lib/read-only-retry'

// Wraps the platform fetch per call (not captured at load) so tests and
// polyfills that replace globalThis.fetch later are still used.
const readOnlyRetryFetch = withReadOnlyRetry((url, config) => fetch(url, config))
```

Extend the existing `pb.beforeSend` body so that it sets `options.fetch` when the caller did not set one:

```ts
pb.beforeSend = (url, options) => {
    const headers = shareTokenHeaders()
    if (headers) {
        options.headers = { ...options.headers, ...headers }
    }
    // Writes refused during a server's read-only pause are retried; see
    // read-only-retry.ts.
    if (!options.fetch) {
        options.fetch = readOnlyRetryFetch
    }
    return { url, options }
}
```

Check in `node_modules/pocketbase/dist/pocketbase.es.mjs` that `send` reads `options.fetch` after `beforeSend` has run. If it does not, set the wrapper where the SDK does read it, and explain where in the report.

Biome may flag the `as { code?: unknown }` cast. If it does, use a small `isRecord` guard; `core/lib/errors.ts` has one, so export it from there or repeat its two lines.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm exec vitest run core/lib/read-only-retry.test.ts`, then `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg check`

- [ ] **Step 5: Commit**

```bash
git add core/lib/read-only-retry.ts core/lib/read-only-retry.test.ts core/lib/pocketbase.ts
git commit -m "feat(core): retry a write the server refused during a read-only pause"
```

---

### Task 4: End to end against a real server

**Files:**
- Test: `core/server/coreserver/readonly_e2e_test.go`

**Interfaces:**
- Consumes: `readonly.Enter` and `readonly.Leave` (Task 1), and the wiring from Task 2.

This test shows that the whole server, not only the middleware, behaves as the spec says. While the mode is on:
- a record create gets `503 read_only` with `Retry-After: 2`;
- a list read of the same collection gets `200`;
- an open realtime SSE stream stays open, and once `Leave` runs it carries the next event.

- [ ] **Step 1: Write the test**

Use the coreserver test helpers that start a full app with `RegisterSharedEarly`; `helpers_test.go` has them. If no helper starts a real HTTP listener, use `tests.NewTestApp()`, then call `registerSharedMiddleware(app)` and `apis.NewRouter`/`apis.Serve` the way existing realtime tests in the PocketBase fork do. The fork has such tests at `../third_party/pocketbase/apis/realtime_test.go`. Follow its pattern for reading an SSE stream with a timeout.

Steps in the test:
1. Create a public base collection `notes` with field `body` (create and list rules `""`).
2. Open `GET /api/realtime`, read the `PB_CONNECT` event, and take the `clientId`.
3. Call `readonly.Enter()`.
4. Assert `POST /api/realtime` with `{"clientId": <id>, "subscriptions": ["notes"]}` succeeds (204).
5. Assert `POST /api/collections/notes/records` with `{"body":"x"}` gets 503, `Retry-After: 2` and `"code":"read_only"`.
6. Assert `GET /api/collections/notes/records` gets 200.
7. Call `readonly.Leave()`.
8. Assert the same create now gets 200.
9. Assert the stream opened in step 2 delivers a `notes` create event within 5 s.
10. Call `readonly.Leave()` in `t.Cleanup`.

- [ ] **Step 2: Run, expect PASS**

Run: `go test ./coreserver -run TestReadOnlyE2E -v -race`

All the behaviour comes from Tasks 1 and 2, so this test passes at once. To show that it can fail, comment out the `readonly.Register` call for a moment and watch step 5 fail. Say in the report that you did this.

- [ ] **Step 3: Run** `go test ./...` and `gofmt -l .`

- [ ] **Step 4: Commit**

```bash
git add core/server/coreserver/readonly_e2e_test.go
git commit -m "test(coreserver): read-only mode end to end: writes refused, reads and realtime kept"
```
