# Core-Owned Vendor Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the vendor version pin table out of `@tinycld/bootstrap` into the tinycld repo (`tinycld/core/package-versions.json`), with a single root-writer script in the tinycld repo producing all workspace-root files, so a vendor bump is one tinycld commit and never a bootstrap release.

**Architecture:** A new self-contained script `tinycld/scripts/write-workspace-root.ts` becomes the only writer of `package.json`, `pnpm-workspace.yaml`, `package-versions.json`, `biome.json`, `.watchmanconfig`, and `.npmrc` at the workspace root, reading pins from a committed `tinycld/core/package-versions.json`. Bootstrap clones repos then executes that script with bare `node`; the generator calls it on every install (self-healing). The server (OTA) build pipeline sets `TINYCLD_SERVER_REBUILD=1` on its `pnpm install`, which makes the root-writer leave the pin files alone so OTA pins stay frozen at the active build's versions. Feature repos and bootstrap templates drop the vendor `peerDependencies` that core now covers.

**Tech Stack:** TypeScript (erasable, runnable by Node ≥24 type-stripping), vitest, Go (pkgbuild package).

**Spec:** `docs/superpowers/specs/2026-08-28-core-owned-vendor-versions-design.md`

## Global Constraints

- Biome style everywhere: 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons. Never `any`. Never biome-ignore comments.
- `console.*` is allowed in `scripts/` (build tooling is exempt from the no-console rule via scoped overrides) — do NOT use the `log` logger in these scripts.
- The overrides YAML block must stay **byte-identical** between the TS renderer and the Go `renderOverridesBlock` in `tinycld/core/server/pkgbuild/assemble.go` (sorted keys, scoped names single-quoted, two-space indent, `overrides:` header).
- `tinycld/scripts/write-workspace-root.ts` must stay **self-contained**: no relative imports, no node_modules imports beyond `node:*` builtins, only erasable TypeScript (no enums, no namespaces) — bootstrap runs it with bare `node` (engines `>=24`, native type stripping) before any install.
- Each member repo gets its own branch `core-owned-vendor-versions`; commit messages must NOT mention Claude or link Claude sessions.
- Workspace repos touched: `tinycld/` (app+core, one repo), `bootstrap/`, and the 7 feature repos. Never run `pnpm install` inside a member — root only.

## Reference: the pin table being moved

`FRAMEWORK_OVERRIDES` from `bootstrap/src/assemble-workspace.ts:36-81`. It moves **verbatim** (all 29 entries incl. the `react-native-drax` git-fork ref and the explanatory entry comments). Do not alter any version while moving.

---

### Task 1: Pin table + root-writer module in the tinycld repo

**Files:**
- Create: `tinycld/core/package-versions.json`
- Create: `tinycld/scripts/write-workspace-root.ts`
- Test: `tinycld/scripts/__tests__/write-workspace-root.test.ts`

**Interfaces:**
- Consumes: `bootstrap/src/assemble-workspace.ts` (read-only, as the source to copy `FRAMEWORK_OVERRIDES`, `pnpmWorkspaceYaml`, `watchmanConfig`, root package.json assembly from).
- Produces: `writeWorkspaceRoot(wsRoot?: string, appDir?: string): void` (default export path `tinycld/scripts/write-workspace-root.ts`), plus exported helpers `readCoreVersions(appDir: string): Record<string, string>` and `renderOverridesBlock(overrides: Record<string, string>): string`. Task 2 imports `writeWorkspaceRoot` from `./write-workspace-root`; Task 4's bootstrap runs the file as a script (`node tinycld/scripts/write-workspace-root.ts`). Env contract: when `TINYCLD_SERVER_REBUILD` is set (any value), only the root `biome.json` is (re)written.

- [ ] **Step 1: Branch**

```bash
cd ~/code/tinycld/tinycld && git checkout -b core-owned-vendor-versions
```

- [ ] **Step 2: Create the committed pin table**

Create `tinycld/core/package-versions.json`. Copy every key/value of `FRAMEWORK_OVERRIDES` from `bootstrap/src/assemble-workspace.ts:36-81` verbatim, alphabetically is NOT required (keep source order or sort — the renderer sorts at output time), with this doc key first:

```json
{
    "//": "SOURCE OF TRUTH for the ecosystem's pinned vendor versions: the framework/native/styling stack, plus EVERY native module compiled into the EAS binary even when only one feature uses it (e.g. @shopify/flash-list, the react-native-drax fork). scripts/write-workspace-root.ts transcribes these into the workspace root's pnpm `overrides:` block and package-versions.json; the Go OTA rebuild (core/server/pkgbuild) re-renders the same block from the root copy. Bump in lockstep with each native (EAS) build. Feature-specific pure-JS libraries do NOT belong here — a feature declares those itself.",
    "expo": "55.0.26",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "react-native": "0.83.6",
    "react-native-reanimated": "4.2.1",
    "react-native-worklets": "0.7.4",
    "react-native-gesture-handler": "3.0.1",
    "react-native-safe-area-context": "5.6.2",
    "react-native-screens": "4.23.0",
    "react-native-svg": "15.15.3",
    "react-native-web": "0.21.2",
    "expo-router": "55.0.16",
    "expo-image": "55.0.11",
    "expo-image-picker": "55.0.20",
    "@sentry/react-native": "7.11.0",
    "uniwind": "1.8.0",
    "tailwindcss": "4.3.0",
    "tailwind-variants": "0.1.20",
    "tailwind-merge": "3.6.0",
    "@gluestack-ui/utils": "5.0.5-alpha.0",
    "@shopify/flash-list": "2.0.2",
    "lucide-react-native": "1.17.0",
    "react-hook-form": "7.77.0",
    "@tanstack/db": "0.8.5",
    "@tanstack/react-db": "0.3.5",
    "@tanstack/query-db-collection": "1.2.10",
    "@tanstack/react-query": "5.101.0",
    "react-native-drax": "github:nathanstitt/react-native-drax#b863d89a70c73454d7f3495bf79e382586495fa4"
}
```

(The lockstep rationale comments for the @tanstack trio and the drax fork can't live in JSON; they are preserved in the doc comment of `write-workspace-root.ts` in Step 4.)

- [ ] **Step 3: Write the failing tests**

Create `tinycld/scripts/__tests__/write-workspace-root.test.ts`. Note `TINYCLD_APP_DIR` is NOT used by this module — the test passes dirs explicitly.

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readCoreVersions, renderOverridesBlock, writeWorkspaceRoot } from '../write-workspace-root'

const PINS = {
    '//': 'doc',
    expo: '55.0.26',
    '@tanstack/db': '0.8.5',
    'react-native-drax': 'github:nathanstitt/react-native-drax#b863d89',
}

