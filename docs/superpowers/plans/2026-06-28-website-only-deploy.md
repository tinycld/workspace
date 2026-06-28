# Website-only Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `deploy.sh web` mode that builds the Astro marketing site and rsyncs it onto the running host's `/workspace` state volume, so the website updates in seconds without an app image rebuild.

**Architecture:** The website moves off the baked Docker image onto the persistent `/workspace/website/` dir on the state volume. The Go server's `DefaultWebsiteDir()` resolves to `<TINYCLD_STATE_DIR>/website`; the entrypoint pins `--websiteDir=/workspace/website`. `Dockerfile.org` no longer builds or copies the site (the volume is the sole source). A new, self-contained `web` mode in `deploy.sh` builds `web/dist/` locally and rsyncs it to the host over SSH — completely bypassing the git-graft/`git push` machinery used by `org`/`com`.

**Tech Stack:** Go (PocketBase-based server), Bash (deploy script), Docker, Astro (static site), rsync over SSH, Dokku host.

---

## File Structure

- `tinycld/core/server/coreserver/static.go` — modify `DefaultWebsiteDir()` to resolve under the state dir.
- `tinycld/core/server/coreserver/static_test.go` — add a unit test for the new `DefaultWebsiteDir()` behavior.
- `tinycld/config/entrypoint.sh` — add `--websiteDir=/workspace/website` to `PB_SERVE_DIRS`.
- `utils/Dockerfile.org` — remove the `website-builder` stage and the `COPY --from=website-builder` line.
- `utils/deploy.sh` — add a self-contained `web` mode (arg parser branch + early code path) and update the usage header.

Each task below is independently committable.

---

## Task 1: Server resolves website dir from the state volume

**Files:**
- Modify: `tinycld/core/server/coreserver/static.go:100-105` (`DefaultWebsiteDir`)
- Test: `tinycld/core/server/coreserver/static_test.go`

The existing `DefaultWebsiteDir()` anchors to the binary dir. We change it to anchor under the state dir (`<TINYCLD_STATE_DIR>/website`), falling back to `./website` when the state dir is unset — matching the `DefaultReleasesDir()` / `stateReleasesDir()` precedent in `state_paths.go`.

Note for the implementer: `resolveStateDir()` (in `state_paths.go`) returns `$TINYCLD_STATE_DIR` when set, else `resolveServerDir()`. To get the clean `./website` fallback for `go run`/dev (where `TINYCLD_STATE_DIR` is unset), the new code reads the env var directly rather than going through `resolveStateDir()` (whose unset-fallback is `resolveServerDir()`, an absolute path, not `./website`). This mirrors how `DefaultWebsiteDir` previously produced `./website` for the tempdir-binary case.

- [ ] **Step 1: Write the failing test**

Add to `tinycld/core/server/coreserver/static_test.go`. The file already has `package coreserver` and imports `"os"`, `"path/filepath"`, and `"testing"` — no import change is needed. Use `t.Setenv`, the idiom already used in `state_paths_test.go`:

```go
func TestDefaultWebsiteDir_StateDirSet(t *testing.T) {
	t.Setenv("TINYCLD_STATE_DIR", "/workspace")
	if got, want := DefaultWebsiteDir(), filepath.Join("/workspace", "website"); got != want {
		t.Fatalf("DefaultWebsiteDir() = %q, want %q", got, want)
	}
}

func TestDefaultWebsiteDir_StateDirUnsetFallsBackToRelative(t *testing.T) {
	t.Setenv("TINYCLD_STATE_DIR", "")
	if got, want := DefaultWebsiteDir(), "./website"; got != want {
		t.Fatalf("DefaultWebsiteDir() = %q, want %q", got, want)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core/server && go test ./coreserver/ -run 'TestDefaultWebsiteDir' -v`
Expected: FAIL — `TestDefaultWebsiteDir_StateDirSet` reports the old binary-dir path (e.g. ends in `/website` but not `/workspace/website`), and/or `TestDefaultWebsiteDir_StateDirUnsetFallsBackToRelative` fails because the current impl returns a binary-dir path, not `./website`, when the binary isn't a tempdir build.

- [ ] **Step 3: Implement the change**

Replace the body of `DefaultWebsiteDir()` in `static.go` (currently lines 100-105) with the state-dir resolution. Also update the doc comment above it (lines 93-99) so it no longer describes the baked-into-image `<binaryDir>/website` behavior:

