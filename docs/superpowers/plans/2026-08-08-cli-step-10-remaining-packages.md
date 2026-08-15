# CLI Step 10 — contacts, calendar, text, calc

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.
> Tick a step only after its verification command actually passed.

**Goal:** Finish the last unbuilt step of the CLI design spec — command groups
for the four remaining packages — plus the vCard/iCal file export the spec
assumed was free and is not.

**Spec:** `docs/superpowers/specs/2026-08-05-tinycld-cli-design.md` (Part 6,
build order step 10).

## Status of the spec before this plan

Audited against the tree, not assumed:

| Spec step | State |
|---|---|
| 1 OAuth core | done (`core/server/oauth/`) |
| 2 Consent + revocation UI | done |
| 3 CLI skeleton | done (`tinycld/cli/`) |
| 4 Manifest + generator | done (`gen-cli.ts`) |
| 5 Typed API payloads | done (`gen-payload-types.ts` + test) |
| 6 drive commands | done (18 commands) |
| 7 mail commands | done (14 commands) |
| 8 Build + distribution | done (`coreserver/cli_downloads.go`, About panel) |
| 9 Auth Code + PKCE | done (`authorize.go`, `pkce.go`, 27 tests) |
| **10 contacts/calendar/text/calc** | **not started — this plan** |

Also shipped after the spec was written, and load-bearing here: the federated
search aggregator (`core/server/search/`) and `tinycld search`
(`docs/superpowers/plans/2026-08-07-cross-package-search-palette.md`).

**A FIFTH package group shipped a CLI after this plan was written and is not in
any task list below: `cards`** (`cards/cli/` — board/card/list commands, a `cli`
manifest block, `cards/help/command-line.md`, scope entries in the middleware).
It is the most recent worked example of the whole pattern — prefer it over
`mail`/`drive` when copying. So the remaining work is FOUR packages, not five,
and Task 10's smoke test below has now been done for the four groups that ship
today (`search`, `drive`, `mail`, `cards`).

Task 1's premise has also already been satisfied twice over: the stale
`GET /api/contacts/search` entry the plan asks Task 4 to delete is **already
gone** from `oauth/middleware.go`, and the Task 3 scope entries
(`GET /api/contacts/export`, `POST /api/contacts/import`) are **already in the
table** — ahead of the Task 2 endpoints they guard, which do not exist yet
(`contacts/server/register.go` binds no HTTP routes). Re-audit before starting;
do not assume the task order below still matches the tree.

## Two places the spec is wrong

**1. `contacts search` has no package route.** The spec says
`/api/contacts/search`. That route was deliberately removed —
`contacts/server/register.go:111` calls `fts.RegisterSync` *instead of*
`fts.Register`, with a comment stating both the palette and the CLI read the
federated `/api/search`. Contacts' rows already arrive normalized, and
`search_source.go` puts `first_name`, `last_name`, `email`, `phone`, `company`,
`favorite` into `Fields` precisely so a client can render a table without a
package-specific shape.

> Stale leftover: `core/server/oauth/middleware.go:121` still maps
> `GET /api/contacts/search` in the route→scope table. It guards nothing.
> Task 4 removes it.

**2. `contacts export --vcard` / `import` is not "repeat the pattern."** The
vCard codec lives in `core/server/carddav/vcard_codec.go`, was unexported, and
takes `*core.Record`. The CLI module has no `tinycld.org/core` dependency (by
design — `gen-cli.ts` documents it), and CardDAV is Basic-Auth only, mounted
outside the API router. So file export/import needs server endpoints. The same
is true of `calendar export --ics` (`caldav/ical_codec.go`, same shape, same
unexported functions).

**Task 1 is already committed** (`c75c610` on `tinycld` branch
`feat/contacts-vcard`): `RecordToVCard` / `ApplyVCardToRecord` are exported and
proven reachable from `contacts/server`.

---

## Global constraints