function makeFixtureRoot(): { wsRoot: string; appDir: string } {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsroot-'))
    const appDir = path.join(wsRoot, 'tinycld')
    fs.mkdirSync(path.join(appDir, 'core'), { recursive: true })
    fs.writeFileSync(path.join(appDir, 'core', 'package-versions.json'), JSON.stringify(PINS))
    fs.writeFileSync(
        path.join(appDir, 'biome.json'),
        JSON.stringify({ root: false, files: { includes: ['**/*.ts', '!lib/generated'] } })
    )
    return { wsRoot, appDir }
}

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('renderOverridesBlock', () => {
    it('matches the Go renderer byte-for-byte: sorted, scoped names quoted, plain bare', () => {
        const block = renderOverridesBlock({ expo: '55.0.26', '@tanstack/db': '0.8.5', uniwind: '1.8.0' })
        expect(block).toBe(['overrides:', "  '@tanstack/db': 0.8.5", '  expo: 55.0.26', '  uniwind: 1.8.0'].join('\n'))
    })
})

describe('readCoreVersions', () => {
    it('strips the // doc key', () => {
        const { appDir } = makeFixtureRoot()
        const pins = readCoreVersions(appDir)
        expect(pins['//']).toBeUndefined()
        expect(pins.expo).toBe('55.0.26')
    })
    it('hard-errors when the table is missing', () => {
        const { appDir } = makeFixtureRoot()
        fs.rmSync(path.join(appDir, 'core', 'package-versions.json'))
        expect(() => readCoreVersions(appDir)).toThrow(/cannot read/)
    })
    it('hard-errors on malformed JSON', () => {
        const { appDir } = makeFixtureRoot()
        fs.writeFileSync(path.join(appDir, 'core', 'package-versions.json'), '{nope')
        expect(() => readCoreVersions(appDir)).toThrow(/malformed/)
    })
    it('hard-errors when the table has no pins beyond the doc key', () => {
        const { appDir } = makeFixtureRoot()
        fs.writeFileSync(path.join(appDir, 'core', 'package-versions.json'), JSON.stringify({ '//': 'doc' }))
        expect(() => readCoreVersions(appDir)).toThrow(/no version pins/)
    })
})

describe('writeWorkspaceRoot', () => {
    it('writes pnpm-workspace.yaml with the overrides block derived from the core table', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        writeWorkspaceRoot(wsRoot, appDir)
        const yaml = fs.readFileSync(path.join(wsRoot, 'pnpm-workspace.yaml'), 'utf8')
        expect(yaml).toContain('nodeLinker: hoisted')
        expect(yaml).toContain("  '@tanstack/db': 0.8.5")
        expect(yaml).toContain('  expo: 55.0.26')
        expect(yaml).not.toContain('storeDir:')
    })
    it('writes the root package-versions.json as a derived copy of the core table', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        writeWorkspaceRoot(wsRoot, appDir)
        const derived = JSON.parse(fs.readFileSync(path.join(wsRoot, 'package-versions.json'), 'utf8'))
        expect(derived.expo).toBe('55.0.26')
        expect(derived['//']).toMatch(/derived/i)
    })
    it('preserves human-owned fields in an existing root package.json', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        fs.writeFileSync(
            path.join(wsRoot, 'package.json'),
            JSON.stringify({ name: '@tinycld/workspace', scripts: { 'docker:ssl': 'x' }, license: 'AGPL-3.0-only' })
        )
        writeWorkspaceRoot(wsRoot, appDir)
        const pkg = JSON.parse(fs.readFileSync(path.join(wsRoot, 'package.json'), 'utf8'))
        expect(pkg.scripts['docker:ssl']).toBe('x')
        expect(pkg.license).toBe('AGPL-3.0-only')
        expect(pkg.scripts.postinstall).toContain('link-members')
        expect(pkg.packageManager).toMatch(/^pnpm@/)
    })
    it('writes the root biome.json inlined from the canonical with rerooted globs', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        writeWorkspaceRoot(wsRoot, appDir)
        const biome = JSON.parse(fs.readFileSync(path.join(wsRoot, 'biome.json'), 'utf8'))
        expect(biome.root).toBe(true)
        expect(biome.files.includes).toContain('!tinycld/lib/generated')
        expect(biome.vcs.root).toBe('tinycld')
    })
    it('warns to reinstall when pins changed from the previous derived copy', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        writeWorkspaceRoot(wsRoot, appDir)
        const table = JSON.parse(fs.readFileSync(path.join(appDir, 'core', 'package-versions.json'), 'utf8'))
        table.expo = '56.0.0'
        fs.writeFileSync(path.join(appDir, 'core', 'package-versions.json'), JSON.stringify(table))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        writeWorkspaceRoot(wsRoot, appDir)
        expect(warn.mock.calls.flat().join(' ')).toMatch(/run pnpm install again/)
        warn.mockRestore()
    })
    it('under TINYCLD_SERVER_REBUILD writes only biome.json and leaves pin files frozen', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        fs.writeFileSync(path.join(wsRoot, 'pnpm-workspace.yaml'), 'storeDir: /baked\n')
        fs.writeFileSync(path.join(wsRoot, 'package-versions.json'), '{"expo":"55.0.0"}')
        vi.stubEnv('TINYCLD_SERVER_REBUILD', '1')
        writeWorkspaceRoot(wsRoot, appDir)
        expect(fs.readFileSync(path.join(wsRoot, 'pnpm-workspace.yaml'), 'utf8')).toBe('storeDir: /baked\n')
        expect(fs.readFileSync(path.join(wsRoot, 'package-versions.json'), 'utf8')).toBe('{"expo":"55.0.0"}')
        expect(fs.existsSync(path.join(wsRoot, 'biome.json'))).toBe(true)
        expect(fs.existsSync(path.join(wsRoot, 'package.json'))).toBe(false)
    })
    it('is idempotent — a second run produces byte-identical files', () => {
        const { wsRoot, appDir } = makeFixtureRoot()
        writeWorkspaceRoot(wsRoot, appDir)
        const first = fs.readFileSync(path.join(wsRoot, 'pnpm-workspace.yaml'), 'utf8')
        writeWorkspaceRoot(wsRoot, appDir)
        expect(fs.readFileSync(path.join(wsRoot, 'pnpm-workspace.yaml'), 'utf8')).toBe(first)
    })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/write-workspace-root.test.ts`
Expected: FAIL — cannot resolve `../write-workspace-root`.

- [ ] **Step 5: Implement `tinycld/scripts/write-workspace-root.ts`**

The logic is a consolidation of `bootstrap/src/assemble-workspace.ts` (root package.json, pnpm-workspace.yaml, watchman, npmrc) and `tinycld/scripts/generate.ts:59-161` (biome inlining — move, don't duplicate; Task 2 deletes the generate.ts copy). Full implementation:

```ts
#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

