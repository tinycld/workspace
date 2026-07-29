# TinyCld Ecosystem

This directory (`~/code/tinycld/`) **is** the pnpm-workspace root. It is assembled per-developer by `@tinycld/bootstrap`, so each root reflects only the members that developer chose, and `pnpm-lock.yaml` is local state. Every member dir is its own independent git repo with its own remote. Third-party packages (e.g. `@acme/custom-pkg`) are first-class — nothing privileges `@tinycld/*`.

## Layout & the repos you edit

```
~/code/tinycld/                  # workspace root (bootstrap-assembled)
    package.json                 # member devDeps + coordination scripts; postinstall runs the generator
    pnpm-workspace.yaml          # authoritative member list (packages:)
    tinycld.packages.ts          # getPackages() — enumerates member dirs with a manifest.ts
    vitest.config.ts             # workspace-wide vitest
    tests/                       # shared test stubs (e.g. expo-clipboard-stub.ts)
    tinycld/                     # tinycld member — Expo/PocketBase app shell (repo root)
    tinycld/core/                # @tinycld/core — shared TS + Go library (nested, no manifest)
    bootstrap/                   # @tinycld/bootstrap — scaffolder CLI (NOT a workspace member)
    contacts/ mail/ calendar/    # feature packages, each its own repo
    drive/ calc/ text/           #   (depend on @tinycld/core, never on each other)
    google-takeout-import/
    utils/                       # deploy tooling and other ecosystem utilities
    web/                         # marketing/docs website (tinycld.org)
```

pnpm silently ignores absent dirs, so a partial assembly (e.g. only `mail` + `contacts`) installs and runs cleanly — the app boots as a lean shell with zero features. **The set of installed features is exactly the set of present member dirs containing a `manifest.ts`.** There is no hand-curated package list.

You edit one of three places:

- **App shell + core** → the one `tinycld` repo (`tinycld/tinycld`). The app shell (repo root) owns the bundler config (`metro.config.cjs`), the canonical `vitest.config.ts` / `playwright.config.ts` / `biome.json` members inherit from, the generator (`scripts/generate.ts` + `gen-*.ts`), and the `app/` route tree. `@tinycld/core` is nested at `tinycld/core/` (own `package.json`, imported as `@tinycld/core`); its Go server at `tinycld/core/server/` is the module `tinycld.org/core`. `@tinycld/package-scripts` (the `tinycld-pkg` CLI) is nested at `tinycld/package-scripts/`.
- **A feature** → that sibling repo (`mail/`, `calendar/`, …). Source lives at `<sibling>/tinycld/<slug>/`.
- **Workspace coordination** (member list, vitest workspace config, shared test stubs) → the workspace-root files.

`@tinycld/bootstrap` (`bootstrap/`) is the published scaffolder — **not** a workspace member (own `node_modules`, `package-lock.json`, published to npm).

## Code Style & Patterns

- Strive for simplicity and clarity. Prefer the maintainable fix over the quick one, even when it's harder.
- **Keep JSX minimal.** No complex ternaries, `.map()`, or calculations inside the return. Move all state, event handling, and data processing into custom hooks (`useFeatureName`) or helpers above the JSX. Extract complex sub-sections into smaller parts.
- **Conditional visibility:** instead of `{condition && <BigComponent />}`, give the component an `isVisible` prop and return `null` when it shouldn't render.
- **Comments explain "why", not "what".** No trivial `// Delete users` before `deleteFrom('user')`. Self-explanatory code needs none.
- **Embrace type inference** — don't over-specify. **Never use `any`** to pass type checks.
- **Never use biome-ignore comments** — fix the underlying issue the lint rule identifies. Biome enforces 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons. Components are PascalCase (`CustomerList.tsx`), hooks camelCase `use`-prefixed, utility modules kebab-case.
- **Light + dark mode:** no raw hex. Use semantic Tailwind tokens (`className="text-foreground bg-background"`) or `useThemeColor('foreground')` for non-className contexts (Lucide icons, RN `Pressable` style props).
- Keep hooks pure and side-effect free; call them at the top level.
- After developing a user-facing feature, add/update its in-app help topic (see **In-app help**) and offer to add it to the website docs.

For the full style guide (forms, UI framework, components), see `tinycld/CONTRIBUTING.md`.

### Avoid `useState` and `useEffect` — there's almost always a better primitive

