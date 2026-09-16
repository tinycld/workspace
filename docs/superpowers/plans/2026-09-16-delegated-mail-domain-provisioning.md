# Delegated Mail-Domain Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a hosted org add a custom mail domain, enroll it with the fleet's Postmark account and see the DNS records to publish — without the tenant process ever holding the Postmark account token.

**Architecture:** A `Registrar` seam in `tinycld/core/server/maildomains`, modelled on the existing `core/server/syscfg` seam. A direct in-process implementation calls Postmark (single-tenant); a delegating implementation forwards over hosting's existing `ctl.sock` to the router, which holds the account token. The mail package calls the seam and never learns hosting exists.

**Tech Stack:** Go 1.x (PocketBase v0.30-fork), `github.com/mrz1836/postmark@v1.9.0`, React Native / Expo Router + TanStack DB for the UI, vitest + Playwright, `go test`.

## Global Constraints

- **Three repos, one branch name.** Changes span `tinycld/` (core), `hosting/`, and `mail/`. Per `CLAUDE.md`, use the **same branch name in all three**: `feat/delegated-mail-domain-provisioning`. The core PR must be opened first and merged before the package PRs.
- **Core must not name a package.** No feature slug, scope, collection name or `/api/<slug>/` route may appear in `tinycld/core/`. `maildomains` names a capability, like the existing `mailer` and `syscfg`. `pnpm run check:core-isolation` enforces this.
- **Never use `any`** in TypeScript. **Never use `biome-ignore`** — fix the underlying issue.
- **No raw hex colors** in UI. Use semantic Tailwind tokens or `useThemeColor()`.
- **Biome:** 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons.
- **Never `console.*`** in runtime code. Client logging is `log` from `@tinycld/core/lib/logger`; Go server logging is `logging.ForPackage("<slug>")`.
- **Unreleased migrations may be edited in place; released ones are frozen.** This plan adds **no** migration — `verification_details` already exists with a 10 KB budget.
- **The account token must never reach a tenant.** `mail.postmark_account_token` stays router-side only. Task 6 tests this directly.
- Run checks from inside the member changed: `pnpm exec tinycld-pkg check`. Go: `go test ./...` from the module root.

---

## File Structure

**`tinycld/core/server/maildomains/`** (new package — the seam)
- `maildomains.go` — `Registrar` interface, `DomainRecords`, `SetRegistrar`/`SetResolver`/`Current`/`IsClaimed`/`ResetForTesting`, `ErrNotConfigured`. Mirrors `syscfg/syscfg.go`.
- `postmark.go` — `PostmarkRegistrar`, the direct in-process implementation.
- `tokens.go` — server-token derivation from the account token, with caching.
- `maildomains_test.go`, `postmark_test.go`, `tokens_test.go`

**`hosting/`**
- `maildomains/registrar.go` (new) — `CtlRegistrar`, the delegating implementation over `ctl.sock`.
- `maildomains/registrar_test.go` (new)
- `internal/controlplane/maildomains.go` (new) — router-side Postmark calls + the two ctl.sock handlers.
- `internal/controlplane/maildomains_test.go` (new)
- `internal/controlplane/deploy.go` (modify) — mount the two routes on the existing mux.
- `internal/controlplane/systemconfig.go` (modify) — filter the account token out of pushed config.
- `tenantboot/register.go` (modify) — install `CtlRegistrar`, claiming the seam.

**`mail/`**
- `server/provider.go` (modify) — remove `AddDomain`/`CheckDomainVerification` from `Provider`.
- `server/postmark.go` (modify) — remove the two moved methods.
- `server/smtp_provider.go` (modify) — move its DNS checks into an SMTP registrar.
- `server/domain_verify.go` (modify) — `checkOutbound` reads the seam.
- `server/endpoints_add_domain.go` (new) — the enroll-on-add endpoint.
- `server/api/api.go` (modify) — widen `OutboundCheckResult`.
- `tinycld/mail/settings/provider.tsx` (modify) — add-domain via endpoint; render the DNS records.
- `tinycld/mail/settings/DnsRecordsPanel.tsx` (new) — the copyable record table.
- `help/custom-domains.md` (modify) — correct the documented behaviour.

---

## Task 1: The `maildomains` seam in core

**Files:**
- Create: `tinycld/core/server/maildomains/maildomains.go`
- Test: `tinycld/core/server/maildomains/maildomains_test.go`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `maildomains.Registrar` interface with `AddDomain(ctx context.Context, domain string) (*DomainRecords, error)` and `GetDomain(ctx context.Context, domain string) (*DomainRecords, error)`; the `DomainRecords` struct; `SetRegistrar(Registrar)`, `SetResolver(Registrar)`, `Current() Registrar`, `IsClaimed() bool`, `ResetForTesting()`, `ErrNotConfigured`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/maildomains/maildomains_test.go`:

```go
package maildomains

import (
	"context"
	"errors"
	"testing"
)

type stubRegistrar struct{ name string }

func (s stubRegistrar) AddDomain(context.Context, string) (*DomainRecords, error) {
	return &DomainRecords{Domain: s.name}, nil
}
func (s stubRegistrar) GetDomain(context.Context, string) (*DomainRecords, error) {
	return &DomainRecords{Domain: s.name}, nil
}

// The zero state resolves nothing: a deployment that wired nothing up must
// get a clear "not configured", never a nil panic.
func TestUnconfiguredReturnsErrNotConfigured(t *testing.T) {
	ResetForTesting()
	t.Cleanup(ResetForTesting)

	if _, err := Current().AddDomain(context.Background(), "acme.com"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("AddDomain err = %v, want ErrNotConfigured", err)
	}
	if _, err := Current().GetDomain(context.Background(), "acme.com"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("GetDomain err = %v, want ErrNotConfigured", err)
	}
}

// SetResolver is the standalone path: the deployment points the seam at its
// own implementation.
func TestSetResolverInstalls(t *testing.T) {
	ResetForTesting()
	t.Cleanup(ResetForTesting)

	SetResolver(stubRegistrar{name: "own"})
	rec, err := Current().GetDomain(context.Background(), "acme.com")
	if err != nil {
		t.Fatalf("GetDomain: %v", err)
	}
	if rec.Domain != "own" {
		t.Fatalf("Domain = %q, want %q", rec.Domain, "own")
	}
	if IsClaimed() {
		t.Error("SetResolver must not claim the seam")
	}
}

// The security-critical case, copied from syscfg: once a supervising
// composition claims the seam, core's own wiring must not be able to point it
// back at the deployment's own credentials.
func TestSetRegistrarClaimsAndBlocksResolver(t *testing.T) {
	ResetForTesting()
	t.Cleanup(ResetForTesting)

	SetRegistrar(stubRegistrar{name: "supervisor"})
	if !IsClaimed() {
		t.Fatal("SetRegistrar must claim the seam")
	}

	SetResolver(stubRegistrar{name: "own"})
	rec, err := Current().GetDomain(context.Background(), "acme.com")
	if err != nil {
		t.Fatalf("GetDomain: %v", err)
	}
	if rec.Domain != "supervisor" {
		t.Fatalf("Domain = %q, want the supervisor's registrar to survive SetResolver", rec.Domain)
	}
}