// Single writer of every workspace-root coordination file. Two callers:
//   1. @tinycld/bootstrap, right after cloning, via bare `node <this file>`
//      (Node >=24 native type stripping) — so the FIRST `pnpm install`
//      resolves with correct version pins.
//   2. scripts/generate.ts (every install's postinstall) — so `git pull` +
//      `pnpm install` self-heals root files without re-running bootstrap.
//
// KEEP SELF-CONTAINED: caller 1 runs before any install, so this file may
// import only node:* builtins and must stay erasable TypeScript (no enums).
//
// Version pins come from core/package-versions.json (the SOURCE OF TRUTH,
// committed with core). Notable pin constraints preserved from the old
// bootstrap FRAMEWORK_OVERRIDES table:
//   - @tanstack/db / react-db / query-db-collection move in LOCKSTEP:
//     react-db and query-db-collection call internals of a specific db
//     version; letting one float produces a workspace that installs clean
//     and dies at import ("isCollection is not a function" /
//     "getLoadSubsetDemandKey").
//   - react-native-drax is a git FORK ref, not a semver: upstream lacks
//     fixes the kanban board drag depends on.
//
// TINYCLD_SERVER_REBUILD: the server (OTA) build pipeline sets this on its
// `pnpm install`. Builds must keep the pins the ACTIVE build shipped with
// (frozen at the embedded native binary's versions), and their
// pnpm-workspace.yaml is Go-written and carries a storeDir: this script must
// not touch either. Under the flag only the root biome.json is written.

const ALL_FEATURES = ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import']
const ALL_MEMBERS = ['tinycld', 'tinycld/core', 'tinycld/package-scripts', ...ALL_FEATURES]
const NON_MEMBER_DIRS = ['bootstrap', 'utils', 'web']

// pnpm version pinned via package.json "packageManager" so corepack resolves
// the same pnpm everywhere (local, CI, EAS).
const PNPM_VERSION = '11.3.0'

const POSTINSTALL =
    'tsx scripts/link-members.ts && cd tinycld && pnpm run packages:generate && cd .. && tsx scripts/link-members.ts && cd tinycld && pnpm run assets:copy-pdfjs'

const DERIVED_DOC =
    'DERIVED FILE — do not edit. Generated by tinycld/scripts/write-workspace-root.ts from tinycld/core/package-versions.json (the source of truth). The Go OTA rebuild (core/server/pkgbuild) reads THIS copy to emit the pnpm overrides block on the server, where the root-writer must not re-derive it (see TINYCLD_SERVER_REBUILD).'

export function readCoreVersions(appDir: string): Record<string, string> {
    const file = path.join(appDir, 'core', 'package-versions.json')
    let raw: string
    try {
        raw = fs.readFileSync(file, 'utf8')
    } catch (err) {
        throw new Error(`[workspace-root] cannot read ${file}: ${(err as Error).message}`)
    }
    let parsed: Record<string, string>
    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        throw new Error(`[workspace-root] malformed JSON in ${file}: ${(err as Error).message}`)
    }
    const { '//': _doc, ...pins } = parsed
    if (Object.keys(pins).length === 0) {
        throw new Error(`[workspace-root] ${file} has no version pins`)
    }
    return pins
}

// Mirrors the Go renderOverridesBlock (core/server/pkgbuild/assemble.go) so
// both generators emit byte-identical blocks: sorted for a stable diff,
// scoped names (leading @) single-quoted so YAML doesn't read them as
// anchors, plain names bare.
export function renderOverridesBlock(overrides: Record<string, string>): string {
    const lines = ['overrides:']
    for (const name of Object.keys(overrides).sort()) {
        const key = name.startsWith('@') ? `'${name}'` : name
        lines.push(`  ${key}: ${overrides[name]}`)
    }
    return lines.join('\n')
}

// Direct child dirs of wsRoot that look like a feature member already on
// disk (package.json + manifest.ts/js). Mirrors the generator's discovery so
// a CI-checked-out or custom member absent from ALL_MEMBERS still gets
// linked by pnpm.
function discoverPresentMembers(wsRoot: string): string[] {
    let entries: string[]
    try {
        entries = fs.readdirSync(wsRoot)
    } catch {
        return []
    }
    return entries.filter((name) => {
        if (name === 'node_modules' || name.startsWith('.')) return false
        const dir = path.join(wsRoot, name)
        try {
            if (!fs.statSync(dir).isDirectory()) return false
        } catch {
            return false
        }
        const hasManifest = fs.existsSync(path.join(dir, 'manifest.ts')) || fs.existsSync(path.join(dir, 'manifest.js'))
        return fs.existsSync(path.join(dir, 'package.json')) && hasManifest
    })
}

function memberUnion(wsRoot: string): string[] {
    return [...new Set([...ALL_MEMBERS, ...discoverPresentMembers(wsRoot)])]
}

function pnpmWorkspaceYaml(wsRoot: string, pins: Record<string, string>): string {
    const members = memberUnion(wsRoot)
        .map((m) => `  - ${m}`)
        .join('\n')
    return [
        'nodeLinker: hoisted',
        'linkWorkspacePackages: true',
        'strictPeerDependencies: false',
        'enablePrePostScripts: true',
        '',
        '# pnpm 11 ships a default minimumReleaseAge supply-chain gate (~24h) that',
        '# rejects very freshly-published versions. The @tinycld/* libraries are',
        '# first-party and released in lockstep with these members, so a same-day',
        '# pbtsdb (or other @tinycld dep) bump must install immediately rather than',
        '# blocking install/CI for a day. Exclude them from the gate; third-party',
        '# packages still get the freshness window.',
        'minimumReleaseAgeExclude:',
        '  - pbtsdb',
        "  - '@tinycld/*'",
        '',
        'packages:',
        members,
        '',
        '# Build-script approvals (pnpm blocks dependency build scripts by default).',
        'allowBuilds:',
        '  esbuild: true',
        "  '@sentry/cli': true",
        '',
        '# Framework/native/styling version pins — derived from',
        '# tinycld/core/package-versions.json (the source of truth) by',
        "# tinycld/scripts/write-workspace-root.ts. These keep the OTA rebuild's",
        '# --no-frozen-lockfile install from drifting these deps off the embedded',
        '# native binary.',
        renderOverridesBlock(pins),
        '',
    ].join('\n')
}

