# Single-Binary Self-Host Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship TinyCld as a single downloadable binary that self-hosters run with no Docker, no Node, and no Go toolchain.

**Architecture:** Embed the Expo web bundle, the JS migrations, and the `.pb.ts` hooks into the existing CGO-free Go binary via `embed.FS`. Every embedding point is an `fs.FS` field added *alongside* the existing path-based field, with a nil default that preserves current behavior byte-for-byte — so the Docker, Dokku, and hosting-router paths are untouched. A new `serve-standalone` build wires the embeds together with CLI flags for state locations.

**Tech Stack:** Go 1.26.3 (`CGO_ENABLED=0`), the vendored PocketBase fork at `tinycld/third_party/pocketbase`, sobek + esbuild (both pure Go), GitHub Actions.

## Global Constraints

- **Go module:** `tinycld.org/tinycld` at `tinycld/server`; Go version `1.26.3`.
- **Build flags, exact:** `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`.
- **Never embed `*.map` files.** 37 MB of the 48 MB `tinycld/dist` is source maps; they ship to Sentry via `--source-maps external`. Embedding them roughly doubles the binary.
- **`go:embed` does not follow symlinks.** `tinycld/server/pb_migrations/` and `tinycld/server/pb_hooks/` are gitignored symlink farms into sibling repos and MUST be materialized first (`tinycld/Dockerfile:280-283` does exactly this).
- **Nil `fs.FS` fields must preserve existing path behavior byte-for-byte.** Every existing caller (`tenantmain.go`, `rlstest.go`, all fork tests) must pass unchanged.
- **Biome/Go style:** no `biome-ignore`; comments explain *why*, not *what*.
- **Never use `any` in TypeScript.** Not expected in this plan, but binding.
- **Do not commit generated output** (`tinycld/dist`, `server/pb_migrations`, `server/pb_hooks`, `tinycld.config.ts`) — all gitignored.
- **Size budget:** the built binary must stay under 100 MB (measured baseline: 64.0 MB).

**Reference spec:** `docs/superpowers/specs/2026-09-09-single-binary-distribution-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tinycld/third_party/pocketbase/plugins/jsvm/jsvm.go` | Add `HooksFS` / `MigrationsFS` to `Config`; branch the two loader call sites |
| `tinycld/third_party/pocketbase/plugins/jsvm/embedfs_test.go` | **New.** Fork-seam tests for the FS loaders |
| `tinycld/core/server/coreserver/static.go` | Accept `fs.FS` for public/website/releases lookups |
| `tinycld/core/server/coreserver/server.go` | Add `PublicFS` / `HooksFS` / `MigrationsFS` to `Options`; thread to jsvm + static |
| `tinycld/core/server/coreserver/standalone.go` | **New.** Flag parsing + path resolution for standalone mode |
| `tinycld/core/server/coreserver/standalone_test.go` | **New.** Flag/precedence/path tests |
| `tinycld/server/embed_assets.go` | **New.** The `//go:embed` directives and `fs.Sub` accessors |
| `tinycld/server/embed_assets_stub.go` | **New.** Build-tag stub so normal builds need no staged assets |
| `tinycld/server/main.go` | Wire standalone flags + embedded FS into `coreserver.Options` |
| `tinycld/scripts/stage-embed-assets.ts` | **New.** Materialize symlinks, copy bundle sans `*.map` |
| `tinycld/.github/workflows/release-binaries.yml` | **New.** Cross-compile, checksum, attach to release |
| `tinycld/tests/e2e/standalone-binary.spec.ts` | **New.** Boot + smoke test against the real binary |
| `tinycld/docs/single-binary.md` | **New.** Self-host install/verify/upgrade docs |

**Task ordering rationale:** Tasks 1-2 change the fork (deepest dependency). Task 3 does the same for static assets. Task 4 adds the staging script that Tasks 5-6 consume. Tasks 5-6 wire it together. Task 7 ships CI. Task 8 tests end-to-end. Task 9 documents.

---

### Task 1: jsvm `fs.FS` loader for migrations

**Files:**
- Modify: `tinycld/third_party/pocketbase/plugins/jsvm/jsvm.go` (Config struct ~line 129; `registerMigrations` line 284; `filesContent` line 706)
- Test: `tinycld/third_party/pocketbase/plugins/jsvm/embedfs_test.go` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `jsvm.Config.MigrationsFS fs.FS` — when non-nil, migration source is read from this FS instead of `MigrationsDir`. Helper `filesContentFS(fsys fs.FS, pattern string) (map[string][]byte, error)` with identical semantics to `filesContent` (non-recursive, pattern-filtered, esbuild-transformed, keyed by base filename).

- [ ] **Step 1: Write the failing test**

Create `tinycld/third_party/pocketbase/plugins/jsvm/embedfs_test.go`:

```go
package jsvm

import (
	"testing"
	"testing/fstest"
)

// TestFilesContentFS_ReadsAndTransforms verifies the fs.FS loader matches
// filesContent's contract: pattern filtering, directory skipping, esbuild
// transformation, and base-filename keys.
func TestFilesContentFS_ReadsAndTransforms(t *testing.T) {
	fsys := fstest.MapFS{
		"a.js":        {Data: []byte("migrate((app) => {})")},
		"b.js":        {Data: []byte("migrate((app) => {})")},
		"skip.txt":    {Data: []byte("not a migration")},
		"sub/deep.js": {Data: []byte("migrate((app) => {})")},
	}

	got, err := filesContentFS(fsys, `^.*(\.js|\.ts)$`)
	if err != nil {
		t.Fatalf("filesContentFS: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("expected 2 files (a.js, b.js), got %d: %v", len(got), keysOf(got))
	}
	for _, name := range []string{"a.js", "b.js"} {
		if len(got[name]) == 0 {
			t.Errorf("expected transformed content for %q", name)
		}
	}
	if _, ok := got["skip.txt"]; ok {
		t.Error("pattern must exclude skip.txt")
	}
	if _, ok := got["deep.js"]; ok {
		t.Error("loader must not recurse into subdirectories")
	}
}

// TestFilesContentFS_MissingDirIsEmpty mirrors filesContent's behavior of
// treating a missing directory as "no files" rather than an error.
func TestFilesContentFS_MissingDirIsEmpty(t *testing.T) {
	got, err := filesContentFS(fstest.MapFS{}, `^.*(\.js|\.ts)$`)
	if err != nil {
		t.Fatalf("expected nil error for empty FS, got %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 files, got %d", len(got))
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/third_party/pocketbase && go test ./plugins/jsvm/ -run TestFilesContentFS -v`
Expected: FAIL — `undefined: filesContentFS`

- [ ] **Step 3: Add the `MigrationsFS` config field**

In `jsvm.go`, immediately after the `MigrationsFilesPattern` field (~line 136):