// A nil registrar is a caller bug, not an intent to disable the seam.
// Installing it would turn every call into a nil dereference.
func TestNilRegistrarIgnored(t *testing.T) {
	ResetForTesting()
	t.Cleanup(ResetForTesting)

	SetRegistrar(stubRegistrar{name: "good"})
	SetRegistrar(nil)
	rec, err := Current().GetDomain(context.Background(), "acme.com")
	if err != nil {
		t.Fatalf("GetDomain: %v", err)
	}
	if rec.Domain != "good" {
		t.Fatalf("Domain = %q, want nil SetRegistrar to be ignored", rec.Domain)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./maildomains/ -v`
Expected: FAIL — the package does not compile (`undefined: DomainRecords`, `undefined: ResetForTesting`, …).

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/maildomains/maildomains.go`:

```go
// Package maildomains is the indirection through which a mail feature performs
// the domain operations that require the operator's ACCOUNT-level mail-provider
// credentials — enrolling a sending domain and reading back its verification
// state and DNS records.
//
// It exists for the same reason syscfg does, one level up. syscfg delegates a
// VALUE a deployment must not hold; this delegates an OPERATION a deployment
// must not perform. Every call in Postmark's Domains API is account-token
// authenticated, including the reads, and an account token can enumerate,
// modify and delete every domain on the account — so in a hosted composition
// the token cannot live in the tenant at any privilege, and the operation must
// travel to whoever holds it instead.
//
// By default it is unconfigured and every call returns ErrNotConfigured. A
// standalone deployment points it at its own implementation with SetResolver; a
// SUPERVISING composition installs one with SetRegistrar, which CLAIMS the seam
// so the deployment's own wiring cannot later reclaim it.
//
// Nothing here names a feature package: this is a capability, like mailer and
// syscfg beside it.
package maildomains

import (
	"context"
	"errors"
	"sync"
)

// ErrNotConfigured is returned by the zero registrar. Callers surface it as
// "domain provisioning is not configured for this deployment" rather than as
// an opaque provider failure.
var ErrNotConfigured = errors.New("maildomains: no registrar configured")

// DomainRecords is the verification state of a sending domain plus the DNS
// records its owner must publish.
//
// Deliberately pure data with no credential of any kind: it is the wire type
// of the delegating implementation, so everything on it crosses a process
// boundary into a tenant that must not be trusted with the account token.
type DomainRecords struct {
	Domain               string `json:"domain"`
	ID                   int64  `json:"id"`
	SPFVerified          bool   `json:"spf_verified"`
	DKIMVerified         bool   `json:"dkim_verified"`
	ReturnPathVerified   bool   `json:"return_path_verified"`
	DKIMHost             string `json:"dkim_host,omitempty"`
	DKIMTextValue        string `json:"dkim_text_value,omitempty"`
	ReturnPathDomain     string `json:"return_path_domain,omitempty"`
	ReturnPathCNAMEValue string `json:"return_path_cname_value,omitempty"`
}

// Registrar performs the account-token operations.
//
// AddDomain enrolls the domain with the provider and returns its initial
// records. GetDomain reads back the current state of an already-enrolled
// domain. Both take a plain string and return plain data, which is what lets
// the hosted implementation be a transport.
type Registrar interface {
	AddDomain(ctx context.Context, domain string) (*DomainRecords, error)
	GetDomain(ctx context.Context, domain string) (*DomainRecords, error)
}

var (
	mu      sync.RWMutex
	current Registrar = unconfigured{}
	// claimed records that a SUPERVISING composition installed the registrar.
	//
	// Tracked explicitly rather than inferred from current != unconfigured{},
	// for the reason syscfg documents: a supervisor whose config failed to
	// load still owns this operation, and the correct degraded state is "no
	// domain provisioning", never "the deployment uses its own credentials".
	claimed bool
)

// unconfigured is the zero registrar: it performs nothing. It stands in before
// any Set* call so a read during boot returns an error rather than panicking.
type unconfigured struct{}

func (unconfigured) AddDomain(context.Context, string) (*DomainRecords, error) {
	return nil, ErrNotConfigured
}
func (unconfigured) GetDomain(context.Context, string) (*DomainRecords, error) {
	return nil, ErrNotConfigured
}

// SetResolver points the seam at this deployment's own registrar — the
// standalone shape, where the deployment legitimately holds its own account
// token.
//
// Ignored once a supervising composition has claimed the seam. Core's wiring
// runs after a supervisor's, so without this the deployment would silently
// reclaim an operation its operator owns.
func SetResolver(r Registrar) {
	if r == nil {
		return
	}
	mu.RLock()
	taken := claimed
	mu.RUnlock()
	if taken {
		return
	}
	mu.Lock()
	current = r
	mu.Unlock()
}

// SetRegistrar installs the process-wide registrar and CLAIMS the seam. A
// supervising composition calls this BEFORE any package registers, so every
// consumer's first call already routes through it.
//
// A nil registrar is ignored rather than installed: it would turn every call
// into a nil dereference, and a caller passing nil has a bug, not an intent.
func SetRegistrar(r Registrar) {
	if r == nil {
		return
	}
	mu.Lock()
	current, claimed = r, true
	mu.Unlock()
}

// Current returns the installed registrar. Never nil.
func Current() Registrar {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

// IsClaimed reports whether a supervising composition installed the registrar.
func IsClaimed() bool {
	mu.RLock()
	defer mu.RUnlock()
	return claimed
}

// ResetForTesting restores the zero state: no registrar, no claim. Tests that
// install one must call it (t.Cleanup) so the claim does not leak into the
// next test and make SetResolver inert there.
func ResetForTesting() {
	mu.Lock()
	current, claimed = unconfigured{}, false
	mu.Unlock()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./maildomains/ -v`
Expected: PASS — all four tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nas/code/tinycld/tinycld
git checkout -b feat/delegated-mail-domain-provisioning
git add core/server/maildomains/
git commit -m "feat(core): add the maildomains Registrar seam

Delegates the mail-provider operations that need account-level
credentials. Every call in Postmark's Domains API is account-token
authenticated, including the reads, so a hosted tenant can neither
enroll a domain nor check one. Same claiming semantics as syscfg:
a supervisor's registrar cannot be reclaimed by the deployment."
```

---

## Task 2: Server-token derivation

**Files:**
- Create: `tinycld/core/server/maildomains/tokens.go`
- Test: `tinycld/core/server/maildomains/tokens_test.go`

**Interfaces:**
- Consumes: nothing from Task 1 (independent file in the same package).
- Produces: `type TokenResolver struct{...}`; `NewTokenResolver(accountToken, configuredServerToken, serverName string, client PostmarkServers) *TokenResolver`; `(*TokenResolver).ServerToken(ctx context.Context) (string, error)`; `(*TokenResolver).Invalidate()`; the `PostmarkServers` interface with `GetServers(ctx context.Context, count, offset int64, name string) (postmark.ServersList, error)`; `ErrAmbiguousServer`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/maildomains/tokens_test.go`:

```go
package maildomains

import (
	"context"
	"errors"
	"testing"

	"github.com/mrz1836/postmark"
)

type fakeServers struct {
	list  postmark.ServersList
	err   error
	calls int
}

func (f *fakeServers) GetServers(context.Context, int64, int64, string) (postmark.ServersList, error) {
	f.calls++
	return f.list, f.err
}

func srv(name, token string) postmark.Server {
	return postmark.Server{Name: name, APITokens: []string{token}}
}

// An explicitly configured server token wins: a deployment that deliberately
// supplies a scoped token must not have it silently replaced, and an existing
// deployment must keep working without migration.
func TestConfiguredServerTokenWins(t *testing.T) {
	f := &fakeServers{list: postmark.ServersList{Servers: []postmark.Server{srv("a", "derived")}}}
	r := NewTokenResolver("acct", "configured", "", f)

	got, err := r.ServerToken(context.Background())
	if err != nil {
		t.Fatalf("ServerToken: %v", err)
	}
	if got != "configured" {
		t.Fatalf("token = %q, want %q", got, "configured")
	}
	if f.calls != 0 {
		t.Errorf("Postmark called %d times, want 0 when a token is configured", f.calls)
	}
}

// The one-server case: derive it, so an operator supplies only the account key.
func TestDerivesSingleServerToken(t *testing.T) {
	f := &fakeServers{list: postmark.ServersList{Servers: []postmark.Server{srv("only", "tok-1")}}}
	r := NewTokenResolver("acct", "", "", f)

	got, err := r.ServerToken(context.Background())
	if err != nil {
		t.Fatalf("ServerToken: %v", err)
	}
	if got != "tok-1" {
		t.Fatalf("token = %q, want %q", got, "tok-1")
	}
}

// Derivation is cached: this runs on every send path.
func TestServerTokenCached(t *testing.T) {
	f := &fakeServers{list: postmark.ServersList{Servers: []postmark.Server{srv("only", "tok-1")}}}
	r := NewTokenResolver("acct", "", "", f)

	for range 3 {
		if _, err := r.ServerToken(context.Background()); err != nil {
			t.Fatalf("ServerToken: %v", err)
		}
	}
	if f.calls != 1 {
		t.Fatalf("Postmark called %d times, want 1 (cached)", f.calls)
	}
}

// Invalidate forces a re-resolve — the recovery path after a Postmark auth
// failure (a rotated token).
func TestInvalidateForcesReresolve(t *testing.T) {
	f := &fakeServers{list: postmark.ServersList{Servers: []postmark.Server{srv("only", "tok-1")}}}
	r := NewTokenResolver("acct", "", "", f)

	if _, err := r.ServerToken(context.Background()); err != nil {
		t.Fatalf("ServerToken: %v", err)
	}
	r.Invalidate()
	f.list = postmark.ServersList{Servers: []postmark.Server{srv("only", "tok-2")}}
	got, err := r.ServerToken(context.Background())
	if err != nil {
		t.Fatalf("ServerToken after Invalidate: %v", err)
	}
	if got != "tok-2" {
		t.Fatalf("token = %q, want the re-resolved %q", got, "tok-2")
	}
}

// Multiple servers with no name configured is a CONFIGURATION ERROR, never a
// silent pick: choosing the wrong server sends mail from the wrong place.
func TestAmbiguousServerIsAnError(t *testing.T) {
	f := &fakeServers{list: postmark.ServersList{Servers: []postmark.Server{
		srv("prod", "tok-prod"), srv("staging", "tok-stg"),
	}}}
	r := NewTokenResolver("acct", "", "", f)

	if _, err := r.ServerToken(context.Background()); !errors.Is(err, ErrAmbiguousServer) {
		t.Fatalf("err = %v, want ErrAmbiguousServer", err)
	}
}

// With a name configured, the matching server is selected. Match is
// case-insensitive: Postmark server names are display strings.
func TestSelectsNamedServer(t *testing.T) {
	f := &fakeServers{list: postmark.ServersList{Servers: []postmark.Server{
		srv("prod", "tok-prod"), srv("staging", "tok-stg"),
	}}}
	r := NewTokenResolver("acct", "", "PROD", f)

	got, err := r.ServerToken(context.Background())
	if err != nil {
		t.Fatalf("ServerToken: %v", err)
	}
	if got != "tok-prod" {
		t.Fatalf("token = %q, want %q", got, "tok-prod")
	}
}

// No account token and no configured token: nothing to derive from.
func TestNoCredentialsReturnsNotConfigured(t *testing.T) {
	r := NewTokenResolver("", "", "", &fakeServers{})

	if _, err := r.ServerToken(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./maildomains/ -run TestDerives -v`
Expected: FAIL — `undefined: NewTokenResolver`, `undefined: ErrAmbiguousServer`.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/maildomains/tokens.go`:

```go
package maildomains

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/mrz1836/postmark"
)

// ErrAmbiguousServer means the account has several servers and none was
// named. Deliberately an error rather than a heuristic pick: guessing wrong
// sends the deployment's mail from the wrong Postmark server, which looks like
// working mail until someone reads the headers.
var ErrAmbiguousServer = errors.New("maildomains: account has multiple Postmark servers; set mail.postmark_server_name")

// PostmarkServers is the slice of the Postmark client this resolver needs, so
// tests do not need a live account.
type PostmarkServers interface {
	GetServers(ctx context.Context, count, offset int64, name string) (postmark.ServersList, error)
}

// serverListLimit bounds the listing. Postmark accounts hold tens of servers at
// most, and a deployment with more than this needs an explicit name anyway.
const serverListLimit = 100

// TokenResolver supplies the SERVER token, deriving it from the ACCOUNT token
// when one was not configured explicitly.
//
// Requiring an operator to paste both keys is redundant input — GetServers is
// an account-token call and returns each server's APITokens — and it admits a
// failure mode nothing checks for: a server token belonging to a DIFFERENT
// server than the account being managed yields a deployment where sending
// works and domain verification silently does not, with no error naming the
// mismatch. Deriving one from the other makes that unrepresentable.
type TokenResolver struct {
	accountToken     string
	configuredToken  string
	serverName       string
	client           PostmarkServers

	mu     sync.Mutex
	cached string
}

// NewTokenResolver builds a resolver. configuredServerToken, when non-empty,
// short-circuits derivation entirely.
func NewTokenResolver(accountToken, configuredServerToken, serverName string, client PostmarkServers) *TokenResolver {
	return &TokenResolver{
		accountToken:    strings.TrimSpace(accountToken),
		configuredToken: strings.TrimSpace(configuredServerToken),
		serverName:      strings.TrimSpace(serverName),
		client:          client,
	}
}

// ServerToken returns the server token, resolving and caching it on first need.
func (r *TokenResolver) ServerToken(ctx context.Context) (string, error) {
	if r.configuredToken != "" {
		return r.configuredToken, nil
	}
	if r.accountToken == "" {
		return "", ErrNotConfigured
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cached != "" {
		return r.cached, nil
	}

	list, err := r.client.GetServers(ctx, serverListLimit, 0, "")
	if err != nil {
		return "", fmt.Errorf("list postmark servers: %w", err)
	}
	token, err := selectServerToken(list.Servers, r.serverName)
	if err != nil {
		return "", err
	}
	r.cached = token
	return token, nil
}

// Invalidate drops the cached token so the next call re-resolves. Called after
// a Postmark auth failure, which is what a rotated token looks like from here.
func (r *TokenResolver) Invalidate() {
	r.mu.Lock()
	r.cached = ""
	r.mu.Unlock()
}

// selectServerToken picks the server and returns its first API token.
func selectServerToken(servers []postmark.Server, name string) (string, error) {
	if name != "" {
		for _, s := range servers {
			if strings.EqualFold(s.Name, name) {
				return firstToken(s)
			}
		}
		return "", fmt.Errorf("no postmark server named %q on this account", name)
	}
	switch len(servers) {
	case 0:
		return "", errors.New("maildomains: postmark account has no servers")
	case 1:
		return firstToken(servers[0])
	default:
		return "", ErrAmbiguousServer
	}
}

func firstToken(s postmark.Server) (string, error) {
	if len(s.APITokens) == 0 {
		return "", fmt.Errorf("postmark server %q has no API tokens", s.Name)
	}
	return s.APITokens[0], nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./maildomains/ -v`
Expected: PASS — all tests from Tasks 1 and 2.

- [ ] **Step 5: Commit**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/maildomains/tokens.go core/server/maildomains/tokens_test.go
git commit -m "feat(core): derive the Postmark server token from the account token

Server.APITokens comes back populated from GetServers, an account-token
call, so requiring both keys is redundant input — and a mismatched pair
produces a deployment where sending works and verification silently does
not. An explicitly configured token still wins, so no deployment is
forced to migrate. A multi-server account with no configured name is an
error, never a silent pick."
```

---

## Task 3: The direct Postmark registrar

**Files:**
- Create: `tinycld/core/server/maildomains/postmark.go`
- Test: `tinycld/core/server/maildomains/postmark_test.go`

**Interfaces:**
- Consumes: `Registrar`, `DomainRecords`, `ErrNotConfigured` (Task 1).
- Produces: `NewPostmarkRegistrar(accountToken string, client PostmarkDomains) *PostmarkRegistrar` satisfying `Registrar`; the `PostmarkDomains` interface with `CreateDomain`, `GetDomains`, `GetDomain`; `ErrDomainAlreadyEnrolled`; `ErrDomainNotEnrolled`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/maildomains/postmark_test.go`:

```go
package maildomains

import (
	"context"
	"errors"
	"testing"

	"github.com/mrz1836/postmark"
)

type fakeDomains struct {
	created   postmark.DomainDetails
	createErr error
	list      []postmark.Domain
	details   map[int64]postmark.DomainDetails
}

func (f *fakeDomains) CreateDomain(context.Context, postmark.DomainCreateRequest) (postmark.DomainDetails, error) {
	if f.createErr != nil {
		return postmark.DomainDetails{}, f.createErr
	}
	return f.created, nil
}
func (f *fakeDomains) GetDomains(context.Context, int, int) (postmark.DomainsList, error) {
	return postmark.DomainsList{Domains: f.list}, nil
}
func (f *fakeDomains) GetDomain(_ context.Context, id int64) (postmark.DomainDetails, error) {
	d, ok := f.details[id]
	if !ok {
		return postmark.DomainDetails{}, errors.New("not found")
	}
	return d, nil
}

// AddDomain returns the DNS records the customer must publish — the whole
// point of the call. These are exactly the values the old code fetched and
// discarded.
func TestAddDomainReturnsRecords(t *testing.T) {
	f := &fakeDomains{created: postmark.DomainDetails{
		ID: 7, Name: "acme.com",
		DKIMHost: "20260916._domainkey.acme.com", DKIMTextValue: "k=rsa;p=MIIB",
		ReturnPathDomain: "pm-bounces.acme.com", ReturnPathDomainCNAMEValue: "pm.mtasv.net",
	}}
	r := NewPostmarkRegistrar("acct", f)

	rec, err := r.AddDomain(context.Background(), "acme.com")
	if err != nil {
		t.Fatalf("AddDomain: %v", err)
	}
	if rec.ID != 7 || rec.Domain != "acme.com" {
		t.Fatalf("rec = %+v, want ID 7 / acme.com", rec)
	}
	if rec.DKIMHost == "" || rec.DKIMTextValue == "" {
		t.Error("DKIM record values must survive into DomainRecords")
	}
	if rec.ReturnPathDomain == "" || rec.ReturnPathCNAMEValue == "" {
		t.Error("return-path record values must survive into DomainRecords")
	}
}

// Postmark domains are unique per ACCOUNT, so on a shared hosting account a
// second org claiming the same domain hits this. It must be a distinct error
// the UI can phrase, not an opaque 422.
func TestAddDomainDuplicateIsDistinct(t *testing.T) {
	f := &fakeDomains{createErr: postmark.APIError{ErrorCode: 504, Message: "A domain with this name already exists."}}
	r := NewPostmarkRegistrar("acct", f)

	if _, err := r.AddDomain(context.Background(), "acme.com"); !errors.Is(err, ErrDomainAlreadyEnrolled) {
		t.Fatalf("err = %v, want ErrDomainAlreadyEnrolled", err)
	}
}

func TestGetDomainFindsByName(t *testing.T) {
	f := &fakeDomains{
		list:    []postmark.Domain{{ID: 7, Name: "acme.com"}},
		details: map[int64]postmark.DomainDetails{7: {ID: 7, Name: "acme.com", SPFVerified: true, DKIMVerified: true}},
	}
	r := NewPostmarkRegistrar("acct", f)

	rec, err := r.GetDomain(context.Background(), "acme.com")
	if err != nil {
		t.Fatalf("GetDomain: %v", err)
	}
	if !rec.SPFVerified || !rec.DKIMVerified {
		t.Fatalf("rec = %+v, want SPF and DKIM verified", rec)
	}
}

// Name matching is case-insensitive: DNS is, and an admin may type "Acme.com".
func TestGetDomainMatchesCaseInsensitively(t *testing.T) {
	f := &fakeDomains{
		list:    []postmark.Domain{{ID: 7, Name: "acme.com"}},
		details: map[int64]postmark.DomainDetails{7: {ID: 7, Name: "acme.com"}},
	}
	r := NewPostmarkRegistrar("acct", f)

	if _, err := r.GetDomain(context.Background(), "ACME.com"); err != nil {
		t.Fatalf("GetDomain: %v", err)
	}
}

// A domain the account has never heard of is its own error: the caller shows
// "not enrolled", which is actionable, rather than "lookup failed".
func TestGetDomainUnknownIsDistinct(t *testing.T) {
	r := NewPostmarkRegistrar("acct", &fakeDomains{})

	if _, err := r.GetDomain(context.Background(), "nope.com"); !errors.Is(err, ErrDomainNotEnrolled) {
		t.Fatalf("err = %v, want ErrDomainNotEnrolled", err)
	}
}

func TestNoAccountTokenIsNotConfigured(t *testing.T) {
	r := NewPostmarkRegistrar("", &fakeDomains{})

	if _, err := r.AddDomain(context.Background(), "acme.com"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./maildomains/ -run TestAddDomain -v`
Expected: FAIL — `undefined: NewPostmarkRegistrar`.

- [ ] **Step 3: Write minimal implementation**

Create `tinycld/core/server/maildomains/postmark.go`:

```go
package maildomains

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/mrz1836/postmark"
)

// ErrDomainAlreadyEnrolled means the provider account already has this domain.
// On a shared hosting account that is the normal collision between two orgs
// claiming the same name, so it is a distinct error the caller can phrase as
// "already configured on this host" rather than surfacing a raw 422.
var ErrDomainAlreadyEnrolled = errors.New("maildomains: domain already enrolled on this provider account")

// ErrDomainNotEnrolled means the account has never heard of the domain — the
// state every domain is in before AddDomain runs.
var ErrDomainNotEnrolled = errors.New("maildomains: domain not enrolled with the provider")

// domainListLimit bounds the domain listing Postmark pages over.
const domainListLimit = 100

// PostmarkDomains is the slice of the Postmark client this registrar needs.
// Every method on it is an ACCOUNT-token call (postmark/domains.go), which is
// the entire reason this seam exists.
type PostmarkDomains interface {
	CreateDomain(ctx context.Context, req postmark.DomainCreateRequest) (postmark.DomainDetails, error)
	GetDomains(ctx context.Context, count, offset int) (postmark.DomainsList, error)
	GetDomain(ctx context.Context, domainID int64) (postmark.DomainDetails, error)
}

// PostmarkRegistrar is the DIRECT implementation: it holds the account token
// and calls Postmark in-process. This is the standalone path, where the
// deployment legitimately owns its own account.
type PostmarkRegistrar struct {
	accountToken string
	client       PostmarkDomains
}

// NewPostmarkRegistrar builds the direct registrar. An empty accountToken
// yields one that reports ErrNotConfigured rather than failing at the API.
func NewPostmarkRegistrar(accountToken string, client PostmarkDomains) *PostmarkRegistrar {
	return &PostmarkRegistrar{accountToken: strings.TrimSpace(accountToken), client: client}
}

func (p *PostmarkRegistrar) AddDomain(ctx context.Context, domain string) (*DomainRecords, error) {
	if p.accountToken == "" {
		return nil, ErrNotConfigured
	}
	details, err := p.client.CreateDomain(ctx, postmark.DomainCreateRequest{Name: domain})
	if err != nil {
		if isAlreadyExists(err) {
			return nil, fmt.Errorf("%w: %s", ErrDomainAlreadyEnrolled, domain)
		}
		return nil, fmt.Errorf("postmark create domain: %w", err)
	}
	return toDomainRecords(details), nil
}

func (p *PostmarkRegistrar) GetDomain(ctx context.Context, domain string) (*DomainRecords, error) {
	if p.accountToken == "" {
		return nil, ErrNotConfigured
	}
	list, err := p.client.GetDomains(ctx, domainListLimit, 0)
	if err != nil {
		return nil, fmt.Errorf("postmark list domains: %w", err)
	}
	for _, d := range list.Domains {
		if !strings.EqualFold(d.Name, domain) {
			continue
		}
		details, err := p.client.GetDomain(ctx, d.ID)
		if err != nil {
			return nil, fmt.Errorf("postmark get domain: %w", err)
		}
		return toDomainRecords(details), nil
	}
	return nil, fmt.Errorf("%w: %s", ErrDomainNotEnrolled, domain)
}

// isAlreadyExists recognises Postmark's duplicate-name refusal. Matched on the
// message as well as the code because the code is not documented as stable,
// and misclassifying a duplicate as a generic failure would show an operator a
// raw provider string.
func isAlreadyExists(err error) bool {
	var apiErr postmark.APIError
	if errors.As(err, &apiErr) {
		return strings.Contains(strings.ToLower(apiErr.Message), "already exists")
	}
	return false
}

func toDomainRecords(d postmark.DomainDetails) *DomainRecords {
	return &DomainRecords{
		Domain:               d.Name,
		ID:                   d.ID,
		SPFVerified:          d.SPFVerified,
		DKIMVerified:         d.DKIMVerified,
		ReturnPathVerified:   d.ReturnPathDomainVerified,
		DKIMHost:             d.DKIMHost,
		DKIMTextValue:        d.DKIMTextValue,
		ReturnPathDomain:     d.ReturnPathDomain,
		ReturnPathCNAMEValue: d.ReturnPathDomainCNAMEValue,
	}
}
```

- [ ] **Step 2b: Verify the postmark API surface matches**

Before running, confirm the fake's method signatures match the real client. Run:

```bash
grep -n "func (client \*Client) \(CreateDomain\|GetDomains\|GetDomain\)" \
  /Users/nas/code/vendor/go/pkg/mod/github.com/mrz1836/postmark@v1.9.0/domains.go
grep -n "type APIError\|ErrorCode\|Message" \
  /Users/nas/code/vendor/go/pkg/mod/github.com/mrz1836/postmark@v1.9.0/postmark.go | head
```

If `Domain`, `DomainsList`, `DomainDetails` or `APIError` differ from what the test assumes, adjust the test and the interface to the real names — do not add a shim.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./maildomains/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/maildomains/postmark.go core/server/maildomains/postmark_test.go
git commit -m "feat(core): add the direct Postmark registrar

Keeps the DKIM and return-path record values that the old checkOutbound
fetched and threw away. Duplicate enrollment is a distinct error because
on a shared hosting account it is the ordinary collision between two orgs
claiming one domain."
```

---

## Task 4: Wire core's standalone path

**Files:**
- Modify: `tinycld/core/server/coreserver/system_config.go:160` (beside the existing `syscfg.SetResolver`)
- Test: `tinycld/core/server/coreserver/maildomains_wiring_test.go` (create)

**Interfaces:**
- Consumes: `maildomains.SetResolver`, `NewPostmarkRegistrar`, `NewTokenResolver`, `IsClaimed` (Tasks 1–3); `syscfg.Get`.
- Produces: a standalone deployment whose `maildomains.Current()` is a `*PostmarkRegistrar` built from `mail.postmark_account_token`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/server/coreserver/maildomains_wiring_test.go`:

```go
package coreserver

import (
	"testing"

	"tinycld.org/core/maildomains"
	"tinycld.org/core/syscfg"
)

// Standalone: the deployment's own account token wires the direct registrar.
func TestMailDomainsWiredFromSettings(t *testing.T) {
	maildomains.ResetForTesting()
	syscfg.ResetForTesting()
	t.Cleanup(maildomains.ResetForTesting)
	t.Cleanup(syscfg.ResetForTesting)

	syscfg.SetResolver(func(key string) string {
		if key == "mail.postmark_account_token" {
			return "acct-token"
		}
		return ""
	})
	wireMailDomains()

	if _, ok := maildomains.Current().(*maildomains.PostmarkRegistrar); !ok {
		t.Fatalf("Current() = %T, want *maildomains.PostmarkRegistrar", maildomains.Current())
	}
}

// A supervising composition already claimed the seam: core must not reclaim
// it. This is the security property, tested at the wiring level rather than
// trusting the seam alone.
func TestMailDomainsWiringRespectsClaim(t *testing.T) {
	maildomains.ResetForTesting()
	syscfg.ResetForTesting()
	t.Cleanup(maildomains.ResetForTesting)
	t.Cleanup(syscfg.ResetForTesting)

	claimed := stubClaimedRegistrar{}
	maildomains.SetRegistrar(claimed)

	syscfg.SetResolver(func(string) string { return "acct-token" })
	wireMailDomains()

	if _, ok := maildomains.Current().(stubClaimedRegistrar); !ok {
		t.Fatalf("Current() = %T, want the supervisor's registrar to survive core wiring", maildomains.Current())
	}
}
```

Add the stub at the bottom of the same file:

```go
type stubClaimedRegistrar struct{}

func (stubClaimedRegistrar) AddDomain(context.Context, string) (*maildomains.DomainRecords, error) {
	return nil, nil
}
func (stubClaimedRegistrar) GetDomain(context.Context, string) (*maildomains.DomainRecords, error) {
	return nil, nil
}
```

(Add `"context"` to the import block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./coreserver/ -run TestMailDomains -v`
Expected: FAIL — `undefined: wireMailDomains`.

- [ ] **Step 3: Write minimal implementation**

In `tinycld/core/server/coreserver/system_config.go`, add below the existing `syscfg.SetResolver(systemConfig.Get)` at line 160:

```go
	wireMailDomains()
```

Then add the function at the end of the same file:

```go
// wireMailDomains points the maildomains seam at this deployment's own
// Postmark account — the standalone shape, where the deployment holds its own
// account token.
//
// A no-op once a supervising composition has claimed the seam. Core's wiring
// runs after a supervisor's, and reclaiming would hand a tenant the account
// credentials the supervisor exists to keep from it. SetResolver enforces this
// itself; the early return is so we do not build a client we will discard.
func wireMailDomains() {
	if maildomains.IsClaimed() {
		return
	}
	accountToken := syscfg.Get("mail.postmark_account_token")
	client := postmark.NewClient(syscfg.Get("mail.postmark_server_token"), accountToken)
	maildomains.SetResolver(maildomains.NewPostmarkRegistrar(accountToken, client))
}
```

Add to the imports of `system_config.go`:

```go
	"github.com/mrz1836/postmark"

	"tinycld.org/core/maildomains"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./coreserver/ -run TestMailDomains -v && go test ./maildomains/ ./coreserver/`
Expected: PASS.

- [ ] **Step 5: Verify core isolation still holds**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run check:core-isolation`
Expected: PASS — `maildomains` names a capability, not a package. If this fails, the new code named a feature slug; rename rather than adding to the allowlist (the allowlist is a shrinking debt register).

- [ ] **Step 6: Commit**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/coreserver/system_config.go core/server/coreserver/maildomains_wiring_test.go
git commit -m "feat(core): wire the standalone maildomains registrar

Points the seam at the deployment's own Postmark account, and stays a
no-op once a supervising composition has claimed it."
```

---

## Task 5: Router-side Postmark calls + ctl.sock routes

**Files:**
- Create: `hosting/internal/controlplane/maildomains.go`
- Create: `hosting/internal/controlplane/maildomains_test.go`
- Modify: `hosting/internal/controlplane/deploy.go` (the `mux` built in `Handler`, ~line 802)

**Interfaces:**
- Consumes: `maildomains.DomainRecords`, `NewPostmarkRegistrar`, `ErrDomainAlreadyEnrolled`, `ErrDomainNotEnrolled`, `ErrNotConfigured` (Tasks 1, 3).
- Produces: `POST /api/v1/maildomain/add` and `POST /api/v1/maildomain/status` on ctl.sock, each taking `{"domain":"<fqdn>"}` and returning a `DomainRecords` JSON body; `(*Deployer).mailDomainRegistrar() maildomains.Registrar`.

- [ ] **Step 1: Write the failing test**

Create `hosting/internal/controlplane/maildomains_test.go`:

```go
package controlplane

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The two routes exist on the ctl.sock mux and round-trip a domain.
func TestCtlMailDomainAdd(t *testing.T) {
	app := newTestApp(t)
	d := newTestDeployerWithStubPostmark(t, app)

	h := d.Handler("acme")
	req := httptest.NewRequest("POST", "/api/v1/maildomain/add", strings.NewReader(`{"domain":"acme.com"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["dkim_host"] == "" || got["dkim_text_value"] == "" {
		t.Errorf("response must carry the DNS records, got %v", got)
	}
}

// A malformed body is a 400, not a panic.
func TestCtlMailDomainRejectsBadBody(t *testing.T) {
	app := newTestApp(t)
	d := newTestDeployerWithStubPostmark(t, app)

	h := d.Handler("acme")
	req := httptest.NewRequest("POST", "/api/v1/maildomain/add", strings.NewReader(`{`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// An empty domain is refused before it reaches Postmark.
func TestCtlMailDomainRejectsEmptyDomain(t *testing.T) {
	app := newTestApp(t)
	d := newTestDeployerWithStubPostmark(t, app)

	h := d.Handler("acme")
	req := httptest.NewRequest("POST", "/api/v1/maildomain/status", strings.NewReader(`{"domain":"  "}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// Duplicate enrollment maps to 409 so the tenant can phrase it as a
// host-level collision rather than showing a raw provider error.
func TestCtlMailDomainDuplicateIs409(t *testing.T) {
	app := newTestApp(t)
	d := newTestDeployerWithDuplicatePostmark(t, app)

	h := d.Handler("acme")
	req := httptest.NewRequest("POST", "/api/v1/maildomain/add", strings.NewReader(`{"domain":"taken.com"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
}
```

Write the two helpers in the same file. Model `newTestApp` on the existing helper in `hosting/internal/controlplane/` (see `schema_test.go` / `integration_test.go`); build the `Deployer` the way the existing ctl.sock tests in `deploy_test.go` do, then set its registrar field to a stub implementing `maildomains.Registrar` — one returning populated `DomainRecords`, one returning `ErrDomainAlreadyEnrolled`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./internal/controlplane/ -run TestCtlMailDomain -v`
Expected: FAIL — the routes 404, and the helpers are undefined.

- [ ] **Step 3: Write minimal implementation**

Create `hosting/internal/controlplane/maildomains.go`:

```go
package controlplane

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/mrz1836/postmark"

	"tinycld.org/core/maildomains"
)

// mailDomainRequest is the ctl.sock request body for both routes.
type mailDomainRequest struct {
	Domain string `json:"domain"`
}

// mailDomainRegistrar builds the registrar from the operator's account token.
//
// The token is read from control_settings.system_config — the ROUTER's store —
// and never travels to a tenant. This function is the only place in the
// hosted composition that holds it.
func (d *Deployer) mailDomainRegistrar() maildomains.Registrar {
	if d.registrar != nil {
		return d.registrar
	}
	cfg, err := LoadSystemConfig(d.app)
	if err != nil {
		return nil
	}
	accountToken := cfg.Values["mail.postmark_account_token"]
	client := postmark.NewClient(cfg.Values["mail.postmark_server_token"], accountToken)
	return maildomains.NewPostmarkRegistrar(accountToken, client)
}

// decodeMailDomain reads and validates the request body. An empty domain is
// refused here rather than at the provider: it is the shape a tenant bug
// produces, and the provider's error for it is unhelpful.
func decodeMailDomain(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req mailDomainRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		writeCtlJSON(w, http.StatusBadRequest, map[string]any{"error": "malformed request body"})
		return "", false
	}
	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	if domain == "" {
		writeCtlJSON(w, http.StatusBadRequest, map[string]any{"error": "domain is required"})
		return "", false
	}
	return domain, true
}

// writeMailDomainResult maps registrar outcomes onto ctl.sock status codes.
//
// The mapping matters: a duplicate is the ordinary collision between two orgs
// on one provider account, and the tenant renders it as "already configured on
// this host". Letting it fall through as a 500 would show an operator-facing
// provider string to an org admin.
func writeMailDomainResult(w http.ResponseWriter, rec *maildomains.DomainRecords, err error) {
	switch {
	case errors.Is(err, maildomains.ErrDomainAlreadyEnrolled):
		writeCtlJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
	case errors.Is(err, maildomains.ErrDomainNotEnrolled):
		writeCtlJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
	case errors.Is(err, maildomains.ErrNotConfigured):
		writeCtlJSON(w, http.StatusServiceUnavailable, map[string]any{"error": err.Error()})
	case err != nil:
		writeCtlJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
	default:
		writeCtlJSON(w, http.StatusOK, rec)
	}
}

// registerMailDomainRoutes mounts the two account-token operations on the
// per-org ctl.sock mux.
//
// No authorization check is needed or wanted beyond the socket itself: the
// 0700 tenant-uid directory already proves which org is calling, and the
// router is a CREDENTIAL PROXY here, not a policy checkpoint. Orgs create their
// own mail domains freely; the router is involved only because the account
// token cannot live in a tenant.
func (d *Deployer) registerMailDomainRoutes(mux *http.ServeMux, slug string) {
	mux.HandleFunc("POST /api/v1/maildomain/add", func(w http.ResponseWriter, r *http.Request) {
		domain, ok := decodeMailDomain(w, r)
		if !ok {
			return
		}
		reg := d.mailDomainRegistrar()
		if reg == nil {
			writeCtlJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mail domain provisioning is not configured"})
			return
		}
		rec, err := reg.AddDomain(r.Context(), domain)
		if err != nil {
			d.log.Warn("mail domain enrollment failed", "slug", slug, "domain", domain, "error", err)
		}
		writeMailDomainResult(w, rec, err)
	})

	mux.HandleFunc("POST /api/v1/maildomain/status", func(w http.ResponseWriter, r *http.Request) {
		domain, ok := decodeMailDomain(w, r)
		if !ok {
			return
		}
		reg := d.mailDomainRegistrar()
		if reg == nil {
			writeCtlJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mail domain provisioning is not configured"})
			return
		}
		rec, err := reg.GetDomain(r.Context(), domain)
		writeMailDomainResult(w, rec, err)
	})
}
```

In `hosting/internal/controlplane/deploy.go`, add a field to the `Deployer` struct (for test injection):

```go
	// registrar overrides the Postmark-backed registrar. Set only by tests.
	registrar maildomains.Registrar
```

and call the registration right after the `mux := http.NewServeMux()` line in `Handler`:

```go
	d.registerMailDomainRoutes(mux, slug)
```

Confirm the real helper name for reading system config (the plan assumes `LoadSystemConfig(d.app)`); check `systemconfig.go` and use whatever it actually exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./internal/controlplane/ -run TestCtlMailDomain -v`
Expected: PASS — all four tests.

- [ ] **Step 5: Run the full hosting suite**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./...`
Expected: PASS. Fix any failure at its root cause — never by skipping or re-running.

- [ ] **Step 6: Commit**

```bash
cd /Users/nas/code/tinycld/hosting
git checkout -b feat/delegated-mail-domain-provisioning
git add internal/controlplane/maildomains.go internal/controlplane/maildomains_test.go internal/controlplane/deploy.go
git commit -m "feat(hosting): serve mail-domain provisioning on ctl.sock

The router holds the Postmark account token and makes the account-level
calls on a tenant's behalf. Authentication is the socket's 0700
tenant-uid directory, as for deploy proposals — no token is minted.
A credential proxy, not a policy checkpoint: orgs still create their own
domains freely."
```

---

## Task 6: Keep the account token out of tenants

**Files:**
- Modify: `hosting/internal/controlplane/systemconfig.go`
- Test: `hosting/internal/controlplane/systemconfig_test.go` (add cases)

**Interfaces:**
- Consumes: the existing `syscfg.Config` push path.
- Produces: `tenantSyscfg(cfg syscfg.Config) syscfg.Config` — the filtered config actually materialized and pushed.

- [ ] **Step 1: Write the failing test**

Add to `hosting/internal/controlplane/systemconfig_test.go`:

```go
// THE invariant this whole design exists to protect: the account token can
// enumerate, modify and delete every domain on the provider account, so it
// must never reach a tenant by any path — not the materialized syscfg.json,
// not a cfg.sock push. Tested directly rather than inferred from the filter.
func TestAccountTokenNeverReachesTenant(t *testing.T) {
	cfg := syscfg.Config{
		Values: map[string]string{
			"mail.provider":               "postmark",
			"mail.postmark_server_token":  "server-tok",
			"mail.postmark_account_token": "ACCOUNT-SECRET",
		},
		ManagedPrefixes: []string{"mail.provider", "mail.postmark_", "mail.smtp_"},
	}

	got := tenantSyscfg(cfg)

	if _, present := got.Values["mail.postmark_account_token"]; present {
		t.Fatal("account token must be filtered out of the tenant config")
	}
	for k, v := range got.Values {
		if v == "ACCOUNT-SECRET" {
			t.Fatalf("account token leaked under key %q", k)
		}
	}
	if got.Values["mail.postmark_server_token"] != "server-tok" {
		t.Error("the server token must still reach tenants")
	}
	if got.Values["mail.provider"] != "postmark" {
		t.Error("unrelated mail keys must be untouched")
	}
}

// The managed prefix must survive the filter: it is what stops an org setting
// its own account token in its settings collection. Dropping it along with the
// value would hand the namespace back.
func TestAccountTokenNamespaceStaysManaged(t *testing.T) {
	cfg := syscfg.Config{
		Values:          map[string]string{"mail.postmark_account_token": "SECRET"},
		ManagedPrefixes: []string{"mail.postmark_"},
	}

	got := tenantSyscfg(cfg)

	if len(got.ManagedPrefixes) != 1 || got.ManagedPrefixes[0] != "mail.postmark_" {
		t.Fatalf("ManagedPrefixes = %v, want the prefix preserved", got.ManagedPrefixes)
	}
}

// Filtering must not mutate the caller's config — the router keeps using it
// for its own Postmark calls.
func TestTenantSyscfgDoesNotMutateInput(t *testing.T) {
	cfg := syscfg.Config{Values: map[string]string{"mail.postmark_account_token": "SECRET"}}

	_ = tenantSyscfg(cfg)

	if cfg.Values["mail.postmark_account_token"] != "SECRET" {
		t.Fatal("tenantSyscfg must not mutate its input; the router still needs the token")
	}
}
```

Add `"tinycld.org/hosting/syscfg"` to the test imports if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./internal/controlplane/ -run TestAccountToken -v`
Expected: FAIL — `undefined: tenantSyscfg`.

- [ ] **Step 3: Write minimal implementation**

Add to `hosting/internal/controlplane/systemconfig.go`:

```go
// routerOnlyKeys are operator values the ROUTER acts on directly and that must
// never be materialized into a tenant or pushed over cfg.sock.
//
// The Postmark account token is the whole reason the maildomains seam exists:
// it can enumerate, modify and delete every domain on the account, so an org
// holding it could reach every sibling org's mail. The router makes those calls
// itself over ctl.sock instead.
var routerOnlyKeys = map[string]struct{}{
	"mail.postmark_account_token": {},
}

// tenantSyscfg is the view of the operator's config a tenant may see.
//
// Returns a copy: the router keeps using the full config for its own provider
// calls, so filtering in place would disarm the router a moment after arming
// the tenant.
//
// ManagedPrefixes is copied through UNFILTERED on purpose. A namespace stays
// managed even when its value is withheld — dropping the prefix alongside the
// value would hand the org back the right to set its own account token in its
// settings collection, which is exactly what this filter is preventing.
func tenantSyscfg(cfg syscfg.Config) syscfg.Config {
	out := syscfg.Config{
		Values:          make(map[string]string, len(cfg.Values)),
		ManagedPrefixes: cfg.ManagedPrefixes,
	}
	for k, v := range cfg.Values {
		if _, routerOnly := routerOnlyKeys[k]; routerOnly {
			continue
		}
		out.Values[k] = v
	}
	return out
}
```

Then route both tenant-bound paths through it. Find every place the config is handed to a tenant and wrap it:

```bash
cd /Users/nas/code/tinycld/hosting
grep -rn "PushSyscfgAll\|writeSyscfgConfig" --include="*.go" . | grep -v _test
```

At each call site that passes a `syscfg.Config` toward a tenant — the `PushSyscfgAll` call in `systemconfig.go`, and `writeSyscfgConfig` in `internal/orgmanager/manager.go:1341` — pass `tenantSyscfg(cfg)` instead of `cfg`. If `writeSyscfgConfig` lives in `orgmanager` and cannot import `controlplane`, move `tenantSyscfg` and `routerOnlyKeys` into the `syscfg` package itself (`hosting/syscfg/config.go`) and call it from both — that is the better home anyway, since it is a property of the config type.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./internal/controlplane/ ./internal/orgmanager/ ./syscfg/ -v -run 'Syscfg|AccountToken|TenantSyscfg'`
Expected: PASS.

- [ ] **Step 5: Run the full hosting suite**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./...`
Expected: PASS.

- [ ] **Step 6: Update the operator docs**

In `hosting/README.md`, the "Fleet service configuration" section (~line 265) shows an example `values` payload. Update it to show `mail.postmark_account_token` and note that the account token stays router-side: it is used for domain provisioning over ctl.sock and is never materialized into a tenant, while the server token is derived from it when not set explicitly.

- [ ] **Step 7: Commit**

```bash
cd /Users/nas/code/tinycld/hosting
git add internal/controlplane/systemconfig.go internal/controlplane/systemconfig_test.go internal/orgmanager/manager.go syscfg/ README.md
git commit -m "fix(hosting): never materialize the Postmark account token into a tenant

The account token reaches every domain on the provider account, so a
tenant holding it reaches every sibling org's mail. Filtered out of both
tenant-bound paths — the materialized syscfg.json and the cfg.sock push
— while its managed prefix is preserved so no org can set its own."
```

---

## Task 7: The delegating registrar + tenant wiring

**Files:**
- Create: `hosting/maildomains/registrar.go`
- Create: `hosting/maildomains/registrar_test.go`
- Modify: `hosting/tenantboot/register.go`

**Interfaces:**
- Consumes: `maildomains.Registrar`, `DomainRecords`, `ErrDomainAlreadyEnrolled`, `ErrDomainNotEnrolled`, `ErrNotConfigured` (Tasks 1, 3); the ctl.sock routes (Task 5).
- Produces: `NewCtlRegistrar(socketPath string) *CtlRegistrar` satisfying `maildomains.Registrar`.

- [ ] **Step 1: Write the failing test**

Create `hosting/maildomains/registrar_test.go`:

```go
package maildomains

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	coremd "tinycld.org/core/maildomains"
)

// serveCtl stands up a unix-socket HTTP server, as the router does.
func serveCtl(t *testing.T, h http.Handler) string {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "ctl.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: h}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		_ = srv.Close()
		_ = os.Remove(sock)
	})
	return sock
}

func TestCtlRegistrarAddRoundTrips(t *testing.T) {
	sock := serveCtl(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/maildomain/add" {
			t.Errorf("path = %q", r.URL.Path)
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["domain"] != "acme.com" {
			t.Errorf("domain = %q", body["domain"])
		}
		_ = json.NewEncoder(w).Encode(coremd.DomainRecords{
			Domain: "acme.com", ID: 7, DKIMHost: "sel._domainkey.acme.com", DKIMTextValue: "k=rsa;p=X",
		})
	}))

	rec, err := NewCtlRegistrar(sock).AddDomain(context.Background(), "acme.com")
	if err != nil {
		t.Fatalf("AddDomain: %v", err)
	}
	if rec.DKIMHost == "" || rec.ID != 7 {
		t.Fatalf("rec = %+v, want the records to survive the round trip", rec)
	}
}

// The router's 409 must arrive as a typed error so the UI can phrase it.
func TestCtlRegistrarMapsConflict(t *testing.T) {
	sock := serveCtl(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "already enrolled"})
	}))

	_, err := NewCtlRegistrar(sock).AddDomain(context.Background(), "taken.com")
	if !errors.Is(err, coremd.ErrDomainAlreadyEnrolled) {
		t.Fatalf("err = %v, want ErrDomainAlreadyEnrolled", err)
	}
}

func TestCtlRegistrarMapsNotFound(t *testing.T) {
	sock := serveCtl(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "not enrolled"})
	}))

	_, err := NewCtlRegistrar(sock).GetDomain(context.Background(), "nope.com")
	if !errors.Is(err, coremd.ErrDomainNotEnrolled) {
		t.Fatalf("err = %v, want ErrDomainNotEnrolled", err)
	}
}

