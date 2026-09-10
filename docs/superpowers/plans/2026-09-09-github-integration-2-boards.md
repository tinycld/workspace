# GitHub Integration 2 — Boards PR Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link GitHub pull requests to boards cards by card key, and move a card
through its lists via the existing rules engine as those PRs open, get reviewed,
and merge.

**Architecture:** The webhook writes rows; the rules engine does the rest. A
`boards_pr_links` row per (PR, card) pair carries a denormalized `project`, so
the existing `cardOwnerResolver` authorizes it with no new machinery. A
server-owned rollup derives `pr_state` / `pr_review_state` on the card, and four
new triggers watch those columns — read by both the trigger filters and the card
UI, so display and automation cannot disagree. The shipped `move-card` action
needs no changes.

**Tech Stack:** Go (PocketBase hooks + endpoints), JS migrations, TypeScript +
React Native (Expo), Cobra for CLI, vitest + Playwright, `go test`.

**Spec:** `docs/superpowers/specs/2026-09-09-github-integration-design.md`
**Depends on:** plan 1 (`docs/superpowers/plans/2026-09-09-github-integration-1-core.md`) — merged first, or the same branch name.

## Global Constraints

- **Repo:** `~/code/tinycld/boards/` (its own git repo). Two files in `~/code/tinycld/tinycld/` are touched only if plan 1 is not yet merged.
- **Branch:** `feat/github-integration` — the same name plan 1 uses (CLAUDE.md).
- **`pnpm install` only at the workspace root, never inside a member.**
- **Migrations:** new files start at `1980000021`. **A released version's migrations are immutable** — never edit an existing file; append a new one. Unreleased ones may be edited in place.
- **Appending to an activity `kind` enum** follows `pb-migrations/1980000016`'s pattern (`kind.values = [...kind.values, 'x']`), with the down-migration filtering them back out.
- **ALWAYS use pbtsdb** for PocketBase data in components — never PocketBase directly. `useOrgLiveQuery` for reads, `useMutation` from `@tinycld/core/lib/mutations` for writes. **This applies to tests.** E2E sets up data by driving the UI; raw `page.request`/PB REST is read-only-assertions only.
- **Combine related data in ONE query** with `.join()` + `.select()`. Prefer joining the local collection over PocketBase `expand`.
- **Avoid `useState`/`useEffect`** — see the CLAUDE.md primitive table. Zustand for shared UI state, `useForm` + zod for forms.
- **Keep JSX minimal:** no ternaries, `.map()` or calculations in the return. Conditional visibility via an `isVisible` prop returning `null`, not `{cond && <X/>}`.
- **No raw hex colors.** Semantic Tailwind tokens (`text-foreground`) or `useThemeColor('foreground')`.
- **`setupCardsEnv(t)` returns `*cardsEnv` with a LOWERCASE `app` field** (`env.app`).
  It already seeds `env.project`, `env.list`, `env.card`, but deliberately leaves the
  project slugless and the card unnumbered (`rls_setup_test.go:246`), so any suite that
  resolves card KEYS must stamp `slug` and `number` itself or every lookup silently
  returns nothing. `server/github_links_test.go` has a `seedBoardWithCard` helper.
- **Test fixtures that WRITE a link row must use a real URL.** `boards_pr_links.url`
  is a PocketBase `url`-type field; a placeholder like `"u"` fails validation and the
  upsert silently no-ops (logged WARN, not an error), so the test passes while linking
  nothing. Pure decoder tests never reach the field and may use anything.
- **Never `console.*`** in runtime code. Client: `log` from `@tinycld/core/lib/logger`. Server: `logging.ForPackage("boards")`.
- **Never use `any`. Never add `biome-ignore`.** Biome: 4-space indent, single quotes, ES5 trailing commas.
- **Both platforms.** Web and native must both work; a platform-specific feature needs explicit sign-off.
- **Keyboard shortcuts in help use Mac glyphs only** (`⌘` `⇧` `⌥`). Never hand-author a deployment hostname — write `{{server-host}}`.
- **Checks:** `cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check`. Go: `cd ~/code/tinycld/boards/server && go test ./...`.
- **A red check is never resolved by re-running it, bumping a timeout, forcing serial runs, or skipping it.** Diagnose the root cause and fix it at the source. If a fix is genuinely out of scope, STOP and surface it.

---

## File Structure

**Created (boards repo):**

| Path | Responsibility |
|---|---|
| `pb-migrations/1980000021_create_boards_pr_links.js` | `boards_pr_links` + `boards_project_repos`, card `pr_state`/`pr_review_state`, activity kinds. |
| `server/github_webhook.go` | Registers the `webhookin` source; parses the GitHub payload into an intent. |
| `server/github_payload.go` | Pure payload → `prEvent` decoding. No DB access, so it tests without a fixture. |
| `server/github_links.go` | Applies an intent: create/update/tombstone link rows. |
| `server/pr_rollup.go` | Derives `pr_state`/`pr_review_state` onto the card, per-card locked. |
| `server/github_app.go` | Installation-token minting from the stored App credentials. |
| `tinycld/boards/lib/pr-key-scan.ts` | Extracts card keys + skip directives from branch/title/body. |
| `tinycld/boards/components/PrLinkChip.tsx` | The PR badge on a card face / detail. |
| `tinycld/boards/settings/github.tsx` | Board-level repo attachment UI. |
| `cli/github.go` | `boards github` command group. |
| `help/linking-pull-requests.md` | The user-facing help topic. |
| `tests/e2e/pr-links.spec.ts` | E2E over the manual-link path. |

**Modified (boards repo):**

| Path | Change |
|---|---|
| `tinycld/boards/automation.ts` | Four new triggers. |
| `server/automation.go` | Register the owner resolver + four trigger filters. |
| `server/register.go` | Call the new registrars from `registerShared`. |
| `server/oauth_scopes.go` | **Both** new collections — or they are silently default-denied. |
| `server/endpoints_move_card.go:158,342` | Add `boards_pr_links` to **both** child lists. |
| `manifest.ts` | Bump `version`; add the `settings` entry. |
| `tinycld/boards/lib/card-key.ts` | Export a scan-oriented regex if not already present. |

**Why `github_payload.go` is separate from `github_webhook.go`:** decoding is
pure and deserves table tests with no PocketBase app; applying needs a database.
Splitting them means the hard-to-get-right parsing is cheap to test exhaustively.

---

## Task 1: Migration — collections, card columns, activity kinds

**Files:**
- Create: `~/code/tinycld/boards/pb-migrations/1980000021_create_boards_pr_links.js`
- Read for reference: `~/code/tinycld/boards/pb-migrations/1980000020_create_boards_card_reactions.js` (junction + `project` denormalization + anti-desync pin), and `1980000016_create_boards_card_links.js:180-195` (the activity-kind append idiom)

**Interfaces:**
- Produces:
  - `boards_pr_links`: `card` (rel), `project` (rel), `repo`, `number`, `url`, `title`, `author`, `state` (`open|merged|closed`), `review_state` (`""|in_review|approved`), `link_source` (`branch|title|body|manual`), `unlinked` (bool).
  - `boards_project_repos`: `project` (rel), `repo`, `installation_id`.
  - `boards_cards.pr_state` (`""|open|merged|closed`), `boards_cards.pr_review_state` (`""|in_review|approved`).
  - `boards_activity.kind` gains `pr_linked`, `pr_unlinked`, `pr_merged`.

- [ ] **Step 1: Read the two reference migrations**

```bash
sed -n '1,40p' ~/code/tinycld/boards/pb-migrations/1980000020_create_boards_card_reactions.js
sed -n '175,200p' ~/code/tinycld/boards/pb-migrations/1980000016_create_boards_card_links.js
```

Note especially the **anti-desync pin** (`card.project = project` in the create
rule) and that the reactions migration's own header records
`boards_comment_reactions` shipping *without* board-move re-stamping and
"shipped exactly that bug".

- [ ] **Step 2: Confirm the migration number is free**

```bash
ls ~/code/tinycld/boards/pb-migrations/ | sort | tail -4
```

Expected: highest is `1980000020_*` (plus the two `1986*` files, which are a
separate series). If `1980000021_*` exists, use the next free number.

- [ ] **Step 3: Write the migration**

Create the file:

```js
/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_pr_links — one pull request's association with one card.
// boards_project_repos — which repositories a board watches.
//
// THE LINK ROW IS THE TRIGGER SURFACE. Every trigger in this package is a row
// change in a collection; there is no external-event trigger type. So the
// webhook's whole job is to write here, and the rules engine reaches the rest
// through machinery that already exists.
//
// `project` is denormalized so the rules resolve membership in one hop — the
// convention every content row here follows — with `card.project = project` as
// the anti-desync pin on create. THE ROW MUST THEREFORE BE RE-STAMPED WHEN A
// CARD MOVES BOARDS (server/endpoints_move_card.go, BOTH child lists): a row
// left naming the source board is unreadable to everyone on the target.
// boards_comment_reactions shipped without that and was exactly this bug.
//
// TWO STATE COLUMNS, deliberately. `state` is provider-neutral
// (open/merged/closed) and is what the rollup reads; `review_state` carries the
// provider's review vocabulary. Folding them into one enum would mean a later
// GitLab or webhook-driven source either abusing `approved` to mean something
// slightly different, or needing the enum reinterpreted — and while APPENDING
// a value to a released migration is fine, REINTERPRETING one is not.
//
// `unlinked` is a tombstone, not a delete, and it is load-bearing. Branch-name
// linkage is re-derived from immutable branch state on every delivery, so a
// deleted row simply comes back on the next push. Only a tombstone survives
// re-derivation. See server/github_links.go.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        const projects = app.findCollectionByNameOrId('boards_projects')

        // --- boards_project_repos -------------------------------------------
        //
        // Owners attach and detach repositories; every member reads, because
        // the card UI shows PR chips to anyone who can see the card.
        const enabled = '@request.auth.id != "" && @request.auth.disabled != true'
        const viaMember =
            '@collection.boards_project_members.project ?= project && ' +
            '@collection.boards_project_members.user ?= @request.auth.id'
        const viaOwner =
            '@collection.boards_project_members.project ?= project && ' +
            '@collection.boards_project_members.user ?= @request.auth.id && ' +
            '@collection.boards_project_members.role ?= "owner"'

        const repos = new Collection({
            id: 'pbc_boards_project_repos',
            name: 'boards_project_repos',
            type: 'base',
            system: false,
            listRule: `${enabled} && ${viaMember}`,
            viewRule: `${enabled} && ${viaMember}`,
            createRule: `${enabled} && ${viaOwner}`,
            updateRule: `${enabled} && ${viaOwner}`,
            deleteRule: `${enabled} && ${viaOwner}`,
            fields: [
                {
                    id: 'bpr_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: projects.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                { id: 'bpr_repo', name: 'repo', type: 'text', required: true, max: 140 },
                {
                    id: 'bpr_installation',
                    name: 'installation_id',
                    type: 'text',
                    required: false,
                    max: 40,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_boards_project_repos_unique ' +
                    'ON boards_project_repos (project, repo)',
                'CREATE INDEX idx_boards_project_repos_repo ON boards_project_repos (repo)',
            ],
        })
        app.save(repos)

        // --- boards_pr_links ------------------------------------------------
        //
        // SERVER-WRITTEN except for the manual link. The webhook runs as a
        // superuser and bypasses these rules; what they govern is the client
        // path — a member linking a PR by URL, and unlinking one.
        const pinCardProject = 'card.project = project'
        const viaWriter =
            '@collection.boards_project_members.project ?= project && ' +
            '@collection.boards_project_members.user ?= @request.auth.id && ' +
            '(@collection.boards_project_members.role ?= "owner" || ' +
            '@collection.boards_project_members.role ?= "editor")'

        const links = new Collection({
            id: 'pbc_boards_pr_links',
            name: 'boards_pr_links',
            type: 'base',
            system: false,
            listRule: `${enabled} && ${viaMember}`,
            viewRule: `${enabled} && ${viaMember}`,
            createRule: `${enabled} && ${viaWriter} && ${pinCardProject}`,
            updateRule: `${enabled} && ${viaWriter} && ${pinCardProject}`,
            deleteRule: `${enabled} && ${viaWriter}`,
            fields: [
                {
                    id: 'bpl_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: cards.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'bpl_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: projects.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                { id: 'bpl_repo', name: 'repo', type: 'text', required: true, max: 140 },
                { id: 'bpl_number', name: 'number', type: 'number', required: true, min: 1 },
                { id: 'bpl_url', name: 'url', type: 'url', required: false },
                { id: 'bpl_title', name: 'title', type: 'text', required: false, max: 300 },
                { id: 'bpl_author', name: 'author', type: 'text', required: false, max: 100 },
                {
                    id: 'bpl_state',
                    name: 'state',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['open', 'merged', 'closed'],
                },
                {
                    id: 'bpl_review_state',
                    name: 'review_state',
                    type: 'select',
                    required: false,
                    maxSelect: 1,
                    values: ['in_review', 'approved'],
                },
                {
                    id: 'bpl_link_source',
                    name: 'link_source',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['branch', 'title', 'body', 'manual'],
                },
                { id: 'bpl_unlinked', name: 'unlinked', type: 'bool', required: false },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_boards_pr_links_unique ' +
                    'ON boards_pr_links (repo, number, card)',
                'CREATE INDEX idx_boards_pr_links_card ON boards_pr_links (card)',
                'CREATE INDEX idx_boards_pr_links_repo_number ' +
                    'ON boards_pr_links (repo, number)',
            ],
        })
        app.save(links)

        // --- derived columns on the card ------------------------------------
        //
        // SERVER-OWNED, the epic-rollup shape: computed once and read by both
        // the trigger filters and the UI, so display and automation cannot
        // disagree. (Jira's do: its panel computes all-merged correctly while
        // its automation fires on the first merge.)
        cards.fields.add(
            new SelectField({
                id: 'bc_pr_state',
                name: 'pr_state',
                required: false,
                maxSelect: 1,
                values: ['open', 'merged', 'closed'],
            })
        )
        cards.fields.add(
            new SelectField({
                id: 'bc_pr_review_state',
                name: 'pr_review_state',
                required: false,
                maxSelect: 1,
                values: ['in_review', 'approved'],
            })
        )
        app.save(cards)

        // --- activity kinds -------------------------------------------------
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('ba_kind')
        kind.values = [...kind.values, 'pr_linked', 'pr_unlinked', 'pr_merged']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('ba_kind')
        kind.values = kind.values.filter(
            value => value !== 'pr_linked' && value !== 'pr_unlinked' && value !== 'pr_merged'
        )
        app.save(activity)

        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.removeById('bc_pr_state')
        cards.fields.removeById('bc_pr_review_state')
        app.save(cards)

        app.delete(app.findCollectionByNameOrId('boards_pr_links'))
        app.delete(app.findCollectionByNameOrId('boards_project_repos'))
    }
)
```

