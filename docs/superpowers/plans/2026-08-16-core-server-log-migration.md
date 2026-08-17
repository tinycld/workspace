# Core Server Log Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `tinycld/core/server`'s own 200-odd logging call sites onto `logging.ForPackage`, so core actually adopts the convention the facility documents.

**Architecture:** The fan-out handler and `ForPackage` already exist and are installed at bootstrap (tinycld#208). This plan only converts call sites. No new mechanism.

**Tech Stack:** Go 1.26, `log/slog`, `tinycld.org/core/logging`, PocketBase.

## Why this is not blocked

The ~830-site migration deferred by the parent plan covers the **seven feature repos** (`mail`, `drive`, `calendar`, `text`, `cards`, `calc`, `contacts`), each of which must wait for a `@tinycld/core` release plus a `peerVersions` bump.

`tinycld/core/server` is not one of those. It lives in the same repo and same Go module (`tinycld.org/core`) as the `logging` package. Nothing gates it.

## Current state (verified counts, non-test files only)

| Convention | Sites | Reaches the fan-out today? |
|---|---|---|
| stdlib `log.*` | 104 | No — bypasses `slog` entirely |
| `app.Logger().*` | 90 | No — writes only to `_logs` |
| bare `slog.*` | 12 | Yes, but with no `pkg` attribute |

Zero stdlib `log.*` calls exist in `_test.go` files, so tests need no changes for that group.

The `app.Logger()` group is the subtle one: those calls DO reach `_logs`, but they never reach stderr or Sentry, because they go straight to PocketBase's handler rather than through `slog.Default()`.

## Out of scope — do not migrate

**`log.Fatal`/`log.Fatalf`/`log.Panic` (7 sites).** These terminate the process. A logger call would not, so converting them silently changes control flow.
- `cmd/export-payload-types/main.go` (3), `cmd/export-types/main.go` (2), `push/cmd/genkeys/main.go` (1)
- `coreserver/server.go:151` — a startup guard (`quota config`) that must keep exiting

**Everything under `cmd/`.** Standalone CLI binaries that print to a terminal and exit. They have no PocketBase app, so no fan-out is ever installed; stdlib `log` is correct there. Same reasoning as the TypeScript build scripts.

**`_test.go` files.** Test logging stays as-is.

**`logging/logging.go`'s two `app.Logger()` mentions.** Both are inside comments, not calls.

## Global Constraints

- Level ordering is `debug` < `info` < `warn` < `error`.
- Destination levels are fixed and not to be changed: stderr `info`+, `_logs` inherits PocketBase's `Settings.Logs.MinLevel`, Sentry `warn`+.
- **The Sentry threshold is `warn`.** Every site left at `warn` or `error` becomes a paging Sentry event. Every conversion must make a deliberate level choice — this is the same audit the parent plan required for the client.
- Use `logging.ForPackage("<pkg>")` from `tinycld.org/core/logging`. One package-level logger per Go package.
- **Delete manual message prefixes.** `log.Printf("[push] failed to …")` becomes `pushLog.Warn("failed to …")` — the `pkg` attribute carries `push`. Leaving both duplicates the label.
- Prefer `*Context` variants where a `ctx` is already in scope; the per-request Sentry hub carries the user id. **Never add a `ctx` parameter to a function just to log.**
- Convert `Printf`-style format strings to structured key-value attrs: `log.Printf("user %s failed: %v", id, err)` → `l.Warn("user operation failed", "userID", id, "err", err)`.
- Comments explain "why", not "what".
- `_logs` delivery must keep working — the OTA e2e harness polls it for the `app-boot: rendered` beacon.

## Task sequencing

Tasks are grouped by package so each is independently reviewable and testable, ordered lowest-risk first. Every task ends with `go build ./... && go vet ./... && go test ./<pkg>/...` green and one commit.

---

### Task 1: The 12 bare `slog.*` sites

**Files:** whichever non-test files match `slog\.(Info|Warn|Error|Debug)` under `core/server/`, excluding `logging/`.

**Why first:** smallest group, and these already reach the fan-out — the only change is gaining the `pkg` attribute and dropping manual prefixes. It establishes the pattern the later tasks copy.

- [ ] **Step 1: Enumerate the sites**

```sh
cd /Users/nas/code/tinycld/tinycld/core/server
rg -n -g '*.go' -g '!*_test.go' 'slog\.(Info|Warn|Error|Debug)' . | rg -v '^\./logging/'
```

- [ ] **Step 2: Add a package logger to each affected package**

At package scope, once per package:

```go
var log = logging.ForPackage("<pkgname>")
```

If the identifier `log` collides with an imported stdlib `log` in that file, name it `<pkg>Log` instead and say so in the report.

- [ ] **Step 3: Convert each call**

```go
// before
slog.Warn("cards: refusing to flush a card that belongs to another board", "cardID", id)
// after
log.Warn("refusing to flush a card that belongs to another board", "cardID", id)
```

Drop the `"cards: "` prefix — `pkg=cards` replaces it. Use `WarnContext(ctx, …)` where a `ctx` is already in scope.

- [ ] **Step 4: Verify**

Run: `go build ./... && go vet ./... && go test ./logging/... ./coreserver/... -count=1 -timeout 900s`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(core/server): move bare slog calls onto package loggers"
```

---

### Task 2: `push`, `notify`, `audit` — 17 stdlib sites

**Files:** `push/push.go` (7), `notify/notify.go` (6), `audit/audit.go` (4)

**Why these together:** three small, self-contained packages that already use manual `[push]`-style prefixes, making them the clearest demonstration of the prefix-to-`pkg` conversion.

- [ ] **Step 1: Add package loggers**

```go
var log = logging.ForPackage("push")   // and "notify", "audit"
```

Remove the now-unused `"log"` import from each file. If a file still needs stdlib `log` for a `Fatal`, keep the import and name the new logger `pushLog` etc.

- [ ] **Step 2: Convert, choosing levels deliberately**

```go
// before
log.Printf("[push] failed to query subscriptions for user %s: %v", userID, err)
// after
log.Warn("failed to query subscriptions", "userID", userID, "err", err)
```

**Level guidance.** A failure that the surface recovers from is `warn`. A failure that loses user-visible data or breaks a request is `error`. Routine progress narration is `info` or `debug`. Remember `warn`+ pages someone.

Record a level decision for every site you set to `warn` or `error` in your report.

- [ ] **Step 3: Verify**

Run: `go build ./... && go vet ./... && go test ./push/... ./notify/... ./audit/... -count=1`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(core/server): migrate push, notify, and audit to package loggers"
```

---

### Task 3: `coreserver` package-install and rebuild paths — 60 stdlib sites

**Files:** `coreserver/pkg_install.go` (9), `tenant_pkg_state.go` (8), `pkg_seed.go` (8), `schema_gen.go` (6), `rebuild.go` (6), `pkg_go_build.go` (6), `pkg_rollback_reconcile.go` (5), `pkg_build.go` (5), `pkg_restart.go` (3), `users_guard.go` (2), `setup_bootstrap.go` (2), `rebuild_logging.go` (2), `rebuild_activate.go` (2)

**Careful here — two hazards:**

1. **`server.go:151`'s `log.Fatalf` stays.** Do not convert it. If the `"log"` import is still needed for it, keep the import.
2. **Some of these run pre-bootstrap** (`setup_bootstrap.go`, parts of the install path). Pre-bootstrap calls fall through to Go's default stderr handler, which is fine and expected — but do NOT try to "fix" that by installing the logger earlier. That exact change caused an infinite-recursion hang; `TestLoggerInstallDoesNotHangDuringBootstrap` guards it.

- [ ] **Step 1: Add the package logger and convert**

Same pattern as Task 2. `coreserver` is one package, so one `var log = logging.ForPackage("coreserver")` for the whole package — not one per file.

Watch for existing `[pkg_install]`-style prefixes carrying a sub-component name. Those are worth keeping as an attr rather than dropping:

```go
// before
log.Printf("[pkg_install] [%s] [%d%%] %s: %s", job.ID, progress, step, message)
// after
log.Info("package install progress", "jobID", job.ID, "percent", progress, "step", step, "message", message)
```

- [ ] **Step 2: Verify `rebuild_logging.go` still works**

That file already deliberately uses `SetContext` for Sentry enrichment. Read it before editing and preserve that behavior.

- [ ] **Step 3: Verify**

Run: `go build ./... && go vet ./... && go test ./coreserver/... -count=1 -timeout 900s`
Expected: green. This suite takes ~35s; let it finish.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(core/server): migrate coreserver install and rebuild paths"
```

---

### Task 4: `pkgbuild` and remaining stdlib sites — ~17 sites

**Files:** `pkgbuild/exec.go` (10), `tenantmain/tenantmain.go` (1), plus any non-`cmd/` stdlib `log.*` sites the earlier tasks did not cover.

- [ ] **Step 1: Re-enumerate what remains**

```sh
rg -n -g '*.go' -g '!*_test.go' '\blog\.(Printf|Println|Print)' . | rg -v '^\./cmd/'
```

- [ ] **Step 2: Convert using the Task 2 pattern, then verify**

Run: `go build ./... && go vet ./... && go test ./... -count=1 -timeout 900s`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor(core/server): migrate pkgbuild and remaining stdlib log calls"
```

---

### Task 5: The 90 `app.Logger()` sites

**Files:** `mailproto/smtp.go` (13), `mailproto/imap.go` (13), `coreserver/app_updates.go` (10), `coreserver/demo_reset.go` (7), `automation/engine.go` (5), `automation/catalog.go` (5), `caldav/backend.go` (4), `automation/runs.go` (4), `coreserver/app_updates_tenant.go` (3), `webdav/filesystem.go` (2), `oauth/revoke.go` (2), `notify/comment_mentions.go` (2), `fts/sync.go` (2), `automation/register.go` (2), and the 1-site files: `webdav/register.go`, `webdav/hooks.go`, `webdav/file.go`, `search/aggregate.go`, `pkgaccess/pkgaccess.go`

**This task is last and needs the most care.** These calls currently reach `_logs` and nothing else. Converting them to `ForPackage` routes them through the fan-out, which means they additionally reach stderr and — at `warn`+ — Sentry. That is the intended improvement, but it means **a chatty `app.Logger().Warn` that was previously invisible outside `_logs` will start paging someone.** Audit each one.

**The one call you must NOT convert:** `coreserver/app_updates.go:398` logs the `app-boot: rendered` beacon that the OTA e2e harness polls `_logs` for. Read that call and the surrounding comment before touching the file. Converting it is *probably* safe (the fan-out still includes the `_logs` handler), but the harness is release-verification infrastructure and a silent break there is expensive. **Leave that specific call on `app.Logger()` and add a comment explaining why**, unless you can positively demonstrate the beacon still lands in `_logs` after conversion.

- [ ] **Step 1: Convert package by package, smallest first**

Order: the five 1-site files, then `fts`, `oauth`, `pkgaccess`, `search`, `notify`, `webdav`, `caldav`, `automation`, then `coreserver`, then `mailproto` last (26 sites, the largest).

For each: add `var log = logging.ForPackage("<pkg>")`, convert `app.Logger().Info(...)` → `log.InfoContext(ctx, ...)` where a `ctx` exists, else `log.Info(...)`.

- [ ] **Step 2: Audit every warn/error**

Same rule as Task 2 — record a decision per site. Pay attention to `mailproto`: SMTP/IMAP protocol errors are frequently client-caused (a bad client retrying), so many are `info`/`debug`, not `warn`.

- [ ] **Step 3: Verify `_logs` still receives records**

Run the full suite plus a targeted check that the bootstrap path still logs:

```sh
go build ./... && go vet ./...
go test ./... -count=1 -timeout 900s
go test ./coreserver/ -run TestLoggerInstallDoesNotHangDuringBootstrap -v -count=1
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(core/server): migrate app.Logger call sites to package loggers"
```

---

### Task 6: Verify and document

- [ ] **Step 1: Confirm the remaining sites are exactly the intended exceptions**

```sh
cd /Users/nas/code/tinycld/tinycld/core/server
echo "stdlib log (should be cmd/ + server.go:151 Fatal only):"
rg -n -g '*.go' -g '!*_test.go' '\blog\.(Printf|Println|Print|Fatal|Fatalf|Panic)' .
echo "app.Logger (should be the OTA beacon only, if you kept it):"
rg -n -g '*.go' -g '!*_test.go' 'Logger\(\)\.' . | rg -v '^\./logging/'
echo "bare slog (should be zero):"
rg -n -g '*.go' -g '!*_test.go' 'slog\.(Info|Warn|Error|Debug)' . | rg -v '^\./logging/'
```

Any hit not on the documented exception list is a miss — go back and migrate it.

- [ ] **Step 2: Update the parent plan's follow-up section**

In `docs/superpowers/plans/2026-08-16-central-logging.md`, follow-up item 1 currently lumps core's own sites in with the seven feature repos. Correct it to record that core is done and only the feature repos remain.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs(plan): record the core server log migration as complete"
```

## Risks

**Sentry noise on day one.** 90 `app.Logger()` sites currently never reach Sentry. Any left at `warn`+ start paging immediately. The per-site audit in Tasks 2, 3, and 5 is the mitigation and is not optional.

**The OTA beacon.** `app_updates.go:398` feeds release verification. Task 5 leaves it alone by default.

**Pre-bootstrap calls.** Some install-path logging runs before the fan-out is installed and will go to plain stderr. That is correct and deliberate — do not move the install earlier to "fix" it.