```go
// DefaultWebsiteDir returns the marketing-website root on the persistent state
// volume: <TINYCLD_STATE_DIR>/website (e.g. /workspace/website in production),
// or "./website" when TINYCLD_STATE_DIR is unset (`go run` / dev). The site lives
// on the state volume, NOT baked into the image, so a website-only deploy
// (utils/deploy.sh web) can rsync a new build onto the volume without an image
// rebuild. It stays SEPARATE from DefaultPublicDir() so the app's `expo export`
// (which sweeps public/ into its web bundle) never absorbs the site.
// StaticWithDynamicFallback treats a missing/empty websiteDir as "no website".
func DefaultWebsiteDir() string {
	if d := os.Getenv("TINYCLD_STATE_DIR"); d != "" {
		return filepath.Join(d, "website")
	}
	return "./website"
}
```

`os` and `path/filepath` are already imported in `static.go` (used by `DefaultPublicDir`/`binaryDir`), so no import change is needed in the non-test file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tinycld/core/server && go test ./coreserver/ -run 'TestDefaultWebsiteDir' -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run the broader static + state-paths tests to check nothing regressed**

Run: `cd tinycld/core/server && go test ./coreserver/ -run 'TestStatic|TestResolveStateDir|TestStateDataDir' -v`
Expected: PASS. (The existing `TestStatic_*` tests construct their own `websiteDir` explicitly via `StaticWithDynamicFallback`, so they don't depend on the default and stay green.)

- [ ] **Step 6: Commit**

```bash
git -C tinycld add core/server/coreserver/static.go core/server/coreserver/static_test.go
git -C tinycld commit -m "feat(server): resolve website dir from the state volume"
```

---

## Task 2: Entrypoint serves the website from the volume

**Files:**
- Modify: `tinycld/config/entrypoint.sh:61` (the `PB_SERVE_DIRS` assignment)

The entrypoint pins the stateful PocketBase dirs as `--*Dir` flags so they survive the per-build `current` symlink swap. Add `--websiteDir=/workspace/website` alongside `--releasesDir` so the binary reads the site from the volume explicitly (parity with the other pinned dirs; the Go default from Task 1 resolves to the same path, but pinning it here is consistent with `--dir`/`--releasesDir`).

There is **no seeding step** — the volume is the sole source of the site (a fresh host serves no website until the first `deploy.sh web`, and the server degrades gracefully to the app shell).

- [ ] **Step 1: Read the current line**

Run: `sed -n '61p' tinycld/config/entrypoint.sh`
Expected output (exact):
```
PB_SERVE_DIRS="--dir=${PB_DATA_DIR} --releasesDir=/workspace/releases --migrationsDir=${CURRENT_LINK}/server/pb_migrations"
```

- [ ] **Step 2: Update the comment block and the line**

In the comment block above the assignment (around lines 49-50, the bullet list of pinned dirs), add a bullet for the website dir right after the `--releasesDir` bullet. Find:

```
#   --releasesDir  promoted web bundles → /workspace/releases (persistent)
```

and insert after it:

```
#   --websiteDir   marketing site → /workspace/website (persistent; populated by
#                  `utils/deploy.sh web`, NOT baked into the image — empty until
#                  the first web deploy, which the server tolerates)
```

Then change the assignment on line 61 from:

```
PB_SERVE_DIRS="--dir=${PB_DATA_DIR} --releasesDir=/workspace/releases --migrationsDir=${CURRENT_LINK}/server/pb_migrations"
```

to:

```
PB_SERVE_DIRS="--dir=${PB_DATA_DIR} --releasesDir=/workspace/releases --websiteDir=/workspace/website --migrationsDir=${CURRENT_LINK}/server/pb_migrations"
```

- [ ] **Step 3: Verify the edit**

Run: `grep -n -- '--websiteDir=/workspace/website' tinycld/config/entrypoint.sh`
Expected: one match on the `PB_SERVE_DIRS` line (line ~61).

Run: `bash -n tinycld/config/entrypoint.sh`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git -C tinycld add config/entrypoint.sh
git -C tinycld commit -m "feat(entrypoint): serve website from /workspace volume"
```

---

## Task 3: Stop baking the website into the image

**Files:**
- Modify: `utils/Dockerfile.org` (remove the `website-builder` stage + its `COPY`)

`Dockerfile.org`'s tail currently (1) builds the Astro site in a `website-builder` stage and (2) `COPY --from=website-builder /website/dist/ ./website/` into the runtime image. Since the volume is now the sole source, remove both. Keep the sentry-deploy hook and the ENTRYPOINT/EXPOSE re-declaration tail exactly as-is.

- [ ] **Step 1: Remove the website-builder stage**

In `utils/Dockerfile.org`, delete the entire block from the comment `# Build the marketing website` through the end of that stage (the line `# Output in /website/dist/`). Concretely, delete these lines:

```dockerfile
# Build the marketing website
FROM node:22-bookworm-slim AS website-builder
WORKDIR /website
# corepack provides the pnpm pinned in website/package.json "packageManager".
RUN corepack enable
# pnpm-workspace.yaml carries the standalone-project marker + build-script
# approvals (esbuild/sharp); both it and the lockfile are needed before install.
COPY website/package.json website/pnpm-lock.yaml website/pnpm-workspace.yaml ./
# Cache-mount pnpm's store for the website's deps; this stage's output is just
# /website/dist (no store is copied out), so a full cache mount is safe here.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile
COPY website/ ./
RUN pnpm run build
# Output in /website/dist/
```

- [ ] **Step 2: Remove the COPY and rewrite the runtime-extension comment**

Replace the entire "Extend runtime with marketing website" comment block AND its `FROM runtime` + `COPY --from=website-builder ...` lines. Find this block:

```dockerfile
# Extend runtime with marketing website.
#
# The built site goes to ./website/ — its OWN dir, NOT ./public/. The app's
# `expo export` sweeps the public/ dir into its web bundle, so a site dropped in
# public/ used to get absorbed into the SPA shell on any in-app package install
# (the rebuild re-runs expo export against the live public/), and every app route
# then rendered the marketing homepage. A separate website/ dir is invisible to
# expo export, so the site survives in-app rebuilds untouched. The Go server
# serves website/ ahead of public/ and the SPA fallback (StaticWithDynamicFallback
# / DefaultWebsiteDir). website/ sits inside the tinycld member so the in-app
# rebuild's copyMemberFromCurrent carries it into each new build dir.
FROM runtime
COPY --from=website-builder /website/dist/ ./website/
```

and replace it with (the `FROM runtime` line must stay — the sentry tail below extends it):

```dockerfile
# Org-mode runtime. The marketing website is NOT baked into the image: it lives
# on the persistent /workspace volume at /workspace/website, populated by
# `utils/deploy.sh web` (rsync over SSH) and served by the Go server via
# --websiteDir=/workspace/website (set in config/entrypoint.sh). This decouples
# website updates from image rebuilds. The dir is empty on a brand-new host until
# the first web deploy; StaticWithDynamicFallback tolerates that and serves the
# app shell.
FROM runtime
```

- [ ] **Step 3: Verify no dangling references remain**

Run: `grep -n -i 'website-builder\|/website/dist\|COPY --from=website-builder' utils/Dockerfile.org`
Expected: no output (zero matches).

Run: `grep -c '^FROM runtime' utils/Dockerfile.org`
Expected: `1` (the single remaining `FROM runtime` that the sentry/ENTRYPOINT tail extends).

- [ ] **Step 4: Commit**

```bash
git -C utils add Dockerfile.org
git -C utils commit -m "build(org): drop baked website; serve from state volume"
```

---

## Task 4: Add the `web` deploy mode

**Files:**
- Modify: `utils/deploy.sh` (arg parser around lines 50-69; new early code path; usage header lines 4-25)

Add `web` as a third mode. It runs a **self-contained early code path** that builds `web/dist/` and rsyncs it to the host, then exits — it never reaches the org/com git-graft / `git push` logic. Implemented as an `if [ "$MODE" = "web" ]; then … exit 0; fi` block placed right after `SITE_REPO`/`WS_ROOT` are defined and before the org/com-only `WS_ROOT_FILES` preflight.

New env vars (overridable, defaulted for `tinycld.org`):
- `WEB_SSH_TARGET` — SSH login for the host, default `tinycld.org` (a real shell login, NOT the `dokku@` git user). Implementer/operator must confirm the actual SSH user/host; the default is the bare hostname so `~/.ssh/config` can supply the user.
- `WEB_REMOTE_PATH` — host-side filesystem path backing the container's `/workspace/website`. No safe universal default exists (it depends on the host's Dokku storage mount), so it is **required** for `web` mode and the script errors if unset.

