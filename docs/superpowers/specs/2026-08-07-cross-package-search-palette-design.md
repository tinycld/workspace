# Cross-package `/` search palette

## Context

`~/.claude/plans/goofy-foraging-stearns.md` planned a `/` search palette scoped to the cards
package, alongside cards keyboard control. Part 1 (keyboard control) is in flight — `scopes.ts`
already carries the focus-aware `useShortcutScope` fix, and `cards/` has `board-focus.ts`,
`useBoardShortcuts.ts` and the focus-ring wiring uncommitted. This spec covers Part 2, revised
from cards-only to **cross-package**.

The revision's motivation: `/` is a global key. If cards claims it, no other package can. Either
the palette is cards-only forever, or it belongs to core and packages contribute into it. This
spec takes the second path.

### Scope of this batch

- Core: the palette shell, a `search` manifest contribution, the adapter registry.
- `core/fts`: `MemberScope`, a disabled-user check, `ExcludeField`.
- Cards: a search route + FTS5 migration (the only package with no search today).
- Adapters for **cards, contacts, drive, mail**.

**Explicitly out of scope:** migrating drive or mail onto `core/fts`. They have working search;
the palette federates over their existing routes via adapters. Consolidating drive onto `core/fts`
is a worthwhile independent cleanup (its `sanitizeFTSQuery` is a near-copy that has already
drifted once — see `drive/server/search.go:30`) but is not a prerequisite and should not ride
along in a search-UI batch. Mail should likely never migrate; see "Rejected alternatives".

---

## Architecture

Three layers, each independently testable:

```
  ┌─────────────────────────────────────────────────────────┐
  │  core/components/search-palette/                        │
  │  SearchPalette.web.tsx                                  │
  │    · overlay, chips, input, grouped list, footer        │
  │    · owns selected row id, keyboard nav, focus, dismiss │
  │    · knows NOTHING about any package's data             │
  └───────────────────────┬─────────────────────────────────┘
                          │ reads
  ┌───────────────────────▼─────────────────────────────────┐
  │  core/lib/search/registry.ts                            │
  │    packageSearchAdapters — derived from tinycldConfig   │
  │    exactly like packageSettings / packageSidebars       │
  └───────────────────────┬─────────────────────────────────┘
                          │ one entry per installed package
  ┌───────────────────────▼─────────────────────────────────┐
  │  <pkg>/tinycld/<slug>/search-adapter.ts                 │
  │    export const toRow  — pure   (hit → SearchRow)       │
  │    export const useSearchActions — hook (onSelect)      │
  └─────────────────────────────────────────────────────────┘
```

### The manifest contribution

A new optional field on `PackageManifest`, riding the existing generator rails:

```ts
search?: {
    endpoint: string   // '/api/mail/search'
    adapter: string    // exports subpath, e.g. 'search-adapter'
    label?: string     // chip/group label; defaults to nav.label
}
```

`label` defaults to `nav.label`; the chip token itself is always the package **slug** (lowercase,
no spaces), so the typed grammar stays predictable regardless of display label.

### The adapter contract

This is the load-bearing interface of the design. It has two halves because selection and
rendering have genuinely different requirements.

```ts
// core/lib/search/types.ts

export interface SearchRow {
    id: string
    title: string
    /** Identifying detail, e.g. 'Grace Hopper · Inbox · 1d'. */
    subtitle?: string
    /** Right-aligned trailing detail, e.g. a board name or file size. */
    meta?: string
}

export interface SearchAdapterModule {
    /** Pure: one raw hit from this package's endpoint → one row. */
    toRow: (hit: unknown) => SearchRow
    /**
     * Hook: returns the selection handler. A hook because selection needs
     * router and store handles. MUST be side-effect free — it is called for
     * every in-scope package while the palette is open, including packages
     * with no visible results (see "Hooks constraint").
     */
    useSearchActions: () => { onSelect: (row: SearchRow) => void }
}
```

`toRow` takes `unknown` rather than a generic parameter: the palette holds a heterogeneous
`Record<slug, SearchAdapterModule>` and cannot carry per-package types through it. Each adapter
casts to its own package's response type in its first line, where that type is available and
checked. This is the one place a cast is warranted, and it is confined to a single line per
package.

**Why selection is imperative rather than a declarative `href`:** cards' selection is not a
route. `cards-ui-store.ts` shows `setActiveProject` deliberately nulls `openCardId`, so opening a
card from another board is an *ordered sequence* — `setActiveProject(boardId)` then
`openCard(cardId)` — and if the user is on `[cardId]`, a `router.replace` to the board index must
precede both, because that screen derives its card from the route param and would otherwise render
"card doesn't exist". No URL string expresses that. Drive is a second case: its search feeds a
file-list view rather than a route, so selecting a hit means navigating to a folder *and* setting
selection state.

