# OAuth 2.1 Authorization Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TinyCld a standards-compliant OAuth 2.1 authorization server so the `tinycld` CLI (Device Grant) and third-party integrations like Zapier (Authorization Code + PKCE) can obtain scoped, individually revocable access to a deployment.

**Architecture:** A new `tinycld.org/core/oauth` Go package registered from `registerSharedCore`, so single-org deployments and multi-org tenants get it identically. Access tokens are **standard PocketBase `auth`-type static tokens** — PocketBase's own `loadAuthToken` middleware resolves them and populates `e.Auth`, so every existing endpoint and collection rule works unchanged. A second middleware, registered at a *lower* priority number so it runs first, looks up the grant row by `jti` and enforces status, expiry, and scope. Grants live in two new collections and are checked on every request, which is what makes per-device revocation possible.

**Tech Stack:** Go 1.26.3, PocketBase v0.39.8 (vendored fork), `golang-jwt/jwt/v5` (already in the module graph via PocketBase), PocketBase JS migrations, React Native/Expo for the two UI surfaces.

## Global Constraints

- **Never add a new PocketBase token type.** `FindAuthRecordByToken` resolves the `type` claim through a closed switch (`core/record_query.go:483`) whose `default` errors. Mint `core.TokenTypeAuth` static tokens only. Adding a type means forking three fork files — not allowed.
- **Signing is HS256-only.** PocketBase's `tools/security` hardcodes `jwt.WithValidMethods([]string{"HS256"})`. Do not attempt RS256/ES256 or a JWKS endpoint; both are explicitly out of scope.
- **Derive the signing key domain-separated**, never the raw auth secret: HMAC-SHA256 over `_superusers` `AuthToken.Secret` with the literal label `tinycld:oauth:v1`. Mirrors `sharelink.signingKey`.
- **Register in `registerSharedCore`, not the host-only tail** (`coreserver/server.go:252`). Anything host-only needs an entry in `hostOnlyHookDiff` with a reason, and `composition_parity_test.go` fails otherwise.
- **Migrations are append-only once released.** New files with new numeric prefixes; never edit an existing migration. Next free prefix is `1980000000` (current highest is `1970000000_admin_console_role_rules.js`).
- **Store only hashes** of client secrets and refresh tokens. Compare with `crypto/subtle.ConstantTimeCompare`. Never log a secret — log at most an 8-character prefix, following mail's `secretPrefix()` convention.
- **A valid signature is never sufficient.** Every verification re-reads the grant row and re-checks status and expiry, mirroring `sharelink.VerifyAndResolve`.
- **No `any` in TypeScript. No `biome-ignore` comments.** Biome enforces 4-space indent, single quotes, ES5 trailing commas.
- **Semantic Tailwind tokens only** in UI (`text-foreground`, `bg-background`) — no raw hex, light and dark must both work.
- Go code lives in `tinycld/core/server/`; run `go test ./...` from that directory.
- **Run `gofmt -w` on every Go file you create or edit, and confirm `gofmt -l`
  prints nothing before committing.** `go vet` does not check formatting, so a
  misaligned const block or map literal passes vet and still fails the repo's
  bar. The code blocks in this plan are illustrative and are NOT guaranteed
  gofmt-clean — several have alignment that gofmt will change (notably the
  `Scope*` const block in Task 1 and the `collectionScopes` / TTL const blocks
  in Task 5). Format the result; do not transcribe the plan's whitespace.
- Always run tests with `-count=1`. A cached PASS over a non-compiling package
  has already been reported once as success in this plan's execution.
- **The device-flow endpoints must be rate limited.** `POST /oauth/token`
  (device polling) and the `user_code` lookup are guessing surfaces reachable
  without any credential. A user code carries ~40 bits (31^8 ≈ 8.5×10¹¹), which
  is ample against a throttled attacker and thin against an unthrottled one.
  Reuse the existing `core/server/davauth/ratelimit.go` primitives rather than
  inventing a scheme, and follow `davauth`'s timing-oracle mitigation
  (`compareAgainstDummyHash`) so an invalid grant does not return measurably
  faster than a valid one. This applies to Tasks 6, 7, and 8.
- **Every per-request authorization path must reject a disabled user.**
  `coreserver/disabled_guard.go` binds `OnRecordAuthRequest`, which is the token
  *issuance* tail; PocketBase's per-request `loadAuthToken` never fires it. So a
  disabled user's already-issued OAuth token would keep working forever unless
  the grant check rejects it. `VerifyGrant` owns this check (see
  `davauth.go:92` for the same cutoff on DAV/IMAP/SMTP); anything calling
  `VerifyGrant` inherits it and must not duplicate or bypass it.

---

## File Structure

**New Go package — `tinycld/core/server/oauth/`:**

| File | Responsibility |
|---|---|
| `oauth.go` | Package doc, scope constants, `Claims`, sentinel errors, `signingKey` |
| `grants.go` | Grant CRUD against `oauth_grants`: mint, find by `jti`, revoke, touch `last_used_at` |
| `clients.go` | Client lookup + secret verification against `oauth_clients` |
| `pkce.go` | PKCE `S256` challenge verification (pure) |
| `device.go` | `POST /oauth/device` — device + user code issuance |
| `authorize.go` | `GET/POST /oauth/authorize` — consent, device approval, auth-code issuance |
| `token.go` | `POST /oauth/token` — device, authorization_code, and refresh_token grants |
| `revoke.go` | `POST /oauth/revoke` (RFC 7009) |
| `metadata.go` | `GET /.well-known/oauth-authorization-server` (RFC 8414) |
| `middleware.go` | The grant-enforcement middleware + scope table |
| `register.go` | `Register(app)` — wires every route and the middleware |

**Migrations — `tinycld/core/server/pb_migrations/`:**
- `1980000000_create_oauth_collections.js` — `oauth_clients` + `oauth_grants`
- `1980000001_seed_cli_oauth_client.js` — the first-party CLI client

**Modified:**
- `tinycld/core/server/coreserver/server.go:252` — add `oauth.Register(app)`
- `mail/server/endpoints_image_proxy.go:102` — constrain token type (bug fix)

**UI:**
- `tinycld/app/(app)/settings/connected-apps.tsx` — grant list + revoke
- `tinycld/core/components/settings/ConnectedAppsSection.tsx` — the section component
- `tinycld/app/p/oauth/authorize.tsx` — consent screen
- `tinycld/app/(app)/settings/index.tsx` — link to Connected apps

---

## Task 1: Scope constants, claims, and the signing key

**Files:**
- Create: `tinycld/core/server/oauth/oauth.go`
- Test: `tinycld/core/server/oauth/oauth_test.go`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Claims{GrantID, ClientID, Scopes []string}`; `signingKey(app core.App) (string, error)`; `ParseScopes(string) []string`; `HasScope([]string, string) bool`; `ErrInvalidGrant`, `ErrGrantRevoked`, `ErrInsufficientScope`; scope constants `ScopeProfile`, `ScopeMailRead`, `ScopeMailSend`, `ScopeDriveRead`, `ScopeDriveWrite`, `ScopeContactsRead`, `ScopeContactsWrite`, `ScopeCalendarRead`, `ScopeCalendarWrite`

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/oauth_test.go`:

```go
package oauth

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestSigningKeyIsDomainSeparated(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	key, err := signingKey(app)
	if err != nil {
		t.Fatalf("signingKey: %v", err)
	}
	if key == "" {
		t.Fatal("signingKey returned empty string")
	}
	// A hex-encoded HMAC-SHA256 is always 64 chars.
	if len(key) != 64 {
		t.Fatalf("signingKey length = %d, want 64", len(key))
	}
	// The whole point of domain separation: never the raw auth secret.
	su, err := app.FindCachedCollectionByNameOrId("_superusers")
	if err != nil {
		t.Fatalf("find _superusers: %v", err)
	}
	if strings.Contains(key, su.AuthToken.Secret) {
		t.Fatal("signing key leaks the raw _superusers auth secret")
	}
}

func TestSigningKeyIsStable(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	first, err := signingKey(app)
	if err != nil {
		t.Fatalf("signingKey: %v", err)
	}
	second, err := signingKey(app)
	if err != nil {
		t.Fatalf("signingKey (2nd): %v", err)
	}
	if first != second {
		t.Fatal("signingKey is not deterministic across calls")
	}
}

func TestParseScopes(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"mail:read", 1},
		{"mail:read drive:write", 2},
		{"  mail:read   drive:write  ", 2},
	}
	for _, c := range cases {
		if got := ParseScopes(c.in); len(got) != c.want {
			t.Errorf("ParseScopes(%q) = %v, want %d scopes", c.in, got, c.want)
		}
	}
}

func TestHasScope(t *testing.T) {
	granted := []string{"mail:read", "drive:write"}
	if !HasScope(granted, "mail:read") {
		t.Error("HasScope should find a granted scope")
	}
	if HasScope(granted, "mail:send") {
		t.Error("HasScope must not find an ungranted scope")
	}
	if HasScope(nil, "mail:read") {
		t.Error("HasScope on nil must be false")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestSigningKey|TestParseScopes|TestHasScope' -v`
Expected: FAIL — the `oauth` package does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/oauth/oauth.go`:

```go
// Package oauth is TinyCld's OAuth 2.1 authorization server.
//
// PocketBase is an OAuth2 *client* (social login); it issues nothing to third
// parties. This package supplies the other half: the Device Authorization
// Grant (RFC 8628) that the tinycld CLI uses, and Authorization Code + PKCE
// (RFC 7636) for integrations such as Zapier.
//
// Access tokens are ordinary PocketBase `auth`-type static tokens. That is
// deliberate: PocketBase's own loadAuthToken middleware resolves them and
// populates e.Auth, so every existing endpoint and collection rule keeps
// working with no per-endpoint changes. What OAuth adds on top is a grant
// record consulted on every request — which is the only way to revoke one
// device without rotating tokenKey and killing the user's web session too.
package oauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Collection names this package owns.
const (
	clientsCollection = "oauth_clients"
	grantsCollection  = "oauth_grants"
)

// Scopes. Named <package>:<capability> so the set grows naturally as packages
// are installed. `profile` is the baseline identity scope every grant gets.
const (
	ScopeProfile        = "profile"
	ScopeMailRead       = "mail:read"
	ScopeMailSend       = "mail:send"
	ScopeDriveRead      = "drive:read"
	ScopeDriveWrite     = "drive:write"
	ScopeContactsRead   = "contacts:read"
	ScopeContactsWrite  = "contacts:write"
	ScopeCalendarRead   = "calendar:read"
	ScopeCalendarWrite  = "calendar:write"
)

// AllScopes is the full catalog, used to validate a requested scope string and
// to render the consent screen.
var AllScopes = []string{
	ScopeProfile,
	ScopeMailRead, ScopeMailSend,
	ScopeDriveRead, ScopeDriveWrite,
	ScopeContactsRead, ScopeContactsWrite,
	ScopeCalendarRead, ScopeCalendarWrite,
}

// Claims is the verified payload carried by an OAuth access token, over and
// above the standard PocketBase auth claims. GrantID is the jti: the row this
// token is bound to, re-read on every request so revocation is immediate.
type Claims struct {
	GrantID  string
	ClientID string
	Scopes   []string
}

var (
	// ErrInvalidGrant covers a missing, malformed, or expired grant. Maps to 401.
	ErrInvalidGrant = errors.New("oauth: invalid grant")
	// ErrGrantRevoked is a grant explicitly revoked by the user. Maps to 401.
	ErrGrantRevoked = errors.New("oauth: grant revoked")
	// ErrInsufficientScope is a valid grant lacking the scope for this route.
	// Maps to 403 (RFC 6750 §3.1).
	ErrInsufficientScope = errors.New("oauth: insufficient scope")
)

// ParseScopes splits a space-delimited scope string, dropping empties so
// "  a   b  " and "a b" parse identically.
func ParseScopes(s string) []string {
	return strings.Fields(s)
}

// HasScope reports whether granted contains want.
func HasScope(granted []string, want string) bool {
	for _, g := range granted {
		if g == want {
			return true
		}
	}
	return false
}

// signingKey derives a dedicated HMAC key for OAuth artifacts (device codes,
// authorization codes) from the _superusers auth-token secret.
//
// We never sign with the raw auth secret directly. A domain-separated subkey
// means an OAuth artifact's signature cannot be confused with a PocketBase
// auth token even though both are HS256. The _superusers secret is app-wide
// and stable across restarts, so every module derives the same key. The `:v1`
// suffix is the rotation seam: bump it to invalidate every outstanding
// artifact at once. Mirrors sharelink.signingKey.
func signingKey(app core.App) (string, error) {
	col, err := app.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return "", fmt.Errorf("oauth: load superusers collection: %w", err)
	}
	base := col.AuthToken.Secret
	if base == "" {
		return "", errors.New("oauth: superusers auth token secret is empty")
	}
	mac := hmac.New(sha256.New, []byte(base))
	mac.Write([]byte("tinycld:oauth:v1"))
	return hex.EncodeToString(mac.Sum(nil)), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS — all four tests.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/server/oauth/
git commit -m "feat(oauth): scope catalog, claims, and domain-separated signing key"
```

---

## Task 2: The `oauth_clients` and `oauth_grants` collections

**Files:**
- Create: `tinycld/core/server/pb_migrations/1980000000_create_oauth_collections.js`
- Test: `tinycld/core/server/oauth/schema_test.go`

**Interfaces:**
- Consumes: collection-name constants from Task 1
- Produces: two collections. `oauth_clients` fields: `client_id`, `name`, `redirect_uris` (json), `scopes`, `type` (`public`|`confidential`), `client_secret_hash`, `is_first_party`. `oauth_grants` fields: `user`, `client`, `jti`, `scopes`, `refresh_token_hash`, `device_code`, `user_code`, `code_challenge`, `auth_code_hash`, `redirect_uri`, `status` (`pending`|`active`|`revoked`), `expires_at`, `last_used_at`, `device_label`

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/schema_test.go`:

```go
package oauth

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// newSchemaApp builds the oauth collections the way the migration does, so the
// package's own tests do not depend on the migration runner. TestMigration-
// ShapeMatchesHelper below is what keeps the two in step.
func newSchemaApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	clients := core.NewBaseCollection(clientsCollection)
	clients.Fields.Add(&core.TextField{Name: "client_id", Required: true})
	clients.Fields.Add(&core.TextField{Name: "name", Required: true})
	clients.Fields.Add(&core.JSONField{Name: "redirect_uris"})
	clients.Fields.Add(&core.TextField{Name: "scopes"})
	clients.Fields.Add(&core.SelectField{
		Name: "type", Required: true, MaxSelect: 1,
		Values: []string{"public", "confidential"},
	})
	clients.Fields.Add(&core.TextField{Name: "client_secret_hash"})
	clients.Fields.Add(&core.BoolField{Name: "is_first_party"})
	clients.AddIndex("idx_oauth_clients_client_id", true, "client_id", "")
	if err := app.Save(clients); err != nil {
		t.Fatalf("save oauth_clients: %v", err)
	}

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}

	grants := core.NewBaseCollection(grantsCollection)
	// Deliberately NOT Required — a pending device grant has no user until
	// approval. See the migration's comment on og_user.
	grants.Fields.Add(&core.RelationField{
		Name: "user", Required: false, MaxSelect: 1,
		CollectionId: users.Id, CascadeDelete: true,
	})
	grants.Fields.Add(&core.RelationField{
		Name: "client", Required: true, MaxSelect: 1,
		CollectionId: clients.Id, CascadeDelete: true,
	})
	grants.Fields.Add(&core.TextField{Name: "jti"})
	grants.Fields.Add(&core.TextField{Name: "scopes"})
	grants.Fields.Add(&core.TextField{Name: "refresh_token_hash"})
	grants.Fields.Add(&core.TextField{Name: "device_code"})
	grants.Fields.Add(&core.TextField{Name: "user_code"})
	grants.Fields.Add(&core.TextField{Name: "code_challenge"})
	grants.Fields.Add(&core.TextField{Name: "auth_code_hash"})
	grants.Fields.Add(&core.TextField{Name: "redirect_uri"})
	grants.Fields.Add(&core.SelectField{
		Name: "status", Required: true, MaxSelect: 1,
		Values: []string{"pending", "active", "revoked"},
	})
	grants.Fields.Add(&core.DateField{Name: "expires_at"})
	grants.Fields.Add(&core.DateField{Name: "last_used_at"})
	grants.Fields.Add(&core.TextField{Name: "device_label"})
	grants.AddIndex("idx_oauth_grants_jti", true, "jti", "")
	grants.AddIndex("idx_oauth_grants_user", false, "user", "")
	if err := app.Save(grants); err != nil {
		t.Fatalf("save oauth_grants: %v", err)
	}

	return app
}

func TestOAuthCollectionsExist(t *testing.T) {
	app := newSchemaApp(t)

	for _, name := range []string{clientsCollection, grantsCollection} {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("collection %s missing: %v", name, err)
		}
		// Writes must never be reachable through the record API: PocketBase
		// rules cannot constrain WHICH fields a write touches, which is why
		// users_guard.go exists. Minting and revoking go through Go handlers.
		if col.CreateRule != nil || col.UpdateRule != nil || col.DeleteRule != nil {
			t.Errorf("%s: create/update/delete rules must be nil (superuser-only)", name)
		}
	}
}

func TestGrantJTIIsUnique(t *testing.T) {
	app := newSchemaApp(t)
	grants, err := app.FindCollectionByNameOrId(grantsCollection)
	if err != nil {
		t.Fatalf("find grants: %v", err)
	}

	var found bool
	for _, idx := range grants.Indexes {
		if contains(idx, "jti") && contains(idx, "UNIQUE") {
			found = true
		}
	}
	if !found {
		t.Fatal("oauth_grants needs a UNIQUE index on jti — it is the token→grant key")
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) &&
		(haystack == needle || len(needle) == 0 ||
			indexOf(haystack, needle) >= 0)
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestOAuthCollections|TestGrantJTI' -v`
Expected: FAIL — `newSchemaApp` compiles but the constants resolve to collections the test itself creates, so this passes only once the file exists. If the package does not compile, that is the expected failure.

- [ ] **Step 3: Write the migration**

Create `tinycld/core/server/pb_migrations/1980000000_create_oauth_collections.js`:

```javascript
/// <reference path="../pb_data/types.d.ts" />
// OAuth 2.1 authorization server storage.
//
// oauth_clients is the registry of things allowed to ask for access: the
// first-party CLI, and later integrations such as Zapier. oauth_grants is one
// row per issued authorization — the row an access token's `jti` points at.
//
// Why a row at all, when the token is a signed JWT: PocketBase signs auth
// tokens with (record.tokenKey + collection secret), so the only built-in
// revocation is rotating tokenKey, which kills EVERY token for that user
// including their web session. Per-device revoke ("disconnect my laptop",
// "disconnect Zapier") therefore needs server-side state consulted on each
// request. That is this table.
//
// Every rule is null => superuser-only. PocketBase rules cannot constrain
// WHICH fields a write touches (the same reason users_guard.go exists in Go),
// so minting, approval, and revocation all go through the oauth package's
// handlers rather than the record API.
migrate(
    app => {
        const clients = new Collection({
            id: 'pbc_oauth_clients_01',
            name: 'oauth_clients',
            type: 'base',
            system: false,
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'oc_client_id',
                    name: 'client_id',
                    type: 'text',
                    required: true,
                    min: 3,
                    max: 100,
                    pattern: '^[a-z0-9][a-z0-9-]*$',
                },
                { id: 'oc_name', name: 'name', type: 'text', required: true, min: 1, max: 200 },
                { id: 'oc_redirect_uris', name: 'redirect_uris', type: 'json' },
                { id: 'oc_scopes', name: 'scopes', type: 'text', max: 500 },
                {
                    id: 'oc_type',
                    name: 'type',
                    type: 'select',
                    required: true,
                    values: ['public', 'confidential'],
                    maxSelect: 1,
                },
                // Hash only. A public client (the CLI) has no secret at all —
                // PKCE is what protects it.
                { id: 'oc_secret_hash', name: 'client_secret_hash', type: 'text', max: 200 },
                { id: 'oc_first_party', name: 'is_first_party', type: 'bool' },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_oauth_clients_client_id ON oauth_clients (client_id)',
            ],
        })
        app.save(clients)

        const users = app.findCollectionByNameOrId('users')

        const grants = new Collection({
            id: 'pbc_oauth_grants_01',
            name: 'oauth_grants',
            type: 'base',
            system: false,
            // A user may LIST and VIEW their own grants so the Connected apps
            // screen can render without a bespoke endpoint. Writes stay closed.
            listRule: '@request.auth.id != "" && user = @request.auth.id',
            viewRule: '@request.auth.id != "" && user = @request.auth.id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                // NOT required: the device flow (RFC 8628) creates a PENDING
                // grant BEFORE any user is known — the user is bound when they
                // approve in the browser. PocketBase's RelationField.Validate-
                // Value returns ErrRequired for an empty required relation, so
                // marking this required would make the device flow unable to
                // store its own pending row. The invariant is enforced in Go
                // instead: VerifyGrant only accepts status "active", and a
                // grant only reaches "active" through approval, which sets the
                // user.
                {
                    id: 'og_user',
                    name: 'user',
                    type: 'relation',
                    required: false,
                    collectionId: users.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'og_client',
                    name: 'client',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_oauth_clients_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // jti: the access token's grant id. Unique because it is the
                // lookup key on every authenticated request.
                { id: 'og_jti', name: 'jti', type: 'text', max: 100 },
                { id: 'og_scopes', name: 'scopes', type: 'text', max: 500 },
                { id: 'og_refresh_hash', name: 'refresh_token_hash', type: 'text', max: 200 },
                // Device Grant (RFC 8628) working state, cleared on approval.
                { id: 'og_device_code', name: 'device_code', type: 'text', max: 200 },
                { id: 'og_user_code', name: 'user_code', type: 'text', max: 20 },
                // Authorization Code + PKCE working state, cleared on exchange.
                { id: 'og_code_challenge', name: 'code_challenge', type: 'text', max: 200 },
                { id: 'og_auth_code_hash', name: 'auth_code_hash', type: 'text', max: 200 },
                { id: 'og_redirect_uri', name: 'redirect_uri', type: 'text', max: 2000 },
                {
                    id: 'og_status',
                    name: 'status',
                    type: 'select',
                    required: true,
                    values: ['pending', 'active', 'revoked'],
                    maxSelect: 1,
                },
                { id: 'og_expires_at', name: 'expires_at', type: 'date' },
                { id: 'og_last_used_at', name: 'last_used_at', type: 'date' },
                // Shown in Connected apps so a user can tell devices apart.
                { id: 'og_device_label', name: 'device_label', type: 'text', max: 200 },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_oauth_grants_jti ON oauth_grants (jti)',
                'CREATE INDEX idx_oauth_grants_user ON oauth_grants (user)',
                'CREATE INDEX idx_oauth_grants_user_code ON oauth_grants (user_code)',
            ],
        })
        app.save(grants)
    },
    app => {
        // Drop grants first: it holds a cascading relation into clients.
        app.delete(app.findCollectionByNameOrId('oauth_grants'))
        app.delete(app.findCollectionByNameOrId('oauth_clients'))
    }
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS.

Then verify the migration itself applies cleanly against a real DB:

Run: `cd tinycld && pnpm run packages:generate`
Expected: completes without error; `core/types/pbSchema.ts` now contains `OauthClients` and `OauthGrants` interfaces.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/server/pb_migrations/1980000000_create_oauth_collections.js tinycld/core/server/oauth/schema_test.go
git commit -m "feat(oauth): add oauth_clients and oauth_grants collections"
```

---

## Task 3: PKCE verification

**Files:**
- Create: `tinycld/core/server/oauth/pkce.go`
- Test: `tinycld/core/server/oauth/pkce_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `VerifyPKCE(challenge, verifier string) bool`; `MethodS256 = "S256"`

PKCE is what protects a public client (the CLI, and Zapier's redirect) from an intercepted authorization code. OAuth 2.1 requires it and drops the `plain` method, so only `S256` is implemented.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/pkce_test.go`:

```go
package oauth

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

// challengeFor builds the S256 challenge for a verifier the way a conforming
// client does: BASE64URL(SHA256(ASCII(verifier))), no padding.
func challengeFor(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func TestVerifyPKCEAcceptsMatchingVerifier(t *testing.T) {
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	if !VerifyPKCE(challengeFor(verifier), verifier) {
		t.Fatal("a correct verifier must validate")
	}
}

func TestVerifyPKCERejectsWrongVerifier(t *testing.T) {
	challenge := challengeFor("the-real-verifier")
	if VerifyPKCE(challenge, "an-attackers-guess") {
		t.Fatal("a wrong verifier must not validate — this is the whole point of PKCE")
	}
}

func TestVerifyPKCERejectsEmptyInput(t *testing.T) {
	// An empty challenge or verifier must never authorize. Without this an
	// attacker who strips the PKCE params gets a free pass.
	if VerifyPKCE("", "") {
		t.Fatal("empty challenge+verifier must not validate")
	}
	if VerifyPKCE(challengeFor("x"), "") {
		t.Fatal("empty verifier must not validate")
	}
	if VerifyPKCE("", "x") {
		t.Fatal("empty challenge must not validate")
	}
}

func TestVerifyPKCERejectsPlainMethod(t *testing.T) {
	// OAuth 2.1 removes the `plain` method. Passing the verifier as its own
	// challenge must fail.
	verifier := "some-verifier-value"
	if VerifyPKCE(verifier, verifier) {
		t.Fatal("plain-style challenge (verifier == challenge) must not validate")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run TestVerifyPKCE -v`
Expected: FAIL — `undefined: VerifyPKCE`.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/oauth/pkce.go`:

```go
package oauth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
)

// MethodS256 is the only code_challenge_method we accept. OAuth 2.1 removes
// `plain`, and supporting it would defeat the purpose: an attacker who
// intercepts the authorization request could replay the challenge verbatim.
const MethodS256 = "S256"

// VerifyPKCE reports whether verifier hashes to challenge under S256:
// BASE64URL-ENCODE(SHA256(ASCII(verifier))) == challenge, unpadded.
//
// Empty inputs always fail — a stripped PKCE parameter must never read as a
// successful verification.
func VerifyPKCE(challenge, verifier string) bool {
	if challenge == "" || verifier == "" {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) == 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -run TestVerifyPKCE -v`
Expected: PASS — all four tests.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/server/oauth/pkce.go tinycld/core/server/oauth/pkce_test.go
git commit -m "feat(oauth): S256 PKCE verification"
```

---

## Task 4: Grant storage — mint, lookup, revoke

**Files:**
- Create: `tinycld/core/server/oauth/grants.go`
- Test: `tinycld/core/server/oauth/grants_test.go`

**Interfaces:**
- Consumes: `newSchemaApp` (Task 2 test helper), constants and errors from Task 1
- Produces: `NewGrant(app, userID, clientRecID, scopes []string, status string) (*core.Record, error)`; `FindGrantByJTI(app, jti string) (*core.Record, error)`; `FindGrantByUserCode(app, userCode string) (*core.Record, error)`; `RevokeGrant(app, grantID string) error`; `TouchGrant(app, grant *core.Record) error`; `VerifyGrant(app, jti string) (*core.Record, error)`; `randomToken(nBytes int) (string, error)`; `hashSecret(string) string`; `newUserCode() (string, error)`

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/grants_test.go`:

```go
package oauth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// seedUserAndClient creates one user and one public client, returning their ids.
func seedUserAndClient(t *testing.T, app *tests.TestApp) (userID, clientRecID string) {
	t.Helper()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(users)
	u.Set("email", "alice@example.com")
	u.Set("password", "s3cret-password")
	if err := app.Save(u); err != nil {
		t.Fatalf("save user: %v", err)
	}

	clients, err := app.FindCollectionByNameOrId(clientsCollection)
	if err != nil {
		t.Fatalf("find clients: %v", err)
	}
	c := core.NewRecord(clients)
	c.Set("client_id", "tinycld-cli")
	c.Set("name", "TinyCld CLI")
	c.Set("type", "public")
	c.Set("is_first_party", true)
	if err := app.Save(c); err != nil {
		t.Fatalf("save client: %v", err)
	}
	return u.Id, c.Id
}

func TestNewGrantIsFindableByJTI(t *testing.T) {
	app := newSchemaApp(t)
	userID, clientID := seedUserAndClient(t, app)

	grant, err := NewGrant(app, userID, clientID, []string{ScopeMailRead}, "active")
	if err != nil {
		t.Fatalf("NewGrant: %v", err)
	}
	jti := grant.GetString("jti")
	if jti == "" {
		t.Fatal("NewGrant must assign a jti")
	}

	found, err := FindGrantByJTI(app, jti)
	if err != nil {
		t.Fatalf("FindGrantByJTI: %v", err)
	}
	if found.Id != grant.Id {
		t.Fatalf("found grant %s, want %s", found.Id, grant.Id)
	}
}

func TestVerifyGrantRejectsRevoked(t *testing.T) {
	app := newSchemaApp(t)
	userID, clientID := seedUserAndClient(t, app)

	grant, err := NewGrant(app, userID, clientID, []string{ScopeMailRead}, "active")
	if err != nil {
		t.Fatalf("NewGrant: %v", err)
	}
	jti := grant.GetString("jti")

	// Sanity: valid before revocation.
	if _, err := VerifyGrant(app, jti); err != nil {
		t.Fatalf("VerifyGrant before revoke: %v", err)
	}

	if err := RevokeGrant(app, grant.Id); err != nil {
		t.Fatalf("RevokeGrant: %v", err)
	}

	// This is the property the whole design exists for: revoking one grant
	// must take effect on the very next request.
	if _, err := VerifyGrant(app, jti); !errors.Is(err, ErrGrantRevoked) {
		t.Fatalf("VerifyGrant after revoke = %v, want ErrGrantRevoked", err)
	}
}

func TestVerifyGrantRejectsExpired(t *testing.T) {
	app := newSchemaApp(t)
	userID, clientID := seedUserAndClient(t, app)

	grant, err := NewGrant(app, userID, clientID, []string{ScopeMailRead}, "active")
	if err != nil {
		t.Fatalf("NewGrant: %v", err)
	}
	grant.Set("expires_at", time.Now().Add(-time.Hour))
	if err := app.Save(grant); err != nil {
		t.Fatalf("save expired grant: %v", err)
	}

	if _, err := VerifyGrant(app, grant.GetString("jti")); !errors.Is(err, ErrInvalidGrant) {
		t.Fatalf("VerifyGrant on expired = %v, want ErrInvalidGrant", err)
	}
}

func TestVerifyGrantRejectsPending(t *testing.T) {
	app := newSchemaApp(t)
	userID, clientID := seedUserAndClient(t, app)

	// A device-flow grant awaiting approval must not authorize anything.
	grant, err := NewGrant(app, userID, clientID, []string{ScopeMailRead}, "pending")
	if err != nil {
		t.Fatalf("NewGrant: %v", err)
	}
	if _, err := VerifyGrant(app, grant.GetString("jti")); !errors.Is(err, ErrInvalidGrant) {
		t.Fatalf("VerifyGrant on pending = %v, want ErrInvalidGrant", err)
	}
}

func TestVerifyGrantRejectsUnknownJTI(t *testing.T) {
	app := newSchemaApp(t)
	if _, err := VerifyGrant(app, "no-such-jti"); !errors.Is(err, ErrInvalidGrant) {
		t.Fatalf("VerifyGrant on unknown jti = %v, want ErrInvalidGrant", err)
	}
}

func TestNewUserCodeIsReadable(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		code, err := newUserCode()
		if err != nil {
			t.Fatalf("newUserCode: %v", err)
		}
		// Format WDJB-MJHT: two groups of four, one dash.
		if len(code) != 9 || code[4] != '-' {
			t.Fatalf("newUserCode() = %q, want XXXX-XXXX", code)
		}
		// Ambiguous glyphs must be absent — users read these aloud and retype them.
		for _, bad := range []string{"0", "O", "1", "I", "L"} {
			if strings.Contains(code, bad) {
				t.Fatalf("user code %q contains ambiguous character %q", code, bad)
			}
		}
		if seen[code] {
			t.Fatalf("newUserCode produced a duplicate within 50 draws: %q", code)
		}
		seen[code] = true
	}
}

