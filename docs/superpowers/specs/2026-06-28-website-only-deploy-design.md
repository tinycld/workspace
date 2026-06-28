# Website-only deploy from the state volume

**Date:** 2026-06-28
**Status:** Approved — ready for implementation plan

## Goal

Deploy the marketing site (`tinycld.org`) independently of the app image. A new
`deploy.sh web` mode builds the Astro site and rsyncs it to the running host in
seconds — no Docker rebuild, no `git push` to Dokku, no app downtime.

Today the only way to update the site is `utils/deploy.sh org`, which rebuilds the
entire image (app shell, Go server, PocketBase, website) and pushes it to Dokku.

## Background

- `web/` is a static Astro site (`tinycld.org`) that builds to `web/dist/` via
  `pnpm run build` (`astro build && node scripts/build-search.mjs`).
- Deploys target **Dokku** over `git push` to `dokku@tinycld.org:tinycld.org`
  (org mode) / `dokku@tinycld.com:tinycld.com` (com mode). There is no rsync/scp
  channel today.
- Runtime mutable state lives on a persistent volume at `/workspace`
  (`TINYCLD_STATE_DIR=/workspace`): `pb_data`, `releases`, `builds`. The entrypoint
  promotes per-deploy app bundles into `/workspace/releases` and swaps a `current`
  symlink — the app already updates without an image rebuild for in-app installs.
- The Go server serves static files in order: `websiteDir` (marketing site) →
  `publicDir` (app static files) → SPA fallback (`<releasesDir>/current/app.html`).
  See `StaticWithDynamicFallback` in
  `tinycld/core/server/coreserver/static.go`. A missing/empty `websiteDir` is
  treated as "no website" and serving degrades gracefully to the app shell.
- **Currently** `DefaultWebsiteDir()` resolves to `<binaryDir>/website` — relative
  to the active build tree baked into the image — which is why a site update needs
  a full image rebuild. `Dockerfile.org` builds the site in a `website-builder`
  stage and `COPY`s it to `./website/`. `Dockerfile.com` has no website.

## Approach

Move the website off the baked image and onto the persistent `/workspace` volume,
served from a single flat dir `/workspace/website/`. A new `deploy.sh web` mode
builds `web/dist/` locally and rsyncs it straight to the host filesystem path
backing that volume over SSH. The volume is the **sole** source of the site — the
image no longer carries it.

This was chosen over (B) serving the site out of PocketBase storage and (C) a
separate static host/bucket. (A) reuses the existing state-volume model with the
least new machinery and no new infra.

### Decisions locked during brainstorming

- **Transport:** direct `rsync` over SSH to the host (not tar-over-dokku, not
  git push). Assumes a real SSH login to the `tinycld.org` host with access to the
  host-side path backing `/workspace/website`.
- **Seeding:** none. The volume is the only source; the image does **not** bake the
  site. A brand-new host serves no website until the first `deploy.sh web` (the
  server degrades gracefully to the app shell meanwhile).
- **Path layout:** single flat dir `/workspace/website/`, rsync in place (no
  versioned `<id>` dirs, no `current` symlink for the site).

## Changes

### 1. Server — `tinycld/core/server/coreserver/static.go`

`DefaultWebsiteDir()` resolves to the state-volume path instead of the binary dir:

- When `TINYCLD_STATE_DIR` is set → `<TINYCLD_STATE_DIR>/website`.
- When unset (`go run` / dev) → `./website` (unchanged fallback).

Use the same state-dir resolution the releases dir uses (`resolveStateDir()` /
`stateReleasesDir()` precedent) so all dirs agree on the state root.

`StaticWithDynamicFallback` is **unchanged** — it already handles an empty/missing
`websiteDir`.

### 2. Entrypoint — `tinycld/config/entrypoint.sh`

Add `--websiteDir=/workspace/website` to `PB_SERVE_DIRS` so the binary reads the
site from the volume regardless of which build `current` points at. **No seeding
step.** (The Go default from change 1 would resolve to the same path via
`TINYCLD_STATE_DIR`, but pin it explicitly here alongside the other `--*Dir` flags
for clarity and parity with `--releasesDir`/`--dir`.)

### 3. Dockerfile — `utils/Dockerfile.org`

Remove the entire `website-builder` stage and the
`COPY --from=website-builder /website/dist/ ./website/` line. The image no longer
carries the site. Remove the long `website/` vs `public/` / `expo export`
absorption comment — that hazard no longer exists once the site lives only on the
volume. Keep the sentry-deploy hook and the ENTRYPOINT/EXPOSE re-declaration tail
exactly as-is.

### 4. New `deploy.sh web` mode — `utils/deploy.sh`

A third mode alongside `org`/`com`, on a **completely separate short code path** —
it does NOT touch the git-graft / Dockerfile / `git push` machinery the image modes
use. Steps:

1. Resolve the web member (`SITE_REPO`, default `$WS_ROOT/web`) and SSH target via
   new env vars `WEB_SSH_TARGET` and `WEB_REMOTE_PATH`, defaulting to the
   `tinycld.org` host and the host-side path backing `/workspace/website`. Both
   overridable by env (mirrors how `DOKKU_REMOTE` is overridable).
2. Build the site: `pnpm install --frozen-lockfile && pnpm run build` in the web
   member (same commands the old `website-builder` Docker stage ran), producing
   `web/dist/`.
3. Enter-to-confirm gate (same UX as the image deploys): print the resolved SSH
   target + source commit; Ctrl-C cancels.
4. `rsync -a --delete --delay-updates web/dist/ <WEB_SSH_TARGET>:<WEB_REMOTE_PATH>/`
   — `--delete` prevents stale hashed `_astro/` assets accumulating;
   `--delay-updates` stages then renames at transfer end to shrink the
   half-updated-site window on the flat dir.
5. Print a confirmation line in the existing `[deploy] Deployed …` style with the
   rsync'd file count.

Extend the mode parser (currently accepts `org|com` once) to accept `web` and route
to the new path **before** any image-build logic runs.

### 5. Usage doc — `utils/deploy.sh` header

Add the `web` mode to the usage block; document `WEB_SSH_TARGET` / `WEB_REMOTE_PATH`
and note it requires a real SSH login to the host (not just the dokku git user).

## Error handling

- Fail fast with a clear message if the web member dir is absent (partial workspace
  assembly without `web/`).
- Fail fast if `pnpm run build` produces no `dist/` or an empty one — never rsync
  `--delete` an empty tree over a live site.
- rsync's non-zero exit aborts (`set -euo pipefail` already in effect); print the
  SSH target on failure to aid diagnosis.

## Testing

- Unit test in `tinycld/core/server/coreserver/static_test.go` for
  `DefaultWebsiteDir()`: `TINYCLD_STATE_DIR` set → `<state>/website`; unset →
  `./website`. Place alongside the existing static-serving tests.
- The deploy script is shell with no test harness in the repo; verify manually with
  `rsync --dry-run` against the real host before the real run. The Enter-to-confirm
  gate guards against firing at the wrong target.

## Out of scope (YAGNI)

- Versioned releases / `current` symlink for the website (flat dir chosen).
- PocketBase-storage or S3 serving path.
- CDN, second Dokku app, DNS changes.
- Any change to `com` mode (it never had a website).