### Why the seam is here and not at `core/fts`

Placing the extensibility seam at the palette rather than at the search engine means a package's
route implementation is invisible to the palette, and joining is cheap at every level of
investment:

| Situation | Work to join the palette |
|---|---|
| already has a search route | write `toRow` + `useSearchActions` (~20 lines) |
| needs a route, single-table | `core/fts` config + FTS5 migration (cards) |
| no server search at all | adapter over the already-synced local collection, zero Go |

That third row matters: `calendar`, `text` and `calc` have Go servers but no search, and `notes`
has no server. Under a `core/fts`-only design each would need an FTS5 table and migration before
appearing in the palette. Under this design they can join with client-side adapters over data
pbtsdb already syncs.

### Generator change

Every component the generator emits today is wrapped in `lazy(() => import(...))` (see
`gen-config.ts:104-138`). An adapter is a module of two non-component exports, so `React.lazy`
cannot wrap it. The generator emits a **bare lazy module thunk**:

```ts
search: {
    endpoint: '/api/cards/search',
    label: 'Cards',
    load: () => import('@tinycld/cards/search-adapter'),
},
```

The palette resolves each in-scope package's module on first use and caches it, so `/` in an
eight-package workspace does not eagerly pull eight adapter modules. `manifest.search.adapter`
goes through the same `assertSafeImportField` validation as `settings[].component` and
`sidebarContributions[].component`.

---

## Interaction model

### Query grammar

The input holds an ordered list of chips plus free text:

```ts
state: { chips: string[], text: string }
```

Chips are created **only** by pressing `:` immediately after a word matching an installed
package's slug or label. Until that keypress the word is ordinary searchable text — so the email
titled "mail server migration" remains findable. This is the GitHub/Gmail/Slack convention, so it
costs no teaching.

| Input | Result |
|---|---|
| `:` after a word matching a package | pop the word, push a chip |
| `:` after a non-matching word (`budget:`) | stays literal text |
| Backspace with empty text | remove the trailing chip |
| `:` for an already-present chip | no-op; the word is consumed |
| `/` pressed from inside Mail | opens `{ chips: ['mail'], text: '' }` |

### Search terms: what the text means

Everything that is not a chip is search text. Its semantics:

**Implicit AND over prefix terms.** `budget q3` requires both terms; each matches as a prefix
(`bud` matches "budget"). This is what all four backends already do — `core/fts/sanitize.go:40-46`
quotes each term and appends `*`, joined by spaces, which is FTS5's implicit AND. The palette does
not change it; the spec states it because it was previously unstated behavior.

**Negation with `-term`.** Supported. `budget -draft` requires "budget" and excludes "draft".

Negation binds **only at a term boundary**: a `-` that is preceded by whitespace (or is the first
character) and followed by a non-space character. Mid-token hyphens are literal. This rule is not
cosmetic — `-` is in the strip regex today precisely because of hyphenated filenames and email
addresses:

| Input | Parse |
|---|---|
| `budget -draft` | require `budget`, exclude `draft` |
| `budget-2026.xlsx` | one literal term; the hyphen is mid-token |
| `-draft` | exclude-only; see below |
| `budget - draft` | trailing `-` with no attached term is dropped |

**An exclude-only query returns nothing.** `-draft` alone has no positive term, so there is no
result set to subtract from. The palette shows "Add a word to search for" rather than running a
query that FTS5 would reject.

**No other operators.** `&&`, `||`, `!`, `AND`, `OR`, `NOT`, quotes and parentheses are **not**
supported and are stripped from the text before it reaches any backend. `parseQuery` strips them
client-side so the user watches the character disappear as they type, rather than silently getting
results that do not match what they typed.

This last point fixes real current misbehavior, not merely a missing feature. Today `-urgent`
reaches `SanitizeQuery`, which strips the `-` and searches for `urgent` — the **opposite** of the
user's intent. And `a && b` leaves `&&` inside a quoted term (`"&&"*`), which matches no token and
silently kills the entire query via the implicit AND. Both are silent wrong answers.

Boolean operators are also a poor fit for search-as-you-type: `foo &&` is a syntactically
incomplete expression that every intermediate keystroke must handle, and passing it through to
FTS5 turns a parse error into a user-facing failure on the way to a valid query.

### Server support for negation

Negation is a **client-parsed, server-executed** feature. `parseQuery` splits text into
`{ include: string[], exclude: string[] }` and passes them as separate query params, so no backend
ever parses operator syntax and the injection surface `sanitize.go` exists to close stays closed.

- **`core/fts`** — `SanitizeQuery` gains a companion that emits FTS5 `NOT` for excluded terms:
  `"budget"* NOT "draft"*`. Contacts, drive and cards get this for free.