func TestCtlRegistrarMapsUnavailable(t *testing.T) {
	sock := serveCtl(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "not configured"})
	}))

	_, err := NewCtlRegistrar(sock).GetDomain(context.Background(), "acme.com")
	if !errors.Is(err, coremd.ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

// An unreachable socket is a transport failure, never silently "unverified":
// marking a working domain broken because the router was restarting would be
// worse than reporting the error.
func TestCtlRegistrarUnreachableSocketErrors(t *testing.T) {
	_, err := NewCtlRegistrar(filepath.Join(t.TempDir(), "absent.sock")).GetDomain(context.Background(), "acme.com")
	if err == nil {
		t.Fatal("want an error when the control socket is unreachable")
	}
	if errors.Is(err, coremd.ErrDomainNotEnrolled) {
		t.Fatal("a transport failure must not be reported as 'not enrolled'")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./maildomains/ -v`
Expected: FAIL — `undefined: NewCtlRegistrar`.

- [ ] **Step 3: Write minimal implementation**

Create `hosting/maildomains/registrar.go`:

```go
// Package maildomains is the TENANT side of mail-domain provisioning: it
// satisfies core's maildomains.Registrar by forwarding each call over the
// router-bound ctl.sock instead of holding a provider credential.
//
// This is the whole point of the seam. Every call in Postmark's Domains API is
// account-token authenticated, and that token reaches every domain on the
// account — so on a hosting deployment it cannot live in a tenant at any
// privilege. The operation travels to the router, which holds it.
//
// Authentication is the socket, exactly as for deploy proposals: ctl.sock
// lives in this org's 0700 tenant-uid directory, so the org's identity is
// implicit in which socket the request arrived on. Nothing is minted here and
// there is no token to leak.
package maildomains

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	coremd "tinycld.org/core/maildomains"
)

// ctlTimeout bounds a provisioning call. These are single provider API round
// trips on the router's side — generous, but far below the ctl server's own
// 30s write deadline so a hung provider surfaces as our error, not an EOF.
const ctlTimeout = 20 * time.Second

// CtlRegistrar forwards registrar calls over the control socket.
type CtlRegistrar struct {
	client *http.Client
}

// NewCtlRegistrar dials socketPath for every request.
func NewCtlRegistrar(socketPath string) *CtlRegistrar {
	return &CtlRegistrar{client: &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", socketPath)
			},
		},
		Timeout: ctlTimeout,
	}}
}

