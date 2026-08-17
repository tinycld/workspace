# Central Logging Facility

**Date:** 2026-08-16
**Status:** Design approved, not yet implemented

## Problem

The ecosystem has five ways to emit a log line, and the choice of function silently
determines the destination. There is no single blessed API on either side of the
TS/Go boundary.

**TypeScript (client).** No central logger exists — `CLAUDE.md` explicitly documents
that `@tinycld/core/lib/logger` is not a real module. Instead there are three partial
facilities:

- `captureException` / `captureMessageToSentry` (`core/lib/sentry.ts`)
- the `notify` dispatcher (`core/lib/notify/`), for user-facing events
- `debug-trace.ts`, a `__DEV__`-only tracer whose own header comment marks it
  `TEMPORARY … REMOVE once the routing bug is found`

Roughly 18 app-runtime files call `console.*` directly. Biome's `noConsole` is set to
`warn` with three scoped `off` overrides. Because the house convention is
`console.*` guarded by `__DEV__`, **release builds have no diagnostic channel at
all** — which is precisely why `debug-trace.ts` had to invent a network beacon to
`/api/app/boot` to observe anything on a real device.

**Go (server).** Three conventions with genuinely different destinations:

| Convention | Calls | Destination |
|---|---|---|
| `slog.*` (bare, manual `"cards: "` prefixes) | 463 | stderr / container logs |
| stdlib `log.*` | ~155 | stderr, unstructured |
| `app.Logger()` (PocketBase) | 214 | the queryable `_logs` collection |

The `_logs` split is not cosmetic: that table is queryable from the PB admin UI and
retained in the database, where stderr is ephemeral.

## Goals

Consistency and code hygiene. One blessed API per language, enforced by lint, with
existing call sites migrated.

Guiding principle: **call sites declare what happened; configuration decides where it
goes.** Today the destination is baked into the function name. After this change, a
call site picks a level and a context, and handlers fan out.

## Non-goals

Explicitly considered and rejected:

- **Sentry Logs** (the newer structured-logs product). A separate product surface with
  its own quota and pricing; a bigger commitment than a hygiene cleanup warrants.
- **Runtime-adjustable verbosity** (dev-menu toggle, per-device log level). Useful for
  support, but additive later — the config field is identical either way.
- **Log shipping / aggregation** for hosted multi-org deployments.
- **New transports.** Everything routes through SDKs already in the tree.
- **Threading `ctx` through Go functions that lack it** (see "User attribution").

## Architecture

Two independent facilities. They share conventions — level names
(`debug` < `info` < `warn` < `error`), a dotted-context / `pkg` label, and structured
key-value extras — but share **no code**. They run in different processes with
different destinations, and a common abstraction would be a wrapper over `slog` on one
side and `console` on the other with nothing real in common.

### TS client logger

New module `@tinycld/core/lib/logger`.

```ts
import { log } from '@tinycld/core/lib/logger'

log.debug('mail.compose', 'draft saved', { draftId })
log.warn('mail.imap', 'reconnect attempt', { attempt })
log.error('mail.send', err, { messageId })
```

Flat API, context-first on every call, mirroring the existing
`captureException(context, error, extra)` signature. `log.error` accepts an `unknown`
error in the message slot to match how the codebase already calls `captureException`.

A flat `log.*` was chosen over a bound `createLogger('mail.compose')` child logger
specifically for greppability: with a bound logger, searching for `mail.compose` finds
the factory line but not the call sites — the opposite of what is wanted when tracing
a production issue.

**Behavior.** Every call adds a Sentry **breadcrumb** (in-memory ring buffer, no
network). Calls at or above the threshold *additionally* become Sentry **events** —
`captureException` for `error`, `captureMessage` otherwise. The payoff is that when an
error fires, the preceding log lines ride along attached to that event; today
`captureExceptionToSentry` sends an exception with no surrounding context.

In `__DEV__`, everything prints to the console and Sentry is inert regardless
(`initSentry` early-returns on `__DEV__`).

**Threshold.** A new `logLevel` field on core config, alongside `sentryDsn`,
`environment`, and `release`, read via `getCoreConfigOptional()`.

- Release default: `warn`
- Dev default: `debug`

`warn` rather than `error` because a warning firing in production is usually something
worth seeing before it escalates into an exception, and the breadcrumb trail bounds
the noise cost.

**PII.** Routing through the Sentry SDK means the existing `beforeSend` /
`beforeBreadcrumb` `scrubPII` hooks in `core/lib/sentry.ts` apply automatically. This
is a specific reason not to bypass the SDK with a custom transport — a custom
transport would silently skip scrubbing.

**Compatibility.** `captureException` remains exported and becomes a thin alias for
`log.error`. Existing call sites keep working unchanged.

### Go server logger

Standardize on **`slog`** — it already has 463 call sites and the better decoupling
story. `app.Logger()` was rejected as the target because it couples every package to a
live PocketBase app instance, which breaks logging during startup or outside a
request and makes unit-testing log-emitting code awkward.

`slog.SetDefault` is never called in our production code (every hit is in a test), so
there is a clean insertion point. At startup, install a **fan-out handler** writing to
three destinations:

| Destination | Receives | Default level |
|---|---|---|
| stderr (`slog.NewTextHandler`) | structured text | `info` |
| PocketBase `_logs` | DB-backed, queryable | `info` |
| Sentry | events | `warn` |

**`_logs` must be preserved.** It has a live consumer: the OTA end-to-end harness
(`tinycld/scripts/ota-e2e/boot-beacon-poller.ts` and `update-is-live.ts`) polls
`_logs` for the `app-boot: rendered` beacon to verify a promoted bundle actually
booted on device. Dropping it would break OTA release verification. Keeping it as a
*handler* rather than a *call-site choice* is exactly what allows the 214
`app.Logger()` sites to converge on `slog` without losing the queryable table.

(Note: the `audit_logs` collection is a separate app-level feature, unrelated to
PocketBase's `_logs`.)

The `_logs` handler carries its own threshold rather than inheriting the global one.
Today 214 calls reach that table; routing all 463 `slog` calls there at `debug` would
write substantially more to the database. `info` is the default and is a tunable knob,
not a load-bearing decision.

**Package labels.** Replace the manual `slog.Warn("cards: …")` prefix convention with
a package-scoped logger carrying a `pkg` attribute, so the label becomes a queryable
structured field instead of a string convention contributors forget.

#### User attribution

Server-side Sentry already does most of this work. `sentryMiddleware`
(`tinycld/core/server/coreserver/sentry.go:70-141`) clones a hub per request, calls
`sentry.SetHubOnContext`, and sets `sentry.User{ID: re.Auth.Id}` when `re.Auth` is
non-nil (lines 84-86).

The Sentry `slog.Handler` therefore pulls the hub off the `context.Context` and
inherits the user for free. **No new user plumbing is required.**

Call sites that already have a `ctx` in scope use the context-aware variants
(`slog.WarnContext(ctx, …)`) and get attribution. Sites without one use plain
`slog.Warn(…)` and log with no user attached — which is correct for tickers, startup,
and background goroutines, where there genuinely is no user.

`context.Context` was chosen over an explicit per-call `"userID"` attribute (463 sites
to audit, easy to forget, and most sites do not have the id in scope) and over
goroutine-local storage (Go has none; emulating it is fragile and breaks when work
moves to a background goroutine).

**Deliberate limitation:** functions that do not currently take a `ctx` will *not* have
one threaded through as part of this work. That ripples into signature churn across
many packages and would turn a hygiene cleanup into a broad refactor. Sites gain `ctx`
opt-in, later, when a specific log line proves worth it.

**Sentry always fires above the threshold.** A missing user id omits the attribution;
it never suppresses the event. Server errors matter whether or not they are
attributable.

## Migration

Four groups, in dependency order.

1. **~155 stdlib `log.*` → `slog`.** Mechanical. Concentrated in 27 `tinycld` files,
   plus 2 in `multi-org` and 1 in `mail`.
2. **214 `app.Logger()` → `slog`.** Behavior-preserving *only because* the `_logs`
   handler exists, so this lands strictly after the fan-out ships. Spans `tinycld`
   (27), `mail` (17), `drive` (7), `calendar` (4), `text` (3), `cards` (3), `calc` (2).
3. **463 bare `slog.*` → package-scoped logger.** Manual prefix becomes a `pkg`
   attribute. Largest group, most mechanical.
4. **~18 TS runtime files → `log.*`.** Excludes tests, build scripts, generated
   `types.d.ts`, and `third_party/`.

### The one non-mechanical step

With a `warn` release default, every migrated `console.warn` and `slog.Warn` becomes a
Sentry event the moment it lands. Each such site needs a per-call judgment: is this
genuinely a warning, or a debug line someone wrote as `warn` for visibility?

This audit is part of the migration, not a follow-up. Skipping it means a chatty line
pages the team on day one.

### Enforcement

- **TS:** Biome `noConsole` goes from `warn` to `error` for app-runtime code. The
  existing scoped `off` overrides for scripts and build tooling stay.
- **Go:** a lint forbidding stdlib `log` and bare `slog` in favor of the package-scoped
  logger.

## Risks

**Cross-repo sequencing.** Groups 2 and 3 touch feature repos that release
independently. The fan-out handler ships in `@tinycld/core` and must be released *and
adopted* before any member migrates off `app.Logger()` — otherwise that member
silently stops writing to `_logs`. Each migrating member needs a `peerVersions` bump
pinning the core version that provides the handler.

**Volume.** Roughly 830 Go call sites plus 18 TS files. This is several PRs per
member, not a single change. Groups 1 and 3 are mechanical and can be batched; group 2
needs the sequencing above.

**`_logs` write volume.** Mitigated by giving that handler its own `info` threshold
(above), but worth watching after group 2 lands, since the set of calls reaching the
table changes.

## Follow-ups

Once the client logger works in release builds, `debug-trace.ts` and its
`/api/app/boot` network beacon can retire — the beacon exists solely because release
builds had no diagnostic channel. This is a follow-up rather than part of this work,
because the OTA e2e harness currently depends on that endpoint and would need to move
to the new channel first.
