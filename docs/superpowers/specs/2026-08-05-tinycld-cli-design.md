# `tinycld` CLI + OAuth 2.1 authorization server — design

## Context

TinyCld is reachable through the web/native app and through protocol mounts
(WebDAV, CalDAV, CardDAV, IMAP/SMTP) that only generic clients speak. There is
no first-class way to script against a deployment: no searching mail from a
terminal, no listing a Drive folder in a pipeline, no moving files in and out
of Drive from CI.

This introduces `tinycld`, a GitHub-CLI-style binary with the shape
`tinycld <package> <command> [flags]`. Each package declares its own commands
in its own repo via a new `cli` manifest block, so the command surface an org
sees is exactly the package set that org installed — the same guarantee the
app shell already gives for routes, settings, and help.

It also introduces the thing the CLI needs and the platform lacks: **a real
OAuth 2.1 authorization server**. That is deliberately scoped beyond the CLI,
because Zapier integration is a known upcoming requirement and needs the same
machinery. Building it once means Zapier later is *registering a client*, not
standing up a second auth system.

**Outcome:** a user downloads a binary from Settings → About, runs
`tinycld auth login <host>`, approves in the browser, and has their org's
commands — while a third-party integration can obtain a scoped, revocable
grant through the same standard endpoints.

### Decisions taken during design

| Decision | Choice |
|---|---|
| Distribution | Per-org cross-compiled binaries (darwin/linux/windows) from the existing build pipeline, downloaded from Settings → About |
| Auth | Full OAuth 2.1 AS: Device Grant (RFC 8628) for the CLI, Authorization Code + PKCE (RFC 7636) for Zapier |
| Revocation | Grant record checked per request, keyed by `jti` |
| Command code location | Each package's own repo, via a new `cli` manifest block (mirrors `server`) |
| Implementation | Go; commands are HTTP clients — the binary runs on the user's laptop and has no DB access |
| Signing | Unsigned in v1; Gatekeeper/SmartScreen bypass documented |

### Scope: this is three deliverables, not one

The design deliberately spans more than the CLI, because two prerequisites
turned out to be independently valuable and independently shippable. Each gets
its own implementation plan; this document is the shared spec.

| # | Deliverable | Ships value alone? | Depends on |
|---|---|---|---|
| **A** | OAuth 2.1 authorization server | **Yes** — unblocks Zapier with no CLI at all | — |
| **B** | Typed API payloads (mail first) | **Yes** — fixes live drift in the web client | — |
| **C** | The CLI itself | No | A (auth), B (types) |

A and B are independent of each other and can proceed in parallel. C needs
both. If only one thing ships, A is the highest-value piece: it is the
platform capability the product lacks, and Zapier needs it regardless of
whether a CLI ever exists.

The build order at the end of this document sequences all three; the
per-deliverable plans break them down further.

---

## Part 1 — OAuth 2.1 authorization server

### What exists, and what does not

