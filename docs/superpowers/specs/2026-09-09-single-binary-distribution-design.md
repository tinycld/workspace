# Single-binary distribution for self-hosters

**Status:** design
**Date:** 2026-09-09

## Problem

Self-hosting TinyCld today means Docker: `docker-compose.yml`, a
`ghcr.io/tinycld/tinycld` image of roughly 600 MB compressed / 2.5 GB
uncompressed, and a bind-mounted volume. That is a high bar for someone who
just wants to run the thing on a box.

Almost none of that weight is the application. The server is already a single
statically-linked, CGO-free Go binary: pure-Go SQLite (`modernc.org/sqlite`),
pure-Go image and document processing (`omnidoc` — no libvips, no ImageMagick,
no ffmpeg), and PocketBase linked in as a library rather than run as a
sidecar. The image carries Node, pnpm, corepack, git, the entire Go toolchain,
a hoisted `node_modules`, the pnpm content-addressable store, and the vendored
PocketBase source **solely** to support the in-app package installer, which
recompiles the Go server and re-runs `expo export` inside the running
container.

Give up in-place rebuilds for self-hosters and all of it becomes unnecessary.

## Goal

One file. A self-hoster downloads a binary for their platform, runs it, and
has a working TinyCld. Upgrading means downloading a new release and
restarting.

## Non-goals

- **Replacing Docker anywhere else.** Docker Compose, Dokku (`tinycld.org`),
  and the hosting router (`tinycld.com`) keep working exactly as they do
  today. This adds a distribution artifact; it removes nothing.
- **Runtime package installation.** No self-update, no build service, no
  recipe negotiation, no toolchain in the runtime.
- **Third-party Go packages** for this distribution. The binary ships the
  first-party set. Third-party packages remain a Docker/hosting capability.
- **Bit-reproducible builds.** Expo/Metro output is not bit-reproducible in
  practice, a limitation already recorded in
  `hosting/docs/DESIGN-org-package-agency.md` (D3).

## Measured size

A real `linux/amd64` build with the full web bundle, all 136 migrations, and
all 3 hook files embedded:

| | Size |
| --- | --- |
| Baseline, no embed (`-trimpath -ldflags="-s -w"`) | 51.9 MB |
| **With all assets embedded** | **64.0 MB** |
| Embed cost | +12.1 MB |
| Release download, gzip | 23.2 MB |
| Release download, xz | 17.6 MB |

Embedded content was verified present in the output rather than
dead-code-eliminated. Go stores embedded bytes uncompressed, so the embed cost
tracks payload size almost exactly.

Two findings from the measurement:

- **Source maps must never be embedded.** `tinycld/dist` is 48 MB, but 37 MB
  of that is 104 `.map` files. They ship to Sentry separately, which
  `--source-maps external` in the Dockerfile already arranges. Embedding them
  would produce a ~100 MB binary for zero runtime benefit.
- **Migrations (772 KB) and hooks (12 KB) are rounding errors.** Essentially
  all weight is the web bundle, whose largest single item is one 7.4 MB
  `__common` chunk.

64 MB is unremarkable for a self-hosted server binary and replaces a 2.5 GB
image. Size is not a constraint on this design.

Caveat: the baseline was built from the current workspace's member set
(boards, calc, calendar, contacts, drive, mail, text, search-alpha,
search-beta). A full first-party build may differ by a few MB.

## Architecture

### What ships

One binary per platform (`linux/amd64`, `linux/arm64`, `darwin/arm64`), built
`CGO_ENABLED=0`, containing:

- the server (PocketBase as a library — already the case)
- every first-party package's Go `Register(app)`, as a fixed list
- the Expo web bundle, embedded, without source maps
- all JS migrations, embedded
- the packages' `.pb.ts` hooks, embedded

### What stays on disk

A single data directory: SQLite, uploads, and TLS certificates. Nothing else
is written.

### Mode

The binary is already dual-mode — `main.go:41` dispatches to
`tenantmain.Run()` when `--org-dir` is present. This adds no third mode.
Self-host is the existing single-org path with assets sourced from an
`embed.FS` instead of disk.

## Embedding

Three assets move into the binary using one consistent pattern: accept an
`fs.FS` when provided, fall back to the existing path-based behavior when not.
Nil defaults preserve current behavior byte-for-byte, so the container and
hosting paths are unaffected.

### Web bundle

`StaticWithDynamicFallback(publicDir, websiteDir, releasesDir)`
(`tinycld/core/server/coreserver/static.go:312`) is already written against
`fs.FS` internally; it merely constructs them with `os.DirFS`. Change the
signature to accept `fs.FS` values directly. The three-tier lookup — website,
then the app's public files, then SPA fallback to `app.html` — is unchanged.