- [ ] **Step 4: Verify the activity field id is right**

The migration assumes the activity `kind` field's id is `ba_kind`. Confirm:

```bash
grep -n "name: 'kind'" -B3 ~/code/tinycld/boards/pb-migrations/1980000008_create_boards_activity.js
```

If the id differs, correct both the up and down migration to match.

- [ ] **Step 5: Apply and regenerate the schema**

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
```

`core/types/pbSchema.ts` is generated from the on-disk migrations, so it must
now know the new collections. Verify:

```bash
grep -c "boards_pr_links" ~/code/tinycld/tinycld/core/types/pbSchema.ts
```

Expected: at least 1. Never hand-edit that file — it is gitignored.

- [ ] **Step 6: Typecheck**

```bash
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg typecheck
```

Expected: PASS. A failure naming the new columns means the generate step did
not run — re-run it rather than editing generated output.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/boards
git add pb-migrations/1980000021_create_boards_pr_links.js
git commit -m "feat: boards_pr_links and boards_project_repos schema

Two state columns rather than one: `state` is provider-neutral and drives the
rollup, `review_state` carries GitHub's review vocabulary. `unlinked` is a
tombstone because branch-name linkage re-derives on every delivery, so a
deleted row would simply come back."
```

---

## Task 2: Key scanning (TypeScript, then Go)

Card keys already parse in both languages. This adds *scanning* — finding keys
inside free text — plus the skip directives, which are structurally required:
branch-name linkage is re-derived from immutable state, so only a marker in
mutable PR text can durably suppress it.

**Files:**
- Create: `~/code/tinycld/boards/tinycld/boards/lib/pr-key-scan.ts`
- Create: `~/code/tinycld/boards/tests/pr-key-scan.test.ts`
- Read for reference: `~/code/tinycld/boards/tinycld/boards/lib/card-key.ts`

**Interfaces:**
- Consumes: `MAX_SLUG_LENGTH`, `MIN_SLUG_LENGTH` from `./card-key`.
- Produces:
  - `interface ScannedKey { slug: string; number: number }`
  - `function scanCardKeys(text: string): ScannedKey[]`
  - `function scanSkipDirectives(text: string): ScannedKey[]`

- [ ] **Step 1: Read the existing parser**

```bash
cat ~/code/tinycld/boards/tinycld/boards/lib/card-key.ts
```

Reuse its constants and its rules (uppercase the slug; reject leading zeros)
rather than restating them.

- [ ] **Step 2: Write the failing test**

Create `~/code/tinycld/boards/tests/pr-key-scan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { scanCardKeys, scanSkipDirectives } from '../pr-key-scan'

describe('scanCardKeys', () => {
    it('finds a key in a branch name', () => {
        expect(scanCardKeys('nas/OTTER-123-fix-login')).toEqual([
            { slug: 'OTTER', number: 123 },
        ])
    })

    it('finds a bare key', () => {
        expect(scanCardKeys('OTTER-7')).toEqual([{ slug: 'OTTER', number: 7 }])
    })

    it('uppercases a lower-case slug so one typed casually still resolves', () => {
        expect(scanCardKeys('fix/otter-12')).toEqual([{ slug: 'OTTER', number: 12 }])
    })

    it('finds several distinct keys and de-duplicates repeats', () => {
        expect(scanCardKeys('Closes OTTER-1, OTTER-2 and OTTER-1 again')).toEqual([
            { slug: 'OTTER', number: 1 },
            { slug: 'OTTER', number: 2 },
        ])
    })

    it('rejects leading zeros — OTTER-007 is a typo, not a second spelling', () => {
        expect(scanCardKeys('OTTER-007')).toEqual([])
    })

    it('rejects a slug longer than the maximum', () => {
        expect(scanCardKeys('PLATFORMENGINEERING-1')).toEqual([])
    })

    it('rejects a single-character slug', () => {
        expect(scanCardKeys('A-1')).toEqual([])
    })

    it('ignores a key embedded in a longer word', () => {
        expect(scanCardKeys('NOTOTTER-1x')).toEqual([])
    })

    it('returns nothing for text with no key', () => {
        expect(scanCardKeys('just a normal branch name')).toEqual([])
        expect(scanCardKeys('')).toEqual([])
    })
})

describe('scanSkipDirectives', () => {
    it('finds a skip directive', () => {
        expect(scanSkipDirectives('skip OTTER-123')).toEqual([
            { slug: 'OTTER', number: 123 },
        ])
    })

    it('finds an ignore directive', () => {
        expect(scanSkipDirectives('ignore OTTER-5')).toEqual([{ slug: 'OTTER', number: 5 }])
    })

    it('is case-insensitive on the directive word', () => {
        expect(scanSkipDirectives('Skip OTTER-5')).toEqual([{ slug: 'OTTER', number: 5 }])
    })

    it('does not treat a bare key as a skip', () => {
        expect(scanSkipDirectives('OTTER-5')).toEqual([])
    })

    it('does not treat a closing word as a skip', () => {
        expect(scanSkipDirectives('closes OTTER-5')).toEqual([])
    })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards && pnpm exec vitest run tests/pr-key-scan.test.ts
```

Expected: FAIL — cannot resolve `../pr-key-scan`.

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/boards/tinycld/boards/lib/pr-key-scan.ts`:

```ts
/**
 * Scanning free text for card keys — the parsing half of PR linkage.
 *
 * card-key.ts PARSES one candidate string; this SCANS a branch name, PR title
 * or PR body for every key inside it. Kept separate because the two have
 * different failure modes: a parse that rejects is a user typo, while a scan
 * that over-matches silently links the wrong card.
 *
 * server/github_payload.go is the Go twin. There is no captured-vector fixture
 * holding the two in step, so this file's tests and that file's table are the
 * only thing that does — change one, change the other.
 */
import { MAX_SLUG_LENGTH, MIN_SLUG_LENGTH } from './card-key'

export interface ScannedKey {
    slug: string
    number: number
}

/**
 * A key inside surrounding text.
 *
 * The boundaries are the whole point. `(^|[^A-Za-z0-9])` before and
 * `(?![A-Za-z0-9])` after mean OTTER-1 matches in `nas/OTTER-1-fix` and in
 * `Closes OTTER-1.` but NOT inside `NOTOTTER-1` or `OTTER-1x` — an
 * over-matching scan links the wrong card, which is worse than missing one.
 *
 * `[1-9][0-9]*` rejects leading zeros for card-key.ts's reason: OTTER-007 is a
 * typo, and accepting it would give one card two spellings.
 */
const KEY_IN_TEXT = new RegExp(
    `(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{${MIN_SLUG_LENGTH - 1},${MAX_SLUG_LENGTH - 1}})-([1-9][0-9]*)(?![A-Za-z0-9])`,
    'g'
)

/** `skip OTTER-1` / `ignore OTTER-1` — the durable opt-out. */
const SKIP_IN_TEXT = new RegExp(
    `\\b(?:skip|ignore)\\s+([A-Za-z][A-Za-z0-9]{${MIN_SLUG_LENGTH - 1},${MAX_SLUG_LENGTH - 1}})-([1-9][0-9]*)(?![A-Za-z0-9])`,
    'gi'
)

function collect(text: string, pattern: RegExp): ScannedKey[] {
    if (!text) return []
    const seen = new Set<string>()
    const found: ScannedKey[] = []
    // A fresh RegExp per call: a module-level /g pattern carries lastIndex
    // between calls, so sharing one makes results depend on call order.
    const scanner = new RegExp(pattern.source, pattern.flags)
    let match = scanner.exec(text)
    while (match !== null) {
        const slug = match[1].toUpperCase()
        const number = Number.parseInt(match[2], 10)
        const dedupeKey = `${slug}-${number}`
        if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey)
            found.push({ slug, number })
        }
        match = scanner.exec(text)
    }
    return found
}

/** Every distinct card key mentioned in `text`, in first-seen order. */
export function scanCardKeys(text: string): ScannedKey[] {
    return collect(text, KEY_IN_TEXT)
}

/**
 * Keys the PR author explicitly opted out of linking.
 *
 * Required rather than a nicety. Branch-name linkage is re-derived from
 * immutable branch state on every delivery, so deleting a link row only makes
 * it reappear on the next push. A directive in the MUTABLE PR body is the only
 * thing that survives re-derivation.
 */