- [ ] **Step 1: Extend the arg parser to accept `web`**

In `utils/deploy.sh`, change the parser case (currently matching `org|com`) from:

```bash
        org|com)
            if [ -n "$MODE" ]; then
                echo "Specify the mode (org|com) only once." >&2
                exit 1
            fi
            MODE="$1"
            shift
            ;;
```

to:

```bash
        org|com|web)
            if [ -n "$MODE" ]; then
                echo "Specify the mode (org|com|web) only once." >&2
                exit 1
            fi
            MODE="$1"
            shift
            ;;
```

And change the "mode is required" error from:

```bash
if [ -z "$MODE" ]; then
    echo "ERROR: a mode is required: '$0 org' or '$0 com'" >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1
fi
```

to:

```bash
if [ -z "$MODE" ]; then
    echo "ERROR: a mode is required: '$0 org', '$0 com', or '$0 web'" >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1
fi
```

- [ ] **Step 2: Insert the self-contained `web` code path**

In `utils/deploy.sh`, locate this block (around lines 88-89):

```bash
SITE_REPO="${SITE_REPO:-$WS_ROOT/web}"
```

Immediately AFTER the `SITE_REPO=...` assignment and its surrounding comment, insert the entire `web`-mode block below. It must come BEFORE the `MEMBERS=(...)` array and the org/com `DOKKU_REMOTE` inference, so `web` never touches that machinery:

```bash
# ----------------------------------------------------------------------------
# WEB MODE — website-only deploy (no image rebuild, no git push)
# ----------------------------------------------------------------------------
# Builds the Astro site in the web member and rsyncs web/dist/ straight onto the
# host's persistent /workspace/website dir over SSH. The Go server serves that
# dir (config/entrypoint.sh pins --websiteDir=/workspace/website), so a new build
# is live as soon as rsync finishes — no Docker build, no Dokku push.
if [ "$MODE" = "web" ]; then
    # Real shell SSH login to the host (NOT the dokku@ git user). Default to the
    # bare hostname so ~/.ssh/config can supply the user; override with env.
    WEB_SSH_TARGET="${WEB_SSH_TARGET:-tinycld.org}"
    # Host-side path backing the container's /workspace/website volume. No safe
    # universal default — depends on the host's Dokku storage mount — so require it.
    WEB_REMOTE_PATH="${WEB_REMOTE_PATH:-}"
    if [ -z "$WEB_REMOTE_PATH" ]; then
        echo "[deploy] ERROR: WEB_REMOTE_PATH is required for 'web' mode." >&2
        echo "[deploy] Set it to the host path backing the container's /workspace/website volume, e.g.:" >&2
        echo "[deploy]   WEB_REMOTE_PATH=/var/lib/dokku/data/storage/tinycld.org-website $0 web" >&2
        exit 1
    fi

    [ -d "$SITE_REPO" ] || { echo "[deploy] ERROR: web member not found at $SITE_REPO" >&2; exit 1; }

    # Source commit for the confirm gate / log (web member is its own git repo).
    SITE_COMMIT_SHORT=$(git -C "$SITE_REPO" rev-parse --short HEAD 2>/dev/null || echo 'unknown')

    echo "[deploy] mode=web target=${WEB_SSH_TARGET}:${WEB_REMOTE_PATH} site=$SITE_REPO ($SITE_COMMIT_SHORT)"

    # Build the site (same commands the old Dockerfile.org website-builder ran).
    echo "[deploy] Building site in $SITE_REPO ..."
    ( cd "$SITE_REPO" && pnpm install --frozen-lockfile && pnpm run build )

    DIST_DIR="$SITE_REPO/dist"
    # Guard: never rsync --delete an empty/missing tree over a live site.
    if [ ! -d "$DIST_DIR" ] || [ -z "$(ls -A "$DIST_DIR" 2>/dev/null)" ]; then
        echo "[deploy] ERROR: build produced no files at $DIST_DIR — aborting before rsync." >&2
        exit 1
    fi

    # Confirm gate (mirrors the org/com gate). Skip when stdin isn't a TTY
    # (CI / piped) or DEPLOY_YES=1.
    if [ "${DEPLOY_YES:-}" != "1" ] && [ -t 0 ]; then
        printf '[deploy] Press Enter to rsync the site to %s:%s, or Ctrl-C to cancel... ' "$WEB_SSH_TARGET" "$WEB_REMOTE_PATH"
        read -r _ || true
    fi

    # --delete prunes stale hashed _astro/ assets; --delay-updates stages files
    # then renames at transfer end, shrinking the half-updated-site window on the
    # flat dir. Trailing slash on the source copies dist/'s CONTENTS into the
    # remote dir (not a nested dist/ subdir).
    echo "[deploy] Syncing $DIST_DIR/ -> ${WEB_SSH_TARGET}:${WEB_REMOTE_PATH}/ ..."
    if ! rsync -a --delete --delay-updates --stats "$DIST_DIR/" "${WEB_SSH_TARGET}:${WEB_REMOTE_PATH}/"; then
        echo "[deploy] ERROR: rsync to ${WEB_SSH_TARGET}:${WEB_REMOTE_PATH} failed." >&2
        exit 1
    fi

    echo "[deploy] Deployed website (site:$SITE_COMMIT_SHORT) to ${WEB_SSH_TARGET}:${WEB_REMOTE_PATH}"
    exit 0
fi
```

