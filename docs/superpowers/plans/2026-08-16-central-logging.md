# Central Logging Facility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five ad-hoc logging paths with one blessed API per language — a TS client logger that breadcrumbs everything and raises Sentry events above a configured level, and a Go `slog` fan-out handler that writes to stderr, PocketBase `_logs`, and Sentry.

**Architecture:** Two independent facilities sharing conventions but no code. On the TS side, a new `@tinycld/core/lib/logger` wraps the existing Sentry SDK so `beforeSend`/`beforeBreadcrumb` PII scrubbing applies automatically. On the Go side, a fan-out `slog.Handler` installed via `slog.SetDefault` composes three destination handlers; because `app.Logger()` already returns a `*slog.Logger` backed by PocketBase's `BatchHandler`, the `_logs` destination is a handler we compose rather than an adapter we write.

**Tech Stack:** TypeScript, React Native / Expo, `@sentry/react-native`, Vitest, Biome. Go 1.22+ `log/slog`, `github.com/getsentry/sentry-go` v0.44.1, PocketBase.

## Global Constraints

- Level ordering is `debug` < `info` < `warn` < `error`. These four names are the only levels, on both sides.
- TS release default threshold: `warn`. TS dev default: `debug`.
- Go destination thresholds: stderr `info`, `_logs` `info`, Sentry `warn`.
- Sentry always fires above threshold. A missing user id omits the attribution; it never suppresses the event.
- Never bypass the Sentry SDK with a custom transport — doing so skips the existing `scrubPII` hooks in `tinycld/core/lib/sentry.ts`.
- Do NOT thread `context.Context` into Go functions that do not already take one. Sites without a `ctx` log without user attribution, which is correct.
- The PocketBase `_logs` destination must keep working: `tinycld/scripts/ota-e2e/boot-beacon-poller.ts` and `update-is-live.ts` poll it for the `app-boot: rendered` beacon to verify OTA bundles booted.
- Biome enforces 4-space indent, single quotes, ES5 trailing commas. Never add `biome-ignore` comments.
- Never use `any` in TypeScript.

## Scope Note

The spec covers two independent subsystems that ship separately and do not block each
other. This plan covers **both foundations plus the TS migration** (Tasks 1-6), which
together produce working, testable software.

The bulk Go migration (~830 call sites across 7 independently-released repos) is
**deliberately excluded** and needs its own plan per member repo, because each requires
a `@tinycld/core` release plus a `peerVersions` bump before it can start. Task 7
establishes the enforcement lint that those follow-up plans depend on. See
"Follow-Up Plans Required" at the end.

## File Structure

| File | Responsibility |
|---|---|
| `tinycld/core/lib/logger.ts` (new) | The TS `log.*` API, level gating, Sentry breadcrumb/event dispatch |
| `tinycld/core/lib/__tests__/logger.test.ts` (new) | Unit tests for level gating and dispatch |
| `tinycld/core/lib/core-config.ts` (modify) | Add the `logLevel` config field |
| `tinycld/core/lib/sentry.ts` (modify) | Export the seam the logger dispatches through |
| `tinycld/core/lib/errors.ts` (modify) | Re-point `captureException` at `log.error` |
| `tinycld/core/server/logging/fanout.go` (new) | The fan-out `slog.Handler` |
| `tinycld/core/server/logging/sentry_handler.go` (new) | The Sentry `slog.Handler` |
| `tinycld/core/server/logging/logging.go` (new) | `Install()` — builds and sets the default logger |
| `tinycld/core/server/logging/*_test.go` (new) | Go unit tests |
| `tinycld/core/server/coreserver/server.go` (modify) | Call `logging.Install()` during `Register` |
| `tinycld/biome.json` (modify) | `noConsole` → `error` |

---

### Task 1: Add `logLevel` to core config

**Files:**
- Modify: `tinycld/core/lib/core-config.ts:21-55` (the `CoreConfig` interface)
- Test: `tinycld/core/lib/__tests__/core-config.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `LogLevel` type (`'debug' | 'info' | 'warn' | 'error'`) and the optional `CoreConfig.logLevel` field, both imported by Task 2.

- [ ] **Step 1: Write the failing test**

Append to `tinycld/core/lib/__tests__/core-config.test.ts`:

```ts
it('accepts a logLevel and returns it verbatim', () => {
    configureCore({
        brandName: 'TinyCld',
        serverShortcuts: {},
        logLevel: 'info',
    })
    expect(getCoreConfig().logLevel).toBe('info')
})