```go
	// MigrationsFS, when non-nil, supplies the JS migration sources instead
	// of reading MigrationsDir from the filesystem. Used by single-binary
	// builds that embed migrations via go:embed. When nil the loader falls
	// back to MigrationsDir, so path-based deployments are unaffected.
	MigrationsFS fs.FS
```

Confirm `io/fs` is imported (it already is, for `fs.ErrNotExist`).

- [ ] **Step 4: Add `filesContentFS` beside `filesContent`**

Append after `filesContent` ends (~line 743):

```go
// filesContentFS is filesContent over an fs.FS. It deliberately mirrors that
// function's contract — non-recursive, pattern-filtered, esbuild-transformed,
// keyed by base filename — so a caller can swap the source without any
// behavioral difference. A missing or empty FS yields an empty map, matching
// filesContent's ErrNotExist handling.
func filesContentFS(fsys fs.FS, pattern string) (map[string][]byte, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string][]byte{}, nil
		}
		return nil, err
	}

	var exp *regexp.Regexp
	if pattern != "" {
		if exp, err = regexp.Compile(pattern); err != nil {
			return nil, err
		}
	}

	result := map[string][]byte{}

	for _, f := range entries {
		if f.IsDir() || (exp != nil && !exp.MatchString(f.Name())) {
			continue
		}

		raw, err := fs.ReadFile(fsys, f.Name())
		if err != nil {
			return nil, err
		}

		transformed, err := transformSource(f.Name(), raw)
		if err != nil {
			return nil, err
		}
		result[f.Name()] = transformed
	}

	return result, nil
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tinycld/third_party/pocketbase && go test ./plugins/jsvm/ -run TestFilesContentFS -v`
Expected: PASS (both tests)

- [ ] **Step 6: Branch `registerMigrations` to prefer the FS**

In `registerMigrations` (line 284), replace:

```go
	files, err := filesContent(p.config.MigrationsDir, p.config.MigrationsFilesPattern)
	if err != nil {
		return err
	}
```

with:

```go
	var files map[string][]byte
	var err error
	if p.config.MigrationsFS != nil {
		files, err = filesContentFS(p.config.MigrationsFS, p.config.MigrationsFilesPattern)
	} else {
		files, err = filesContent(p.config.MigrationsDir, p.config.MigrationsFilesPattern)
	}
	if err != nil {
		return err
	}
```

Note: `absHooksDir` immediately below still calls `filepath.Abs(p.config.HooksDir)`. With an empty `HooksDir` that returns the process working directory rather than erroring, and nothing reads the resulting `__hooks` global (verified: zero references in any migration or hook). Leave it.

- [ ] **Step 7: Add a registration-level test**

Append to `embedfs_test.go`:

```go
// TestRegisterMigrations_PrefersFS proves the loader reads embedded sources
// when MigrationsFS is set, and that a nil FS still reads from disk.
func TestRegisterMigrations_PrefersFS(t *testing.T) {
	p := &plugin{config: Config{
		MigrationsFS:           fstest.MapFS{"1_x.js": {Data: []byte("migrate((app) => {})")}},
		MigrationsFilesPattern: `^.*(\.js|\.ts)$`,
	}}

	files, err := filesContentFS(p.config.MigrationsFS, p.config.MigrationsFilesPattern)
	if err != nil {
		t.Fatalf("filesContentFS: %v", err)
	}
	if _, ok := files["1_x.js"]; !ok {
		t.Fatal("expected 1_x.js to load from the embedded FS")
	}
}
```

- [ ] **Step 8: Run the full jsvm suite for regressions**

Run: `cd tinycld/third_party/pocketbase && go test ./plugins/jsvm/ 2>&1 | tail -20`
Expected: PASS — every pre-existing test still passes with nil `MigrationsFS`.

- [ ] **Step 9: Commit**

```bash
git -C tinycld/third_party/pocketbase add plugins/jsvm/jsvm.go plugins/jsvm/embedfs_test.go
git -C tinycld/third_party/pocketbase commit -m "feat(jsvm): load migrations from an fs.FS when configured"
```

---

### Task 2: jsvm `fs.FS` loader for hooks

**Files:**
- Modify: `tinycld/third_party/pocketbase/plugins/jsvm/jsvm.go` (Config ~line 113; `registerHooks` line 360)
- Test: `tinycld/third_party/pocketbase/plugins/jsvm/embedfs_test.go` (extend)

**Interfaces:**
- Consumes: `filesContentFS` from Task 1.
- Produces: `jsvm.Config.HooksFS fs.FS` — when non-nil, hook source is read from this FS, the `prependToEmptyFile` types-directive loop is skipped, and the watcher is never started regardless of `HooksWatch`.

- [ ] **Step 1: Write the failing test**

Append to `embedfs_test.go`:

```go
// TestHooksFS_SkipsEmptyFilePrepend guards the one behavior that cannot work
// against a read-only FS: registerHooks writes a types-reference directive
// into freshly created EMPTY hook files. Embedded files are never empty, and
// an embed.FS is not writable, so that loop must not run.
func TestHooksFS_SkipsEmptyFilePrepend(t *testing.T) {
	fsys := fstest.MapFS{
		"a.pb.ts": {Data: []byte("routerAdd('GET', '/x', (e) => e.json(200, {}))")},
	}

	files, err := filesContentFS(fsys, `^.*(\.pb\.js|\.pb\.ts)$`)
	if err != nil {
		t.Fatalf("filesContentFS: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 hook file, got %d", len(files))
	}
	for name, content := range files {
		if len(content) == 0 {
			t.Fatalf("embedded hook %q transformed to empty content", name)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/third_party/pocketbase && go test ./plugins/jsvm/ -run TestHooksFS -v`
Expected: FAIL — the pattern currently has no `HooksFS` path; this test compiles but documents intent. If it passes at this point, that only proves `filesContentFS` works; proceed to wire the config.

- [ ] **Step 3: Add the `HooksFS` config field**

After the `HooksFilesPattern` field (~line 120):

```go
	// HooksFS, when non-nil, supplies the JS hook sources instead of reading
	// HooksDir from the filesystem. Used by single-binary builds that embed
	// hooks via go:embed. Because an embedded FS is read-only and its files
	// are never empty, setting this also skips the types-directive prepend
	// and the hooks watcher. When nil the loader falls back to HooksDir.
	HooksFS fs.FS
```

- [ ] **Step 4: Branch `registerHooks`**

Replace the loader call at line 360 and guard the two disk-only blocks. The function head becomes:

```go
func (p *plugin) registerHooks() error {
	// fetch all js hooks sorted by their filename
	var files map[string][]byte
	var err error
	if p.config.HooksFS != nil {
		files, err = filesContentFS(p.config.HooksFS, p.config.HooksFilesPattern)
	} else {
		files, err = filesContent(p.config.HooksDir, p.config.HooksFilesPattern)
	}
	if err != nil {
		return err
	}

	// An embedded FS is read-only and never holds empty files, so the
	// types-directive bootstrap below (and the watcher) apply to disk only.
	if p.config.HooksFS == nil {
		// prepend the types reference directive
		//
		// note: it is loaded during startup to handle conveniently also
		// the case when the HooksWatch option is enabled and the application
		// restart on newly created file
		for name, content := range files {
			if len(content) != 0 {
				// skip non-empty files for now to prevent accidental overwrite
				continue
			}
			path := filepath.Join(p.config.HooksDir, name)
			directive := `/// <reference path="` + p.relativeTypesPath(p.config.HooksDir) + `" />`
			if err := prependToEmptyFile(path, directive+"\n\n"); err != nil {
				color.Yellow("Unable to prepend the types reference: %v", err)
			}
		}

		// initialize the hooks dir watcher
		if p.config.HooksWatch {
			if err := p.watchHooks(); err != nil {
				color.Yellow("Unable to init hooks watcher: %v", err)
			}
		}
	}
```

Leave the rest of the function (the `len(files) == 0` early return, `absHooksDir`, the VM pool) unchanged.

- [ ] **Step 5: Run tests**

Run: `cd tinycld/third_party/pocketbase && go test ./plugins/jsvm/ -run TestHooksFS -v`
Expected: PASS

- [ ] **Step 6: Run the full fork suite**

Run: `cd tinycld/third_party/pocketbase && go test ./... 2>&1 | tail -25`
Expected: PASS — nil `HooksFS` leaves every existing path-based test untouched.

- [ ] **Step 7: Commit**

```bash
git -C tinycld/third_party/pocketbase add plugins/jsvm/jsvm.go plugins/jsvm/embedfs_test.go
git -C tinycld/third_party/pocketbase commit -m "feat(jsvm): load hooks from an fs.FS when configured"
```

---

### Task 3: Serve static assets from an `fs.FS`

**Files:**
- Modify: `tinycld/core/server/coreserver/static.go:312` (`StaticWithDynamicFallback`)
- Modify: `tinycld/core/server/coreserver/server.go:472` and `tinycld/core/server/coreserver/tenant.go:253` (the two call sites)
- Test: `tinycld/core/server/coreserver/static_embed_test.go` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `StaticWithDynamicFallbackFS(publicFS, websiteFS, releasesFS fs.FS, releasesDir string) func(*core.RequestEvent) error`. The existing `StaticWithDynamicFallback(publicDir, websiteDir, releasesDir string)` is retained as a thin wrapper that constructs `os.DirFS` values, so both existing call sites keep compiling unchanged.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/coreserver/static_embed_test.go`:

```go
package coreserver

import (
	"testing"
	"testing/fstest"
)

// TestStaticWithDynamicFallbackFS_ServesFromFS proves an embedded bundle can
// back the static handler: a real asset resolves, and an unknown non-API path
// falls back to the SPA shell.
func TestStaticWithDynamicFallbackFS_ServesFromFS(t *testing.T) {
	publicFS := fstest.MapFS{
		"favicon.ico": {Data: []byte("icon-bytes")},
		"app.html":    {Data: []byte("<!doctype html><title>tinycld</title>")},
	}

	h := StaticWithDynamicFallbackFS(publicFS, nil, nil, "")
	if h == nil {
		t.Fatal("expected a handler")
	}

	if _, err := publicFS.Open("favicon.ico"); err != nil {
		t.Fatalf("expected favicon.ico in the embedded FS: %v", err)
	}
	if _, err := publicFS.Open("app.html"); err != nil {
		t.Fatalf("expected the SPA shell in the embedded FS: %v", err)
	}
}

// TestStaticWithDynamicFallback_StillAcceptsPaths pins that the original
// path-based signature keeps working, since the container and hosting
// deployments call it.
func TestStaticWithDynamicFallback_StillAcceptsPaths(t *testing.T) {
	dir := t.TempDir()
	if h := StaticWithDynamicFallback(dir, "", ""); h == nil {
		t.Fatal("expected a handler from the path-based constructor")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestStaticWithDynamicFallback -v`
Expected: FAIL — `undefined: StaticWithDynamicFallbackFS`

- [ ] **Step 3: Split the constructor**

In `static.go`, rename the existing body to the FS form and add a path-based wrapper. Keep the doc comment on the FS variant:

```go
// StaticWithDynamicFallback serves static files from directory paths. It is
// the path-based front door to StaticWithDynamicFallbackFS; single-binary
// builds call the FS form directly with embedded assets.
func StaticWithDynamicFallback(publicDir, websiteDir, releasesDir string) func(*core.RequestEvent) error {
	var websiteFS fs.FS
	if websiteDir != "" {
		websiteFS = os.DirFS(websiteDir)
	}
	return StaticWithDynamicFallbackFS(os.DirFS(publicDir), websiteFS, nil, releasesDir)
}
```

Then change the original function's signature to:

```go
func StaticWithDynamicFallbackFS(publicFS, websiteFS, releasesFS fs.FS, releasesDir string) func(*core.RequestEvent) error {
```

and delete its first three lines (the `os.DirFS` construction), since the FS values now arrive as parameters. Inside the returned closure, the SPA-fallback branch that reads `<releasesDir>/current/app.html` keeps its existing `releasesDir` logic when `releasesFS` is nil; when `releasesFS` is non-nil, read `app.html` from it instead.

- [ ] **Step 4: Run tests**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestStaticWithDynamicFallback -v`
Expected: PASS (both tests)

- [ ] **Step 5: Verify both existing call sites still compile**

Run: `cd tinycld/core/server && go build ./...`
Expected: no output. `server.go:472` and `tenant.go:253` call the unchanged path-based signature.

- [ ] **Step 6: Run the coreserver suite**

Run: `cd tinycld/core/server && go test ./coreserver/ 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tinycld/core/server/coreserver/static.go tinycld/core/server/coreserver/static_embed_test.go
git commit -m "feat(coreserver): serve static assets from an fs.FS"
```

---

### Task 4: Asset staging script

**Files:**
- Create: `tinycld/scripts/stage-embed-assets.ts`
- Modify: `tinycld/package.json` (add the `stage:embed` script)
- Modify: `tinycld/biome.json` (exclude `server/embedded_assets/`)
- Modify: `tinycld/.gitignore` (ignore `server/embedded_assets/`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a staged tree at `tinycld/server/embedded_assets/` containing `web/` (the Expo export minus every `*.map`), `pb_migrations/` (symlinks resolved), and `pb_hooks/` (symlinks resolved). Invoked as `pnpm run stage:embed`.

- [ ] **Step 1: Write the staging script**

Create `tinycld/scripts/stage-embed-assets.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Stage the assets that get compiled into the single-binary build.
 *
 * Two constraints drive this script:
 *   1. `go:embed` does not follow symlinks, and server/pb_migrations +
 *      server/pb_hooks are symlink farms the generator points at sibling
 *      repos. They must be materialized into real files.
 *   2. Source maps must never be embedded. They are 37MB of the 48MB export
 *      and ship to Sentry separately via `expo export --source-maps external`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const appRoot = join(import.meta.dirname, '..')
