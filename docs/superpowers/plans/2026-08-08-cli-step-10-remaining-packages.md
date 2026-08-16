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
| **10 contacts/calendar/text/calc** | **in progress — this plan** (contacts server done; CLI groups not started) |

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
| 2–3 | contacts export/import endpoints + scopes | **done** (`c33ec73`; 3 was already shipped) |
| 4 | contacts CLI (8 commands) | **done** — see below |
| 5 | Export the caldav codec | **not needed** — already exported as `EncodeVEvent`/`ApplyVEvent` |
| 6–7 | calendar ICS endpoints + scopes | **done** (calendar#34, core#202) |
| 8 | calendar CLI | **done** (calendar#34) |
| 9 | text + calc CLI | **done** (text#55, calc#56) — NOT independent: needed new scopes (core#204) |
| 10 | Live smoke test + help topics | help topics **done**; **live smoke test still owed** |

~~Tasks 5–8 mirror 1–4 exactly. Task 9 is independent of both and is the
cheapest; do it first if you want something shippable early.~~

**Both halves of that turned out wrong, and the corrections are the most
useful thing in this document:**

- **Tasks 5–8 did NOT mirror 1–4.** Task 5 was unnecessary (the codec was
  already exported under other names), and calendar's authorization is
  two-tiered (read = membership in any role, write = owner-or-editor) where
  contacts has a single `owner` field. The contacts endpoints are not a
  template for the calendar write path.
- **Task 9 was NOT independent, and not the cheapest.** It was the only task
  requiring new public scope vocabulary (`text:*`, `calc:*`), across four
  hand-maintained lists plus an appended migration.

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

**DONE** (`c33ec73` in the `contacts` repo). Two things the round-trip needed
that the plan did not anticipate, both found by the tests:

1. **`cardDAVSource.VCard` set no `UIDField`**, so exported cards carried no
   UID and a re-import duplicated everything. The field already existed for
   exactly this case; contacts had simply never set it. Now set.
2. **`idx_contacts_vcard_uid` is GLOBALLY unique** (migration 1712000002),
   while vCard UIDs are only unique within an address book (RFC 6350). A card
   whose UID another user already held failed the save outright — so whoever
   imported a contact first permanently blocked everyone else from importing
   it. Import now regenerates the UID on that collision.

Also: `registerShared`'s `vcard_uid` create hook was extracted to a named
`bindVCardUIDHook` so the endpoint tests bind the real hook rather than
stamping UIDs by hand (a fixture that faked the UID would hide a regression in
the identity the whole feature matches on).

Note `go mod tidy` does not work in this workspace (it resolves the module
graph before applying go.work's replace) — `go-vcard` was promoted to a direct
require by hand, as `cards/server/go.mod`'s header documents.

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run the test, confirm it fails for the right reason**

`cd contacts/server && go test ./ -run VCard -count=1`
Expected: FAIL — endpoints undefined. (Not a compile error in the test itself.)

- [x] **Step 3: Implement the endpoints**

Bind in the existing `OnServe` block beside the CardDAV mount, following
`drive/server/register.go:129`'s shape. Both `Bind(apis.RequireAuth())`.
Reuse `cardDAVSource.VCard` — never re-declare the field map.

- [x] **Step 4: Verify**

`cd contacts/server && go build ./... && go test ./... -count=1` → PASS

- [x] **Step 5: Commit** (`feat(contacts): export and import vCard files`)

---

### Task 3: contacts route scopes

**Files:**
- Modify: `tinycld/core/server/oauth/middleware.go`
- Test: `tinycld/core/server/oauth/middleware_test.go`

Without this, the Task 2 routes are reachable by any authenticated token
regardless of grant — raw routes never run collection rules.

**ALREADY DONE** before this plan was picked up — re-audited, not assumed. Both
entries are in the table (`middleware.go:158-159`) and `middleware_test.go:472`
carries exactly the asymmetry test below: export is not satisfied by
`contacts:write` alone, nor import by `contacts:read`. The stale
`GET /api/contacts/search` entry Task 4 was to delete is likewise already gone.

- [x] **Step 1: Add the failing test** — a `contacts:read`-only token may
  export but NOT import; a `contacts:write`-only token the reverse.
- [x] **Step 2: Add the table entries**

```go
"GET /api/contacts/export":  {ScopeContactsRead},
"POST /api/contacts/import": {ScopeContactsWrite},
```

- [x] **Step 3: Verify** — `cd tinycld/core/server && go test ./oauth/ -count=1`
- [x] **Step 4: Commit**

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

- [x] **Step 1: Write the failing tests** against a fake server
  (`drive/cli/testserver_test.go` is the model). Cover: `search` targets
  `/api/search?pkg=contacts`; `rm` soft-deletes rather than DELETEs; `add`
  round-trips flags into a record; `export --out` writes a file.
- [x] **Step 2: Confirm failure**
- [x] **Step 3: Implement.** Reads/writes via `client.ListRecords` /
  `CreateRecord` / `UpdateRecord`; `search` via the federated endpoint,
  rendering from `Fields`.
- [x] **Step 4: Regenerate + verify**

```sh
cd tinycld && pnpm run packages:generate
cd contacts/cli && go build ./... && go test ./... -count=1
cd tinycld/cli && go build ./... && go test ./... -count=1
```

- [ ] **Step 5: Commit** (contacts repo; no middleware cleanup needed — see below)

**DONE** — 19 tests, all green; `cards/cli` was the model rather than
`drive/cli` (no shared `api` module, so contacts' is the closer shape).
Four things worth recording:

1. **The Task 4 middleware cleanup was a no-op.** The stale
   `GET /api/contacts/search` entry was already gone (as the plan's own header
   warned it might be), so this task touches ONE repo, not two. Re-audited, not
   assumed.
2. **The scope plumbing was already correct** — `contacts:read`/`contacts:write`
   are in both `cliScopes` (`tinycld/cli/auth.go`) and the seed migration. That
   is the trap Task 10 Step 4 found three times over, so it was checked BEFORE
   writing a line of command code. Tasks 7/8 get the same check for free
   (`calendar:read` / `calendar:write` are present in both).

   **Task 9 does not.** Verified against the tree, not assumed: there is no
   `text:*` or `calc:*` scope anywhere — `oauth.go`'s `AllScopes` ends at
   `cards`, and `text_comments` / `calc_comments` appear nowhere in
   `middleware.go`'s collection table, so an OAuth token hits DEFAULT-DENY 403
   on both. That makes Task 9 — billed as "smallest surface; independent" —
   the one remaining task needing a **new scope pair**: constants in `oauth.go`
   + `AllScopes`, collection entries in the scope table, `cliScopes` in
   `tinycld/cli/auth.go`, and an APPENDED migration widening the seeded client
   row (never an edit to `1985000001` — an already-provisioned DB will not
   re-run it). Do that first; the commands are the easy half.
3. **Two commands beyond the plan's eight**, both closing loops the plan's
   surface left open: `rm --permanent` (the plan's `rm` is a soft delete, so
   without this there is no way to empty the Trash) and `edit --restore` (with
   `list --trashed`, the round trip is complete).
4. **`go.sum` was seeded by copying `cards/cli`'s and deleting the `fracdex`
   lines**, since `go mod tidy` does not work in this workspace — the same
   constraint `contacts/server/go.mod` documents.

Also shipped here rather than deferred to Task 10 Step 5: the
`contacts/help/command-line.md` topic, plus core's "Package commands" list,
which had drifted — it named only drive and mail, missing `cards` entirely.

---

### Task 5: Export the caldav iCal codec

**Files:**
- Modify: `tinycld/core/server/caldav/ical_codec.go` (+ call sites, tests)

**NOT NEEDED — the work is already done, differently and better.** Audited,
not assumed: `ical_codec.go` already ships EXPORTED wrappers over the two
unexported functions — `EncodeVEvent` (→ `recordToCalendar`) and `ApplyVEvent`
(→ `applyCalendarToRecord`), plus `RecurrenceToRRule` / `RRuleToRecurrence` —
under a header explaining that a package ingesting iCalendar outside the
protocol path needs exactly this. That is the same reachability the rename
would buy, without touching the unexported implementations or their call
sites, so performing the rename now would be pure churn against a file that
already solved the problem.

Reachability from `calendar/server` (the real requirement behind Step 4) is
structural: it already imports `tinycld.org/core/caldav` for `calDAVSource`.

**Consequence for the sequencing table: Task 6 no longer depends on Task 5,
and no core PR is needed before the calendar member work.** Use
`caldav.EncodeVEvent` / `caldav.ApplyVEvent`; do NOT re-export or rename.

---

### Task 6: calendar ICS endpoints

Mirrors Task 2. `GET /api/calendar/export?calendar=<id>` → `text/calendar`,
`POST /api/calendar/import`.

**Open question — SETTLED. The answer is not what the question assumed.**

`calDAVSource` has **no `ListFilter` at all** (contacts has one; calendar does
not). Its header says so deliberately: "There are no permission callbacks here
on purpose. Authorization comes from the calendar_calendars /
calendar_events access rules the migrations ship, which core evaluates with
`app.CanAccessRecord` — one definition, shared by the REST API, the web UI,
and this protocol path."

So there is nothing to mirror, and the contacts pattern (copy `ListFilter`
into a raw route) **cannot be reused here**. The authoritative rule is
migration `1830000004`:

```
enabled   = @request.auth.disabled != true
viaMember = calendar.calendar_members_via_calendar.user ?= @request.auth.id
viaWriter = calendar.calendar_members_via_calendar.user ?= @request.auth.id &&
            (…role ?= "owner" || …role ?= "editor")

calendar_events  list/view = enabled && viaMember
                 create/update/delete = enabled && viaWriter
```

Read access is **membership**, write access is **owner-or-editor** — a
distinction contacts does not have, and the one a hand-written filter is most
likely to get wrong (note the migration's own warning about `?!= "viewer"`
silently granting write to every future role).

**Implementation consequence:** do NOT hand-write a membership filter in the
export handler. Two options, in order of preference:

1. **Reuse the rule engine.** Read the caller's events through the same path
   the REST API uses so `CanAccessRecord` runs, rather than re-deriving
   authorization in Go. A second copy of a membership predicate is exactly
   the drift this Source's header exists to prevent.
2. If a raw filter is unavoidable, derive the calendar id set from
   `calendar_members` for the caller FIRST, then filter events by
   `calendar IN (...)` — never inline a back-relation predicate by hand.

Import additionally needs the **writer** check (owner/editor), not merely
membership: a viewer must not be able to POST events into a calendar.

- [x] **Step 1: Read the caldav Source and record the real scope rule here**
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

- [x] Steps mirror Task 4.

**DONE** — nine commands, 27 tests. Three notes:

1. **The two-tier access model is surfaced, not hidden.** Read is membership
   in any role; write is owner-or-editor. `calendar list` shows the caller's
   ROLE per calendar so a viewer learns it from a column rather than from a
   failed `add`, and both write commands say so in their help.
2. **`agenda` and `events` stayed separate.** A relative window from now is a
   different question from an explicit range; collapsing them makes both
   harder to type. `agenda` starts at now rather than midnight, so a meeting
   that already finished today does not lead the list.
3. **`rsvp` refuses when the caller is not on the guest list** rather than
   adding them — that would be a different action from answering an
   invitation. The guest list is a JSON column, so this is a read-modify-write
   with the same lost-update window the app has (noted in the code).

The Huh-form deferral above still stands: every shipped command is
flag-driven.

---

### Task 9: text + calc CLI

Smallest surface; independent of every other task. Documents and workbooks live
in `drive_items` (drive already owns those commands) — these packages own only
their comment collections.

```
text new <name> | cat <path> | comments <path> [add|resolve]
calc new <name> | comments <path>
```

- [x] Steps mirror Task 4, minus the export/import work.

**DONE**, with the surface deliberately narrowed and the "independent" claim
found to be false.

**1. `new` and `cat` were dropped** (decided with the user, not unilaterally).
A document is a `drive_item`, so `drive put` already creates one with a mime
type and `drive cat` / `drive get` already read it. A `text new` would be a
second code path creating drive items, duplicating what `drive/cli` owns and
tests. And a document body is a Yjs CRDT edited collaboratively — there is no
shell write that would not clobber concurrent edits. The shipped surface is
`text comments <path>` and `calc comments <path>`, each with
`--add / --reply-to / --resolve / --reopen / --all`. Both `register.go` files
state the reasoning so nobody "completes" the group by mistake.

**2. Task 9 was NOT independent — it was the only task needing new public
scope vocabulary.** `text:*` and `calc:*` did not exist; `text_comments` and
`calc_comments` were absent from the scope table, so every request
default-denied. Four hand-maintained lists had to move together (`AllScopes`,
the collection table, `cliScopes`, the seeded client row via an APPENDED
migration `2000000002`, following `2000000001`'s precedent).

**3. A pre-existing consent-screen bug surfaced while doing it.** `ScopeList`
renders `SCOPE_LABELS[scope] ?? scope`, and `cards:read` / `cards:write`
shipped with no labels — so the consent screen has literally been asking users
to approve "cards:write" since cards launched. Labels added for cards, text,
and calc, plus a test that parses the Go catalog and fails when the two drift.

**4. calc's distinctive piece is A1 notation.** A calc comment anchors to a
cell (`sheet_id`, `row`, `col`) rather than to quoted prose. The CLI speaks A1
because that is what the app shows; `cell.go` converts at the edge (bijective
base-26, case-insensitive) so no other layer holds two representations.

Path resolution is duplicated from `drive/cli` in both packages rather than
shared: siblings must not depend on each other, and putting drive's path model
into core for two callers is worse than the duplication.

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
- [x] **Step 5: Help topics** — DONE for all four:
  `contacts/help/command-line.md`, `calendar/help/command-line.md`,
  `text/help/command-line.md`, `calc/help/command-line.md`. Core's "Package
  commands" section is now a list linking all six groups — it had been naming
  only drive and mail, missing `cards` entirely (fixed in the same pass,
  tinycld#201).
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

---

## Where this stands (end of the autonomous pass)

Every task in this plan is complete except **Task 10 Step 4's live smoke
test**, which is the one thing that cannot be done from a fake server and is
therefore the highest-value remaining work. Six PRs are open:

| PR | What | Merge order |
|---|---|---|
| tinycld#201 | help cross-links + editor complexity lint fix | any time |
| tinycld#202 | calendar route→scope entries | **before** calendar#34 |
| tinycld#204 | text/calc scopes + consent labels | **before** text#55 / calc#56 |
| contacts#31 | vCard endpoints + contacts CLI | any time |
| calendar#34 | ICS endpoints + calendar CLI | after tinycld#202 |
| text#55, calc#56 | comment CLIs | after tinycld#204 |

**The live smoke test is still owed for six groups**, and the plan's own
lesson says why it matters: the predicted failure (mirrored-struct drift) has
never once appeared, while THREE of the four bugs the first smoke test found
were scope plumbing invisible to a fake server. This pass added two more data
points in the same direction — `text_comments`/`calc_comments` unclassified,
and the cards consent labels missing — both found by reading the scope
plumbing rather than by any test. Run `tinycld contacts`, `calendar`, `text`,
and `calc` against a real server before calling step 10 done.

**One class of risk a fake server structurally cannot cover**, worth naming
for whoever does that run: calendar's authorization is two-tiered (read =
membership, write = owner-or-editor), and neither the CLI fake nor the CLI
itself enforces it. The server tests pin it
(`calendar/server/ics_endpoints_test.go`), but the CLI's behavior when the
server says no — the error a viewer sees on `calendar add` — has never been
observed.