- **Never bypass pbtsdb** for PocketBase data in app/TS code. CLI commands are
  pure HTTP clients — PB record REST for CRUD, typed routes only where the
  logic cannot be reached otherwise (the spec's own rule).
- **The CLI module must not import `tinycld.org/core`.** Duplicate a small
  struct or reimplement a pure helper instead (`output.FormatBytes` and the
  `search.Response` mirror in `cli/search.go` are the precedents). If a shared
  contract drifts, that is a runtime failure — keep mirrored structs minimal
  and comment the source.
- **Raw routes bypass collection rules.** Every new route needs an entry in
  `oauth/middleware.go`'s route→scope table AND a disabled-user check, or a
  token with no relevant scope reads data it should not. This is the hole the
  FTS work had to close twice.
- **Go tests: `go test -count=1`** (the cache does not invalidate on migration
  changes).
- Cross-repo: `tinycld` (core) must merge before any member that depends on new
  core symbols. Each member is its own repo and its own PR.
- **Never use biome-ignore comments; never use `any`.**
- Commit messages and PR bodies: no mention of Claude.

## Task sequencing

| Tasks | What | Depends on |
|---|---|---|
| 1 | Export the carddav codec | **done** (`c75c610`) |
| 2–3 | contacts export/import endpoints + scopes | 1 |
| 4 | contacts CLI (8 commands) | 2–3 merged |
| 5 | Export the caldav codec | — |
| 6–7 | calendar ICS endpoints + scopes | 5 |
| 8 | calendar CLI | 6–7 merged |
| 9 | text + calc CLI | — (independent) |
| 10 | Live smoke test + help topics | everything |

Tasks 5–8 mirror 1–4 exactly. Task 9 is independent of both and is the
cheapest; do it first if you want something shippable early.

---

### Task 2: contacts export/import endpoints

**Files:**
- Create: `contacts/server/vcard_endpoints.go`
- Test: `contacts/server/vcard_endpoints_test.go`
- Modify: `contacts/server/register.go` (bind the routes)

**Interfaces:**
- Consumes: `carddav.RecordToVCard`, `carddav.ApplyVCardToRecord`,
  `cardDAVSource.VCard` (Task 1)
- Produces: `GET /api/contacts/export`, `POST /api/contacts/import`

**Decisions, settled:**
- **Per-user, always.** Both endpoints scope to `owner = <caller>` +
  `deleted_at = ''`, mirroring `cardDAVSource.ListFilter`. There is no
  admin-wide export; a user exports their own address book.
- **Import upserts on `vcard_uid`.** Re-importing your own export must not
  duplicate every contact. A card with no UID gets one generated, matching the
  existing create hook (`register.go:125`).
- **Import is per-card fault tolerant.** A malformed card is counted and
  reported, not fatal — but the response names what failed, so nothing is
  silently dropped.

- [ ] **Step 1: Write the failing test**

Cover, at minimum:
- export returns `text/vcard` and one VCARD block per contact
- export excludes another user's contacts (the security case)
- export excludes soft-deleted contacts
- import creates a new contact from a card
- import with a known `vcard_uid` UPDATES rather than duplicating
- import reports a malformed card without failing the whole request
- a disabled user gets nothing from either

Model the app wiring on `drive/server/search_disabled_test.go` (hand-built
minimal schema — raw SQL/route tests bypass the rule engine, so `rlstest` is
the wrong tool).

- [ ] **Step 2: Run the test, confirm it fails for the right reason**

`cd contacts/server && go test ./ -run VCard -count=1`
Expected: FAIL — endpoints undefined. (Not a compile error in the test itself.)

- [ ] **Step 3: Implement the endpoints**

Bind in the existing `OnServe` block beside the CardDAV mount, following
`drive/server/register.go:129`'s shape. Both `Bind(apis.RequireAuth())`.
Reuse `cardDAVSource.VCard` — never re-declare the field map.

- [ ] **Step 4: Verify**

`cd contacts/server && go build ./... && go test ./... -count=1` → PASS

- [ ] **Step 5: Commit** (`feat(contacts): export and import vCard files`)

---

### Task 3: contacts route scopes

**Files:**
- Modify: `tinycld/core/server/oauth/middleware.go`
- Test: `tinycld/core/server/oauth/middleware_test.go`

Without this, the Task 2 routes are reachable by any authenticated token
regardless of grant — raw routes never run collection rules.

- [ ] **Step 1: Add the failing test** — a `contacts:read`-only token may
  export but NOT import; a `contacts:write`-only token the reverse.
- [ ] **Step 2: Add the table entries**

```go
"GET /api/contacts/export":  {ScopeContactsRead},
"POST /api/contacts/import": {ScopeContactsWrite},
```

- [ ] **Step 3: Verify** — `cd tinycld/core/server && go test ./oauth/ -count=1`
- [ ] **Step 4: Commit**

---

### Task 4: contacts CLI

**Files:**
- Create: `contacts/cli/` — `register.go`, `list.go`, `search.go`, `show.go`,
  `add.go`, `edit.go`, `rm.go`, `transfer.go` (export+import), `commands_test.go`,
  `testserver_test.go`, `go.mod`
- Modify: `contacts/manifest.ts` (add the `cli` block)
- Modify: `tinycld/core/server/oauth/middleware.go` (delete the stale
  `GET /api/contacts/search` entry)

**Command surface** (spec Part 6, corrected):

```
contacts list            --favorites --limit
contacts search <query>  --limit          # -> /api/search?pkg=contacts
contacts show <id>
contacts add             --first --last --email --phone --company --title --notes
contacts edit <id>       (same flags)
contacts rm <id>                          # soft delete: sets deleted_at
contacts export          [--out FILE]
contacts import <file.vcf>
```

**Manifest block** (mirrors mail's):

```ts
cli: {
    package: 'cli',
    module: 'tinycld.org/packages/contacts/cli',
    scopes: ['contacts:read', 'contacts:write'],
},
```

- [ ] **Step 1: Write the failing tests** against a fake server
  (`drive/cli/testserver_test.go` is the model). Cover: `search` targets
  `/api/search?pkg=contacts`; `rm` soft-deletes rather than DELETEs; `add`
  round-trips flags into a record; `export --out` writes a file.
- [ ] **Step 2: Confirm failure**
- [ ] **Step 3: Implement.** Reads/writes via `client.ListRecords` /
  `CreateRecord` / `UpdateRecord`; `search` via the federated endpoint,
  rendering from `Fields`.
- [ ] **Step 4: Regenerate + verify**

```sh
cd tinycld && pnpm run packages:generate
cd contacts/cli && go build ./... && go test ./... -count=1
cd tinycld/cli && go build ./... && go test ./... -count=1
```

- [ ] **Step 5: Commit** (contacts repo + the middleware cleanup in tinycld)

---

### Task 5: Export the caldav iCal codec

**Files:**
- Modify: `tinycld/core/server/caldav/ical_codec.go` (+ call sites, tests)

Identical to Task 1: `recordToCalendar` → `RecordToCalendar`,
`applyCalendarToRecord` → `ApplyCalendarToRecord`. Behavior unchanged; the
rename is the whole diff.

- [ ] **Step 1: Baseline** — `go test ./caldav/ -count=1` PASSES first
- [ ] **Step 2: Rename definitions + all call sites**
- [ ] **Step 3: Verify** — `go build ./... && go vet ./caldav/ && go test ./caldav/ -count=1`
- [ ] **Step 4: Prove reachability from `calendar/server`** (a throwaway test
  referencing both symbols; delete it after)
- [ ] **Step 5: Commit**

---

### Task 6: calendar ICS endpoints

Mirrors Task 2. `GET /api/calendar/export?calendar=<id>` → `text/calendar`,
`POST /api/calendar/import`.

**Open question to settle before implementing:** calendar events are scoped by
calendar membership, not a single `owner` field — check
`calendar/server/register.go`'s caldav Source `ListFilter` and mirror it
exactly rather than assuming per-user.

- [ ] **Step 1: Read the caldav Source and record the real scope rule here**
- [ ] **Step 2: Failing test** (same coverage list as Task 2, plus: an event on
  a calendar the caller is not a member of must not export)
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `cd calendar/server && go test ./... -count=1`
- [ ] **Step 5: Commit**

---

### Task 7: calendar route scopes

Mirrors Task 3, with `ScopeCalendarRead` / `ScopeCalendarWrite`.

- [ ] **Step 1: Failing test** · **Step 2: Table entries** · **Step 3: Verify** ·
  **Step 4: Commit**

---

### Task 8: calendar CLI

```
calendar agenda   --days 7
calendar list
calendar events   --from --to
calendar show <id>
calendar add      --title --start --end --all-day --location --guest --recurrence
calendar rm <id>
calendar rsvp <id> yes|no|maybe
calendar export [--ics] [--out FILE] | import <file.ics>
```

**Note:** the spec says `contacts add` / `calendar add` with no flags drop into
a Huh form. Defer that — every shipped command is flag-driven and non-interactive,
and `--yes` exists precisely so commands run in CI. Add the form only if asked.

- [ ] Steps mirror Task 4.

---

### Task 9: text + calc CLI

Smallest surface; independent of every other task. Documents and workbooks live
in `drive_items` (drive already owns those commands) — these packages own only
their comment collections.

```
text new <name> | cat <path> | comments <path> [add|resolve]
calc new <name> | comments <path>
```

- [ ] Steps mirror Task 4, minus the export/import work.

---

### Task 10: Live smoke test + help topics

**This is the task that has never been done for ANY CLI command**, including
the shipped `search`, `mail`, and `drive` groups. Every test to date runs
against a fake HTTP server. The contract structs in `cli/` are hand-mirrored
from server types (the module boundary keeps them out of reach — see
`gen-cli.ts`), so a field-name drift compiles cleanly and fails only at runtime.

- [x] **Step 1: Boot a real server** — `cd tinycld && pnpm run dev`
      (API is on **7101**, not 8090 — the spec was wrong; now corrected.)
- [x] **Step 2: `tinycld auth login localhost:7101`** — works. Approval is
      `POST /oauth/authorize/approve` with a **form-encoded** body, not
      `POST /oauth/authorize` (that one is Zapier's and answers
      "Unknown client_id").
- [x] **Step 3: Exercise every SHIPPED group against real data** — `search`,
      `drive` (ls/tree/search/usage/put/get/rm), `mail` (list/search/mailboxes),
      `cards` (board list/view, card view), `--json`. `drive put` → `drive get`
      round-trips byte-identical. `contacts` was not exercised: it ships no CLI
      (that is Tasks 2–4, still not started).
- [x] **Step 4: Fix whatever drifted** — three real bugs, none of them the
      predicted field-name mismatch:
  1. **`mail_domains` unclassified in the OAuth scope table** → default-deny
     403 broke `mail send`, `mail mailboxes`, and `--mailbox <address>`. The
     stored address is only a local part, so every full address joins that row.
     Fixed read-only + test.
  2. **`cards:*` missing from `cliScopes` AND the seed migration** → `tinycld
     cards` 403'd everywhere, and `tinycld search` silently omitted cards
     results (the aggregator narrows to covered scopes rather than erroring).
     Fixed in both, plus an APPENDED migration to widen already-provisioned
     databases.
  3. **`cards board view PL` said "not found"** though `board list` prints `PL`
     under a column headed KEY. `resolveProject` matched ids and names only.
     Fixed (key ordered before names) + 2 tests. The fixture never set `Slug`,
     so the fake server shared the resolver's blind spot.

  **The lesson for the four remaining packages:** the predicted failure mode
  (mirrored-struct field drift) did not appear. What did was the *scope plumbing*
  — three of four bugs were a collection or scope missing from a hand-maintained
  list, invisible to a fake server that has no scope layer at all. Tasks 3 and 7
  are the highest-risk steps in this plan, not the boilerplate they look like.
- [ ] **Step 5: Help topics** — `contacts/help/command-line.md` and
  `calendar/help/command-line.md`, following `drive/help/command-line.md`.
  Cross-link from `core/help/command-line.md`'s "Package commands" section.
- [ ] **Step 6: Full gate**

```sh
cd tinycld && pnpm run packages:generate && pnpm run lint && pnpm exec tinycld-pkg check
cd tinycld/core/server && go test ./... -count=1
for m in contacts calendar text calc; do (cd $m/server && go test ./... -count=1); done
for m in contacts calendar text calc; do (cd $m/cli && go test ./... -count=1); done
```

- [ ] **Step 7: Update the spec** — correct Part 6's contacts section (no
  package search route; export/import needs endpoints) so the design doc stops
  misleading the next reader.

---

## Notes for the implementer

**Do Task 10's smoke test EARLY if you can** — ideally right after Task 4, not
at the end. It is the only thing that can catch a mirrored-struct drift, and
finding it after four packages have copied the pattern is four times the fix.

**The route→scope table is the security boundary.** Raw routes never run
PocketBase collection rules, so a missing table entry is not a lint issue — it
is a token reading data its grant does not cover. Tasks 3 and 7 are not
optional polish.

**Cross-repo ordering repeats the search-CLI shape:** core (`tinycld`) merges
first, members after. Task 4 additionally touches `tinycld` (the stale
middleware entry) — that can ride in the Task 3 PR instead if you prefer one
core PR.