func TestHashSecretIsStableAndNotPlaintext(t *testing.T) {
	h1 := hashSecret("super-secret")
	h2 := hashSecret("super-secret")
	if h1 != h2 {
		t.Fatal("hashSecret must be deterministic")
	}
	if strings.Contains(h1, "super-secret") {
		t.Fatal("hashSecret must not embed the plaintext")
	}
	if h1 == hashSecret("different") {
		t.Fatal("hashSecret must differ for different inputs")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestNewGrant|TestVerifyGrant|TestNewUserCode|TestHashSecret' -v`
Expected: FAIL — `undefined: NewGrant`, `undefined: VerifyGrant`, etc.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/oauth/grants.go`:

```go
package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// touchInterval throttles last_used_at writes. Without it every authenticated
// request would issue a write, turning a read-mostly workload into a
// write-heavy one for no user-visible gain — the field only drives the
// "last used" line on the Connected apps screen.
const touchInterval = 5 * time.Minute

// userCodeAlphabet omits 0/O/1/I/L. A user reads this code off a terminal and
// types it into a browser, so ambiguous glyphs are a real support cost.
const userCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// randomToken returns nBytes of crypto/rand as unpadded base64url.
func randomToken(nBytes int) (string, error) {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("oauth: read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// hashSecret returns the hex SHA-256 of s. Used for refresh tokens, client
// secrets, and authorization codes: we store only the hash, so a database read
// never yields a usable credential.
func hashSecret(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// newUserCode returns a human-transcribable code shaped XXXX-XXXX.
func newUserCode() (string, error) {
	out := make([]byte, 0, 9)
	for i := 0; i < 8; i++ {
		if i == 4 {
			out = append(out, '-')
		}
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(userCodeAlphabet))))
		if err != nil {
			return "", fmt.Errorf("oauth: read random: %w", err)
		}
		out = append(out, userCodeAlphabet[n.Int64()])
	}
	return string(out), nil
}

// NewGrant creates a grant row with a fresh jti. status is "pending" for a
// device flow awaiting approval, or "active" for an already-authorized grant.
func NewGrant(
	app core.App,
	userID, clientRecID string,
	scopes []string,
	status string,
) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(grantsCollection)
	if err != nil {
		return nil, fmt.Errorf("oauth: find %s: %w", grantsCollection, err)
	}
	jti, err := randomToken(24)
	if err != nil {
		return nil, err
	}

	rec := core.NewRecord(col)
	rec.Set("user", userID)
	rec.Set("client", clientRecID)
	rec.Set("jti", jti)
	rec.Set("scopes", strings.Join(scopes, " "))
	rec.Set("status", status)
	if err := app.Save(rec); err != nil {
		return nil, fmt.Errorf("oauth: save grant: %w", err)
	}
	return rec, nil
}

// FindGrantByJTI looks up a grant by its token id.
func FindGrantByJTI(app core.App, jti string) (*core.Record, error) {
	if jti == "" {
		return nil, ErrInvalidGrant
	}
	rec, err := app.FindFirstRecordByFilter(
		grantsCollection, "jti = {:jti}", map[string]any{"jti": jti},
	)
	if err != nil || rec == nil {
		return nil, ErrInvalidGrant
	}
	return rec, nil
}

// FindGrantByUserCode looks up a pending device-flow grant by the code the
// user types into the browser.
func FindGrantByUserCode(app core.App, userCode string) (*core.Record, error) {
	if userCode == "" {
		return nil, ErrInvalidGrant
	}
	rec, err := app.FindFirstRecordByFilter(
		grantsCollection, "user_code = {:c}", map[string]any{"c": userCode},
	)
	if err != nil || rec == nil {
		return nil, ErrInvalidGrant
	}
	return rec, nil
}

// VerifyGrant is the check every authenticated request runs. A valid signature
// is never sufficient: the row is re-read so a revocation takes effect on the
// next request, and status and expiry are re-checked against current state.
// Mirrors sharelink.VerifyAndResolve.
func VerifyGrant(app core.App, jti string) (*core.Record, error) {
	rec, err := FindGrantByJTI(app, jti)
	if err != nil {
		return nil, err
	}
	switch rec.GetString("status") {
	case "revoked":
		return nil, ErrGrantRevoked
	case "active":
		// ok
	default:
		// "pending" — a device grant nobody has approved yet.
		return nil, ErrInvalidGrant
	}
	if exp := rec.GetDateTime("expires_at"); !exp.IsZero() && exp.Time().Before(time.Now()) {
		return nil, ErrInvalidGrant
	}
	return rec, nil
}

// RevokeGrant marks a grant revoked. Idempotent: revoking twice is not an error.
func RevokeGrant(app core.App, grantID string) error {
	rec, err := app.FindRecordById(grantsCollection, grantID)
	if err != nil {
		return fmt.Errorf("oauth: find grant %s: %w", grantID, err)
	}
	rec.Set("status", "revoked")
	// Clear the credential material so a revoked row holds nothing usable.
	rec.Set("refresh_token_hash", "")
	rec.Set("auth_code_hash", "")
	if err := app.Save(rec); err != nil {
		return fmt.Errorf("oauth: save revoked grant: %w", err)
	}
	return nil
}

// TouchGrant stamps last_used_at, at most once per touchInterval.
func TouchGrant(app core.App, grant *core.Record) error {
	last := grant.GetDateTime("last_used_at")
	if !last.IsZero() && time.Since(last.Time()) < touchInterval {
		return nil
	}
	grant.Set("last_used_at", time.Now())
	if err := app.Save(grant); err != nil {
		return fmt.Errorf("oauth: touch grant: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS — all tests including the earlier tasks'.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/server/oauth/grants.go tinycld/core/server/oauth/grants_test.go
git commit -m "feat(oauth): grant storage with immediate revocation"
```

---

## Task 5: The grant-enforcement middleware

**Files:**
- Create: `tinycld/core/server/oauth/middleware.go`
- Test: `tinycld/core/server/oauth/middleware_test.go`

**Interfaces:**
- Consumes: `VerifyGrant`, `TouchGrant`, `HasScope`, `ParseScopes` (Tasks 1, 4)
- Produces: `ScopeForRoute(method, path string) string`; `IsOAuthToken(token string) bool`; `grantIDFromToken(token string) string`; `MintAccessToken(app, user *core.Record, grant *core.Record, ttl time.Duration) (string, error)`; `AccessTokenTTL`; `RefreshTokenTTL`

An OAuth access token is a PocketBase static auth token carrying an extra `tcg` (TinyCld grant) claim holding the `jti`. PocketBase's `loadAuthToken` ignores unknown claims and resolves the token normally, so `e.Auth` is populated for free; this middleware reads `tcg` back out and enforces the grant.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/middleware_test.go`:

```go
package oauth

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestScopeForRouteMapsKnownRoutes(t *testing.T) {
	cases := []struct {
		method, path, want string
	}{
		{"GET", "/api/mail/search", ScopeMailRead},
		{"POST", "/api/mail/send", ScopeMailSend},
		{"POST", "/api/mail/draft", ScopeMailSend},
		{"GET", "/api/drive/search", ScopeDriveRead},
		{"POST", "/api/drive/download-token", ScopeDriveRead},
		{"POST", "/api/drive/upload-version", ScopeDriveWrite},
		{"GET", "/api/collections/mail_messages/records", ScopeMailRead},
		{"POST", "/api/collections/drive_items/records", ScopeDriveWrite},
		{"GET", "/api/collections/contacts/records", ScopeContactsRead},
		{"PATCH", "/api/collections/calendar_events/records/abc", ScopeCalendarWrite},
	}
	for _, c := range cases {
		if got := ScopeForRoute(c.method, c.path); got != c.want {
			t.Errorf("ScopeForRoute(%s %s) = %q, want %q", c.method, c.path, got, c.want)
		}
	}
}

func TestScopeForRouteDefaultDenies(t *testing.T) {
	// Default deny: a route no rule covers must return "" so the middleware
	// refuses it for OAuth callers rather than silently allowing it.
	if got := ScopeForRoute("POST", "/api/admin/packages/install"); got != "" {
		t.Fatalf("ScopeForRoute on an uncovered admin route = %q, want \"\"", got)
	}
	if got := ScopeForRoute("GET", "/api/collections/pkg_registry/records"); got != "" {
		t.Fatalf("ScopeForRoute on an uncovered collection = %q, want \"\"", got)
	}
}

func TestScopeForRouteAllowsUnauthenticatedPublicRoutes(t *testing.T) {
	// These carry no user data and must stay reachable so a CLI can probe a
	// host and complete a login before it holds any grant.
	for _, p := range []string{"/api/health", "/api/org-info", "/oauth/token", "/oauth/device"} {
		if got := ScopeForRoute("GET", p); got != scopeExempt {
			t.Errorf("ScopeForRoute(GET %s) = %q, want exempt", p, got)
		}
	}
}

func TestMintAccessTokenCarriesGrantClaim(t *testing.T) {
	app := newSchemaApp(t)
	userID, clientID := seedUserAndClient(t, app)

	grant, err := NewGrant(app, userID, clientID, []string{ScopeMailRead}, "active")
	if err != nil {
		t.Fatalf("NewGrant: %v", err)
	}
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}

	token, err := MintAccessToken(app, user, grant, AccessTokenTTL)
	if err != nil {
		t.Fatalf("MintAccessToken: %v", err)
	}
	if token == "" {
		t.Fatal("MintAccessToken returned empty token")
	}

	// The grant id must be recoverable from the token, or the middleware has
	// nothing to look up.
	if got := grantIDFromToken(token); got != grant.GetString("jti") {
		t.Fatalf("grantIDFromToken = %q, want %q", got, grant.GetString("jti"))
	}
	if !IsOAuthToken(token) {
		t.Fatal("IsOAuthToken must recognize a minted access token")
	}
}

func TestMintedTokenResolvesThroughPocketBase(t *testing.T) {
	// The load-bearing claim of the whole design: an OAuth access token is an
	// ordinary PB auth token, so PB's own resolver accepts it and every
	// existing endpoint keeps working with no per-endpoint change.
	app := newSchemaApp(t)
	userID, clientID := seedUserAndClient(t, app)

	grant, err := NewGrant(app, userID, clientID, []string{ScopeMailRead}, "active")
	if err != nil {
		t.Fatalf("NewGrant: %v", err)
	}
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	token, err := MintAccessToken(app, user, grant, AccessTokenTTL)
	if err != nil {
		t.Fatalf("MintAccessToken: %v", err)
	}

	resolved, err := app.FindAuthRecordByToken(token, core.TokenTypeAuth)
	if err != nil {
		t.Fatalf("PocketBase rejected an OAuth access token: %v", err)
	}
	if resolved.Id != userID {
		t.Fatalf("resolved user %s, want %s", resolved.Id, userID)
	}
}

func TestIsOAuthTokenRejectsPlainAuthToken(t *testing.T) {
	app := newSchemaApp(t)
	userID, _ := seedUserAndClient(t, app)
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	// A normal web-session token carries no grant claim; the middleware must
	// leave it entirely alone.
	plain, err := user.NewAuthToken()
	if err != nil {
		t.Fatalf("NewAuthToken: %v", err)
	}
	if IsOAuthToken(plain) {
		t.Fatal("a plain web-session token must not be treated as an OAuth token")
	}
}

func TestAccessTokenTTLIsShorterThanRefresh(t *testing.T) {
	if AccessTokenTTL >= RefreshTokenTTL {
		t.Fatalf("AccessTokenTTL (%v) must be shorter than RefreshTokenTTL (%v)",
			AccessTokenTTL, RefreshTokenTTL)
	}
	if AccessTokenTTL > 24*time.Hour {
		t.Fatalf("AccessTokenTTL (%v) is too long for a bearer token", AccessTokenTTL)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestScopeForRoute|TestMint|TestIsOAuth|TestAccessTokenTTL' -v`
Expected: FAIL — `undefined: ScopeForRoute`, `undefined: MintAccessToken`.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/oauth/middleware.go`:

```go
package oauth

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/security"
)

// Token lifetimes. The access token is deliberately short: it is a bearer
// credential that travels on every request, and the refresh token (stored
// only as a hash) is what gives a CLI or integration long-lived access.
const (
	AccessTokenTTL  = 1 * time.Hour
	RefreshTokenTTL = 90 * 24 * time.Hour
	// DeviceCodeTTL bounds how long a user has to approve a device login.
	DeviceCodeTTL = 15 * time.Minute
	// AuthCodeTTL is short by design — the code is exchanged immediately.
	AuthCodeTTL = 60 * time.Second
)

// grantClaim is the private claim carrying the grant's jti. PocketBase ignores
// claims it does not know, so adding this keeps the token a valid PB auth
// token while letting us find the grant row.
const grantClaim = "tcg"

// scopeExempt marks routes reachable without any scope check — public probes
// and the OAuth endpoints themselves, which must work before a grant exists.
const scopeExempt = "-"

// middlewarePriority runs this check BEFORE PocketBase's own loadAuthToken.
// Lower number = earlier. We need to run first so that, for an OAuth token, we
// are the one who validates the grant; PB's middleware then finds e.Auth
// already set and no-ops (see apis/middlewares.go:190).
var middlewarePriority = apis.DefaultLoadAuthTokenMiddlewarePriority - 10

// collectionScopes maps a PocketBase collection to the scopes governing it.
// Anything absent is denied for OAuth callers by default.
var collectionScopes = map[string][2]string{
	// collection: {read scope, write scope}
	"mail_messages":     {ScopeMailRead, ScopeMailSend},
	"mail_threads":      {ScopeMailRead, ScopeMailSend},
	"mail_thread_state": {ScopeMailRead, ScopeMailSend},
	"mail_mailboxes":    {ScopeMailRead, ScopeMailSend},
	"drive_items":       {ScopeDriveRead, ScopeDriveWrite},
	"drive_shares":      {ScopeDriveRead, ScopeDriveWrite},
	"drive_item_state":  {ScopeDriveRead, ScopeDriveWrite},
	"contacts":          {ScopeContactsRead, ScopeContactsWrite},
	"calendar_events":   {ScopeCalendarRead, ScopeCalendarWrite},
	"calendar_calendars": {ScopeCalendarRead, ScopeCalendarWrite},
	"users":             {ScopeProfile, ""},
}

// endpointScopes maps a bespoke Go endpoint to its required scope.
var endpointScopes = map[string]string{
	"GET /api/mail/search":          ScopeMailRead,
	"POST /api/mail/send":           ScopeMailSend,
	"POST /api/mail/draft":          ScopeMailSend,
	"GET /api/drive/search":         ScopeDriveRead,
	"POST /api/drive/download-token": ScopeDriveRead,
	"POST /api/drive/export-token":  ScopeDriveRead,
	"GET /api/drive/storage-usage":  ScopeDriveRead,
	"POST /api/drive/upload-version": ScopeDriveWrite,
	"POST /api/drive/share":         ScopeDriveWrite,
	"GET /api/contacts/search":      ScopeContactsRead,
}

// exemptPaths need no scope: public probes, and the OAuth endpoints a client
// must reach before it holds any grant.
var exemptPaths = []string{
	"/api/health",
	"/api/org-info",
	"/api/version",
	"/api/release",
	"/oauth/",
	"/.well-known/",
}

// writeMethods are the HTTP verbs treated as writes for scope selection.
var writeMethods = map[string]bool{
	"POST": true, "PUT": true, "PATCH": true, "DELETE": true,
}

// ScopeForRoute returns the scope required for a request, scopeExempt for
// public routes, or "" meaning deny.
//
// Default deny is deliberate: a route nobody has classified must not be
// reachable with a third-party token just because someone added it.
func ScopeForRoute(method, path string) string {
	for _, p := range exemptPaths {
		if strings.HasPrefix(path, p) {
			return scopeExempt
		}
	}
	if s, ok := endpointScopes[method+" "+path]; ok {
		return s
	}
	if name, ok := collectionFromPath(path); ok {
		pair, known := collectionScopes[name]
		if !known {
			return ""
		}
		if writeMethods[method] {
			return pair[1] // "" for read-only collections => deny writes
		}
		return pair[0]
	}
	return ""
}

// collectionFromPath extracts "mail_messages" from
// /api/collections/mail_messages/records[/id].
func collectionFromPath(path string) (string, bool) {
	const prefix = "/api/collections/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	slash := strings.IndexByte(rest, '/')
	if slash <= 0 {
		return "", false
	}
	return rest[:slash], true
}

// grantIDFromToken reads the grant claim without verifying the signature. That
// is safe here because it is only used to LOCATE the grant; the signature is
// verified by PocketBase's own resolver, and the grant row is then re-checked.
func grantIDFromToken(token string) string {
	claims, err := security.ParseUnverifiedJWT(token)
	if err != nil {
		return ""
	}
	v, _ := claims[grantClaim].(string)
	return v
}

// IsOAuthToken reports whether a token carries a grant claim.
func IsOAuthToken(token string) bool {
	return grantIDFromToken(token) != ""
}

// MintAccessToken issues a PocketBase static auth token carrying the grant
// claim. Static (non-refreshable) is correct: renewal goes through the OAuth
// refresh grant, not PB's authRefresh, so revoking the grant is the only way
// to get a new access token.
func MintAccessToken(
	app core.App,
	user *core.Record,
	grant *core.Record,
	ttl time.Duration,
) (string, error) {
	base, err := user.NewStaticAuthToken(ttl)
	if err != nil {
		return "", fmt.Errorf("oauth: mint static token: %w", err)
	}
	// Re-sign with the grant claim added. We must use the same key PocketBase
	// verifies with, or FindAuthRecordByToken would reject it.
	claims, err := security.ParseUnverifiedJWT(base)
	if err != nil {
		return "", fmt.Errorf("oauth: parse minted token: %w", err)
	}
	claims[grantClaim] = grant.GetString("jti")

	key := user.TokenKey() + user.Collection().AuthToken.Secret
	signed, err := security.NewJWT(claims, key, ttl)
	if err != nil {
		return "", fmt.Errorf("oauth: sign access token: %w", err)
	}
	return signed, nil
}

// bindGrantEnforcement installs the middleware that turns a valid signature
// into an authorized request. It runs ahead of PocketBase's loadAuthToken so
// that, for OAuth tokens, we populate e.Auth ourselves after checking the
// grant; PB's middleware then sees e.Auth != nil and no-ops.
func bindGrantEnforcement(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id:       "tinycldOAuthGrant",
			Priority: middlewarePriority,
			Func: func(re *core.RequestEvent) error {
				token := bearerToken(re.Request)
				if token == "" || !IsOAuthToken(token) {
					// Not an OAuth request — leave it entirely alone.
					return re.Next()
				}

				record, err := re.App.FindAuthRecordByToken(token, core.TokenTypeAuth)
				if err != nil || record == nil {
					return re.UnauthorizedError("Invalid access token", nil)
				}

				grant, err := VerifyGrant(re.App, grantIDFromToken(token))
				if err != nil {
					return re.UnauthorizedError("Access token is no longer valid", nil)
				}
				if grant.GetString("user") != record.Id {
					// The grant belongs to a different user than the token
					// claims. Should be impossible; refuse loudly.
					return re.UnauthorizedError("Access token is no longer valid", nil)
				}

				required := ScopeForRoute(re.Request.Method, re.Request.URL.Path)
				if required == "" {
					return re.ForbiddenError(
						"This endpoint is not available to API tokens", nil)
				}
				if required != scopeExempt {
					if !HasScope(ParseScopes(grant.GetString("scopes")), required) {
						return re.ForbiddenError(
							fmt.Sprintf("Requires the %q scope", required), nil)
					}
				}

				if err := TouchGrant(re.App, grant); err != nil {
					// Non-fatal: last_used_at is cosmetic.
					re.App.Logger().Warn("oauth: touch grant", "error", err)
				}

				re.Auth = record
				return re.Next()
			},
		})
		return e.Next()
	})
}

