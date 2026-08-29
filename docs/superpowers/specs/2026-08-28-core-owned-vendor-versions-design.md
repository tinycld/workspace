# Core-owned vendor versions

**Date:** 2026-08-28
**Status:** Draft — pending review

## Problem

Vendor (third-party) package versions are declared in four places that must be
kept in sync by hand, across separate git repos:

1. `FRAMEWORK_OVERRIDES` in `bootstrap/src/assemble-workspace.ts` — the exact
   pin table (~30 entries: expo, react-native, reanimated, tanstack, uniwind,
   the drax fork, …). Bootstrap writes it to the workspace root as
   `package-versions.json` and as the pnpm `overrides:` block in
   `pnpm-workspace.yaml`.
2. `@tinycld/core`'s `peerDependencies` — compatibility ranges for the same
   stack.
3. Each feature repo's `peerDependencies` — hand-copied vendor ranges (e.g.
   mail lists 15 of them) that drift freely; under `nodeLinker: hoisted` +
   `strictPeerDependencies: false` they never drive resolution anyway.
4. Bootstrap's new-package templates (`templates/full/package.json`,
   `templates/settings-only/package.json`) — a third copy of loose ranges.

The pins are documented as moving "in lockstep with each native (EAS) build" —
they belong to the **tinycld repo's** release cadence. Yet bumping one (e.g.
the drax fork ref) requires editing bootstrap and cutting a new
`@tinycld/bootstrap` npm release. That is the pain this design removes.

## Goal

- A vendor version bump is **one commit to the tinycld repo**. No bootstrap
  release, ever, for a version change — and none for a *format* change either
  (bootstrap stops knowing the overrides format exists).
- Feature packages stop repeating shared vendor versions. A feature expresses
  "I need the vendor set core X provides" through its existing manifest
  `peerVersions: { '@tinycld/core': '<range>' }`; it declares only libraries
  that are special to it.
- OTA/server rebuild semantics are unchanged: pins stay frozen at the
  embedded-native-binary's versions across rebuilds.

## Non-goals

- Moving bootstrap's clone map (`ALL_FEATURES`) or the `templates/workspace/`
  scaffolding (link-members.ts, test stubs, tinycld.packages.ts) into the
  tinycld repo. Adding a new feature repo still needs a bootstrap release;
  that is rare and out of scope.