- **`mail`** — needs the same treatment applied to **both arms of its UNION**
  (`buildThreadFTSQuery` and `buildMessageFTSQuery`, `mail/server/search.go:58-79`). A negation
  applied to only one arm produces nonsense: the excluded rows return via the other arm. This is
  the single largest risk in the negation work and needs its own test.
- **`drive`** — `drive/server/search.go:17` has its own near-copy of `sanitizeFTSQuery`. It needs
  the same change, which is a second instance of the drift the "migrate drive onto `core/fts`"
  cleanup would prevent. Noted as further motivation for that follow-up.

Excluded terms apply to the same columns the positive terms search — no per-column negation
(`-from:ada`), which would require the structured-filter machinery only mail has.

**Opening state pre-seeds the current package.** One Backspace clears it to everywhere. This makes
the common case ("find a thing in what I'm looking at") free, at the cost of a chip the user did
not type — an accepted tension with the otherwise-explicit `:` rule.

### Rendering

```
RESTING — opened from Mail, one chip
╭────────────────────────────────────────────────────────╮
│  ⌕  ⟨✉ mail⟩ budget                                    │
├────────────────────────────────────────────────────────┤
│  ✉  Q3 budget approval                                 │
│     Grace Hopper · Inbox · 1d                          │
│  ✉  Re: budget numbers                                 │
│     Ada Lovelace · Archive · 4d                        │
├────────────────────────────────────────────────────────┤
│  ↑↓ move   ↵ open   ⌫ remove mail   esc close          │
╰────────────────────────────────────────────────────────╯

NO CHIPS — flat, best match first, each row badged with its package
╭────────────────────────────────────────────────────────╮
│  ⌕  budget-2026                                        │
├────────────────────────────────────────────────────────┤
│  ⛁  budget-2026.xlsx                            3d     │  ← tier 4
│     Finance / Planning                                 │
│  ▤  Finish budget review              Q3 Planning      │  ← tier 3
│  ✉  Q3 budget approval                Grace · 1d       │  ← tier 1
│     Grace Hopper · Inbox                               │
╰────────────────────────────────────────────────────────╯
   Drive outranks Mail despite nav.order 12 > 5 — the exact
   title-prefix match wins. Grouping would have buried it.

TWO CHIPS — grouped; the user has already narrowed the field
╭────────────────────────────────────────────────────────╮
│  ⌕  ⟨✉ mail⟩ ⟨⛁ drive⟩ budget                          │
├────────────────────────────────────────────────────────┤
│  ✉ MAIL                                                │
│    Q3 budget approval               Grace · 1d         │
│  ⛁ DRIVE                                               │
│    budget-2026.xlsx                 3d                 │
├────────────────────────────────────────────────────────┤
│  ↑↓ move   ↵ open   ⌫ remove drive   esc close         │
╰────────────────────────────────────────────────────────╯
```

**Grouping rule:**

| Scope | Rendering | Order |
|---|---|---|
| zero chips (everywhere) | **flat**, each row badged with its package icon | match quality, best first |
| exactly one chip | flat, no badges or header (the chip states the scope) | that package's own rank |
| 2+ chips | grouped, each group headed by `nav.icon` + label | groups by `nav.order`; rows by rank within |

Zero chips is the "I don't know where it is" case, so the best answer must be able to reach the
top — grouping would structurally prevent that by pinning a perfect Drive match below every Mail
hit. Explicit multi-chip is "I know it's one of these two", where scan-by-package is the more
useful affordance and the user has already narrowed the field.

Arrow keys traverse the flattened list across group boundaries — groups are visual, not
navigational. Chips carry the same `nav.icon` as the group header and the destination, so one
glyph identifies a package everywhere it appears.

### Cross-package scoring

Ordering a flat multi-package list requires comparing hits from different backends. **BM25 ranks
cannot do this.** FTS5's BM25 weights each term by inverse document frequency computed over *that
table's* corpus: if "budget" appears in 3 of 50,000 mail messages it scores as a rare, valuable
term, while the same word in 40 of 200 drive files scores as common. The two numbers are
meaningful only relative to their own index. A drive file that is a perfect filename match can
therefore score below a marginal mail hit.

The palette instead scores **match quality against the row's own visible text** — a pure function
of `(query, row)` requiring no backend change and producing identical units for every package by
construction. This is what command palettes generally rank on, and it suits the situation: the
backend has already done recall (~25 pre-filtered rows per package), so the client's job is
precision over text it can see.

`scoreRow(query, row) → number`, in `core/lib/search/score.ts`:

| Tier | Condition (case- and punctuation-insensitive) | Base |
|---|---|---|
| 5 | `title` equals the query | 1000 |
| 4 | `title` starts with the query | 800 |
| 3 | every query term prefix-matches a word in `title` | 600 |
| 2 | `title` contains the query as a substring | 400 |
| 1 | terms matched only in `subtitle`/`meta` | 200 |
| 0 | no visible match — the backend matched body/content | 100 |

**Tier 0 is load-bearing.** Mail matches message bodies and drive matches file content, so a
genuinely excellent hit may contain none of the query terms in its visible row. Scoring these
lowest keeps them present but below anything with a visible match, rather than discarding results
the backend was right to return.

Tie-breakers within a tier, in order:

1. **Shorter `title` wins.** A 12-character title containing the query is a tighter match than a
   90-character one containing the same words. Unit-free, so it compares across packages.
2. **The package's own rank position** (the hit's index in that package's response), preserving
   each backend's relevance judgement inside a tier — this is where BM25 still does useful work,
   in the one place its scores are validly comparable.
3. **`nav.order`**, so ordering is deterministic and stable rather than dependent on which
   response arrived first.

Deterministic ordering matters more than it looks: results stream in per package, and a
non-deterministic sort would let rows reshuffle under the user's selection cursor as a slower
package resolves.

**Excluded terms do not participate in scoring** — they have already removed rows server-side, so
counting them again would double-penalize.

### Footer

The footer is where the grammar is discoverable, so it is state-dependent rather than static:

| State | Footer |
|---|---|
| typed word matches an installed package | `↑↓ move · ↵ open · : scope to drive · esc close` |
| chips present, text empty | `↑↓ move · ↵ open · ⌫ remove drive · esc close` |
| otherwise | `↑↓ move · ↵ open · esc close` |

### Keyboard

`↑`/`↓` move (wrapping), `↵` selects, `⌫` removes the trailing chip when text is empty, `Esc`
closes. Registered at `scope: 'global'` (id `core.search.open`, group `'General'`) — the only
scope the matcher treats as always-active, and required because `/` must fire from any package's
list *and* detail screens. `allowInInputs` is omitted so `/` stays suppressed while typing.

The palette's own key handling uses a **capture-phase document listener**. This is not a
preference: `HelpSearchPalette.web.tsx:80-82` documents that react-native-web's `TextInput`
swallows Escape on its internal bubble handler and does not fire `onKeyPress` for arrows.

### No preview pane

Rows carry title + subtitle + meta, which is enough to identify a hit. The adapter contract
reserves no `Preview` slot — an unexercised interface tends to be wrong when first used, and
adding one later is additive to `toRow`.

---

## Data flow

```
  /  keypress (global scope)
       │
       ▼
  useSearchPaletteStore          ← core Zustand: isOpen, chips, text
       │                            NOT persisted; opening seeds chips
       │                            from the active package slug
       ▼
  scopedPackages = chips.length ? chips : allWithSearch
       │
       ├──► useApiSearch('/api/mail/search',  text) ──► hits ──► mail.toRow  ──┐
       ├──► useApiSearch('/api/cards/search', text) ──► hits ──► cards.toRow ──┤
       └──► useApiSearch('/api/drive/search', text) ──► hits ──► drive.toRow ──┤
                                                                               │
       ┌───────────────────────────────────────────────────────────────────────┘
       ▼
  sections: { slug, label, icon, rows }[]      ← pure, sorted by nav.order
       │
       ▼
  SearchPalette  ──(↵)──►  adapters[slug].useSearchActions().onSelect(row)
       │
       ▼
  close()      ← palette closes after onSelect returns, unconditionally
```

### Fetching

Each in-scope package queries independently through core's existing `useApiSearch`, which already
debounces 300ms and lets React Query abort superseded requests via the queryFn `signal`. No new
fetch machinery.

- Results render **as they arrive** rather than waiting on the slowest package. In the flat
  (unscoped) case this means the list **re-sorts** when a later package resolves, since a
  high-scoring hit must be able to take the top slot. To keep that from moving the selection out
  from under the user, the palette tracks the selected **row id** rather than its index, so the
  cursor follows its row through a re-sort. The selection only resets when the query itself
  changes.
- A package still in flight renders nothing — not a spinner row, which would make the list jump
  under the user's selection cursor.
- One package erroring drops its group and leaves the rest. `core/fts` routes already return
  `{items:[],total:0}` rather than an error status (`register.go:57-59`), so this mainly concerns
  mail's differing shape.

**Fan-out limit.** With zero chips, every post-debounce keystroke fans out to one request per
package declaring `search`. That is four requests today against local SQLite — cheap. It is also
the first thing that will degrade as packages are added. The spec does not pre-optimize, but
implementation should cap concurrent unscoped fan-out at the packages declaring `search` (not all
installed packages) and this should be revisited if that count grows past roughly eight.