### Migrations and hooks

These require a change to the vendored PocketBase fork, confined to one
function. `filesContent(dirPath, pattern)`
(`tinycld/third_party/pocketbase/plugins/jsvm/jsvm.go:706`) is the only place
hook and migration source is read, with exactly two callers: `registerMigrations`
(line 284) and `registerHooks` (line 360). It already returns
`map[string][]byte`, so content is fully materialized before execution.

The change:

- add `MigrationsFS` and `HooksFS` of type `fs.FS` to `jsvm.Config`
- add `filesContentFS`, differing from `filesContent` only in using
  `fs.ReadDir` / `fs.ReadFile`
- branch at the two call sites
- guard `filepath.Abs(HooksDir)` (lines 289, 394) and the
  `prependToEmptyFile` loop (lines 365-380), which are dev-time conveniences

Roughly 40 lines. Existing callers — `tenantmain.go`, `rlstest.go`, and the
test suite — need no changes.

Two properties make this safe:

- **No module resolution.** No migration or hook uses `require()`, `import`,
  or the `$os` / `$filesystem` / `$filepath` bindings. There is no resolver to
  satisfy and no runtime disk access to intercept.
- **TypeScript transpiles in-process.** `transformSource`
  (`plugins/jsvm/transform.go:23`) runs esbuild in pure Go. `.pb.ts` files
  embed as raw TypeScript and compile at startup; no build step is needed.

### Fork divergence

This is a permanent divergence carried across PocketBase rebases. The fork
already carries `Sandboxed`, `ExecTimeout`, `ProgramSource`, `OnInit`,
`OnLoaderInit`, `Callable`, and the esbuild transform, so this is small
marginal debt of the same kind, and is plausibly upstreamable.

### Possible scope reduction

The three hook files total 160 lines of customization scaffolding; the real
behavior lives in each feature's Go `server/register.go`. If nothing
load-bearing registers through them, the binary could ship with no hooks —
`registerHooks` returns early when no files are found — reducing the fork
change to a single call site.

The load-order constraint documented at `coreserver/server.go:132-138` is that
a package's `$`-bindings must exist *before* jsvm executes hook files
synchronously — otherwise a hook calls an undefined global
(`webdavHook is not defined`). It does not require hook files to exist, and
`registerHooks` returns early when none are found, so shipping without them
looks viable. **Verify during implementation; do not assume.** The design does
not depend on it either way.

## Configuration

The binary is configured by CLI flags, with environment variables as
equivalents for service-manager use. There is no config file: the setup UI and
flags are the only two sources of truth, so there is nothing to keep in sync.

| Flag | Env | Default | Purpose |
| --- | --- | --- | --- |
| `--data-dir` | `TINYCLD_DATA_DIR` | `./tinycld-data` | Root for all mutable state |
| `--sqlite-dir` | `TINYCLD_SQLITE_DIR` | `<data-dir>/pb_data` | SQLite location, separable for putting the DB on different storage |
| `--http` | `TINYCLD_HTTP` | `127.0.0.1:8090` | HTTP listen address |
| `--https` | `TINYCLD_HTTPS` | unset | Enables autocert when set |

Flags win over environment variables. `resolveStateDir()`
(`coreserver/state_paths.go:17`) is the single existing chokepoint for state
paths and already honors `TINYCLD_STATE_DIR`; the flags feed it and the
existing `coreserver.Options` path fields, rather than introducing a parallel
mechanism.

Splitting `--sqlite-dir` from `--data-dir` exists because uploads grow
without bound while the database benefits from faster storage. It defaults
inside the data dir so the simple case stays one directory.

### First run

`./tinycld` with no arguments:

1. creates the data directory beside the binary
2. applies all embedded migrations against the fresh database
3. listens on `127.0.0.1:8090`
4. prints a setup URL carrying a first-run token to stdout

Binding `:80` / `:443` for autocert requires `CAP_NET_BIND_SERVICE` or a
reverse proxy. This is documented, not solved by the binary. Mail ports
(`993`, `465`) remain opt-in, as today.

The default listen address is loopback rather than `0.0.0.0`: a first run
should not expose an unconfigured instance to the network. Binding publicly is
an explicit `--http` choice.

## Feature enable/disable

All packages' migrations always run, so every schema object exists in every
database. Disabling a feature hides its navigation entry and routes and skips
its registration. Enabling it back is a flag flip.