- Changing how the app shell (`tinycld/package.json`) declares its real
  `dependencies`, or how a new library gets physically installed (still: add
  it to the app shell's deps).
- pnpm catalogs. Rejected: a second declaration syntax, and both the TS and Go
  generators would have to emit a catalog block, for no benefit over the
  existing `overrides:` mechanism.

## Design (Approach D — bootstrap delegates to the tinycld repo)

### 1. Source of truth: `tinycld/core/package-versions.json`

The pin table moves verbatim (same JSON shape, including the `"//"` doc key)
from bootstrap's `FRAMEWORK_OVERRIDES` to a **committed** file at
`tinycld/core/package-versions.json`. It ships with core, so it is versioned
by core releases: core version X implies exactly one vendor set.

Contents rule — the table is *the ecosystem's pinned vendor set*, a superset
of what core itself imports:

- **Shared stack** (react, react-native, expo-*, tanstack, uniwind, …): in the
  table.
- **Any native module** compiled into the EAS binary — even if only one
  feature uses it (`@shopify/flash-list`, the `react-native-drax` git fork):
  in the table. The OTA rebuild must not drift these off the device's
  embedded binary.
- **Feature-specific pure-JS libraries**: NOT in the table. The feature
  declares them itself with its own range.

### 2. Root-writer module in the tinycld repo

A new module, `tinycld/scripts/write-workspace-root.ts`, becomes the **single
writer** of every workspace-root coordination file. It consolidates logic that
today exists twice (bootstrap's `writeWorkspaceManifest` +
`writeRootBiomeConfig` / the generator's `writeRootBiomeConfig`):

- `package.json` (postinstall script, `packageManager` pin, tsx devDep,
  `workspaces` hint — preserving human-owned fields, as today)
- `pnpm-workspace.yaml` (members, pnpm settings, `allowBuilds`, and the
  `overrides:` block rendered from core's table — byte-identical format to the
  Go renderer, as today)
- `package-versions.json` at the workspace root — now a **derived copy** of
  core's file (kept because the Go build pipeline reads/copies it at the root;
  see §4)
- root `biome.json` (inlined canonical, as the generator already does)
- `.watchmanconfig`, `.npmrc`

Member list: union of the well-known member list (now owned by this module)
and `discoverPresentMembers()` on-disk discovery — same behavior as today,
just relocated. (The list also remains in bootstrap's clone map; see
Non-goals.)

Callers:

- **Bootstrap** invokes it after cloning (§3), so the *first* `pnpm install`
  resolves with correct pins.
- **The generator** (`scripts/generate.ts`, every install's postinstall) calls
  it directly, replacing its current `writeRootBiomeConfig`. This makes
  `git pull && pnpm install` self-healing: a pin bump in core lands in the
  root files on the next install. If the pins changed, the writer prints a
  clear "version pins changed — run pnpm install again" notice (same
  one-install lag the root biome config already accepts).

Error handling: a missing or malformed `tinycld/core/package-versions.json`
is a **hard error** (mirroring the Go reader) — never a silently-unpinned
workspace.

### 3. Bootstrap shrinks to clone-and-delegate

`assembleWorkspace` reorders to: clone `tinycld` (+ requested features) →
invoke the cloned repo's root-writer (with bootstrap's own `tsx`) → done.
Deleted from bootstrap: `FRAMEWORK_OVERRIDES`, `OVERRIDES_DOC`,
`renderOverridesBlock`, `pnpmWorkspaceYaml`, `writeRootBiomeConfig`,
`watchmanConfig`, and the root-package.json assembly — everything except the
clone map, `copyWorkspaceTemplate`, and the delegation call.

Fallback: if the cloned tinycld has no `scripts/write-workspace-root.ts`
(an old `tinycldRef`), bootstrap fails with a clear message naming the ref
and the minimum compatible one. It does not carry a legacy inline table.

### 4. Go/OTA pipeline: zero semantic change, minimal code change

Today `pkgbuild` copies the root `package-versions.json` forward from the
**active** build root into each new build (scaffold extra) and renders the
overrides block from it. Pins therefore stay frozen at the versions the
running native image shipped with — even when an OTA rebuild upgrades the
tinycld JS member — and only move when a new native image (with a freshly
assembled root) ships. That is deliberate and **preserved**.

Because the root copy remains (derived on dev machines by the root-writer,
baked into images at assembly time, copied forward by `scaffoldExtras` on the
server), `assemble.go`, `recipehash.go`, and the exported `ReadOverrides`
(multi-org cache-hit check) need **no changes**.

One guard is required: the OTA rebuild's `pnpm install` runs the same
postinstall generator, which now calls the root-writer. If a rebuild upgraded
the tinycld member, the writer would re-derive the root pin copy from the
**new** core and unfreeze the pins for subsequent rebuilds. The server's
install invocation therefore sets an env flag (e.g. `TINYCLD_SERVER_REBUILD=1`)
and the root-writer **skips the pin-copy + overrides sync** when it is set
(other root files are harmless to rewrite). A unit test covers the guard.

### 5. Feature packages slim their `peerDependencies`

Rule: a feature's `package.json` drops every vendor entry that appears in
core's pin table **or** core's `peerDependencies`. What remains: libraries
special to that feature (plus the `@tinycld/package-scripts` devDep). E.g.
mail's 15 vendor peers reduce to at most 1–2.

Compatibility with core stays expressed where it already lives: the manifest's
`peerVersions: { '@tinycld/core': '<range>' }`, enforced by the existing
version-compatibility solver. No new mechanism.

Core's own `peerDependencies` ranges stay as-is (they document what the app
shell must provide and serve standalone typecheck); they now live in the same
repo — often the same commit — as the exact pins, so drift is visible in one
place.

### 6. Bootstrap templates

`templates/full/package.json` and `templates/settings-only/package.json` drop
their vendor `peerDependencies` blocks entirely (a scaffolded package starts
with only the `@tinycld/package-scripts` devDep). One final bootstrap release
ships this together with §3.

## Bump workflow after this change

1. Edit `tinycld/core/package-versions.json` (and, if the compatibility range
   moved, core's `peerDependencies`) — one commit in the tinycld repo.
2. Devs: `git pull` in tinycld/, `pnpm install` (twice if pins changed —
   the writer says so).
3. Release: the bump rides the next core version; features' manifest
   `peerVersions` ranges gate compatibility as they already do; the next
   native (EAS) build bakes the new pins for OTA rebuilds.

## Testing

- **Root-writer unit tests** (tinycld repo): overrides block byte-format
  matches the Go `renderOverridesBlock` output for the same input (the
  existing mirror-format contract, now testable in one repo against a
  fixture); hard error on missing/malformed table; server-rebuild env guard
  skips pin sync; human-owned package.json fields preserved.
- **Bootstrap tests**: assemble sequence (clone → delegate), fallback error
  on old `tinycldRef`; existing overrides-rendering tests are deleted with
  the code.
- **Go tests**: unchanged (`assemble_test.go` already covers reading the root
  copy).
- **Ecosystem check**: a fresh `--assemble-only` + `pnpm install` in CI
  produces a workspace whose `pnpm-workspace.yaml` overrides equal core's
  table.

## Migration / rollout order

1. tinycld repo: add `core/package-versions.json`, the root-writer, generator
   integration, and tests. (Self-contained; existing workspaces self-heal on
   next install, since the generator now syncs root files.)
2. Feature repos: slim `peerDependencies` (one small PR each; no behavior
   change since these never drove resolution).
3. Bootstrap: delete the table + writers, add delegation + fallback, slim
   templates; release `@tinycld/bootstrap`. Must ship **after** step 1 is on
   tinycld `main` (the delegation target must exist at default clone HEAD).
4. Go env guard ships with step 1 (core repo); the server-side install
   invocation change rides the same tinycld release.