PocketBase is an OAuth2 **client** (`apis/record_auth_with_oauth2.go` — "log in
to TinyCld with Google"). It has **no** authorization-server capability:
nothing issues tokens to third parties. That half must be built.

Three findings make it much cheaper than it sounds:

1. **`record.NewStaticAuthToken(duration)`** (fork
   `core/record_tokens.go:42`) already mints non-refreshable auth tokens with a
   custom duration — exactly an access token.
2. **`loadAuthToken`** (fork `apis/middlewares.go:184`) already accepts
   `Authorization: Bearer <token>`, resolves it via `FindAuthRecordByToken`,
   and sets `e.Auth`. So **every existing endpoint and collection rule works
   with an OAuth access token unchanged** — no per-endpoint auth work.
3. **`golang-jwt/jwt/v5` and `golang.org/x/oauth2` are already in the module
   graph** (transitively, via PocketBase). No heavyweight new dependency.

We hand-roll the grant logic rather than adopting `ory/fosite`: the flows we
need are small and well-specified, and fosite would need a substantial adapter
onto PocketBase's record/token model. Revisit if scope grows.

### Two constraints that shape the implementation

**Do not add a new PocketBase token type.** `FindAuthRecordByToken` resolves a
token's `type` claim through a **closed switch** (`core/record_query.go:483`)
whose `default` branch errors; each type maps to its own collection-level
secret. Adding `TokenTypeOAuthAccess` would mean forking
`core/record_tokens.go`, `core/record_query.go`, and the collection
auth-options model.

Avoid that entirely by minting a **standard `auth`-type static token** and
registering our middleware at a priority *lower* than
`DefaultLoadAuthTokenMiddlewarePriority`. Because `loadAuthToken`
short-circuits on `e.Auth != nil`, ours runs first, resolves the grant, and
PocketBase's middleware then no-ops. **No fork changes.** There is precedent:
`core/server/realtime/register.go:154` already resolves a token itself and
populates `e.Auth`, and falls through to `sharelink.VerifySession` for the
anonymous path — a second identity system already coexists with `e.Auth`.

**Signing is HS256-only.** PocketBase's `tools/security` hardcodes
`jwt.WithValidMethods([]string{"HS256"})`. That is fine for v1: we validate
tokens ourselves, so no third party needs to verify our signatures. Publishing
a JWKS for RS256/ES256 `id_token`s would mean bypassing `tools/security` and
writing key management from scratch — deliberately out of scope, and noted
below.

Derive the OAuth signing key the way `sharelink` does — domain-separated from
the superusers collection secret with a versioned label:

```go
mac := hmac.New(sha256.New, []byte(col.AuthToken.Secret))
mac.Write([]byte("tinycld:oauth:v1"))
```

This is what keeps an OAuth signature from being confusable with a PocketBase
auth token even though both are HS256, and the `:v1` suffix is the rotation
seam.

### The revocation constraint

PocketBase signs auth tokens with `record.TokenKey() + collection.AuthToken.Secret`.
Rotating `tokenKey` invalidates **every** token for that user, including their
web session. That is far too blunt for "revoke my laptop" or "disconnect
Zapier."

So per-grant state lives in a record, checked on every request:

```
loadAuthToken (PocketBase, unchanged)   → e.Auth populated
        ↓
core middleware (registerSharedCore):
    jti claim → oauth_grants row
    revoked / expired?        → 401
    scope covers this route?  → 403
    stamp last_used_at (throttled write)
```

One indexed read per request. Revoking one grant leaves web sessions and other
grants untouched.

This mirrors `sharelink.VerifyAndResolve`, whose discipline is worth copying
verbatim: **a valid signature is never sufficient.** It re-reads the underlying
row so revocation is immediate, checks the active flag, checks expiry, and
re-checks that the token's claims still match current state (a link downgraded
editor→viewer immediately loses write). Our middleware does the same for
grants: signature, then status, then expiry, then scope.

**Related bug to fix while here.** `mail/server/endpoints_image_proxy.go:102`
calls `app.FindAuthRecordByToken(token)` with **no token-type restriction**,
so any PocketBase token type — including a `file` or `verification` token —
is accepted as proof of identity. That should be constrained to
`core.TokenTypeAuth`. It is pre-existing and not caused by this work, but it
sits directly on the auth path this design touches.

### Where the code lives

`tinycld/core/server/oauth/` — a new core package. This mirrors **`sharelink`**,
which is in core precisely because it is a cross-cutting token primitive that
members (separate Go modules) cannot import from one another. Registration goes
in `registerSharedCore`, not the host-only tail, so multi-org tenants get it;
`composition_parity_test.go` enforces that.

### Endpoints

| Endpoint | RFC | Purpose |
|---|---|---|
| `GET /.well-known/oauth-authorization-server` | 8414 | Metadata discovery |
| `POST /oauth/device` | 8628 | Device authorization — the CLI |
| `GET /oauth/authorize` | 6749 + PKCE | Consent screen — Zapier |
| `POST /oauth/token` | 6749 | Both grants + refresh |
| `POST /oauth/revoke` | 7009 | Revocation |
| `GET /oauth/userinfo` | OIDC-shaped | Identity for integrations |

### New collections

Two core migrations. Per the frozen-migration rule these ship as new files in a
new core version, never as edits.

**`oauth_clients`** — `client_id`, `name`, `redirect_uris` (JSON), `scopes`,
`type` (`public` | `confidential`), `client_secret_hash`, `is_first_party`,
`logo`. The CLI is seeded as a first-party public client (no secret — it is an
installed app; PKCE is what protects it). Zapier is registered as a
confidential client later.

**`oauth_grants`** — `user` FK, `client` FK, `jti` (unique, indexed), `scopes`,
`refresh_token_hash`, `device_code`/`user_code` (cleared on approval),
`status` (`pending` | `active` | `revoked`), `expires_at`, `last_used_at`,
`device_label`.

Writes must be superuser-only. PocketBase rules cannot constrain *which fields*
a write touches — which is exactly why `users_guard.go` and
`disabled_guard.go` exist in Go today. Minting, approval, and revocation go
through Go endpoints.

**Grants are DB rows, not in-memory maps.** Drive's `download-token` /
`export-token` use a process-local `map` guarded by a mutex — correct for a
60-second handoff, but it does not survive a restart and does not work across
replicas. OAuth grants are long-lived and must be durable. Do borrow drive's
single-use discipline for authorization codes: consume by deleting **inside**
the same lock/transaction as the read, so a code can never be redeemed twice.