### Hooks constraint

`useSearchActions` is a hook and therefore cannot be called conditionally at selection time. The
palette calls **every in-scope package's** `useSearchActions()` at the top level into a
`Record<slug, actions>` map, then indexes that map on Enter. Consequence: adapter hooks run while
the palette is open even for packages with no visible results. This is acceptable because they
only wire up router and store handles — and it is why the contract requires `useSearchActions` to
be side-effect free. An adapter that fetches, subscribes or mutates inside `useSearchActions` is a
contract violation.

### Pure, testable units (no React)

- `parseQuery(input, installedSlugs)` → `{ chips, include, exclude }` — the `:` grammar, the
  `-term` boundary rule, and operator stripping
- `scoreRow(query, row)` → number — the tier + tie-break scoring
- `buildSections(resultsBySlug, packages, mode)` → flat rows or ordered sections
- each package's `toRow` — hit shape → row

---

## Server: `core/fts` changes

Three changes, all of which the original plan identified and verified. Only cards *needs* them,
but two fix latent bugs affecting contacts today.

### 1. `MemberScope`

`OwnerScope` emits only single-field equality (`c.owner IN ({:owner})`). Cards is
membership-scoped: a user may search any project where they hold a `cards_project_members` row.
Turn the scope into an interface in `config.go`:

```go
type Scope interface {
    clause() string
    params(userID string) map[string]any
}

// OwnerScope keeps its current behavior, now implementing Scope.
// MemberScope emits:
//   c.<RecordField> IN (SELECT <MemberField> FROM <Table> WHERE <UserField> = {:user})
type MemberScope struct {
    Table, MemberField, UserField, RecordField string
}
```

Rename `Config.Owner OwnerScope` → `Config.Scope Scope`, and build the clause via
`cfg.Scope.clause()/.params()` in `search.go`. **`contacts/server/register.go:50` is the only
caller in the workspace** — a one-line change there, plus `core/server/fts/search_test.go`.

### 2. Disabled-user check

`core/fts` has no disabled check, and PB access rules do not run behind this raw-SQL path. Drive
hit exactly this and bolted on `driveshare.IsSuspended` — its comment notes that without it,
search returned names and content of everything shared with a suspended user. Add the check
centrally in `fts.Search` (return zero rows when the user record is missing or `disabled` is
true), which fixes contacts at the same time.

### 3. `ExcludeField`

`cards_cards.archived` and `cards_projects.archived` are **bool** fields. The existing
`SoftDeleteField` splits on `field = ''` vs `!= ''` for text timestamps, and `''` against a bool
column misbehaves under SQLite's loose typing. Add a distinct `ExcludeField string` to `Config`
emitting `AND c.<field> != true`. Document in `config.go` why the two mechanisms differ so a later
reader does not conflate them.

## Server: cards wiring

New migration `cards/pb-migrations/1980000002_create_fts_cards.js` (append-only; 1980000000 and
1980000001 are shipped and frozen):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS fts_cards USING fts5(
    record_id UNINDEXED, title, description, tokenize='porter unicode61'
)
```

plus a **backfill**:

```sql
INSERT INTO fts_cards (record_id, title, description)
SELECT id, title, description FROM cards_cards
```

Unlike contacts/drive/mail — whose FTS tables shipped alongside their collections — `cards_cards`
already shipped, so existing rows would otherwise never be indexed (sync hooks fire only on future
writes). Include the `DROP TABLE` down migration and copy the `types.d.ts` reference-path
convention from the sibling `1980000001` file.

`description` is markdown source, not HTML, so `Strip: false`.

In `cards/server/register.go`, inside `registerShared`:

```go
Scope: fts.MemberScope{Table: "cards_project_members", MemberField: "project",
                       UserField: "user", RecordField: "project"},