// bearerToken reads the Authorization header, tolerating a missing "Bearer "
// prefix the way PocketBase does.
func bearerToken(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if len(v) > 7 && strings.EqualFold(v[:7], "Bearer ") {
		return v[7:]
	}
	return v
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/server/oauth/middleware.go tinycld/core/server/oauth/middleware_test.go
git commit -m "feat(oauth): grant-enforcement middleware with default-deny scopes"
```

---

## Task 6: Device authorization endpoint (RFC 8628)

**Files:**
- Create: `tinycld/core/server/oauth/clients.go`
- Create: `tinycld/core/server/oauth/device.go`
- Test: `tinycld/core/server/oauth/device_test.go`

**Interfaces:**
- Consumes: `NewGrant`, `newUserCode`, `randomToken`, `DeviceCodeTTL`, `AllScopes`
- Produces: `FindClientByClientID(app, clientID string) (*core.Record, error)`; `VerifyClientSecret(client *core.Record, secret string) bool`; `ValidateScopes(requested []string) error`; `DeviceResponse` struct; `handleDeviceAuthorization(app, re) error`

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/device_test.go`:

```go
package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestValidateScopesRejectsUnknown(t *testing.T) {
	if err := ValidateScopes([]string{ScopeMailRead}); err != nil {
		t.Fatalf("ValidateScopes on a known scope: %v", err)
	}
	if err := ValidateScopes([]string{"mail:read", "not-a-real-scope"}); err == nil {
		t.Fatal("ValidateScopes must reject an unknown scope")
	}
	// An empty request is fine — it defaults to `profile` at issue time.
	if err := ValidateScopes(nil); err != nil {
		t.Fatalf("ValidateScopes on empty: %v", err)
	}
}

func TestFindClientByClientID(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	c, err := FindClientByClientID(app, "tinycld-cli")
	if err != nil {
		t.Fatalf("FindClientByClientID: %v", err)
	}
	if c.GetString("name") != "TinyCld CLI" {
		t.Fatalf("wrong client resolved: %s", c.GetString("name"))
	}

	if _, err := FindClientByClientID(app, "unregistered-app"); err == nil {
		t.Fatal("an unregistered client_id must not resolve")
	}
}

func TestDeviceAuthorizationIssuesCodes(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	form := url.Values{}
	form.Set("client_id", "tinycld-cli")
	form.Set("scope", "mail:read drive:read")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/device",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	if err := serveDeviceForTest(app, rec, req); err != nil {
		t.Fatalf("device authorization: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body: %s", rec.Code, rec.Body.String())
	}

	var resp DeviceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.DeviceCode == "" {
		t.Error("device_code must be present")
	}
	if resp.UserCode == "" {
		t.Error("user_code must be present")
	}
	if resp.VerificationURI == "" {
		t.Error("verification_uri must be present")
	}
	if resp.Interval <= 0 {
		t.Error("interval must be a positive number of seconds")
	}
	if resp.ExpiresIn <= 0 {
		t.Error("expires_in must be positive")
	}
	// The device code must never equal the user code: one is secret, the
	// other is read aloud.
	if resp.DeviceCode == resp.UserCode {
		t.Error("device_code and user_code must differ")
	}
}

func TestDeviceAuthorizationRejectsUnknownClient(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	form := url.Values{}
	form.Set("client_id", "not-registered")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/device",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	_ = serveDeviceForTest(app, rec, req)
	if rec.Code == http.StatusOK {
		t.Fatal("an unregistered client must not receive device codes")
	}
}

func TestDeviceAuthorizationRejectsUnknownScope(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	form := url.Values{}
	form.Set("client_id", "tinycld-cli")
	form.Set("scope", "mail:read wat:everything")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/device",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	_ = serveDeviceForTest(app, rec, req)
	if rec.Code == http.StatusOK {
		t.Fatal("an unknown scope must be rejected, not silently dropped")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestValidateScopes|TestFindClient|TestDeviceAuthorization' -v`
Expected: FAIL — `undefined: ValidateScopes`, `undefined: DeviceResponse`, `undefined: serveDeviceForTest`.

- [ ] **Step 3: Write the client helpers**

Create `tinycld/core/server/oauth/clients.go`:

```go
package oauth

import (
	"crypto/subtle"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// FindClientByClientID resolves a registered client. An unknown client_id is
// an error: this is the registry that decides who may ask for access at all.
func FindClientByClientID(app core.App, clientID string) (*core.Record, error) {
	if clientID == "" {
		return nil, fmt.Errorf("oauth: empty client_id")
	}
	rec, err := app.FindFirstRecordByFilter(
		clientsCollection, "client_id = {:id}", map[string]any{"id": clientID},
	)
	if err != nil || rec == nil {
		return nil, fmt.Errorf("oauth: unknown client %q", clientID)
	}
	return rec, nil
}

// VerifyClientSecret checks a confidential client's secret. A public client
// (the CLI) has no secret — PKCE protects it — so this always reports true
// for one, and callers must not require a secret from a public client.
func VerifyClientSecret(client *core.Record, secret string) bool {
	if client.GetString("type") == "public" {
		return true
	}
	stored := client.GetString("client_secret_hash")
	if stored == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashSecret(secret)), []byte(stored)) == 1
}

// ValidateScopes rejects any scope outside the catalog. Silently dropping an
// unknown scope would let a client believe it holds access it does not.
func ValidateScopes(requested []string) error {
	for _, s := range requested {
		if !HasScope(AllScopes, s) {
			return fmt.Errorf("oauth: unknown scope %q", s)
		}
	}
	return nil
}

// RedirectURIAllowed reports whether uri exactly matches one of the client's
// registered redirect URIs. Exact match only — prefix matching is a well-known
// open-redirect vector.
func RedirectURIAllowed(client *core.Record, uri string) bool {
	if uri == "" {
		return false
	}
	var registered []string
	if err := client.UnmarshalJSONField("redirect_uris", &registered); err != nil {
		return false
	}
	for _, r := range registered {
		if r == uri {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Write the device endpoint**

Create `tinycld/core/server/oauth/device.go`:

```go
package oauth

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// pollInterval is the seconds a client should wait between token polls
// (RFC 8628 §3.2). Five is the spec's own suggested floor.
const pollInterval = 5

// DeviceResponse is the RFC 8628 §3.2 device authorization response.
type DeviceResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	// VerificationURIComplete embeds the code so the CLI can open a browser
	// straight to an approved-looking screen (RFC 8628 §3.3.1).
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// handleDeviceAuthorization implements POST /oauth/device.
//
// It creates a PENDING grant with no user attached yet — the user is bound
// when they approve in the browser. The device_code is the secret the CLI
// polls with; the user_code is the short string they read off the terminal.
func handleDeviceAuthorization(app core.App, re *core.RequestEvent) error {
	if err := re.Request.ParseForm(); err != nil {
		return re.BadRequestError("Malformed form body", err)
	}
	clientID := re.Request.FormValue("client_id")
	client, err := FindClientByClientID(app, clientID)
	if err != nil {
		return re.BadRequestError("Unknown client_id", err)
	}

	scopes := ParseScopes(re.Request.FormValue("scope"))
	if err := ValidateScopes(scopes); err != nil {
		return re.BadRequestError(err.Error(), err)
	}
	if len(scopes) == 0 {
		scopes = []string{ScopeProfile}
	}

	deviceCode, err := randomToken(32)
	if err != nil {
		return re.InternalServerError("Failed to generate device code", err)
	}
	userCode, err := newUserCode()
	if err != nil {
		return re.InternalServerError("Failed to generate user code", err)
	}

	col, err := app.FindCollectionByNameOrId(grantsCollection)
	if err != nil {
		return re.InternalServerError("Failed to load grants", err)
	}
	jti, err := randomToken(24)
	if err != nil {
		return re.InternalServerError("Failed to generate grant id", err)
	}

	// user is intentionally unset until approval. The relation is required, so
	// the pending row carries an empty string until handleApprove fills it —
	// PocketBase permits that for a relation with no value.
	grant := core.NewRecord(col)
	grant.Set("client", client.Id)
	grant.Set("jti", jti)
	grant.Set("scopes", strings.Join(scopes, " "))
	grant.Set("status", "pending")
	grant.Set("device_code", hashSecret(deviceCode))
	grant.Set("user_code", userCode)
	grant.Set("expires_at", time.Now().Add(DeviceCodeTTL))
	if err := app.Save(grant); err != nil {
		return re.InternalServerError("Failed to create device grant", err)
	}

	base := strings.TrimSuffix(app.Settings().Meta.AppURL, "/")
	verifyURL := base + "/p/oauth/authorize"

	return re.JSON(http.StatusOK, DeviceResponse{
		DeviceCode:              deviceCode,
		UserCode:                userCode,
		VerificationURI:         verifyURL,
		VerificationURIComplete: verifyURL + "?user_code=" + userCode,
		ExpiresIn:               int(DeviceCodeTTL.Seconds()),
		Interval:                pollInterval,
	})
}
```

- [ ] **Step 5: Add the test harness helper**

Append to `tinycld/core/server/oauth/device_test.go`:

```go
// serveDeviceForTest drives handleDeviceAuthorization against a recorder
// without standing up the whole router.
func serveDeviceForTest(app core.App, rec *httptest.ResponseRecorder, req *http.Request) error {
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	return handleDeviceAuthorization(app, re)
}
```

Add `"github.com/pocketbase/pocketbase/core"` to that file's imports.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tinycld/core/server/oauth/clients.go tinycld/core/server/oauth/device.go tinycld/core/server/oauth/device_test.go
git commit -m "feat(oauth): device authorization endpoint (RFC 8628)"
```

---

## Task 7: Token endpoint — device, authorization_code, and refresh grants

**Files:**
- Create: `tinycld/core/server/oauth/token.go`
- Test: `tinycld/core/server/oauth/token_test.go`

**Interfaces:**
- Consumes: `FindClientByClientID`, `VerifyClientSecret`, `VerifyPKCE`, `MintAccessToken`, `hashSecret`, `randomToken`, TTL constants
- Produces: `TokenResponse` struct; `TokenErrorResponse` struct; `handleToken(app, re) error`

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/token_test.go`:

```go
package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func postToken(t *testing.T, app core.App, form url.Values) (*httptest.ResponseRecorder, TokenResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/token",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	_ = handleToken(app, re)

	var resp TokenResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	return rec, resp
}

// approvedDeviceGrant runs the device flow up to the point of user approval.
func approvedDeviceGrant(t *testing.T, app core.App) (deviceCode string, userID string) {
	t.Helper()
	uid, clientRecID := seedUserAndClient(t, app)

	code, err := randomToken(32)
	if err != nil {
		t.Fatalf("randomToken: %v", err)
	}
	col, err := app.FindCollectionByNameOrId(grantsCollection)
	if err != nil {
		t.Fatalf("find grants: %v", err)
	}
	jti, _ := randomToken(24)
	g := core.NewRecord(col)
	g.Set("user", uid)
	g.Set("client", clientRecID)
	g.Set("jti", jti)
	g.Set("scopes", ScopeMailRead)
	g.Set("status", "active") // approved
	g.Set("device_code", hashSecret(code))
	g.Set("expires_at", time.Now().Add(DeviceCodeTTL))
	if err := app.Save(g); err != nil {
		t.Fatalf("save grant: %v", err)
	}
	return code, uid
}

func TestTokenDeviceGrantReturnsAccessToken(t *testing.T) {
	app := newSchemaApp(t)
	deviceCode, _ := approvedDeviceGrant(t, app)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", deviceCode)
	form.Set("client_id", "tinycld-cli")

	rec, resp := postToken(t, app, form)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if resp.AccessToken == "" {
		t.Error("access_token must be present")
	}
	if resp.RefreshToken == "" {
		t.Error("refresh_token must be present")
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("token_type = %q, want Bearer", resp.TokenType)
	}
	if resp.ExpiresIn <= 0 {
		t.Error("expires_in must be positive")
	}
	// The issued token must actually work.
	if _, err := app.FindAuthRecordByToken(resp.AccessToken, core.TokenTypeAuth); err != nil {
		t.Fatalf("issued access token does not resolve: %v", err)
	}
}

func TestTokenDeviceGrantPendingReturnsAuthorizationPending(t *testing.T) {
	app := newSchemaApp(t)
	uid, clientRecID := seedUserAndClient(t, app)

	code, _ := randomToken(32)
	col, _ := app.FindCollectionByNameOrId(grantsCollection)
	jti, _ := randomToken(24)
	g := core.NewRecord(col)
	g.Set("user", uid)
	g.Set("client", clientRecID)
	g.Set("jti", jti)
	g.Set("scopes", ScopeMailRead)
	g.Set("status", "pending") // NOT yet approved
	g.Set("device_code", hashSecret(code))
	g.Set("expires_at", time.Now().Add(DeviceCodeTTL))
	if err := app.Save(g); err != nil {
		t.Fatalf("save grant: %v", err)
	}

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", code)
	form.Set("client_id", "tinycld-cli")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/token",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	_ = handleToken(app, re)

	var errResp TokenErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("decode: %v — body %s", err, rec.Body.String())
	}
	// RFC 8628 §3.5: keep polling, this is not a failure.
	if errResp.Error != "authorization_pending" {
		t.Fatalf("error = %q, want authorization_pending", errResp.Error)
	}
}