Store only hashes of refresh tokens and client secrets, compare with
`subtle.ConstantTimeCompare`, and follow mail's logging convention of emitting
only an 8-character prefix for correlation (`secretPrefix()`) so secrets never
reach the logs.

### Scopes

Named `<package>:<capability>`, so the set extends naturally as packages are
installed:

```
mail:read  mail:send  drive:read  drive:write
contacts:read  contacts:write  calendar:read  calendar:write
profile
```

Scope→route enforcement is a table in the core middleware, with each package
declaring the scopes it defines in its `cli` manifest block. Default deny: a
route no scope covers is refused for OAuth-authenticated requests. The CLI
requests broad scopes; Zapier requests narrow ones and the consent screen shows
exactly what is being granted.

**Adding a package's scopes means editing FOUR places, and nothing enforces
that they agree.** The `cli` manifest block is metadata; it does not feed any
of them:

| Place | Effect if it is missed |
|---|---|
| `oauth.AllScopes` + the scope constants | the scope is not a valid string at all |
| `collectionScopes` / the route table | default-deny 403s the collection |
| the seed migration's client `scopes` | the CEILING rejects the login outright |
| `cliScopes` in `cli/auth.go` | the grant is issued WITHOUT the scope; commands 403 later |

The cards package shipped with the first two done and the last two missed, so
`tinycld cards` 403'd on every deployment and `tinycld search` silently dropped
cards results — the aggregator narrows itself to the scopes a grant covers, so
an under-scoped grant under-reports rather than erroring. When adding a
package, change all four, and remember the seed migration is frozen once
released: widen an existing deployment with an APPENDED migration, never an
edit (PocketBase never re-runs an applied file).

### Device flow (the CLI)

```
$ tinycld auth login acme.tinycld.org

  ! First copy your one-time code: WDJB-MJHT
  Press Enter to open acme.tinycld.org in your browser...

  ✓ Authenticated as nathan@argosity.com
  ✓ Token saved to keychain
```

1. `POST /oauth/device` → `{device_code, user_code, verification_uri, interval, expires_in}`
2. CLI opens the browser and polls `POST /oauth/token` at `interval`, honoring
   `authorization_pending` / `slow_down` per RFC 8628
3. User approves in the already-logged-in web app, names the device, sees the
   scopes. `GET /oauth/authorize?user_code=…` is the consent SCREEN; the
   approval itself is `POST /oauth/authorize/approve` (deny is
   `/oauth/authorize/deny`), and it reads a **form-encoded** body — a JSON post
   yields an empty `user_code` and a misleading "That code is not valid".
   Bare `POST /oauth/authorize` is the authorization-code endpoint in Part 9
   and requires a `client_id`; posting a `user_code` there fails with
   "Unknown client_id".
4. Poll returns the access token once; CLI stores it in the OS keychain
   (Keychain / Credential Manager / libsecret), falling back to
   `~/.config/tinycld/` at mode 0600 with a warning

Rate-limit the poll and token endpoints, and reuse `davauth`'s timing-oracle
mitigation (`compareAgainstDummyHash`) so an invalid grant does not return
measurably faster than a valid one.

### Consent + revocation UI

`settings/[...section].tsx` hard-gates on `isAdmin`, so package-contributed
settings panels are the wrong home for a user-scoped credential screen. Two
new core surfaces:

- `/oauth/authorize` — the consent screen (public route, requires login)
- A "Connected apps" section beside `AboutSection` in
  `app/(app)/settings/personal.tsx` — lists grants with client name, scopes,
  last-used, and Revoke

---

## Part 2 — the CLI

### Why Go, and why per-org binaries

The ecosystem already cross-compiles Go (Docker, bare-metal `build.sh`,
`pkgbuild.Pipeline` for in-app installs), runs Go 1.26.3, and links
per-package Go modules into one binary via a generated file. A per-org build
already exists: `pkgbuild.Pipeline.Execute` compiles a server binary containing
exactly the org's package set, stored content-addressed under
`builds/<recipe-hash>/`. Three cross-compiled CLI binaries are an incremental
step on that pipeline.

### Component map

```
tinycld/cli/                    NEW — module tinycld.org/cli
    main.go                     Cobra root, global flags
    cli_extensions.go           GENERATED — registers each package's commands
    internal/
        client/     authenticated HTTP client (OAuth token, refresh, retry)
        context/    saved origins (~/.config/tinycld/config.toml)
        keychain/   OS-native token storage
        oauth/      device flow client
        output/     table | json | csv, --quiet, --no-color
        ui/         Bubble Tea / Huh prompts

mail/cli/register.go            NEW — in the package's own repo
drive/cli/register.go           NEW
```

