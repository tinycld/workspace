# CLI smoke test — Task 10

> **Two rounds.** Round 1 (below) is DONE and covered `search`, `drive`,
> `mail`, `cards`. **Round 2 (bottom of this file) has NOT been run** and
> covers `contacts`, `calendar`, `text`, `calc`. Skip to it if that is what
> you are here for — but read round 1's findings first, because its lesson
> (weight the scope layer, not struct drift) is what round 2 is designed
> around.

# Round 1 — steps 1–4 (and 6), DONE

Live server: `pnpm run dev`, PocketBase API on **127.0.0.1:7101**, Expo 7102,
proxy 7100. Existing dev DB, never reset or reseeded. Authenticated with the
real device grant as `user@tinycld.org`.

**This was the first time any CLI command ran against a real server.** Four of
the five findings below are invisible to the fake-server suites by construction.

## Bugs found and fixed

### 1. `mail_domains` missing from the OAuth scope table — `mail send` unusable
`core/server/oauth/middleware.go`

`mail_mailboxes.address` stores only the LOCAL PART, so every full address the
CLI prints or matches joins the `mail_domains` row. That collection was absent
from `collectionScopes`, and the middleware default-denies anything unlisted —
so a grant holding `mail:read`+`mail:send` still got

    403 This endpoint is not available to API tokens

Broke `mail mailboxes`, `mail send`, and `--mailbox <address>` — i.e. the whole
send path, the CLI's most valuable mail surface. Fixed by classifying
`mail_domains` read-only (domains are administered in the app). Test added
asserting the read is reachable and POST/PATCH/DELETE stay denied.

Invisible to `mail/cli`'s tests because its fake server serves the row with no
scope layer at all.

### 2. `cards:*` missing from both CLI scope lists — `tinycld cards` unusable
`cli/auth.go`, `core/server/pb_migrations/…_seed_cli_oauth_client.js`, plus a
new appended migration

The cards CLI shipped with its six collections correctly classified and
`ScopeCardsRead`/`Write` defined, but the two hand-maintained client-side lists
were never updated:

| List | Purpose | Had cards? |
|---|---|---|
| `oauth.AllScopes` (Go) | catalog / consent screen | yes |
| `cliScopes` (`cli/auth.go`) | what the CLI requests | **no** |
| seed migration `scopes` | the client-row CEILING | **no** |

The client row is a hard ceiling (`ValidateClientScopes`), so `cards board list`
returned `403 Requires the "cards:read" scope` for every caller on every
deployment. Worse, `tinycld search` silently UNDER-REPORTED: the federated
aggregator drops sources a grant does not cover, so cards results simply never
appeared — no error at all.

Fixed in both lists. Because PocketBase never re-runs an applied migration,
editing the seed alone would fix only fresh databases, so the widening ships as
an appended migration (`2000000001_cli_client_cards_scopes.js`) that rewrites
the scope string from the current catalog. Verified: cards commands work and
federated search now returns cards rows.

### 3. A board cannot be looked up by the key its own output prints
`cards/cli/ids.go`

`cards board list` renders `slug` under a column headed **KEY**, and every card
key leads with it (`PL-4`) — but `resolveProject` matched only ids and names, so
`cards board view PL` answered `board "PL": not found`. Fixed by matching the
key, ordered BEFORE names so a board *named* like another's key cannot hijack
it. Two tests added; both fail without the fix (the collision test demonstrably
resolved to the wrong board).

Missed by the whole existing suite because the fixture's `addProject` never set
`Slug` — the fake server shared the resolver's blind spot.

### 4. `core/server/realtime` did not compile (unrelated to the CLI; blocked boot)
`realtime.go` called `retiring.waitRetired()`; the `retired` channel was
declared and initialized but never closed, and the accessor did not exist.
Closed it at the end of teardown (after `removeRoom`) and added `waitRetired`.
`room_teardown_race_test.go` then deadlocked against the new
wait-for-teardown contract — it dialed the joiner before releasing the parked
`OnEmpty` flush — fixed by releasing concurrently. Package is green.

## Doc drift (no code change)

