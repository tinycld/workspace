# SDD ledger — plan: docs/superpowers/plans/2026-08-05-oauth-authorization-server.md

Execution order: Task 10 first (independent mail security fix), then 1-9, 11-13.

Repos and branches:
- mail/     fix/image-proxy-token-type      (task 10)
- tinycld/  feat/oauth-authorization-server (tasks 1-9, 11-13)

Pre-flight scan: found one real cross-task conflict. Task 2's migration marked
oauth_grants.user `required: true`, but Task 6 saves a PENDING device grant
before any user is known. Verified against fork core/field_relation.go:198 that
RelationField.ValidateValue returns ErrRequired for an empty required relation,
so the device flow would have failed to store its own row. Plan corrected to
`required: false` (migration + test helper) with the invariant enforced in Go.
Committed as a49be4c in the workspace-root repo.

## Worktree setup (tinycld, tasks 1-9 & 11-13)

Worktree: /Users/nas/code/tinycld-oauth-wt on branch feat/oauth-authorization-server
(created from tinycld/ repo, whose root is the app shell ~/code/tinycld/tinycld).

VERIFIED WORKING in the worktree, with no pnpm install and no go.work:
  cd /Users/nas/code/tinycld-oauth-wt/core/server && go test ./sharelink/  -> ok
Go resolves via core/server/go.mod's `replace` of the vendored PocketBase fork,
so ALL of tasks 1-9 (pure Go + tests) can run in the worktree as-is.

DOES NOT WORK in the worktree — do not attempt there:
  pnpm run packages:generate  /  pnpm exec tinycld-pkg check  /  pnpm run dev
Reason: scripts/paths.ts sets WS_ROOT = APP_DIR/.., which resolves to
/Users/nas/code/ (a directory of ~40 unrelated repos), and there is no
node_modules. Running the generator there would scan those as members.

RULE FOR DISPATCHES:
- Tasks 1-9 (Go only): work in /Users/nas/code/tinycld-oauth-wt. Never run pnpm.
- Task 2's migration + any step needing `packages:generate`, and tasks 11-13
  (TS/React + generator + dev server): run in the assembled workspace at
  /Users/nas/code/tinycld/tinycld. Cherry-pick or rebase the branch there, or
  run the generator step from the main checkout against the same branch.
- Decide per task at dispatch time; state the working directory explicitly in
  every implementer prompt.

## WORKTREE RELOCATED before tasks 11-13 (UI)

The Go worktree at /Users/nas/code/tinycld-oauth-wt could not run the TS
tooling. Moved it (git worktree move, tree was clean) to:
  /Users/nas/code/tinycld/tinycld-oauth-ui   [feat/oauth-authorization-server]