`cli_extensions.go` is emitted exactly as `server/package_extensions.go` is:

```go
// Code generated by app/scripts/generate.ts. DO NOT EDIT.
package main

import (
    drive "tinycld.org/packages/drive/cli"
    mail  "tinycld.org/packages/mail/cli"
)

func registerPackageCommands(root *cobra.Command, c *client.Client) {
    drive.Register(root, c)
    mail.Register(root, c)
}
```

An org without Calendar has no `calendar` command compiled in, and Cobra's
generated `--help` lists only what is present. No runtime gating.

### Terminal UI stack

| Concern | Library |
|---|---|
| Command tree, flags, `--help`, completions | `spf13/cobra` |
| Styling | `charmbracelet/lipgloss` |
| Interactive prompts | `charmbracelet/huh` |
| Transfer progress | `charmbracelet/bubbles/progress` |

Every prompt must have a flag equivalent and `--yes` must skip all of them —
the CLI has to run in CI with no TTY. Detect non-TTY and degrade to plain
output automatically.

---

## Part 3 — code reuse (DRY)

The constraint: reuse helpers, add CLI-specific API routes only as a last
resort. Investigation found the tension is smaller than it appears, and the
real duplication risk is somewhere unexpected.

### Write paths need no reuse — the server already owns the logic

Drive's create hook (`dedup_name.go`) runs name dedup under a per-parent mutex,
recomputes `size` from actual bytes (client-supplied size is untrusted), and
inserts the owner `drive_shares` row **in the same transaction**. Quota is a
record hook by construction.

So a CLI that POSTs to `/api/collections/drive_items` gets dedup, quota, and
owner-share **for free**. There is nothing to import and nothing to
reimplement. The CLI must *not* insert an owner share — the unique index
rejects it.

This is also why existing helpers are unimportable, and correctly so:
`chooseUniqueDriveItemName`, `webdav.NewFileSystem`, and the `driveshare`
checks are all `core.App`-bound (they need a live local DB handle). A remote
CLI cannot call them under any refactor.

### What the CLI genuinely can import from `tinycld.org/core`

Pure, App-free, already exported:

| Symbol | Use |
|---|---|
| `fts.SanitizeQuery` | sanitize FTS input identically to the server |
| `quota.FormatBytes` | `drive usage` output matches the app |
| `driveshare.Role` + `CanRead`/`CanWrite` | interpret a role string from the API |
| `webdav.Prefixes` / `HasPrefix` | path routing |
| `mailer.Recipient` / `Attachment` / `Header` | typed recipients |
| `textextract`, `render`, `thumbnails` | local extraction/preview if needed |

### The real problem: API payload shapes are defined three-plus times

`/api/mail/send`'s contract currently exists in three unsynchronized places:

- an **unexported** Go struct (`sendRequest`, `mail/server/endpoints_send.go:28`)
- an **unexported** TS interface (`SendEmailParams`, `useSendEmail.ts:6`)
- inline object literals at Drive call sites, with no named type at all

A CLI would become a fourth. Adding a field then silently breaks the CLI at
runtime rather than at compile time.

#### Audit of mail's API surface

Mail is the worst case in the tree, and the CLI's richest surface, so it is
worth fixing properly rather than papering over:

| Endpoint | Go request | Go response | TS |
|---|---|---|---|
| `POST /api/mail/send` | `sendRequest` (unexported) | **untyped** `map[string]string{message_id, thread_id}` | `SendEmailParams` (unexported); **response is `any`** |
| `POST /api/mail/draft` | shares `sendRequest` + `message_id` | untyped map | inline literal |
| `GET /api/mail/search` | **split in two**: `advancedFilters` (8 params, *no json tags*) + `mailbox_id`/`limit`/`offset` read inline at `endpoints_search.go:158-160` | `searchResponse` (unexported) | `MailSearchResult` exported, `MailSearchResponse` not; params built from a separate `SIMPLE_FILTER_MAP` of string literals |
| `GET …/webhook-urls` | — | untyped `map[string]string{inbound, bounces}` | inline |
| `POST …/inbound/{token}` | provider-specific | untyped `map[string]any{"messageID"}` | n/a |

Four concrete problems:

1. **Every mail response is an untyped map.** No Go struct, so nothing to
   generate a TS or Go client type from, and `useSendEmail` returns `any`.
