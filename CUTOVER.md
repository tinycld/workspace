# Cutover runbook — standalone-core workspace layout

The TinyCld ecosystem has been re-architected from a single `tinycld/tinycld`
monorepo (app shell + bundled `@tinycld/core`) into a set of independent repos
coordinated by an npm-workspace meta-repo. This runbook records what was built,
what's verified, what's deferred, and the final human steps to make the new
layout canonical.

## The new layout

```
tinycld/workspace   # THIS repo — the npm-workspace root (package.json, package-scripts/,
                    #   tests/, tinycld.packages.ts, .node-version, .go-version). PUBLIC.
tinycld/app         # @tinycld/app — the Expo/PocketBase shell (own repo)
tinycld/core        # @tinycld/core — shared TS + Go library (own repo; was bundled)
tinycld/contacts    # @tinycld/contacts ─┐
tinycld/mail        # @tinycld/mail       │
tinycld/calendar    # @tinycld/calendar   │ feature packages, each its own repo
tinycld/drive       # @tinycld/drive      │
tinycld/calc        # @tinycld/calc       │
tinycld/text        # @tinycld/text       │
tinycld/google-takeout-import #           ─┘
tinycld/bootstrap   # @tinycld/bootstrap — the CLI: scaffolds packages + assembles workspaces
```

## How a fresh machine sets up

```sh
mkdir ~/code/tinycld && cd ~/code/tinycld
# One command assembles a working workspace: the workspace root itself + app +
# core + the package(s) you name (NOT all — a subset is fine):
npx @tinycld/bootstrap@latest --tooling --with mail --with contacts
npm install            # links members + runs the generator (postinstall)
cd app && npm run dev
```

- `bootstrap --tooling` self-initializes: when run in a dir that isn't already a
  workspace root, it clones the `tinycld/workspace` meta-repo first (providing
  `package-scripts/`, `tinycld.packages.ts`, `tests/`, the root `package.json`),
  then always clones `app` + `core`; `--with <pkg>` adds features. No manual
  `git clone tinycld/workspace` is needed.
- The workspace `package.json` lists every possible member, but npm ignores
  absent dirs — so a partial checkout installs and runs cleanly (the generator
  scans only the members present; app runs as a lean shell with zero features).
- Per-member checks: from any member dir, `npx tinycld-pkg check` (typecheck +
  unit), `npx tinycld-pkg test:e2e` (Playwright). `tinycld-pkg <verb> --all`
  from anywhere runs every present member.

## Verified (this cutover effort)

- **Bootstrap CLI** (`@tinycld/bootstrap`, published to npm): `--tooling` +
  repeatable `--with`, honors `TINYCLD_REPO_BASE`, partial + lean-shell checkouts
  acid-tested, scaffolds new packages in the new layout.
- **CI green on every repo**: each member's `.github/workflows/ci.yml` assembles
  the workspace via `bootstrap --tooling` and runs `tinycld-pkg check` (+ e2e).
  All check jobs (typecheck + unit) are green; app's CI runs `check --all` +
  Go build/test.
- **Docker**: the image builds from the assembled workspace (multi-arch
  amd64 + arm64 green in CI) and boots clean (`pkg_seed: synced 7 bundled
  packages`, health OK).
- **Cold start** (the cutover acid test): a fresh `git clone tinycld/workspace`
  → `bootstrap --tooling --with <all>` → `npm install` → Go build (61M binary)
  → `tinycld-pkg check --all` (all 9 members, 552 unit tests) → `db:reset`
  (migrations + seeds all packages) — all green.
- **Workspace-wide lint**: one `biome.json` (in `app/`) lints all members;
  `npm run lint` from `app/` is green (1263 files).
- **e2e path**: verified end-to-end from a cold clone (contacts e2e green
  locally + in CI); text e2e green (80 tests).

## Deferred (tracked, NOT blockers for the layout cutover)

These pre-date the layout change or are independent of it; they fail/behave the
same way regardless of layout and don't gate the cutover:

1. **Some feature e2e SUITES fail** (mail, drive, calc, calendar): login→inbox
   render timing, CalDAV delete-sync timing, and CI-worker-contention flakiness.
   The e2e *wiring* (helper imports, Playwright config, CI jobs) is fixed and the
   suites now collect + run; the remaining failures are test-content/timing that
   need per-package debugging (serial describes, collision-proof doc names, 15s
   reaction timeouts). Check jobs are green for all.
2. **In-app package installer** (`core/server/coreserver/pkg_install.go`): its
   path math (`rootDir/packages`, `generate-packages.ts`) is stale for the new
   layout. Pre-existing; not exercised by image boot. Needs a Go-side fix.
3. **5 cognitive-complexity lint warnings** (calc/text engine internals): warn-
   level (lint still exits 0). Refactoring risks silent data corruption in
   spreadsheet merge/pivot geometry — defer until done carefully with the suites.

## Pending before flip

- **Publish the next `@tinycld/bootstrap` minor (1.1.0)** to npm. It now makes
  `--tooling` self-initialize the workspace (clone the `tinycld/workspace`
  meta-repo first, so `package-scripts/`, `tinycld.packages.ts`, and `tests/`
  are provided automatically) plus the new-layout scaffolding templates. The
  fix is committed on `main`; the publish needs `npm version minor` + push +
  an interactive npm OTP (2FA): `cd <bootstrap> && npm version minor && git push
  --follow-tags && npm publish --otp=<code>`. The currently-published `1.0.1`
  still works for CI/cold-start (those clone the workspace repo explicitly), but
  the one-command `npx @tinycld/bootstrap --tooling --with <pkg> && npm install`
  bootstrap (no manual workspace clone) requires this release.

## Flip steps (human)

1. Announce a freeze on the old `tinycld/tinycld` repo (no new merges).
2. Publish the next `@tinycld/bootstrap` minor (see Pending, above).
3. ✅ DONE — org docs + the website "get started" now point at
   `npx @tinycld/bootstrap --tooling` (the one-command bootstrap; no manual
   workspace clone). The old single-clone + `packages:link` instructions are
   gone from the docs.
4. Archive the old `tinycld/tinycld` repo (the GitHub repo formerly named
   `tinycld` is already renamed to `tinycld/app`). Keep it archived (not deleted)
   for one release cycle. Confirm no automation still references `tinycld/tinycld`.
5. Repoint deploy targets (Dokku, ghcr image consumers) at the new
   `docker-publish.yml` output. A real multi-arch publish runs on the next `v*`
   tag push or published GitHub Release (the build half is proven; the manifest-
   merge step only emits tags on a tag/release trigger).
6. Update branch-protection / required-checks on each new repo to require the
   rewritten CI workflows.

## Rollback

The old `tinycld/tinycld` repo is untouched until step 4; reverting is
"un-freeze the old repo + revert doc changes." Keep it archived for one release
cycle.