func (c *CtlRegistrar) AddDomain(ctx context.Context, domain string) (*coremd.DomainRecords, error) {
	return c.call(ctx, "/api/v1/maildomain/add", domain)
}

func (c *CtlRegistrar) GetDomain(ctx context.Context, domain string) (*coremd.DomainRecords, error) {
	return c.call(ctx, "/api/v1/maildomain/status", domain)
}

func (c *CtlRegistrar) call(ctx context.Context, path, domain string) (*coremd.DomainRecords, error) {
	body, err := json.Marshal(map[string]string{"domain": domain})
	if err != nil {
		return nil, err
	}
	// The host is ignored for a unix transport but must be syntactically valid.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://ctl"+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mail domain provisioning unavailable: %w", err)
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return nil, fmt.Errorf("read provisioning response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, statusError(resp.StatusCode, payload)
	}

	var rec coremd.DomainRecords
	if err := json.Unmarshal(payload, &rec); err != nil {
		return nil, fmt.Errorf("decode provisioning response: %w", err)
	}
	return &rec, nil
}

// statusError maps the router's status codes back onto the seam's typed
// errors, so a caller handles a delegated failure exactly as it would an
// in-process one. Without this the tenant would have to parse strings.
func statusError(code int, payload []byte) error {
	var body struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(payload, &body)
	msg := body.Error
	if msg == "" {
		msg = http.StatusText(code)
	}
	switch code {
	case http.StatusConflict:
		return fmt.Errorf("%w: %s", coremd.ErrDomainAlreadyEnrolled, msg)
	case http.StatusNotFound:
		return fmt.Errorf("%w: %s", coremd.ErrDomainNotEnrolled, msg)
	case http.StatusServiceUnavailable:
		return fmt.Errorf("%w: %s", coremd.ErrNotConfigured, msg)
	default:
		return fmt.Errorf("mail domain provisioning failed (%d): %s", code, msg)
	}
}