func TestTokenDeviceGrantRejectsUnknownDeviceCode(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", "totally-made-up")
	form.Set("client_id", "tinycld-cli")

	rec, _ := postToken(t, app, form)
	if rec.Code == http.StatusOK {
		t.Fatal("an unknown device_code must not yield a token")
	}
}

func TestTokenDeviceCodeIsSingleUse(t *testing.T) {
	app := newSchemaApp(t)
	deviceCode, _ := approvedDeviceGrant(t, app)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", deviceCode)
	form.Set("client_id", "tinycld-cli")

	if rec, _ := postToken(t, app, form); rec.Code != http.StatusOK {
		t.Fatalf("first exchange failed: %s", rec.Body.String())
	}
	// Replay must fail: the code is consumed on first use.
	rec, _ := postToken(t, app, form)
	if rec.Code == http.StatusOK {
		t.Fatal("a device_code must not be redeemable twice")
	}
}

func TestTokenRefreshRotatesTheRefreshToken(t *testing.T) {
	app := newSchemaApp(t)
	deviceCode, _ := approvedDeviceGrant(t, app)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", deviceCode)
	form.Set("client_id", "tinycld-cli")
	_, first := postToken(t, app, form)

	refreshForm := url.Values{}
	refreshForm.Set("grant_type", "refresh_token")
	refreshForm.Set("refresh_token", first.RefreshToken)
	refreshForm.Set("client_id", "tinycld-cli")

	rec, second := postToken(t, app, refreshForm)
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh failed: %s", rec.Body.String())
	}
	if second.AccessToken == "" {
		t.Fatal("refresh must return a new access token")
	}
	// Rotation: the old refresh token must stop working.
	if second.RefreshToken == first.RefreshToken {
		t.Fatal("refresh token must rotate on use")
	}
	replay, _ := postToken(t, app, refreshForm)
	if replay.Code == http.StatusOK {
		t.Fatal("a used refresh token must not be redeemable again")
	}
}

func TestTokenRefreshFailsAfterRevocation(t *testing.T) {
	app := newSchemaApp(t)
	deviceCode, _ := approvedDeviceGrant(t, app)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", deviceCode)
	form.Set("client_id", "tinycld-cli")
	_, issued := postToken(t, app, form)

	grant, err := FindGrantByJTI(app, grantIDFromToken(issued.AccessToken))
	if err != nil {
		t.Fatalf("FindGrantByJTI: %v", err)
	}
	if err := RevokeGrant(app, grant.Id); err != nil {
		t.Fatalf("RevokeGrant: %v", err)
	}

	refreshForm := url.Values{}
	refreshForm.Set("grant_type", "refresh_token")
	refreshForm.Set("refresh_token", issued.RefreshToken)
	refreshForm.Set("client_id", "tinycld-cli")

	rec, _ := postToken(t, app, refreshForm)
	if rec.Code == http.StatusOK {
		t.Fatal("a revoked grant must not be refreshable")
	}
}