2. **The search request has no single definition.** Eleven parameters split
   across a tagless struct and inline `query.Get()` calls, matched on the client
   by a hand-maintained list of magic strings. A CLI's `--help` would have to be
   derived by reading handler code.
3. **Search response fields match today only by coincidence.** All nine line up
   — maintained by discipline, enforced by nothing. Worse, the shape is written
   three times in Go alone: `searchResultItem` (json), `searchResultRow` (db),
   and `mapResults` copying field by field.
4. **Casing is already inconsistent** — `"messageID"` in the inbound/bounce
   responses against `message_id` everywhere else.

Drift has already happened: `not_words`, `size_op`, and `size_bytes` were
removed from the server, and `search_advanced_test.go:119` now asserts they are
*ignored*. Any client still sending them fails silently. (An earlier draft of
the CLI surface proposed a `--not-words` flag for exactly this reason — the
contract was not discoverable.)

#### Two live bugs found during the audit

These are user-facing today, independent of the CLI, and both are the *kind* of
bug a typed contract prevents. They should be fixed as part of this work.

**1. BCC is never persisted — draft BCC is silently lost.**
`endpoints_draft.go:198` does `record.Set("recipients_bcc", …)`, but **no
migration defines a `recipients_bcc` column** (`1713000000_create_mail_collections.js`
declares only `recipients_to` and `recipients_cc`). PocketBase discards a write
to an undefined field, so draft BCC has never round-tripped: reopen a draft and
the BCC list is gone. Separately, `storedMessage` on the send path
(`endpoints_send.go:184-199`) sets `To` and `Cc` but not `Bcc` at all — so a
sent message's BCC is delivered to recipients yet absent from the stored
record. `MailMessages` in `types.ts:92-93` likewise has no `recipients_bcc`.
Fix needs a new migration adding the column, plus both write paths.

**2. A failed domain verification save is reported to the user as success.**
`endpoints_verify_domain.go:43-46` returns **HTTP 200** with `saved: false` and
a `save_error` key when persistence fails. The client
(`settings/provider.tsx:152`) calls `await pb.send(...)` **without assigning the
result**, so the mutation resolves successfully and the UI shows verification
worked while nothing was written. A typed response would have made the
discarded `saved` field visible. Fix: type the response and have the client
check `saved`.

Both are fixed under deliverable B, each as its own commit with a test.

#### Fix: one Go struct per payload, generated into TypeScript

There is already a **Go→TypeScript generation pipeline**, and it is
load-bearing: `tinycld/core/server/coreserver/schema_gen.go` emits both TS
interfaces and Zod schemas from Go, driven by the standalone
`cmd/export-types` binary and run on every `pnpm install` via
`packages:generate`. Its doc comment states the principle: the source of truth
is the Go/migration side, and the TS is regenerated rather than committed.

**One constraint rules out the obvious approach.** `GenerateSchemas` is driven
purely by `app.FindAllCollections()` — it has no notion of an HTTP endpoint and
cannot see a request struct. And per `export_types.go:38-43`, the standalone
binary **must stay CGO-free and must not import feature servers**, so a
reflection-based emitter that imports `mail/server` would break the lean Docker
web-builder stage. The *harness* is reusable (build a Go binary, run it, write
`.ts`); the collection-driven emitter is not extensible to payloads.

So the plan is to make the Go struct the single source of truth via a **second,
source-parsing emitter** rather than an extension of the collection one:

1. **Define one exported Go struct per request and per response**, replacing
   every `map[string]any` response and folding the split search parameters into
   a single `SearchRequest` with json/query tags.
2. **Add a payload-types emitter** that parses the declared payload package's
   source with `go/ast` (no import of the feature server, so the CGO-free
   constraint holds) and writes TS into `lib/generated/`. A package declares
   its payload package in the manifest, the same way it declares
   `collections: { register, types }`.
3. **Both clients consume the generated types** — TS hooks import them instead
   of hand-written interfaces; the Go CLI imports the structs directly from the
   package's own `server/` (same repo, no cross-sibling dependency).

Adding a field then updates the server, the web client, and the CLI from one
edit, and a removed field is a compile error in all three.

**Prerequisite: reconcile the duplicate `MailDomains` first.** The collection
emitter already produces its own mail types (`core/types/pbSchema.ts:215`,
plus `mail_*` entries in the schema map) that are **stale** — still carrying
`org` on `MailDomains` and `user_org` on `MailFolderCounts`, both removed by
the de-org migration, and degrading `verification_details` to `any`. That
staleness is precisely why the hand-written `mail/tinycld/mail/types.ts`
exists. There are two `MailDomains` interfaces in the tree today; layering a
payload emitter on top without resolving that produces a third.

Struct naming, with one collision to avoid:

| Current | Becomes |
|---|---|
| `sendRequest` | `SendEmailRequest` |
| `draftRequest` | `SaveDraftRequest` |
| send + draft responses (untyped, emitted at 3 sites) | `SendEmailResponse` |
| `advancedFilters` + inline `mailbox_id`/`limit`/`offset` | `SearchRequest` |
| `searchResultItem` / `searchResponse` | `SearchResultItem` / `SearchResponse` |
| verify-domain response (untyped `map[string]any`, conditional `save_error`) | `VerifyDomainResponse` |
| `verificationDetails` | `VerificationDetails` |
| webhook-urls response (untyped; written 3× incl. twice in TS) | `WebhookURLsResponse` |
| inbound/bounce responses (`ok`/`ignored`/`processed`, 3 vocabularies) | `WebhookAckResponse` |
| `drive/server` `driveSearchResultItem` / `driveSearchResponse` | `DriveSearchResultItem` / `DriveSearchResponse` |
| `drive/server` `shareRequest` / `shareRecipient` | `ShareRequest` / `ShareRecipient` |

Also worth naming while here: the recipient literal `{name, email}` is inlined
six times across `useSendEmail.ts` and `useSaveDraft.ts`, and the multipart
form keys (`json`, `attachments`) are bare string literals on both sides —
both should become shared named types/constants.

**Naming caveat:** `mail/server` already aliases `mailer.SendRequest` — the
*provider* wire shape, which has `from` and no `mailbox_id`. The HTTP payload
must be `SendEmailRequest`; conflating the two would be a real bug.

**Scope discipline.** Normalizing `"messageID"` → `"message_id"` changes a
response field a webhook caller may read, so it ships as its own commit with a
note in the release. The rest is internal — Go structs and regenerated TS —
and changes no wire format. `searchResultRow` stays separate: `db:` tags serve
a different purpose than the JSON contract, though `mapResults` should be
checked against the generated type by a test.

### When a new API route is justified

Last resort, and only when no existing endpoint can express the operation. Each
one needs a comment saying why. The endpoint inventory
(`drive/server/register.go:124-203`, `mail/server/register.go:253-326`) already
covers search, send, draft, share links, versions, folder download, export, and
storage usage. Plain PB REST covers simple row reads and writes. The only new
routes this design adds are the OAuth ones, which serve the platform rather
than the CLI.

---

## Part 4 — the `cli` manifest block

```ts
// mail/manifest.ts
cli: {
    package: 'cli',
    module: 'tinycld.org/packages/mail/cli',
    commands: [
        { name: 'search', summary: 'Search messages' },
        { name: 'read',   summary: 'Print a message' },
    ],
    scopes: ['mail:read', 'mail:send'],
},
```

`package`/`module` mirror `server` and drive code generation. `commands` is
metadata for the settings page and docs; Cobra remains the source of truth for
`--help`. `scopes` feeds the OAuth scope registry and the consent screen.

**The manifest type has drifted three times.** `carddav`, `quota`, `webdav`,
and `caldav` appear in real manifests but are missing from one or both type
declarations, because manifests are plain objects with no
`satisfies PackageManifest`. Add `cli` to **both**:

- `tinycld/core/lib/packages/types.ts`
- `tinycld/scripts/load-manifest.ts`

Every interpolated string must pass `assertSafeImportField` — the server
regenerates from third-party manifests, so this is a live injection surface.

---

## Part 5 — build & distribution

**Generator.** New `tinycld/scripts/gen-cli.ts` following `gen-server.ts`:
emit `cli_extensions.go` plus a `go.work` covering `tinycld/cli`, core, and
each member's `cli/` dir. Pure `build*Source` functions with unit tests, per
`scripts/__tests__/`.

**Cross-compilation.** A new step in `pkgbuild.Pipeline.Execute` after the
existing `go build`, using the injectable `Run CmdRunner` so tests stub it:
`darwin/arm64`, `darwin/amd64`, `linux/amd64`, `linux/arm64`,
`windows/amd64`. `CGO_ENABLED=0` — the CLI is a pure HTTP client needing no
SQLite, so cross-compiling needs no C toolchain. Output to `<appDir>/cli-dist/`.

This is **best-effort**: a CLI build failure logs and continues, never failing
the package install. Users install packages to get the app working; losing that
to a CLI compile error is the wrong trade.

**Serving.** `GET /api/cli/downloads` lists platform builds;
`GET /api/cli/download/{platform}` streams one. `AboutSection.tsx` gains a
"Command line tools" block below `IncludedPackages`, auto-detecting the
viewer's platform.