it('leaves logLevel undefined when not supplied', () => {
    configureCore({ brandName: 'TinyCld', serverShortcuts: {} })
    expect(getCoreConfig().logLevel).toBeUndefined()
})
```

Check the top of that file for the existing imports and the `__resetCoreConfigForTests()`
`beforeEach` — `configureCore` throws if called twice, so the reset must already be in place.
If the file has no `beforeEach`, add:

```ts
beforeEach(() => {
    __resetCoreConfigForTests()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core && pnpm exec tinycld-pkg test -- core-config`
Expected: FAIL — TypeScript rejects `logLevel` as not present in type `CoreConfig`.

- [ ] **Step 3: Add the type and field**

In `tinycld/core/lib/core-config.ts`, above the `CoreConfig` interface:

```ts
/**
 * Severity ordering used by `@tinycld/core/lib/logger`. Everything becomes a
 * Sentry breadcrumb; only calls at or above the configured level additionally
 * become Sentry events.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
```

Then inside `CoreConfig`, after the `release` field (line 42):

```ts
    /**
     * Minimum level that escalates a log call from a breadcrumb to a Sentry
     * event. Defaults to 'warn' in release builds and 'debug' in __DEV__.
     */
    logLevel?: LogLevel
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tinycld/core && pnpm exec tinycld-pkg test -- core-config`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/lib/core-config.ts tinycld/core/lib/__tests__/core-config.test.ts
git commit -m "feat(core): add logLevel to CoreConfig"
```

---

### Task 2: The TS logger module

**Files:**
- Create: `tinycld/core/lib/logger.ts`
- Create: `tinycld/core/lib/__tests__/logger.test.ts`
- Modify: `tinycld/core/lib/sentry.ts` (add `addBreadcrumbToSentry`)

**Interfaces:**
- Consumes: `LogLevel` and `CoreConfig.logLevel` from Task 1; `captureExceptionToSentry(context, error, extra)` and `captureMessageToSentry(context, message, extra)` from `./sentry`.
- Produces:
  - `log.debug(context: string, message: string, extra?: Record<string, unknown>): void`
  - `log.info(context: string, message: string, extra?: Record<string, unknown>): void`
  - `log.warn(context: string, message: string, extra?: Record<string, unknown>): void`
  - `log.error(context: string, error: unknown, extra?: Record<string, unknown>): void`
  - `resolveLogLevel(): LogLevel`
  - `addBreadcrumbToSentry(context: string, level: LogLevel, message: string, extra?: Record<string, unknown>): void` (from `sentry.ts`)

  Task 3 imports `log`; Task 4 imports `log.error`.

No `createLogger`/bound-child API. A flat `log.*` keeps the dotted context greppable at
every call site, which a bound logger would hide behind a factory line.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/lib/__tests__/logger.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCoreConfigForTests, configureCore } from '../core-config'

const captureException = vi.fn()
const captureMessage = vi.fn()
const addBreadcrumb = vi.fn()

vi.mock('../sentry', () => ({
    captureExceptionToSentry: (...args: unknown[]) => captureException(...args),
    captureMessageToSentry: (...args: unknown[]) => captureMessage(...args),
    addBreadcrumbToSentry: (...args: unknown[]) => addBreadcrumb(...args),
}))

describe('log', () => {
    beforeEach(() => {
        __resetCoreConfigForTests()
        captureException.mockClear()
        captureMessage.mockClear()
        addBreadcrumb.mockClear()
    })

    it('breadcrumbs a below-threshold call without raising an event', async () => {
        configureCore({ brandName: 'T', serverShortcuts: {}, logLevel: 'warn' })
        const { log } = await import('../logger')

        log.debug('mail.compose', 'draft saved', { draftId: '1' })

        expect(addBreadcrumb).toHaveBeenCalledWith('mail.compose', 'debug', 'draft saved', {
            draftId: '1',
        })
        expect(captureMessage).not.toHaveBeenCalled()
        expect(captureException).not.toHaveBeenCalled()
    })

    it('breadcrumbs AND raises an event at the threshold', async () => {
        configureCore({ brandName: 'T', serverShortcuts: {}, logLevel: 'warn' })
        const { log } = await import('../logger')

        log.warn('mail.imap', 'reconnect attempt', { attempt: 2 })

        expect(addBreadcrumb).toHaveBeenCalledTimes(1)
        expect(captureMessage).toHaveBeenCalledWith('mail.imap', 'reconnect attempt', {
            attempt: 2,
        })
    })

    it('routes log.error through captureException', async () => {
        configureCore({ brandName: 'T', serverShortcuts: {}, logLevel: 'warn' })
        const { log } = await import('../logger')
        const err = new Error('boom')

        log.error('mail.send', err, { messageId: 'm1' })

        expect(captureException).toHaveBeenCalledWith('mail.send', err, { messageId: 'm1' })
    })

    it('treats an above-threshold info call as an event when level is debug', async () => {
        configureCore({ brandName: 'T', serverShortcuts: {}, logLevel: 'debug' })
        const { log } = await import('../logger')

        log.info('app.boot', 'ready')

        expect(captureMessage).toHaveBeenCalledWith('app.boot', 'ready', undefined)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core && pnpm exec tinycld-pkg test -- logger`
Expected: FAIL — `Cannot find module '../logger'`.

- [ ] **Step 3: Add the breadcrumb seam to `sentry.ts`**

The logger dispatches breadcrumbs through `sentry.ts` rather than importing the Sentry
SDK directly, so all Sentry access stays in one module. Add to
`tinycld/core/lib/sentry.ts`, after `captureMessageToSentry`:

```ts
const SENTRY_BREADCRUMB_LEVEL: Record<string, Sentry.SeverityLevel> = {
    debug: 'debug',
    info: 'info',
    warn: 'warning',
    error: 'error',
}

/**
 * Record a log line as a Sentry breadcrumb. Breadcrumbs are an in-memory ring
 * buffer — no network — and are attached automatically to whatever event fires
 * next, which is what gives an error its preceding context.
 *
 * PII scrubbing is handled by the `beforeBreadcrumb` hook registered in
 * `initSentry`; do not scrub here or the data gets filtered twice.
 */
export function addBreadcrumbToSentry(
    context: string,
    level: string,
    message: string,
    extra?: Record<string, unknown>
): void {
    if (!initialized) return
    Sentry.addBreadcrumb({
        category: context,
        message,
        level: SENTRY_BREADCRUMB_LEVEL[level] ?? 'info',
        data: extra,
    })
}
```

- [ ] **Step 4: Write the logger**

Create `tinycld/core/lib/logger.ts`:

```ts
declare const __DEV__: boolean

import { getCoreConfigOptional, type LogLevel } from './core-config'
import {
    addBreadcrumbToSentry,
    captureExceptionToSentry,
    captureMessageToSentry,
} from './sentry'

const SEVERITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
}

/**
 * The level at or above which a log call also becomes a Sentry event. Release
 * builds default to 'warn' so a production warning surfaces before it escalates
 * into an exception; __DEV__ defaults to 'debug' (Sentry is inert there anyway,
 * since initSentry early-returns on __DEV__).
 */
export function resolveLogLevel(): LogLevel {
    const configured = getCoreConfigOptional()?.logLevel
    if (configured) return configured
    return __DEV__ ? 'debug' : 'warn'
}

function consoleLine(
    level: LogLevel,
    context: string,
    message: string,
    extra?: Record<string, unknown>
): void {
    if (!__DEV__) return
    const method = level === 'debug' ? 'debug' : level === 'error' ? 'error' : level
    console[method](`[${context}] ${message}`, extra ?? '')
}

function emit(
    level: LogLevel,
    context: string,
    message: string,
    extra?: Record<string, unknown>
): void {
    consoleLine(level, context, message, extra)
    addBreadcrumbToSentry(context, level, message, extra)
    if (SEVERITY[level] < SEVERITY[resolveLogLevel()]) return
    captureMessageToSentry(context, message, extra)
}

/**
 * The one blessed logging API for client code.
 *
 *     log.debug('mail.compose', 'draft saved', { draftId })
 *     log.error('mail.send', err, { messageId })
 *
 * `context` is a short stable dotted string Sentry groups on; `extra` is the
 * variable detail. Every call becomes a breadcrumb; calls at or above the
 * configured level additionally become Sentry events.
 */
export const log = {
    debug(context: string, message: string, extra?: Record<string, unknown>): void {
        emit('debug', context, message, extra)
    },
    info(context: string, message: string, extra?: Record<string, unknown>): void {
        emit('info', context, message, extra)
    },
    warn(context: string, message: string, extra?: Record<string, unknown>): void {
        emit('warn', context, message, extra)
    },
    /**
     * Errors always route through captureException so Sentry gets the real
     * stack, never a stringified message.
     */
    error(context: string, error: unknown, extra?: Record<string, unknown>): void {
        const message = error instanceof Error ? error.message : String(error)
        consoleLine('error', context, message, extra)
        addBreadcrumbToSentry(context, 'error', message, extra)
        captureExceptionToSentry(context, error, extra)
    },
}
```

Note `log.error` does not consult the threshold: an error is always at or above every
possible threshold, so gating it would be dead code.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tinycld/core && pnpm exec tinycld-pkg test -- logger`
Expected: PASS (4 tests)

- [ ] **Step 6: Typecheck and lint**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check`
Expected: biome clean, tsc clean, vitest green.

- [ ] **Step 7: Commit**

```bash
git add tinycld/core/lib/logger.ts tinycld/core/lib/__tests__/logger.test.ts tinycld/core/lib/sentry.ts
git commit -m "feat(core): add the central client logger"
```

---

### Task 3: Re-point `captureException` at the logger

**Files:**
- Modify: `tinycld/core/lib/errors.ts:162-164`
- Test: `tinycld/core/lib/__tests__/handle-mutation-errors.test.ts`

**Interfaces:**
- Consumes: `log.error` from Task 2.
- Produces: `captureException(context, error, extra)` — unchanged signature, now delegating to `log.error`. All existing call sites keep working.

- [ ] **Step 1: Write the failing test**

Append to `tinycld/core/lib/__tests__/handle-mutation-errors.test.ts`:

```ts
it('captureException delegates to log.error', async () => {
    const spy = vi.fn()
    vi.doMock('../logger', () => ({ log: { error: spy, debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
    vi.resetModules()

    const { captureException } = await import('../errors')
    const err = new Error('boom')
    captureException('example.create', err, { id: '1' })

    expect(spy).toHaveBeenCalledWith('example.create', err, { id: '1' })
})
```

If the file lacks a `vi` import, add `vi` to the existing `vitest` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core && pnpm exec tinycld-pkg test -- handle-mutation-errors`
Expected: FAIL — the spy is never called, because `captureException` still calls `captureExceptionToSentry` directly.

- [ ] **Step 3: Delegate to the logger**

In `tinycld/core/lib/errors.ts`, replace the import of `captureExceptionToSentry` on line 3
with:

```ts
import { log } from './logger'
```

and replace the function at lines 162-164 with:

```ts
/**
 * Retained for the many existing call sites; `log.error` is the same thing and
 * is what new code should use.
 */
export function captureException(context: string, error: unknown, extra?: Record<string, unknown>) {
    log.error(context, error, extra)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tinycld/core && pnpm exec tinycld-pkg test -- handle-mutation-errors`
Expected: PASS

- [ ] **Step 5: Run the full core suite to catch regressions**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check`
Expected: all green. `captureException` has many call sites; this confirms none broke.

- [ ] **Step 6: Commit**

```bash
git add tinycld/core/lib/errors.ts tinycld/core/lib/__tests__/handle-mutation-errors.test.ts
git commit -m "refactor(core): route captureException through the logger"
```

---

### Task 4: Migrate TS runtime call sites

**Files (18 runtime files; the console-bearing ones, excluding tests/scripts/generated):**
- Modify: `tinycld/core/lib/editor/use-webview-editor.tsx` (4 calls)
- Modify: `tinycld/core/lib/nav-perf.ts` (3)
- Modify: `tinycld/core/components/AppErrorBoundary.tsx` (2)
- Modify: `tinycld/core/lib/bundle-sentinel.tsx` (1)
- Modify: `tinycld/core/lib/app-updater/client.ts` (1)
- Modify: `tinycld/core/components/workspace/LazySidebarBoundary.tsx` (1)
- Modify: `tinycld/lib/use-server-address-gate.ts` (1)
- Modify: `tinycld/core/lib/editor/rich/use-rich-editor.web.tsx` (1)
- Modify: `text/tinycld/text/hooks/use-document-editor.web.tsx` (1)

**Explicitly NOT migrated** (they are build tooling / bundler scripts that legitimately
print to a terminal, and are covered by the existing biome `off` overrides):
`tinycld/package-scripts/src/cli.ts`, `tinycld/package-scripts/src/spawn.ts`,
`tinycld/core/lib/editor/rich/build.ts`, `tinycld/core/lib/editor/webview-bundler/build.ts`,
`tinycld/core/lib/editor/rich/webview/build/editorHtml.ts`,
`text/tinycld/text/webview-editor/build.ts`,
`text/tinycld/text/webview-editor/build/editorHtml.ts`.

Also NOT migrated: `tinycld/core/lib/sentry.ts` (its `console.*` calls run *before*
Sentry is initialized — routing them through the logger would be a no-op or infinite
regress) and `tinycld/core/lib/debug-trace.ts` (retired separately; see Follow-Ups).

**Interfaces:**
- Consumes: `log` from Task 2.
- Produces: no new API.

- [ ] **Step 1: Migrate one file and verify the pattern**

Start with `tinycld/core/lib/nav-perf.ts`. Add the import:

```ts
import { log } from '@tinycld/core/lib/logger'
```

Then convert each call, choosing the context from the module and the level by intent:

```ts
// before
if (__DEV__) console.debug('[nav-perf] route change', { route, ms })
// after
log.debug('core.nav-perf', 'route change', { route, ms })
```

Drop the `if (__DEV__)` guard — the logger handles dev-vs-release internally, and keeping
the guard would defeat the breadcrumb trail in release.

- [ ] **Step 2: Run the check for that member**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check`
Expected: green.

- [ ] **Step 3: Apply the level-intent audit to every remaining file**

For each `console.warn` and `console.error` being migrated, decide per site:

- Is this a genuine warning/error an on-call engineer should be paged about? → `log.warn` / `log.error`
- Was it written at that level only for terminal visibility during development? → `log.debug` or `log.info`

**This is the one non-mechanical step in the plan.** With a `warn` release default, every
site left at `warn` becomes a Sentry event the moment it ships. Record the decision for
each `warn`/`error` site in the commit body so review can check it.

Convert the remaining files listed above using the Step 1 pattern.

- [ ] **Step 4: Verify no runtime `console.*` remains**

Run:

```bash
cd /Users/nas/code/tinycld
rg --no-ignore --glob '!**/node_modules/**' -g '*.ts' -g '*.tsx' \
  -g '!**/*.test.*' -g '!**/*.spec.*' -g '!**/scripts/**' -g '!**/tests/**' \
  -g '!**/types.d.ts' -g '!**/third_party/**' -g '!**/tmp/**' -g '!bootstrap/**' \
  -g '!utils/**' -g '!web/**' -g '!pocketbase/**' -g '!**/build/**' \
  -g '!**/package-scripts/**' -g '!**/sentry.ts' -g '!**/debug-trace.ts' \
  -c 'console\.(log|warn|error|debug|info)'
```

Expected: no output (exit 1 from ripgrep means zero matches — that is success here).

Note: plain `grep` in this shell is aliased to ugrep in basic-regex mode, which silently
fails to match `(a|b)` alternations. Use `rg` as shown. `--no-ignore` is required because
the workspace root `.gitignore` excludes every member directory.

- [ ] **Step 5: Run checks across both touched members**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check && cd ../../text && pnpm exec tinycld-pkg check`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: migrate client console calls to the central logger"
```

---

### Task 5: The Go fan-out handler

**Files:**
- Create: `tinycld/core/server/logging/fanout.go`
- Create: `tinycld/core/server/logging/fanout_test.go`

**Interfaces:**
- Consumes: nothing (first Go task).
- Produces: `NewFanout(handlers ...slog.Handler) slog.Handler` — a handler that forwards every record to each child whose `Enabled` returns true. Tasks 6 and 7 consume it.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/logging/fanout_test.go`:

```go
package logging

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestFanoutWritesToEveryEnabledHandler(t *testing.T) {
	var a, b bytes.Buffer
	h := NewFanout(
		slog.NewTextHandler(&a, &slog.HandlerOptions{Level: slog.LevelDebug}),
		slog.NewTextHandler(&b, &slog.HandlerOptions{Level: slog.LevelDebug}),
	)
	slog.New(h).Info("hello", "k", "v")

	if !strings.Contains(a.String(), "hello") {
		t.Errorf("handler a missing record: %q", a.String())
	}
	if !strings.Contains(b.String(), "hello") {
		t.Errorf("handler b missing record: %q", b.String())
	}
}

func TestFanoutRespectsPerHandlerLevel(t *testing.T) {
	var chatty, quiet bytes.Buffer
	h := NewFanout(
		slog.NewTextHandler(&chatty, &slog.HandlerOptions{Level: slog.LevelDebug}),
		slog.NewTextHandler(&quiet, &slog.HandlerOptions{Level: slog.LevelError}),
	)
	slog.New(h).Info("only-chatty")

	if !strings.Contains(chatty.String(), "only-chatty") {
		t.Errorf("debug handler should have received the record")
	}
	if quiet.Len() != 0 {
		t.Errorf("error-level handler should have dropped the record, got %q", quiet.String())
	}
}

func TestFanoutEnabledIsTrueIfAnyChildIsEnabled(t *testing.T) {
	var buf bytes.Buffer
	h := NewFanout(
		slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelError}),
		slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}),
	)
	if !h.Enabled(context.Background(), slog.LevelDebug) {
		t.Error("fanout should be enabled when any child is enabled")
	}
}

func TestFanoutPropagatesAttrsToChildren(t *testing.T) {
	var buf bytes.Buffer
	h := NewFanout(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.New(h).With("pkg", "cards").Info("msg")

	if !strings.Contains(buf.String(), "pkg=cards") {
		t.Errorf("WithAttrs did not reach the child handler: %q", buf.String())
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core/server && go test ./logging/...`
Expected: FAIL — `undefined: NewFanout` (build error).

- [ ] **Step 3: Implement the fan-out**

Create `tinycld/core/server/logging/fanout.go`:

```go
// Package logging installs the process-wide slog handler for TinyCld servers.
//
// Call sites declare what happened (level + message + attrs); this package
// decides where it goes. That separation is the point: before it, the function
// you called silently picked the destination (slog → stderr, app.Logger() →
// the _logs table, sentry.CaptureException → Sentry).
package logging

import (
	"context"
	"log/slog"
)

// fanout forwards each record to every child handler that accepts it, so a
// single call site can reach stderr, the _logs table, and Sentry at once with
// independent per-destination levels.
type fanout struct {
	handlers []slog.Handler
}

// NewFanout returns a handler that forwards to each of handlers.
func NewFanout(handlers ...slog.Handler) slog.Handler {
	return &fanout{handlers: handlers}
}

// Enabled reports whether ANY child would accept the level. Returning false
// only when every child declines is what lets a quiet stderr handler coexist
// with a chatty Sentry one without either suppressing the other.
func (f *fanout) Enabled(ctx context.Context, level slog.Level) bool {
	for _, h := range f.handlers {
		if h.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

// Handle re-checks Enabled per child, because the parent's Enabled is an OR
// across all of them — without this a debug record aimed at stderr would also
// be written to the error-level Sentry handler.
//
// A child returning an error must not stop the others: losing a stderr line
// should never also lose the Sentry event. The last error is returned for the
// caller's benefit and otherwise ignored.
func (f *fanout) Handle(ctx context.Context, r slog.Record) error {
	var lastErr error
	for _, h := range f.handlers {
		if !h.Enabled(ctx, r.Level) {
			continue
		}
		if err := h.Handle(ctx, r.Clone()); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

func (f *fanout) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Handler, len(f.handlers))
	for i, h := range f.handlers {
		next[i] = h.WithAttrs(attrs)
	}
	return &fanout{handlers: next}
}

func (f *fanout) WithGroup(name string) slog.Handler {
	next := make([]slog.Handler, len(f.handlers))
	for i, h := range f.handlers {
		next[i] = h.WithGroup(name)
	}
	return &fanout{handlers: next}
}
```

`r.Clone()` is required: `slog.Record` carries internal attr state that is not safe to
share across handlers that may each call `AddAttrs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tinycld/core/server && go test ./logging/... -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Vet**

Run: `cd tinycld/core/server && go vet ./logging/...`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tinycld/core/server/logging/
git commit -m "feat(core/server): add a fan-out slog handler"
```

---

### Task 6: The Sentry slog handler

**Files:**
- Create: `tinycld/core/server/logging/sentry_handler.go`
- Create: `tinycld/core/server/logging/sentry_handler_test.go`

**Interfaces:**
- Consumes: `NewFanout` from Task 5 (indirectly, via Task 7).
- Produces: `NewSentryHandler(level slog.Level) slog.Handler`.

Reads the Sentry hub off the `context.Context`. `sentryMiddleware`
(`tinycld/core/server/coreserver/sentry.go:70-141`) already clones a hub per request,
calls `sentry.SetHubOnContext`, and sets `sentry.User{ID: re.Auth.Id}` at lines 84-86 —
so user attribution comes for free from the context and needs no new plumbing.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/logging/sentry_handler_test.go`:

```go
package logging

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
)

// captureTransport records events instead of sending them.
type captureTransport struct {
	events []*sentry.Event
}

func (t *captureTransport) Configure(sentry.ClientOptions) {}
func (t *captureTransport) SendEvent(e *sentry.Event)      { t.events = append(t.events, e) }
func (t *captureTransport) Flush(time.Duration) bool       { return true }

func newTestHub(t *testing.T) (*sentry.Hub, *captureTransport) {
	t.Helper()
	tr := &captureTransport{}
	client, err := sentry.NewClient(sentry.ClientOptions{Dsn: "", Transport: tr})
	if err != nil {
		t.Fatalf("sentry.NewClient: %v", err)
	}
	return sentry.NewHub(client, sentry.NewScope()), tr
}

func TestSentryHandlerCapturesAtOrAboveLevel(t *testing.T) {
	hub, tr := newTestHub(t)
	ctx := sentry.SetHubOnContext(context.Background(), hub)

	logger := slog.New(NewSentryHandler(slog.LevelWarn))
	logger.WarnContext(ctx, "reconnect failed", "attempt", 3)

	if len(tr.events) != 1 {
		t.Fatalf("expected 1 captured event, got %d", len(tr.events))
	}
	if tr.events[0].Message != "reconnect failed" {
		t.Errorf("unexpected message: %q", tr.events[0].Message)
	}
}

func TestSentryHandlerIgnoresBelowLevel(t *testing.T) {
	hub, tr := newTestHub(t)
	ctx := sentry.SetHubOnContext(context.Background(), hub)

	logger := slog.New(NewSentryHandler(slog.LevelWarn))
	logger.InfoContext(ctx, "just fyi")

	if len(tr.events) != 0 {
		t.Fatalf("expected no events, got %d", len(tr.events))
	}
}

// A call site with no ctx (tickers, startup, background goroutines) must still
// produce an event — the user id is enrichment, never a gate.
func TestSentryHandlerCapturesWithoutAHubOnContext(t *testing.T) {
	logger := slog.New(NewSentryHandler(slog.LevelWarn))
	// Must not panic with no hub on the context.
	logger.Warn("no ctx here")
}

func TestSentryHandlerAttachesAttrsAsExtra(t *testing.T) {
	hub, tr := newTestHub(t)
	ctx := sentry.SetHubOnContext(context.Background(), hub)

	logger := slog.New(NewSentryHandler(slog.LevelWarn)).With("pkg", "cards")
	logger.ErrorContext(ctx, "flush failed", "boardID", "b1")

	if len(tr.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(tr.events))
	}
	extra := tr.events[0].Extra
	if extra["pkg"] != "cards" {
		t.Errorf("expected pkg=cards in extra, got %v", extra["pkg"])
	}
	if extra["boardID"] != "b1" {
		t.Errorf("expected boardID=b1 in extra, got %v", extra["boardID"])
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core/server && go test ./logging/...`
Expected: FAIL — `undefined: NewSentryHandler`.

- [ ] **Step 3: Implement the handler**

Create `tinycld/core/server/logging/sentry_handler.go`:

```go
package logging

import (
	"context"
	"log/slog"

	"github.com/getsentry/sentry-go"
)

var sentryLevel = map[slog.Level]sentry.Level{
	slog.LevelDebug: sentry.LevelDebug,
	slog.LevelInfo:  sentry.LevelInfo,
	slog.LevelWarn:  sentry.LevelWarning,
	slog.LevelError: sentry.LevelError,
}

// sentryHandler turns log records at or above minLevel into Sentry events.
//
// User attribution is inherited, not plumbed: the per-request middleware in
// coreserver/sentry.go already puts a hub carrying sentry.User{ID: …} on the
// request context, so a *Context log call picks it up automatically. Calls
// without a ctx (tickers, startup, background goroutines) fall back to the
// current hub and produce an unattributed event — which is correct, because
// there genuinely is no user in those paths.
type sentryHandler struct {
	minLevel slog.Level
	attrs    []slog.Attr
	groups   []string
}

// NewSentryHandler returns a handler capturing records at or above minLevel.
func NewSentryHandler(minLevel slog.Level) slog.Handler {
	return &sentryHandler{minLevel: minLevel}
}

func (h *sentryHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.minLevel
}

func (h *sentryHandler) Handle(ctx context.Context, r slog.Record) error {
	hub := sentry.GetHubFromContext(ctx)
	if hub == nil {
		hub = sentry.CurrentHub()
	}

	extra := make(map[string]any, len(h.attrs)+r.NumAttrs())
	for _, a := range h.attrs {
		extra[a.Key] = a.Value.Any()
	}
	r.Attrs(func(a slog.Attr) bool {
		extra[a.Key] = a.Value.Any()
		return true
	})

	hub.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentryLevel[r.Level])
		scope.SetExtras(extra)
		hub.CaptureMessage(r.Message)
	})
	return nil
}

func (h *sentryHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	next = append(next, h.attrs...)
	next = append(next, attrs...)
	return &sentryHandler{minLevel: h.minLevel, attrs: next, groups: h.groups}
}

func (h *sentryHandler) WithGroup(name string) slog.Handler {
	next := make([]string, 0, len(h.groups)+1)
	next = append(next, h.groups...)
	next = append(next, name)
	return &sentryHandler{minLevel: h.minLevel, attrs: h.attrs, groups: next}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tinycld/core/server && go test ./logging/... -v`
Expected: PASS (8 tests total across both files)

- [ ] **Step 5: Vet**

Run: `cd tinycld/core/server && go vet ./logging/...`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tinycld/core/server/logging/
git commit -m "feat(core/server): add a Sentry slog handler"
```

---

### Task 7: Install the default logger

**Files:**
- Create: `tinycld/core/server/logging/logging.go`
- Create: `tinycld/core/server/logging/logging_test.go`
- Modify: `tinycld/core/server/coreserver/server.go:122` (inside `Register`, after `registerSharedEarly`)

**Interfaces:**
- Consumes: `NewFanout` (Task 5), `NewSentryHandler` (Task 6).
- Produces: `Install(pbHandler slog.Handler)` and `ForPackage(name string) *slog.Logger`.

**Recursion hazard.** `app.Logger()` falls back to `slog.Default()` when the app is not
yet bootstrapped (`pocketbase/core/base.go:360-366`). If the fan-out we install as the
default itself calls `app.Logger()`, an early log call recurses infinitely. `Install`
therefore takes an already-resolved `slog.Handler` and never calls `app.Logger()` itself.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/logging/logging_test.go`:

```go
package logging

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestForPackageStampsThePkgAttr(t *testing.T) {
	var buf bytes.Buffer
	Install(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))) })

	ForPackage("cards").Warn("refusing to flush")

	out := buf.String()
	if !strings.Contains(out, "pkg=cards") {
		t.Errorf("expected pkg=cards, got %q", out)
	}
	if !strings.Contains(out, "refusing to flush") {
		t.Errorf("expected the message, got %q", out)
	}
}

func TestInstallSetsTheDefaultLogger(t *testing.T) {
	var buf bytes.Buffer
	Install(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))) })

	slog.Info("via the package-level default")

	if !strings.Contains(buf.String(), "via the package-level default") {
		t.Errorf("slog.Default was not installed: %q", buf.String())
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core/server && go test ./logging/...`
Expected: FAIL — `undefined: Install`, `undefined: ForPackage`.

- [ ] **Step 3: Implement Install and ForPackage**

Create `tinycld/core/server/logging/logging.go`:

```go
package logging

import (
	"log/slog"
	"os"
)

// Destination levels. Independent by design: stderr and the DB-backed _logs
// table are for operators reading history, while Sentry is for paging someone.
//
// _logs sits at Info deliberately. It is a database table, and routing all of
// the codebase's slog calls there at Debug would write far more than the
// app.Logger() calls it receives today.
const (
	StderrLevel = slog.LevelInfo
	LogsLevel   = slog.LevelInfo
	SentryLevel = slog.LevelWarn
)

// Install sets the process-wide default logger to a fan-out over stderr, the
// PocketBase _logs table, and Sentry.
//
// pbHandler is the caller-resolved handler for the _logs table — normally
// app.Logger().Handler(). It is passed in rather than resolved here because
// app.Logger() falls back to slog.Default() before bootstrap; resolving it
// inside the handler we are installing AS the default would recurse.
//
// Pass nil for pbHandler to skip the _logs destination (useful in tests and in
// binaries with no PocketBase app).
func Install(pbHandler slog.Handler) {
	handlers := []slog.Handler{
		slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: StderrLevel}),
		NewSentryHandler(SentryLevel),
	}
	if pbHandler != nil {
		handlers = append(handlers, pbHandler)
	}
	slog.SetDefault(slog.New(NewFanout(handlers...)))
}

// ForPackage returns a logger stamped with a pkg attribute, replacing the old
// hand-written "cards: " message prefixes with a queryable structured field.
//
//	log := logging.ForPackage("cards")
//	log.WarnContext(ctx, "refusing to flush a card from another board", "cardID", id)
func ForPackage(name string) *slog.Logger {
	return slog.Default().With("pkg", name)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tinycld/core/server && go test ./logging/... -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Wire it into server bootstrap**

In `tinycld/core/server/coreserver/server.go`, immediately after the
`registerSharedEarly(app)` call at line 122:

```go
	// Install the process-wide logger before features register, so their
	// package loggers and any boot-time logging reach every destination.
	//
	// app.Logger().Handler() is resolved HERE and handed to Install, never
	// resolved inside the fan-out: app.Logger() falls back to slog.Default()
	// pre-bootstrap, so a lazy lookup inside the default handler would recurse.
	logging.Install(app.Logger().Handler())
```

Add the import to the file's import block:

```go
	"tinycld.org/core/server/logging"
```

Verify the module path matches `tinycld/core/server/go.mod` (the module is
`tinycld.org/core`, so the import path is `tinycld.org/core/server/logging`).

- [ ] **Step 6: Build and test the whole server module**

Run: `cd tinycld/core/server && go build ./... && go test ./logging/... && go vet ./...`
Expected: all green.

- [ ] **Step 7: Verify `_logs` still receives records**

Run: `cd tinycld/core/server && go test ./coreserver/... -run Sentry`
Expected: PASS — confirms the middleware still behaves with the new default logger.

This guards the OTA e2e dependency: `boot-beacon-poller.ts` reads `_logs` for the
`app-boot: rendered` beacon, so a regression here breaks OTA release verification.

- [ ] **Step 8: Commit**

```bash
git add tinycld/core/server/logging/ tinycld/core/server/coreserver/server.go
git commit -m "feat(core/server): install the fan-out logger at bootstrap"
```

---

### Task 8: Enforce the convention in Biome

**Files:**
- Modify: `tinycld/biome.json:132`

**Interfaces:**
- Consumes: the completed Task 4 migration (this fails the build otherwise).
- Produces: no API.

Runs last because promoting the rule to `error` breaks the build until every runtime
call site is migrated.

- [ ] **Step 1: Promote noConsole to error**

In `tinycld/biome.json`, in the top-level `suspicious` block (line 132), change:

```json
            "suspicious": {
                "noConsole": "warn",
```

to:

```json
            "suspicious": {
                "noConsole": "error",
```

Leave the three scoped `noConsole: "off"` overrides (around lines 166, 190, 208)
untouched — they cover build scripts and CLI tooling that legitimately print to a
terminal.

- [ ] **Step 2: Run the workspace lint**

Run: `cd /Users/nas/code/tinycld && pnpm run lint`
Expected: clean. Any failure names a runtime file Task 4 missed — migrate it rather than
adding an override, and never add a `biome-ignore`.

- [ ] **Step 3: Commit**

```bash
git add tinycld/biome.json
git commit -m "chore(core): make noConsole an error"
```

---

### Task 9: Document the facility

**Files:**
- Modify: `CLAUDE.md` (the "Logging" section)

**Interfaces:**
- Consumes: everything above.
- Produces: no API.

The current Logging section states *"No central `log` helper. **Don't import
`@tinycld/core/lib/logger` — it doesn't exist**"*. That is now false and actively
misleading, so it must change in the same series.

- [ ] **Step 1: Rewrite the Logging section**

Replace the opening two lines of the **Logging** section in `CLAUDE.md` with:

```markdown
## Logging

**Client → `log` from `@tinycld/core/lib/logger`.** Every call becomes a Sentry
breadcrumb; calls at or above `coreConfig.logLevel` (default `warn` in release,
`debug` in dev) also become Sentry events.

    import { log } from '@tinycld/core/lib/logger'

    log.debug('mail.compose', 'draft saved', { draftId })
    log.warn('mail.imap', 'reconnect attempt', { attempt })
    log.error('mail.send', err, { messageId })

`context` is a short stable dotted string Sentry groups on; `extra` is variable detail.
`captureException` from `@tinycld/core/lib/errors` still works and is an alias for
`log.error`.

**Never `console.*` in runtime code** — biome enforces this as an error. Build scripts
and CLI tooling are exempt via scoped overrides.

**Server → `logging.ForPackage("<slug>")` from `tinycld.org/core/server/logging`.**
Returns an `*slog.Logger` stamped with a `pkg` attribute. Records fan out to stderr
(`info`+), the PocketBase `_logs` table (`info`+), and Sentry (`warn`+).

    log := logging.ForPackage("cards")
    log.WarnContext(ctx, "refusing to flush a card from another board", "cardID", id)

Prefer the `*Context` variants when a `ctx` is in scope — the per-request Sentry hub
carries the user id, so those calls get user attribution for free. Calls without a
`ctx` still log and still reach Sentry, just unattributed. Do not add a `ctx` parameter
to a function solely to log. Do not write manual `"cards: "` message prefixes; the `pkg`
attribute replaces them.
```

- [ ] **Step 2: Verify the claim about `logger` not existing is gone**

Run: `rg -n "it doesn't exist" CLAUDE.md`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the central logging facility"
```

---

## Follow-Up Plans Required

Not in this plan, each needing its own:

1. **Go call-site migration** (~830 sites: ~155 stdlib `log.*`, 214 `app.Logger()`, 463
   bare `slog.*`). Blocked on a `@tinycld/core` release. **Sequencing hazard:** a member
   that migrates off `app.Logger()` before adopting the core version carrying `Install()`
   silently stops writing to `_logs` — no error, just missing rows. Each member's plan
   must bump `peerVersions` to pin the core version first. One plan per member repo
   (`mail` 17, `drive` 7, `calendar` 4, `text` 3, `cards` 3, `calc` 2, `tinycld` 27).
2. **A Go lint** forbidding stdlib `log` and bare `slog` in favor of `ForPackage`. Only
   meaningful once (1) lands, since it would fail on every unmigrated site.
3. **Retiring `debug-trace.ts`** and its `/api/app/boot` beacon. Requires first moving
   the OTA e2e harness (`boot-beacon-poller.ts`, `update-is-live.ts`) onto the new
   channel, since it depends on that endpoint.