func TestTokenRejectsUnsupportedGrantType(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	form := url.Values{}
	form.Set("grant_type", "password") // removed in OAuth 2.1
	form.Set("client_id", "tinycld-cli")

	rec, _ := postToken(t, app, form)
	if rec.Code == http.StatusOK {
		t.Fatal("the password grant is not supported and must be refused")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run TestToken -v`
Expected: FAIL — `undefined: handleToken`, `undefined: TokenResponse`.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/oauth/token.go`:

```go
package oauth

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Grant type identifiers. OAuth 2.1 removes `password` and `implicit`; we
// implement only these three.
const (
	grantTypeDevice   = "urn:ietf:params:oauth:grant-type:device_code"
	grantTypeAuthCode = "authorization_code"
	grantTypeRefresh  = "refresh_token"
)

// TokenResponse is the RFC 6749 §5.1 successful token response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// TokenErrorResponse is the RFC 6749 §5.2 error response. The device flow
// leans on it heavily: `authorization_pending` and `slow_down` are normal
// polling states, not failures.
type TokenErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}

// handleToken implements POST /oauth/token for all three supported grants.
func handleToken(app core.App, re *core.RequestEvent) error {
	if err := re.Request.ParseForm(); err != nil {
		return tokenError(re, http.StatusBadRequest, "invalid_request", "Malformed form body")
	}
	switch re.Request.FormValue("grant_type") {
	case grantTypeDevice:
		return handleDeviceTokenGrant(app, re)
	case grantTypeAuthCode:
		return handleAuthCodeGrant(app, re)
	case grantTypeRefresh:
		return handleRefreshGrant(app, re)
	default:
		return tokenError(re, http.StatusBadRequest, "unsupported_grant_type",
			"Supported grants: device_code, authorization_code, refresh_token")
	}
}

// tokenError writes an RFC 6749 §5.2 error body.
func tokenError(re *core.RequestEvent, status int, code, desc string) error {
	return re.JSON(status, TokenErrorResponse{Error: code, ErrorDescription: desc})
}

// authenticateClient resolves and (for confidential clients) authenticates the
// caller. A public client needs no secret; PKCE is what binds the exchange.
func authenticateClient(app core.App, re *core.RequestEvent) (*core.Record, error) {
	clientID := re.Request.FormValue("client_id")
	client, err := FindClientByClientID(app, clientID)
	if err != nil {
		return nil, err
	}
	if client.GetString("type") == "confidential" {
		if !VerifyClientSecret(client, re.Request.FormValue("client_secret")) {
			return nil, ErrInvalidGrant
		}
	}
	return client, nil
}

// issueTokens mints an access token plus a rotated refresh token and persists
// the refresh hash on the grant.
func issueTokens(
	app core.App,
	grant *core.Record,
	user *core.Record,
) (TokenResponse, error) {
	access, err := MintAccessToken(app, user, grant, AccessTokenTTL)
	if err != nil {
		return TokenResponse{}, err
	}
	refresh, err := randomToken(32)
	if err != nil {
		return TokenResponse{}, err
	}

	grant.Set("refresh_token_hash", hashSecret(refresh))
	grant.Set("status", "active")
	grant.Set("expires_at", time.Now().Add(RefreshTokenTTL))
	// Consume the one-shot codes so neither can be replayed.
	grant.Set("device_code", "")
	grant.Set("auth_code_hash", "")
	grant.Set("user_code", "")
	if err := app.Save(grant); err != nil {
		return TokenResponse{}, err
	}

	return TokenResponse{
		AccessToken:  access,
		TokenType:    "Bearer",
		ExpiresIn:    int(AccessTokenTTL.Seconds()),
		RefreshToken: refresh,
		Scope:        grant.GetString("scopes"),
	}, nil
}

// handleDeviceTokenGrant is the CLI's poll (RFC 8628 §3.4).
func handleDeviceTokenGrant(app core.App, re *core.RequestEvent) error {
	if _, err := authenticateClient(app, re); err != nil {
		return tokenError(re, http.StatusUnauthorized, "invalid_client", "Unknown client")
	}
	deviceCode := re.Request.FormValue("device_code")
	if deviceCode == "" {
		return tokenError(re, http.StatusBadRequest, "invalid_request", "device_code is required")
	}

	grant, err := app.FindFirstRecordByFilter(
		grantsCollection, "device_code = {:c}",
		map[string]any{"c": hashSecret(deviceCode)},
	)
	if err != nil || grant == nil {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Unknown device code")
	}
	if exp := grant.GetDateTime("expires_at"); !exp.IsZero() && exp.Time().Before(time.Now()) {
		return tokenError(re, http.StatusBadRequest, "expired_token", "Device code expired")
	}
	switch grant.GetString("status") {
	case "pending":
		// Not an error — the user simply has not approved yet.
		return tokenError(re, http.StatusBadRequest, "authorization_pending",
			"Waiting for the user to approve this device")
	case "revoked":
		return tokenError(re, http.StatusBadRequest, "access_denied", "Request was denied")
	}

	user, err := app.FindRecordById("users", grant.GetString("user"))
	if err != nil {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Grant has no user")
	}
	resp, err := issueTokens(app, grant, user)
	if err != nil {
		return re.InternalServerError("Failed to issue tokens", err)
	}
	return re.JSON(http.StatusOK, resp)
}

// handleAuthCodeGrant is the Zapier path: authorization code + PKCE.
func handleAuthCodeGrant(app core.App, re *core.RequestEvent) error {
	client, err := authenticateClient(app, re)
	if err != nil {
		return tokenError(re, http.StatusUnauthorized, "invalid_client", "Unknown client")
	}
	code := re.Request.FormValue("code")
	verifier := re.Request.FormValue("code_verifier")
	redirectURI := re.Request.FormValue("redirect_uri")
	if code == "" || verifier == "" {
		return tokenError(re, http.StatusBadRequest, "invalid_request",
			"code and code_verifier are required")
	}

	grant, err := app.FindFirstRecordByFilter(
		grantsCollection, "auth_code_hash = {:c}",
		map[string]any{"c": hashSecret(code)},
	)
	if err != nil || grant == nil {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Unknown authorization code")
	}
	if exp := grant.GetDateTime("expires_at"); !exp.IsZero() && exp.Time().Before(time.Now()) {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Authorization code expired")
	}
	if grant.GetString("client") != client.Id {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Code was issued to another client")
	}
	// The redirect_uri must match the one the code was issued against.
	if grant.GetString("redirect_uri") != redirectURI {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "redirect_uri mismatch")
	}
	if !VerifyPKCE(grant.GetString("code_challenge"), verifier) {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "PKCE verification failed")
	}

	user, err := app.FindRecordById("users", grant.GetString("user"))
	if err != nil {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Grant has no user")
	}
	resp, err := issueTokens(app, grant, user)
	if err != nil {
		return re.InternalServerError("Failed to issue tokens", err)
	}
	return re.JSON(http.StatusOK, resp)
}

// handleRefreshGrant exchanges a refresh token for a new pair, rotating the
// refresh token so a leaked one has a bounded useful life.
func handleRefreshGrant(app core.App, re *core.RequestEvent) error {
	if _, err := authenticateClient(app, re); err != nil {
		return tokenError(re, http.StatusUnauthorized, "invalid_client", "Unknown client")
	}
	refresh := re.Request.FormValue("refresh_token")
	if refresh == "" {
		return tokenError(re, http.StatusBadRequest, "invalid_request", "refresh_token is required")
	}

	grant, err := app.FindFirstRecordByFilter(
		grantsCollection, "refresh_token_hash = {:h}",
		map[string]any{"h": hashSecret(refresh)},
	)
	if err != nil || grant == nil {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Unknown refresh token")
	}
	if grant.GetString("status") == "revoked" {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Grant was revoked")
	}

	user, err := app.FindRecordById("users", grant.GetString("user"))
	if err != nil {
		return tokenError(re, http.StatusBadRequest, "invalid_grant", "Grant has no user")
	}
	resp, err := issueTokens(app, grant, user)
	if err != nil {
		return re.InternalServerError("Failed to issue tokens", err)
	}
	return re.JSON(http.StatusOK, resp)
}

// scopeString normalizes a scope slice for storage.
func scopeString(scopes []string) string {
	return strings.Join(scopes, " ")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/server/oauth/token.go tinycld/core/server/oauth/token_test.go
git commit -m "feat(oauth): token endpoint with device, auth-code, and refresh grants"
```

---

## Task 8: Authorize, revoke, and metadata endpoints

**Files:**
- Create: `tinycld/core/server/oauth/authorize.go`
- Create: `tinycld/core/server/oauth/revoke.go`
- Create: `tinycld/core/server/oauth/metadata.go`
- Test: `tinycld/core/server/oauth/authorize_test.go`

**Interfaces:**
- Consumes: everything from Tasks 1–7
- Produces: `handleApproveDevice(app, re) error`; `handleAuthorize(app, re) error`; `handleRevoke(app, re) error`; `handleMetadata(app, re) error`; `AuthorizeInfoResponse`; `MetadataResponse`

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/authorize_test.go`:

```go
package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func pendingDeviceGrant(t *testing.T, app core.App) (userCode string, userID string) {
	t.Helper()
	uid, clientRecID := seedUserAndClient(t, app)

	code, err := newUserCode()
	if err != nil {
		t.Fatalf("newUserCode: %v", err)
	}
	col, _ := app.FindCollectionByNameOrId(grantsCollection)
	jti, _ := randomToken(24)
	g := core.NewRecord(col)
	g.Set("client", clientRecID)
	g.Set("jti", jti)
	g.Set("scopes", ScopeMailRead)
	g.Set("status", "pending")
	g.Set("user_code", code)
	dc, _ := randomToken(32)
	g.Set("device_code", hashSecret(dc))
	g.Set("expires_at", time.Now().Add(DeviceCodeTTL))
	if err := app.Save(g); err != nil {
		t.Fatalf("save pending grant: %v", err)
	}
	return code, uid
}

func TestApproveDeviceBindsUserAndActivates(t *testing.T) {
	app := newSchemaApp(t)
	userCode, userID := pendingDeviceGrant(t, app)

	form := url.Values{}
	form.Set("user_code", userCode)
	form.Set("device_label", "Nathan's laptop")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/authorize",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	user, err := app.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	re.Auth = user // the consent screen runs inside an authenticated session

	if err := handleApproveDevice(app, re); err != nil {
		t.Fatalf("handleApproveDevice: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}

	grant, err := FindGrantByUserCode(app, userCode)
	if err == nil && grant != nil && grant.GetString("user_code") != "" {
		// user_code should still be present until the token exchange consumes it
		if grant.GetString("status") != "active" {
			t.Fatalf("status = %q, want active", grant.GetString("status"))
		}
		if grant.GetString("user") != userID {
			t.Fatalf("grant user = %q, want %q", grant.GetString("user"), userID)
		}
		if grant.GetString("device_label") != "Nathan's laptop" {
			t.Errorf("device_label not stored")
		}
	} else {
		t.Fatalf("grant not found after approval: %v", err)
	}
}

func TestApproveDeviceRequiresAuthentication(t *testing.T) {
	app := newSchemaApp(t)
	userCode, _ := pendingDeviceGrant(t, app)

	form := url.Values{}
	form.Set("user_code", userCode)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/authorize",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	re.Auth = nil // anonymous

	_ = handleApproveDevice(app, re)
	if rec.Code == http.StatusOK {
		t.Fatal("an anonymous caller must not be able to approve a device")
	}
}

func TestApproveDeviceRejectsUnknownUserCode(t *testing.T) {
	app := newSchemaApp(t)
	userID, _ := seedUserAndClient(t, app)
	user, _ := app.FindRecordById("users", userID)

	form := url.Values{}
	form.Set("user_code", "ZZZZ-ZZZZ")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/authorize",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	re.Auth = user

	_ = handleApproveDevice(app, re)
	if rec.Code == http.StatusOK {
		t.Fatal("an unknown user_code must not approve anything")
	}
}

func TestRevokeMarksGrantRevoked(t *testing.T) {
	app := newSchemaApp(t)
	deviceCode, _ := approvedDeviceGrant(t, app)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", deviceCode)
	form.Set("client_id", "tinycld-cli")
	_, issued := postToken(t, app, form)

	revokeForm := url.Values{}
	revokeForm.Set("token", issued.RefreshToken)
	revokeForm.Set("client_id", "tinycld-cli")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/revoke",
		strings.NewReader(revokeForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec

	if err := handleRevoke(app, re); err != nil {
		t.Fatalf("handleRevoke: %v", err)
	}
	// RFC 7009 §2.2: always 200, even for an unknown token.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	if _, err := VerifyGrant(app, grantIDFromToken(issued.AccessToken)); err == nil {
		t.Fatal("the grant must not verify after revocation")
	}
}

func TestRevokeUnknownTokenStillReturns200(t *testing.T) {
	app := newSchemaApp(t)
	seedUserAndClient(t, app)

	form := url.Values{}
	form.Set("token", "never-issued")
	form.Set("client_id", "tinycld-cli")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/oauth/revoke",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec

	_ = handleRevoke(app, re)
	// Per RFC 7009 an unknown token is not an error — answering otherwise
	// turns the endpoint into a token oracle.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for an unknown token", rec.Code)
	}
}

func TestMetadataAdvertisesSupportedGrants(t *testing.T) {
	app := newSchemaApp(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/.well-known/oauth-authorization-server", nil)
	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec

	if err := handleMetadata(app, re); err != nil {
		t.Fatalf("handleMetadata: %v", err)
	}

	var md MetadataResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &md); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if md.TokenEndpoint == "" || md.DeviceAuthorizationEndpoint == "" {
		t.Fatal("metadata must advertise the token and device endpoints")
	}
	if len(md.CodeChallengeMethodsSupported) != 1 ||
		md.CodeChallengeMethodsSupported[0] != MethodS256 {
		t.Fatalf("must advertise S256 only, got %v", md.CodeChallengeMethodsSupported)
	}
	for _, want := range []string{grantTypeDevice, grantTypeAuthCode, grantTypeRefresh} {
		var found bool
		for _, g := range md.GrantTypesSupported {
			if g == want {
				found = true
			}
		}
		if !found {
			t.Errorf("metadata omits grant type %q", want)
		}
	}
	if len(md.ScopesSupported) == 0 {
		t.Error("metadata must advertise the scope catalog")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestApprove|TestRevoke|TestMetadata' -v`
Expected: FAIL — `undefined: handleApproveDevice`, `undefined: handleRevoke`, `undefined: handleMetadata`.

- [ ] **Step 3: Write authorize.go**

Create `tinycld/core/server/oauth/authorize.go`:

```go
package oauth

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// AuthorizeInfoResponse describes a pending device request so the consent
// screen can name the client and list the scopes before the user approves.
type AuthorizeInfoResponse struct {
	ClientName string   `json:"client_name"`
	Scopes     []string `json:"scopes"`
	ExpiresAt  string   `json:"expires_at"`
}

// handleAuthorizeInfo implements GET /oauth/authorize?user_code=…
// It is what the consent screen calls to render "TinyCld CLI wants access to…".
func handleAuthorizeInfo(app core.App, re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Sign in to approve this request", nil)
	}
	userCode := strings.ToUpper(strings.TrimSpace(re.Request.URL.Query().Get("user_code")))
	grant, err := FindGrantByUserCode(app, userCode)
	if err != nil {
		return re.NotFoundError("That code is not valid", err)
	}
	if grant.GetString("status") != "pending" {
		return re.BadRequestError("That code has already been used", nil)
	}
	if exp := grant.GetDateTime("expires_at"); !exp.IsZero() && exp.Time().Before(time.Now()) {
		return re.BadRequestError("That code has expired", nil)
	}

	client, err := app.FindRecordById(clientsCollection, grant.GetString("client"))
	if err != nil {
		return re.InternalServerError("Failed to load client", err)
	}
	return re.JSON(http.StatusOK, AuthorizeInfoResponse{
		ClientName: client.GetString("name"),
		Scopes:     ParseScopes(grant.GetString("scopes")),
		ExpiresAt:  grant.GetDateTime("expires_at").String(),
	})
}

// handleApproveDevice implements POST /oauth/authorize for the device flow:
// the signed-in user binds themselves to a pending grant and activates it.
func handleApproveDevice(app core.App, re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Sign in to approve this request", nil)
	}
	if err := re.Request.ParseForm(); err != nil {
		return re.BadRequestError("Malformed form body", err)
	}
	userCode := strings.ToUpper(strings.TrimSpace(re.Request.FormValue("user_code")))
	grant, err := FindGrantByUserCode(app, userCode)
	if err != nil {
		return re.NotFoundError("That code is not valid", err)
	}
	if grant.GetString("status") != "pending" {
		return re.BadRequestError("That code has already been used", nil)
	}
	if exp := grant.GetDateTime("expires_at"); !exp.IsZero() && exp.Time().Before(time.Now()) {
		return re.BadRequestError("That code has expired", nil)
	}

	label := strings.TrimSpace(re.Request.FormValue("device_label"))
	if label == "" {
		label = "Unnamed device"
	}

	grant.Set("user", re.Auth.Id)
	grant.Set("status", "active")
	grant.Set("device_label", label)
	if err := app.Save(grant); err != nil {
		return re.InternalServerError("Failed to approve device", err)
	}
	return re.JSON(http.StatusOK, map[string]string{"status": "approved"})
}

// handleDenyDevice lets a user reject a device request outright.
func handleDenyDevice(app core.App, re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Sign in to manage this request", nil)
	}
	if err := re.Request.ParseForm(); err != nil {
		return re.BadRequestError("Malformed form body", err)
	}
	userCode := strings.ToUpper(strings.TrimSpace(re.Request.FormValue("user_code")))
	grant, err := FindGrantByUserCode(app, userCode)
	if err != nil {
		return re.NotFoundError("That code is not valid", err)
	}
	grant.Set("status", "revoked")
	if err := app.Save(grant); err != nil {
		return re.InternalServerError("Failed to deny request", err)
	}
	return re.JSON(http.StatusOK, map[string]string{"status": "denied"})
}

// handleAuthorize implements the Authorization Code + PKCE path used by
// third-party integrations. It issues a one-shot code bound to the client's
// PKCE challenge and redirect URI.
func handleAuthorize(app core.App, re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Sign in to approve this request", nil)
	}
	if err := re.Request.ParseForm(); err != nil {
		return re.BadRequestError("Malformed form body", err)
	}
	q := re.Request.Form

	client, err := FindClientByClientID(app, q.Get("client_id"))
	if err != nil {
		return re.BadRequestError("Unknown client_id", err)
	}
	redirectURI := q.Get("redirect_uri")
	if !RedirectURIAllowed(client, redirectURI) {
		// Never redirect to an unregistered URI — that is an open redirect.
		return re.BadRequestError("redirect_uri is not registered for this client", nil)
	}
	challenge := q.Get("code_challenge")
	if challenge == "" || q.Get("code_challenge_method") != MethodS256 {
		return re.BadRequestError("code_challenge with method S256 is required", nil)
	}
	scopes := ParseScopes(q.Get("scope"))
	if err := ValidateScopes(scopes); err != nil {
		return re.BadRequestError(err.Error(), err)
	}
	if len(scopes) == 0 {
		scopes = []string{ScopeProfile}
	}

	code, err := randomToken(32)
	if err != nil {
		return re.InternalServerError("Failed to generate code", err)
	}
	grant, err := NewGrant(app, re.Auth.Id, client.Id, scopes, "pending")
	if err != nil {
		return re.InternalServerError("Failed to create grant", err)
	}
	grant.Set("auth_code_hash", hashSecret(code))
	grant.Set("code_challenge", challenge)
	grant.Set("redirect_uri", redirectURI)
	grant.Set("expires_at", time.Now().Add(AuthCodeTTL))
	grant.Set("device_label", client.GetString("name"))
	if err := app.Save(grant); err != nil {
		return re.InternalServerError("Failed to store authorization code", err)
	}

	return re.JSON(http.StatusOK, map[string]string{
		"code":         code,
		"redirect_uri": redirectURI,
		"state":        q.Get("state"),
	})
}
```

- [ ] **Step 4: Write revoke.go and metadata.go**

Create `tinycld/core/server/oauth/revoke.go`:

```go
package oauth

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// handleRevoke implements RFC 7009 token revocation.
//
// Per §2.2 the response is 200 whether or not the token existed: answering
// differently would turn this into an oracle telling an attacker which tokens
// are real.
func handleRevoke(app core.App, re *core.RequestEvent) error {
	if err := re.Request.ParseForm(); err != nil {
		return re.BadRequestError("Malformed form body", err)
	}
	token := re.Request.FormValue("token")
	if token == "" {
		return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
	}

	// The token may be either an access token (carries the grant claim) or a
	// refresh token (matches a stored hash). Try both.
	if jti := grantIDFromToken(token); jti != "" {
		if grant, err := FindGrantByJTI(app, jti); err == nil {
			if err := RevokeGrant(app, grant.Id); err != nil {
				re.App.Logger().Warn("oauth: revoke by jti", "error", err)
			}
		}
		return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
	}

	grant, err := app.FindFirstRecordByFilter(
		grantsCollection, "refresh_token_hash = {:h}",
		map[string]any{"h": hashSecret(token)},
	)
	if err == nil && grant != nil {
		if err := RevokeGrant(app, grant.Id); err != nil {
			re.App.Logger().Warn("oauth: revoke by refresh token", "error", err)
		}
	}
	return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
}
```

Create `tinycld/core/server/oauth/metadata.go`:

```go
package oauth

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// MetadataResponse is the RFC 8414 authorization server metadata document.
// A conforming client reads this to discover our endpoints instead of having
// them hard-coded, which is what lets Zapier point at any TinyCld host.
type MetadataResponse struct {
	Issuer                        string   `json:"issuer"`
	AuthorizationEndpoint         string   `json:"authorization_endpoint"`
	TokenEndpoint                 string   `json:"token_endpoint"`
	DeviceAuthorizationEndpoint   string   `json:"device_authorization_endpoint"`
	RevocationEndpoint            string   `json:"revocation_endpoint"`
	UserinfoEndpoint              string   `json:"userinfo_endpoint"`
	ScopesSupported               []string `json:"scopes_supported"`
	ResponseTypesSupported        []string `json:"response_types_supported"`
	GrantTypesSupported           []string `json:"grant_types_supported"`
	CodeChallengeMethodsSupported []string `json:"code_challenge_methods_supported"`
	TokenEndpointAuthMethods      []string `json:"token_endpoint_auth_methods_supported"`
}

// handleMetadata serves GET /.well-known/oauth-authorization-server.
func handleMetadata(app core.App, re *core.RequestEvent) error {
	base := strings.TrimSuffix(app.Settings().Meta.AppURL, "/")
	return re.JSON(http.StatusOK, MetadataResponse{
		Issuer:                      base,
		AuthorizationEndpoint:       base + "/p/oauth/authorize",
		TokenEndpoint:               base + "/oauth/token",
		DeviceAuthorizationEndpoint: base + "/oauth/device",
		RevocationEndpoint:          base + "/oauth/revoke",
		UserinfoEndpoint:            base + "/oauth/userinfo",
		ScopesSupported:             AllScopes,
		ResponseTypesSupported:      []string{"code"},
		GrantTypesSupported: []string{
			grantTypeAuthCode, grantTypeRefresh, grantTypeDevice,
		},
		// S256 only — OAuth 2.1 removes `plain`.
		CodeChallengeMethodsSupported: []string{MethodS256},
		TokenEndpointAuthMethods: []string{
			"none", "client_secret_post",
		},
	})
}

// UserinfoResponse is the minimal identity document an integration needs.
type UserinfoResponse struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Name     string `json:"name,omitempty"`
	Username string `json:"preferred_username,omitempty"`
}

// handleUserinfo serves GET /oauth/userinfo for the authenticated caller.
func handleUserinfo(app core.App, re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.JSON(http.StatusOK, UserinfoResponse{
		Sub:      re.Auth.Id,
		Email:    re.Auth.GetString("email"),
		Name:     re.Auth.GetString("name"),
		Username: re.Auth.GetString("username"),
	})
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tinycld/core/server && go test ./oauth/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tinycld/core/server/oauth/authorize.go tinycld/core/server/oauth/revoke.go tinycld/core/server/oauth/metadata.go tinycld/core/server/oauth/authorize_test.go
git commit -m "feat(oauth): authorize, revoke (RFC 7009), and metadata (RFC 8414) endpoints"
```

---

## Task 9: Wire into the shared composition + seed the CLI client

**Files:**
- Create: `tinycld/core/server/oauth/register.go`
- Create: `tinycld/core/server/pb_migrations/1980000001_seed_cli_oauth_client.js`
- Modify: `tinycld/core/server/coreserver/server.go:252` (inside `registerSharedCore`)
- Test: `tinycld/core/server/oauth/register_test.go`

**Interfaces:**
- Consumes: every handler from Tasks 6–8, `bindGrantEnforcement` (Task 5)
- Produces: `Register(app *pocketbase.PocketBase)`; the seeded `tinycld-cli` client

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/oauth/register_test.go`:

```go
package oauth

import (
	"testing"

	"github.com/pocketbase/pocketbase"
)

func TestRegisterBindsWithoutPanicking(t *testing.T) {
	// Register only binds hooks; it must be safe to call on a fresh app and
	// must not require the collections to exist yet (migrations run later).
	app := pocketbase.New()
	Register(app)
}

func TestMiddlewarePriorityRunsBeforePocketBase(t *testing.T) {
	// The whole scheme depends on our middleware running FIRST: PocketBase's
	// loadAuthToken short-circuits on e.Auth != nil, so if we ran second it
	// would already have set e.Auth and our grant check would be bypassed.
	if middlewarePriority >= 0 {
		t.Logf("middlewarePriority = %d", middlewarePriority)
	}
	// Lower number = earlier. Assert we are strictly earlier than PB's default.
	pbPriority := defaultLoadAuthTokenPriorityForTest()
	if middlewarePriority >= pbPriority {
		t.Fatalf("middlewarePriority = %d must be < PocketBase's %d",
			middlewarePriority, pbPriority)
	}
}
```

Append to `tinycld/core/server/oauth/middleware.go`:

```go
// defaultLoadAuthTokenPriorityForTest exposes PocketBase's middleware priority
// so a test can assert we are ordered ahead of it.
func defaultLoadAuthTokenPriorityForTest() int {
	return apis.DefaultLoadAuthTokenMiddlewarePriority
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./oauth/ -run 'TestRegister|TestMiddlewarePriority' -v`
Expected: FAIL — `undefined: Register`.

- [ ] **Step 3: Write register.go**

Create `tinycld/core/server/oauth/register.go`:

```go
package oauth

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Register wires the OAuth authorization server into an app.
//
// Called from coreserver.registerSharedCore, so a single-org deployment and a
// multi-org tenant get exactly the same endpoints — an org hosted on the
// router must be able to authorize a CLI or a Zapier connection just like a
// self-hosted box.
func Register(app *pocketbase.PocketBase) {
	bindGrantEnforcement(app)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// Discovery. Unauthenticated by design: a client reads this before it
		// has any credential.
		e.Router.GET("/.well-known/oauth-authorization-server",
			func(re *core.RequestEvent) error { return handleMetadata(app, re) })

		// Device Authorization Grant (RFC 8628). Unauthenticated: the whole
		// point is that the device has no credential yet.
		e.Router.POST("/oauth/device",
			func(re *core.RequestEvent) error { return handleDeviceAuthorization(app, re) })

		// Token endpoint. Unauthenticated at the HTTP layer; the grant itself
		// (device_code / auth code + PKCE / refresh token) is the credential.
		e.Router.POST("/oauth/token",
			func(re *core.RequestEvent) error { return handleToken(app, re) })

		// Revocation (RFC 7009). Unauthenticated per spec — presenting the
		// token is sufficient authority to destroy it.
		e.Router.POST("/oauth/revoke",
			func(re *core.RequestEvent) error { return handleRevoke(app, re) })

		// Consent surfaces. These require a signed-in user: approval binds the
		// grant to whoever is authenticated in the browser.
		e.Router.GET("/oauth/authorize/info",
			func(re *core.RequestEvent) error { return handleAuthorizeInfo(app, re) })
		e.Router.POST("/oauth/authorize/approve",
			func(re *core.RequestEvent) error { return handleApproveDevice(app, re) })
		e.Router.POST("/oauth/authorize/deny",
			func(re *core.RequestEvent) error { return handleDenyDevice(app, re) })
		e.Router.POST("/oauth/authorize",
			func(re *core.RequestEvent) error { return handleAuthorize(app, re) })

		// Identity for integrations.
		e.Router.GET("/oauth/userinfo",
			func(re *core.RequestEvent) error { return handleUserinfo(app, re) })

		return e.Next()
	})
}
```

- [ ] **Step 4: Seed the first-party CLI client**

Create `tinycld/core/server/pb_migrations/1980000001_seed_cli_oauth_client.js`:

```javascript
/// <reference path="../pb_data/types.d.ts" />
// Register the tinycld CLI as a first-party OAuth client.
//
// It is a PUBLIC client: an installed binary cannot keep a secret, so there is
// none to steal. PKCE (S256) is what binds an authorization exchange to the
// process that started it, and the Device Grant it actually uses never
// redirects at all.
//
// Seeded rather than hand-registered so every deployment — self-hosted or a
// multi-org tenant — can authenticate a CLI the moment it boots.
migrate(
    app => {
        const clients = app.findCollectionByNameOrId('oauth_clients')
        const cli = new Record(clients)
        cli.set('client_id', 'tinycld-cli')
        cli.set('name', 'TinyCld CLI')
        cli.set('type', 'public')
        cli.set('is_first_party', true)
        // The CLI uses the device grant, which has no redirect. The loopback
        // entry is there for a future `--browser` authorization-code login.
        cli.set('redirect_uris', ['http://127.0.0.1/callback'])
        cli.set(
            'scopes',
            'profile mail:read mail:send drive:read drive:write ' +
                'contacts:read contacts:write calendar:read calendar:write'
        )
        app.save(cli)
    },
    app => {
        try {
            const existing = app.findFirstRecordByFilter(
                'oauth_clients',
                'client_id = {:id}',
                { id: 'tinycld-cli' }
            )
            app.delete(existing)
        } catch {
            // Already gone — nothing to undo.
        }
    }
)
```

- [ ] **Step 5: Wire into registerSharedCore**

In `tinycld/core/server/coreserver/server.go`, add the import:

```go
	"tinycld.org/core/oauth"
```

Then inside `registerSharedCore`, immediately after the `pkgaccess.Register(app)` line, add:

```go
	// OAuth 2.1 authorization server: the device grant the tinycld CLI logs in
	// with, and authorization-code + PKCE for third-party integrations. Shared
	// (not host-only) because a multi-org tenant must be able to authorize a
	// CLI or an integration exactly like a self-hosted deployment.
	oauth.Register(app)
```

- [ ] **Step 6: Run the full server test suite**

Run: `cd tinycld/core/server && go test ./oauth/ ./coreserver/ -v`
Expected: PASS — including `composition_parity_test.go`, which must stay green because we registered in the shared path rather than the host-only tail.

- [ ] **Step 7: Verify migrations apply and types regenerate**

Run: `cd tinycld && pnpm run packages:generate`
Expected: succeeds; `core/types/pbSchema.ts` contains `OauthClients` and `OauthGrants`.

- [ ] **Step 8: Commit**

```bash
git add tinycld/core/server/oauth/register.go tinycld/core/server/oauth/register_test.go tinycld/core/server/oauth/middleware.go tinycld/core/server/pb_migrations/1980000001_seed_cli_oauth_client.js tinycld/core/server/coreserver/server.go
git commit -m "feat(oauth): register the authorization server in the shared composition"
```

---

## Task 10: Fix the image-proxy token-type hole

**Files:**
- Modify: `mail/server/endpoints_image_proxy.go:102`
- Test: `mail/server/endpoints_image_proxy_test.go`

**Interfaces:**
- Consumes: nothing from prior tasks — independent bug fix
- Produces: nothing consumed later

`FindAuthRecordByToken` is called with no type restriction, so a `file` or `verification` token is accepted as proof of identity. This is pre-existing, but it sits on the auth path this work touches, and OAuth adds more token variety in circulation.

- [ ] **Step 1: Write the failing test**

Append to `mail/server/endpoints_image_proxy_test.go`:

```go
func TestImageProxyRejectsNonAuthTokenTypes(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(users)
	u.Set("email", "proxy@example.com")
	u.Set("password", "s3cret-password")
	if err := app.Save(u); err != nil {
		t.Fatalf("save user: %v", err)
	}

	// A FILE token is not an identity assertion — it authorizes reading one
	// file. Accepting it here would let a leaked file URL drive the proxy.
	fileToken, err := u.NewFileToken()
	if err != nil {
		t.Fatalf("NewFileToken: %v", err)
	}

	if _, err := app.FindAuthRecordByToken(fileToken, core.TokenTypeAuth); err == nil {
		t.Fatal("a file token must not resolve as an auth token")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mail/server && go test ./... -run TestImageProxyRejectsNonAuthTokenTypes -v`
Expected: The assertion passes only once the production call is constrained; if it already passes, the fix in Step 3 is still required because the *handler* is what accepts the loose token.

- [ ] **Step 3: Apply the fix**

In `mail/server/endpoints_image_proxy.go` at line 102, change:

```go
	record, err := app.FindAuthRecordByToken(token)
```

to:

```go
	// Restrict to auth tokens explicitly. Without the type argument any
	// PocketBase token — including a file or verification token, which are
	// not identity assertions — is accepted as proof of who the caller is.
	record, err := app.FindAuthRecordByToken(token, core.TokenTypeAuth)
```

- [ ] **Step 4: Run the mail server tests**

Run: `cd mail/server && go test ./... -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mail/server/endpoints_image_proxy.go mail/server/endpoints_image_proxy_test.go
git commit -m "fix(mail): restrict image-proxy auth to auth-type tokens"
```

---

## Task 11: Consent screen

**Files:**
- Create: `tinycld/app/p/oauth/authorize.tsx`
- Test: `tinycld/core/tests/unit/oauth-consent.test.tsx`

**Interfaces:**
- Consumes: `GET /oauth/authorize/info`, `POST /oauth/authorize/approve`, `POST /oauth/authorize/deny`
- Produces: the route `/p/oauth/authorize` referenced by `DeviceResponse.VerificationURI`

This is a public route (under `app/p/`) but requires a signed-in user; an anonymous visitor is sent to login and returns here.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/oauth-consent.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react-native'
import { describe, expect, it, vi } from 'vitest'
import { ScopeList } from '~/core/components/oauth/ScopeList'

describe('ScopeList', () => {
    it('renders a human description for each scope', () => {
        render(<ScopeList scopes={['mail:read', 'drive:write']} />)
        expect(screen.getByText('Read your email')).toBeTruthy()
        expect(screen.getByText('Create and modify your files')).toBeTruthy()
    })

    it('falls back to the raw scope name for an unknown scope', () => {
        // A newer server may grant a scope this build has no copy for. Showing
        // the raw name is honest; hiding it would understate what is granted.
        render(<ScopeList scopes={['future:capability']} />)
        expect(screen.getByText('future:capability')).toBeTruthy()
    })

    it('renders nothing when there are no scopes', () => {
        const { toJSON } = render(<ScopeList scopes={[]} />)
        expect(toJSON()).toBeNull()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec tinycld-pkg test -- oauth-consent`
Expected: FAIL — cannot resolve `~/core/components/oauth/ScopeList`.

- [ ] **Step 3: Write the ScopeList component**

Create `tinycld/core/components/oauth/ScopeList.tsx`:

```tsx
import { Text, View } from 'react-native'

// Human-readable copy for each scope. The consent screen must say what access
// means in plain language — "mail:read" tells a user nothing.
const SCOPE_LABELS: Record<string, string> = {
    profile: 'See your name and email address',
    'mail:read': 'Read your email',
    'mail:send': 'Send email on your behalf',
    'drive:read': 'Read your files',
    'drive:write': 'Create and modify your files',
    'contacts:read': 'Read your contacts',
    'contacts:write': 'Create and modify your contacts',
    'calendar:read': 'Read your calendar',
    'calendar:write': 'Create and modify calendar events',
}

interface ScopeListProps {
    scopes: string[]
}

export function ScopeList({ scopes }: ScopeListProps) {
    if (scopes.length === 0) return null

    return (
        <View className="gap-2">
            {scopes.map(scope => (
                <View key={scope} className="flex-row items-start gap-2">
                    <Text className="text-foreground">•</Text>
                    <Text className="text-foreground flex-1">
                        {SCOPE_LABELS[scope] ?? scope}
                    </Text>
                </View>
            ))}
        </View>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld && pnpm exec tinycld-pkg test -- oauth-consent`
Expected: PASS — all three tests.

- [ ] **Step 5: Write the consent screen**

Create `tinycld/app/p/oauth/authorize.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '~/core/components/ui/button'
import { Input } from '~/core/components/ui/input'
import { ScopeList } from '~/core/components/oauth/ScopeList'
import { useAuthStore } from '~/core/lib/stores/auth-store'
import { captureException } from '~/core/lib/errors'
import { pb } from '~/core/lib/pocketbase'

interface AuthorizeInfo {
    client_name: string
    scopes: string[]
    expires_at: string
}

export default function OAuthAuthorizeScreen() {
    const router = useRouter()
    const params = useLocalSearchParams<{ user_code?: string }>()
    const user = useAuthStore(s => s.user)
    const [code, setCode] = useState(params.user_code ?? '')
    const [deviceLabel, setDeviceLabel] = useState('')
    const [done, setDone] = useState<'approved' | 'denied' | null>(null)

    const info = useQuery({
        queryKey: ['oauth-authorize-info', code],
        enabled: code.length >= 9 && !!user,
        queryFn: async (): Promise<AuthorizeInfo> =>
            pb.send('/oauth/authorize/info', { method: 'GET', query: { user_code: code } }),
    })

    const approve = useMutation({
        mutationFn: async () => {
            const body = new FormData()
            body.append('user_code', code)
            body.append('device_label', deviceLabel || 'Unnamed device')
            await pb.send('/oauth/authorize/approve', { method: 'POST', body })
        },
        onSuccess: () => setDone('approved'),
        onError: (err: unknown) => captureException('oauth.authorize.approve', err),
    })

    const deny = useMutation({
        mutationFn: async () => {
            const body = new FormData()
            body.append('user_code', code)
            await pb.send('/oauth/authorize/deny', { method: 'POST', body })
        },
        onSuccess: () => setDone('denied'),
        onError: (err: unknown) => captureException('oauth.authorize.deny', err),
    })

    if (!user) {
        return (
            <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
                <Text className="text-foreground text-lg">Sign in to continue</Text>
                <Button onPress={() => router.push('/login')}>
                    <Text>Sign in</Text>
                </Button>
            </View>
        )
    }

    if (done) {
        return (
            <View className="flex-1 items-center justify-center gap-2 bg-background p-6">
                <Text className="text-foreground text-xl font-semibold">
                    {done === 'approved' ? 'Device connected' : 'Request denied'}
                </Text>
                <Text className="text-muted-foreground text-center">
                    {done === 'approved'
                        ? 'You can return to your terminal.'
                        : 'Nothing was granted access.'}
                </Text>
            </View>
        )
    }

    return (
        <View className="flex-1 gap-6 bg-background p-6">
            <Text className="text-foreground text-2xl font-semibold">Connect a device</Text>

            <View className="gap-2">
                <Text className="text-muted-foreground">
                    Enter the code shown in your terminal
                </Text>
                <Input
                    value={code}
                    onChangeText={t => setCode(t.toUpperCase())}
                    placeholder="WDJB-MJHT"
                    autoCapitalize="characters"
                />
            </View>

            {info.isLoading && <ActivityIndicator />}

            {info.isError && (
                <Text className="text-destructive">
                    That code is not valid or has expired.
                </Text>
            )}

            {info.data && (
                <View className="gap-4">
                    <Text className="text-foreground text-lg">
                        {info.data.client_name} wants access to:
                    </Text>
                    <ScopeList scopes={info.data.scopes} />

                    <View className="gap-2">
                        <Text className="text-muted-foreground">Name this device</Text>
                        <Input
                            value={deviceLabel}
                            onChangeText={setDeviceLabel}
                            placeholder="My laptop"
                        />
                    </View>

                    <View className="flex-row gap-3">
                        <Button
                            onPress={() => approve.mutate()}
                            disabled={approve.isPending}
                            className="flex-1"
                        >
                            <Text>Connect</Text>
                        </Button>
                        <Button
                            variant="outline"
                            onPress={() => deny.mutate()}
                            disabled={deny.isPending}
                            className="flex-1"
                        >
                            <Text>Deny</Text>
                        </Button>
                    </View>
                </View>
            )}
        </View>
    )
}
```

- [ ] **Step 6: Verify typecheck and lint**

Run: `cd tinycld && pnpm exec tinycld-pkg check`
Expected: PASS — biome, tsc, and vitest all clean.

- [ ] **Step 7: Commit**

```bash
git add tinycld/core/components/oauth/ tinycld/app/p/oauth/ tinycld/core/tests/unit/oauth-consent.test.tsx
git commit -m "feat(oauth): device-approval consent screen"
```

---

## Task 12: Connected apps — list and revoke

**Files:**
- Create: `tinycld/core/components/settings/ConnectedAppsSection.tsx`
- Modify: `tinycld/app/(app)/settings/personal.tsx`
- Test: `tinycld/core/tests/unit/connected-apps.test.tsx`

**Interfaces:**
- Consumes: the `oauth_grants` list rule (a user may read their own rows), `POST /oauth/revoke`
- Produces: the revocation UI the spec's verification step exercises

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/connected-apps.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native'
import { describe, expect, it } from 'vitest'
import { formatLastUsed } from '~/core/components/settings/ConnectedAppsSection'

describe('formatLastUsed', () => {
    it('reports never for an empty timestamp', () => {
        expect(formatLastUsed('')).toBe('Never used')
    })

    it('reports a relative time for a recent timestamp', () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        expect(formatLastUsed(oneHourAgo)).toContain('hour')
    })

    it('reports days for an older timestamp', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        expect(formatLastUsed(threeDaysAgo)).toContain('day')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec tinycld-pkg test -- connected-apps`
Expected: FAIL — cannot resolve `ConnectedAppsSection`.

- [ ] **Step 3: Write the component**

Create `tinycld/core/components/settings/ConnectedAppsSection.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { eq } from '@tanstack/db'
import { Text, View } from 'react-native'
import { useStore } from 'pbtsdb'
import { Button } from '~/core/components/ui/button'
import { captureException } from '~/core/lib/errors'
import { pb } from '~/core/lib/pocketbase'
import { useOrgLiveQuery } from '~/core/lib/use-org-live-query'

// formatLastUsed turns an ISO timestamp into the coarse relative string the
// list shows. Coarse on purpose: the exact minute is noise, and "never used"
// is the signal that matters when auditing what to revoke.
export function formatLastUsed(iso: string): string {
    if (!iso) return 'Never used'
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return 'Never used'

    const minutes = Math.floor((Date.now() - then) / 60000)
    if (minutes < 60) return 'Used in the last hour'
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `Used ${hours} hour${hours === 1 ? '' : 's'} ago`
    const days = Math.floor(hours / 24)
    return `Used ${days} day${days === 1 ? '' : 's'} ago`
}

export function ConnectedAppsSection() {
    const [grantsCollection] = useStore('oauth_grants')
    const queryClient = useQueryClient()

    const { data: grants } = useOrgLiveQuery((query, { userId }) =>
        query
            .from({ grant: grantsCollection })
            .where(({ grant }) => eq(grant.user, userId))
            .orderBy(({ grant }) => grant.created, 'desc')
    )

    const revoke = useMutation({
        mutationFn: async (refreshHint: string) => {
            const body = new FormData()
            body.append('token', refreshHint)
            body.append('client_id', 'tinycld-cli')
            await pb.send('/oauth/revoke', { method: 'POST', body })
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oauth_grants'] }),
        onError: (err: unknown) => captureException('oauth.revoke', err),
    })

    const active = (grants ?? []).filter(g => g.status === 'active')

    if (active.length === 0) return null

    return (
        <View className="gap-3">
            <Text className="text-foreground text-lg font-semibold">Connected apps</Text>
            <Text className="text-muted-foreground text-sm">
                Devices and integrations with access to your account.
            </Text>
            {active.map(grant => (
                <View
                    key={grant.id}
                    className="flex-row items-center justify-between rounded-lg border border-border p-3"
                >
                    <View className="flex-1 gap-1">
                        <Text className="text-foreground font-medium">
                            {grant.device_label || 'Unnamed device'}
                        </Text>
                        <Text className="text-muted-foreground text-sm">
                            {formatLastUsed(grant.last_used_at ?? '')}
                        </Text>
                    </View>
                    <Button
                        variant="outline"
                        onPress={() => revoke.mutate(grant.jti)}
                        disabled={revoke.isPending}
                    >
                        <Text>Revoke</Text>
                    </Button>
                </View>
            ))}
        </View>
    )
}
```

- [ ] **Step 4: Wire it into the personal settings screen**

In `tinycld/app/(app)/settings/personal.tsx`, add the import:

```tsx
import { ConnectedAppsSection } from '~/core/components/settings/ConnectedAppsSection'
```

Then render it inside a `SectionCard` immediately **before** the `AboutSection`, so credential management sits with the account rather than with build info.

- [ ] **Step 5: Run tests and checks**

Run: `cd tinycld && pnpm exec tinycld-pkg check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tinycld/core/components/settings/ConnectedAppsSection.tsx tinycld/app/\(app\)/settings/personal.tsx tinycld/core/tests/unit/connected-apps.test.tsx
git commit -m "feat(oauth): connected apps list with per-device revocation"
```

---

## Task 13: End-to-end verification and help topic

**Files:**
- Create: `tinycld/core/help/connected-apps.md`
- Test: manual verification against a running dev server

**Interfaces:**
- Consumes: everything
- Produces: user-facing documentation; a verified working flow

- [ ] **Step 1: Write the help topic**

Create `tinycld/core/help/connected-apps.md`:

```markdown
---
title: Connected apps and devices
summary: Connect the command line tool or a third-party integration, and revoke access you no longer want.
tags: [security, cli, integrations]
order: 40
---

To see what has access to your account, open **Settings → Personal** and find
**Connected apps**. Each row is one device or integration, with when it was
last used.

## Connecting the command line tool

Run the login command on your computer:

```
tinycld auth login {{server-host}}
```

It shows a short code and opens {{server-host}} in your browser. Check that the
code in the browser matches the one in your terminal, name the device so you
can recognize it later, and choose **Connect**.

If the browser does not open, go to `{{server-host}}/p/oauth/authorize` and
enter the code by hand.

## Revoking access

Choose **Revoke** next to any entry. The change takes effect immediately — the
next request from that device or integration is refused, and it must be
connected again from scratch.

Revoking one entry does not affect anything else. Your browser session, your
phone, and every other connected device keep working.

## What an app can do

When you connect something, the approval screen lists exactly what it is asking
for — reading email, creating files, and so on. An app only ever gets what is
listed there. If a request asks for more than you expect, choose **Deny**.
```

- [ ] **Step 2: Regenerate so the topic is picked up**

Run: `cd tinycld && pnpm run packages:generate`
Expected: succeeds; the topic appears in `lib/generated/package-help.ts`.

- [ ] **Step 3: Verify the full flow against a dev server**

Start the server:

Run: `cd tinycld && pnpm run dev`

Then in a second terminal, walk the device flow with curl:

```bash
# 1. Discovery
curl -s localhost:8090/.well-known/oauth-authorization-server | jq

# 2. Start a device authorization
curl -s -X POST localhost:8090/oauth/device \
  -d 'client_id=tinycld-cli&scope=drive:read mail:read' | jq
```

Expected: a JSON body with `device_code`, `user_code`, `verification_uri`,
`expires_in: 900`, and `interval: 5`.

```bash
# 3. Poll before approving — must report authorization_pending
curl -s -X POST localhost:8090/oauth/token \
  -d 'grant_type=urn:ietf:params:oauth:grant-type:device_code' \
  -d "device_code=<device_code from step 2>" \
  -d 'client_id=tinycld-cli' | jq
```

Expected: `{"error": "authorization_pending", ...}`.

Now open `http://localhost:8090/p/oauth/authorize?user_code=<user_code>` in a
browser, sign in, name the device, and choose **Connect**.

```bash
# 4. Poll again — must now return tokens
curl -s -X POST localhost:8090/oauth/token \
  -d 'grant_type=urn:ietf:params:oauth:grant-type:device_code' \
  -d "device_code=<device_code>" \
  -d 'client_id=tinycld-cli' | jq
```

Expected: `access_token`, `refresh_token`, `token_type: "Bearer"`, `expires_in: 3600`.

```bash
# 5. The access token must work on a scoped endpoint
curl -s 'localhost:8090/api/drive/search?q=test' \
  -H "Authorization: Bearer <access_token>" | jq

# 6. ...and must be refused on an out-of-scope one
curl -s -X POST localhost:8090/api/mail/send \
  -H "Authorization: Bearer <access_token>" \
  -H 'Content-Type: application/json' -d '{}' | jq
```

Expected: step 5 returns results; step 6 returns 403 mentioning the
`mail:send` scope (the grant asked for `mail:read` only).

```bash
# 7. Revoke, then confirm the token is dead
curl -s -X POST localhost:8090/oauth/revoke \
  -d "token=<refresh_token>&client_id=tinycld-cli"

curl -s 'localhost:8090/api/drive/search?q=test' \
  -H "Authorization: Bearer <access_token>" | jq
```

Expected: the revoke returns 200; the follow-up request now returns 401.

Finally, confirm in the app that Settings → Personal → Connected apps listed
the device while active and no longer lists it after revocation, and that the
browser session stayed signed in throughout.

- [ ] **Step 4: Run the complete check suite**

Run: `cd tinycld/core/server && go test ./...`
Expected: PASS.

Run: `cd tinycld && pnpm run checks`
Expected: PASS.

Run: `cd tinycld && pnpm run pkg:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/help/connected-apps.md
git commit -m "docs(oauth): help topic for connected apps and CLI login"
```

---

## Self-Review Notes

**Spec coverage.** Every element of Part 1 of the spec maps to a task: the AS endpoints (6, 7, 8), both collections (2), scopes and default-deny (5), the `sharelink`-style domain-separated key (1), grant-record revocation (4), the closed-token-type avoidance via middleware priority (5), `registerSharedCore` placement (9), the image-proxy fix (10), consent and revocation UI (11, 12), and the HS256/JWKS deferral (documented as a constraint, no task — correct, it is out of scope).

**Deferred to plan C.** `GET /api/cli/downloads`, the cross-compile pipeline step, and the About-panel download block are CLI distribution, not OAuth.

**Resolved before execution.** The pre-flight scan confirmed against
`core/field_relation.go:198` that PocketBase's `RelationField.ValidateValue`
returns `validation.ErrRequired` for an empty required relation. Task 6 stores
a pending device grant with no user, so `og_user` is declared `required: false`
in both the migration and the test helper, with the invariant enforced in Go
(`VerifyGrant` accepts only `status == "active"`, and only approval sets both).
Task 6 also sets `grant.Set("expires_at", …)` — note that a pending grant's
`expires_at` is the DEVICE CODE deadline; `issueTokens` overwrites it with the
refresh-token deadline on exchange.