Output: []fts.OutputColumn{{Name: "title"}, {Name: "project"}, {Name: "list"}},
ExcludeField: "archived",
```

```go
fts.Register(app, []fts.Config{ftsConfig})
```

Return only ids for `project`/`list` — names resolve client-side from the eagerly-synced
collections rather than widening the server response.

**Hosted tenants need no pb-hooks file.** The generator emits `package_extensions.go` calling
`Register()` for each linked package in both the single-org app and a tenant binary. Confirm
during implementation that "cards selected for a tenant" and "cards Go linked" are the same gate;
this should already hold, since cards' existing counters and last-owner guard depend on it.

---

## Adapters

Four adapters ship in this batch. The heterogeneity is the point — it is what proves the contract.

| Package | Hit shape | `onSelect` |
|---|---|---|
| **cards** | `{id, title, project, list}` | `router.replace` if on `[cardId]`, then `setActiveProject`, then `openCard` — in that order |
| **mail** | `{thread_id, subject, participants, latest_date, mailbox_id}` | `router.push` to the thread route under its mailbox |
| **drive** | `{id, name, description}` | navigate to the item's folder and select it — drive's search currently feeds its file list (`useDrive.tsx:343`) rather than a distinct open action, so the exact behavior is an implementation decision |
| **contacts** | `{id, first_name, last_name, email, company}` | `router.push` to the contact route |

Each package adds a `./search-adapter` entry to its `exports` map — verified absent from
`cards/package.json` today, so this is a required change in all four.

Cards' `toRow` resolves `project`/`list` ids to names from the local synced collections. A hit
whose project is not yet synced is **skipped**, with a comment so the skip is not later mistaken
for a bug.

No client-side role filtering is needed: `MemberScope` guarantees the server returns only member
projects, and each package's existing route is already owner- or membership-scoped.

---

## Files

**Core (`tinycld/`)**
- `core/lib/packages/types.ts` — add the `search` manifest field
- `core/lib/search/types.ts` — `SearchRow`, `SearchAdapterModule`
- `core/lib/search/registry.ts` — derive `packageSearchAdapters` from `tinycldConfig`
- `core/lib/search/parse-query.ts` — `parseQuery` (the `:` grammar, `-term`, operator stripping)
- `core/lib/search/score.ts` — `scoreRow`
- `core/lib/search/build-sections.ts` — `buildSections`
- `core/lib/search/search-palette-store.ts` — Zustand: `isOpen`, `chips`, `text` (not persisted)
- `core/components/search-palette/SearchPalette.web.tsx` — the shell
- `core/components/search-palette/SearchPalette.tsx` — native stub returning `null`
- `core/components/CoreShortcuts.tsx` — register `/` at `scope: 'global'`
- `core/lib/packages/config-types.ts` — `search` on `PackageEntry`
- `scripts/gen-config.ts` — emit the lazy adapter module thunk
- `scripts/load-manifest.ts` — validate `search.adapter` via `assertSafeImportField`
- `core/server/fts/config.go` — `Scope` interface, `MemberScope`, `ExcludeField`
- `core/server/fts/search.go` — scope via interface, disabled check, exclude clause
- `core/server/fts/sanitize.go` — emit FTS5 `NOT` for excluded terms
- `core/server/fts/register.go` — accept the `not` query param
- `core/server/fts/search_test.go`, `sanitize_test.go` — `Scope:` rename, member/disabled/exclude
  cases, negation cases

**Contacts** — `server/register.go` (`Owner:` → `Scope:`), `manifest.ts`, `package.json` exports,
`tinycld/contacts/search-adapter.ts`

**Drive** — `manifest.ts`, `package.json` exports, `tinycld/drive/search-adapter.ts`,
`server/search.go` (negation in its own `sanitizeFTSQuery` copy)

**Mail** — `manifest.ts`, `package.json` exports, `tinycld/mail/search-adapter.ts`,
`server/search.go` (negation in **both** UNION arms), `server/endpoints_search.go` (`not` param)

**Cards — new**
- `pb-migrations/1980000002_create_fts_cards.js`
- `server/search_scope_test.go`
- `tinycld/cards/search-adapter.ts`
- `tests/search-adapter.test.ts`

**Cards — modified**
- `server/register.go` — fts config + `fts.Register`
- `manifest.ts`, `package.json` exports

**Root** — `tests/e2e/search-palette.spec.ts` (cross-package, so it lives at the workspace root
rather than in one member)

---

## Verification

**Unit (vitest, core):**
- `parse-query.test.ts` — chips: `mail:` becomes a chip; `budget:` stays literal text; `mail`
  without a colon stays text (**the regression test for the "mail server migration" case**);
  Backspace on empty text pops the trailing chip; a duplicate chip is a no-op that still consumes
  the word; label and slug both match. Negation: `budget -draft` splits into include/exclude;
  `budget-2026.xlsx` stays **one literal term** (the mid-token hyphen case); a leading `-` with no
  attached term is dropped; `-draft` alone yields an empty include set. Operators: `&&`, `||`,
  `!`, `AND`, `OR`, `NOT`, quotes and parens are stripped from the text.
- `score.test.ts` — an exact title match outranks a prefix, a prefix outranks a substring, and a
  subtitle-only match outranks a body-only (tier 0) hit; **a tier-5 hit from a low-`nav.order`
  package outranks a tier-1 hit from a high-`nav.order` one** (the case that motivated scoring);
  shorter title wins within a tier; equal titles fall through to package rank then `nav.order`;
  the function is deterministic for a fixed input set regardless of insertion order.
- `build-sections.test.ts` — zero chips yields a flat score-ordered list with package badges; one
  chip yields a flat list with no badges; 2+ chips yields groups ordered by `nav.order`; a package
  with zero hits contributes no section.

**Unit (vitest, per package):** each `search-adapter.test.ts` asserts `toRow` maps that package's
real response shape to a `SearchRow`. Cards additionally: a hit whose project is not synced is
skipped.

**Go (from `cards/server`, `go test -count=1` — the cache does not invalidate on migration
changes):** `search_scope_test.go`, modeled on `drive/server/search_disabled_test.go` (a minimal
hand-built schema, not `rlstest` — raw SQL bypasses the rule engine): a member finds their own
project's cards; a non-member gets zero; a **removed** member gets zero (proves the scope is a
live subquery, not a cached grant); a `disabled` member gets zero; an archived card is excluded; a
member of two projects gets correct `project` values on each hit. Also update `core/server/fts`
tests for the `Scope` rename.

**Go (negation):** `core/server/fts/sanitize_test.go` — an excluded term emits FTS5 `NOT`; an
empty exclude list emits the query unchanged; an exclude-only query returns `""` rather than
malformed SQL. In `mail/server`, a test that **a term excluded from a thread-arm match is not
resurrected by the message arm** — a negation applied to only one side of the UNION silently
returns the rows the user asked to exclude, which is the single most likely way this feature ships
broken.

**E2E (playwright, driving the UI — no `page.goto` for in-app navigation, no raw PB writes; use
`tinycld/tests/e2e/helpers.ts` + `login`/`navigateToPackage`):**

- `/` from cards opens the palette pre-seeded with a `cards` chip.
- Backspace clears the chip; a query then returns grouped results from more than one package.
- Typing `drive:` creates a chip and narrows results to drive alone.
- Two chips (`drive:` `mail:`) return groups from exactly those two packages.
- Typing a package name **without** a colon does not create a chip and searches it as text.
- Selecting a cards result switches the active board and opens the card peek.
- Selecting from inside a cards `[cardId]` page navigates to the board first and opens the correct
  card (the `router.replace` ordering case).
- Escape closes without navigating.
- `/` typed inside a card title editor does **not** open the palette.
- With no chips, a seeded item whose **title exactly matches** the query appears first, above a
  package that would sort earlier by `nav.order` — the end-to-end proof that scoring beats
  rail order.
- `budget -draft` returns an item titled "budget" and excludes one titled "budget draft".
- A hyphenated query (`budget-2026`) still finds the hyphenated item — negation did not eat the
  hyphen.
- **The selection survives a re-sort:** with results arriving from several packages, select a row,
  then assert the same row is still selected once the slowest package resolves and reorders the
  list.

Wait on the `/api/*/search` response or poll — **never** a fixed `waitForTimeout`, since
`useApiSearch` debounces 300ms and a bare timeout will flake under CI load. Leave a comment saying
so.

**Full gate:** `pnpm exec tinycld-pkg check` in each touched member; `go build` + `go test
-count=1` in `cards/server` and `tinycld/core/server/fts`; `pnpm run pkg:check` and `pnpm run
lint` at the root; `pnpm run packages:generate` from `tinycld/` after manifest changes.

**Help:** new `tinycld/core/help/search.md` (frontmatter `title`/`summary`, tags `[search,
keyboard, packages]`) covering `/`, the `:` grammar, multiple chips, Backspace-to-widen, `-term`
exclusion, and an explicit statement that `AND`/`OR`/quotes are not supported (so their absence
reads as a decision rather than a bug). Mac glyphs only (⌘ ⇧ ⌥) — the renderer substitutes per
platform. Cross-link from each package's existing help topic where one exists.

---

## Rejected alternatives

**Migrating mail onto `core/fts`.** Considered and rejected. `core/fts` is ~150 lines of "config
in, safe SQL out". Mail's search is 721 lines across `search.go` + `endpoints_search.go` and
depends on: two FTS tables unioned with different per-side queries; `snippet()`/`highlight()`
columns, which `search.go:63` explicitly refuses to emit on XSS grounds; a second structured-filter
code path (`handleStructuredSearch`, `from:`, `has:attachment`, folder scoping); and thread
aggregation with a `COUNT(*)` message count. Absorbing that would roughly quadruple `core/fts` and
force three simple callers to carry mail's complexity — including reintroducing the highlight
surface core deliberately refuses. The adapter seam gets the same palette behavior for ~20 lines.

**A declarative `href` in the adapter.** Cannot express cards' ordered store mutations or drive's
folder-navigation-plus-selection. See "The adapter contract".

**Cross-package ordering by BM25.** Rejected because FTS5's BM25 weights terms by inverse document
frequency over *each table's own* corpus, so scores from different tables are denominated in
different units — a package with a small, topic-dense corpus systematically scores lower on its
own subject matter. Three routes to genuine comparability were considered:

1. *Normalize per table* (divide by that table's top score). Cheap, but it is a rank transform,
   not a relevance one: it forces every package's best hit to 1.0, including a package whose best
   hit is poor. That is the exact failure the scoring is meant to prevent, merely relocated.
2. *Recompute IDF globally* — a corpus-wide term-frequency table synced on every write across all
   packages, with rescoring outside FTS5 (`bm25()` accepts no injected statistics). Mathematically
   correct and a substantial subsystem. It also breaks the lean-shell guarantee: global IDF varies
   with which packages are installed, so the same query ranks differently per workspace.
3. *One shared FTS table for all packages.* Genuinely comparable, but collapses per-package
   schemas (mail indexes `body_text`, cards `description`, drive `content`), forces a single
   tokenizer, and makes the seam `core/fts` adoption after all — which mail cannot do.

Options 2 and 3 are each larger than the rest of this feature. More fundamentally, BM25 answers
the wrong question here: it ranks a large corpus by term rarity when the documents cannot be
inspected, whereas the palette holds ~25 already-relevant rows per package with their text in
hand. BM25 is retained where its scores *are* comparable — within a package, as the recall
mechanism and an intra-tier tie-breaker.

**Full boolean operators (`AND`/`OR`/parentheses).** Rejected. Every intermediate keystroke of an
incomplete expression (`foo AND `) must do something sensible under search-as-you-type, passing
raw syntax to FTS5 turns parse errors into user-facing failures, and it re-opens the injection
surface `sanitize.go` exists to close. `-term` covers the common case at a fraction of the cost.

**A permanent filter-chip row under the input.** The conventional answer, rejected for three
reasons: it costs a permanent UI row in a surface whose whole premise is keyboard speed; it wraps
badly past ~5 installed packages; and expressing "drive OR mail" by clicking raises an
AND/OR ambiguity that two typed chips do not.

**Auto-tokenizing a package name without `:`.** Makes package names unsearchable as text. Rejected
— this was a real bug in an earlier draft of this design.

**Inline `drive:` autocomplete while typing.** Deferred. The state-dependent footer already
teaches the gesture, and inline completion inside a field that is also free-text search is a known
source of accidental-tokenization bugs.

**Persisting the last-used scope.** Rejected: the palette's behavior would become unpredictable
across sessions — a user could not know what `/` will do before pressing it.

---

## Open questions / risks

1. **Adapter module loading under Metro.** The generator emits `() => import(pkg/search-adapter)`
   without a `lazy()` wrapper — a pattern not currently used anywhere in the generated config.
   Verify early that Metro resolves it and that the suspense-free caching path works on web.
2. **`Config.Owner` → `Config.Scope` is a breaking rename** on a shared core type. Only contacts
   calls it today, but coordinate merge order if anything else is mid-flight on `core/fts`.
3. **Fan-out cost** with zero chips scales linearly with packages declaring `search`. Fine at four;
   revisit past roughly eight.
4. **Scoring depends on adapter row quality.** `scoreRow` reads `title`/`subtitle`/`meta`, so an
   adapter that puts weak text in `title` ranks its package badly through no fault of the
   backend. Each adapter should map the field a user would recognize as the item's name into
   `title` — file name, subject, card title, contact name — and this belongs in the adapter
   contract's documentation.
5. **Tier 0 sizing.** Mail and drive match bodies and file content, so under a broad query a large
   share of hits may be tier 0 and sort below everything visible. If that reads as "mail results
   are always last", the fix is per-package result caps before scoring, not a tier reshuffle.
6. **Negation across mail's UNION** is the most likely way this ships subtly broken — see the
   named test under Verification.
7. **Backfill on a large `cards_cards`** — the `INSERT ... SELECT` runs synchronously during
   migration. Fine at kanban scale, no batching proposed; watch deploy timing.
8. **`/` ownership.** Core claims `/` globally. If a package later wants `/` for an in-context
   search of its own, it must use a different key or opt into the palette. Worth stating in the
   help topic so the convention is explicit.
9. **Core version bump.** Cards declares `peerVersions: { '@tinycld/core': '>=0.0.4 <0.1.0' }`.
   New core files land under existing wildcard exports and the Go change goes through `go.work`'s
   local replace, so no manifest edit should be needed as long as core stays in `0.0.x`. The
   manifest `search` field is additive and optional, so older packages remain valid. Confirm
   against the release process before assuming it is skippable.
10. **Existing per-package search UI** (mail's `SearchBar`, drive's search field, contacts' search)
   is untouched by this batch and coexists with the palette. Whether the palette should eventually
   replace any of them is deliberately left open.
