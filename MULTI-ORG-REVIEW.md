# Multi-org transition — pre-merge review

Nine repos reviewed on their `multi-org` branches vs `origin/main`, across eight
parallel review streams: the router (`multi-org`), the app shell + `core` TS
(tinycld #138), `core/server` Go (tinycld #138), the PocketBase fork
(`feat/multitenant-fork`), and the seven feature siblings. Findings marked
**[verified]** were re-read against source with accurate `file:line`.

**Scope note.** This review is layered on top of the completed
`REVIEW-TODO.md` remediation (all critical/high/medium items merged). Every
stream was asked to confirm that the multi-org rework preserved those fixes
rather than re-report them. **It did** — see §0.

---

## Remediation status — 2026-07-29

All nine repos are **green in CI** on their `multi-org` branches. Fixed and
pushed since this review was written:

| Item | Where |
|---|---|
| §4.1 H1 tenant uid collisions → allocator | multi-org `6215f42` |
| §4.2 H2 evict-during-spawn, H5 TMPDIR | multi-org `6215f42`, `5925bc8` |
| §4.2 H3 planted socket dir | multi-org `af9b7f0` |
| §3 fork `ATTACH DATABASE` → `NoAttachDBConnect` | pocketbase `4fef8afa`, wired multi-org `48cdd49` |
| §1 B1 dead Drive nav | drive `c598ec2` |
| §1 B3 share-link guest role | drive `58b97bd` |
| §1 B2 standalone operator lockout, B4 `org_pkg_access`, B9 color tokens, B8 install specs | tinycld `fc568e5` |
| F12 gofmt | tinycld `fc568e5` |
| Drive click contract (single=select, double=open) | drive `a9e268e` |

Also fixed, found while getting CI green (not in the original review):

- **Feature CI assembled siblings from `main`**, so six repos typechecked
  against a core predating the branch. Now resolves the PR's branch when one
  exists — see `tinycld/CONTRIBUTING.md` "Pinning members to a branch or tag".
- **`@biomejs/biome: ~2.5.0`** floated to 2.5.6 in CI (which installs with
  `--no-frozen-lockfile`, necessarily) while the lockfile pinned 2.5.1. The two
  disagree irreconcilably on formatting, so a check passed locally and failed
  in CI on untouched files. Pinned exactly: tinycld `323fe4e`.
- **E2E gated on URLs rather than rendered screens** — 46 `waitForURL` calls
  reduced to 1. See §11.

### Tier 3 security — done 2026-07-29

All six items are fixed, each with a test confirmed red against the prior code
first. Committed and pushed to the five open `multi-org` PRs (tinycld #138,
mail #42, calendar #29, drive #48, contacts #25) — all checks green.

| Item | Fix |
|---|---|
| §2.1 mail IMAP/SMTP ignore `disabled` | `disabled` check in `imap_session.go` Login + `smtp_session.go` authenticate (both authenticate against the record directly, so PB's auth hooks never ran). `mail/server/disabled_protocol_test.go` |
| §2.1 drive `/api/drive/search` | `driveshare.IsSuspended` (new, exported so the definition stays single-sourced) called in `searchDriveItems` — covers the HTTP route and the `$drive.search` binding together. `drive/server/search_disabled_test.go` |
| §2.1 contacts rules | `contacts/pb-migrations/1830000000` adds `@request.auth.disabled != true` to all five rules; new `contacts/server/disabled_rls_test.go` (contacts had no RLS suite at all) |
| §2.2 guest auto-provisioning | `role == "guest"` early-return in both `handleUserCreated`s; `mailboxes.tsx` picker now excludes guests + disabled. Two `guest_lifecycle_test.go` |
| §2.3 calendar membership repoint | `calendar/pb-migrations/1830000008` appends the `@request.body.calendar` pin. `member_repoint_rls_test.go` |
| §2.3 WebDAV parent authz | `resolveParentByPath` now takes the user and requires read on the parent, masking a denial as `ErrNotExist`. `webdav/parent_authz_test.go` |
| §7 F1 WebDAV temp collision | `persistWrite` renames into a per-upload `os.MkdirTemp` dir instead of the shared process temp dir. Same test file (the concurrent case failed outright before) |
| §7 F4 DAV challenge throttling | Fixed in `davauth` rather than per-route: a credential-less request is excluded from the limiter entirely, so CalDAV/WebDAV get what carddav's route-level challenge-first ordering already gave it. `davauth/challenge_throttle_test.go` |
| §8 fresh-provisioning guard | `core/server/pb_migrations/1000000000_refuse_legacy_org_database.js` — sorts before every other migration, throws naming the legacy collection (`user_org`/`orgs`) if one exists. `coreserver/fresh_provision_guard_test.go` (red-first) also pins the sorts-first ordering. tinycld `01384c1` |
| §5 silent mutation failures | Default `onError` in the `useMutation` wrapper (`core/lib/mutations.ts`): failures without an explicit handler now toast (`mutation.error`) + `captureException`; an explicit `onError` replaces the default, so form handlers behave as before. Red-first tests in `mutations.test.tsx`; guidance added to `CONTRIBUTING.md`. tinycld `77f3332` |
| §6 last org-owner guards | `RegisterLastOwnerGuard` (core) rejects demoting/disabling/deleting the last *enabled* owner (superusers bypass); shared check in `/api/account/{disable,delete}` and `/api/admin/users/offboard`, which save below the request hooks. `MembersDrawer` role picker now disables for the last owner. Red-first `last_owner_guard_test.go`. tinycld `9cf07cb` |
| §6 audit_logs guest/member read | `1960000000_audit_logs_admin_only.js`: list/view tightened from non-guest to owner/admin + `disabled != true`, matching the isAdmin-gated screen. Red-first member-denied/admin-allowed tests in `guest_rls_test.go`. tinycld `9cf07cb` |
| §6 mail shared-mailbox roster RLS | mail `1830000004` ports calendar's `1830000007`: member rows visible to the mailbox's members, delete = self-leave ∨ mailbox owner. New rlstest-driven `member_share_rls_test.go` (runs the shipped migrations). mail `1e59bed` |
| §6 mail last mailbox-owner | `registerMailboxLastOwnerGuard` rejects demoting/deleting a mailbox's last owner row (the role toggle had no check anywhere); drawer toggle now disables alongside remove. Red-first `mailbox_owner_guard_test.go`. mail `1e59bed` |
| §6 denied-package bookmark + guest dead end | `PackageAccessDenied` overlays the content area (and hides the sidebar) when the active package resolves to `none` — `usePkgAccess` finally has a caller; `GuestEmptyState` replaces the silent Settings redirect for zero-package guests. `use-pkg-access.test.tsx` covers level resolution. **`readonly` remains advisory** — no server-side write distinction; rules stay the data authorization. tinycld `fa2ec69` |

Verified: `go test ./...` green in core/server, mail, calendar, drive, contacts;
`tinycld-pkg check` (biome + tsc + vitest) green in all four features; gofmt
clean (also fixed pre-existing import-order drift in `drive/server/register.go`).

### Tier 4 operational hardening — done 2026-07-29

All five items fixed red-first (the linux-gated chownTree test and the root
confinement suite were verified in a privileged linux container before push).

| Item | Fix |
|---|---|
| §4.2 H4 admission control + LRU | `Config.MaxResident` (`MT_MAX_RESIDENT_ORGS`): at capacity the LRU idle instance is evicted to admit a newcomer; refused with 503 when every resident org has tracked connections. `Config.MaxConcurrentSpawns` (`MT_MAX_CONCURRENT_SPAWNS`, default 4) bounds cold-start stampedes, waiters bounded by the spawn timeout. `admission_test.go` (3 red-first tests). multi-org `b62192b` |
| §4.3 M2 unwrapped load errors → 404, unlogged | `noteLoadFailure` in Get's singleflight path: non-sentinel host failures (pruned package version, full disk, config write) wrap `ErrOrgUnavailable` → 503 + Retry-After, and every load attempt logs exactly once (Error for host problems, Debug for unknown-slug probes). Also surfaces spawn/readiness failures that previously reached no log. multi-org `18f4306` |
| §4.3 M3 chownTree walks storage per spawn | The walk prunes at entries the tenant uid already owns (only the tenant creates files under its uid); the orgDir root's 0700 gate is still re-enforced every spawn, so pruned subtrees stay unreadable to sibling uids. Host-written files stay root-owned between spawns and are still processed. `chown_tree_linux_test.go`; `TestConfinement_CannotAttachAnotherOrgsDatabase` re-verified. multi-org `0515939` |
| §4.3 M1 accept error kills mail listeners | `acceptLoop` retries transient errors with capped exponential backoff (5ms→1s, reset on success), exits only on shutdown/`net.ErrClosed`, and stays responsive to Shutdown mid-backoff. Two red-first tests in `mailrouter_test.go`. multi-org `3da239d` |
| §4.3 M9 switcher cookie carries attacker URL | Entries are `{slug, name}` only; slugs validated as single lowercase DNS labels on both parsers; the client derives `https://<slug>.<parent-of-current-hostname>` (`orgUrlForSlug`) — data the cookie cannot influence. Legacy `url` fields parse and are shed. multi-org `1265031` (orgcookie + serve-org + e2e pin), tinycld `56751db` (org-cookie.ts, useUserOrgs) |

### B5/B6/B7 — done 2026-07-29

| Item | Fix |
|---|---|
| B7 blank tab + raw plain-text errors | New `multi-org/internal/webpage`: one branded, dark-mode-aware HTML shell for every router-served page. 503 (spawning/crash-backoff), restart, and 502 proxy-failure responses are auto-refreshing interstitials for browser navigations and PocketBase-shaped JSON (`{code,message,data}`) for everything else (fetch/curl/DAV). Browser navigations to a cold org now wait a bounded 3s (`htmlWaitBudget`) before getting the interstitial — the spawn continues off-request and each refresh re-joins it — instead of a blank tab for up to 45s. `instance.go`'s restart/502 paths use the same pages. Red-first tests in `webpage_test.go` + `frontrouter_test.go`. |
| B6 apex redirect loop + org discovery | The apex serves an **org-finder page** instead of 302-ing to itself: lists the orgs from the `tinycld_orgs` cookie (URLs derived from `location.hostname`, never from the cookie — same invariant as the switcher) plus a go-to-slug form; `www` still 302s to the now-working apex. Client side, the user-menu switcher gains "Open another organization…" linking to the apex (`useApexUrl`/`apexUrlForHost`, null on standalone deployments so the entry hides). |
| B5 mail hostname docs + UI | Help bodies now support a `{{server-host}}` token substituted with the deployment's real hostname at render time (`core/lib/help/tokens.ts`, whole-body so it works in code blocks). `mail/help/imap.md`/`smtp.md` rewritten around it: the server is the org's own web hostname (SNI demux), with an explicit "not `mail.yourdomain.com`" callout, a BYE-on-wrong-hostname troubleshooting entry, and `-servername` on the openssl probe. Token documented in `CLAUDE.md` + `CONTRIBUTING.md`. |

### §9 help drift + §7 correctness — done 2026-07-30

§9 (all items): calendar gained a client-facing CalDAV setup topic
(`calendar/help/caldav.md`, modeled on contacts' carddav.md). The IMAP/DAV
username inconsistency was fixed at the product level, not just docs: mail's
IMAP/SMTP now authenticate via the new `davauth.VerifyCredentials` (username
OR email + dummy-hash timing defense + disabled cutoff — single-sourced with
DAV), and every help topic + the Recovery-Email hint now says so. text/calc
help de-orged; contacts/drive help swept to `{{server-host}}`; the
"Organization" settings page is renamed **Storage** (route, nav, title);
stale role/provider blurbs corrected (owner blurb, "ask an org owner to
install", provider-not-configured copy).

§7 leftovers (all four, red-first):

| Item | Fix |
|---|---|
| IMAP folder union | `folderToFilter` now pins `thread.mailbox` on every branch — INBOX/status/virtual folders scoped to the selected namespace. `imap_mailbox_scope_test.go`. mail `a9452e1` |
| If-Match/If-None-Match ignored | New `core/server/davcond` enforces RFC 9110 PUT preconditions; both CalDAV and CardDAV backends consult it (412 + write refused). `precondition_test.go` twins. tinycld `ce7db91` |
| DAV DELETE hard-deletes | `webdav.Source.Trash` binds drive_item_state: DELETE stamps `trashed_at` (restorable from the Trash screen), trashed entries vanish from that user's DAV view, per-user semantics preserved. Carried through manifest → controlplane → davconfig wire with round-trip test. tinycld `ce7db91`, drive `dfda510`, multi-org `937775f` |
| davauth XFF trust | Forwarded headers count only when `Settings().TrustedProxy` names them (PB's own RealIP switch, which the router materializes for tenants), keyed on the proxy-appended rightmost entry — closing both the rotate-to-bypass and spoof-victim-lockout moves. `ratelimit_spoof_test.go`. tinycld `ce7db91` |

### Still open
- **§6: `readonly` server-side enforcement** — the level is now surfaced and
  `none` is gated in the UI, but nothing server-side rejects writes for a
  `readonly` grant; it would need a per-package collection map in Go. The
  denied-bookmark and guest dead-end UX are done (see table above).
- ~~**§9** — the help topics (calendar CalDAV setup, IMAP username guidance)
  remain unwritten.~~ (**DONE** — see "§9 help drift + §7 correctness" above.
  §8 was already closed: the decision is in `CLAUDE.md` and the guard
  migration enforces it.)
- **Calc parallel flakiness** — ~2 of 87 under `--workers=4`, a *different*
  pair each run, on unmodified code. Not caused by this branch; "different
  victim each run" points at shared state between workers.
- **The PocketBase fork branch `feat/multitenant-fork` exists only on one
  developer's disk.** The vendored copy in `tinycld/third_party/pocketbase` is
  what builds, so nothing is blocked — but that commit is single-copy.

---

## §0 — Prior remediation: preserved (good news first)

Every previously-remediated security fix was verified intact through the hoist
to core, and several are now **stronger** than before:

| Fix | Status |
|---|---|
| drive#35 WebDAV per-item ACL | Stronger — `webdav/filesystem.go` delegates every verb to the PB rule engine via `CanAccessRecord` |
| text#33 embed IDOR + traversal | Intact — `drive_items` allowlist + `driveshare.CheckRead`, tests carried forward |
| mail#30/#31/#33 webhook authz, image-proxy SSRF, CSS `url()` | Intact — `verifyAdmin`, pinning/redirect re-validation, `sanitizeInlineStyles` |
| calendar#20/#21 self-promote guard, ICS SSRF | Intact and strengthened (target-calendar ownership added) |
| calendar#22 / contacts#18 bare-username DAV auth | Centralized in `core/server/davauth`, plus a new disabled-user cutoff |
| contacts#19/#20 soft-delete, deleted-view search | Intact via `SoftDeleteField` + FTS `IncludeDeleted` |
| drive#36/#37 quota reconcile, folder cycles | Intact, with correct hook ordering in both compositions |
| calc#35/#36/#37/#44 mentions, pivot range, float bootstrap, CSV injection | All intact with tests |
| core session teardown, superuser scoping, pkg-access fail-closed, theme XSS, `pb.filter` | All intact |

The architectural decision to make hoisted protocol servers delegate
authorization to the PocketBase rule engine **structurally eliminates the drift
class** that produced the original findings. The tenant composition-parity test
is the same idea applied to configuration.

---

## §1 — Blockers: primary user journeys are broken

These are not security issues; they are "the feature does not work."

- **B1 — Drive navigation is entirely dead.** `[verified]`
  `drive/tinycld/drive/hooks/useDriveNavigation.ts:39` builds `` `/a/${orgSlug}/drive` ``,
  but `core/lib/use-org-info.ts:48` now hardcodes `orgSlug: ''` and `tinycld/app/`
  has no `a/` directory. Every sidebar section, folder double-click, and
  breadcrumb resolves to `+not-found`. Drive is unusable past its root screen.
  **Fix:** `const driveBase = '/drive'`. The sibling fix already exists in
  `drive/tinycld/drive/lib/share-routing.ts:76` with a `not.toContain('/a/')`
  regression test worth copying.

- **B2 — Standalone self-hoster is locked out of member management.** `[verified]`
  `core/server/coreserver/setup_bootstrap.go:218` mints the first operator as
  `role: "member"`, but `settings/members.tsx:114` gates on `isAdmin` and
  `/api/invite-member` rejects non-admins (`invite.go:60,86-88`). The /admin
  console has no role management. A fresh self-hoster finishes the wizard and
  can never invite anyone. Router-provisioned tenants get an owner from the
  control plane; the standalone path has no equivalent.
  **Fix:** mint the operator as `owner`.

- **B3 — Share-link guests cannot sign in at all.** `[verified]`
  Migration `1940000000` made `users.role` required;
  `drive/server/endpoints_share_otp.go:340-346` creates guest users without it
  before `app.Save`. Every other user-creator was updated; this one, in a
  different repo, was missed. The regression test masks it
  (`endpoints_share_otp_test.go:90-97` registers the field as `Required: false`).
  **Fix:** `rec.Set("role", "guest")` before Save; fix the test fixture.

- **B4 — Package-access panel is inert; guests can never be granted anything.** `[verified]`
  `org_pkg_access` has `createRule/updateRule/deleteRule: null` (superuser-only)
  — `pb_migrations/1700000000:149-151`, never relaxed. `PackageAccessPanel.tsx`
  reads other users' rows (always empty) and writes (always 403) with no
  `onError`: toggles silently no-op. Since guests get packages *only* via such a
  row, this compounds B3.
  **Fix:** migration granting admin-predicate CRUD; add `onError`.

- **B5 — Mail client setup instructions cannot connect.** `[verified]`
  The router demuxes IMAPS/SMTPS strictly on TLS SNI = `<slug>.<baseDomain>`
  (`mailrouter.go:214-221`), but `mail/help/imap.md` and `smtp.md` tell users
  "your TinyCld hostname (e.g. `mail.example.com`)" — which yields an empty slug
  and a uniform `* BYE service unavailable`, indistinguishable from an outage.
  The documented troubleshooting step (`openssl s_client -connect
  mail.example.com:993`) *succeeds*, confirming the wrong diagnosis. No UI shows
  a user their actual mail hostname.

- **B6 — Multi-org users cannot find their other orgs; the apex redirect-loops.** `[verified]`
  The switcher lists only orgs the browser has already logged into (cookie).
  A member of three orgs who signed into one sees no switcher and no discovery
  path. The natural recovery URL self-redirects: `frontrouter.go:33-36` 302s
  `""`/`www` to `https://<base>`, and `Subdomain()` returns `""` for the apex
  → `ERR_TOO_MANY_REDIRECTS` on the product's front door.

- **B7 — Cold start / restart / crash present as blank tab then raw plain-text.** `[verified]`
  `Get` blocks up to 45s (`manager.go:206-232`) showing a white tab, then emits
  unstyled `text/plain`: `organization temporarily unavailable`,
  `organization is restarting`, `organization backend unavailable`. With 30-min
  idle eviction, the cold start is the every-morning case.
  **Fix:** one branded auto-refreshing interstitial; JSON body for the SPA.

- **B8 — The install/docker smoke suite cannot pass.** `[verified]`
  `tests/install/*.spec.ts` (6 call sites) still `goto('/admin')` for the setup
  wizard and superuser login, but `app/admin.tsx` was deleted and replaced by
  `app/setup.tsx`. `tests/e2e/admin.spec.ts:16` was correctly updated; the
  install specs were not — the suite was evidently not run. This is the only
  automated guard on the first-run bootstrap flow.

- **B9 — New destructive dialogs use color tokens that don't exist.** `[verified]`
  `OffboardDialog.tsx:60,81,86` uses `text-error` / `bg-error` / `text-on-error`.
  The token universe has `danger`/`danger-soft`, no `error`. Tailwind v4 emits
  nothing for unknown color utilities, so the "Disable my account" and "Remove
  member" confirm buttons render with **no background**.

---

## §2 — Cross-cutting security themes

Three themes recurred independently across four review streams. Each is one
ecosystem-level fix, not N per-repo patches.

### 2.1 — Disabled accounts keep working until token expiry `[verified]`

`coreserver/disabled_guard.go` binds only `OnRecordAuthWithPasswordRequest` /
`OnRecordAuthRequest` — it blocks *issuing* tokens, not *using* them. Live
tokens therefore retain access:

- **mail** — `imap_session.go:64-71` and `smtp_session.go:84-103` call
  `FindAuthRecordByEmail` + `ValidatePassword` directly, bypassing auth hooks. A
  disabled account keeps reading every mailbox and sending as the deployment's
  domain over :993/:465 **indefinitely** (no token expiry involved).
- **drive** — `/api/drive/search` (`search.go`, gated only by `requireAuth`)
  returns names, sizes, and FTS content highlights of everything shared with the
  user. Every other drive read path denies disabled accounts.
- **contacts** — no contacts rule carries `@request.auth.disabled != true`;
  calendar's `1830000004` added it, contacts didn't follow.

Mail's is the serious one: it is not time-bounded. Note also that
`endpoints_inbound.go:237-243` justifies continuing delivery to disabled users
on the premise that "IMAP ... [is] closed by the disabled guards" — false for
mail's own listeners.

### 2.2 — Guests are auto-provisioned resources they're excluded from `[verified]`

Both `mail/server/register.go:214-219` and `calendar/server/register.go:144-147`
hook `users` create with **no role check**, while core's invite flow creates
guests as real `users` rows. So a share-link guest silently receives:

- a working `<username>@<verified-domain>` mail identity plus an owner
  membership — which passes `verifyMailboxMembership`, grants IMAP login, and
  receives inbound mail;
- an auto-minted personal calendar with an owner membership.

Both contradict guest-exclusion migrations shipping *in the same branches*
(`mail/pb-migrations/1830000003:15-16`, `calendar/1830000003`).
**Fix:** early-return on `role == "guest"` in both hooks. Also
`mail/tinycld/mail/settings/mailboxes.tsx` lists every `users` row (including
guests and disabled accounts) in the add-member picker.

### 2.3 — Rules-only authorization has gaps the Go guards currently hide `[verified]`

The branch's security narrative (`tenant_rules_authz_test.go:13-20`) is that for
a hosted tenant "the rule is the entire authorization." Two places don't hold:

- **calendar** — `calendar_members.updateRule` evaluates the back-relation
  against the row's *stored* calendar and never pins `@request.body.calendar`.
  An owner of any calendar can PATCH their own membership row onto a victim's
  calendar with `role: "owner"` intact. Blocked today by the Go field-guard, but
  that is exactly the composition drift the branch's own
  `FINDING-tenant-composition-gap.md` documents.
  **Fix:** append `&& (@request.body.calendar:isset = false || @request.body.calendar = calendar)`.
- **core WebDAV** — `resolveParentByPath` never checks the caller can read the
  destination parent (`filesystem.go:371-374`, `:424-427`, `:512-515`), and
  drive's createRule has no parent clause. A member can plant records inside
  another user's unreadable folder (squatting the `(parent,name)` unique index)
  and distinguish "parent exists" from "doesn't" — re-opening the existence
  oracle the elaborate 404-masking closes for leaf names.

---

## §3 — PocketBase fork: sandbox scope vs. the kernel boundary

Two escapes were **verified by execution** in the fork's jsvm sandbox:

- **`$app` → SQLite `ATTACH DATABASE` = arbitrary host file read/write.**
  `Sandboxed` withholds `$os`/`$filesystem`/`$filepath`/`$http` but leaves `$app`
  fully bound, and `$app.nonconcurrentDB()` / `runInTransaction()` reach raw SQL.
  Reproduced three ways, including creating a file at an arbitrary path.
- **Tenant JS migrations register into the process-global `core.AppMigrations`**
  and execute against other tenants' databases. Reproduced: tenant A's migration
  created a table in tenant B's DB, where B had no jsvm plugin at all. The fork
  is aware of the symptom — `sandbox_test.go:146-150` snapshots and restores the
  global "so this test's migration doesn't leak into other tests" — but treats it
  as test hygiene rather than the production defect it describes.

**Severity is reduced by the router's confinement, which anticipates exactly
this** — `spawn_linux.go:181-206` (`chownTree`) narrows every tenant file to
0600/0700 under a per-tenant uid, and its comment names the cross-org `ATTACH
DATABASE` read as the thing that boundary exists to close. Since the production
topology is one org per process, the global-migrations escape is likewise
contained.

**But that mitigation is not reliable, because of router finding H1
(§4.1 below).** Tenant uids are FNV-hash-modulo-range with no collision
detection (`spawn_linux.go:47-51`), so any two orgs whose slugs collide share a
uid — and for that pair, `chownTree`'s modes, uid separation, and the `ATTACH`
defense all evaporate simultaneously. At 50 orgs in a 1000-uid window the
probability that *some* pair collides is ~71%. **So the fork's sandbox escape
and the router's uid collision compose into a live cross-tenant read**, and
neither layer catches it alone.

The confinement code is also honest about when it is absent entirely: macOS is a
documented non-boundary (`spawn_darwin.go:9-16`), and non-root or unset
`MT_TENANT_UID_BASE` logs "Tenants are NOT confined" (`spawn_linux.go:70-76`).

**Recommendation: fix H1 and close `ATTACH` via a `DBConnect` authorizer.**
Either alone leaves the other as a single point of failure; both are cheap.

Also from that stream: **no execution guard at all** — a hostile package's
`while(true){}` hangs tenant boot forever (verified; no `Interrupt` or
`SetMaxCallStackSize` anywhere), and **`.pb.ts` hooks using `export` fail to
load** because esbuild emits ESM into a script-mode compile
(`transform.go:34-38` sets no `Format`), with the error pointing at the
generated wrapper rather than the author's file.

The vendored copy at `tinycld/third_party/pocketbase` is byte-identical to the
fork HEAD — no stale-vendor risk.

---

## §4 — Router (`multi-org`): the layer around the boundary

The isolation architecture itself is sound. The reviewing stream found **no way
for org A's HTTP or IMAP traffic to reach org B**, no SNI/cookie/slug confusion,
and no host-secret leakage into a child; the remediation history shows the hard
lessons were absorbed (socket-per-org, inode-guarded unlink, allowlist env,
fate-before-accounting in the supervisor). What is not ready is the layer
*around* that boundary.

### 4.1 — H1: hash-assigned tenant uids with no collision detection `[verified]`

`spawn_linux.go:47-51` — `base + fnv32(slug) % span`, no registry, no
persistence, no collision check. Two orgs can receive the same host uid, and for
that pair uid separation, `chownTree`'s 0600/0700 modes, and the cross-org
`ATTACH DATABASE` defense all fail at once. Nothing logs it; `TestConfinement_*`
asserts "distinct non-root uids" for two fixtures that happen not to collide.

The in-code comment calls collisions "benign for isolation between *most* pairs
but not all" — this understates it. A collision is a **total boundary failure**
for the pair, not a degradation, and at realistic tenant counts it is likely
rather than rare: ~71% for 50 orgs in a 1000-uid window; ~99.9% for 1000 orgs in
65536. **This is the single blocking finding in the repo**, and it is what turns
§3's sandbox escapes from theoretical into reachable.

**Fix:** allocate from a persisted registry (a `uid` field on the `orgs` record,
"min unused in window"), or at minimum keep `map[uid]slug` and refuse to spawn +
log at Error on a second slug mapping to a live uid.

### 4.2 — Other high findings `[verified]`

- **H2 — `Evict` during an in-flight spawn is a no-op**, so suspend, archive, and
  deploy silently fail to take effect. `Evict` only inspects `m.orgs`; a loading
  instance isn't in the map yet, and `load` publishes unconditionally. Suspend an
  org mid-cold-start and it keeps serving every request — and the traffic
  refreshes `lastUsed`, so the idle sweep never fires either. Same shape for
  Deploy (org keeps serving the old package generation while the control plane
  reports the new lockfile). **Fix:** a per-slug epoch bumped by `Evict`, checked
  before publish.
- **H3 — fallback socket dir under world-writable `os.TempDir()`**, chowned and
  chmodded through symlinks. When `MT_ROOT` is deep enough to overrun `sun_path`,
  sockets move to `<tmp>/mt-<hash(MT_ROOT)>/<slug>/` — a path predictable from
  the unit file. A local user pre-creating that path as a symlink to `/etc` gets
  `/etc` chowned to the tenant uid by the root-running spawner. **Fix:** root-owned
  `/run/tinycld-mt/`; `Lstat` + `O_NOFOLLOW` before chown/chmod.
- **H4 — no admission control.** No cap on concurrent spawns or resident
  instances. One HTTP request per enumerable slug brings up every org's
  PocketBase process; idle eviction is 30 min and `lastUsed` refreshes per
  request, so one request per org per 29 min holds the whole set resident.
  `MT_TENANT_MEMORY_MAX` bounds one tenant, not the aggregate. The 503-vs-404
  split in `frontrouter.go:45-58` supplies the enumeration primitive.
- **H5 — `TMPDIR` points at a directory nothing creates.** `spawn_exec.go:112`
  sets `TMPDIR=<orgDir>/tmp`; neither `CreateOrg`, `Materialize`, nor `serve-org`
  ever creates it (grep-confirmed). `os.TempDir()` doesn't check existence, so
  every `os.CreateTemp` fails ENOENT — meaning **every upload over 16 MB fails**
  with an opaque 500, on every hosted org. One `MkdirAll` fixes it.

### 4.3 — Operator-experience findings `[verified]`

- **M2 — load failures return unwrapped errors → the front router answers 404,
  and nothing is ever logged.** Only `spawn` wraps `ErrOrgUnavailable`; a pruned
  package version or a full disk during `writeAppConfig` yields **404 "no such
  organization"** — indistinguishable from a deleted org. Neither `load` nor the
  front router logs the cause, and `serve-multi`'s `GetOrg` closure discards it.
  The customers see a dead domain; the operator sees nothing; the control plane
  still says `active`. Flagged by the reviewer as the worst self-hoster
  experience in the repo, and I agree.
- **M3 — `chownTree` walks the whole org tree on every cold start**, including
  `pb_data/storage`. An org with 400k stored files exceeds the 45s `spawnTimeout`
  before `cmd.Start` is even reached, then enters crash-loop backoff — it can
  never complete a boot.
- **M1 — a single `Accept` error permanently kills the mail listeners.** Any
  non-shutdown error ends the accept goroutine while the listener stays bound, so
  :993 accepts TCP and then hangs forever. An fd exhaustion burst (a *temporary*
  error) silently kills mail with no crash and no alert.
- **M6 — package publish is neither atomic nor repairable.** A partial write
  leaves a version directory that every retry refuses as "already published
  (immutable)"; the only recourse is `rm -rf` inside the store by hand.
- **M9 — the switcher cookie carries an attacker-controlled URL.** Non-HttpOnly,
  `Domain=.<baseDomain>`, and its `url` is the switcher's navigation target — so
  JS on any tenant can rewrite another org's entry to point at a login clone.
  The "authorizes nothing" design note is true of the authorization model but
  misses the phishing primitive. **Fix:** drop `url`; derive it from the slug.
- **M4** 5-minute `WriteTimeout` truncates SSE and large transfers, contradicting
  the care taken to keep `/api/realtime` alive. **M5** `autocert` accepts every
  SNI (Let's Encrypt rate-limit DoS) with a CWD-relative cache. **M7** manifest
  eval can OOM the router and take every tenant with it. **M8**
  `validateDAVPrefix` accepts `/api`, letting a manifest shadow PocketBase's API
  namespace. **M10** the MX frontend has no `MaxRecipients` and cold-starts one
  tenant per target org inside a single transaction. **M11** spliced mail
  connections have no idle deadline and pin an org resident forever.

---

## §5 — Silent mutation failures (a systemic UX pattern)

There is no global mutation error handler (`core/lib/pocketbase.ts:142-149`), so
every mutation without an explicit `onError` fails as an optimistic update that
silently reverts. Confirmed instances:

- `MembersDrawer.tsx:115-121` (role change), `:135-141` (setDemo)
- `PackageAccessPanel.tsx:32-65` (both — always 403, see B4)
- `NotificationDrawer.tsx:125-151` (markAllRead / markRead / dismiss)
- `drive/hooks/useDriveMutations.ts:35-129` — star, trash, permanentDelete,
  createFolder, rename, **share, unshare**. Only `moveMutation` has `onError`,
  and its own comment explains why that's wrong for the others.
- `calendar/hooks/useCalendarData.ts:71-93` (colorMutation — the sole straggler
  after this branch added `onError` to every other calendar mutation)
- `mail/settings/MailboxDrawer.tsx:405-432` (all three member mutations)

Worth fixing as one default `onError` in the `useMutation` wrapper rather than
36 call sites.

---

## §6 — Role and permission defects

- **Last org owner can be demoted to zero owners.** `[verified]`
  `MembersDrawer.tsx:104-105`: `isLastOwner` is computed and passed to
  `RolePicker`, but it only drives **helper text** — `optionDisabled` derives
  solely from `canChangeRole`, which is true for an owner viewing another owner.
  The message "This is the last owner. Promote someone else first" renders
  directly above pressable controls that do the opposite. No server backstop in
  `users_guard.go`. Result: an unrecoverable zero-owner org (non-owners cannot
  assign `owner`). `calendar/MembersSection.tsx:47-56` is the correct pattern.
- **Mail's last mailbox owner can self-demote** the same way
  (`MailboxDrawer.tsx:452-462`), contradicting shipped help that says removing
  the last owner is blocked.
- **Mail shared-mailbox roster is broken and silent** — rules are self-only for
  list/view/delete and owner-only for create/update
  (`mail/pb-migrations/1713000000:497,538-545`), so an owner sees "1 member",
  adds a teammate (row vanishes on reload), and remove 403s. Calendar hit and
  fixed the identical bug in `1830000007` — port it.
- **`readonly` package access is unenforced dead code** — `usePkgAccess` has
  zero callers and the `<slug>/_layout.tsx` re-exports have no guard, so a denied
  user's bookmark renders the full UI over empty collections, reading as data
  loss.
- **Guest dead end** — with zero accessible packages, guests are redirected to
  Settings, which shows only "Personal": no explanation, no way back to the
  shared document.
- **audit_logs list/view widened** to `@request.auth.id != ""`, so a guest can
  read the full audit trail (member emails, role changes) over REST; the UI gates
  on `isAdmin` but the rule doesn't.

---

## §7 — Notable correctness findings

- **F1 — WebDAV temp-file rename collision** `[verified]`, new in this diff.
  `webdav/file.go:149-155` renames uploads to `$TMPDIR/<user-chosen basename>` —
  the one shared process temp dir. Two concurrent PUTs of the same basename by
  *any* two users collide: `os.Rename` silently replaces, so user A's record can
  ingest user B's bytes. **Fix:** `os.MkdirTemp` per upload.
- **IMAP folders union across all of a user's mailboxes** `[verified]` —
  `imap_session.go:917-948` filters thread state by `user + folder` only, and the
  `mailboxID` parameter is now dead. A user in Personal + `support@` sees support
  threads in `Personal/INBOX`, with unseen counts inflated to match. The
  multi-mailbox namespace UI implies a separation no longer enforced.
- **If-Match / If-None-Match ignored on CalDAV+CardDAV PUT** `[verified]` —
  both backends take `_ *PutOptions`, and go-webdav delegates precondition
  enforcement to the backend. Concurrent edits lose data with no 412.
- **DAV challenge requests count as auth failures** `[verified]` — every client's
  standard credential-less first request lands in the `(ip, "")` throttle bucket
  that `NoteSuccess` never clears; ~10 mounts behind one NAT and the challenge
  itself 429s. `carddav/register.go:32-35` does it correctly — mirror it.
- **`clientIP` trusts X-Forwarded-For unconditionally** (`davauth/ratelimit.go:159-168`)
  — bypasses the throttle on direct connections and enables a refreshable
  targeted lockout of a victim by spoofing their egress IP.
- **DAV DELETE hard-deletes**, bypassing drive's trash — Finder's "Move to Trash"
  destroys items with no restore path.
- **Custom-domain inbound mail silently hard-bounces** — the router routes
  port 25 by a superuser-only control-plane table that nothing tenant-side
  writes, while `mail/help/custom-domains.md` shows all checks green.
- **Quadratic zip entry iteration** in takeout's new streaming unzip (one full
  central-directory parse per entry) — fine for fixtures, not for multi-GB
  Takeout exports; landed alongside an e2e timeout increase.

---

## §8 — Migration strategy: needs an explicit decision recorded

Every repo performed the `user_org` → `user` rename **by editing already-shipped
migrations in place**, and no data-conversion migration exists anywhere —
including core (`51e375a`). PocketBase never re-runs an applied migration, so an
existing deployment would keep `user_org` ids in `created_by`/`user`/`owner`
columns while the rewritten rules (`created_by ?= @request.auth.id`) silently
never match, locking users out of their own data.

Three independent streams flagged this, and the branches are internally aware of
the hazard (drive's `1782100000` comment: "a migration already applied does not
run again"). The evident intent is that tenant DBs are always freshly
provisioned by the router — which is coherent — but **nothing states or enforces
it**. Recommend either a guard migration that fails loudly if a `user_org`
collection exists, or an explicit note in the PR description and `CLAUDE.md`.

---

## §9 — Help and documentation drift

Per the project's own "not done until users can find out how" rule:

- **calendar has no CalDAV client-setup topic at all** — `help/` contains only
  `caldav-hooks.md` (admin) and `dragging-events.md`, while the endpoint was
  rebuilt on this branch. Contacts' `help/carddav.md` is the model.
- **text and calc help was never de-orged** — 0 help files in either diff;
  "from your org", "your organization's Drive", "in this org" persist, and they
  cross-link the swept Drive topics.
- **IMAP/SMTP username guidance is now actively wrong** — the UI relabels
  `users.email` as "Recovery Email — not a mailbox address", yet IMAP accepts
  *only* email while DAV accepts username or email.
- **The "Organization" settings page is now just storage** — the nav label,
  title, and heading promise name/logo/slug management the process can no longer
  do; only `<StorageSection/>` remains.
- Scattered stale copy: role blurbs promising "billing and deleting the
  organization", "ask an org owner to install it" (install is super-admin-only),
  members sent to super-admin-only provider settings.

---

## §10 — Suggested fix order

Per the project's own discipline: for each security fix, **write the failing
test first and confirm it goes red against current HEAD.** The prior router
remediation found that six of its eight most serious findings were already
covered by a passing test.

**Tier 1 — tenant isolation (blocks hosting untrusted tenants at all):**
1. **H1 uid collision registry** (§4.1) — the single blocking finding; it is what
   makes §3's sandbox escapes reachable
2. Fork `ATTACH DATABASE` authorizer + jsvm execution budget (§3) — the
   independent half of that pair
3. H3 root-owned socket fallback dir; H2 evict-epoch (suspend/archive must
   actually take effect)

**Tier 2 — the product doesn't work (small and mechanical):**
4. B1 drive nav one-liner; B3 guest role + test fixture; B9 color tokens;
   H5 `TMPDIR` `MkdirAll`; F12 gofmt
5. B8 install-spec `/admin` → `/setup` (6 call sites), then **actually run the
   suite** — it is the only automated guard on first-run bootstrap
6. B2 setup operator role; B4 `org_pkg_access` rules migration (B3+B4 together
   are what make share links work end to end)

**Tier 3 — authorization consistency:** items 7–10 below are **DONE** (see
"Tier 3 security — done" above).
7. ~~§2.1 disabled checks — **mail IMAP/SMTP first**, it is the only one not
   bounded by token expiry~~
8. ~~§2.2 guest early-returns in mail + calendar user-create hooks~~
9. ~~§2.3 calendar `@request.body.calendar` pin; WebDAV parent authz~~
10. ~~F1 WebDAV per-upload temp dir (cross-user content swap); F4 DAV challenge
    throttling~~
11. ~~§8 record the fresh-provisioning decision — a guard migration is better
    than a PR comment~~ (**DONE** — `CLAUDE.md` records the decision and
    `1000000000_refuse_legacy_org_database.js` enforces it, tinycld `01384c1`)

**Tier 4 — before a real production day:** items are **DONE** (see "Tier 4
operational hardening — done" above).
~~H4 admission control + LRU; M2 wrap load errors and log them (the
difference between diagnosing a broken store in a minute and never diagnosing
it); M3 stop chowning storage per spawn; M1 mail listener backoff; M9 drop
`url` from the switcher cookie.~~

**Fast-follow:** ~~§5 default `onError` in the `useMutation` wrapper~~ (**DONE**,
tinycld `77f3332`); ~~§6 last-owner guards and mail member RLS~~ (**DONE**,
tinycld `9cf07cb`, mail `1e59bed`); ~~B5/B6/B7
interstitials and a mail-hostname UI panel~~ (**DONE** — see "B5/B6/B7 — done"
above); §9 help topics — especially
calendar's missing CalDAV setup topic and the IMAP username guidance, which is
now actively wrong rather than merely stale.