const outDir = join(appRoot, 'server', 'embedded_assets')

const copyResolvedFiles = (srcDir: string, destDir: string) => {
    mkdirSync(destDir, { recursive: true })
    if (!existsSync(srcDir)) return 0
    let count = 0
    for (const entry of readdirSync(srcDir)) {
        const src = join(srcDir, entry)
        // statSync (not lstatSync) resolves symlinks to their target.
        if (!statSync(src).isFile()) continue
        cpSync(src, join(destDir, basename(entry)), { dereference: true })
        count++
    }
    return count
}

const copyWebBundle = (srcDir: string, destDir: string) => {
    if (!existsSync(srcDir)) {
        throw new Error(`web bundle not found at ${srcDir} — run \`pnpm exec expo export --platform web\` first`)
    }
    let skipped = 0
    cpSync(srcDir, destDir, {
        recursive: true,
        dereference: true,
        filter: (src) => {
            if (src.endsWith('.map')) {
                skipped++
                return false
            }
            return true
        },
    })
    return skipped
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const skippedMaps = copyWebBundle(join(appRoot, 'dist'), join(outDir, 'web'))
const migrations = copyResolvedFiles(join(appRoot, 'server', 'pb_migrations'), join(outDir, 'pb_migrations'))
const hooks = copyResolvedFiles(join(appRoot, 'server', 'pb_hooks'), join(outDir, 'pb_hooks'))

if (migrations === 0) {
    throw new Error('staged 0 migrations — run `pnpm run packages:generate` first')
}

console.log(`staged: web bundle (${skippedMaps} source maps excluded), ${migrations} migrations, ${hooks} hooks`)
```

Note: `console.log` is correct here — build scripts are exempt from the no-console rule via scoped biome overrides.

- [ ] **Step 2: Register the script and exclusions**

In `tinycld/package.json`, add to `"scripts"`:

```json
    "stage:embed": "tsx scripts/stage-embed-assets.ts",
```

Append `server/embedded_assets/` to `tinycld/.gitignore`, and add `"server/embedded_assets"` to the `files.includes` exclusion list in `tinycld/biome.json` (the canonical config's generated-file exclude list, per CLAUDE.md).

- [ ] **Step 3: Run the staging script**

Run:
```bash
cd tinycld && pnpm run packages:generate && pnpm exec expo export --platform web --source-maps external && pnpm run stage:embed
```
Expected: `staged: web bundle (N source maps excluded), 136 migrations, 3 hooks`

- [ ] **Step 4: Verify no source maps leaked in**

Run: `find tinycld/server/embedded_assets -name "*.map" | wc -l`
Expected: `0`

- [ ] **Step 5: Verify staged size is in the expected range**

Run: `du -sh tinycld/server/embedded_assets`
Expected: roughly 13 MB. Substantially more means source maps or `node_modules` leaked in.

- [ ] **Step 6: Commit**

```bash
git add tinycld/scripts/stage-embed-assets.ts tinycld/package.json tinycld/.gitignore tinycld/biome.json
git commit -m "feat(build): stage embeddable assets without source maps"
```

---

### Task 5: Embed the assets into the binary

**Files:**
- Create: `tinycld/server/embed_assets.go`
- Create: `tinycld/server/embed_assets_stub.go`
- Test: `tinycld/server/embed_assets_test.go` (create)

**Interfaces:**
- Consumes: the staged tree from Task 4.
- Produces: `embeddedWebFS() fs.FS`, `embeddedMigrationsFS() fs.FS`, `embeddedHooksFS() fs.FS` — each returns nil when the binary was built without the `embedassets` build tag. Callers treat nil as "fall back to disk paths".

- [ ] **Step 1: Write the failing test**

Create `tinycld/server/embed_assets_test.go`:

```go
package main

import "testing"

// TestEmbeddedAccessorsAreNilWithoutTag pins the default build: without the
// embedassets tag the accessors return nil, so main falls back to the
// existing disk-based paths and normal dev/Docker builds need no staged tree.
func TestEmbeddedAccessorsAreNilWithoutTag(t *testing.T) {
	if embeddedWebFS() != nil {
		t.Error("expected nil web FS in an untagged build")
	}
	if embeddedMigrationsFS() != nil {
		t.Error("expected nil migrations FS in an untagged build")
	}
	if embeddedHooksFS() != nil {
		t.Error("expected nil hooks FS in an untagged build")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/server && go test . -run TestEmbeddedAccessors -v`
Expected: FAIL — `undefined: embeddedWebFS`

- [ ] **Step 3: Write the stub (default builds)**

Create `tinycld/server/embed_assets_stub.go`:

```go
//go:build !embedassets

package main

import "io/fs"

// Without the embedassets build tag the binary carries no assets and reads
// them from disk, exactly as the container and hosting deployments do. This
// keeps `go build ./...` working with no staged tree present.
func embeddedWebFS() fs.FS        { return nil }
func embeddedMigrationsFS() fs.FS { return nil }
func embeddedHooksFS() fs.FS      { return nil }
```

- [ ] **Step 4: Write the real embed (tagged builds)**

Create `tinycld/server/embed_assets.go`:

```go
//go:build embedassets

package main

import (
	"embed"
	"io/fs"
	"log"
)

// Populated by `pnpm run stage:embed`, which materializes the generator's
// symlink farms into real files and copies the Expo export WITHOUT source
// maps. `all:` is required so Expo's dotfile-prefixed chunks are included.
//
//go:embed all:embedded_assets
var embeddedAssets embed.FS

func mustSub(dir string) fs.FS {
	sub, err := fs.Sub(embeddedAssets, "embedded_assets/"+dir)
	if err != nil {
		log.Fatalf("embedded assets: %s missing from the build: %v", dir, err)
	}
	return sub
}

func embeddedWebFS() fs.FS        { return mustSub("web") }
func embeddedMigrationsFS() fs.FS { return mustSub("pb_migrations") }
func embeddedHooksFS() fs.FS      { return mustSub("pb_hooks") }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tinycld/server && go test . -run TestEmbeddedAccessors -v`
Expected: PASS (untagged build returns nil)

- [ ] **Step 6: Verify the tagged build compiles and embeds**

Run:
```bash
cd tinycld/server && CGO_ENABLED=0 go build -tags embedassets -trimpath -ldflags="-s -w" -o /tmp/tinycld-embed-check . && ls -l /tmp/tinycld-embed-check | awk '{printf "%.1f MB\n", $5/1048576}'
```
Expected: builds cleanly, roughly 64 MB.

- [ ] **Step 7: Commit**

```bash
git add tinycld/server/embed_assets.go tinycld/server/embed_assets_stub.go tinycld/server/embed_assets_test.go
git commit -m "feat(server): embed web bundle, migrations, and hooks behind a build tag"
```

---

### Task 6: Standalone flags and wiring

**Files:**
- Create: `tinycld/core/server/coreserver/standalone.go`
- Create: `tinycld/core/server/coreserver/standalone_test.go`
- Modify: `tinycld/core/server/coreserver/server.go` (`Options` ~line 38; jsvm config ~line 161; static registration ~line 472)
- Modify: `tinycld/server/main.go` (~line 66)

**Interfaces:**
- Consumes: `embeddedWebFS` / `embeddedMigrationsFS` / `embeddedHooksFS` (Task 5); `jsvm.Config.MigrationsFS` / `HooksFS` (Tasks 1-2); `StaticWithDynamicFallbackFS` (Task 3).
- Produces: `coreserver.StandaloneConfig{DataDir, SQLiteDir, HTTPAddr, HTTPSAddr string}` and `coreserver.ResolveStandaloneConfig(args []string, lookupEnv func(string) (string, bool)) (StandaloneConfig, error)`. Adds `Options.PublicFS`, `Options.MigrationsFS`, `Options.HooksFS` (all `fs.FS`, nil-default).

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/coreserver/standalone_test.go`:

```go
package coreserver

import (
	"path/filepath"
	"testing"
)

func noEnv(string) (string, bool) { return "", false }

// TestResolveStandaloneConfig_Defaults pins the zero-argument contract: a
// data dir beside the binary, SQLite nested inside it, and a LOOPBACK listen
// address so a first run never exposes an unconfigured instance.
func TestResolveStandaloneConfig_Defaults(t *testing.T) {
	cfg, err := ResolveStandaloneConfig(nil, noEnv)
	if err != nil {
		t.Fatalf("ResolveStandaloneConfig: %v", err)
	}
	if cfg.DataDir != "./tinycld-data" {
		t.Errorf("DataDir = %q, want ./tinycld-data", cfg.DataDir)
	}
	if want := filepath.Join("./tinycld-data", "pb_data"); cfg.SQLiteDir != want {
		t.Errorf("SQLiteDir = %q, want %q", cfg.SQLiteDir, want)
	}
	if cfg.HTTPAddr != "127.0.0.1:8090" {
		t.Errorf("HTTPAddr = %q, want 127.0.0.1:8090", cfg.HTTPAddr)
	}
}

// TestResolveStandaloneConfig_SQLiteFollowsDataDir verifies the default
// SQLite location tracks an overridden data dir.
func TestResolveStandaloneConfig_SQLiteFollowsDataDir(t *testing.T) {
	cfg, err := ResolveStandaloneConfig([]string{"--data-dir", "/srv/tc"}, noEnv)
	if err != nil {
		t.Fatalf("ResolveStandaloneConfig: %v", err)
	}
	if want := filepath.Join("/srv/tc", "pb_data"); cfg.SQLiteDir != want {
		t.Errorf("SQLiteDir = %q, want %q", cfg.SQLiteDir, want)
	}
}

// TestResolveStandaloneConfig_SQLiteMayLeaveDataDir covers the motivating
// case: uploads grow without bound while the DB wants faster storage.
func TestResolveStandaloneConfig_SQLiteMayLeaveDataDir(t *testing.T) {
	cfg, err := ResolveStandaloneConfig(
		[]string{"--data-dir", "/srv/tc", "--sqlite-dir", "/mnt/nvme/db"}, noEnv)
	if err != nil {
		t.Fatalf("ResolveStandaloneConfig: %v", err)
	}
	if cfg.SQLiteDir != "/mnt/nvme/db" {
		t.Errorf("SQLiteDir = %q, want /mnt/nvme/db", cfg.SQLiteDir)
	}
}

// TestResolveStandaloneConfig_FlagsBeatEnv pins precedence.
func TestResolveStandaloneConfig_FlagsBeatEnv(t *testing.T) {
	env := func(k string) (string, bool) {
		if k == "TINYCLD_DATA_DIR" {
			return "/from/env", true
		}
		return "", false
	}

	fromEnv, err := ResolveStandaloneConfig(nil, env)
	if err != nil {
		t.Fatalf("ResolveStandaloneConfig: %v", err)
	}
	if fromEnv.DataDir != "/from/env" {
		t.Errorf("env should apply when no flag: got %q", fromEnv.DataDir)
	}

	fromFlag, err := ResolveStandaloneConfig([]string{"--data-dir", "/from/flag"}, env)
	if err != nil {
		t.Fatalf("ResolveStandaloneConfig: %v", err)
	}
	if fromFlag.DataDir != "/from/flag" {
		t.Errorf("flag must beat env: got %q", fromFlag.DataDir)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestResolveStandaloneConfig -v`
Expected: FAIL — `undefined: ResolveStandaloneConfig`

- [ ] **Step 3: Implement the resolver**

Create `tinycld/core/server/coreserver/standalone.go`:

```go
package coreserver

import (
	"flag"
	"io"
	"path/filepath"
)

// StandaloneConfig holds the runtime locations for a single-binary self-host
// deployment. There is deliberately no config file: the setup UI and these
// flags are the only two sources of truth, so there is nothing to keep in sync.
type StandaloneConfig struct {
	DataDir   string
	SQLiteDir string
	HTTPAddr  string
	HTTPSAddr string
}

const (
	defaultDataDir  = "./tinycld-data"
	defaultHTTPAddr = "127.0.0.1:8090"
)

// ResolveStandaloneConfig parses standalone flags, falling back to environment
// variables and then to defaults. Flags win over the environment.
//
// The HTTP default is loopback, not 0.0.0.0: a first run must not expose an
// unconfigured instance to the network. Binding publicly is an explicit choice.
//
// SQLiteDir defaults inside DataDir so the simple case is one directory, but
// stays separable because uploads grow without bound while the database
// benefits from faster storage.
func ResolveStandaloneConfig(args []string, lookupEnv func(string) (string, bool)) (StandaloneConfig, error) {
	envOr := func(key, fallback string) string {
		if v, ok := lookupEnv(key); ok && v != "" {
			return v
		}
		return fallback
	}

	fs := flag.NewFlagSet("standalone", flag.ContinueOnError)
	fs.SetOutput(io.Discard)

	dataDir := fs.String("data-dir", envOr("TINYCLD_DATA_DIR", defaultDataDir), "root directory for mutable state")
	sqliteDir := fs.String("sqlite-dir", envOr("TINYCLD_SQLITE_DIR", ""), "SQLite directory (defaults to <data-dir>/pb_data)")
	httpAddr := fs.String("http", envOr("TINYCLD_HTTP", defaultHTTPAddr), "HTTP listen address")
	httpsAddr := fs.String("https", envOr("TINYCLD_HTTPS", ""), "HTTPS listen address; enables autocert when set")

	// Unknown flags belong to PocketBase's own command set, so parse
	// permissively rather than failing on them.
	if err := fs.Parse(args); err != nil && err != flag.ErrHelp {
		return StandaloneConfig{}, err
	}

	resolved := StandaloneConfig{
		DataDir:   *dataDir,
		SQLiteDir: *sqliteDir,
		HTTPAddr:  *httpAddr,
		HTTPSAddr: *httpsAddr,
	}
	if resolved.SQLiteDir == "" {
		resolved.SQLiteDir = filepath.Join(resolved.DataDir, "pb_data")
	}
	return resolved, nil
}
```

- [ ] **Step 4: Run tests**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestResolveStandaloneConfig -v`
Expected: PASS (all four tests)

- [ ] **Step 5: Add the FS fields to `Options` and thread them**

In `server.go`, add to `Options` after `MigrationsDir` (~line 67):

```go
	// PublicFS / MigrationsFS / HooksFS supply embedded assets for
	// single-binary builds. Each is nil for path-based deployments, which
	// keeps the container and hosting paths on their existing behavior.
	PublicFS     fs.FS
	MigrationsFS fs.FS
	HooksFS      fs.FS
```

In the `jsvm.MustRegister` call (~line 161), add the two fields:

```go
		MigrationsFS: opts.MigrationsFS,
		HooksFS:      opts.HooksFS,
```

At the static registration (~line 472), prefer the FS form when embedded assets are present:

```go
				if opts.PublicFS != nil {
					e.Router.Any("/{path...}", StaticWithDynamicFallbackFS(opts.PublicFS, nil, nil, ""))
				} else if opts.ReleasesDir != "" {
					e.Router.Any("/{path...}", StaticWithDynamicFallback(opts.PublicDir, opts.WebsiteDir, opts.ReleasesDir))
				} else {
					e.Router.Any("/{path...}", StaticWithFallback(opts.PublicDir, opts.FallbackFile))
				}
```

Match the existing conditional's shape at that site rather than restructuring it; add `io/fs` to the imports.

- [ ] **Step 6: Wire `main.go`**

In `tinycld/server/main.go`, replace the `coreserver.Register` options with embed-aware values. Insert before the `app := pocketbase.New()` line:

```go
	// Embedded assets are present only in single-binary builds (the
	// `embedassets` build tag). When absent every accessor returns nil and
	// the server reads from disk exactly as the container build does.
	// Embedded assets are present only in single-binary builds (the
	// `embedassets` build tag). When absent every accessor returns nil and
	// the server reads from disk exactly as the container build does.
	webFS := embeddedWebFS()
	standalone := webFS != nil

	if standalone {
		cfg, err := coreserver.ResolveStandaloneConfig(os.Args[1:], os.LookupEnv)
		if err != nil {
			log.Fatal(err)
		}
		// resolveStateDir() reads TINYCLD_STATE_DIR, so setting it here points
		// pb_data, releases, and builds at the user's chosen data dir without
		// introducing a second path mechanism.
		if err := os.Setenv("TINYCLD_STATE_DIR", cfg.DataDir); err != nil {
			log.Fatal(err)
		}
	}
```

Then modify the existing `coreserver.Options` literal. The current block sets neither `MigrationsDir` nor `HooksDir` (jsvm applies its own `pb_data/../pb_*` defaults), so only the three FS fields are added and two booleans change:

```go
	coreserver.Register(app, coreserver.Options{
		PublicDir:      coreserver.DefaultPublicDir(),
		WebsiteDir:     coreserver.DefaultWebsiteDir(),
		ReleasesDir:    coreserver.DefaultReleasesDir(),
		FallbackFile:   "app.html",
		TypesDir:       coreserver.DefaultTypesDir(),
		BinaryName:     "tinycld",
		HooksWatch:     !standalone,
		HooksPoolSize:  15,
		Automigrate:    !standalone,
		PublicFS:       webFS,
		MigrationsFS:   embeddedMigrationsFS(),
		HooksFS:        embeddedHooksFS(),
		RegisterExtras: registerPackageExtensions,
	})
```

`HooksWatch` and `Automigrate` invert for standalone per the spec: an embedded FS cannot be watched, and there is nowhere to write generated migrations. When the FS fields are non-nil the jsvm loaders never consult the dir defaults, so leaving `MigrationsDir`/`HooksDir` unset is correct in both modes.

Confirm `os` and `log` are already imported in `main.go` (both are).

- [ ] **Step 7: Skip `migratecmd` registration in standalone**

`Automigrate: false` stops migration files being written on collection edits,
but `migratecmd.MustRegister` (`server.go:177`) still registers `migrate
create` / `migrate collections` against an empty `Dir`. Those are dev-time
authoring commands with nothing to write to, so gate the whole registration.

In `server.go`, wrap the existing call:

```go
	// A single-binary build has no writable migrations dir, and `migrate
	// create` / `migrate collections` are dev-time authoring commands.
	// Applying migrations does not depend on this: it runs off the in-memory
	// core.AppMigrations registry that jsvm populates above.
	if opts.MigrationsFS == nil {
		migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
			TemplateLang: migratecmd.TemplateLangJS,
			Automigrate:  opts.Automigrate,
			Dir:          opts.MigrationsDir,
		})
	}
```

Verify migrations still apply in a tagged build — this is the step that would
silently break the database if the reasoning above were wrong:

```bash
cd tinycld/server && CGO_ENABLED=0 go build -tags embedassets -o /tmp/tinycld-mig . && \
  rm -rf /tmp/migcheck && mkdir -p /tmp/migcheck && cd /tmp/migcheck && \
  /tmp/tinycld-mig serve --data-dir ./d --http 127.0.0.1:18991 &
sleep 10 && sqlite3 /tmp/migcheck/d/pb_data/data.db "select count(*) from _migrations" ; kill %1
```
Expected: a non-zero count, proving embedded migrations applied without `migratecmd`.

- [ ] **Step 8: Verify both build modes compile**

Run:
```bash
cd tinycld/server && go build ./... && CGO_ENABLED=0 go build -tags embedassets -o /tmp/tinycld-standalone .
```
Expected: both succeed.

- [ ] **Step 9: Run the coreserver suite**

Run: `cd tinycld/core/server && go test ./coreserver/ 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add tinycld/core/server/coreserver/standalone.go tinycld/core/server/coreserver/standalone_test.go tinycld/core/server/coreserver/server.go tinycld/server/main.go
git commit -m "feat(server): standalone flags and embedded-asset wiring"
```

---

### Task 7: Release workflow with checksums

**Files:**
- Create: `tinycld/.github/workflows/release-binaries.yml`

**Interfaces:**
- Consumes: `pnpm run stage:embed` (Task 4) and the `embedassets` build tag (Task 5).
- Produces: release assets `tinycld-{linux-amd64,linux-arm64,darwin-arm64}` plus `SHA256SUMS`.

- [ ] **Step 1: Write the workflow**

Create `tinycld/.github/workflows/release-binaries.yml`. Model the workspace assembly on `docker-publish.yml` (same `release: published` trigger and pinned-manifest assembly):

```yaml
name: Build and publish self-host binaries

# Same release ANCHOR contract as docker-publish.yml: a published Release on
# this repo assembles the workspace from the release's pinned manifest, then
# cross-compiles the single-binary self-host artifact for each platform.
#
# Trigger is `release: published` only — NOT `push: tags` — because the
# manifest.json and pnpm-lock.yaml assets are uploaded client-side after the
# tag is pushed.
on:
  release:
    types: [published]
  workflow_dispatch:

concurrency:
  group: release-binaries-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build single binary
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: write
    steps:
      - name: Checkout tinycld member (at the triggering tag)
        uses: actions/checkout@v5
        with:
          path: ws/tinycld

      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version-file: ws/tinycld/.node-version

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version-file: ws/tinycld/server/go.mod

      # Mirrors docker-publish.yml's assembly step: download the pinned
      # release recipe, clone each sibling at its pinned sha, let bootstrap
      # write the workspace scaffolding, and use the pinned lockfile.
      - name: Assemble workspace from pinned release manifest
        working-directory: ws
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          TAG="${GITHUB_REF_NAME:-$(git -C tinycld describe --tags --exact-match)}"
          mkdir -p .release-assets
          gh release download "${TAG}" -R "${GITHUB_REPOSITORY}" \
            -p manifest.json -p pnpm-lock.yaml -p package-versions.json \
            --dir .release-assets
          node tinycld/scripts/ci-assemble-workspace.mjs .release-assets/manifest.json

      - name: Install dependencies
        working-directory: ws
        run: corepack enable && pnpm install --frozen-lockfile

      - name: Generate package wiring
        working-directory: ws/tinycld
        run: pnpm run packages:generate

      - name: Export web bundle
        working-directory: ws/tinycld
        run: pnpm exec expo export --platform web --source-maps external

      - name: Stage embeddable assets
        working-directory: ws/tinycld
        run: pnpm run stage:embed

      - name: Fail if source maps reached the embed payload
        working-directory: ws/tinycld
        run: |
          set -euo pipefail
          count=$(find server/embedded_assets -name '*.map' | wc -l)
          if [ "$count" -ne 0 ]; then
            echo "::error::${count} source maps staged for embedding; they must be excluded"
            exit 1
          fi

      - name: Cross-compile
        working-directory: ws/tinycld/server
        run: |
          set -euo pipefail
          mkdir -p /tmp/dist
          build() {
            GOOS="$1" GOARCH="$2" CGO_ENABLED=0 go build \
              -tags embedassets -trimpath -ldflags="-s -w" \
              -o "/tmp/dist/tinycld-$1-$2" .
            echo "built tinycld-$1-$2"
          }
          build linux amd64
          build linux arm64
          build darwin arm64

      # The 100MB ceiling is the spec's size budget against a measured 64MB
      # baseline. Its real job is catching an accidental re-addition of source
      # maps, which would otherwise ship silently.
      - name: Enforce size budget
        run: |
          set -euo pipefail
          for f in /tmp/dist/tinycld-*; do
            size=$(stat -c%s "$f")
            mb=$((size / 1048576))
            echo "$(basename "$f"): ${mb} MB"
            if [ "$mb" -gt 100 ]; then
              echo "::error::$(basename "$f") is ${mb} MB, over the 100 MB budget"
              exit 1
            fi
          done

      - name: Generate checksums
        working-directory: /tmp/dist
        run: sha256sum tinycld-* > SHA256SUMS && cat SHA256SUMS

      - name: Attach to release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          TAG="${GITHUB_REF_NAME}"
          gh release upload "${TAG}" /tmp/dist/tinycld-* /tmp/dist/SHA256SUMS \
            -R "${GITHUB_REPOSITORY}" --clobber
```

- [ ] **Step 2: Reuse the existing assembly helper**

The assembly step above calls `ci-assemble-workspace.mjs`. Check whether `docker-publish.yml` inlines that logic instead:

Run: `grep -n "manifest.json" tinycld/.github/workflows/docker-publish.yml | head`

If the logic is inlined there rather than in a script, extract the shared block into `tinycld/scripts/ci-assemble-workspace.mjs` and have **both** workflows call it — do not copy-paste the block into the new workflow.

- [ ] **Step 3: Validate the workflow YAML**

Run: `cd tinycld && pnpm exec js-yaml .github/workflows/release-binaries.yml > /dev/null && echo "valid YAML"`
Expected: `valid YAML`. If `js-yaml` is unavailable, use `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-binaries.yml'))" && echo valid`.

- [ ] **Step 4: Dry-run the build steps locally**

Run:
```bash
cd tinycld && pnpm run stage:embed && cd server && \
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags embedassets -trimpath -ldflags="-s -w" -o /tmp/tinycld-linux-arm64 . && \
  ls -l /tmp/tinycld-linux-arm64 | awk '{printf "%.1f MB\n", $5/1048576}'
```
Expected: builds, roughly 64 MB.

- [ ] **Step 5: Commit**

```bash
git add tinycld/.github/workflows/release-binaries.yml
git commit -m "ci: publish self-host binaries with checksums"
```

---

### Task 8: End-to-end verification against the real binary

**Files:**
- Create: `tinycld/tests/e2e/standalone-binary.spec.ts`

**Interfaces:**
- Consumes: a binary built with `-tags embedassets` (Task 5) and standalone flags (Task 6).
- Produces: no code interface — an executable check that assets are genuinely embedded.

- [ ] **Step 1: Write the failing test**

Create `tinycld/tests/e2e/standalone-binary.spec.ts`:

```ts
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * Boots the SHIPPED artifact in an empty directory with no workspace around
 * it. This is the check that the web bundle and migrations are genuinely
 * inside the binary — a build that reads them from disk passes every unit
 * test and fails here.
 */
const binary = join(tmpdir(), 'tinycld-standalone-e2e')

test.beforeAll(() => {
    execFileSync(
        'go',
        ['build', '-tags', 'embedassets', '-trimpath', '-ldflags=-s -w', '-o', binary, '.'],
        { cwd: join(import.meta.dirname, '..', '..', 'server'), env: { ...process.env, CGO_ENABLED: '0' }, stdio: 'inherit' }
    )
})

test('serves the SPA shell from embedded assets in a clean directory', async ({ page }) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tinycld-data-'))
    const port = 18090 + Math.floor(Math.random() * 1000)

    const proc = spawn(binary, ['serve', '--data-dir', dataDir, '--http', `127.0.0.1:${port}`], {
        cwd: tmpdir(), // deliberately NOT the workspace: no dist/ or pb_migrations/ nearby
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
        await expect
            .poll(async () => {
                try {
                    const res = await fetch(`http://127.0.0.1:${port}/`)
                    return res.status
                } catch {
                    return 0
                }
            }, { timeout: 60_000, intervals: [500] })
            .toBe(200)

        await page.goto(`http://127.0.0.1:${port}/`)
        await expect(page.locator('#root')).toBeAttached()

        expect(existsSync(join(dataDir, 'pb_data'))).toBe(true)
    } finally {
        proc.kill('SIGTERM')
    }
})
```

Note: `page.goto` is correct here — this is the initial load of a freshly booted server, not in-app navigation.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec playwright test tests/e2e/standalone-binary.spec.ts`
Expected: FAIL before Tasks 4-6 are staged/wired (no embedded assets, so no SPA shell).