The alternative — creating a package's tables on first enable — inherits
migration ordering and dependency complexity and makes disable-then-re-enable
a question needing a careful answer. Since migrations are owner-tracked
(`pb_migrations_owner.json`) and auto-applied at boot, gating only the UI
avoids a class of ordering bugs. The cost is unused tables in databases where
a feature is off, which is cheap.

## Build configuration changes

Three settings differ from the container build.

- **`HooksWatch: false`.** The fsnotify watcher is meaningless against
  embedded hooks. Precedent exists at `coreserver/tenant.go:184`, which
  already hard-codes this for hosting tenants. Side effect: with the watcher
  off, a malformed hook file panics at load rather than logging in red. For a
  fixed, shipped asset set, failing loudly at startup is the correct behavior.
- **`migratecmd` not registered.** Its `Dir` is write-only, used solely to
  *generate* migration files. Applying migrations runs off the in-memory
  `core.AppMigrations` registry that jsvm populates, so nothing is lost at
  runtime. `migrate create` and `migrate collections` are dev-time authoring
  commands.
- **`Automigrate: false`.** This is a user-visible behavior change, not
  cleanup. Today, editing a collection through the admin UI writes a new
  migration file. In a single binary there is nowhere to write, so schema
  editing via the admin UI no longer produces migrations. Anyone depending on
  that workflow must use a development workspace. **This must be stated
  plainly in the release notes.**

`TypesDir` points at a writable location or accepts the existing non-fatal
warning; `refreshTypesFile` already treats errors as warnings.

## Build and release

A GitHub Actions job, essentially the existing Dockerfile's builder stages
without the runtime image:

1. assemble the workspace at the pinned member set; `pnpm install --frozen-lockfile`
2. run the generator (`pnpm run packages:generate`)
3. `pnpm exec expo export --platform web --source-maps external`
4. **materialize the symlink farms.** `tinycld/server/pb_hooks/` and
   `tinycld/server/pb_migrations/` are gitignored symlinks into the sibling
   repos, and `go:embed` does not follow symlinks. The Dockerfile already does
   this at lines 280-283, and the ordering constraint documented there — it
   must run *after* `expo export` — applies here too.
5. stage the embed payload, **excluding `*.map`**
6. `go build` per platform with `CGO_ENABLED=0 -trimpath -ldflags="-s -w"`
7. publish binaries plus `SHA256SUMS` to the GitHub release

No builder service, no recipe hashes, and no `LimitsDir` — that is hosting's
enforcement package and does not belong in a self-host binary. For a fixed
package set this is a straightforward cross-compile.

### Verification

Each release publishes a `SHA256SUMS` file, with verification instructions in
the README. This covers accidental corruption and mirror tampering without
introducing key management.

Signing (Sigstore/cosign keyless via GitHub OIDC) is a deliberate follow-up
once the distribution proves out. No signing exists anywhere in the project
today, so checksums are a strict improvement rather than a regression.

## Testing

- **Boot test:** the binary starts against an empty data directory with no
  network access, applies migrations, and serves the SPA shell. This is the
  check that assets are genuinely embedded and nothing reaches for a missing
  file at runtime.
- **End-to-end:** copy the built binary into a clean temporary directory, run
  it, complete setup, and exercise one route per bundled package. Follows the
  existing e2e conventions in `tinycld/tests/e2e/helpers.ts` — drive the UI,
  never raw PocketBase REST for mutations.
- **Flag coverage:** `--data-dir` and `--sqlite-dir` place files where
  specified, including when the SQLite directory is outside the data
  directory.
- **Fork regression:** existing jsvm tests must pass unchanged with nil
  `MigrationsFS` / `HooksFS`, proving path-based behavior is untouched.
- **Size guard:** CI fails if the binary exceeds a threshold (suggested 100
  MB against the measured 64 MB). This catches an accidental re-addition of
  source maps, which is the specific regression that would otherwise pass
  silently.

## Risks

| Risk | Mitigation |
| --- | --- |
| Fork divergence grows harder to rebase | Confined to one function with nil-default fallback; upstreamable |
| Source maps re-added to the embed | CI size guard fails the build |
| `Automigrate: false` surprises admin-UI schema editors | Called out explicitly in release notes |
| Hook embedding blocked by the Go-to-TS hook machinery | Verified during implementation; hooks-less shipping is a fallback that shrinks the change |
| Self-host and container builds diverge in behavior | Shared `coreserver.Options`; only the three documented settings differ |

## Open questions

None blocking. The `webdavHook` dependency noted under **Possible scope
reduction** is a scope question to resolve during implementation, and the
design works either way.