| Need | Use |
|---|---|
| Form fields | `useForm` + zod (React Hook Form) |
| Server/async data | `useOrgLiveQuery` (or raw `useLiveQuery`) |
| Mutations | `useMutation` from `@tinycld/core/lib/mutations` |
| Derived values | `.select()` on the liveQuery expression |
| Responding to prop/state changes | compute during render — **not** `useEffect` + `setState` |
| DOM refs / imperative handles | `useRef` |
| Shared UI state (sidebar, dialogs, popovers, compose) | Zustand store |

Reach for `useState` only for genuinely local, synchronous UI state (a modal toggle, an accordion) that no other component needs. Pairing `useState` with `useEffect` to sync or transform data is the signal to switch primitives.

### Testing

- Write unit tests for new features. Mock only via helpers in `tests/unit.helpers.tsx`; never mock our own components or actions.
- **No e2e workarounds.** No bumped timeouts, no forced-serial runs, no papering over root causes. Fix flakiness at the source — never blindly re-run.
- **BANNED reasoning when a check or test fails.** Do not ask — or investigate — "is this my fault?", "is it pre-existing?", or "does `main` also fail?". The answer never changes the required action: **diagnose the root cause and fix it at the source.** A red check is never resolved by re-running it, reverting the check, or merging around it. (Whose change caused it is irrelevant — see the global rule: fix errors/warnings regardless of whether your changes caused them.) If a fix is genuinely out of scope, STOP and surface it — do not proceed to green by any other means.
- **Don't `page.goto()` for in-app navigation.** A `goto` tears down the SPA and cancels in-flight fetches (incl. lazy route chunks) → slow Metro recompile + flaky CI. Use the helpers in `tinycld/tests/e2e/helpers.ts`: `login(page)`, then `navigateToPackage(page, '<slug>')`, then `clickSidebarItem` / sidebar buttons. Reserve `page.goto('/')` for the initial load in `login`. Never assume the post-login redirect lands on a specific package — navigate explicitly.

### Running quality checks

Run from inside the member you changed; ecosystem-wide from `tinycld/`. `tinycld-pkg check` runs biome (scoped to that member), then tsc, then vitest.

```sh
# Member-scoped (from inside the member, e.g. cd mail)
pnpm exec tinycld-pkg check       # biome + tsc + vitest, scoped to this member
pnpm exec tinycld-pkg test        # vitest only
pnpm exec tinycld-pkg typecheck   # tsc only
pnpm exec tinycld-pkg test:e2e    # playwright (this package only)
biome check .                     # raw biome, scoped to this member

# Ecosystem-wide (from tinycld/)
pnpm run lint                     # one biome pass over the curated member list
pnpm run lint:fix
pnpm run pkg:check                # typecheck + unit across all members
pnpm run checks                   # biome lint + app typecheck
```