The main checkout /Users/nas/code/tinycld/tinycld is on feat/core-haptics
(PR #152, OPEN, fully pushed — verified local HEAD == @{u}, tree clean).
LEFT UNTOUCHED. Do not switch or stash it.

VERIFIED WORKING in the UI worktree, all via the EAS escape hatch:
  export TINYCLD_APP_DIR=/Users/nas/code/tinycld/tinycld-oauth-ui
  export TINYCLD_WS_ROOT=/Users/nas/code/tinycld
  ../node_modules/.bin/tsx scripts/generate.ts        -> 8 packages, OK
  ../node_modules/.bin/tsx scripts/export-types.ts    -> OauthGrants present
  ../node_modules/.bin/tsc --noEmit -p tsconfig.json  -> CLEAN
  ../node_modules/.bin/vitest run <file>              -> 6/6 pass
Why it works: tsconfig extends "../node_modules/expo/tsconfig.base" (a
relative path), and the worktree sits directly under the workspace root, so
that resolves to the root's hoisted node_modules.

CONFIRMED SAFE: the worktree has no manifest.ts, so getPackages() does not
scan it as a feature member — verified the member list is still exactly
[core + 8 features] with no duplicate. pnpm-workspace.yaml lists only
`tinycld`, so pnpm will never link the worktree either.
NEVER run `pnpm install` from the UI worktree.

## Task 10 — mail image-proxy token-type fix (repo: mail, branch fix/image-proxy-token-type)

Task 10: base f0b3836
Task 10: implementer DONE (commit 6578755) — 95/95 mail server tests pass
Task 10: review — spec ✅; 1 Important: test asserts on PocketBase's resolver,
  never invokes handleImageProxy, so it would pass against the vulnerable code
  and cannot catch a revert. Finding was PLAN-MANDATED (my brief supplied that
  test), so escalated to the user per the skill. User ruled: reviewer governs,
  fix the test.
Task 10: fix round 1/5 (0 addressed, 1 open) — implementer swapped the file
  token for a verification token but still asserted on the library resolver;
  handler never invoked. MY ERROR contributed: I named handleImageProxy (line
  114, unauthenticated) instead of handleImageProxyRequest (line 96, the
  authenticating one). Commit 6c71c3c.
Task 10: fix round 2/5 (0 addressed, 1 open) — corrected the function name in
  the fix message; implementer produced NO new commit, declined the handler
  path, and reported "96 tests pass" from a CACHED result while leaving the
  package failing `go vet` with two unused imports. Report untrustworthy.
Task 10: fix round 3/5 (1 addressed, 0 open) — fresh implementer, model bumped
  to sonnet per the skill's rounds-4-5 rule (applied early given two failures).
  Test now calls handleImageProxyRequest via httptest/RequestEvent and asserts
  *router.ApiError with 401. Commit 0b85e15.
Task 10: controller INDEPENDENTLY VERIFIED the red claim — removed
  `, core.TokenTypeAuth` from endpoints_image_proxy.go:105, test FAILED; restored,
  test PASSED; `go vet` exit 0; `go test ./... -count=1` green, uncached.
Task 10: scoped re-review — finding ADDRESSED, no new breakage, verdict clean.
  One deferred minor: three identical commit messages -> squashed.
Task 10: complete (squashed f0b3836..b633446, review clean)

## Task 1 — oauth foundations (worktree /Users/nas/code/tinycld-oauth-wt)

Task 1: base ad8ecd2
Task 1: implementer DONE (commit c836f0b) — 4/4 tests, vet clean.
  Controller verified independently: vet 0, `go test -count=1` 4/4 green.
  (Editor LSP showed BrokenImport diagnostics — an artifact of resolving from
  the workspace root instead of the worktree's Go module; toolchain is fine.)
Task 1: review — spec ✅; 1 Important: file not gofmt-clean (Scope* const block
  misaligned; `go vet` does not check formatting). Origin was MY plan's code
  block. Not escalated: gofmt is mechanical and non-contestable.
  2 Minor noted: unused clientsCollection/grantsCollection consts (Task 2 uses
  them imminently — implementer chose to keep, deliberately); garbled paste in
  the report only, not in the commit.
Task 1: fix round 1/5 (1 addressed, 0 open) — gofmt -w; commit 77dc6e0.
  Controller verified: `gofmt -l` silent, vet 0, tests 4/4 uncached.
Task 1: scoped re-review — ADDRESSED; confirmed no scope STRING VALUE changed
  (these are security identifiers; a silent edit would mean a scope never
  matches). No new breakage.
Task 1: complete (commits ad8ecd2..77dc6e0, review clean)

## Task 2 — oauth_clients + oauth_grants collections

Task 2: base 77dc6e0
Task 2: implementer DONE (commit 7afc1d5) — 6/6 tests (Task 1's 4 + 2 new).
  Controller verified: gofmt silent, vet 0, `go test -count=1` green.
Task 2: MIGRATION VALIDATED FOR REAL in the assembled workspace (not the
  worktree): copied the migration into tinycld/core/server/pb_migrations/, ran
  `pnpm run packages:generate` from tinycld/ (NOTE: that script lives in the app
  shell, not the workspace root), which replayed every migration against a fresh
  DB and emitted OauthClients + OauthGrants into pbSchema.ts with `status`
  correctly narrowed to 'pending'|'active'|'revoked'. Removed the temp copy
  afterwards; assembled workspace left with no tracked changes.
Task 2: review — spec ✅, quality APPROVED. 2 Minor (no fix loop required).
  Reviewer confirmed the security-relevant points: pending grants (user = '')
  are NOT readable by arbitrary users because '' never equals a non-empty
  @request.auth.id; client_secret_hash is unreachable via the record API since
  every oauth_clients rule is nil; UNIQUE index on jti present; hash columns
  (max 200) comfortably hold 64-char SHA-256 hex; down migration drops grants
  before clients, respecting the cascade.
Task 2: elective fix round dispatched for both Minors rather than deferring —
  (1) no index on device_code / refresh_token_hash, which Task 7 polls at RFC
  8628 cadence (~5s per pending login); adding them now while the migration is
  UNRELEASED and still editable in place, rather than shipping a second
  migration later. Non-unique by necessity: both columns are cleared to '' on
  exchange, so many rows share the empty value.
  (2) a dangling doc comment referencing TestMigrationShapeMatchesHelper, a
  test I promised in the brief and never wrote.
Task 2: fix round 1/5 (2 addressed, 0 open; commit 5005c7a) — both indexes
  added NON-unique in migration and mirrored in the Go helper; dangling comment
  replaced with an honest note that the two are mirrored by hand and the
  generator run is the real safety net (implementer chose option a).
Task 2: controller re-validated the migration against a fresh DB with the new
  indexes — generator replayed clean. Temp copy removed again.
Task 2: scoped re-review — both ADDRESSED, no new breakage.
Task 2: complete (commits 77dc6e0..5005c7a, review clean)
Task 2: minor (deferred): the Go helper does not mirror idx_oauth_grants_user_code
  (pre-existing, flagged by the implementer, out of scope for both findings).

## Task 3 — PKCE S256 verification

Task 3: base 5005c7a
Task 3: implementer DONE (commit 01931c1) — 10/10 tests (4 new + 6 existing).
  Controller verified: gofmt silent, vet 0, -count=1 green.
Task 3: CONTROLLER MUTATION TESTING (standing practice for security code):
  - re-enable the plain method (challenge == verifier returns true)
    -> TestVerifyPKCERejectsPlainMethod FAILS. Test bites. Good.
  - delete the `if challenge == "" || verifier == ""` guard
    -> ALL TESTS STILL PASS. The guard is redundant for correctness because
       SHA256("") base64url-encodes to a 43-char digest that never equals "",
       so the hash comparison already rejects empty input.
Task 3: review — spec ✅; crypto confirmed correct (base64.RawURLEncoding is
  unpadded per RFC 7636 §4.6; subtle.ConstantTimeCompare with no == shortcut on
  secret material; no length/charset check that would reject a conforming
  43-128 char verifier). 1 Important + 1 Minor, both comment honesty:
  TestVerifyPKCERejectsEmptyInput's comment claims the guard is load-bearing,
  which the mutation disproves.
Task 3: fix round 1/5 (2 addressed, 0 open; commit 8e51b2d) — comments only,
  no logic change. Guard KEPT deliberately as defense-in-depth (cheap,
  documents intent, protects against a future change to the comparison), with
  both the test comment and the guard site made honest about what actually
  provides the protection.
Task 3: scoped re-review — both ADDRESSED, logic confirmed unchanged, guard
  still present, no new breakage.
Task 3: complete (commits 5005c7a..8e51b2d, review clean)

## Task 4 — grant storage (the security core)

Task 4: base 8e51b2d
Task 4: implementer DONE (commit 0c27f52) — 17/17 tests. First implementer to
  run its own mutation testing unprompted; its results matched mine exactly.
Task 4: CONTROLLER MUTATION TESTING — four mutations, each turns a test red:
  revocation branch disabled; revoked grants made to return success; expiry
  check removed; pending grants accepted. Revocation is genuinely protected.
Task 4: review — spec ✅; 2 Important found that MY BRIEF MISSED, both real:
  (1) VerifyGrant does not check users.disabled. Verified the reasoning:
      coreserver/disabled_guard.go binds OnRecordAuthRequest (the token-ISSUANCE
      tail), and PocketBase's per-request loadAuthToken never fires that hook —
      so a disabled user's already-issued OAuth token would authenticate
      forever, and disabling an account would not cut off their CLI or Zapier.
      Precedent for the fix is davauth.go:92, which does exactly this check for
      DAV/IMAP/SMTP because those logins also have no token to revoke.
      Reject with ErrInvalidGrant (not a new sentinel) so a caller cannot
      distinguish disabled from revoked.
  (2) RevokeGrant clears refresh_token_hash and auth_code_hash but NOT
      device_code / user_code. A denied device request (Task 8) revokes a still-
      PENDING grant, leaving a live guessable user_code in the revoked row.
Task 4: fix round 1/5 (3 addressed, 0 open; commit fff3494) — 19/19 tests.
  Controller mutation-verified BOTH new protections: disabling the disabled-user
  check turns TestVerifyGrantRejectsDisabledUser red; removing the device_code/
  user_code clearing turns TestRevokeGrantClearsAllCredentialMaterial red.
Task 4: scoped re-review — all 3 ADDRESSED. Confirmed ErrInvalidGrant (not a new
  sentinel, so a caller cannot distinguish disabled from revoked); the disabled
  check sits AFTER status+expiry so rejected grants short-circuit before the
  extra user lookup; all 4 credential columns cleared and the migration confirms
  there are no others; the addDisabledField test helper adds a real BoolField
  rather than relying on a default. No new breakage.
Task 4: complete (commits 8e51b2d..fff3494, review clean)

TRACKED FOR A LATER TASK (not a Task 4 defect — no endpoint exists yet):
  The device-flow polling endpoint (Task 6/7) and the user_code lookup need
  RATE LIMITING. newUserCode has ~40 bits (31^8 ≈ 8.5e11) and rand.Int is
  correctly unbiased, but an unthrottled guessing endpoint erodes that. The
  plan's spec already calls for reusing davauth's timing-oracle mitigation;
  make sure Task 6/7 briefs carry the rate-limit requirement explicitly.

APPLIES TO TASK 5: the disabled-user check must ALSO hold for the middleware
  path. If VerifyGrant gains it (fix round above), Task 5's middleware inherits
  it automatically since it calls VerifyGrant — confirm that at Task 5 review
  rather than duplicating the check.

## Task 5 — grant-enforcement middleware

Task 5: base fff3494
Task 5: implementer DONE (commit 8ee2a23) — 25/25 tests, gofmt/vet clean. It
  handled the known collectionScopes gofmt trap correctly (no fix round needed
  for formatting, unlike Task 1) AND proactively reported that the middleware
  closure has no behavioral coverage — an honest self-report that turned out to
  be the whole finding.
Task 5: CONTROLLER MUTATION TESTING — both critical mutations SURVIVED:
  - middlewarePriority flipped to `+10` (runs AFTER PocketBase's loadAuthToken,
    which short-circuits on e.Auth != nil — so the grant check is bypassed and
    REVOCATION SILENTLY STOPS WORKING) -> all 25 tests still pass
  - scope check replaced with `if false` -> all 25 tests still pass
  Root cause: bindGrantEnforcement registers into OnServe() and has no caller
  until Task 9, so nothing drives a request through the closure. The 6 new
  tests only exercise pure helpers (ScopeForRoute, MintAccessToken).
  This is a gap in MY brief, which supplied tests that stop at the helpers.
Task 5: fix round 1/5 dispatched — extract the closure body into a testable
  `enforceGrant(re)` (keeping Id/Priority on the registered handler), then test
  it directly with a hand-built RequestEvent: non-OAuth token passes through
  untouched; in-scope token succeeds; out-of-scope token 403s; REVOKED grant's
  token 401s despite a valid signature (the property the design exists for);
  uncovered route default-denies. Plus a direct assertion that
  middlewarePriority < DefaultLoadAuthTokenMiddlewarePriority, since an
  end-to-end ordering test is not worth the scaffolding.
Task 5: fix round 1/5 (1 addressed, 0 open; commit a6f191a) — 32/32 tests.
  Controller RE-RAN the two mutations that previously survived, plus a third:
    priority flip      -> TestMiddlewarePriorityRunsBeforePocketBase FAILS
    scope check off    -> TestEnforceGrantRejectsOutOfScopeRequest FAILS
    VerifyGrant bypass -> TestEnforceGrantRejectsRevokedGrant FAILS
  All three now caught. A revoked grant's token is rejected despite a still-valid
  JWT signature — the property the whole grant-row design exists to provide.
Task 5: scoped re-review — ADDRESSED. Extraction preserved the handler's Id and
  Priority (body moved byte-for-byte, closure only delegates); all five required
  behaviors covered 1:1 with no merging; success case asserts the CORRECT user,
  not merely non-nil; pass-through case asserts re.Auth stays nil so ordinary
  web requests are untouched; 401 for authentication failures vs 403 for scope,
  with no message leaking whether a grant exists. No new exports, no new breakage.
Task 5: complete (commits fff3494..a6f191a, review clean)

## Task 6 — device authorization endpoint (RFC 8628)

Task 6: base a6f191a
Task 6: implementer DONE (commit 3e4a9ca) — 37/37 tests. FIRST TASK WITH NO FIX
  ROUND. It also found and fixed a defect in MY brief: two "rejects" tests
  asserted `rec.Code == http.StatusOK`, but the harness calls the handler
  directly and bypasses the router middleware that writes the status onto the
  recorder, so rec.Code stays at httptest's default 200 on EVERY path including
  errors — the same vacuous-assertion class as Task 10. It switched them to
  assert on the returned error's status via the package's existing apiStatus
  helper, and ran its own mutation testing before reporting.
Task 6: CONTROLLER MUTATION TESTING — both caught:
  ValidateScopes accepting unknown scopes -> TestValidateScopesRejectsUnknown
    AND TestDeviceAuthorizationRejectsUnknownScope both fail
  FindClientByClientID returning a fabricated record -> TestFindClientByClientID fails
Task 6: review — spec ✅, quality APPROVED, no blocking findings. Confirmed:
  every assertion in the diff is now real (the success test's rec.Code check is
  legitimate because that path does call re.JSON); device_code stored hashed
  while user_code is stored clear, with the plaintext returned exactly once and
  persisted nowhere; the expires_at dual meaning is unambiguous because
  VerifyGrant gates on status before ever reading it; RFC 8628 field names and
  the interval floor are exact; verification_uri comes from Settings().Meta.AppURL
  rather than a hardcoded host.
Task 6: complete (commits a6f191a..3e4a9ca, review clean)

RATE-LIMIT DECISION DEFERRED TO TASK 7 (plan updated, commit a34e766):
  davauth's TooManyFailures/NoteFailure derive their identifier from
  r.BasicAuth() and isChallenge() treats any request without Basic credentials
  as an unthrottled challenge — so they CANNOT be reused for OAuth as-is, and
  the underlying `throttle` type is unexported. Task 6 mints codes and consumes
  no guesses, so it needs none. Task 7 owns POST /oauth/token, which is where a
  device_code or user_code is actually guessed; the choice there is to export a
  credential-agnostic throttle from davauth or give oauth its own.

## Task 7 — token endpoint (device / auth-code+PKCE / refresh) + rate limiter

Task 7: base 3e4a9ca
Task 7: implementer DONE (commit 5cd6091) — 45/45 tests. Added its own
  oauth/ratelimit.go per my design call (davauth's limiter keys off
  r.BasicAuth() and treats credential-less requests as unthrottled, so it would
  let every OAuth request bypass it; its throttle + clientIP are unexported and
  its package doc scopes it to DAV). It also added a PKCE-failure test the
  brief omitted, and dry-ran my three planned mutations before reporting.
Task 7: CONTROLLER MUTATION TESTING — all four caught:
  refresh token not rotating -> TestTokenRefreshRotatesTheRefreshToken
  device_code redeemable twice -> TestTokenDeviceCodeIsSingleUse
  PKCE skipped -> TestTokenAuthCodeGrantRequiresValidPKCE
  rate limiter disabled -> TestTokenExchangeThrottlesRepeatedFailures
Task 7: review found TWO CRITICAL gaps mutation testing could not reach; I
  verified both directly in the source:
  (1) handleRefreshGrant has NO CLIENT BINDING. It calls authenticateClient
      only for the error and discards the client; grant.GetString("client") is
      never compared. handleAuthCodeGrant does this correctly at token.go:202.
      Exploit: any registered client B holding client A's leaked refresh token
      presents it with client_id=B and mints tokens for A's grant and A's user.
  (2) handleRefreshGrant NEVER CHECKS expires_at — only status == "revoked".
      Both sibling handlers check expiry, and issueTokens repurposes expires_at
      as the REFRESH deadline, so RefreshTokenTTL is currently decorative: an
      active grant is refreshable forever.
  Plus Important: handleDeviceTokenGrant has the same missing client binding
  (lower severity — device_code is high-entropy and single-use).
  Root cause: all three handlers hand-roll status/expiry checks and drifted.
Task 7: fix round 1/5 (3 addressed, 0 open; commit 15d589b) — 50/50 tests.
  Implementer extracted grantExpired + grantIssuedToClient (the identical part)
  but deliberately KEPT status handling per-path, because VerifyGrant collapses
  to one error and rejects "pending" — which would break the RFC 8628 device
  poll. That is the right call and it explained why.
  Controller mutated the SHARED helpers, the strongest available test since all
  three paths now depend on them:
    grantIssuedToClient forced true -> TestTokenRefreshRejectsWrongClient AND
      TestTokenDeviceGrantRejectsWrongClient both fail
    grantExpired forced false -> TestTokenRefreshRejectsExpiredGrant fails
Task 7: scoped re-review — all 3 ADDRESSED. Confirmed grantExpired treats an
  unset expires_at as not-expired (so a missing deadline cannot lock everyone
  out); grantIssuedToClient cannot false-match an empty grant.client because
  the client always comes from FindClientByClientID and has a non-empty Id; the
  device path still returns 400 authorization_pending for pending grants and
  keeps expired_token distinct; the refresh path retained its revoked check
  alongside the two new ones; the new tests use a genuinely second registered
  client and set expires_at in the past on a real ACTIVE grant.
Task 7: complete (commits 3e4a9ca..15d589b, review clean)

## Task 8 — authorize / revoke (RFC 7009) / metadata (RFC 8414) / userinfo

Task 8: base 15d589b
Task 8: implementer DONE (commit 753b297) — 56/56 tests. Two unprompted
  improvements over my brief: it hit the vacuous-assertion trap independently
  (two of the brief's tests were passing for the wrong reason) and switched
  them to apiStatus; and it changed handleDenyDevice to route through
  RevokeGrant rather than hand-setting status, so denying a pending device
  request actually clears device_code/user_code per Task 4's guarantee.
Task 8: CONTROLLER MUTATION TESTING — one caught, TWO SURVIVED:
  anonymous approval allowed -> TestApproveDeviceRequiresAuthentication FAILS (good)
  RedirectURIAllowed check deleted (OPEN REDIRECT) -> all 56 tests still pass
  code_challenge/S256 requirement deleted (PKCE downgrade) -> all 56 still pass
  Root cause: handleAuthorize has ZERO test coverage — no test in
  authorize_test.go calls it. That is the whole authorization-code + PKCE path,
  the one Zapier will use. My brief supplied six tests and none touched it.
  Same shape as Task 5's untested middleware.
Task 8: fix round 1/5 dispatched — tests driving handleAuthorize directly:
  unregistered redirect_uri rejected INCLUDING prefix/substring variants (exact
  match only); missing code_challenge rejected; non-S256 method rejected;
  anonymous caller rejected; unknown scope rejected; and a happy path that
  feeds the issued code to the token endpoint with the correct verifier
  (succeeds) and a wrong one (fails) — proving the PKCE binding is load-bearing
  ACROSS the two handlers rather than merely stored.
Task 8: fix round 1/5 (1 addressed, 0 open; commit c4f73e2) — 65/65 tests, 9 new
  tests driving handleAuthorize/handleAuthorizeInfo. Controller re-ran both
  surviving mutations: open redirect -> TestAuthorizeRejectsUnregisteredRedirectURI
  FAILS; PKCE requirement -> TestAuthorizeRequiresCodeChallenge AND
  TestAuthorizeRejectsNonS256Method both FAIL. The implementer also found that
  removing the anonymous guard causes a NIL-POINTER PANIC, not just a wrong
  status — so that guard is load-bearing for availability too.
Task 8: scoped re-review — ADDRESSED. Redirect tests use four variants against
  a registered URI including a genuine prefix attack (cb.evil.com) and a
  traversal form, so a prefix-matching implementation would be caught. The
  round trip goes through the real handleToken -> handleAuthCodeGrant (not a
  direct VerifyPKCE call), and the wrong-verifier case can only be failing on
  PKCE since redirect/client/code are all correct. The auth guard is the literal
  first statement before any re.Auth access. Happy path asserts the grant row
  records BOTH code_challenge and redirect_uri. No shared fixture mutated; diff
  touches only the test file.
Task 8: complete (commits 15d589b..c4f73e2, review clean)

## Task 9 — wire into shared composition + seed the CLI client

Task 9: base c4f73e2
Task 9: implementer DONE (commit fe7a3ff) — 66 oauth tests + full coreserver
  suite green. Reported that the brief's `-run TestComposition` matches no real
  test name and ran the actual ones explicitly. Also fixed a pre-existing
  gofmt violation in coreserver/guest_rls_test.go (unrelated, per the standing
  fix-every-red-check rule), and declined to redeclare a test the brief's
  snippet duplicated from Task 5.
Task 9: CONTROLLER VERIFICATION — the composition parity test passes with ZERO
  changes to hostOnlyHookDiff (I diffed that file: untouched), which is the
  real evidence that oauth.Register sits in the SHARED path and a multi-org
  tenant gets the authorization server, not just the single-org host.
  Both migrations validated for real in the assembled workspace: copied into
  tinycld/core/server/pb_migrations/, ran packages:generate, replayed clean
  against a fresh DB, then removed the temp copies.
Task 9: review — spec ✅, quality APPROVED, NO FINDINGS. Confirmed all 9
  handlers registered exactly once with correct verbs; /oauth/userinfo carries
  its own re.Auth == nil guard rather than relying on middleware; bind-
  GrantEnforcement binds router-wide inside its own OnServe so tenants inherit
  it; the seed sets type 'public' with no client_secret_hash; the down
  migration's try/catch is meaningful since findFirstRecordByFilter throws on
  no match; and PocketBase never re-applies a recorded migration so the seed
  cannot double-insert.
Task 9: complete (commits c4f73e2..fe7a3ff, review clean)

NOTE ON THE ASSEMBLED WORKSPACE: tinycld/ has modified MiniCalendar.tsx,
  SortableList.tsx, core/package.json and package.json (an expo-haptics dep +
  haptics wiring). I verified these are NOT mine — they belong to the
  MiniCalendar work that was already in flight at session start. Left untouched.

## Task 11 — consent screen (UI worktree)

Task 11: base fe7a3ff
Task 11: implementer DONE (commit d14c5db) — 3/3 tests, tsc clean, biome clean.
  It found and fixed a REAL DEFECT IN MY BRIEF: app/p/ is the generator-owned
  public-route tree, and pruneOrphanRouteDirs deletes slug dirs no installed
  package claims — so my hand-written app/p/oauth/authorize.tsx would have been
  SILENTLY DELETED on the next packages:generate. Fixed by adding 'oauth' to
  APP_OWNED_PUBLIC_ROUTE_DIRS plus a .gitignore negation, mirroring how
  help/settings are protected in APP_OWNED_ORG_ROUTE_DIRS for the authenticated
  tree. It also adapted the brief's code where I had invented APIs that do not
  exist here (@testing-library/react-native, ui/button, a /login route).
Task 11: CONTROLLER VERIFICATION — ran scripts/generate.ts for real and
  confirmed app/p/oauth/authorize.tsx SURVIVES the prune. tsc clean, 3/3 tests.
Task 11: controller also fixed a pre-existing red check the implementer flagged
  but correctly left alone (commit 3ea1cff): scripts/__tests__/paths.test.ts
  hard-asserted path.basename(APP_DIR) === 'tinycld', contradicting paths.ts's
  documented TINYCLD_APP_DIR override (EAS clones the shell into build/) and
  failing in ANY relocated checkout. Replaced with marker-file assertions
  (app.json + scripts/paths.ts present), which still catch a bogus APP_DIR.
  6/6 pass. Per the standing rule: fix red checks at the source regardless of
  whether my change caused them.
Task 11: review — spec ✅, quality APPROVED, no blocking findings. Reviewer
  independently confirmed the prune-fix mechanism matches precedent, that
  biome.json's vcs.useIgnoreFile makes the gitignore-negation reasoning real,
  that the signed-out path is genuinely reachable (app/p/_layout.tsx has no
  auth gate by design), that ScopeList falls back to the raw scope string for
  an unknown scope (tested), and that my paths.test.ts change was not weakened.
Task 11: complete (commits fe7a3ff..3ea1cff, review clean)

## Task 12 — connected apps list + session-authenticated revoke

Task 12: base 3ea1cff
Task 12: PLAN CORRECTED BEFORE DISPATCH (commit 0f4ae8b). My original brief
  revoked by POSTing grant.jti to RFC 7009's /oauth/revoke. That endpoint takes
  a TOKEN — it parses a JWT for the tcg claim or hashes the value against
  refresh_token_hash — so a bare jti matches neither branch. And because RFC
  7009 mandates 200 for an unknown token, the Revoke button would have
  SILENTLY DONE NOTHING while reporting success. The browser session also has
  no access to a CLI's tokens. Replaced with a new session-authenticated
  POST /oauth/grants/{id}/revoke.
Task 12: implementer DONE (commit 85abf64) — Go 71/71, TS 3/3, tsc clean.
  Ran its own ownership mutation before reporting. Also had to register
  oauth_grants as a pbtsdb collection in core/lib/pocketbase.ts (outside the
  brief's file list) or useStore/useOrgLiveQuery would not typecheck.
Task 12: CONTROLLER MUTATION TESTING — deleting the
  `grant.user != re.Auth.Id` comparison turns TestRevokeGrantByIDRejectsOther
  UsersGrant red. One user cannot revoke another's grant.
Task 12: review — spec ✅ but ONE CRITICAL, which I verified myself:
  the useOrgLiveQuery has NO .select(), and PocketBase's list/view rules are
  ROW-scoped only with no field-level redaction (confirmed no `hidden: true` on
  any column). So the client receives the FULL grant row — including
  refresh_token_hash, device_code and auth_code_hash — into pbtsdb's local
  store and over the realtime wire, for a screen that renders only a label and
  a timestamp. "Read-only" is not the same as "minimal exposure".
  Reviewer also confirmed: the 401/404/403/200 order is right (404-before-403
  leaks existence, but ids are random PB ids, matching PB's own Records API);
  the realtime refresh genuinely works for a SERVER-side write; style is clean.
Task 12: fix round 1/5 (1 of 2 addressed; commit f7357aa) — confirm dialog DONE
  using the pre-existing core/ui/ConfirmDialog (cancel does not revoke, no
  double-fire); also added a react-native-svg vitest stub its import chain
  needed. tsc clean, 264/264 unit tests.
  BUT the CRITICAL was only COSMETICALLY fixed, and the scoped re-review caught
  it. `.select()` is a @tanstack/db operator applied to the ALREADY-MATERIALIZED
  local store — it does not narrow the wire payload. I confirmed in pbtsdb's
  own source (dist/chunk-RZISAGM7.js:172-185): both fetch paths call getList /
  getFullList with NO `fields:` param, and realtime subscribes with "*". Both
  are fixed at collection-creation time, independent of any query-time select.
  So the three secret columns still crossed the network and still sat in the
  client's in-memory store. The component stopped READING them; the exposure
  was unchanged.
Task 12: fix round 2/5 dispatched — the real fix is server-side field
  redaction. This PocketBase fork supports it: core/field_text.go:72 defines
  `Hidden bool` ("hides the field from the API response") and
  core/record_model.go:1274 gates serialization on !f.GetHidden(). Mark
  refresh_token_hash / device_code / auth_code_hash hidden in the (unreleased,
  so editable in place) migration; keep user_code visible since the consent
  screen looks grants up by it. I pre-checked the Go side: nothing reads those
  three via the record API — only Set() on write and FindFirstRecordByFilter
  (a DB query, not serialization) on read — so Hidden cannot break the server.
  Asked for a test proving Hidden is actually in effect, not just declared.

Task 12: fix round 2/5 (commit 7c59155) — 72/72 Go tests, hidden: true on the
  three credential columns, new TestGrantCredentialFieldsAreHiddenFromPublic
  Export. Controller mutation-tested it (flip Hidden to false -> red) and
  re-validated the edited migration against a fresh DB via the generator.
Task 12: scoped re-review #2 — the fix is REAL this time. Reviewer traced both
  serialization paths and confirmed they share ONE export function: REST does
  e.JSON(200, e.Record) -> Record.MarshalJSON() -> PublicExport(), and realtime
  (apis/realtime.go:712-735) marshals through the same method; the ?fields=
  picker also marshals through PublicExport first so it cannot resurrect a
  hidden field. Server-side reads are unaffected because Get/GetRaw/GetString
  never consult GetHidden(). Superusers are unhidden consistently on both paths.
  BUT it found MY user_code reasoning was false.
Task 12: fix round 3/5 dispatched — hide user_code as well. I had told the
  implementer to keep it visible because "the consent screen looks a grant up
  by it". Verified that is wrong: app/p/oauth/authorize.tsx only ever SENDS the
  code (query param / form value, sourced from the URL or the user's typing);
  nothing client-side reads it off a record; the ConnectedAppsSection
  projection omits it; the server does its own FindGrantByUserCode lookup and
  AuthorizeInfoResponse does not contain the field. So it is a live, guessable
  (~40-bit), short-lived credential serialized for no reason — readable by the
  owning user once the grant is approved. Asked the implementer to verify my
  reasoning rather than trust it, since I was wrong on this exact field once.

Task 12: fix round 3/5 (all addressed; commit 44751f0) — user_code hidden too;
  all FOUR credential columns now excluded from PublicExport. Implementer
  verified my reasoning rather than trusting it and surfaced the key nuance:
  the CLI's user code comes from DeviceResponse.UserCode, a HAND-BUILT struct
  populated from a local variable — not from a serialized record — so hiding
  the collection field cannot break the device flow.
Task 12: scoped re-review #3 — all findings addressed. Device flow confirmed
  unaffected (device.go:88 returns the local userCode; the three approval
  handlers resolve via FindGrantByUserCode, a DB filter Hidden does not touch).
  Stale "user_code stays visible" comments removed everywhere. The test has a
  POSITIVE CONTROL (device_label asserted present), so a bug that hid
  everything could not pass. Migration and schema_test.go fixture agree on all
  four flags.
Task 12: complete (commits 3ea1cff..44751f0, review clean after 3 fix rounds)

## Task 13 — end-to-end verification + help topic

Task 13: base 44751f0
Task 13: CONTROLLER RAN THE E2E HIMSELF against a real server binary.
  Built the full app server (69MB, oauth linked via package_extensions.go),
  booted it on 127.0.0.1:8791 with a fresh DB.
  GOTCHA WORTH RECORDING: JS migrations are NOT picked up from the source tree
  automatically — the binary needs `--migrationsDir=<app>/server/pb_migrations`
  (the generator-produced symlink dir). Without it only PocketBase's own 8 Go
  migrations applied and /oauth/device answered "Unknown client_id". With it,
  111 migrations applied including both oauth ones.
  Also noted: 1980000000/1980000001 now collide numerically with cards'
  migrations. Filenames differ so the generator allows it and PB sorts by full
  filename deterministically — not a bug, but the numeric prefixes are no
  longer unique across packages.
  RESULTS, all against live HTTP:
    /.well-known/oauth-authorization-server  -> full RFC 8414 doc, 9 scopes,
      3 grant types, S256 only
    POST /oauth/device -> user_code N9GD-RFJR, expires_in 900, interval 5
    poll before approval -> authorization_pending (RFC 8628 §3.5)
    GET /oauth/authorize/info -> client name + requested scopes
    POST /oauth/authorize/approve -> {"status":"approved"}
    poll after approval -> access_token (tcg claim present, refreshable:false),
      refresh_token, scope "drive:read mail:read"
    in-scope  GET /api/drive/search -> 200
    out-of-scope POST /api/mail/send -> 403 Requires the "mail:send" scope
    POST /oauth/revoke -> 200, and THE SAME access token went 200 -> 401 on the
      very next request despite a still-valid unexpired JWT signature
    refresh with the revoked grant -> invalid_grant
    THE USER'S OWN WEB SESSION STAYED 200 THROUGHOUT — which is precisely what
      PocketBase's built-in tokenKey rotation could never have done.
    GET /api/collections/oauth_grants/records -> NO refresh_token_hash,
      device_code, user_code or auth_code_hash in the live response, while
      device_label/status/last_used_at are present. The three-round hidden-field
      fix is confirmed ON THE WIRE, not just in PublicExport unit tests.
  Environment torn down; worktree left clean.
Task 13: help topic (commit 3b0f35d) — core/help/connected-apps.md, verified
  present in lib/generated/package-help.ts, correct frontmatter, NO hardcoded
  hostnames ({{server-host}} used 3x), documents the immediate-revocation
  behavior. tsc clean, 264/264 unit, 72/72 Go.
Task 13: complete (commits 44751f0..3b0f35d)

## FINAL WHOLE-BRANCH REVIEW (opus) + fix wave

Final review: 24 commits, spec Part 1. Verdict was NOT MERGE READY on one
CRITICAL, which I independently reproduced before acting:

  CRITICAL — scope self-escalation. exemptPaths contained the blanket
  "/oauth/", so ScopeForRoute returned scopeExempt for the CONSENT endpoints,
  and handleApproveDevice gated only on re.Auth != nil. A stolen profile-only
  access token could POST /oauth/device asking for mail:send drive:write, then
  replay the user_code to /oauth/authorize/approve with that same low-privilege
  bearer — minting a fully-scoped grant for the victim with NO browser and NO
  human consent. The scope ceiling was bypassable by any token that reached the
  approval endpoint. My own probe confirmed
  ScopeForRoute("POST","/oauth/authorize/approve") == scopeExempt.
  This is the class per-task review structurally cannot see: the middleware and
  the consent handlers were each individually correct.

  Plus: handleDenyDevice had no authorization check AND zero test coverage;
  oauth_clients.scopes was written but never read (no per-client ceiling);
  user_code had no UNIQUE index; dead Claims/ErrInsufficientScope; and
  ConnectedAppsSection rendered a FAILED query as an empty list.

Fix wave (commit 5aef1ee) — one dispatch, all six. Go 72 -> 86 tests, TS
264 -> 268. Verified: exemption narrowed to only the credential-less endpoints,
plus rejectOAuthToken on the consent/management routes reusing the existing
IsOAuthToken + bearerToken helpers. I re-ran my escalation probe: all four
consent routes now default-deny while device/token/revoke stay exempt.

Scoped re-review of the wave (opus) — all six CLOSED, both layers of the
critical verified independently (middleware 403s with re.Auth left nil; and
with the middleware bypassed the handlers still reject). Session path confirmed
INTACT: a session token has no tcg claim, so enforceGrant returns at the first
branch and never consults ScopeForRoute — the consent screen still works.
BUT it found a REGRESSION the wave itself introduced.

  /oauth/userinfo was orphaned by the narrowed exemption — never added to
  endpointScopes, so it default-denied. Discovery ADVERTISES it as
  userinfo_endpoint, so any integration following the well-known document got
  a 403 on the standard identity call.

Controller fix (commit 7ef8144), applied myself since the skill allows no
second fix wave: explicit "GET /oauth/userinfo": ScopeProfile, plus a
route-classification guard test asserting every route register.go binds is
DELIBERATELY classified — token-reachable routes must resolve to a scope or an
exemption, consent/management surfaces must stay default-deny. My first draft
of that test was wrong (it demanded a scope for the consent routes, which are
correctly default-deny); corrected to assert the distinction. Mutation-tested
both directions: removing the userinfo entry fails it, and re-exempting a
consent surface fails it too.

FINAL STATE: 26 commits. go test ./oauth/ ./coreserver/ green (incl. the
composition parity test), tsc clean, 268/268 TS unit tests, gofmt/vet clean.

SHIP-BLOCKING BEFORE THIRD-PARTY (Zapier) EXPOSURE, not before merge:
  - oauth_clients has no enabled/disabled field, so a decommissioned or
    compromised client_id authenticates forever with no kill switch. Fine for
    the first-party CLI; must land before any external client is registered.
DEFERRED, ship: davauth's compareAgainstDummyHash timing mitigation was
  promised in the spec and not applied. Impact is low (SHA-256 hash compares,
  not bcrypt, so the timing signal is far weaker than the DAV password path),
  but it is a known deviation rather than an oversight.

LESSON 3: narrowing an allowlist is a regression risk in both directions. The
  fix for the escalation silently broke an advertised endpoint. Whenever an
  exemption list shrinks, enumerate what just fell out of it.

LESSON 1: a query-builder `.select()` narrowing a LOCAL store is not a data-
  exposure fix. Ask where the projection is applied — client-side after
  materialization, or in the request/subscription itself.
LESSON 2: when hiding a field, check whether the stated CONSUMER actually
  exists. My justification for exempting user_code described behavior the
  client does not have. "The UI needs it" deserves a grep, not an assumption.

METHOD NOTE: mutation testing found NONE of Task 7's Critical defects. All four
  of my mutations passed against the original commit. These were MISSING checks,
  not broken ones — mutation testing can only falsify code that exists. Reading
  each handler against its siblings is what surfaced them. Worth remembering:
  mutation testing verifies coverage of present logic; it says nothing about
  logic that was never written.

TRACKED, NOT TASK 7: oauth_clients has no enabled/disabled field, so a
  decommissioned client_id still authenticates. Client lifecycle management is
  its own piece of work. It compounds the two findings above, so it should be
  resolved before the AS is exposed to third parties (i.e. before Zapier).

PLAN HARDENED after Task 1: added two Global Constraints (commit ca3d5ef) —
run gofmt and confirm `gofmt -l` is silent; always test with -count=1. Scanned
the plan's remaining Go blocks and found the same misalignment in Task 5's
collectionScopes map and TTL const block, so the constraint names those
explicitly rather than letting three more tasks rediscover it.

LESSON FOR REMAINING TASKS: a subagent's test-pass claim is not evidence.
Round 2 reported green from a cached run over a non-compiling package. For any
task whose deliverable is a security or correctness guarantee, verify the
claim myself (mutate the fix, watch the test go red) before accepting DONE.
Also: plan-supplied test code can itself be the defect — my brief's test was
vacuous, and the reviewer, not the plan, was right.


================================================================================
DEFERRED-ITEM CLEANUP (2026-08-06, follow-up session)

All four deferred items closed, plus the migration-prefix observation.

1. CLIENT KILL SWITCH — done (commit 7c8ae84). oauth_clients.disabled,
   enforced in BOTH halves:
     - FindClientByClientID: the chokepoint all three mint/exchange entry
       points (handleAuthorize, handleDeviceAuthorization, handleToken)
       already resolved through, so no new call sites were needed.
     - VerifyGrant: the per-request cutoff, sitting directly beside the
       existing disabled-USER check, which was the exact precedent — same
       shape, same ErrInvalidGrant, same "must not be distinguishable from
       revoked" reasoning.
   Deciding factor for doing both halves: a kill switch that only blocks NEW
   authorization leaves a compromised client's live tokens valid until
   expiry, which is most of what you'd flip the switch FOR.
   Sense is `disabled` not `enabled` so the zero value is "working" — a bool
   that failed to write cannot leave a client wrongly dead.
   Mutation-verified in both directions, and the two mutations were
   independent: removing the front half turned ONLY the front-half test red,
   confirming neither check masks the other. First attempt at the back-half
   mutation didn't compile (deleting the block orphaned `client`), which
   proves nothing — redone as `&& false` to get a build that actually runs.

2. DUMMY-HASH TIMING MITIGATION — done (commit 22102ee). The real leak was
   not the one the spec described. VerifyClientSecret's early return on an
   empty stored hash is minor; the significant one was authenticateClient
   returning on an unresolvable client_id BEFORE any hash work, which the
   kill switch had just made more interesting (it now also distinguishes
   "switched off"). Both closed.
   Written up honestly as weaker than davauth's namesake rather than
   presented as equivalent: davauth spends BCRYPT cost against a measured
   ~700x gap; this is SHA-256, where the absolute difference is near the
   noise floor. It removes the BRANCH, not a cost gap. The rate limiter is
   what actually bounds averaging out a signal this small — the comment says
   so, so nobody later mistakes this for load-bearing.
   Found while doing it: the confidential-client path had NO test coverage
   whatsoever (the only registered client is the public CLI, which skips
   secret verification entirely). Added clients_test.go, including the
   misconfiguration case — confidential + no stored hash must reject every
   secret rather than accept any — which is also the branch the dummy
   compare sits on. Mutation-verified.

3. schema_test.go INDEX MIRROR — already closed, as suspected. Verified
   directly: schema_test.go carries idx_oauth_grants_user_code with the
   correct partial-UNIQUE predicate. The log entry predated the fix wave.

4. THREE IDENTICAL COMMIT MESSAGES — closed at the time (squashed).

5. MIGRATION PREFIX COLLISION — fixed (commit 0c723c6), upgraded from
   "non-blocking observation" after checking the actual mechanism. The
   generator SYMLINKS every package's pb-migrations into one flat directory
   (server/pb_migrations/), so prefixes are a single GLOBAL namespace, not a
   per-package one. Renamed oauth to 1985000000/1985000001; cards keeps
   1980000000/1. Safe only because these are unreleased and the branch is
   unmerged — a released migration can never be renamed, since an applied
   one never re-runs and the rename would silently never apply.
   Left alone deliberately: the plan document's references to the old
   filenames. It is a record of what was executed, not a live reference.

VERIFICATION: gofmt -l silent, go vet clean, go build ./... ok,
go test ./oauth/ ./coreserver/ -count=1 green (incl. composition parity),
tsc --noEmit clean, 739/739 TS unit tests, biome clean over 616 files.
pbSchema.ts regenerated — `disabled` propagated, which also confirms the
renamed migrations are picked up by the generator.

LESSON: "cosmetic drift" deserves one check of the mechanism before being
filed as cosmetic. The prefix collision looked harmless because filenames
differ and ordering stays deterministic — true, but it was reasoned about as
if each package had its own migration namespace. One `ls -la` of the
symlinked directory showed the namespace is shared. The conclusion (ship it)
was right for the wrong reason, and the right reason came with a cheap fix
that was only cheap because nothing had shipped yet.