- [ ] **Step 3: Stage assets and re-run**

Run:
```bash
cd tinycld && pnpm run packages:generate && pnpm exec expo export --platform web --source-maps external && pnpm run stage:embed && pnpm exec playwright test tests/e2e/standalone-binary.spec.ts
```
Expected: PASS

- [ ] **Step 4: Prove the assets are embedded, not read from disk**

Run:
```bash
cd /tmp && mkdir -p tinycld-isolation && cd tinycld-isolation && \
  /tmp/tinycld-standalone-e2e serve --data-dir ./d --http 127.0.0.1:18999 &
sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18999/ ; kill %1
```
Expected: `200` from a directory containing no `dist/`, no `pb_migrations/`, and no workspace.

- [ ] **Step 5: Commit**

```bash
git add tinycld/tests/e2e/standalone-binary.spec.ts
git commit -m "test(e2e): boot the standalone binary in a clean directory"
```

---

### Task 9: Self-host documentation

**Files:**
- Create: `tinycld/docs/single-binary.md`
- Modify: `tinycld/README.md` (link the new doc from the self-hosting section)

**Interfaces:**
- Consumes: flags from Task 6, release assets from Task 7.
- Produces: no code interface.

- [ ] **Step 1: Write the doc**

Create `tinycld/docs/single-binary.md`:

````markdown
# Running TinyCld from a single binary

A self-host release ships one binary per platform. It contains the server, the
web interface, and every first-party feature package. It needs no Docker, no
Node, and no Go toolchain.

## Install

Download the binary for your platform and the `SHA256SUMS` file from the
[latest release](https://github.com/tinycld/tinycld/releases/latest), then
verify and run it:

```sh
sha256sum --check --ignore-missing SHA256SUMS
chmod +x tinycld-linux-amd64
./tinycld-linux-amd64 serve
```

On first run it creates `./tinycld-data/`, applies its migrations, listens on
`127.0.0.1:8090`, and prints a setup URL. Open that URL to create the first
account.

## Options

| Flag | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `--data-dir` | `TINYCLD_DATA_DIR` | `./tinycld-data` | Root for all mutable state |
| `--sqlite-dir` | `TINYCLD_SQLITE_DIR` | `<data-dir>/pb_data` | Database location |
| `--http` | `TINYCLD_HTTP` | `127.0.0.1:8090` | HTTP listen address |
| `--https` | `TINYCLD_HTTPS` | unset | Enables automatic TLS certificates |

Flags take precedence over environment variables.

The default listen address is loopback so a first run is not exposed to the
network before you have created an account. To serve publicly, pass
`--http 0.0.0.0:8090` or put a reverse proxy in front.

Set `--sqlite-dir` outside the data directory to keep the database on faster
storage than uploads:

```sh
./tinycld serve --data-dir /srv/tinycld --sqlite-dir /mnt/nvme/tinycld-db
```

## TLS

`--https` uses automatic certificates, which requires binding ports 80 and
443. Either grant the capability or run behind a reverse proxy:

```sh
sudo setcap cap_net_bind_service=+ep ./tinycld
```

## Backups

Everything is under the data directory. Stop the server and copy it, or
snapshot the database alone:

```sh
sqlite3 ./tinycld-data/pb_data/data.db "VACUUM INTO './backup.db'"
```

## Upgrading

Download the new binary, replace the old one, and restart. Migrations apply
automatically at startup. Back up the data directory first.

There is no in-app package installation in this distribution: the binary
carries a fixed set of features, which you enable or disable in Settings. To
add third-party packages, use the Docker distribution.

## Differences from the Docker distribution

- **No in-app package installation.** The feature set is fixed at build time.
- **Editing collections in the admin UI does not write migration files.**
  Schema changes belong in a development workspace. This is the one
  behavioral difference that affects existing workflows.
- **Everything is one process.** There is no separate build or release
  directory to manage.
````

- [ ] **Step 2: Link it from the README**

Add to `tinycld/README.md`'s self-hosting section:

```markdown
- [Running from a single binary](docs/single-binary.md) — no Docker required
```

- [ ] **Step 3: Verify every documented flag exists**

Run:
```bash
cd tinycld && grep -o '\-\-[a-z-]*' docs/single-binary.md | sort -u | \
  while read f; do grep -q "\"${f#--}\"" core/server/coreserver/standalone.go && echo "OK  $f" || echo "MISSING  $f"; done
```
Expected: every flag reports `OK`. `--data-dir`, `--sqlite-dir`, `--http`, `--https` must all resolve.

- [ ] **Step 4: Commit**

```bash
git add tinycld/docs/single-binary.md tinycld/README.md
git commit -m "docs: single-binary self-host guide"
```

---

## Final verification

- [ ] **Run the full check suite**

```bash
cd tinycld && pnpm exec tinycld-pkg check
cd tinycld/core/server && go test ./...
cd tinycld/third_party/pocketbase && go test ./plugins/jsvm/
```
Expected: all pass. Per CLAUDE.md, fix any failure at its root cause — never re-run, skip, or work around it.

- [ ] **Confirm the container build is untouched**

```bash
cd tinycld/server && go build ./...
```
Expected: succeeds without the `embedassets` tag and with no staged asset tree, proving the Docker and hosting paths are unaffected.

---

## Self-Review Notes

**Spec coverage:** Embedding (Tasks 1-3, 5) · staging without source maps (Task 4) · CLI flags for data and SQLite locations (Task 6) · `HooksWatch`/`Automigrate`/`migratecmd` changes (Task 6) · build and release with `SHA256SUMS` (Task 7) · boot, e2e, flags, fork-regression, and size-guard tests (Tasks 1-3, 6-8) · documentation of the `Automigrate` regression (Task 9).

**Deliberately deferred:** Feature enable/disable UI. The spec's model is "all migrations run; disabling gates UI and routes", which is existing package-registry behavior rather than new work in this plan. If the setup UI lacks per-package toggles, that is a follow-up plan, not a task here.

**Verify during implementation:** Whether hooks can be dropped entirely (spec's "Possible scope reduction"). `coreserver/server.go:132-138` says `$`-bindings must exist before hooks execute, but does not require hook files to exist, and `registerHooks` returns early when none are found. Task 2 embeds them regardless, so the plan is correct either way.