**Unsigned in v1.** macOS Gatekeeper blocks the binary and Windows shows
SmartScreen. The About panel and help topic must give the exact bypass
(`xattr -d com.apple.quarantine ./tinycld`). Signing and notarization are a
deliberate follow-up.

---

## Part 6 — command surface

Core commands, compiled into every build:

```
tinycld auth login <host> | logout | status
tinycld context list | use | add | remove
tinycld version
tinycld completion bash|zsh|fish|powershell
```

Global flags: `--json` / `--output table|json|csv`, `--context <name>`,
`--quiet`, `--no-color`, `--yes`.

### mail

`/api/mail/search` exists with FTS5 behind it; its query parameters map 1:1
onto flags — derived from the `SearchRequest` struct above, not hand-copied.
(`not_words` and `size_*` were removed server-side and are deliberately absent.)

```
mail search <query>   --from --to --subject --has-words
                      --date-after --date-before --folder --has-attachment
                      --mailbox --limit --offset
mail list             --folder inbox --mailbox --limit
mail read <thread|message>     --html --raw --no-images
mail attachments <message>
mail download <message>        --attachment N|all --out DIR
mail send             --to --cc --bcc --subject --body|--body-file --attach --from
mail draft            (same flags → POST /api/mail/draft)
mail reply <message>  --body --all
mail archive|trash|spam|read|unread|star|unstar <thread...>
mail label add|remove <thread> <label>
mail mailboxes
mail status                    # unread counts via the mail_folder_counts view
```

**Message bodies are a PocketBase `file` field, not a column.** `mail read`
reads the record, then GETs the `body_html` file URL — the same two-step
`EmailBody.tsx` does. `raw_headers` is likewise a file field.

### drive

```
drive ls [path|id]    --long --all --json --recursive
drive tree [path]     --depth
drive search <query>  --limit --offset
drive cat <path>
drive get <path> [dest]   --recursive  --version N
drive put <local> [dest]  --recursive --parents        # progress bar
drive mkdir <path>    --parents
drive mv | cp <src> <dst>
drive rm <path>       --recursive (trash by default) --permanent
drive restore <path> | drive trash
drive share <path>    --user --role viewer|commentor|editor
drive link create|list|revoke   --expires --role
drive versions <path> | --restore N | --snapshot
drive export <path> --to pdf
drive usage
```

Four facts the implementation must respect:

- **Hierarchy is a self-referencing `parent` FK and root is the empty string
  `''`, not null.** Path→id walks down from `''`; id→path walks up. Both
  directions **need a cycle guard** — the client (`getItemPath`) and server
  (recursive CTE in `endpoints_download.go`) each carry one.
- **`drive_items.file` is PocketBase's sanitized, suffixed stored name and
  differs from `item.name`.** Building a file URL from `name` 404s.
- **Folder download is a two-step token flow:**
  `POST /api/drive/download-token` → `GET /api/drive/download-folder?token=…`
  (60s TTL, single-use, 10k files / 5GB). Export follows the same shape.
- **Upload must not create a `drive_shares` owner row** — the server hook does
  it transactionally, and the unique index rejects a duplicate.

### contacts / calendar

```
contacts list --favorites | search <q> | show <id> | add | edit <id> | rm <id>
contacts export [--vcard] | import <file.vcf>

calendar agenda --days 7 | list | events --from --to | show <id>
calendar add --title --start --end --all-day --location --guest --recurrence
calendar rm <id> | rsvp <id> yes|no|maybe
calendar export [--ics] | import <file.ics>
```

`contacts add` and `calendar add` with no flags drop into a Huh form.

### text / calc

Documents and workbooks live in `drive_items`; these packages own only their
comment collections.

```
text new <name> | cat <path> | comments <path> [add|resolve]
calc new <name> | comments <path>
```

---

## Testing

- **OAuth conformance**: device flow (pending/slow_down/expiry/replay), auth
  code + PKCE (including a wrong `code_verifier`), refresh rotation,
  revocation, scope enforcement (403 on an uncovered route), and the
  metadata document.
- **Security**: a revoked grant fails on the *next* request; revoking one grant
  leaves web sessions and sibling grants working; timing parity between valid
  and invalid grants; `redirect_uri` exact-match; authorization codes are
  single-use.
- **Generator**: pure-function tests on `buildCliExtensionsSource` /
  `buildCliGoWork`, mirroring `gen-server.test.ts`.
- **Payload contract**: a golden-file test that regenerating the API types
  produces no diff — the same guard `pbSchema.ts` regeneration already relies
  on. This is what stops the multiple-definitions drift from returning. Plus a
  test that `mapResults` populates every field of the generated
  `SearchResultItem` (the `db:`-tagged row struct stays separate and is the one
  place a field can still be silently dropped).