// The directories watchman must NOT crawl. CRITICAL: the root node_modules is
// NOT ignored — under node-linker=hoisted it is the flat store Metro resolves
// EVERY dependency from; hiding it breaks module resolution. Only
// node_modules/.cache (Metro transform cache) is excluded. Member
// node_modules ARE ignored (near-empty under hoisting, pure crawl cost).
function watchmanConfig(wsRoot: string): string {
    const members = memberUnion(wsRoot)
    const memberDirs = members.flatMap((m) => [`${m}/node_modules`, `${m}/.git`])
    const testResultDirs = members.filter((m) => !m.startsWith('tinycld')).map((m) => `${m}/test-results`)
    const nonMemberDirs = NON_MEMBER_DIRS.flatMap((d) => [`${d}/node_modules`, `${d}/.git`, `${d}/dist`])
    const ignoreDirs = [
        '.git',
        'node_modules/.cache',
        ...memberDirs,
        ...nonMemberDirs,
        'tinycld/ios',
        'tinycld/android',
        'tinycld/modules/app-updater/android/build',
        'tinycld/modules/app-updater/ios/build',
        'tinycld/.expo',
        'tinycld/dist',
        'tinycld/server/pb_data',
        'tinycld/server/pb_test_data',
        'tinycld/test-results',
        'tinycld/playwright-report',
        ...testResultDirs,
    ]
    const config = {
        enable_parallel_crawl: true,
        // fsevents_try_resync false (watchman's own default since 2021):
        // resync-from-journal usually fails on macOS and falls back to a full
        // recrawl — the 60s "syncToNow" stall on Metro start. Skip it.
        fsevents_try_resync: false,
        // 1.0s batches change notifications so an install/checkout burst
        // doesn't overflow the fsevents kernel queue on slow volumes; costs
        // ~1s of HMR detection lag. (default 0.01)
        fsevents_latency: 1.0,
        ignore_dirs: [...new Set(ignoreDirs)],
    }
    return `${JSON.stringify(config, null, 4)}\n`
}

function writeRootPackageJSON(wsRoot: string): void {
    const pkgPath = path.join(wsRoot, 'package.json')
    let existing: Record<string, unknown> = {}
    if (fs.existsSync(pkgPath)) {
        try {
            existing = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        } catch {
            // Unparseable existing file — start from defaults
        }
    }
    const existingScripts =
        typeof existing.scripts === 'object' && existing.scripts !== null
            ? (existing.scripts as Record<string, string>)
            : {}
    const existingDevDeps =
        typeof existing.devDependencies === 'object' && existing.devDependencies !== null
            ? (existing.devDependencies as Record<string, string>)
            : {}
    const pkg = {
        name: '@tinycld/workspace',
        version: '0.0.0',
        private: true,
        type: 'module',
        ...existing,
        packageManager: `pnpm@${PNPM_VERSION}`,
        // Monorepo-detection hint for external tooling (EAS/expo archiver
        // keys off the npm `workspaces` field); pnpm reads members from
        // pnpm-workspace.yaml and ignores this.
        workspaces: memberUnion(wsRoot),
        scripts: {
            ...existingScripts,
            postinstall: POSTINSTALL,
        },
        devDependencies: {
            ...existingDevDeps,
            tsx: '^4.21.0',
        },
    }
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
}

// --- root biome.json (moved verbatim from scripts/generate.ts) ---
// Biome only searches UPWARD for config and the canonical biome.json lives at
// <ws-root>/tinycld/ — a sibling of the feature members. This root:true copy
// INLINES the canonical (a file-path `extends` silently drops `plugins`,
// biome #8488/#8524) with globs/plugin paths re-rooted one dir up. vcs.root
// stays 'tinycld' — only tinycld/.gitignore lists the generated artifacts.

function rerootGlob(glob: string, appDirName: string): string {
    const negated = glob.startsWith('!')
    const body = negated ? glob.slice(1) : glob
    if (body.startsWith('**') || body.startsWith('/')) return glob
    const rerooted = `${appDirName}/${body}`
    return negated ? `!${rerooted}` : rerooted
}

function rerootPluginPath(p: string, appDirName: string): string {
    if (path.isAbsolute(p)) return p
    return `./${appDirName}/${p.replace(/^\.\//, '')}`
}

type PluginEntry = string | { path: string; includes?: string[] }

function rerootPlugins(plugins: PluginEntry[], appDirName: string): PluginEntry[] {
    return plugins.map((entry) =>
        typeof entry === 'string'
            ? rerootPluginPath(entry, appDirName)
            : { ...entry, path: rerootPluginPath(entry.path, appDirName) }
    )
}

function writeRootBiomeConfig(wsRoot: string, appDir: string): void {
    const appDirName = path.basename(appDir)
    const canonicalPath = path.join(appDir, 'biome.json')
    // A runtime rebuild's build tree may not carry the canonical config (it
    // never lints) — skip rather than abort the whole run.
    if (!fs.existsSync(canonicalPath)) {
        console.warn(`[workspace-root] ${canonicalPath} absent — skipping ws-root biome.json (lint-only)`)
        return
    }
    const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))
    const config = {
        ...canonical,
        $schema: 'https://biomejs.dev/schemas/2.5.0/schema.json',
        root: true,
        vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true, root: appDirName },
    }
    delete config.extends
    if (config.files?.includes) {
        config.files = {
            ...config.files,
            includes: config.files.includes.map((g: string) => rerootGlob(g, appDirName)),
        }
    }
    if (config.plugins) config.plugins = rerootPlugins(config.plugins, appDirName)
    fs.writeFileSync(path.join(wsRoot, 'biome.json'), `${JSON.stringify(config, null, 4)}\n`)
}

function warnIfPinsChanged(wsRoot: string, pins: Record<string, string>): void {
    const derivedPath = path.join(wsRoot, 'package-versions.json')
    if (!fs.existsSync(derivedPath)) return
    let previous: Record<string, string>
    try {
        previous = JSON.parse(fs.readFileSync(derivedPath, 'utf8'))
    } catch {
        return
    }
    const { '//': _doc, ...prevPins } = previous
    if (JSON.stringify(prevPins, Object.keys(prevPins).sort()) === JSON.stringify(pins, Object.keys(pins).sort()))
        return
    console.warn(
        '[workspace-root] version pins changed — run pnpm install again to apply the new overrides to node_modules'
    )
}