- **The spec's port is wrong.** The Verification block uses `localhost:8090`
  throughout; the dev stack serves the API on **7101** (proxied at 7100). Every
  curl and `auth login` line there is unrunnable as written.
- **Device approval route.** The spec says the user approves at
  `/oauth/authorize?user_code=…`. That GET is the consent *screen*; the POST
  that approves is `/oauth/authorize/approve`. Bare `POST /oauth/authorize` is
  the Zapier authorization-code endpoint and fails with a confusing
  **"Unknown client_id"**. `authorize.go:51`'s doc comment still says
  "implements POST /oauth/authorize" — that is what sends a reader to the wrong
  route.
- **Approve accepts form encoding only** (`re.Request.FormValue`). A JSON body
  yields an empty code and a 404 "That code is not valid" for a code that is
  present and pending — a misleading error for a content-type mismatch.

## Cosmetic, not fixed (would want your call)

- `auth login` prints `warning: OS keychain write failed … storing credentials
  in <path>` and then still says `✓ Token saved to keychain`. The fallback works
  correctly; the success line just contradicts the warning above it.
- `cards card view` shows `List  c7fehmjobre6hr9` — a raw id where every other
  field is human-readable, and where `board view` resolves the same field to
  "To do".

## Verified working against real data

`auth login/status`, `context list`, `search` (federated, incl. cards after the
fix), `drive ls/tree/search/usage/put/get/rm`, `mail list/search/mailboxes`,
`cards board list/view` (by id, key, and name), `cards card view`, `--json`
output. **`drive put` → `drive get` round-trips byte-identical** (`diff` clean).

## Gate

- `core/server`: `go test ./... -count=1` — all pass
- `tinycld/cli`, `cards/cli`, `drive/cli`, `mail/cli`: build + test — all pass
- `pnpm exec tinycld-pkg typecheck` — clean
- `pnpm exec tinycld-pkg test` — 1390 tests / 185 files pass
- `pnpm run lint` — 5 warnings, all in `core/lib/editor/use-webview-editor.tsx`,
  all pre-existing and COMMITTED (`846b8ac chore(editor): log mount timings at a
  level DevTools shows`). Deliberate `__DEV__`-guarded instrumentation for the
  in-flight editor-cost investigation (`HANDOFF-editor-webview-cost.md`). Left
  alone as out of scope — flagging rather than touching active work.

---

# Round 2 — the four groups added 2026-08-15/16 (NOT YET RUN)

**Nothing below has touched a real server.** Round 1 above covered `search`,
`drive`, `mail`, and `cards`. Four groups have shipped since and are still
fake-server-only:

| Group | Commands | PR |
|---|---|---|
| `contacts` | list, search, show, add, edit, rm, export, import | contacts#31 |
| `calendar` | agenda, list, events, show, add, rm, rsvp, export, import | calendar#34 |
| `text` | comments (`--add/--reply-to/--quote/--resolve/--reopen/--all`) | text#55 |
| `calc` | comments (`--cell/--sheet/--add/--reply-to/--resolve/--reopen/--all`) | calc#56 |

**Merge the scope PRs first or every command 403s:** tinycld#202 before
calendar#34; tinycld#204 before text#55 and calc#56. Both add route/collection
entries without which the middleware default-denies. tinycld#201 (help +
lint) is independent.

## Setup (unchanged from round 1, repeated so this section stands alone)

```sh
cd tinycld && pnpm run dev          # API 127.0.0.1:7101, Expo 7102, proxy 7100
tinycld auth login localhost:7101   # device grant; approve in the browser
```

Do NOT reset or reseed the DB. **`auth login` must be re-run after merging the
scope PRs** — a grant is issued with the scopes that existed when it was
minted, so an existing token will not carry `text:*` / `calc:*` no matter what
the server now advertises. That is itself worth confirming: an old token
should fail with a scope error, not a confusing 404.

## What to exercise