// The registrar IS core's Registrar. Asserted here so a signature drift in core
// fails this package's build rather than silently leaving a tenant unwired.
var _ coremd.Registrar = (*CtlRegistrar)(nil)
```

Now wire it in `hosting/tenantboot/register.go`. Beside the existing `coresyscfg.SetProvider(syscfgCache)` call (~line 181), add:

```go
	// Claim the mail-domain seam whenever we have a control socket. Claiming
	// is what stops core's own wiring pointing these operations at the org's
	// settings collection moments later — handing that org the account token
	// this package exists to keep out of its hands. Claimed even on a degraded
	// channel, for the same reason syscfg is: the correct degraded state is
	// "no domain provisioning", never "the org uses its own credentials".
	if opts.ControlSocket != "" {
		coremaildomains.SetRegistrar(maildomains.NewCtlRegistrar(opts.ControlSocket))
	}
```

Add the imports:

```go
	coremaildomains "tinycld.org/core/maildomains"

	"tinycld.org/hosting/maildomains"
```

Check the real field name on `TenantOptions` for the control socket (the plan assumes `ControlSocket`); read the struct at `tenantboot/register.go:51` and use the actual name.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./maildomains/ -v && go test ./tenantboot/`
Expected: PASS.

- [ ] **Step 5: Run the full hosting suite**