- [ ] **Step 3: Update the usage header**

In `utils/deploy.sh`, the usage comment block at the top (lines 4-23) documents `org` and `com`. Add a `web` entry. Find the end of the `com` block (the line ending the com-mode description, just before the `# The mode (org|com) is REQUIRED.` line) and insert a `web` section, then update the REQUIRED line. Change:

```bash
#   deploy.sh com                               # tinycld.com (production)
#                                               #   - omits website/ subtree
#                                               #   - uses tinycld/Dockerfile + Dockerfile.com
#                                               #     (no website-builder stage; keeps sentry-deploy)
#                                               #   - target: dokku@tinycld.com:tinycld.com
#                                               #   - host must leave AUTOCERT_ENABLED unset/false so
#                                               #     the entrypoint binds plain HTTP on :7090, behind
#                                               #     a reverse proxy that terminates TLS upstream.
#                                               #     Set PRIMARY_DOMAIN (and PUBLIC_SCHEME=https) so
#                                               #     the printed setup URL points at the real host.
#
# The mode (org|com) is REQUIRED. Each mode infers its dokku remote; override
# either with the DOKKU_REMOTE env var.
```

to:

```bash
#   deploy.sh com                               # tinycld.com (production)
#                                               #   - omits website/ subtree
#                                               #   - uses tinycld/Dockerfile + Dockerfile.com
#                                               #     (no website-builder stage; keeps sentry-deploy)
#                                               #   - target: dokku@tinycld.com:tinycld.com
#                                               #   - host must leave AUTOCERT_ENABLED unset/false so
#                                               #     the entrypoint binds plain HTTP on :7090, behind
#                                               #     a reverse proxy that terminates TLS upstream.
#                                               #     Set PRIMARY_DOMAIN (and PUBLIC_SCHEME=https) so
#                                               #     the printed setup URL points at the real host.
#
#   deploy.sh web                               # website-only (tinycld.org)
#                                               #   - builds the Astro site (web member) and rsyncs
#                                               #     dist/ onto the host's /workspace/website volume
#                                               #     over SSH — NO image rebuild, NO git push
#                                               #   - requires a real shell SSH login to the host
#                                               #     (NOT the dokku@ git user) and:
#                                               #       WEB_SSH_TARGET  (default: tinycld.org)
#                                               #       WEB_REMOTE_PATH (REQUIRED — host path backing
#                                               #                        the container's /workspace/website)
#                                               #   - the live site updates the moment rsync finishes
#
# The mode (org|com|web) is REQUIRED. The org/com modes infer a dokku remote
# (override with DOKKU_REMOTE); web uses WEB_SSH_TARGET / WEB_REMOTE_PATH.
```

Also update the `-h|--help` handler, which currently prints `sed -n '4,23p' "$0"` — widen the range so the new `web` lines show. Change:

```bash
        -h|--help)
            sed -n '4,23p' "$0"; exit 0
            ;;
```

to:

```bash
        -h|--help)
            sed -n '4,34p' "$0"; exit 0
            ;;
```

(After inserting the `web` usage block above, the usage comment runs to ~line 34. If the implementer's line count differs, set the upper bound to the line of the `# either with the DOKKU_REMOTE / web uses ...` closing comment.)

- [ ] **Step 4: Syntax-check the script**

Run: `bash -n utils/deploy.sh`
Expected: no output (syntax OK).

- [ ] **Step 5: Verify the mode is rejected cleanly without WEB_REMOTE_PATH**

Run: `cd utils && WEB_REMOTE_PATH= ./deploy.sh web < /dev/null`
Expected: prints the `ERROR: WEB_REMOTE_PATH is required for 'web' mode.` message and exits non-zero, WITHOUT running pnpm or rsync. (Confirms the early guard fires before any build.)

Run: `cd utils && ./deploy.sh --help`
Expected: usage text that now includes the `deploy.sh web` section.

- [ ] **Step 6: Verify the missing-member guard (no network/build)**

Run: `cd utils && SITE_REPO=/tmp/definitely-not-here WEB_REMOTE_PATH=/tmp/x ./deploy.sh web < /dev/null`
Expected: prints `ERROR: web member not found at /tmp/definitely-not-here` and exits non-zero before building.

- [ ] **Step 7: Commit**

```bash
git -C utils add deploy.sh
git -C utils commit -m "feat(deploy): add website-only 'web' mode (rsync to volume)"
```

---

## Task 5: Manual end-to-end verification (no code)

This task has no code changes — it documents the manual checks to run against the real host before considering the feature done. (The deploy script has no automated harness; these are operator steps.)

- [ ] **Step 1: Dry-run the rsync against the real host**

From the workspace root, with the real values:

Run: `cd web && pnpm install --frozen-lockfile && pnpm run build && rsync -a --delete --delay-updates --dry-run --stats dist/ "$WEB_SSH_TARGET:$WEB_REMOTE_PATH/"`
Expected: rsync lists the files it WOULD transfer and exits 0. No actual changes made. Confirms SSH auth + the remote path are correct.

- [ ] **Step 2: Real web deploy**

Run: `cd utils && WEB_SSH_TARGET=<host> WEB_REMOTE_PATH=<host-path> ./deploy.sh web`
Expected: builds, prompts for Enter, rsyncs, prints `Deployed website (site:<sha>) to <target>`.

- [ ] **Step 3: Confirm the live site updated**

Run: `curl -sSI https://tinycld.org/ | head -n 1`
Expected: `HTTP/2 200` (or `HTTP/1.1 200`). Then load `https://tinycld.org/` in a browser and confirm the latest content is served, and that an app route (e.g. `https://tinycld.org/a/<orgSlug>/...`) still serves the app shell (website dir must not shadow app routes — `StaticWithDynamicFallback` already orders website → public → SPA fallback).

- [ ] **Step 4: Confirm a full `org` deploy still works without a baked site**

After the next routine `deploy.sh org`, confirm the website is still served (it now comes from the volume that Task 4's `web` deploy populated, not the image). If the host's `/workspace/website` were ever empty, the site would 404 to the app shell — re-run `deploy.sh web` to repopulate.

---

## Self-Review Notes

- **Spec coverage:** Server default (Task 1), entrypoint flag (Task 2), Dockerfile.org trim (Task 3), new `web` mode + usage doc (Task 4), error handling for absent member / empty build / rsync failure / required `WEB_REMOTE_PATH` (Task 4 steps 2,5,6), manual rsync `--dry-run` verification (Task 5). All spec sections map to a task.
- **Type/name consistency:** `--websiteDir=/workspace/website` matches between entrypoint (Task 2) and the volume path the server resolves (`<TINYCLD_STATE_DIR>/website` with `TINYCLD_STATE_DIR=/workspace`, Task 1). `WEB_SSH_TARGET` / `WEB_REMOTE_PATH` / `SITE_REPO` / `DIST_DIR` used consistently in Task 4. `web` mode string consistent across parser, error messages, and code path.
- **Out-of-scope items honored:** no versioned `current` symlink for the site, no PB-storage/S3 path, no `com`-mode change.