**Biome is 3-tier:** canonical `tinycld/biome.json` (`root: false`, all the rules) ← a gitignored `root: true` config at the workspace root that extends it (so raw `biome check .` and the editor LSP resolve rules from inside any member) ← per-member configs, which a member adds *only* to override a rule (`{ "root": false, "extends": ["../tinycld/biome.json"], <overrides> }`, committed in that member's repo). A member ships no `biome.json` by default. **When you add a generated file, add it to the canonical config's exclude list.** Full mechanics: `tinycld/CONTRIBUTING.md`.

## Data Queries & Mutations

- **ALWAYS use pbtsdb** for PocketBase data — never use PocketBase directly in components.
- **Never bypass pbtsdb — these are the patterns that keep slipping through:**

  | ❌ Never | ✅ Instead |
  |---|---|
  | `page.request.post('/api/collections/…')` or any raw PB REST call to read/write data | drive the UI (which uses `useMutation`); read-only exception below |
  | a new API route / Go endpoint to fetch or mutate data | `useLiveQuery`/`useOrgLiveQuery` (read), `useMutation` (write) |
  | `pb.collection(x).create/update/delete()` in a component, hook, or test | `useMutation` generator from `@tinycld/core/lib/mutations` |
  | N separate `useLiveQuery` calls merged with JS `Map`s/`.filter()` | one query with `.join()` + `.select()` (see below) |

  **These rules apply to tests too — they are not exempt.** E2E sets up and mutates data by driving the UI (forms → `useMutation`), never by raw PB writes or a helper endpoint. Raw `page.request`/PB REST is allowed **only for read-only assertions** (e.g. `invite-flow.spec.ts` checking a mailbox exists) — never to create or edit data.
- Import collections with `useStore(...)` from `pbtsdb` (variadic, returns a tuple):
  ```ts
  const [tagsCollection] = useStore('tags')
  const [jobsCollection, addressesCollection] = useStore('jobs', 'addresses')
  ```
- **Always use `useOrgLiveQuery`** from `@tinycld/core/lib/use-org-live-query` for data queries. **Single-org deployment: the process IS one org** (the multi-org router hosts each org as its own process + DB), so there is no org to scope by — `OrgScope` is `{ userId }`, and it's used to filter "my own rows" (owner/user/author FKs point straight at `users`). The hook disables the query until the user id is known and auto-adds `userId` to deps. Use raw `useLiveQuery` only in low-level hooks `useOrgLiveQuery` itself depends on (e.g. `use-current-role`). A user's role (`owner`/`admin`/`member`/`guest`) lives on `users.role` — read it with `useCurrentRole()`.
  ```ts
  const { data: items } = useOrgLiveQuery((query, { userId }) =>
      query.from({ item: itemsCollection }).where(({ item }) => eq(item.user, userId))
  )
  ```
- Filter with TanStack DB operators (`eq`, `and`, `or`, `gt`, `lt`, …) from `@tanstack/db`. Query syntax follows TanStack DB: `.from()`, `.where()`, `.orderBy()`, `.join()`, `.select()`.
- **Combine related data in ONE query** with `.join()` + `.select()` — don't run separate `useLiveQuery` calls and stitch them with JS `Map`s. Prefer joining the **local collection** over reading a relation via PocketBase `expand`: a join resolves from the optimistic local store immediately, whereas `expand` waits for a realtime round-trip (so an optimistically-created related record reads as missing until PB redelivers it). A join condition must be a single equality (`eq(a.x, b.y)`); push any non-equality predicate (e.g. `role = 'owner'`) into a subquery and join that. `mail/tinycld/mail/hooks/useMailboxes.ts` is the reference example.
- **Prefer inline queries** in the screen component over wrapping in a custom hook — keeps data flow visible. Extract a shared hook only when the same query is needed in 3+ screens.
- **Mutations:** use `useMutation` from `@tinycld/core/lib/mutations` (not from `@tanstack/react-query` directly). Generator mutation fns auto-await pbtsdb `Transaction`s:
  ```ts
  const create = useMutation({
      mutationFn: function* (data) {
          yield contactsCollection.insert({ id: newRecordId(), ...data })
      },
      onSuccess: () => router.back(),
      onError: handleMutationErrorsWithForm({ setError, getValues }),
  })
  ```
  Yield Transactions sequentially for multi-step, or an array for parallel. Use `performMutations` from the same module to await Transactions inside a plain async function.
- Collections live in `tinycld/core/lib/pocketbase.ts` (core) and each feature's `collections.ts` (registered via the manifest's `collections.register`).
- Docs: [Expo Router](https://docs.expo.dev/router/introduction/) · [pbtsdb](https://github.com/nathanstitt/pbtsdb/blob/main/llms.txt) · [TanStack DB](https://tanstack.com/db/latest/docs/overview)

## Zustand Stores (UI state only)

Use Zustand for **shared UI state** — sidebar, dialog targets, compose mode, popovers, visible calendar IDs, active sections. **Not** for server data (`useLiveQuery`), forms (`useForm`), mutations (`useMutation`), or URL state (Expo Router params). Do **not** use React Context for new shared UI state.

```ts
import { create, persist, asyncStorage } from '@tinycld/core/lib/store'
```

- Store files: `tinycld/core/lib/stores/` (shared) or `<sibling>/tinycld/<slug>/stores/` (package-scoped). Existing: core `workspace-store.ts` / `auth-store.ts`; package stores in `mail/`, `drive/`, `calendar/`. (Theme preference is in PocketBase via `useThemePreference()`, not Zustand.)
- Use `persist` + `partialize` when only some fields need AsyncStorage:
  ```ts
  export const useMyStore = create<MyState>()(
      persist(
          (set) => ({ persisted: true, transient: false, toggle: () => set((s) => ({ persisted: !s.persisted })) }),
          { name: 'tinycld_my_store', storage: asyncStorage, partialize: (s) => ({ persisted: s.persisted }) }
      )
  )
  ```
- Use selectors for granular subscriptions: `useMyStore(s => s.field)`.
- Keep **mutations in hooks, not stores** (they need reactive `useLiveQuery` data + TanStack Query's `isPending`/`isError`). Compose store + mutation hook in a slim `useFeature()` when a component needs both.

## Logging

No central `log` helper. **Don't import `@tinycld/core/lib/logger` — it doesn't exist** (older drafts reference it).

- **Errors → `captureException`** from `@tinycld/core/lib/errors`. Signature: `captureException(context: string, error: unknown, extra?)`. `context` is a short stable string Sentry groups on (e.g. `'mail.openDraft.fetchBody'`); `extra` is variable detail. Rethrow when the caller must handle it; swallow only when the surface recovers, with a comment saying why.
  ```ts
  try {
      await pb.collection('example').create(data)
  } catch (err) {
      captureException('example.create', err, { id: data.id })
      throw err
  }
  ```
- **Form validation failures → `handleMutationErrorsWithForm`** (as the mutation's `onError`). Don't `captureException` these — they aren't bugs.
- **Dev-only tracing → `console.*` guarded by `__DEV__`:** `if (__DEV__) console.debug('[mail.compose] draft id', draftId)`. Never ship an unguarded `console.log`.

## Assembling & installing a workspace

```sh
mkdir ~/code/tinycld && cd ~/code/tinycld
npx @tinycld/bootstrap@latest --assemble-only --with mail --with contacts   # writes root + clones members
pnpm install                     # links members + runs the generator (postinstall)
cd tinycld && pnpm run dev       # boots Expo + PocketBase
```

Add a feature later: `npx @tinycld/bootstrap@latest --assemble-only --with <slug>` (skips existing), then `pnpm install`. Remove one: delete its sibling dir, then `pnpm install`.

**Run `pnpm install` only at the workspace root, never in a member** — installing inside a member duplicates `react`/`react-native`/`pbtsdb` in its own `node_modules/` and triggers hundreds of "Type X is not assignable to type X" errors (recover with `rm -rf <member>/node_modules <member>/*-lock.yaml`). Siblings declare framework deps as `peerDependencies` only; pnpm's `nodeLinker: hoisted` flattens the graph into the workspace-root `node_modules/`. Install ordering, the generator→link-members sequence, and `TINYCLD_WS_ROOT`: `tinycld/CONTRIBUTING.md`.

## Paths inside member code

**Use only `~/*` and `@tinycld/core/*` — never `../../tinycld/...`.**

- From inside **`tinycld/core/`**: `~/*` and `@tinycld/core/*` both map to `core/*` (the self-alias is required for standalone typecheck). `@tinycld/app-generated/*` ⇒ `../lib/generated/*`.
- From inside a **feature sibling** (e.g. `mail/tinycld/mail/screens/inbox.tsx`):
  - `~/tinycld/<slug>/*` ⇒ that sibling's own `tinycld/<slug>/` subtree.
  - `@tinycld/core/*`, `@tinycld/app-generated/*`, and cross-sibling deps (`@tinycld/drive/*`) all resolve **by package name** via the `node_modules/@tinycld/*` symlinks + each package's `exports` map under `moduleResolution: bundler`. **No sibling tsconfig needs a `paths` entry for any `@tinycld/*` dep** — only its own `~/tinycld/<slug>/*` self-alias.
  - Vitest additionally gives sibling tests `~/<anything>` ⇒ `<sibling>/<anything>` (wider than tsconfig; tests don't ship to Metro).

## Member anatomy

```
<name>/
    package.json        # canonical name (@tinycld/mail) — pnpm links by it; exports map + peerDependencies
    manifest.ts         # package metadata (default export)
    tsconfig.json       # extends @tinycld/core/tsconfig.package-base.json (by name)
    vitest.config.ts    # mergeConfig(appVitest, { test: { root: __dirname, … } })
    .gitignore          # node_modules/, *-lock files, *.tsbuildinfo, …
    tinycld/<slug>/     # ALL TypeScript source — screens, components, hooks, stores, settings/, sidebar.tsx, …
```

Optional, all declared in the manifest: `pb-migrations/`, `pb-hooks/`, `server/` (Go, own `go.mod`), `help/`, `tests/`, `playwright.config.ts` (only if the member has e2e specs), `docs/`.

**Migrations may be edited in place.** Deployments are provisioned fresh, so there is no in-place upgrade path from an older schema and no backfill migration is required when a shipped migration's rules or fields change. PocketBase never re-runs an applied migration, so this only works *because* every database starts empty — a rewritten migration would silently never apply to an existing DB, leaving its rules evaluating against the old schema. Do not rely on rewriting history to fix a live database.

The nested `tinycld/<slug>/` layout is required so generated route re-exports can reach source by a stable relative path. **In the `exports` map, always use wildcards — Metro can't resolve literal bracket subpaths.** `"./screens/*": "./tinycld/mail/screens/*.tsx"` matches both `screens/index` and `screens/[id]`; `"./screens/[id]": …` does not. All framework deps go in `peerDependencies`.

### Manifest

Default-export a `manifest` object. Only `name`, `slug`, `version`, `description` are required; everything else is optional — a package can contribute purely via `settings`, purely via `publicRoutes`, or any mix. Optional fields: `routes` / `publicRoutes` (`{ directory }`), `nav` (`{ label, icon, order, shortcut? }`), `migrations`, `hooks`, `collections` (`{ register, types }`), `settings` (`[{ slug, component, label }]`), `sidebar`, `provider`, `seed`, `help`, `server` (`{ package, module }`), `dependencies`, `peerVersions`.

**`dependencies` vs `peerVersions`:** `dependencies` is a slug-only advisory + seed-ordering list. **`peerVersions`** declares enforced semver ranges (keyed by slug, e.g. `{ '@tinycld/core': '>=2.1 <3' }`), checked by the version-compatibility solver (Setup → Versions) before Apply and authoritatively on the server. Full field reference: `tinycld/docs/packages.md`.

## Cross-package coupling

**Siblings must not depend on each other.** When a feature needs to know another package is present, read the **runtime registry** — never a hard import:

```ts
import { usePackages } from '@tinycld/core/lib/packages/use-packages'
const installedSlugs = new Set(usePackages().map((p) => p.slug))
const mailAvailable = installedSlugs.has('mail')
```

A hard `@tinycld/mail` import makes the dependency load-bearing at compile time and breaks the lean-shell guarantee (a feature-less workspace must typecheck and run). If you genuinely need another package's types, declare a minimal local interface and tolerate the schema's runtime absence — the takeout-importer's local copy of `@tinycld/mail` collection types is the canonical example.

## In-app help

**A user-facing feature isn't done until users can find out how to use it from inside the app.** Whenever you implement or significantly change one, add/update a help topic.

1. In the package **root** (not under `tinycld/<slug>/`), create `help/<id>.md` (filename = topic ID) with YAML frontmatter — required `title`, `summary`; optional `tags` (`[a, "b c"]`), `order` (lower sorts first). Lead with task-oriented prose ("To do X, …"), not API docs.
2. Declare `help: { directory: 'help' }` in the manifest.
3. Run `cd ~/code/tinycld/tinycld && pnpm run packages:generate`.

The topic then appears in the help hub (`/help`), the per-package help screen, and via `openHelp('<pkg>:<id>')`. Cross-link inside a body with `[label](help://<pkg>:<other-id>)`; link from UI with `<HelpIcon topic="<pkg>:<id>" />`. Core contributes baseline topics from `tinycld/core/help/` — update those when core behavior changes.

**Write keyboard shortcuts with Mac glyphs only: `⌘` `⇧` `⌥`.** The renderer substitutes `Ctrl`/`Shift`/`Alt` per-platform — never hand-author "⌘B (Ctrl+B on Windows)". The translation runs on markdown text tokens only, so glyphs inside inline `` `code` `` stay verbatim (use backticks to show the glyph itself rather than a keystroke).

## Generated output is gitignored — never commit it

The generator (`tinycld/scripts/generate.ts`, run by postinstall and `pnpm run packages:generate`) emits, all gitignored in the `tinycld` repo: `tinycld.config.ts` + `tinycld.seeds.ts`, the `app/(app)/<slug>/**` and `app/p/<path>` route re-exports, `lib/generated/*` (incl. the `@tinycld/app-generated` `package.json`), and `server/package_extensions.go` / `server/go.work` / `server/pb_*` symlinks. The `node_modules/@tinycld/*` symlinks (from `link-members.ts`) are likewise local-only, and `tinycld/core/types/pbSchema.ts` / `pbZodSchema.ts` are regenerated every install from the on-disk PocketBase migrations (the source of truth) — don't edit any of them. Full inventory: `tinycld/CONTRIBUTING.md` and `tinycld/docs/packages.md`.

## Further reading

- **`tinycld/CONTRIBUTING.md`** — main developer docs: full code style, forms/UI framework, assembly + install mechanics, biome 3-tier rationale, generated-output inventory.
- **`tinycld/docs/`** — full package-system reference (generator outputs, type-system integration, every manifest field).
- **`bootstrap/README.md`** — scaffolder CLI reference (templates, flags, env vars).