Run: `cd /Users/nas/code/tinycld/hosting && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/nas/code/tinycld/hosting
git add maildomains/ tenantboot/register.go
git commit -m "feat(hosting): delegate mail-domain provisioning from the tenant

Satisfies core's Registrar by forwarding over ctl.sock. Router status
codes map back onto the seam's typed errors so a delegated failure is
handled exactly like an in-process one, and a transport failure is never
reported as 'not enrolled'."
```

---

## Task 8: Move the mail package onto the seam

**Files:**
- Modify: `mail/server/provider.go` (remove two interface methods + `DomainVerification`)
- Modify: `mail/server/postmark.go` (remove `AddDomain`, `CheckDomainVerification`, `domainDetailsToVerification`)
- Modify: `mail/server/smtp_provider.go` (move its DNS checks to a registrar)
- Create: `mail/server/smtp_registrar.go`
- Modify: `mail/server/domain_verify.go` (`checkOutbound`)
- Modify: `mail/server/api/api.go` (widen `OutboundCheckResult`)
- Test: `mail/server/domain_verify_test.go` (update)

**Interfaces:**
- Consumes: `maildomains.Current()`, `DomainRecords`, `ErrNotConfigured`, `ErrDomainNotEnrolled` (Tasks 1, 3).
- Produces: `checkOutbound(ctx context.Context, domain string) api.OutboundCheckResult` (note: **the `provider` parameter is gone**); `api.OutboundCheckResult` gains `DKIMHost`, `DKIMTextValue`, `ReturnPathDomain`, `ReturnPathCNAMEValue`, `Enrolled string`; `NewSMTPRegistrar(cfg SMTPConfig) *SMTPRegistrar`.

- [ ] **Step 1: Write the failing test**

Add to `mail/server/domain_verify_test.go`:

```go
// The record values must survive into the wire type — they are what the admin
// publishes in DNS, and the old code fetched and discarded them.
func TestCheckOutboundCarriesRecords(t *testing.T) {
	maildomains.ResetForTesting()
	t.Cleanup(maildomains.ResetForTesting)
	maildomains.SetResolver(stubRegistrar{rec: &maildomains.DomainRecords{
		Domain: "acme.com", SPFVerified: true, DKIMVerified: true,
		DKIMHost: "sel._domainkey.acme.com", DKIMTextValue: "k=rsa;p=X",
		ReturnPathDomain: "pm-bounces.acme.com", ReturnPathCNAMEValue: "pm.mtasv.net",
	}})

	got := checkOutbound(context.Background(), "acme.com")

	if !got.SPF || !got.DKIM {
		t.Errorf("got = %+v, want SPF and DKIM true", got)
	}
	if got.DKIMHost != "sel._domainkey.acme.com" || got.DKIMTextValue != "k=rsa;p=X" {
		t.Errorf("DKIM record values missing: %+v", got)
	}
	if got.ReturnPathDomain != "pm-bounces.acme.com" || got.ReturnPathCNAMEValue != "pm.mtasv.net" {
		t.Errorf("return-path record values missing: %+v", got)
	}
	if got.Enrolled != "yes" {
		t.Errorf("Enrolled = %q, want %q", got.Enrolled, "yes")
	}
}

// A domain the provider has never heard of is reported as not enrolled, which
// is actionable, rather than as a generic error.
func TestCheckOutboundNotEnrolled(t *testing.T) {
	maildomains.ResetForTesting()
	t.Cleanup(maildomains.ResetForTesting)
	maildomains.SetResolver(stubRegistrar{err: maildomains.ErrDomainNotEnrolled})

	got := checkOutbound(context.Background(), "acme.com")

	if got.Enrolled != "no" {
		t.Fatalf("Enrolled = %q, want %q", got.Enrolled, "no")
	}
	if got.SPF || got.DKIM || got.ReturnPath {
		t.Error("an unenrolled domain must not report verified checks")
	}
}

// A transport or provider failure is UNKNOWN, not "no": the router being
// restarted must not make a working domain look unenrolled.
func TestCheckOutboundTransportFailureIsUnknown(t *testing.T) {
	maildomains.ResetForTesting()
	t.Cleanup(maildomains.ResetForTesting)
	maildomains.SetResolver(stubRegistrar{err: errors.New("socket closed")})

	got := checkOutbound(context.Background(), "acme.com")

	if got.Enrolled != "unknown" {
		t.Fatalf("Enrolled = %q, want %q", got.Enrolled, "unknown")
	}
	if got.Error == "" {
		t.Error("the failure reason must be carried")
	}
}
```

Add the stub to the same file:

```go
type stubRegistrar struct {
	rec *maildomains.DomainRecords
	err error
}

func (s stubRegistrar) AddDomain(context.Context, string) (*maildomains.DomainRecords, error) {
	return s.rec, s.err
}
func (s stubRegistrar) GetDomain(context.Context, string) (*maildomains.DomainRecords, error) {
	return s.rec, s.err
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/mail && go test ./server/ -run TestCheckOutbound -v`
Expected: FAIL — `checkOutbound` still takes a `provider`, and `OutboundCheckResult` has no record fields.

- [ ] **Step 3: Write minimal implementation**

**3a.** Widen the wire type in `mail/server/api/api.go`:

```go
// OutboundCheckResult reports outbound deliverability: whether the provider
// has the domain enrolled, whether SPF/DKIM/return-path verify, and the DNS
// records the admin must publish to make them verify.
type OutboundCheckResult struct {
	SPF        bool   `json:"spf"`
	DKIM       bool   `json:"dkim"`
	ReturnPath bool   `json:"return_path"`
	// Enrolled is "yes", "no" or "unknown". Three-valued because a check that
	// could not run must not look like a domain the provider rejected — the
	// UI phrases them differently and only "no" is the admin's to fix.
	Enrolled             string `json:"enrolled,omitempty"`
	DKIMHost             string `json:"dkim_host,omitempty"`
	DKIMTextValue        string `json:"dkim_text_value,omitempty"`
	ReturnPathDomain     string `json:"return_path_domain,omitempty"`
	ReturnPathCNAMEValue string `json:"return_path_cname_value,omitempty"`
	Error                string `json:"error,omitempty"`
}
```

**3b.** Rewrite `checkOutbound` in `mail/server/domain_verify.go`:

```go
// checkOutbound reads the domain's provider-side state through the maildomains
// seam. It does NOT take a Provider: these are account-credential operations,
// and on a hosted deployment they are performed by the router, not here.
//
// Failure stays best-effort — outbound never blocks the inbound verdict — but
// it is now three-valued. A provider that has never heard of the domain is the
// admin's problem ("no"); a socket or API failure is not ("unknown"), and
// conflating them would tell an admin to fix a domain that is fine.
func checkOutbound(ctx context.Context, domain string) api.OutboundCheckResult {
	result := api.OutboundCheckResult{}
	rec, err := maildomains.Current().GetDomain(ctx, domain)
	switch {
	case errors.Is(err, maildomains.ErrDomainNotEnrolled):
		result.Enrolled = "no"
		result.Error = err.Error()
		return result
	case err != nil:
		result.Enrolled = "unknown"
		result.Error = err.Error()
		return result
	}
	result.Enrolled = "yes"
	result.SPF = rec.SPFVerified
	result.DKIM = rec.DKIMVerified
	result.ReturnPath = rec.ReturnPathVerified
	result.DKIMHost = rec.DKIMHost
	result.DKIMTextValue = rec.DKIMTextValue
	result.ReturnPathDomain = rec.ReturnPathDomain
	result.ReturnPathCNAMEValue = rec.ReturnPathCNAMEValue
	return result
}
```