- **Go unit**: each package's `cli/` against an `httptest` server; flags,
  rendering, error paths.
- **Path resolution**: table-driven drive path↔id tests including the cycle
  guard and the `''` root.
- **Integration**: one test booting the real binary — `auth login`,
  `drive put`, `drive ls`, `drive get`, diffing round-tripped bytes.
- **Non-TTY**: `--json` is stable and no prompt blocks when stdin is not a
  terminal.

---

## Verification

`pnpm run dev` serves PocketBase on **7101** (Expo on 7102, proxy on 7100) —
not 8090. Confirm with `grep 'Server started'` on the dev output before
assuming a port.

```sh
# OAuth metadata + device flow against a dev server
cd ~/code/tinycld/tinycld && pnpm run dev
curl -s localhost:7101/.well-known/oauth-authorization-server | jq
curl -s -X POST localhost:7101/oauth/device -d 'client_id=tinycld-cli&scope=drive:read' | jq

# Generator emits the extension file for the installed package set
pnpm run packages:generate
cat cli/cli_extensions.go        # expect mail + drive Register calls

# Build + cross-compile
cd cli && go build -o /tmp/tinycld . && /tmp/tinycld --help
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o /tmp/tinycld.exe .
GOOS=linux   GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/tinycld-linux .

# End to end
/tmp/tinycld auth login localhost:7101
/tmp/tinycld drive put ./README.md /
/tmp/tinycld drive ls --json
/tmp/tinycld drive get /README.md /tmp/rt.md && diff README.md /tmp/rt.md
/tmp/tinycld mail search "invoice" --limit 5

# Checks
cd ~/code/tinycld/tinycld && pnpm run check
cd cli && go test ./... && cd ../core/server && go test ./oauth/...
cd ~/code/tinycld/mail/cli && go test ./...
```

Confirm in the app: Settings → Personal lists the grant under "Connected
apps"; revoking it makes the next CLI call fail with a clear re-login message;
Settings → About offers the correct platform binary.

---

## Build order

1. **OAuth core** — collections, `core/server/oauth`, device grant, token
   endpoint, grant middleware (registered below
   `DefaultLoadAuthTokenMiddlewarePriority`), scope registry. Registered in
   `registerSharedCore`. Includes the `image_proxy` token-type fix.
2. **Consent + revocation UI** — `/oauth/authorize`, "Connected apps" in
   Settings → Personal.
3. **CLI skeleton** — `tinycld/cli`, Cobra root, context/config, keychain,
   device-flow client, output renderers.
4. **Manifest + generator** — `cli` block in both type declarations,
   `gen-cli.ts`, `go.work`, tests.
5. **Typed API payloads** (deliverable B) — in order: reconcile the duplicate
   stale `MailDomains`; fix the two live bugs (BCC migration + persistence,
   verify-domain `saved` handling), each with a test; define one exported Go
   struct per request/response; add the `go/ast` payload emitter; migrate the
   TS hooks onto the generated types; add the golden-file test. Ships before
   the package commands so `drive`/`mail` CLI code is written against generated
   types from the start. The `"messageID"` → `"message_id"` normalization is a
   separate commit.
6. **drive commands** — richest surface; proves path resolution, transfer,
   progress.
7. **mail commands** — proves search and the file-field body fetch.
8. **Build pipeline + distribution** — cross-compile step, download endpoints,
   About panel, help topics.
9. **Authorization Code + PKCE** — completes the AS for Zapier; register Zapier
   as a confidential client.
10. **contacts / calendar / text / calc** — repeat the pattern.

Steps 1–4 are sequential. Step 5 can run alongside 3–4 (it touches the server
and web client, not the CLI) but **must land before 6 and 7**, so package
commands are written against generated types rather than hand-copied shapes.
6 and 7 then parallelize. Step 9 is independent of the CLI once 1 lands.

## Out of scope

Code signing and notarization; Homebrew/winget/Scoop; an auto-updater; dynamic
client registration (RFC 7591); and any offline/cached mode.

**Asymmetric signing and a published JWKS** are explicitly deferred. Tokens are
HS256 and validated by us, which is sufficient for the CLI and for Zapier
(which calls `/oauth/userinfo` rather than verifying signatures itself).
Supporting RS256/ES256 `id_token`s would require bypassing PocketBase's
HS256-only `tools/security`, writing key management and rotation, and serving
`/.well-known/jwks.json` — PocketBase's own `tools/auth/internal/jwk` is
`internal/` and parse-only, so there is nothing to reuse. Revisit if an
integration needs to verify tokens offline.
