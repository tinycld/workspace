# CLI smoke test — Task 10, steps 1–4 (and 6)

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