Update its caller in `verifyDomainRecord`:

```go
	details.Outbound = checkOutbound(ctx, domain)
```

And tighten the verdict on the line below `record.Set("verified", ...)`:

```go
	// A domain the provider has never enrolled cannot send at all, so it must
	// not show as verified. Previously `verified` was inbound-only, and an
	// unenrolled domain displayed a green badge while every send failed.
	// "unknown" is treated as not-disqualifying: a transport failure must not
	// flip a working domain to unverified.
	record.Set("verified", details.MX.OK && details.Provider.OK && details.Outbound.Enrolled != "no")
```

Add `"errors"` and `"tinycld.org/core/maildomains"` to the imports.

**3c.** Remove from `mail/server/provider.go` the two interface methods and the now-unused `DomainVerification` struct:

```go
	AddDomain(ctx context.Context, domain string) (*DomainVerification, error)
	CheckDomainVerification(ctx context.Context, domain string) (*DomainVerification, error)
```

**3d.** Remove from `mail/server/postmark.go`: `AddDomain`, `CheckDomainVerification`, `domainDetailsToVerification`. Keep `CheckInboundDomain` — it is a server-token call and stays in the tenant.

**3e.** Create `mail/server/smtp_registrar.go`, moving the pure-DNS checks out of `smtp_provider.go`:

```go
package mail

import (
	"context"

	"tinycld.org/core/maildomains"
)

// SMTPRegistrar is the self-hosted counterpart of the Postmark registrar.
//
// A self-hosted deployment enrolls nothing: the operator publishes their own
// DNS and there is no provider account to register with. So AddDomain is a
// no-op returning the current state, and "enrolled" is always true — which is
// what keeps the `verified` verdict unchanged for SMTP deployments.
type SMTPRegistrar struct {
	cfg SMTPConfig
}

func NewSMTPRegistrar(cfg SMTPConfig) *SMTPRegistrar {
	return &SMTPRegistrar{cfg: cfg}
}

func (s *SMTPRegistrar) AddDomain(ctx context.Context, domain string) (*maildomains.DomainRecords, error) {
	return s.GetDomain(ctx, domain)
}

// GetDomain runs the DNS checks directly — the logic moved verbatim from
// SMTPProvider.CheckDomainVerification, which needed no credentials.
func (s *SMTPRegistrar) GetDomain(_ context.Context, domain string) (*maildomains.DomainRecords, error) {
	spf, dkim, dmarc := checkSMTPDNS(domain, s.cfg.DKIMSelector)
	return &maildomains.DomainRecords{
		Domain:             domain,
		SPFVerified:        spf,
		DKIMVerified:       dkim,
		ReturnPathVerified: dmarc,
	}, nil
}
```

Extract the existing lookup body from `smtp_provider.go:194-225` into `checkSMTPDNS(domain, selector string) (spf, dkim, dmarc bool)` in that same file, and delete `SMTPProvider.AddDomain` and `SMTPProvider.CheckDomainVerification`.

**3f.** In `mail/server/register.go`, where `newProviderFromSystem` is defined (~line 435), register the SMTP registrar when the provider is smtp and the seam is unclaimed:

```go
	// A hosted composition has already claimed the seam with its delegating
	// registrar; SetResolver is a no-op there by design.
	if name == "smtp" {
		maildomains.SetResolver(NewSMTPRegistrar(smtpConfigFromSystem(app)))
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/mail && go test ./server/... -v`
Expected: PASS. Existing tests referencing the removed `Provider` methods must be updated to the seam — update them; do not delete coverage.

- [ ] **Step 5: Regenerate the TypeScript API types**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate`
Then confirm the new fields landed:

```bash
grep -n "dkim_host\|enrolled" /Users/nas/code/tinycld/tinycld/lib/generated/mail-api.ts
```

Expected: the widened `OutboundCheckResult` fields appear.

- [ ] **Step 6: Commit**

```bash
cd /Users/nas/code/tinycld/mail
git checkout -b feat/delegated-mail-domain-provisioning
git add server/ 
git commit -m "feat(mail): read outbound domain state through the maildomains seam

checkOutbound no longer takes a Provider: these are account-credential
operations and a hosted tenant cannot perform them. Keeps the DKIM and
return-path record values that were previously fetched and discarded.

Also fixes the verdict: a domain the provider never enrolled showed a
green Verified badge while every send failed. 'unknown' is deliberately
not disqualifying, so a transport failure cannot flip a working domain."
```

---

## Task 9: Enroll on add

**Files:**
- Create: `mail/server/endpoints_add_domain.go`
- Modify: `mail/server/register.go` (route registration, near line 274)
- Test: `mail/server/endpoints_add_domain_test.go`

**Interfaces:**
- Consumes: `maildomains.Current()`, `ErrDomainAlreadyEnrolled`, `ErrNotConfigured` (Tasks 1, 3); `verifyAdmin` (existing, `endpoints_verify_domain.go`).
- Produces: `POST /api/mail/domains` taking `{"domain":"<fqdn>"}` and returning `api.AddDomainResponse{ID, Domain, Records *api.OutboundCheckResult}`.

- [ ] **Step 1: Write the failing test**

Create `mail/server/endpoints_add_domain_test.go`:

```go
package mail

import (
	"net/http"
	"testing"
)

// Adding a domain enrolls it with the provider AND creates the row, so the
// DNS records exist before the admin is asked to publish anything.
func TestAddDomainEnrollsAndCreatesRecord(t *testing.T) {
	// Build the app + admin auth exactly as endpoints_verify_domain_test.go does.
	// Install a stubRegistrar (from domain_verify_test.go) returning records.
	// POST /api/mail/domains {"domain":"acme.com"} as an admin.
	// Assert: 200; a mail_domains row exists with domain "acme.com";
	//         the response carries dkim_host and dkim_text_value.
	t.Fatal("implement against the existing endpoint test harness")
}

// Non-admins cannot add a domain — same gate as verify.
func TestAddDomainRequiresAdmin(t *testing.T) {
	// POST as a plain member; assert 403 and that no row was created.
	t.Fatal("implement against the existing endpoint test harness")
}

// If enrollment fails, NO row is created: a row without provider enrollment is
// the silent half-broken state this whole change exists to remove.
func TestAddDomainDoesNotCreateRecordWhenEnrollmentFails(t *testing.T) {
	// Install a stubRegistrar returning maildomains.ErrDomainAlreadyEnrolled.
	// POST; assert 409 and that no mail_domains row exists.
	t.Fatal("implement against the existing endpoint test harness")
}
```

Read `mail/server/endpoints_verify_domain_test.go` first and mirror its app/auth setup, then replace each `t.Fatal` with the real assertions. The three test *names and intents* are fixed; the harness wiring follows the existing file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/mail && go test ./server/ -run TestAddDomain -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add to `mail/server/api/api.go`:

```go
// AddDomainResponse is returned by POST /api/mail/domains.
type AddDomainResponse struct {
	ID      string               `json:"id"`
	Domain  string               `json:"domain"`
	Records *OutboundCheckResult `json:"records,omitempty"`
}
```

Create `mail/server/endpoints_add_domain.go`:

```go
package mail

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/maildomains"
)