export function scanSkipDirectives(text: string): ScannedKey[] {
    return collect(text, SKIP_IN_TEXT)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/boards && pnpm exec vitest run tests/pr-key-scan.test.ts
```

Expected: PASS, all tests. If the slug-length cases fail, print
`KEY_IN_TEXT.source` and check the `{n,m}` bounds against `MIN_SLUG_LENGTH` /
`MAX_SLUG_LENGTH` — the pattern subtracts 1 because the first character is
matched separately.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/boards
git add tinycld/boards/lib/pr-key-scan.ts tests/pr-key-scan.test.ts
git commit -m "feat: scan branch names and PR text for card keys

Boundaries matter more than matches here: an over-matching scan links the
wrong card. Skip directives are structural, not convenience — branch-name
linkage re-derives on every delivery, so only a marker in mutable PR text
durably suppresses it."
```

---

## Task 3: Payload decoding (Go)

**Files:**
- Create: `~/code/tinycld/boards/server/github_payload.go`
- Test: `~/code/tinycld/boards/server/github_payload_test.go`
- Read for reference: `~/code/tinycld/boards/cli/key.go` (the key grammar's Go half)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure decoding).
- Produces:
  - `type prEvent struct { Action, Repo, Branch, Title, Body, Author, URL string; Number int; Merged bool; State string; ReviewState string }`
  - `type scannedKey struct { Slug string; Number int }`
  - `func decodePREvent(event string, body []byte) (prEvent, bool, error)` — bool false when the event is one we ignore.
  - `func scanCardKeys(text string) []scannedKey`
  - `func scanSkipDirectives(text string) []scannedKey`

- [ ] **Step 1: Write the failing test**

Create `~/code/tinycld/boards/server/github_payload_test.go`:

```go
package boards

import "testing"

func TestScanCardKeys_MirrorsTheTSTable(t *testing.T) {
	// This table MUST stay in step with
	// tests/pr-key-scan.test.ts — there is no captured
	// fixture holding the two implementations together.
	for _, tc := range []struct {
		name string
		text string
		want []scannedKey
	}{
		{"branch name", "nas/OTTER-123-fix-login", []scannedKey{{"OTTER", 123}}},
		{"bare key", "OTTER-7", []scannedKey{{"OTTER", 7}}},
		{"lower case", "fix/otter-12", []scannedKey{{"OTTER", 12}}},
		{
			"several, de-duplicated",
			"Closes OTTER-1, OTTER-2 and OTTER-1 again",
			[]scannedKey{{"OTTER", 1}, {"OTTER", 2}},
		},
		{"leading zeros rejected", "OTTER-007", nil},
		{"slug too long", "PLATFORMENGINEERING-1", nil},
		{"slug too short", "A-1", nil},
		{"embedded in a word", "NOTOTTER-1x", nil},
		{"no key", "just a normal branch name", nil},
		{"empty", "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := scanCardKeys(tc.text)
			if len(got) != len(tc.want) {
				t.Fatalf("scanCardKeys(%q) = %v, want %v", tc.text, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("key %d = %v, want %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestScanSkipDirectives(t *testing.T) {
	for _, tc := range []struct {
		name string
		text string
		want []scannedKey
	}{
		{"skip", "skip OTTER-123", []scannedKey{{"OTTER", 123}}},
		{"ignore", "ignore OTTER-5", []scannedKey{{"OTTER", 5}}},
		{"case-insensitive", "Skip OTTER-5", []scannedKey{{"OTTER", 5}}},
		{"a bare key is not a skip", "OTTER-5", nil},
		{"a closing word is not a skip", "closes OTTER-5", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := scanSkipDirectives(tc.text)
			if len(got) != len(tc.want) {
				t.Fatalf("scanSkipDirectives(%q) = %v, want %v", tc.text, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("key %d = %v, want %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestDecodePREvent_OpenedPR(t *testing.T) {
	body := []byte(`{
		"action": "opened",
		"pull_request": {
			"number": 42,
			"title": "OTTER-1 fix the redirect",
			"body": "does the thing",
			"html_url": "https://github.com/o/r/pull/42",
			"state": "open",
			"merged": false,
			"draft": false,
			"head": { "ref": "nas/OTTER-1-fix" },
			"user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, ok, err := decodePREvent("pull_request", body)
	if err != nil {
		t.Fatalf("decodePREvent: %v", err)
	}
	if !ok {
		t.Fatal("an opened PR was ignored")
	}
	if ev.Number != 42 || ev.Repo != "o/r" || ev.Branch != "nas/OTTER-1-fix" {
		t.Errorf("event = %+v", ev)
	}
	if ev.State != "open" {
		t.Errorf("State = %q, want open", ev.State)
	}
}

func TestDecodePREvent_MergedPR(t *testing.T) {
	body := []byte(`{
		"action": "closed",
		"pull_request": {
			"number": 7, "title": "t", "body": "", "html_url": "u",
			"state": "closed", "merged": true, "draft": false,
			"head": { "ref": "OTTER-2" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, ok, err := decodePREvent("pull_request", body)
	if err != nil || !ok {
		t.Fatalf("decodePREvent: ok=%v err=%v", ok, err)
	}
	// A closed PR that merged is `merged`, not `closed` — the distinction the
	// whole feature turns on.
	if ev.State != "merged" {
		t.Errorf("State = %q, want merged", ev.State)
	}
}

func TestDecodePREvent_ClosedUnmerged(t *testing.T) {
	body := []byte(`{
		"action": "closed",
		"pull_request": {
			"number": 8, "title": "t", "body": "", "html_url": "u",
			"state": "closed", "merged": false, "draft": false,
			"head": { "ref": "OTTER-3" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, _, err := decodePREvent("pull_request", body)
	if err != nil {
		t.Fatalf("decodePREvent: %v", err)
	}
	if ev.State != "closed" {
		t.Errorf("State = %q, want closed", ev.State)
	}
}

func TestDecodePREvent_ReviewApproved(t *testing.T) {
	body := []byte(`{
		"action": "submitted",
		"review": { "state": "approved" },
		"pull_request": {
			"number": 9, "title": "t", "body": "", "html_url": "u",
			"state": "open", "merged": false, "draft": false,
			"head": { "ref": "OTTER-4" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, ok, err := decodePREvent("pull_request_review", body)
	if err != nil || !ok {
		t.Fatalf("decodePREvent: ok=%v err=%v", ok, err)
	}
	if ev.ReviewState != "approved" {
		t.Errorf("ReviewState = %q, want approved", ev.ReviewState)
	}
}

func TestDecodePREvent_IgnoresUninterestingEvents(t *testing.T) {
	for _, tc := range []struct{ event, body string }{
		{"push", `{}`},
		{"issues", `{"action":"opened"}`},
		{"pull_request", `{"action":"labeled","pull_request":{"number":1},"repository":{"full_name":"o/r"}}`},
	} {
		_, ok, err := decodePREvent(tc.event, []byte(tc.body))
		if err != nil {
			t.Errorf("decodePREvent(%s) errored: %v", tc.event, err)
		}
		if ok {
			t.Errorf("decodePREvent(%s) = ok, want ignored", tc.event)
		}
	}
}

func TestDecodePREvent_RejectsMalformedJSON(t *testing.T) {
	if _, _, err := decodePREvent("pull_request", []byte(`{not json`)); err == nil {
		t.Error("expected an error for malformed JSON")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run 'TestScanCardKeys|TestDecodePREvent|TestScanSkip' -v
```

Expected: FAIL — `undefined: scanCardKeys`, `undefined: decodePREvent`.

- [ ] **Step 3: Write the implementation**

Create `~/code/tinycld/boards/server/github_payload.go`:

```go
package boards

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Decoding a GitHub webhook payload into something this package can act on.
//
// PURE: no database, no app, no network — which is why it is split from
// github_webhook.go. Payload shapes are the part most likely to be subtly
// wrong, and here they are cheap to table-test exhaustively.
//
// The scan functions are the Go twin of tinycld/boards/lib/pr-key-scan.ts.
// There is no captured-vector fixture holding them in step (unlike rank.go),
// so this file's test table and that file's tests are the only thing that
// does. Change one, change the other.

const (
	minSlugLength = 2
	maxSlugLen    = 10
)

type scannedKey struct {
	Slug   string
	Number int
}

// prEvent is one PR-shaped GitHub event, flattened.
//
// State is provider-NEUTRAL (open/merged/closed), matching the column it
// lands in: GitHub reports a merge as action=closed with merged=true, and
// collapsing that here means nothing downstream has to remember it.
type prEvent struct {
	Action      string
	Repo        string
	Branch      string
	Title       string
	Body        string
	Author      string
	URL         string
	Number      int
	State       string
	ReviewState string
}

var keyInText = regexp.MustCompile(
	fmt.Sprintf(`(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{%d,%d})-([1-9][0-9]*)([^A-Za-z0-9]|$)`,
		minSlugLength-1, maxSlugLen-1),
)

var skipInText = regexp.MustCompile(
	fmt.Sprintf(`(?i)\b(?:skip|ignore)\s+([A-Za-z][A-Za-z0-9]{%d,%d})-([1-9][0-9]*)([^A-Za-z0-9]|$)`,
		minSlugLength-1, maxSlugLen-1),
)

// scanCardKeys returns every distinct key in text, in first-seen order.
//
// Go's RE2 has no lookahead, so the trailing boundary is a consuming group
// rather than `(?!...)`. That makes adjacent matches ("OTTER-1 OTTER-2") a
// hazard: the separator consumed by the first match is not available to the
// second. FindAllStringSubmatchIndex with a manual walk avoids it by
// restarting the scan at the end of the KEY rather than the end of the match.
func scanCardKeys(text string) []scannedKey {
	return collectKeys(text, keyInText)
}

// scanSkipDirectives returns keys the PR author opted out of.
//
// Required, not convenience: branch-name linkage re-derives from immutable
// branch state on every delivery, so a deleted link row reappears on the next
// push. Only this directive, living in the mutable PR body, survives.
func scanSkipDirectives(text string) []scannedKey {
	return collectKeys(text, skipInText)
}

func collectKeys(text string, pattern *regexp.Regexp) []scannedKey {
	if text == "" {
		return nil
	}
	var found []scannedKey
	seen := map[string]bool{}
	for offset := 0; offset < len(text); {
		loc := pattern.FindStringSubmatchIndex(text[offset:])
		if loc == nil {
			break
		}
		slug := strings.ToUpper(text[offset+loc[2] : offset+loc[3]])
		number, err := strconv.Atoi(text[offset+loc[4] : offset+loc[5]])
		if err == nil && len(slug) <= maxSlugLen {
			dedupe := fmt.Sprintf("%s-%d", slug, number)
			if !seen[dedupe] {
				seen[dedupe] = true
				found = append(found, scannedKey{Slug: slug, Number: number})
			}
		}
		// Restart after the NUMBER, not after the whole match, so a consumed
		// trailing separator cannot hide an immediately following key.
		offset += loc[5]
	}
	return found
}

// githubPRPayload is the subset of GitHub's payload this package reads.
type githubPRPayload struct {
	Action string `json:"action"`
	Review struct {
		State string `json:"state"`
	} `json:"review"`
	PullRequest struct {
		Number  int    `json:"number"`
		Title   string `json:"title"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		State   string `json:"state"`
		Merged  bool   `json:"merged"`
		Draft   bool   `json:"draft"`
		Head    struct {
			Ref string `json:"ref"`
		} `json:"head"`
		User struct {
			Login string `json:"login"`
		} `json:"user"`
	} `json:"pull_request"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
}

// prActions are the pull_request actions worth acting on. `labeled`,
// `assigned` and friends change nothing this package tracks, and processing
// them would rewrite rows (and re-fire triggers) for no reason.
var prActions = map[string]bool{
	"opened":            true,
	"reopened":          true,
	"closed":            true,
	"edited":            true,
	"synchronize":       true,
	"ready_for_review":  true,
	"converted_to_draft": true,
	"review_requested":  true,
}

// decodePREvent flattens a payload. ok=false means "a legitimate event we do
// not act on" — distinct from an error, so the receiver can 200 it rather
// than inviting a retry.
func decodePREvent(event string, body []byte) (prEvent, bool, error) {
	if event != "pull_request" && event != "pull_request_review" {
		return prEvent{}, false, nil
	}

	var payload githubPRPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return prEvent{}, false, fmt.Errorf("decoding the payload: %w", err)
	}
	if payload.Repository.FullName == "" || payload.PullRequest.Number == 0 {
		return prEvent{}, false, nil
	}
	if event == "pull_request" && !prActions[payload.Action] {
		return prEvent{}, false, nil
	}
	if event == "pull_request_review" && payload.Action != "submitted" {
		return prEvent{}, false, nil
	}

	ev := prEvent{
		Action: payload.Action,
		Repo:   payload.Repository.FullName,
		Branch: payload.PullRequest.Head.Ref,
		Title:  payload.PullRequest.Title,
		Body:   payload.PullRequest.Body,
		Author: payload.PullRequest.User.Login,
		URL:    payload.PullRequest.HTMLURL,
		Number: payload.PullRequest.Number,
	}

	// GitHub reports a merge as closed+merged. Collapse it here so nothing
	// downstream has to remember the distinction.
	switch {
	case payload.PullRequest.Merged:
		ev.State = "merged"
	case payload.PullRequest.State == "closed":
		ev.State = "closed"
	default:
		ev.State = "open"
	}

	if event == "pull_request_review" {
		switch strings.ToLower(payload.Review.State) {
		case "approved":
			ev.ReviewState = "approved"
		case "changes_requested", "commented":
			ev.ReviewState = "in_review"
		}
	}
	if payload.Action == "review_requested" {
		ev.ReviewState = "in_review"
	}

	return ev, true, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run 'TestScanCardKeys|TestDecodePREvent|TestScanSkip' -v
```

Expected: PASS, every subtest. The adjacent-keys case
("Closes OTTER-1, OTTER-2 and OTTER-1 again") is the one most likely to fail —
if it returns only one key, the `offset += loc[5]` restart is wrong; it must
resume after the number, not after the full match.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/boards
git add server/github_payload.go server/github_payload_test.go
git commit -m "feat: decode GitHub PR payloads

Pure and app-free so payload shapes are cheap to table-test. GitHub reports a
merge as closed+merged; that collapses to a neutral 'merged' here so nothing
downstream carries the distinction. RE2 has no lookahead, so the key scanner
walks matches manually to keep adjacent keys visible."
```

---

## Task 4: The PR rollup

The read-modify-write shape that `epic_rollup.go`'s header records as a
production bug when unlocked: parallel writes both summed before either row was
visible, and the second Save clobbered the first. Two webhook deliveries for one
card arrive concurrently, so the per-card lock is here from the first commit.

**Files:**
- Create: `~/code/tinycld/boards/server/pr_rollup.go`
- Test: `~/code/tinycld/boards/server/pr_rollup_test.go`
- Read for reference: `~/code/tinycld/boards/server/epic_rollup.go` (the whole file — lock, registrar and recount shape)

**Interfaces:**
- Consumes: `boards_pr_links`, `boards_cards.pr_state`/`pr_review_state` (Task 1).
- Produces:
  - `func registerPRRollup(app core.App)`
  - `func recountCardPRs(app core.App, cardID string)`
  - `func derivePRStateFromStates(states []string, reviews []string) (state string, reviewState string)` — pure and string-based so the all-merged semantic is table-testable without a database

- [ ] **Step 1: Read the reference implementation**

```bash
cat ~/code/tinycld/boards/server/epic_rollup.go
```

Mirror: `sync.Map` of per-key mutexes, the registrar binding
`OnRecordAfter{Create,Update,Delete}Success`, the unchanged-value early exit,
and never failing the triggering write.

- [ ] **Step 2: Write the failing test for the pure derivation**

Create `~/code/tinycld/boards/server/pr_rollup_test.go`:

```go
package boards

import "testing"

func TestDerivePRState_AllMergedIsTheEvent(t *testing.T) {
	for _, tc := range []struct {
		name            string
		states          []string
		wantState       string
	}{
		{"no links", nil, ""},
		{"one open", []string{"open"}, "open"},
		{"one merged", []string{"merged"}, "merged"},
		{"one of two merged stays open", []string{"merged", "open"}, "open"},
		{"both merged", []string{"merged", "merged"}, "merged"},
		{"three, one open", []string{"merged", "merged", "open"}, "open"},
		{"all closed unmerged", []string{"closed"}, "closed"},
		{"merged beats closed when both present", []string{"merged", "closed"}, "merged"},
		{"an open link outranks everything", []string{"closed", "merged", "open"}, "open"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := derivePRStateFromStates(tc.states, nil)
			if got != tc.wantState {
				t.Errorf("state = %q, want %q", got, tc.wantState)
			}
		})
	}
}

func TestDerivePRState_ReviewStateTakesTheStrongest(t *testing.T) {
	for _, tc := range []struct {
		name    string
		reviews []string
		want    string
	}{
		{"none", nil, ""},
		{"in review", []string{"in_review"}, "in_review"},
		{"approved", []string{"approved"}, "approved"},
		{"approved outranks in_review", []string{"in_review", "approved"}, "approved"},
		{"blank entries ignored", []string{"", "in_review"}, "in_review"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, got := derivePRStateFromStates(nil, tc.reviews)
			if got != tc.want {
				t.Errorf("reviewState = %q, want %q", got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestDerivePRState -v
```

Expected: FAIL — `undefined: derivePRStateFromStates`.

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/boards/server/pr_rollup.go`:

```go
package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// The PR rollup: pr_state / pr_review_state on boards_cards.
//
// epic_rollup.go's shape, and it inherits that file's hard-won lesson. The
// recount is a read-modify-write (find links, derive, save card) exactly as
// counters.go's was, and counters.go shipped WITHOUT a lock: parallel writes
// both derived before either row was visible, and the second Save clobbered
// the first. Nothing about PRs is safer — GitHub delivers `synchronize` and
// `review_requested` for one PR within milliseconds of each other, and one
// card can carry links to several repos — so the lock is here from the first
// commit rather than after the bug.
//
// ALL-MERGED IS THE SEMANTIC. A card moves when its LAST open PR merges, not
// its first. This is Linear's rule and the reason the derived column exists at
// all: computing it once server-side means the card face and the automation
// triggers read the same value, so they cannot disagree the way Jira's panel
// and its automation do.

// prRecountLocks serializes recountCardPRs per card. Per CARD rather than one
// global lock: different cards touch disjoint rows and should still recount
// concurrently. epic_rollup.go's epicRecountLocks, same reasoning.
var prRecountLocks sync.Map // cardID → *sync.Mutex

// registerPRRollup keeps the two derived columns current.
//
// Bound to boards_pr_links rather than boards_cards: the card's own saves do
// not change its link set, and binding there would recount on every card edit.
// A DELETE has no Original(), so the row itself carries the card to recount.
func registerPRRollup(app core.App) {
	app.OnRecordAfterCreateSuccess("boards_pr_links").BindFunc(func(e *core.RecordEvent) error {
		recountCardPRs(e.App, e.Record.GetString("card"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("boards_pr_links").BindFunc(func(e *core.RecordEvent) error {
		// Both cards: a link cannot be re-pointed by any client rule, but a
		// superuser path could, and the old id survives only on Original().
		// When unchanged these are the same id and the second call exits at
		// the unchanged check.
		recountCardPRs(e.App, e.Record.Original().GetString("card"))
		recountCardPRs(e.App, e.Record.GetString("card"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("boards_pr_links").BindFunc(func(e *core.RecordEvent) error {
		recountCardPRs(e.App, e.Record.GetString("card"))
		return e.Next()
	})
}

// recountCardPRs re-derives one card's PR columns from its live links.
//
// NEVER fails the triggering write: a card whose rollup cannot be computed is
// logged and left, counters.go's posture. The alternative — failing a webhook
// because a derived display column could not be updated — would make GitHub
// retry an event that already landed.
func recountCardPRs(app core.App, cardID string) {
	if cardID == "" {
		return
	}

	lockAny, _ := prRecountLocks.LoadOrStore(cardID, &sync.Mutex{})
	lock := lockAny.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	links, err := app.FindRecordsByFilter(
		"boards_pr_links",
		"card = {:card} && unlinked != true",
		"", 0, 0,
		map[string]any{"card": cardID},
	)
	if err != nil {
		activityLog.Warn("pr rollup link lookup failed", "card", cardID, "error", err)
		return
	}

	states := make([]string, 0, len(links))
	reviews := make([]string, 0, len(links))
	for _, link := range links {
		states = append(states, link.GetString("state"))
		reviews = append(reviews, link.GetString("review_state"))
	}
	state, reviewState := derivePRStateFromStates(states, reviews)

	card, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		// A deleted card is the ordinary case on cascade; not a fault.
		return
	}
	if card.GetString("pr_state") == state && card.GetString("pr_review_state") == reviewState {
		return
	}
	card.Set("pr_state", state)
	card.Set("pr_review_state", reviewState)
	if err := app.Save(card); err != nil {
		activityLog.Warn("pr rollup save failed", "card", cardID, "error", err)
	}
}

// derivePRStateFromStates collapses a card's link states into the two derived
// values.
//
// Precedence for `state`: any open link means open (work is still in flight);
// otherwise a merge outranks a bare close, so a card with one merged and one
// abandoned PR reads merged. Jira's display layer documents the same
// precedence — this implements it once, where both readers see it.
func derivePRStateFromStates(states []string, reviews []string) (string, string) {
	state := ""
	sawMerged := false
	sawClosed := false
	for _, s := range states {
		switch s {
		case "open":
			state = "open"
		case "merged":
			sawMerged = true
		case "closed":
			sawClosed = true
		}
	}
	if state != "open" {
		switch {
		case sawMerged:
			state = "merged"
		case sawClosed:
			state = "closed"
		}
	}

	reviewState := ""
	for _, r := range reviews {
		if r == "approved" {
			reviewState = "approved"
			break
		}
		if r == "in_review" {
			reviewState = "in_review"
		}
	}
	return state, reviewState
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestDerivePRState -v
```

Expected: PASS, every subtest.

- [ ] **Step 6: Confirm the logger name**

The file uses `activityLog`, which `activity.go` defines. Verify it exists and
is the right logger for this package:

```bash
grep -rn "activityLog = \|activityLog =" ~/code/tinycld/boards/server/*.go | head -2
```

If it is scoped differently, use the package's own `logging.ForPackage("boards")`
logger as the neighbouring rollups do.

- [ ] **Step 7: Register the rollup**

In `~/code/tinycld/boards/server/register.go`, inside `registerShared`, add
after the `registerEpicRollup(app)` line:

```go
	// The PR rollup, the epic shape again: it derives pr_state from the card's
	// link rows so the card face and the automation triggers read ONE value.
	// All-merged is the semantic — a card moves when its LAST open PR merges.
	registerPRRollup(app)
```

- [ ] **Step 8: Build and run the package's Go tests**

```bash
cd ~/code/tinycld/boards/server && go build ./... && go test ./
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/code/tinycld/boards
git add server/pr_rollup.go server/pr_rollup_test.go server/register.go
git commit -m "feat: derive pr_state on the card from its PR links

All-merged is the semantic: a card moves when its LAST open PR merges. The
per-card lock is here from the first commit rather than after the bug —
counters.go shipped without one and lost writes when parallel saves each
derived before the other was visible, which two concurrent deliveries for one
PR reproduce exactly."
```

---

## Task 5: Link application and tombstones

**Files:**
- Create: `~/code/tinycld/boards/server/github_links.go`
- Test: `~/code/tinycld/boards/server/github_links_test.go`

**Interfaces:**
- Consumes: `prEvent`, `scannedKey`, `scanCardKeys`, `scanSkipDirectives` (Task 3); `boards_pr_links`, `boards_project_repos` (Task 1).
- Produces:
  - `func applyPREvent(app core.App, ev prEvent) error`
  - `func resolveCardsForEvent(app core.App, ev prEvent) ([]cardLinkTarget, error)`
  - `type cardLinkTarget struct { CardID, ProjectID, Source string }`

- [ ] **Step 1: Write the failing test**

Create `~/code/tinycld/boards/server/github_links_test.go`. This one needs the
package's rule-test environment; check how a neighbouring test bootstraps it:

```bash
sed -n '1,30p' ~/code/tinycld/boards/server/card_links_test.go
```

Then write, adapting the setup helper name to whatever that file uses:

```go
package boards

import "testing"

func TestApplyPREvent_LinksByBranchName(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 1)
	attachRepo(t, env, board, "o/r")

	err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 42, Branch: "nas/OTTER-1-fix",
		Title: "unrelated", Body: "", State: "open",
		URL: "https://github.com/o/r/pull/42",
	})
	if err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}

	links := findLinks(t, env, card)
	if len(links) != 1 {
		t.Fatalf("got %d links, want 1", len(links))
	}
	if links[0].GetString("link_source") != "branch" {
		t.Errorf("link_source = %q, want branch", links[0].GetString("link_source"))
	}
	if links[0].GetString("project") == "" {
		t.Error("link row did not carry its project — the owner resolver needs it")
	}
}

func TestApplyPREvent_LinksByTitleAndBody(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 2)
	attachRepo(t, env, board, "o/r")

	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 43, Branch: "no-key-here",
		Title: "OTTER-2 fix it", State: "open",
	}); err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}
	links := findLinks(t, env, card)
	if len(links) != 1 || links[0].GetString("link_source") != "title" {
		t.Fatalf("expected one title-sourced link, got %d", len(links))
	}
}

func TestApplyPREvent_SkipDirectiveSuppressesTheLink(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 3)
	attachRepo(t, env, board, "o/r")

	// The branch names the card, but the body opts out. The body must win —
	// this is the ONLY durable override, because branch-name linkage
	// re-derives on every delivery.
	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 44, Branch: "OTTER-3-fix",
		Body: "skip OTTER-3", State: "open",
	}); err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}
	if links := findLinks(t, env, card); len(links) != 0 {
		t.Errorf("got %d links, want 0 — the skip directive was ignored", len(links))
	}
}

func TestApplyPREvent_TombstoneSurvivesRederivation(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 4)
	attachRepo(t, env, board, "o/r")

	ev := prEvent{Repo: "o/r", Number: 45, Branch: "OTTER-4-fix", State: "open"}
	if err := applyPREvent(env.app, ev); err != nil {
		t.Fatalf("first apply: %v", err)
	}

	// The user unlinks: tombstone rather than delete.
	links := findLinks(t, env, card)
	links[0].Set("unlinked", true)
	if err := env.app.Save(links[0]); err != nil {
		t.Fatalf("tombstoning: %v", err)
	}

	// A later push re-delivers the same branch. The link must NOT come back.
	if err := applyPREvent(env.app, ev); err != nil {
		t.Fatalf("second apply: %v", err)
	}
	for _, link := range findLinks(t, env, card) {
		if !link.GetBool("unlinked") {
			t.Error("a tombstoned link was resurrected by re-derivation")
		}
	}
}

func TestApplyPREvent_UpdatesStateOnMerge(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 5)
	attachRepo(t, env, board, "o/r")

	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 46, Branch: "OTTER-5-fix", State: "open",
	}); err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 46, Branch: "OTTER-5-fix", State: "merged",
	}); err != nil {
		t.Fatalf("merge: %v", err)
	}

	links := findLinks(t, env, card)
	if len(links) != 1 {
		t.Fatalf("got %d links, want 1 — the merge created a second row", len(links))
	}
	if links[0].GetString("state") != "merged" {
		t.Errorf("state = %q, want merged", links[0].GetString("state"))
	}
}

func TestApplyPREvent_IgnoresAnUnattachedRepo(t *testing.T) {
	env := setupCardsEnv(t)
	_, card := seedBoardWithCard(t, env, "OTTER", 6)
	// Deliberately NO attachRepo: a repo no board watches must link nothing,
	// even though the key resolves. Otherwise any repo could write links into
	// any board that happens to share a slug.

	if err := applyPREvent(env.app, prEvent{
		Repo: "someone/else", Number: 47, Branch: "OTTER-6-fix", State: "open",
	}); err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}
	if links := findLinks(t, env, card); len(links) != 0 {
		t.Errorf("got %d links from an unattached repo, want 0", len(links))
	}
}
```

- [ ] **Step 2: Write the three test helpers**

Append to `github_links_test.go`, adapting to the env type the existing tests
use:

```go
// seedBoardWithCard creates a board with the given slug and one card with the
// given number, returning both ids.
func seedBoardWithCard(t *testing.T, env *cardsEnv, slug string, number int) (string, string) {
	t.Helper()
	// Follow the seeding idiom in the neighbouring *_test.go files; the board
	// needs `slug` set, and the card needs `number` and `project`.
	t.Fatal("implement using this package's existing test seeding helpers")
	return "", ""
}

func attachRepo(t *testing.T, env *cardsEnv, projectID, repo string) {
	t.Helper()
	collection, err := env.app.FindCollectionByNameOrId("boards_project_repos")
	if err != nil {
		t.Fatalf("boards_project_repos: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("project", projectID)
	record.Set("repo", repo)
	if err := env.app.Save(record); err != nil {
		t.Fatalf("attaching %s: %v", repo, err)
	}
}

func findLinks(t *testing.T, env *cardsEnv, cardID string) []*core.Record {
	t.Helper()
	links, err := env.app.FindRecordsByFilter(
		"boards_pr_links", "card = {:card}", "", 0, 0,
		map[string]any{"card": cardID},
	)
	if err != nil {
		t.Fatalf("finding links: %v", err)
	}
	return links
}
```

**Before running:** replace `seedBoardWithCard`'s `t.Fatal` with real seeding.
Read how an existing test builds a board and card:

```bash
grep -n "func setupCardsEnv\|boards_projects\|slug" ~/code/tinycld/boards/server/card_links_test.go | head -20
```

Match the env type name (`*cardsEnv` here is a guess) to what
`setupCardsEnv` actually returns.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestApplyPREvent -v
```

Expected: FAIL — `undefined: applyPREvent`.

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/boards/server/github_links.go`:

```go
package boards

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Applying a decoded GitHub event to this deployment's link rows.
//
// THE REPO GATE IS AUTHORIZATION, not a filter. A key resolves against every
// board sharing that slug, so without checking boards_project_repos any
// repository could write links into any board — including one its sender
// cannot read. Only a board that ATTACHED the repo accepts its events.
//
// Re-derivation is idempotent by design: the same delivery replayed produces
// the same rows. What it must NOT do is resurrect a link a person removed,
// which is what `unlinked` is for — see the tombstone note in
// pb-migrations/1980000021.

type cardLinkTarget struct {
	CardID    string
	ProjectID string
	Source    string
}

// applyPREvent creates, updates or leaves link rows for one event.
//
// Never partially applies a single card's row: each is one Save. A failure on
// one card is logged and the rest proceed, because a webhook that 500s over
// one unreachable card would have GitHub retry the whole delivery.
func applyPREvent(app core.App, ev prEvent) error {
	targets, err := resolveCardsForEvent(app, ev)
	if err != nil {
		return err
	}
	for _, target := range targets {
		if err := upsertPRLink(app, ev, target); err != nil {
			activityLog.Warn("pr link upsert failed",
				"card", target.CardID, "repo", ev.Repo, "pr", ev.Number, "error", err)
		}
	}
	return nil
}

// resolveCardsForEvent finds the cards this PR names, restricted to boards
// that attached the repo, minus anything the author opted out of.
func resolveCardsForEvent(app core.App, ev prEvent) ([]cardLinkTarget, error) {
	repos, err := app.FindRecordsByFilter(
		"boards_project_repos", "repo = {:repo}", "", 0, 0,
		map[string]any{"repo": ev.Repo},
	)
	if err != nil {
		return nil, fmt.Errorf("repo lookup for %s: %w", ev.Repo, err)
	}
	if len(repos) == 0 {
		return nil, nil
	}
	projectIDs := make([]string, 0, len(repos))
	for _, r := range repos {
		projectIDs = append(projectIDs, r.GetString("project"))
	}

	skipped := map[string]bool{}
	for _, key := range scanSkipDirectives(ev.Body) {
		skipped[keyString(key)] = true
	}

	// Precedence: branch, then title, then body. Only the FIRST source that
	// names a card is recorded, so `link_source` says how the association was
	// actually made — which the unlink path needs to know.
	seen := map[string]bool{}
	var targets []cardLinkTarget
	for _, candidate := range []struct {
		source string
		text   string
	}{
		{"branch", ev.Branch},
		{"title", ev.Title},
		{"body", ev.Body},
	} {
		for _, key := range scanCardKeys(candidate.text) {
			if skipped[keyString(key)] {
				continue
			}
			card, projectID, err := findCardByKey(app, projectIDs, key)
			if err != nil || card == "" {
				continue
			}
			if seen[card] {
				continue
			}
			seen[card] = true
			targets = append(targets, cardLinkTarget{
				CardID:    card,
				ProjectID: projectID,
				Source:    candidate.source,
			})
		}
	}
	return targets, nil
}

func keyString(k scannedKey) string {
	return fmt.Sprintf("%s-%d", k.Slug, k.Number)
}

// findCardByKey resolves OTTER-123 to a card on one of the given boards.
func findCardByKey(app core.App, projectIDs []string, key scannedKey) (string, string, error) {
	for _, projectID := range projectIDs {
		project, err := app.FindRecordById("boards_projects", projectID)
		if err != nil {
			continue
		}
		if !strings.EqualFold(project.GetString("slug"), key.Slug) {
			continue
		}
		cards, err := app.FindRecordsByFilter(
			"boards_cards", "project = {:project} && number = {:number}", "", 1, 0,
			map[string]any{"project": projectID, "number": key.Number},
		)
		if err != nil || len(cards) == 0 {
			continue
		}
		return cards[0].Id, projectID, nil
	}
	return "", "", nil
}

// upsertPRLink writes one card's link row, leaving a tombstoned row alone.
func upsertPRLink(app core.App, ev prEvent, target cardLinkTarget) error {
	existing, err := app.FindRecordsByFilter(
		"boards_pr_links",
		"repo = {:repo} && number = {:number} && card = {:card}",
		"", 1, 0,
		map[string]any{"repo": ev.Repo, "number": ev.Number, "card": target.CardID},
	)
	if err != nil {
		return fmt.Errorf("existing link lookup: %w", err)
	}

	var record *core.Record
	if len(existing) == 1 {
		record = existing[0]
		// A person removed this association. Re-derivation must not undo
		// that, so update nothing at all.
		if record.GetBool("unlinked") {
			return nil
		}
	} else {
		collection, err := app.FindCollectionByNameOrId("boards_pr_links")
		if err != nil {
			return fmt.Errorf("boards_pr_links collection: %w", err)
		}
		record = core.NewRecord(collection)
		record.Set("card", target.CardID)
		record.Set("repo", ev.Repo)
		record.Set("number", ev.Number)
		record.Set("link_source", target.Source)
	}

	// `project` is re-stamped on every write, not only on create: a card that
	// moved boards carries a stale project until something refreshes it, and
	// a row naming the source board is unreadable to the target's members.
	record.Set("project", target.ProjectID)
	record.Set("state", ev.State)
	record.Set("url", ev.URL)
	record.Set("title", ev.Title)
	record.Set("author", ev.Author)
	// Review state is only ever carried by a review event; a plain
	// pull_request delivery must not blank it.
	if ev.ReviewState != "" {
		record.Set("review_state", ev.ReviewState)
	}
	// A merge or close ends review entirely.
	if ev.State != "open" {
		record.Set("review_state", "")
	}

	return app.Save(record)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestApplyPREvent -v
```

Expected: PASS, all six tests.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/boards
git add server/github_links.go server/github_links_test.go
git commit -m "feat: apply GitHub PR events to link rows

The repo gate is authorization: a key resolves against every board sharing
that slug, so without checking boards_project_repos any repository could
write links into a board its sender cannot read. Tombstoned links are left
untouched so re-derivation cannot resurrect an association a person removed."
```

---

## Task 6: The webhook source registration

**Files:**
- Create: `~/code/tinycld/boards/server/github_webhook.go`
- Test: `~/code/tinycld/boards/server/github_webhook_test.go`
- Modify: `~/code/tinycld/boards/server/register.go`

**Interfaces:**
- Consumes: `webhookin.Register`, `webhookin.Source`, `webhookin.Delivery` (plan 1 Task 5); `decodePREvent` (Task 3); `applyPREvent` (Task 5).
- Produces: `func registerGitHubWebhook()`.

- [ ] **Step 1: Confirm plan 1 is available**

```bash
ls ~/code/tinycld/tinycld/core/server/webhookin/webhookin.go
```

If missing, plan 1 is not merged or not linked — stop and resolve that first
rather than stubbing the import.

- [ ] **Step 2: Write the failing test**

Create `~/code/tinycld/boards/server/github_webhook_test.go`:

```go
package boards

import (
	"testing"

	"tinycld.org/core/webhookin"
)

func TestGitHubWebhookSource_IgnoresUninterestingEvents(t *testing.T) {
	env := setupCardsEnv(t)

	// A push delivery decodes to "nothing to do" and must succeed rather than
	// error: erroring would make the receiver 500, and GitHub would retry an
	// event we will keep ignoring.
	err := handleGitHubDelivery(env.app, webhookin.Delivery{
		Source: "github",
		Event:  "push",
		Body:   []byte(`{"ref":"refs/heads/main"}`),
	})
	if err != nil {
		t.Errorf("an ignored event returned an error: %v", err)
	}
}

func TestGitHubWebhookSource_RejectsMalformedPayload(t *testing.T) {
	env := setupCardsEnv(t)

	err := handleGitHubDelivery(env.app, webhookin.Delivery{
		Source: "github",
		Event:  "pull_request",
		Body:   []byte(`{not json`),
	})
	if err == nil {
		t.Error("malformed JSON was accepted")
	}
}

func TestGitHubWebhookSource_AppliesAPullRequestEvent(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 10)
	attachRepo(t, env, board, "o/r")

	body := []byte(`{
		"action": "opened",
		"pull_request": {
			"number": 60, "title": "t", "body": "", "html_url": "https://github.com/o/r/pull/60",
			"state": "open", "merged": false, "draft": false,
			"head": { "ref": "OTTER-10-fix" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	if err := handleGitHubDelivery(env.app, webhookin.Delivery{
		Source: "github", Event: "pull_request", Body: body,
	}); err != nil {
		t.Fatalf("handleGitHubDelivery: %v", err)
	}

	if links := findLinks(t, env, card); len(links) != 1 {
		t.Fatalf("got %d links, want 1", len(links))
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestGitHubWebhookSource -v
```

Expected: FAIL — `undefined: handleGitHubDelivery`.

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/boards/server/github_webhook.go`:

```go
package boards

import (
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/webhookin"
)

// The GitHub webhook source.
//
// Core provides the TRANSPORT — signature verification, replay dedupe, rate
// limiting — and knows nothing about GitHub or boards. This file supplies the
// MEANING, which is the half that cannot be generic: "this branch names
// OTTER-123, and all its sibling PRs have now merged" is irreducibly specific
// to one provider and one schema.
//
// Registered from registerShared, the oauth.RegisterPackage inversion: core
// learns the source exists at runtime rather than naming this package.

const githubWebhookSecretKey = "boards.github.webhook_secret"

// registerGitHubWebhook installs the source at POST /api/webhooks/github.
func registerGitHubWebhook() {
	webhookin.Register("github", webhookin.Source{
		Secret:          githubWebhookSecret,
		SignatureHeader: "X-Hub-Signature-256",
		EventHeader:     "X-GitHub-Event",
		DeliveryID: func(r *http.Request) string {
			return r.Header.Get("X-GitHub-Delivery")
		},
		Handle: handleGitHubDelivery,
	})
}

// githubWebhookSecret reads the deployment's configured signing secret.
//
// Read per request rather than cached at boot because it is rotatable from the
// admin console, and a cached value would keep verifying against the old one.
// A missing secret returns an error, which the receiver treats as "fail
// closed" — unconfigured is never permission.
func githubWebhookSecret(app core.App, _ *http.Request) (string, error) {
	settings, err := app.FindRecordsByFilter(
		"system_settings", "key = {:key}", "", 1, 0,
		map[string]any{"key": githubWebhookSecretKey},
	)
	if err != nil {
		return "", fmt.Errorf("reading the github webhook secret: %w", err)
	}
	if len(settings) == 0 {
		return "", fmt.Errorf("no github webhook secret is configured")
	}
	return settings[0].GetString("value"), nil
}

// handleGitHubDelivery interprets one verified delivery.
//
// An event we do not act on returns nil, NOT an error: the receiver turns an
// error into a 500, and GitHub would then retry an event we will go on
// ignoring forever. Only a genuinely malformed payload errors.
func handleGitHubDelivery(app core.App, d webhookin.Delivery) error {
	ev, ok, err := decodePREvent(d.Event, d.Body)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	return applyPREvent(app, ev)
}
```

- [ ] **Step 5: Verify the `system_settings` value field name**

The secret reader assumes a `value` column. Confirm:

```bash
grep -n "name: 'value'" ~/code/tinycld/tinycld/core/server/pb_migrations/1910000010_create_system_settings.js
```

If the column is named differently, correct `githubWebhookSecret`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestGitHubWebhookSource -v
```

Expected: PASS, all three tests.

- [ ] **Step 7: Register from `registerShared`**

In `~/code/tinycld/boards/server/register.go`, inside `registerShared`, add
after `registerAutomation()`:

```go
	// The GitHub webhook source. Core owns the transport (signature, replay,
	// rate limit) and names no package; this supplies the interpretation.
	registerGitHubWebhook()
```

- [ ] **Step 8: Build and test**

```bash
cd ~/code/tinycld/boards/server && go build ./... && go test ./
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/code/tinycld/boards
git add server/github_webhook.go server/github_webhook_test.go server/register.go
git commit -m "feat: register the GitHub webhook source

An ignored event returns nil rather than an error: the receiver turns errors
into 500s, and GitHub would retry an event we will keep ignoring. The secret
is read per request because it is rotatable from the admin console."
```

---

## Task 7: The four triggers

**Files:**
- Modify: `~/code/tinycld/boards/tinycld/boards/automation.ts`
- Modify: `~/code/tinycld/boards/server/automation.go`
- Test: `~/code/tinycld/boards/server/automation_test.go` (extend)

**Interfaces:**
- Consumes: `boards_cards.pr_state`/`pr_review_state` (Task 1); `cardOwnerResolver`, `RegisterTriggerFilter` (existing).
- Produces: trigger refs `boards:pr-opened`, `boards:pr-merged`, `boards:pr-review-requested`, `boards:pr-approved`; filters `cardPREntered*`.

- [ ] **Step 1: Read the existing trigger + filter pattern**

```bash
sed -n '270,300p' ~/code/tinycld/boards/tinycld/boards/automation.ts
sed -n '/^func sprintEntered/,/^}/p' ~/code/tinycld/boards/server/automation.go
```

- [ ] **Step 2: Write the failing filter test**

Append to `~/code/tinycld/boards/server/automation_test.go`:

```go
func TestCardPRStateFilters_FireOnlyOnTheTransition(t *testing.T) {
	env := setupCardsEnv(t)
	_, card := seedBoardWithCard(t, env, "OTTER", 20)

	record, err := env.app.FindRecordById("boards_cards", card)
	if err != nil {
		t.Fatalf("loading the card: %v", err)
	}

	// none → open fires pr-opened.
	record.Set("pr_state", "open")
	if !cardPROpened(env.app, record) {
		t.Error("pr-opened did not fire on none → open")
	}
	if cardPRMerged(env.app, record) {
		t.Error("pr-merged fired on none → open")
	}

	// Persist so Original() reads `open` on the next change.
	if err := env.app.Save(record); err != nil {
		t.Fatalf("saving: %v", err)
	}
	record, _ = env.app.FindRecordById("boards_cards", card)

	// A same-state re-save must fire nothing.
	record.Set("pr_state", "open")
	if cardPROpened(env.app, record) {
		t.Error("pr-opened fired on a same-state re-save")
	}

	// open → merged fires pr-merged only.
	record.Set("pr_state", "merged")
	if !cardPRMerged(env.app, record) {
		t.Error("pr-merged did not fire on open → merged")
	}
	if cardPROpened(env.app, record) {
		t.Error("pr-opened fired on open → merged")
	}
}

func TestCardPRReviewFilters(t *testing.T) {
	env := setupCardsEnv(t)
	_, card := seedBoardWithCard(t, env, "OTTER", 21)
	record, _ := env.app.FindRecordById("boards_cards", card)

	record.Set("pr_review_state", "in_review")
	if !cardPRReviewRequested(env.app, record) {
		t.Error("pr-review-requested did not fire on → in_review")
	}
	if cardPRApproved(env.app, record) {
		t.Error("pr-approved fired on → in_review")
	}

	if err := env.app.Save(record); err != nil {
		t.Fatalf("saving: %v", err)
	}
	record, _ = env.app.FindRecordById("boards_cards", card)

	record.Set("pr_review_state", "approved")
	if !cardPRApproved(env.app, record) {
		t.Error("pr-approved did not fire on in_review → approved")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run 'TestCardPRStateFilters|TestCardPRReviewFilters' -v
```

Expected: FAIL — `undefined: cardPROpened`.

- [ ] **Step 4: Add the filters in Go**

Append to `~/code/tinycld/boards/server/automation.go`:

```go
// The PR triggers, sprintEntered's shape one collection over.
//
// pr_state moves in BOTH directions — a reopened PR goes merged → open — so
// every filter checks Original(): "the column now reads X and did not before
// this save". Without that, a same-state re-save fires the trigger again, and
// a card edited for any other reason re-fires whichever state it is sitting in.
//
// ALL-MERGED lives in the rollup, not here. By the time pr_state reads
// `merged`, pr_rollup.go has already established that no link remains open, so
// this filter is a plain transition check and the semantic is stated in exactly
// one place.

func cardPREntered(record *core.Record, column, state string) bool {
	if record == nil || record.GetString(column) != state {
		return false
	}
	original := record.Original()
	if original == nil {
		return false
	}
	return original.GetString(column) != state
}

func cardPROpened(_ core.App, record *core.Record) bool {
	return cardPREntered(record, "pr_state", "open")
}

func cardPRMerged(_ core.App, record *core.Record) bool {
	return cardPREntered(record, "pr_state", "merged")
}

func cardPRReviewRequested(_ core.App, record *core.Record) bool {
	return cardPREntered(record, "pr_review_state", "in_review")
}

func cardPRApproved(_ core.App, record *core.Record) bool {
	return cardPREntered(record, "pr_review_state", "approved")
}
```

- [ ] **Step 5: Register the resolvers and filters**

In `registerAutomation` in the same file, add the four refs to the
`cardOwnerResolver` loop's string slice:

```go
		"boards:pr-opened",
		"boards:pr-merged",
		"boards:pr-review-requested",
		"boards:pr-approved",
```

Then after the existing `RegisterTriggerFilter` calls:

```go
	automation.RegisterTriggerFilter("boards:pr-opened", cardPROpened)
	automation.RegisterTriggerFilter("boards:pr-merged", cardPRMerged)
	automation.RegisterTriggerFilter("boards:pr-review-requested", cardPRReviewRequested)
	automation.RegisterTriggerFilter("boards:pr-approved", cardPRApproved)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run 'TestCardPRStateFilters|TestCardPRReviewFilters' -v
```

Expected: PASS.

- [ ] **Step 7: Declare the triggers in the catalog**

In `~/code/tinycld/boards/tinycld/boards/automation.ts`, add these four entries
to the END of the `triggers` array (after `comment-reacted`):

```ts
        {
            // The PR triggers all watch a DERIVED column that pr_rollup.go
            // owns, not the link rows themselves. Two reasons: a card with
            // three linked PRs would otherwise fire three times for one
            // logical event, and all-merged semantics cannot be expressed by
            // watching a single row at all — the rollup is where "no link
            // remains open" is decided.
            id: 'pr-opened',
            label: 'A linked pull request opens',
            collection: 'boards_cards',
            on: 'update',
            watch: ['pr_state'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
                'priority',
                'estimate',
            ],
        },
        {
            // Fires when the LAST open PR merges, which is the whole point of
            // the derived column: a card spanning core and a package is not
            // done when only one of its PRs lands.
            id: 'pr-merged',
            label: 'All linked pull requests merge',
            collection: 'boards_cards',
            on: 'update',
            watch: ['pr_state'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
                'priority',
                'estimate',
            ],
        },
        {
            id: 'pr-review-requested',
            label: 'A linked pull request is up for review',
            collection: 'boards_cards',
            on: 'update',
            watch: ['pr_review_state'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            id: 'pr-approved',
            label: 'A linked pull request is approved',
            collection: 'boards_cards',
            on: 'update',
            watch: ['pr_review_state'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
```

- [ ] **Step 8: Regenerate and run the full check**

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check
```

Expected: PASS. If a test asserts the exact trigger list (as core's
`core-defs.test.ts` does), update it to include the four new ids — do not
weaken the assertion.

- [ ] **Step 9: Commit**

```bash
cd ~/code/tinycld/boards
git add tinycld/boards/automation.ts server/automation.go server/automation_test.go
git commit -m "feat: four PR triggers for the rules engine

All four watch a derived column rather than the link rows: a card with three
linked PRs would otherwise fire three times for one logical event, and
all-merged cannot be expressed by watching a single row. move-card needs no
changes."
```

---

## Task 8: OAuth scopes and board-move re-stamping

Two obligations the codebase records as having been shipped wrong before. Doing
them in their own task means a reviewer can check them in isolation.

**Files:**
- Modify: `~/code/tinycld/boards/server/oauth_scopes.go`
- Modify: `~/code/tinycld/boards/server/endpoints_move_card.go:158,342`
- Test: `~/code/tinycld/boards/server/oauth_scopes_test.go` (extend)

**Interfaces:**
- Consumes: the two collections from Task 1.
- Produces: no new symbols; corrects two existing surfaces.

- [ ] **Step 1: Read what that file's header says about this exact bug**

```bash
sed -n '10,25p' ~/code/tinycld/boards/server/oauth_scopes.go
sed -n '60,82p' ~/code/tinycld/boards/server/oauth_scopes.go
```

`boards_epics` shipped with no entry and was default-denied for the life of the
feature. The sharing surface is read-only for tokens on the reasoning that
`boards:write` reads as "change my cards", not "give other people my boards".

- [ ] **Step 2: Write the failing scope test**

Append to `~/code/tinycld/boards/server/oauth_scopes_test.go`:

```go
func TestOAuthPackage_CoversThePRCollections(t *testing.T) {
	pkg := oauthPackage()

	// boards_pr_links is board CONTENT: a token that may edit cards may link
	// a PR to one.
	links, ok := pkg.Collections["boards_pr_links"]
	if !ok {
		t.Fatal("boards_pr_links has no scope entry — it is default-denied for every OAuth caller")
	}
	if len(links.Write) == 0 {
		t.Error("boards_pr_links is read-only; linking a PR is a card edit")
	}

	// boards_project_repos is the CONNECTION surface: it names a repository
	// this deployment holds a credential for, so a token must not reshape it.
	repos, ok := pkg.Collections["boards_project_repos"]
	if !ok {
		t.Fatal("boards_project_repos has no scope entry — it is default-denied")
	}
	if len(repos.Write) != 0 {
		t.Error("boards_project_repos must be read-only for OAuth callers")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestOAuthPackage_CoversThePR -v
```

Expected: FAIL — no entry for either collection.

- [ ] **Step 4: Add the scope entries**

In `oauthPackage()`'s `Collections` map, add to the junctions block:

```go
			// PR links are board content: a caller who may edit a card may
			// associate a pull request with it.
			"boards_pr_links": rw,
```

And alongside the read-only sharing surface:

```go
			// READ-ONLY, and for the reason directly above rather than a
			// weaker one. A row here names a repository this deployment holds
			// a GitHub credential for; writing one points that credential at
			// new source code. "boards:write" reads on a consent screen as
			// "change my cards", not "connect my repositories" — so start
			// closed. Relaxing this later is one line; the reverse would
			// silently revoke a capability integrations had built on.
			"boards_project_repos": ro,
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestOAuthPackage -v
```

Expected: PASS, including the file's existing surface-pinning tests.

- [ ] **Step 6: Add `boards_pr_links` to BOTH child lists in the move endpoint**

```bash
sed -n '155,162p' ~/code/tinycld/boards/server/endpoints_move_card.go
sed -n '336,346p' ~/code/tinycld/boards/server/endpoints_move_card.go
```

Add `"boards_pr_links"` to the string slice in **both** places. The comment at
line ~340 records that `boards_comment_reactions` "was once left out and
shipped exactly that bug" — a row left naming the source board is unreadable
to everyone on the target.

- [ ] **Step 7: Write the move re-stamp test**

Append to `~/code/tinycld/boards/server/endpoints_move_card_test.go`:

```go
func TestMoveCard_RestampsPRLinkProject(t *testing.T) {
	env := setupCardsEnv(t)
	source, card := seedBoardWithCard(t, env, "OTTER", 30)
	target, _ := seedBoardWithCard(t, env, "BADGER", 1)
	attachRepo(t, env, source, "o/r")

	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 70, Branch: "OTTER-30-fix", State: "open",
	}); err != nil {
		t.Fatalf("linking: %v", err)
	}

	moveCardToBoard(t, env, card, target)

	// A link row still naming the source board is invisible to the target's
	// members — the bug boards_comment_reactions shipped.
	for _, link := range findLinks(t, env, card) {
		if link.GetString("project") != target {
			t.Errorf("link project = %q, want the target board %q",
				link.GetString("project"), target)
		}
	}
}
```

Use whatever helper the existing tests in that file use to perform a move;
find it with:

```bash
grep -n "func.*move\|moveCard" ~/code/tinycld/boards/server/endpoints_move_card_test.go | head -5
```

- [ ] **Step 8: Run the move tests**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestMoveCard -v
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/code/tinycld/boards
git add server/oauth_scopes.go server/oauth_scopes_test.go server/endpoints_move_card.go server/endpoints_move_card_test.go
git commit -m "fix: scope and re-stamp the new PR collections

Both obligations this codebase has shipped wrong before: a collection with no
oauth_scopes entry is silently default-denied for every token caller, and a
denormalized project left unstamped on a board move is unreadable to the
target's members. boards_project_repos is read-only for tokens — a row there
points a GitHub credential at new source code."
```

---

## Task 9: Rule-level access tests

**Files:**
- Create: `~/code/tinycld/boards/server/pr_links_rls_test.go`
- Modify: `~/code/tinycld/boards/server/shipped_rules_test.go`

- [ ] **Step 1: Read the RLS test idiom and the shipped-rules table**

```bash
sed -n '1,40p' ~/code/tinycld/boards/server/card_links_rls_test.go
sed -n '20,40p' ~/code/tinycld/boards/server/shipped_rules_test.go
```

The shipped-rules table exists because drive lost a guest-exclusion clause when
a migration restated a rule; its `why` column is load-bearing.

- [ ] **Step 2: Write the RLS tests**

Create `~/code/tinycld/boards/server/pr_links_rls_test.go`, following
`card_links_rls_test.go`'s structure exactly (it binds no hooks and measures
the rule engine alone). Cover, one test each:

1. A **non-member** cannot list, view, create, update or delete a
   `boards_pr_links` row.
2. A **viewer** may list and view but not create, update or delete.
3. An **editor** may create, update and delete.
4. A **commentor** may not create (the write surface is owner|editor, matching
   `boards_cards`' own `updateRule`).
5. The **anti-desync pin** refuses a create whose `project` does not match
   `card.project`.
6. A **non-member** cannot create a `boards_project_repos` row; a **viewer**
   may read but not write; only an **owner** may write.

Use the same helper names and assertion style as the reference file — do not
invent a parallel harness.

- [ ] **Step 3: Run the RLS tests**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run 'TestPRLinks.*RLS|TestProjectRepos.*RLS' -v
```

Expected: PASS. A failure here means the migration's rules are wrong — fix the
migration, not the test.

- [ ] **Step 4: Add both collections to the shipped-rules table**

In `shipped_rules_test.go`, add `"boards_pr_links"` and
`"boards_project_repos"` to `allCardsCollections`, then add rows to the
clause table for each rule kind, with a `why` explaining what each clause
protects (the column is read by someone who did not write the rule).

- [ ] **Step 5: Run the shipped-rules test**

```bash
cd ~/code/tinycld/boards/server && go test ./ -run TestCardsShippedRules -v
```

Expected: PASS. If it reports a missing clause, the migration is wrong.

- [ ] **Step 6: Run the whole Go suite**

```bash
cd ~/code/tinycld/boards/server && go test ./...
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/boards
git add server/pr_links_rls_test.go server/shipped_rules_test.go
git commit -m "test: rule-level access proofs for the PR collections"
```

---

## Task 10: The card UI

**Files:**
- Create: `~/code/tinycld/boards/tinycld/boards/components/PrLinkChip.tsx`
- Create: `~/code/tinycld/boards/tinycld/boards/hooks/usePrLinks.ts`
- Create: `~/code/tinycld/boards/tests/PrLinkChip.test.tsx`
- Modify: the card detail screen (located in Step 1)

**Interfaces:**
- Consumes: `boards_pr_links` (Task 1).
- Produces:
  - `usePrLinks(cardId: string)` → `{ links, isLoading }`
  - `<PrLinkChip link={...} />`, `<PrLinkList cardId={...} isVisible={...} />`

- [ ] **Step 1: Find the card detail screen and an existing chip to copy**

```bash
ls ~/code/tinycld/boards/tinycld/boards/components/ | head -40
grep -rln "epic" ~/code/tinycld/boards/tinycld/boards/components/*.tsx | head -3
```

Read whichever component renders the epic chip on the card — it is the closest
existing analogue (a relation rendered as a labelled pill).

- [ ] **Step 2: Write the failing component test**

Create `~/code/tinycld/boards/tests/PrLinkChip.test.tsx`,
following the render idiom in `tests/unit.helpers.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '~/tests/unit.helpers'
import { PrLinkChip } from '../PrLinkChip'

const baseLink = {
    id: 'l1',
    repo: 'tinycld/boards',
    number: 42,
    url: 'https://github.com/tinycld/boards/pull/42',
    title: 'Fix the redirect',
    state: 'open' as const,
    review_state: '' as const,
}

describe('PrLinkChip', () => {
    it('shows the repo and PR number', () => {
        renderWithProviders(<PrLinkChip link={baseLink} />)
        expect(screen.getByText('boards #42')).toBeTruthy()
    })

    it('labels a merged PR', () => {
        renderWithProviders(<PrLinkChip link={{ ...baseLink, state: 'merged' }} />)
        expect(screen.getByLabelText(/merged/i)).toBeTruthy()
    })

    it('labels an approved PR distinctly from a merged one', () => {
        renderWithProviders(
            <PrLinkChip link={{ ...baseLink, review_state: 'approved' }} />
        )
        expect(screen.getByLabelText(/approved/i)).toBeTruthy()
    })
})
```

Check the actual helper export names first:

```bash
grep -n "export" ~/code/tinycld/boards/tests/unit.helpers.tsx | head -10
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/boards && pnpm exec vitest run tests/PrLinkChip.test.tsx
```

Expected: FAIL — cannot resolve `../PrLinkChip`.

- [ ] **Step 4: Write the query hook**

Create `~/code/tinycld/boards/tinycld/boards/hooks/usePrLinks.ts`:

```ts
import { eq, and } from '@tanstack/db'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useStore } from 'pbtsdb'

/**
 * One card's live PR links.
 *
 * A hook rather than an inline query because three surfaces need it — the card
 * face, the card detail and the unlink action — which is the 3+ threshold
 * CLAUDE.md sets for extracting one.
 *
 * Tombstoned rows are filtered here rather than deleted in the database: a
 * link derived from a branch name comes back on the next delivery, so removal
 * has to be a flag. See pb-migrations/1980000021.
 */
export function usePrLinks(cardId: string) {
    const [prLinksCollection] = useStore('boards_pr_links')

    return useOrgLiveQuery(
        query =>
            query
                .from({ link: prLinksCollection })
                .where(({ link }) => and(eq(link.card, cardId), eq(link.unlinked, false)))
                .orderBy(({ link }) => link.number),
        [cardId]
    )
}
```

- [ ] **Step 5: Write the component**

Create `~/code/tinycld/boards/tinycld/boards/components/PrLinkChip.tsx`. Follow
the epic chip's structure found in Step 1. Requirements:

- **No raw hex.** Use semantic tokens (`text-foreground`, `bg-muted`) or
  `useThemeColor('foreground')` for the Lucide icon color.
- **Keep JSX minimal:** derive the icon, label and accessibility label in a
  helper ABOVE the return, not in ternaries inside it.
- **Conditional visibility** via an `isVisible` prop returning `null`, never
  `{cond && <X/>}`.
- State → presentation mapping: `open` → git-pull-request icon; `merged` →
  git-merge icon; `closed` → git-pull-request-closed icon; `review_state`
  `approved` → a check badge; `in_review` → an eye badge.
- Every state needs an `accessibilityLabel` naming it in words, since the
  distinction is otherwise carried only by icon shape.
- Works on web AND native — no DOM-only APIs.

- [ ] **Step 6: Run the component test**

```bash
cd ~/code/tinycld/boards && pnpm exec vitest run tests/PrLinkChip.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Mount the list on the card detail screen**

Add `<PrLinkList cardId={card.id} isVisible={links.length > 0} />` to the card
detail screen found in Step 1, in the section area alongside the existing
checklist / links blocks.

- [ ] **Step 8: Run the full check**

```bash
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/code/tinycld/boards
git add tinycld/boards/components/PrLinkChip.tsx tinycld/boards/hooks/usePrLinks.ts tests/PrLinkChip.test.tsx
git commit -m "feat: PR link chips on the card"
```

---

## Task 11: Manual link and unlink

**Files:**
- Create: `~/code/tinycld/boards/tinycld/boards/hooks/usePrLinkMutations.ts`
- Create: `~/code/tinycld/boards/tinycld/boards/lib/parse-pr-url.ts`
- Create: `~/code/tinycld/boards/tests/parse-pr-url.test.ts`
- Modify: the card detail screen's action menu

**Interfaces:**
- Consumes: `boards_pr_links` (Task 1); `useMutation` from `@tinycld/core/lib/mutations`.
- Produces:
  - `parsePrUrl(url: string)` → `{ repo: string; number: number } | null`
  - `useLinkPr(cardId, projectId)`, `useUnlinkPr()`

- [ ] **Step 1: Write the failing URL-parser test**

Create `~/code/tinycld/boards/tests/parse-pr-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePrUrl } from '../parse-pr-url'

describe('parsePrUrl', () => {
    it('parses a standard PR URL', () => {
        expect(parsePrUrl('https://github.com/tinycld/boards/pull/42')).toEqual({
            repo: 'tinycld/boards',
            number: 42,
        })
    })

    it('tolerates a trailing slash, a fragment and a query', () => {
        expect(parsePrUrl('https://github.com/o/r/pull/7/')).toEqual({ repo: 'o/r', number: 7 })
        expect(parsePrUrl('https://github.com/o/r/pull/7#issuecomment-1')).toEqual({
            repo: 'o/r',
            number: 7,
        })
        expect(parsePrUrl('https://github.com/o/r/pull/7?w=1')).toEqual({
            repo: 'o/r',
            number: 7,
        })
    })

    it('parses a files or commits sub-path', () => {
        expect(parsePrUrl('https://github.com/o/r/pull/7/files')).toEqual({
            repo: 'o/r',
            number: 7,
        })
    })

    it('rejects an issue URL', () => {
        expect(parsePrUrl('https://github.com/o/r/issues/7')).toBeNull()
    })

    it('rejects a non-GitHub host', () => {
        expect(parsePrUrl('https://gitlab.com/o/r/pull/7')).toBeNull()
    })

    it('rejects junk', () => {
        expect(parsePrUrl('')).toBeNull()
        expect(parsePrUrl('not a url')).toBeNull()
        expect(parsePrUrl('https://github.com/o/r')).toBeNull()
        expect(parsePrUrl('https://github.com/o/r/pull/0')).toBeNull()
        expect(parsePrUrl('https://github.com/o/r/pull/abc')).toBeNull()
    })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd ~/code/tinycld/boards && pnpm exec vitest run tests/parse-pr-url.test.ts
```

Expected: FAIL — cannot resolve `../parse-pr-url`.

- [ ] **Step 3: Write the parser**

Create `~/code/tinycld/boards/tinycld/boards/lib/parse-pr-url.ts`:

```ts
/**
 * `https://github.com/o/r/pull/42` → `{ repo: 'o/r', number: 42 }`.
 *
 * The escape hatch for a PR no automatic rule matched — a repo whose branch
 * convention we do not control, or a PR opened before the card existed.
 *
 * Parsed with URL rather than a regex so a host check is a host check: a
 * pattern loose enough to accept the real URL also accepts
 * `https://evil.example/github.com/o/r/pull/1`.
 */
export function parsePrUrl(raw: string): { repo: string; number: number } | null {
    let parsed: URL
    try {
        parsed = new URL(raw.trim())
    } catch {
        return null
    }
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
        return null
    }
    const parts = parsed.pathname.split('/').filter(Boolean)
    // owner / repo / "pull" / number, plus an optional sub-path.
    if (parts.length < 4 || parts[2] !== 'pull') {
        return null
    }
    if (!/^[1-9][0-9]*$/.test(parts[3])) {
        return null
    }
    return { repo: `${parts[0]}/${parts[1]}`, number: Number.parseInt(parts[3], 10) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/code/tinycld/boards && pnpm exec vitest run tests/parse-pr-url.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Write the mutations**

Create `~/code/tinycld/boards/tinycld/boards/hooks/usePrLinkMutations.ts`, using
`useMutation` from `@tinycld/core/lib/mutations` (never `@tanstack/react-query`
directly) and `newRecordId()`:

```ts
import { useMutation } from '@tinycld/core/lib/mutations'
import { newRecordId } from 'pbtsdb'
import { useStore } from 'pbtsdb'

/**
 * Link a PR by URL.
 *
 * `link_source: 'manual'` matters beyond bookkeeping: the unlink path treats a
 * manual link as a plain delete, while a branch-derived one needs a tombstone
 * because it re-derives on the next delivery.
 */
export function useLinkPr(cardId: string, projectId: string) {
    const [prLinksCollection] = useStore('boards_pr_links')

    return useMutation({
        mutationFn: function* (input: { repo: string; number: number; url: string }) {
            yield prLinksCollection.insert({
                id: newRecordId(),
                card: cardId,
                project: projectId,
                repo: input.repo,
                number: input.number,
                url: input.url,
                state: 'open',
                link_source: 'manual',
                unlinked: false,
            })
        },
    })
}

/**
 * Remove a link.
 *
 * A manual link is deleted. A DERIVED link is tombstoned instead, because
 * deleting it only makes it reappear on the next push — the row's own
 * link_source decides which, so the caller does not have to.
 */
export function useUnlinkPr() {
    const [prLinksCollection] = useStore('boards_pr_links')

    return useMutation({
        mutationFn: function* (link: { id: string; link_source: string }) {
            if (link.link_source === 'manual') {
                yield prLinksCollection.delete(link.id)
                return
            }
            yield prLinksCollection.update(link.id, draft => {
                draft.unlinked = true
            })
        },
    })
}
```

Verify the `update` callback idiom against an existing mutation in this package:

```bash
grep -rn "\.update(" ~/code/tinycld/boards/tinycld/boards/hooks/*.ts | head -3
```

- [ ] **Step 6: Add the UI action**

Add a "Link pull request…" item to the card detail action menu, opening a
dialog with a single URL field. Use `useForm` + zod (never `useState` for form
fields), and show a validation error when `parsePrUrl` returns null. Add an
unlink affordance to each chip.

- [ ] **Step 7: Run the full check**

```bash
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/code/tinycld/boards
git add tinycld/boards/lib/parse-pr-url.ts tests/parse-pr-url.test.ts tinycld/boards/hooks/usePrLinkMutations.ts
git commit -m "feat: manual PR linking and unlinking

Unlink branches on link_source: a manual link is deleted, a derived one is
tombstoned, because deleting a derived link only makes it reappear on the
next push. Parsed with URL rather than a regex so the host check is real."
```

---

## Task 12: Board settings — repository attachment

**Files:**
- Create: `~/code/tinycld/boards/tinycld/boards/settings/github.tsx`
- Create: `~/code/tinycld/boards/server/github_app.go`
- Modify: `~/code/tinycld/boards/manifest.ts`

**Interfaces:**
- Consumes: `boards_project_repos` (Task 1); `system_settings` (core).
- Produces: a settings screen registered in the manifest; `func githubInstallationToken(app core.App, installationID string) (string, error)`.

- [ ] **Step 1: Read the manifest's settings contract**

```bash
grep -n "settings" ~/code/tinycld/tinycld/docs/packages.md | head -10
grep -rn "settings:" ~/code/tinycld/mail/manifest.ts | head -3
```

- [ ] **Step 2: Spike the GitHub App risk BEFORE building the token path**

The spec flags this as the one expensive-to-reverse decision: Jira Data Center
rejects the GitHub App model because OAuth token refresh fails after 8 hours in
that deployment shape. Verify it does not apply here — a self-registered App
minting installation tokens is a server-to-server JWT flow, materially
different from a user OAuth token.

Confirm from GitHub's current documentation that:
1. A self-registered App can mint an installation access token from its App ID
   + private key with no user interaction.
2. Those tokens expire in ~1 hour and are re-minted, not refreshed.
3. Nothing in that flow requires a callback to a public URL.

**If any of these is false, STOP and surface it.** The fallback is a
fine-grained PAT per connection — same schema, `installation_id` becomes a
credential reference — and that is a design change, not an implementation
detail.

- [ ] **Step 3: Implement token minting**

Create `~/code/tinycld/boards/server/github_app.go` with
`githubInstallationToken`. Requirements:

- Read `boards.github.app_id` and `boards.github.private_key` from
  `system_settings` (both `is_secret`).
- Sign a JWT (RS256, 10-minute expiry) with the private key, then exchange it
  at `POST /app/installations/{id}/access_tokens`.
- Cache the resulting token in memory until ~5 minutes before its expiry;
  re-mint rather than refresh.
- Use the SSRF-guarded helper from plan 1 for the outbound call if it fits, or
  a plain client with an explicit timeout (github.com is a fixed, trusted host,
  so the SSRF guard is not load-bearing here — but the timeout is).
- Never log the private key or the minted token.

- [ ] **Step 4: Write the settings screen**

Create `~/code/tinycld/boards/tinycld/boards/settings/github.tsx`:

- Lists attached repositories from `boards_project_repos` via `useOrgLiveQuery`.
- Add-repository form using `useForm` + zod (`owner/name` shape).
- Remove action per row.
- Shows the webhook URL for this deployment using **`{{server-host}}`-style
  substitution or the runtime host** — never a hand-authored hostname.
- Owner-only: read the role with `useCurrentRole()` and render a read-only
  view for anyone else.
- **Git is inactive until a repo is attached** — there is no enable switch. An
  empty state explains that attaching a repository turns the integration on.
- Semantic color tokens only; minimal JSX; works on web and native.

- [ ] **Step 5: Register in the manifest and bump the version**

In `~/code/tinycld/boards/manifest.ts`, add to the `settings` array (creating
it if absent):

```ts
    settings: [{ slug: 'github', component: 'settings/github', label: 'GitHub' }],
```

Bump `version` from `0.2.0` to `0.3.0` — this adds collections and triggers.

- [ ] **Step 6: Regenerate and check**

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check
cd ~/code/tinycld/boards/server && go test ./...
```

Expected: PASS. Confirm the exports map has a matching `./settings/*` entry —
the generator warns and skips silently otherwise.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/boards
git add tinycld/boards/settings/github.tsx server/github_app.go manifest.ts package.json
git commit -m "feat: attach repositories to a board

No enable switch: the integration is inactive until a repository is attached,
so the connection is the enablement. Installation tokens are re-minted rather
than refreshed, which is what makes the App model work without a callback."
```

---

## Task 13: CLI

**Files:**
- Create: `~/code/tinycld/boards/cli/github.go`
- Test: `~/code/tinycld/boards/cli/github_test.go`
- Modify: `~/code/tinycld/boards/cli/register.go`

**Interfaces:**
- Consumes: `boards_pr_links`, `boards_project_repos` via the REST API with an OAuth token.
- Produces: `boards github list`, `boards card link-pr <key> <url>`, `boards card unlink-pr <key> <url>`.

- [ ] **Step 1: Read the CLI idiom and its test server**

```bash
sed -n '1,40p' ~/code/tinycld/boards/cli/link.go
sed -n '1,30p' ~/code/tinycld/boards/cli/testserver_test.go
```

- [ ] **Step 2: Write the failing test**

Create `~/code/tinycld/boards/cli/github_test.go`, following `link.go`'s test
in `commands_test.go`. Cover: `link-pr` with a valid URL writes a link;
`link-pr` with a non-GitHub URL fails with a clear message; `list` prints
attached repositories; an unknown card key fails without a stack trace.

- [ ] **Step 3: Run it to verify it fails**

```bash
cd ~/code/tinycld/boards/cli && go test ./ -run TestGitHub -v
```

Expected: FAIL — the commands do not exist.

- [ ] **Step 4: Implement the commands**

Create `cli/github.go`. Cobra is the source of truth for `--help`. Note that
`boards_project_repos` is READ-ONLY for OAuth tokens (Task 8), so there is
deliberately **no** `github attach` command — adding one means widening that
grant first, which is a security decision rather than a CLI one. Say so in a
comment, mirroring the manifest's note about the absent `share` commands.

- [ ] **Step 5: Register the group**

Add the command group in `cli/register.go` following the existing pattern.

- [ ] **Step 6: Run the CLI tests**

```bash
cd ~/code/tinycld/boards/cli && go test ./...
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/boards
git add cli/github.go cli/github_test.go cli/register.go
git commit -m "feat: boards github CLI commands

No attach command: boards_project_repos is read-only for OAuth tokens, so
adding one means widening that grant first — a security decision, not a CLI
one."
```

---

## Task 14: Help topic

**Files:**
- Create: `~/code/tinycld/boards/help/linking-pull-requests.md`

- [ ] **Step 1: Read two existing topics for voice and frontmatter**

```bash
head -20 ~/code/tinycld/boards/help/rules.md
head -20 ~/code/tinycld/boards/help/sharing-boards.md
```

- [ ] **Step 2: Write the topic**

Create the file with required `title` and `summary` frontmatter, optional
`tags` and `order`. Lead with task-oriented prose ("To link a pull request to
a card, …"), not API docs. Cover:

- Naming a branch so it links automatically: `OTTER-123` anywhere in the
  branch name, PR title, or PR description.
- That a card moves to Done when **all** its linked PRs merge, not the first —
  and why (a card spanning two repos is not finished when one lands).
- `skip OTTER-123` / `ignore OTTER-123` in the PR description to prevent a
  link, and that this is the durable way — removing the link by hand will not
  hold if the branch still names the card.
- Linking a PR by URL, and unlinking.
- That an owner attaches repositories in Board settings → GitHub, and the
  integration does nothing until one is attached.
- Which rules the triggers enable, cross-linked with
  `[rules](help://boards:rules)`.

**Constraints:** any keyboard shortcut uses Mac glyphs only (`⌘` `⇧` `⌥`).
Never hand-author a hostname — write `{{server-host}}`.

- [ ] **Step 3: Regenerate so the topic appears**

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
```

The manifest already declares `help: { directory: 'help' }`, so no manifest
change is needed. Confirm the topic is picked up:

```bash
grep -c "linking-pull-requests" ~/code/tinycld/tinycld/lib/generated/*.ts
```

Expected: at least 1.

- [ ] **Step 4: Commit**

```bash
cd ~/code/tinycld/boards
git add help/linking-pull-requests.md
git commit -m "docs: help topic for linking pull requests"
```

---

## Task 15: E2E and final verification

**Files:**
- Create: `~/code/tinycld/boards/tests/e2e/pr-links.spec.ts`

- [ ] **Step 1: Read the E2E helpers and one existing spec**

```bash
sed -n '1,40p' ~/code/tinycld/boards/tests/e2e/helpers.ts
sed -n '1,40p' ~/code/tinycld/boards/tests/e2e/card-editing.spec.ts
```

**Constraints, from CLAUDE.md:** never `page.goto()` for in-app navigation —
use `login(page)`, then `navigateToPackage(page, 'boards')`, then
`clickSidebarItem`. Reserve `page.goto('/')` for the initial load in `login`.
Never assume the post-login redirect lands on a specific package. Set up data
**by driving the UI**, never with raw PB writes.

- [ ] **Step 2: Write the spec**

Create `~/code/tinycld/boards/tests/e2e/pr-links.spec.ts` covering the manual
path end to end, entirely through the UI:

1. Log in, navigate to boards, open a card.
2. Link a PR by URL through the dialog.
3. Assert the chip appears with the PR number.
4. Unlink it; assert the chip goes away.
5. Assert an invalid URL shows a validation message and creates nothing.

The webhook path is covered by the Go tests (Tasks 5–6); an E2E cannot forge a
signed delivery without either a raw write or a test-only endpoint, and both
are forbidden.

- [ ] **Step 3: Run the E2E suite**

```bash
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg test:e2e
```

Expected: PASS. **If a test is flaky, fix the root cause** — never bump a
timeout, force serial runs, or re-run blindly. If the fix is genuinely out of
scope, STOP and surface it.

- [ ] **Step 4: Run every check**

```bash
cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check
cd ~/code/tinycld/boards/server && go test ./...
cd ~/code/tinycld/boards/cli && go test ./...
cd ~/code/tinycld && pnpm run checks
```

Expected: PASS throughout, including `check:core-isolation` — nothing in this
plan puts a package name into core.

- [ ] **Step 5: Update the package TODO**

In `~/code/tinycld/boards/docs/TODO.md`, mark item 24 shipped, following the
formatting of the other shipped Tier 2 entries: what landed, the branch name,
and the reasoning worth keeping (the link row as the trigger surface, all-merged
semantics, the tombstone). Also correct item 24's "host in `org-github`"
instruction, which was wrong — that is the org profile repo.

- [ ] **Step 6: Commit and open the PR**

```bash
cd ~/code/tinycld/boards
git add tests/e2e/pr-links.spec.ts docs/TODO.md
git commit -m "test: e2e for manual PR linking

feat: closes TODO item 24"
git push -u origin feat/github-integration
gh pr create --title "feat: GitHub pull request integration" --body "$(cat <<'EOF'
Links GitHub pull requests to cards by card key, and moves cards through their
lists via the existing rules engine.

**How it works.** The webhook writes a `boards_pr_links` row; a server-owned
rollup derives `pr_state` on the card; four new triggers watch that column.
`move-card` needed no changes — the rules engine reaches everything else
through machinery that already existed.

**All-merged semantics.** A card moves when its LAST open PR merges, not its
first, so a card spanning core and a package is not marked done when only one
side lands. The derived column is computed once and read by both the card face
and the triggers, so display and automation cannot disagree.

**Linkage.** Card key in the branch name, PR title or PR body, plus manual
linking by URL. `skip OTTER-123` in the PR body is the durable opt-out —
branch-name linkage re-derives on every delivery, so a removed link is
tombstoned rather than deleted.

Requires the core webhook layers (separate PR, same branch name).

Design: `docs/superpowers/specs/2026-09-09-github-integration-design.md`
EOF
)"
```

---

## Self-review notes

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `boards_pr_links` with neutral + provider state columns | 1 |
| `boards_project_repos` | 1 |
| `project` denormalized + anti-desync pin | 1, 9 |
| Card `pr_state` / `pr_review_state` | 1 |
| Activity kinds appended | 1 |
| Branch / title / body key scanning | 2, 3 |
| `skip` / `ignore` directives | 2, 3, 5 |
| `unlinked` tombstone | 1, 5, 11 |
| All-merged rollup, per-card locked | 4 |
| Four triggers with `Original()` filters | 7 |
| No new actions | 7 (verified: `move-card` unchanged) |
| GitHub App auth, `system_settings` secrets | 12 |
| Read-only GitHub permissions, no write-back | 12 (Step 3), 15 |
| `webhookin` source registration | 6 |
| Events: `pull_request`, `pull_request_review` | 3 |
| `oauth_scopes.go` updated, webhook route unscoped | 8 |
| Board-move re-stamping, BOTH lists | 8 |
| RLS + shipped-rules tests | 9 |
| Card UI chip | 10 |
| Manual link / unlink | 11 |
| CLI | 13 |
| Help topic | 14 |
| E2E | 15 |
| GitHub App risk spiked before commitment | 12 (Step 2) |

**Deliberate deviations from the spec, both stated in-plan:**
1. **Actor attribution** (spec's bite #2) is not its own task. The webhook runs
   as a superuser and writes no `boards_activity` rows in this plan — the
   rollup writes only card columns. If activity rows are added for `pr_linked`
   / `pr_merged`, they need an explicit system actor; the enum values exist
   (Task 1) but nothing writes them yet. **Surfaced rather than silently
   dropped.**
2. **`review_requested` handling** sets `in_review` from a `pull_request`
   action rather than a review event, because GitHub delivers it on the PR.
   Task 3's decoder handles both paths.

**Type consistency check:** `prEvent` fields set in Task 3's decoder are exactly
those read in Task 5 (`Repo`, `Number`, `Branch`, `Title`, `Body`, `Author`,
`URL`, `State`, `ReviewState`). `scannedKey` is `{Slug, Number}` in both Go
files. `cardLinkTarget` is `{CardID, ProjectID, Source}` in its definition and
both use sites. TS `ScannedKey` is `{slug, number}` — lower-case, matching TS
convention, and the two languages never exchange these values directly. Filter
names `cardPROpened` / `cardPRMerged` / `cardPRReviewRequested` /
`cardPRApproved` are identical in Task 7's tests, implementation, and
registration.

**Helper names to confirm at implementation time**, each with the grep inline:
`setupCardsEnv` and its env type (Task 5 Step 2), the move helper in
`endpoints_move_card_test.go` (Task 8 Step 7), `tests/unit.helpers.tsx`'s
exports (Task 10 Step 2), and the pbtsdb `.update()` callback idiom (Task 11
Step 5). Only `activityLog` (Task 4 Step 6) and the `system_settings` `value`
column (Task 6 Step 5) are verified with an explicit check step.