```sh
# contacts — the round-trip is the point
tinycld contacts add --first Ada --last Lovelace --email ada@example.com
tinycld contacts list ; tinycld contacts search ada ; tinycld contacts show <id>
tinycld contacts edit <id> --phone 555-0100 ; tinycld contacts edit <id> --phone ""
tinycld contacts export --out /tmp/a.vcf
tinycld contacts import /tmp/a.vcf          # MUST report updated, not created
tinycld contacts rm <id> ; tinycld contacts list --trashed
tinycld contacts edit <id> --restore ; tinycld contacts rm <id> --permanent --yes

# calendar
tinycld calendar list                        # ROLE column populated?
tinycld calendar agenda ; tinycld calendar agenda --days 30 --calendar <name>
tinycld calendar events --from 2026-08-01 --to 2026-09-01
tinycld calendar add --calendar <name> --title Standup --start "2026-08-20 09:30"
tinycld calendar add --calendar <name> --title Offsite --start 2026-09-01 --all-day
tinycld calendar show <id> ; tinycld calendar rsvp <id> yes
tinycld calendar export --calendar <name> --out /tmp/c.ics
tinycld calendar import --calendar <name> /tmp/c.ics   # MUST report updated
tinycld calendar rm <id> --yes

# text / calc — need a document and a workbook in Drive first
tinycld drive put notes.md / ; tinycld drive put budget.xlsx /
tinycld text comments /notes.md --add "First note"
tinycld text comments /notes.md --add "Reply" --reply-to <id>
tinycld text comments /notes.md --resolve <id> ; tinycld text comments /notes.md --all
tinycld calc comments /budget.xlsx --cell B7 --add "This looks off"
tinycld calc comments /budget.xlsx            # CELL column must read B7, not 6/1

# and --json on at least one command per group
```

## Specific things to check, and why

Round 1's lesson was that the *predicted* failure (mirrored-struct field drift)
never appeared, while three of four real bugs were scope plumbing invisible to
a fake server. Round 2 already added two more in that same category, both found
by reading the plumbing rather than by any test (`text_comments`/`calc_comments`
unclassified; cards consent labels missing). So weight the scope layer again.

1. **The scope layer, first.** Every new group's collections and routes were
   hand-added to `middleware.go`. `contacts` and `calendar` also have raw
   routes (`/api/{contacts,calendar}/{export,import}`) whose entries are the
   ONLY thing between a read grant and a write one — collection rules do not
   run on raw routes at all.

2. **Calendar's viewer/editor split — the biggest fake-server blind spot.**
   Read is membership in any role; write is owner-or-editor. The server tests
   pin the server side (`calendar/server/ics_endpoints_test.go`), but *what a
   viewer actually sees* when a write is refused has never been observed. Get a
   second account as a `viewer` on a calendar and run `calendar add` and
   `calendar import` as them. Expect a comprehensible refusal, not a raw 403
   body or a confusing 404. The CLI itself enforces nothing here by design —
   `calendar list`'s ROLE column is the only forewarning a user gets.

3. **The import upsert, on both file formats.** Export then immediately
   re-import must report `updated`, never `created`. Both had the identical
   latent defect (globally-unique UID index vs. per-book/per-calendar UID
   semantics), fixed by regenerating the UID on cross-owner collision. Only a
   real DB with a real unique index proves it.

4. **`contacts rm` is a SOFT delete** — confirm the row lands in
   `list --trashed` and `edit --restore` brings it back. `--permanent` is the
   only hard delete.

5. **`calc`'s A1 conversion at a real boundary.** The CELL column must render
   `B7`, never the stored `6`/`1`. Try a two-letter column (`AA1`) against a
   workbook the app also has open, and confirm the app agrees about which cell
   is annotated. This is the one place round 2 introduced a genuinely new
   representation.

6. **The consent screen**, since tinycld#204 changes it: `auth login` should
   now list plain-language lines for cards/text/calc rather than raw
   `cards:write` strings.

## Known gaps this run should close

- No group has been exercised against a DB with more than one user, so nothing
  cross-account has been observed anywhere — including contacts' owner scoping,
  which the server tests cover but the CLI has never provoked.
- `calendar rsvp` refuses when the caller is not on the guest list. That path
  is fake-tested; the real one depends on the caller's account email matching a
  guest entry, which no test has ever done with a real address.
- Round 1's two cosmetic items (the contradictory keychain warning, raw ids in
  `cards card view`) are still open and still want your call.