// handleAddDomain enrolls a domain with the mail provider and then creates the
// mail_domains row.
//
// Enrollment runs FIRST and a failure creates nothing. The previous flow was a
// bare client-side insert that never contacted the provider, which left rows
// the provider had never heard of: they displayed as verified and every send
// from them failed. A row that exists is now a row the provider knows.
//
// On a hosted deployment the enrollment call travels over ctl.sock to the
// router, which holds the account token. This handler cannot tell the
// difference, and must not be able to.
func handleAddDomain(app core.App) func(*core.RequestEvent) error {
	return func(re *core.RequestEvent) error {
		if err := verifyAdmin(re.Auth); err != nil {
			return re.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
		}

		var body struct {
			Domain string `json:"domain"`
		}
		if err := re.BindBody(&body); err != nil {
			return re.JSON(http.StatusBadRequest, map[string]string{"error": "malformed request body"})
		}
		domain := strings.ToLower(strings.TrimSpace(body.Domain))
		if domain == "" {
			return re.JSON(http.StatusBadRequest, map[string]string{"error": "domain is required"})
		}

		rec, err := maildomains.Current().AddDomain(re.Request.Context(), domain)
		switch {
		case errors.Is(err, maildomains.ErrDomainAlreadyEnrolled):
			return re.JSON(http.StatusConflict, map[string]string{
				"error": "That domain is already configured on this host.",
			})
		case errors.Is(err, maildomains.ErrNotConfigured):
			return re.JSON(http.StatusServiceUnavailable, map[string]string{
				"error": "Mail domain provisioning is not configured for this deployment.",
			})
		case err != nil:
			return re.JSON(http.StatusBadGateway, map[string]string{"error": err.Error()})
		}

		col, err := app.FindCollectionByNameOrId("mail_domains")
		if err != nil {
			return re.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		record := core.NewRecord(col)
		record.Set("domain", domain)
		record.Set("verified", false)
		record.Set("mx_verified", false)
		record.Set("inbound_domain_verified", false)
		record.Set("spf_verified", rec.SPFVerified)
		record.Set("dkim_verified", rec.DKIMVerified)
		record.Set("return_path_verified", rec.ReturnPathVerified)
		if err := app.Save(record); err != nil {
			return re.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}

		return re.JSON(http.StatusOK, api.AddDomainResponse{
			ID:     record.Id,
			Domain: domain,
			Records: &api.OutboundCheckResult{
				Enrolled:             "yes",
				SPF:                  rec.SPFVerified,
				DKIM:                 rec.DKIMVerified,
				ReturnPath:           rec.ReturnPathVerified,
				DKIMHost:             rec.DKIMHost,
				DKIMTextValue:        rec.DKIMTextValue,
				ReturnPathDomain:     rec.ReturnPathDomain,
				ReturnPathCNAMEValue: rec.ReturnPathCNAMEValue,
			},
		})
	}
}
```

Add the `api` import, and register the route in `mail/server/register.go` beside the existing verify route (~line 274):

```go
	se.Router.POST("/api/mail/domains", handleAddDomain(app))
```

Match the exact router-registration idiom used by the neighbouring routes in that file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/mail && go test ./server/... -v`
Expected: PASS.

- [ ] **Step 5: Regenerate types and commit**

```bash
cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate
cd /Users/nas/code/tinycld/mail
git add server/ 
git commit -m "feat(mail): enroll a domain with the provider when it is added

Adding a domain was a bare client-side insert that never contacted the
provider, leaving rows it had never heard of — they displayed as verified
while every send from them failed. Enrollment now runs first, and a
failure creates nothing."
```

---

## Task 10: Show the DNS records

**Files:**
- Create: `mail/tinycld/mail/settings/DnsRecordsPanel.tsx`
- Modify: `mail/tinycld/mail/settings/provider.tsx` (`AddDomainForm` ~line 560; `DomainVerificationPanel` ~line 458)
- Test: `mail/tests/dnsRecords.test.ts`

**Interfaces:**
- Consumes: `api.OutboundCheckResult` fields via the regenerated `@tinycld/app-generated/mail-api` (Task 8); `POST /api/mail/domains` (Task 9).
- Produces: `<DnsRecordsPanel details={details} isVisible={...} />`; `buildDnsRecords(outbound): DnsRecord[]` exported for unit test.

- [ ] **Step 1: Write the failing test**

Create `mail/tests/dnsRecords.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDnsRecords } from '~/tinycld/mail/settings/DnsRecordsPanel'

describe('buildDnsRecords', () => {
    it('returns the DKIM and return-path records to publish', () => {
        const records = buildDnsRecords({
            spf: false,
            dkim: false,
            return_path: false,
            enrolled: 'yes',
            dkim_host: 'sel._domainkey.acme.com',
            dkim_text_value: 'k=rsa;p=X',
            return_path_domain: 'pm-bounces.acme.com',
            return_path_cname_value: 'pm.mtasv.net',
        })

        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({
            type: 'TXT',
            host: 'sel._domainkey.acme.com',
            value: 'k=rsa;p=X',
            verified: false,
        })
        expect(records[1]).toMatchObject({
            type: 'CNAME',
            host: 'pm-bounces.acme.com',
            value: 'pm.mtasv.net',
            verified: false,
        })
    })

    it('marks a record verified once the provider confirms it', () => {
        const records = buildDnsRecords({
            spf: true,
            dkim: true,
            return_path: true,
            enrolled: 'yes',
            dkim_host: 'sel._domainkey.acme.com',
            dkim_text_value: 'k=rsa;p=X',
            return_path_domain: 'pm-bounces.acme.com',
            return_path_cname_value: 'pm.mtasv.net',
        })

        expect(records.every(r => r.verified)).toBe(true)
    })

    // A self-hosted SMTP deployment enrolls nothing and has no records to
    // show: the panel must render nothing rather than empty rows.
    it('returns nothing when the provider supplied no records', () => {
        expect(
            buildDnsRecords({ spf: false, dkim: false, return_path: false, enrolled: 'yes' })
        ).toEqual([])
    })

    it('returns nothing when there is no outbound result at all', () => {
        expect(buildDnsRecords(undefined)).toEqual([])
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/mail && pnpm exec tinycld-pkg test -- dnsRecords`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `mail/tinycld/mail/settings/DnsRecordsPanel.tsx`:

```tsx
import type { OutboundCheckResult } from '@tinycld/app-generated/mail-api'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useThemeColor } from '@tinycld/core/lib/use-theme-color'

export type DnsRecord = {
    label: string
    type: 'TXT' | 'CNAME'
    host: string
    value: string
    verified: boolean
}

// buildDnsRecords turns the provider's reported records into rows to publish.
// Exported for unit test: the mapping is the part worth pinning, not the JSX.
export function buildDnsRecords(outbound?: OutboundCheckResult): DnsRecord[] {
    if (!outbound) return []
    const records: DnsRecord[] = []
    if (outbound.dkim_host && outbound.dkim_text_value) {
        records.push({
            label: 'DKIM',
            type: 'TXT',
            host: outbound.dkim_host,
            value: outbound.dkim_text_value,
            verified: outbound.dkim,
        })
    }
    if (outbound.return_path_domain && outbound.return_path_cname_value) {
        records.push({
            label: 'Return-Path',
            type: 'CNAME',
            host: outbound.return_path_domain,
            value: outbound.return_path_cname_value,
            verified: outbound.return_path,
        })
    }
    return records
}

export function DnsRecordsPanel({
    outbound,
    isVisible,
}: {
    outbound?: OutboundCheckResult
    isVisible: boolean
}) {
    const records = buildDnsRecords(outbound)
    if (!isVisible || records.length === 0) return null

    return (
        <View className="gap-2 mt-2">
            <Text className="text-foreground" style={{ fontSize: 12, fontWeight: '600' }}>
                DNS records to publish
            </Text>
            {records.map(record => (
                <DnsRecordRow key={record.host} record={record} />
            ))}
        </View>
    )
}

function DnsRecordRow({ record }: { record: DnsRecord }) {
    const mutedColor = useThemeColor('muted-foreground')
    const successColor = useThemeColor('success')

    const copyValue = () => {
        void Clipboard.setStringAsync(record.value)
    }

    return (
        <View className="border border-border rounded p-2 gap-1">
            <View className="flex-row items-center gap-2">
                <Text className="text-foreground" style={{ fontSize: 11, fontWeight: '600' }}>
                    {record.label} ({record.type})
                </Text>
                {record.verified ? <Check size={12} color={successColor} /> : null}
            </View>
            <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                {record.host}
            </Text>
            <View className="flex-row items-center gap-2">
                <Text
                    className="text-foreground flex-1"
                    numberOfLines={1}
                    style={{ fontSize: 11, fontFamily: 'monospace' }}
                >
                    {record.value}
                </Text>
                <Pressable onPress={copyValue} accessibilityLabel={`Copy ${record.label} value`}>
                    <Copy size={14} color={mutedColor} />
                </Pressable>
            </View>
        </View>
    )
}
```

Check how `WebhookURLs` in `provider.tsx` does clipboard copy and reuse that exact idiom rather than importing a different one.

In `provider.tsx`, render the panel inside `DomainVerificationPanel` after the `CheckRow`s:

```tsx
            <DnsRecordsPanel outbound={details?.outbound} isVisible={!domain.verified} />
```

And change `AddDomainForm`'s mutation from the client-side insert to the endpoint:

```tsx
    const addMutation = useMutation({
        mutationFn: async (data: z.infer<typeof addDomainSchema>) =>
            pb.send('/api/mail/domains', { method: 'POST', body: { domain: data.domain } }),
        onSuccess: () => reset(),
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })
```

Use the same `pb.send` idiom the verify button already uses in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/mail && pnpm exec tinycld-pkg test -- dnsRecords`
Expected: PASS.

- [ ] **Step 5: Run the member's full checks**

Run: `cd /Users/nas/code/tinycld/mail && pnpm exec tinycld-pkg check`
Expected: biome + tsc + vitest all pass. Fix every warning at its source.

- [ ] **Step 6: Commit**

```bash
cd /Users/nas/code/tinycld/mail
git add tinycld/mail/settings/ tests/dnsRecords.test.ts
git commit -m "feat(mail): show the DNS records a domain needs

The provider reports the DKIM and return-path records and they were
discarded before reaching the client, so an admin had no way to learn
what to publish. Adding a domain now goes through the enroll endpoint
rather than inserting a row directly."
```

---

## Task 11: Help topic + end-to-end verification

**Files:**
- Modify: `mail/help/custom-domains.md`
- Create: `mail/tests/e2e/custom-domain.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new code interfaces.

- [ ] **Step 1: Correct the help topic**

`mail/help/custom-domains.md` currently documents a "View setup instructions" button that never existed and claims Postmark is called on add, which was false. Both are now true — rewrite those passages to describe the real flow: add the domain, the records appear, publish them in DNS, press Verify.

Keep the existing frontmatter (`title`, `summary`). Use Mac glyphs only for any shortcut. Never hand-author a hostname — write `{{server-host}}`.

- [ ] **Step 2: Write the e2e spec**

Create `mail/tests/e2e/custom-domain.spec.ts`. Follow `mail/tests/e2e/helpers.ts`: `login(page)`, then `navigateToPackage(page, 'mail')`, then sidebar clicks. **Never `page.goto()` for in-app navigation.** Drive the UI only — no raw PB writes.

The spec adds a domain through the form and asserts the DNS-records panel renders with a copyable value. Since a real Postmark account is not available in CI, stub the endpoint at the network layer with `page.route('**/api/mail/domains', …)` returning a fixture `AddDomainResponse` — this is a read-only interception of the tenant's own endpoint, not a data write, so it does not violate the "drive the UI" rule.

- [ ] **Step 3: Run the e2e spec**

Run: `cd /Users/nas/code/tinycld/mail && pnpm exec tinycld-pkg test:e2e -- custom-domain`
Expected: PASS. If it flakes, fix the root cause — never bump a timeout or force serial runs.

- [ ] **Step 4: Regenerate help and run every member's checks**

```bash
cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate
cd /Users/nas/code/tinycld/tinycld/core/server && go test ./...
cd /Users/nas/code/tinycld/hosting && go test ./...
cd /Users/nas/code/tinycld/mail && pnpm exec tinycld-pkg check
cd /Users/nas/code/tinycld && pnpm run checks
```

Expected: all pass. Fix every failure at its root cause.

- [ ] **Step 5: Commit**

```bash
cd /Users/nas/code/tinycld/mail
git add help/custom-domains.md tests/e2e/custom-domain.spec.ts
git commit -m "docs(mail): describe the real custom-domain flow

The topic documented a setup-instructions button that did not exist and
claimed the provider was called on add, which it was not. Both are now
true."
```

- [ ] **Step 6: Open the PRs in order**

Per `CLAUDE.md`, the core PR must merge first so the packages can resolve it.

```bash
cd /Users/nas/code/tinycld/tinycld && git push -u origin feat/delegated-mail-domain-provisioning && gh pr create --fill
# wait for the core PR to merge, then:
cd /Users/nas/code/tinycld/hosting && git push -u origin feat/delegated-mail-domain-provisioning && gh pr create --fill
cd /Users/nas/code/tinycld/mail && git push -u origin feat/delegated-mail-domain-provisioning && gh pr create --fill
```

Keep each PR description short. Do not mention Claude.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| The seam: `core/server/maildomains` | 1 |
| One key in, not two | 2 |
| Two implementations — direct | 3, 4 |
| Router side (ctl.sock routes) | 5 |
| Account token removed from tenant push | 6 |
| Two implementations — delegating | 7 |
| What stays in the tenant (`checkOutbound`) | 8 |
| Postmark account-level uniqueness | 3 (error), 5 (409), 7 (mapping), 9 (copy) |
| Surfacing the DNS records | 8 (persist/widen), 9 (enroll), 10 (display) |
| Known defect — `verified` verdict | 8 |
| Error handling | 5, 7, 8 |
| Testing — seam / router / boundary / parity / e2e | 1, 5, 6, 8, 11 |
| Help-topic drift | 11 |

**Gap found and closed:** the spec's "parity test" (one contract against both implementations) was only implicit. Tasks 3 and 7 test each implementation separately against the same typed errors, and Task 8's `checkOutbound` tests run against a stub satisfying the same interface — the contract is pinned at all three points. The SMTP registrar (Task 8, 3e) is the third implementation and is covered by the existing SMTP DNS tests.

**Placeholder scan:** Task 9's three tests are intentionally specified by name and assertion but delegate harness wiring to the existing `endpoints_verify_domain_test.go` — the fixtures there are long and repo-specific. Every other step carries runnable code.

**Type consistency:** `DomainRecords` field names are identical across Tasks 1, 3, 5, 7, 8, 9. `checkOutbound` drops its `provider` parameter in Task 8 and every caller is updated in the same task. `OutboundCheckResult` is widened once (Task 8) and consumed in Tasks 9 and 10 with matching snake_case JSON names. `Enrolled` is the three-valued string `"yes"|"no"|"unknown"` in Tasks 8, 9 and 10.