export function writeWorkspaceRoot(
    wsRoot: string = path.resolve(import.meta.dirname, '..', '..'),
    appDir: string = path.resolve(import.meta.dirname, '..')
): void {
    writeRootBiomeConfig(wsRoot, appDir)
    if (process.env.TINYCLD_SERVER_REBUILD) {
        // Server (OTA) build: pins must stay frozen at the active build's
        // versions and the Go-written pnpm-workspace.yaml (with storeDir)
        // must not be clobbered. biome.json above is the only safe output.
        console.log('[workspace-root] TINYCLD_SERVER_REBUILD set — leaving pin files and pnpm-workspace.yaml frozen')
        return
    }
    const pins = readCoreVersions(appDir)
    warnIfPinsChanged(wsRoot, pins)
    writeRootPackageJSON(wsRoot)
    fs.writeFileSync(path.join(wsRoot, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(wsRoot, pins))
    fs.writeFileSync(
        path.join(wsRoot, 'package-versions.json'),
        `${JSON.stringify({ '//': DERIVED_DOC, ...pins }, null, 4)}\n`
    )
    fs.writeFileSync(path.join(wsRoot, '.watchmanconfig'), watchmanConfig(wsRoot))
    const npmrcPath = path.join(wsRoot, '.npmrc')
    if (!fs.existsSync(npmrcPath)) {
        fs.writeFileSync(npmrcPath, '# pnpm settings live in pnpm-workspace.yaml (pnpm 10+ reads them there).\n')
    }
}

const invokedAsScript =
    process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedAsScript) {
    writeWorkspaceRoot()
    console.log('[workspace-root] workspace root files written')
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/write-workspace-root.test.ts`
Expected: PASS (all 12).

- [ ] **Step 7: Verify bare-node executability (the bootstrap contract)**

Run it with plain `node` (no tsx) against a throwaway root, not the real one. The script's defaults resolve relative to its own location (`scripts/` → `appDir` = parent, `wsRoot` = grandparent), so it must sit at `$d/tinycld/scripts/`:

```bash
cd ~/code/tinycld
d=$(mktemp -d) && mkdir -p "$d/tinycld/core" "$d/tinycld/scripts" \
  && cp tinycld/core/package-versions.json "$d/tinycld/core/" \
  && cp tinycld/biome.json "$d/tinycld/" \
  && cp tinycld/scripts/write-workspace-root.ts "$d/tinycld/scripts/" \
  && (cd "$d" && node tinycld/scripts/write-workspace-root.ts) \
  && grep -c 'overrides:' "$d/pnpm-workspace.yaml"
```

Expected: prints `1` (the overrides block landed) with no tsx installed in `$d` and no warnings from node about stripping types failing.

- [ ] **Step 8: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/package-versions.json scripts/write-workspace-root.ts scripts/__tests__/write-workspace-root.test.ts
git commit -m "feat: core-owned vendor version pins + workspace root-writer"
```

---

### Task 2: Generator calls the root-writer every install

**Files:**
- Modify: `tinycld/scripts/generate.ts` (delete lines 59-161: `rerootGlob`, `rerootPluginPath`, `PluginEntry`, `rerootPlugins`, `writeRootBiomeConfig`; replace the `writeRootBiomeConfig()` call at line ~732)
- Test: existing `tinycld/scripts/__tests__/` suite (no new test file — the root-writer is tested in Task 1; this task is wiring)

**Interfaces:**
- Consumes: `writeWorkspaceRoot()` from `./write-workspace-root` (Task 1), called with no args (its defaults resolve the real APP_DIR/WS_ROOT from its own file location — note it does NOT honor `TINYCLD_APP_DIR`; generator tests that need dir injection call `writeWorkspaceRoot(wsRoot, appDir)` explicitly).
- Produces: every `pnpm install` (postinstall → `packages:generate` → `generate.ts`) now rewrites all root files from core's table.

- [ ] **Step 1: Wire in the root-writer**

In `tinycld/scripts/generate.ts`:

1. Add to the imports: `import { writeWorkspaceRoot } from './write-workspace-root'`
2. Delete the moved block (the `rerootGlob` / `rerootPluginPath` / `PluginEntry` / `rerootPlugins` helpers and the whole `writeRootBiomeConfig` function, lines 59-161).
3. Replace the `writeRootBiomeConfig()` call in `main()` (line ~732) with `writeWorkspaceRoot()`.

- [ ] **Step 2: Typecheck + lint the app member**

Run: `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg typecheck && biome check scripts/generate.ts scripts/write-workspace-root.ts`
Expected: clean.

- [ ] **Step 3: Run the generator against the real workspace and inspect**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate`
Expected: exits 0. Then verify the real root files were re-derived correctly:

```bash
cd ~/code/tinycld
python3 - <<'EOF'
import json
core = json.load(open('tinycld/core/package-versions.json')); core.pop('//', None)
root = json.load(open('package-versions.json')); root.pop('//', None)
assert core == root, 'root derived copy != core table'
yaml = open('pnpm-workspace.yaml').read()
missing = [k for k in core if f"{k}:" not in yaml and f"'{k}':" not in yaml]
assert not missing, f'missing from overrides block: {missing}'
print('root files match core table')
EOF
git -C tinycld status --short   # generate must not have dirtied the tinycld repo
```

Expected: `root files match core table`; tinycld repo status shows only the files from Tasks 1-2.

- [ ] **Step 4: Run the scripts test suite**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/`
Expected: PASS (existing generator tests + Task 1's).

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add scripts/generate.ts
git commit -m "feat: generator delegates workspace-root files to write-workspace-root"
```

---

### Task 3: Go env guard — server rebuilds never unfreeze pins

**Files:**
- Modify: `tinycld/core/server/pkgbuild/exec.go` (add `RunCmdStreamingEnv`, ~line 98)
- Modify: `tinycld/core/server/pkgbuild/pipeline.go` (`runPnpmInstall`, ~line 290)
- Modify: `tinycld/core/server/pkgbuild/assemble.go` (comment on `OverridesFile`, ~line 36)
- Test: `tinycld/core/server/pkgbuild/exec_test.go` (or the package's existing test file for exec helpers)

**Interfaces:**
- Consumes: nothing from other tasks (independent; pairs with Task 1's env contract).
- Produces: `RunCmdStreamingEnv(onLine func(string), dir string, extraEnv []string, name string, args ...string) (string, error)`; exported const `ServerRebuildEnv = "TINYCLD_SERVER_REBUILD=1"` in pipeline.go. The default (non-injected) pnpm install path sets that env var.

- [ ] **Step 1: Write the failing test**

Add to the pkgbuild test files (create `exec_env_test.go` if no exec test file exists):

```go
package pkgbuild

import (
	"strings"
	"testing"
)

func TestRunCmdStreamingEnvPassesExtraEnv(t *testing.T) {
	var lines []string
	out, err := RunCmdStreamingEnv(
		func(line string) { lines = append(lines, line) },
		t.TempDir(), []string{"TINYCLD_TEST_FLAG=frozen"},
		"sh", "-c", `printf '%s\n' "$TINYCLD_TEST_FLAG"`,
	)
	if err != nil {
		t.Fatalf("RunCmdStreamingEnv: %v", err)
	}
	if !strings.Contains(out, "frozen") {
		t.Fatalf("extra env not visible to child; out=%q", out)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./pkgbuild/ -run TestRunCmdStreamingEnvPassesExtraEnv`
Expected: FAIL to compile — `undefined: RunCmdStreamingEnv`.

- [ ] **Step 3: Implement**

In `exec.go`, rename the body of `RunCmdStreaming` into the new env variant and delegate (exact mirror of the existing `RunCmd`/`RunCmdEnv` pair at lines 37-45):

```go
// RunCmdStreaming executes with line streaming and the inherited env.
func RunCmdStreaming(onLine func(line string), dir, name string, args ...string) (string, error) {
	return RunCmdStreamingEnv(onLine, dir, nil, name, args...)
}

// RunCmdStreamingEnv is RunCmdStreaming with extra environment entries
// ("KEY=VALUE") appended to the inherited env — the streaming mirror of
// RunCmdEnv.
func RunCmdStreamingEnv(onLine func(line string), dir string, extraEnv []string, name string, args ...string) (string, error) {
	log.Debug("$ command", "dir", dir, "cmd", name, "args", strings.Join(args, " "))
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if len(extraEnv) > 0 {
		cmd.Env = append(os.Environ(), extraEnv...)
	}
	// ... (unchanged existing body of RunCmdStreaming from here down)
}
```

In `pipeline.go`, add the const near the Pipeline type and use it in `runPnpmInstall`:

```go
// ServerRebuildEnv marks a pnpm install run by the server build pipeline.
// The workspace root-writer (tinycld/scripts/write-workspace-root.ts) skips
// re-deriving pnpm-workspace.yaml and package-versions.json when it is set,
// keeping the version pins frozen at the ACTIVE build's versions (the ones
// matching the embedded native binary) instead of following an upgraded
// tinycld member's newer core table.
const ServerRebuildEnv = "TINYCLD_SERVER_REBUILD=1"

func (p Pipeline) runPnpmInstall(sink ProgressSink, buildDir string) error {
	throttle := newPnpmProgressThrottle()
	onLine := func(line string) { p.reportPnpmProgress(sink, line, throttle) }
	var out string
	var err error
	if p.PnpmStream != nil {
		// Injected stream (tests) — the fake never runs the generator, so
		// the guard env is irrelevant there.
		out, err = p.PnpmStream(onLine, buildDir, "pnpm", "install", "--no-frozen-lockfile")
	} else {
		out, err = RunCmdStreamingEnv(onLine, buildDir, []string{ServerRebuildEnv}, "pnpm", "install", "--no-frozen-lockfile")
	}
	if err != nil {
		// (unchanged ErrFromCmd tail)
		return ErrFromCmd("pnpm install", lastLines(out, 30), err)
	}
	return nil
}
```

In `assemble.go`, extend the `OverridesFile` doc comment (line ~36) to note the new source of truth:

```go
// OverridesFile is the workspace-root data file holding the framework/native/
// styling version pins. It is a DERIVED copy of tinycld/core/package-versions.json
// (the source of truth, committed with core), written on dev machines by
// tinycld/scripts/write-workspace-root.ts and copied verbatim from srcRoot into
// each new build (via scaffoldExtras) so OTA pins stay frozen at the active
// build's versions — see ServerRebuildEnv in pipeline.go.
```

- [ ] **Step 4: Run the Go tests**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./pkgbuild/`
Expected: PASS (new test + all existing — `assemble_test.go` is untouched by design).

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/pkgbuild/exec.go core/server/pkgbuild/pipeline.go core/server/pkgbuild/assemble.go core/server/pkgbuild/exec_env_test.go
git commit -m "feat: freeze version pins during server rebuild installs"
```

---

### Task 4: Bootstrap clones and delegates — no versions, no root-file formats

**Files:**
- Modify: `bootstrap/src/assemble-workspace.ts` (delete `FRAMEWORK_OVERRIDES`, `OVERRIDES_DOC`, `renderOverridesBlock`, `pnpmWorkspaceYaml`, `watchmanConfig`, `NON_MEMBER_DIRS`, `PNPM_VERSION`, `discoverPresentMembers`, `writeWorkspaceManifest`, `writeRootBiomeConfig`, `rerootBiomeGlob`, `rerootBiomePluginPath`, `ALL_MEMBERS`; add `delegateWorkspaceRoot`; reorder `assembleWorkspace`)
- Modify: `bootstrap/src/index.ts` (only if it imports a deleted symbol — `runAssembleOnly` uses `assembleWorkspace`, which keeps its signature)
- Modify: `bootstrap/templates/full/package.json`, `bootstrap/templates/settings-only/package.json` (drop `peerDependencies`)
- Test: `bootstrap/tests/assemble-workspace.test.ts` (rewrite), plus fix any other test in `bootstrap/tests/` that asserts on deleted outputs (`assemble-only-mode.test.ts`, `scaffolder.test.ts` assert on template contents — check and update)

**Interfaces:**
- Consumes: the Task 1 script contract — `node <wsRoot>/tinycld/scripts/write-workspace-root.ts` writes all root files, exit 0 on success, hard-errors (non-zero) on a missing/malformed core table.
- Produces: `assembleWorkspace(opts)` keeps its existing exported signature and return value; new internal behavior: clone → copy templates → delegate. `writeWorkspaceManifest` is deleted from the module's exports.

- [ ] **Step 1: Branch**

```bash
cd ~/code/tinycld/bootstrap && git checkout -b core-owned-vendor-versions
```

- [ ] **Step 2: Rewrite the tests first**

In `bootstrap/tests/assemble-workspace.test.ts`: delete the `describe('writeWorkspaceManifest')` block entirely (all ~15 call sites). Keep `describe('copyWorkspaceTemplate')`. Update any `assembleWorkspace` tests that assert on root files bootstrap no longer writes. Add the delegation tests:

```ts
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// (merge with the file's existing imports/tmpdir helpers)

// A clone fake that materializes a minimal tinycld repo carrying a
// root-writer script which records its invocation. The fake repo's
// package.json declares "type":"module" so bare `node` runs the stub .ts
// file as ESM (matching the real tinycld repo, which is type:module).
function fakeCloneWithRootWriter(url: string, dest: string): boolean {
    mkdirSync(join(dest, 'scripts'), { recursive: true })
    writeFileSync(join(dest, 'package.json'), '{"name":"tinycld","type":"module"}')
    if (url.endsWith('/tinycld.git')) {
        writeFileSync(
            join(dest, 'scripts', 'write-workspace-root.ts'),
            "import fs from 'node:fs'\nfs.writeFileSync('root-writer-ran.txt', 'yes')\n"
        )
    }
    return true
}

describe('assembleWorkspace delegation', () => {
    it('runs the cloned root-writer after cloning', () => {
        const dir = tmpdir()
        assembleWorkspace({ root: dir, clone: fakeCloneWithRootWriter })
        expect(readFileSync(join(dir, 'root-writer-ran.txt'), 'utf8')).toBe('yes')
    })

    it('fails with a clear message when the cloned tinycld predates the root-writer', () => {
        const dir = tmpdir()
        const cloneWithoutWriter = (_url: string, dest: string): boolean => {
            mkdirSync(dest, { recursive: true })
            writeFileSync(join(dest, 'package.json'), '{"name":"tinycld"}')
            return true
        }
        expect(() => assembleWorkspace({ root: dir, clone: cloneWithoutWriter })).toThrow(
            /write-workspace-root\.ts.*tinycldRef|older bootstrap/
        )
    })

    it('does not write pnpm-workspace.yaml itself before delegation', () => {
        const dir = tmpdir()
        const failingClone = (): boolean => false
        assembleWorkspace({ root: dir, clone: failingClone })
        expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(false)
        expect(existsSync(join(dir, 'package.json'))).toBe(false)
    })
})
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd ~/code/tinycld/bootstrap && pnpm test -- assemble-workspace`
Expected: delegation tests FAIL (assembleWorkspace still writes manifests itself and never delegates); deleted-block tests are gone.

- [ ] **Step 4: Implement the slim assemble-workspace.ts**

Delete the symbols listed in **Files** above. `ALL_FEATURES`, `splitRef`, `realClone`, `copyWorkspaceTemplate`, `resolveWorkspaceTemplateDir`, `AssembleWorkspaceOptions` remain. Add:

```ts
/**
 * Run the workspace root-writer that ships INSIDE the cloned tinycld repo.
 * Bootstrap deliberately knows nothing about the root files' contents — not
 * the vendor version pins (tinycld/core/package-versions.json) and not the
 * file formats. A vendor bump or format change is a tinycld commit, never a
 * bootstrap release. Node >=24 (our engines floor) executes the TypeScript
 * directly via native type stripping; the script is self-contained by
 * contract, so no install has to have happened yet.
 */
function delegateWorkspaceRoot(root: string): void {
    const script = join(root, 'tinycld', 'scripts', 'write-workspace-root.ts')
    if (!existsSync(script)) {
        throw new Error(
            `${script} not found — the cloned tinycld ref predates core-owned workspace roots. ` +
                'Pass a newer tinycldRef (or use an older @tinycld/bootstrap that still writes root files itself).'
        )
    }
    const r = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
    if (r.status !== 0) {
        throw new Error(`write-workspace-root failed (exit ${r.status ?? 'signal'}) — see output above`)
    }
}
```

Reorder the tail of `assembleWorkspace` (replacing the current `writeWorkspaceManifest(opts.root)` + `copyWorkspaceTemplate(opts.root)` pre-clone calls):

```ts
export function assembleWorkspace(opts: AssembleWorkspaceOptions): string[] {
    // ... (unchanged: validate members, repoBase, clone fn, refByName build)

    const present: string[] = []
    for (const [name, ref] of refByName) {
        const dest = join(opts.root, name)
        if (existsSync(join(dest, '.git')) || existsSync(join(dest, 'package.json'))) {
            present.push(name)
            continue
        }
        if (clone(`${repoBase}/${name}.git`, dest, ref)) present.push(name)
    }

    // Root scaffolding AFTER cloning: the static template files bootstrap
    // still owns (never overwrites), then the cloned repo's own root-writer
    // for everything content-bearing. Skip delegation when tinycld itself
    // failed to clone — the caller (runAssembleOnly) raises the clearer
    // "failed to clone required member" error.
    copyWorkspaceTemplate(opts.root)
    if (present.includes('tinycld')) delegateWorkspaceRoot(opts.root)
    return present
}
```

Also drop the now-unused imports (`writeFileSync` stays for nothing? — remove any import the compiler flags) and add `spawnSync` to the `node:child_process` import (already imported at line 1).

- [ ] **Step 5: Slim the scaffold templates**

In `bootstrap/templates/full/package.json` and `bootstrap/templates/settings-only/package.json`: delete the entire `"peerDependencies"` object. Everything else stays.

- [ ] **Step 6: Run the full bootstrap suite and fix fallout**

Run: `cd ~/code/tinycld/bootstrap && pnpm run checks && pnpm test`
Expected: PASS. If `scaffolder.test.ts` / `assemble-only-mode.test.ts` assert scaffolded packages contain `peerDependencies` or assert root-file contents bootstrap no longer writes, update those assertions to the new reality (scaffolded package.json has no peerDependencies key; assemble writes no pnpm-workspace.yaml without a tinycld clone). Do not weaken unrelated assertions.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/bootstrap && git add -A src templates tests
git commit -m "feat: delegate workspace-root files to the cloned tinycld repo"
```

(Do not bump the version or publish — the release must wait until Task 1-3 are merged to tinycld main; see rollout notes at the end.)

---

### Task 5: Slim feature repos' peerDependencies

**Files (one repo at a time, each on branch `core-owned-vendor-versions`):**
- Modify: `contacts/package.json`, `mail/package.json`, `calendar/package.json`, `drive/package.json`, `calc/package.json`, `text/package.json`, `google-takeout-import/package.json`

**Interfaces:**
- Consumes: the covered set = keys of `tinycld/core/package-versions.json` (Task 1) ∪ keys of `tinycld/core/package.json` `peerDependencies`. Anything in that set is deleted from a feature's peers; anything not in it stays.
- Produces: no API change — these ranges never drove resolution under `nodeLinker: hoisted` + `strictPeerDependencies: false`.

- [ ] **Step 1: Apply the exact per-repo results**

For **contacts, mail, calendar, drive**: every current entry is covered — delete the entire `"peerDependencies"` object.

For **calc**, replace the `peerDependencies` object with exactly:

```json
    "peerDependencies": {
        "@tinycld/drive": ">=0.2.0 <0.3.0",
        "expo-print": "^55.0.14",
        "expo-sharing": "~55.0.18",
        "hyperformula": ">=3.0.0",
        "numfmt": ">=3.2"
    }
```

For **text**, replace with exactly (the kept @tiptap subpackages are the ones core's peers do NOT list; core covers `@tiptap/core`, `extension-collaboration`, `extension-collaboration-caret`, `extension-image`, `extension-list`, `extension-placeholder`, `extension-table`, `extensions`, `markdown`, `react`, `starter-kit`, `suggestion`):

```json
    "peerDependencies": {
        "@tiptap/extension-blockquote": "^3.29.2",
        "@tiptap/extension-bullet-list": "^3.29.2",
        "@tiptap/extension-code": "^3.29.2",
        "@tiptap/extension-code-block": "^3.29.2",
        "@tiptap/extension-color": "^3.29.2",
        "@tiptap/extension-heading": "^3.29.2",
        "@tiptap/extension-horizontal-rule": "^3.29.2",
        "@tiptap/extension-ordered-list": "^3.29.2",
        "@tiptap/extension-table-cell": "^3.29.2",
        "@tiptap/extension-table-header": "^3.29.2",
        "@tiptap/extension-table-row": "^3.29.2",
        "@tiptap/extension-text-align": "^3.29.2",
        "@tiptap/extension-text-style": "^3.29.2",
        "@tiptap/pm": "~3.29.2",
        "expo-print": "^55.0.14",
        "markdown-it": "^14.1.1",
        "prosemirror-model": "^1.25.11",
        "prosemirror-state": "^1.4.4",
        "prosemirror-transform": "^1.12.0",
        "prosemirror-view": "^1.41.9",
        "ulid": "^3.0.2"
    }
```

For **google-takeout-import**, replace with exactly:

```json
    "peerDependencies": {
        "fflate": "^0.8.2",
        "ical.js": "^2.2.1"
    }
```

- [ ] **Step 2: Verify the covered-set math mechanically**

```bash
cd ~/code/tinycld && python3 - <<'EOF'
import json
core = json.load(open('tinycld/core/package.json'))
table = json.load(open('tinycld/core/package-versions.json'))
covered = set(core.get('peerDependencies', {})) | {k for k in table if k != '//'}
for repo in ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import']:
    peers = json.load(open(f'{repo}/package.json')).get('peerDependencies', {})
    wrong = [k for k in peers if k in covered and not k.startswith('@tinycld/')]
    print(repo, 'OK' if not wrong else f'STILL COVERED: {wrong}')
EOF
```

Expected: seven lines of `OK`.

- [ ] **Step 3: Full workspace still installs and checks**

Run: `cd ~/code/tinycld && pnpm install` then `cd tinycld && pnpm run checks`
Expected: install completes (peers never drove resolution, so node_modules is unchanged); checks pass.

- [ ] **Step 4: Commit each repo**

```bash
cd ~/code/tinycld
for r in contacts mail calendar drive calc text google-takeout-import; do
  git -C "$r" checkout -b core-owned-vendor-versions
  git -C "$r" add package.json
  git -C "$r" commit -m "chore: drop vendor peerDependencies now covered by @tinycld/core"
done
```

---

### Task 6: Documentation

**Files:**
- Modify: `tinycld/CONTRIBUTING.md` (new "Vendor version pins" subsection wherever dependency/install mechanics are documented)
- Modify: `CLAUDE.md` at the workspace root (the "Assembling & installing a workspace" / member-anatomy areas reference bootstrap-owned pins implicitly; add the bump workflow)
- Modify: `bootstrap/README.md` (note that root files come from the cloned tinycld repo)

**Interfaces:** none — prose only. Content requirements (write in each doc's existing voice; this is the substance, not literal copy):

- [ ] **Step 1: tinycld/CONTRIBUTING.md**

Add a subsection covering: `core/package-versions.json` is the source of truth for the ecosystem's pinned vendor versions (shared stack + every native module in the EAS binary, even single-feature ones); feature-specific pure-JS libraries live in the feature's own `peerDependencies` instead; `scripts/write-workspace-root.ts` derives all workspace-root files from it on every install (and bootstrap runs it at assemble time); the bump workflow (edit the table → commit → devs `git pull` + `pnpm install`, twice if the writer warns → pins ride the next core release and the next EAS build); server rebuilds freeze pins via `TINYCLD_SERVER_REBUILD` (pointer to `ServerRebuildEnv` in pkgbuild).

- [ ] **Step 2: workspace CLAUDE.md**

In the ecosystem CLAUDE.md, add one short paragraph (near the "Generated output is gitignored" section, which should also gain `pnpm-workspace.yaml` / root `package-versions.json` / `.watchmanconfig` if not already implied): vendor versions are pinned in `tinycld/core/package-versions.json`; to bump one, edit that file only — never bootstrap, never a feature's peers.

- [ ] **Step 3: bootstrap/README.md**

Update the assemble description: bootstrap clones members, then the cloned tinycld repo's `scripts/write-workspace-root.ts` writes all root coordination files; bootstrap carries no version pins. Note the minimum compatible tinycld ref for `--assemble-only` (the release containing Task 1).

- [ ] **Step 4: Commit**

```bash
cd ~/code/tinycld/tinycld && git add CONTRIBUTING.md && git commit -m "docs: core-owned vendor version pins"
cd ~/code/tinycld && git add CLAUDE.md && git commit -m "docs: vendor version bump workflow"
cd ~/code/tinycld/bootstrap && git add README.md && git commit -m "docs: root files now come from the cloned tinycld repo"
```

---

### Task 7: End-to-end verification

**Files:** none created — verification only.

- [ ] **Step 1: Fresh-assemble simulation with the local bootstrap**

Simulate `--assemble-only` against the local repos (file:// clones avoid network/SSH):

```bash
d=$(mktemp -d) && cd ~/code/tinycld/bootstrap \
  && TINYCLD_REPO_BASE="file://$HOME/code/tinycld" \
     node --experimental-strip-types src/index.ts --assemble-only --with mail --dir "$d" 2>/dev/null \
     || (cd "$d" && TINYCLD_REPO_BASE="file://$HOME/code/tinycld" npx tsx ~/code/tinycld/bootstrap/src/index.ts --assemble-only --with mail)
```

(Use whichever invocation the bootstrap CLI actually supports for a target dir — check `args.ts`; if there is no `--dir` flag, `cd "$d"` first, matching `runAssembleOnly`'s `process.cwd()` default. `file://` clones fetch the checked-out branches, so make sure the tinycld repo's `core-owned-vendor-versions` branch is what HEAD points at, or pass `--with tinycld@core-owned-vendor-versions`.)

Then assert the assembled root:

```bash
grep -q 'overrides:' "$d/pnpm-workspace.yaml" && grep -q 'expo: 55' "$d/pnpm-workspace.yaml" \
  && python3 -c "import json; d=json.load(open('$d/package-versions.json')); assert d['expo']" \
  && test -f "$d/.watchmanconfig" && test -f "$d/biome.json" \
  && echo 'fresh assemble OK'
```

Expected: `fresh assemble OK`, and nowhere in `bootstrap/src` does a vendor version string remain: `grep -rn '55\.0\.26\|0\.83\.6\|FRAMEWORK_OVERRIDES' ~/code/tinycld/bootstrap/src` → no matches.

- [ ] **Step 2: Full quality gates in each touched repo**

```bash
cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg check          # app shell + scripts
cd ~/code/tinycld/tinycld/core && pnpm exec tinycld-pkg check      # core member
cd ~/code/tinycld/tinycld/core/server && go test ./...             # full Go suite
cd ~/code/tinycld/bootstrap && pnpm run checks && pnpm test
```

Expected: all green. Fix any failure at the source (never skip/re-run around it) before proceeding.

- [ ] **Step 3: Real-workspace smoke**

`cd ~/code/tinycld && pnpm install` — postinstall runs the generator → root-writer. Expected: exits 0, no "pins changed" warning on the second consecutive run, `git -C tinycld status` shows only this plan's intended changes.

---

## Rollout order (from the spec — enforce when merging/releasing)

1. Merge the tinycld repo branch (Tasks 1, 2, 3, 6) to `main` first.
2. Merge the seven feature repo branches (Task 5) — independent, any time.
3. Merge + release `@tinycld/bootstrap` (Tasks 4, 6) **only after** step 1 is on tinycld `main`: the delegation target must exist at default clone HEAD.
4. The Go env guard and server-side behavior ship with step 1 automatically (same repo).
