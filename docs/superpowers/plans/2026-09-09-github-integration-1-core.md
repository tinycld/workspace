# GitHub Integration 1 — Core Webhook Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two provider-agnostic webhook layers in core — an outbound
`core:post-webhook` automation action and an inbound `webhookin` receiver — so
that boards' GitHub integration (plan 2) and the upcoming Zapier integration
both plug into shared, tested plumbing.

**Architecture:** Two independent additions to `tinycld/core/server/`. Outbound
is a native-in-core automation action modelled line-for-line on the adjacent
`actions_email.go`, sharing a new SSRF-guarded HTTP helper lifted from
`calendar/server/subscription.go`. Inbound is a new `webhookin` package that
verifies HMAC signatures, dedupes deliveries, rate-limits, and dispatches to
handlers that *packages* register at boot — core never names a package, and the
receiver never writes a domain row.

**Tech Stack:** Go 1.x, PocketBase v0.30+ (as a library), TypeScript for the
automation catalog, vitest for TS tests, `go test` for Go tests.

**Spec:** `docs/superpowers/specs/2026-09-09-github-integration-design.md`

## Global Constraints

- **Repo:** all work in this plan is in the `tinycld` repo (`~/code/tinycld/tinycld/`). Nothing here touches a feature sibling.
- **Branch:** `feat/github-integration` — the same name plan 2 uses in the `boards` repo (CLAUDE.md: cross-repo work shares a branch name).
- **Core must not name a package.** No feature slug, scope, collection name, or `/api/<slug>/` route may appear in `tinycld/core/**`. `pnpm run check:core-isolation` enforces this. The words "github", "boards" and "zapier" must not appear in any file created by this plan except as a *test* fixture using a fictional source name.
- **Never `console.*` in runtime code** — biome enforces it as an error. Go server code uses `logging.ForPackage(...)`.
- **Never use `any`** in TypeScript. Never add `biome-ignore` comments.
- **Biome style:** 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons.
- **Comments explain "why", not "what".**
- **Go logging:** `logging.ForPackage("core")` returns an `*slog.Logger`; prefer `*Context` variants when a `ctx` is in scope. No manual `"webhookin: "` message prefixes.
- **Checks:** `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg check` (biome + tsc + vitest). Go: `cd ~/code/tinycld/tinycld/core/server && go test ./...`.
- **A red check is never resolved by re-running it, bumping a timeout, or skipping it.** Diagnose the root cause and fix it at the source.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `core/server/safehttp/safehttp.go` | SSRF-guarded outbound HTTP: `IsDisallowedIP`, `ValidateURL`, `PinnedTransport`. No business logic. |
| `core/server/safehttp/safehttp_test.go` | Guard tests incl. redirect-to-internal. |
| `core/server/automation/actions_webhook.go` | The `core:post-webhook` native action: params, signing, per-rule rate ceiling. |
| `core/server/automation/actions_webhook_test.go` | Action tests. |
| `core/server/webhookin/webhookin.go` | Registry + `Source` type. Package-facing API. |
| `core/server/webhookin/receive.go` | The HTTP handler: signature verify, dedupe, rate-limit, dispatch. |
| `core/server/webhookin/webhookin_test.go` | Registry tests. |
| `core/server/webhookin/receive_test.go` | Handler tests. |
| `core/server/pb_migrations/1910000030_create_webhook_deliveries.js` | Dedupe ledger table. |

**Modified:**

| Path | Change |
|---|---|
| `core/lib/automation/core-defs.ts` | Declare the `post-webhook` action for the builder UI. |
| `core/lib/automation/__tests__/core-defs.test.ts:16` | `toEqual` list of action ids — **will fail** until updated. |
| `core/server/automation/register.go:51` | Call `registerCoreWebhookAction()`. |
| `core/server/coreserver/*` (route wiring) | Mount the `webhookin` route. Exact file located in Task 6. |

**Why `safehttp` is its own package:** both layers need it (outbound POSTs, and
future outbound retries), calendar will eventually be refactored onto it, and it
is pure network policy with no automation or PocketBase coupling. Keeping it
separate from `automation/` means its tests need no engine fixtures.

---

## Task 1: SSRF-guarded HTTP helper

Lift the guards from `calendar/server/subscription.go` into core so both webhook
directions share one implementation. That code is already thorough — loopback,
RFC 1918, IPv6 ULA, link-local incl. cloud metadata, CGNAT — and it re-resolves
at dial time and dials the verified IP, closing the DNS-rebinding window a
standalone pre-check leaves open.

**Files:**
- Create: `~/code/tinycld/tinycld/core/server/safehttp/safehttp.go`
- Test: `~/code/tinycld/tinycld/core/server/safehttp/safehttp_test.go`
- Read for reference: `~/code/tinycld/calendar/server/subscription.go:372-500`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `func IsDisallowedIP(ip net.IP) bool`
  - `func ValidateURL(u *url.URL) error`
  - `func PinnedTransport() *http.Transport`
  - `func PostJSON(ctx context.Context, rawURL string, body []byte, headers map[string]string, timeout time.Duration) (int, error)`

- [ ] **Step 1: Read the source being lifted**

```bash
sed -n '370,505p' ~/code/tinycld/calendar/server/subscription.go
```

Note `isDisallowedIP`, `validateICSURL`, `newPinnedTransport`. You are copying
the guard logic verbatim and changing only: the exported names, the error
strings (drop "ICS"), and **no redirect following** (see Step 5).

- [ ] **Step 2: Write the failing test**

Create `~/code/tinycld/tinycld/core/server/safehttp/safehttp_test.go`:

```go
package safehttp

import (
	"net"
	"net/url"
	"testing"
)

func TestIsDisallowedIP_RejectsInternalRanges(t *testing.T) {
	for _, raw := range []string{
		"127.0.0.1",       // loopback
		"10.0.0.5",        // RFC 1918
		"172.16.0.1",      // RFC 1918
		"192.168.1.1",     // RFC 1918
		"169.254.169.254", // link-local — cloud metadata
		"100.64.0.1",      // CGNAT
		"::1",             // IPv6 loopback
		"fc00::1",         // IPv6 ULA
		"fe80::1",         // IPv6 link-local
		"0.0.0.0",         // unspecified
	} {
		ip := net.ParseIP(raw)
		if ip == nil {
			t.Fatalf("test bug: %q is not an IP", raw)
		}
		if !IsDisallowedIP(ip) {
			t.Errorf("IsDisallowedIP(%s) = false, want true", raw)
		}
	}
}

func TestIsDisallowedIP_AllowsPublic(t *testing.T) {
	for _, raw := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		ip := net.ParseIP(raw)
		if IsDisallowedIP(ip) {
			t.Errorf("IsDisallowedIP(%s) = true, want false", raw)
		}
	}
}

func TestValidateURL_RejectsNonHTTPSchemes(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd",
		"gopher://example.com/",
		"ftp://example.com/",
	} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("test bug: %v", err)
		}
		if err := ValidateURL(u); err == nil {
			t.Errorf("ValidateURL(%s) = nil, want an error", raw)
		}
	}
}

func TestValidateURL_RejectsInternalHost(t *testing.T) {
	u, _ := url.Parse("http://127.0.0.1:8090/hook")
	if err := ValidateURL(u); err == nil {
		t.Error("ValidateURL(loopback) = nil, want an error")
	}
}

func TestValidateURL_RejectsBlankHost(t *testing.T) {
	u, _ := url.Parse("http:///nohost")
	if err := ValidateURL(u); err == nil {
		t.Error("ValidateURL(blank host) = nil, want an error")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./safehttp/ -run TestIsDisallowedIP -v
```

Expected: FAIL — the package does not compile (`undefined: IsDisallowedIP`).

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/tinycld/core/server/safehttp/safehttp.go`:

```go
// Package safehttp makes outbound HTTP requests to caller-supplied URLs
// without becoming an SSRF vector.
//
// Lifted from calendar/server/subscription.go's ICS fetcher, which had these
// guards first. The logic is unchanged; what differs is that this package
// serves POSTs to user-authored webhook URLs, where two things matter more:
//
//   - REDIRECTS ARE NOT FOLLOWED. The ICS fetcher re-validates every hop,
//     which is right for a GET. A POST that follows a 302 re-sends its body
//     — and its signature header — to a host the caller never named.
//   - The body is a signed payload, so a redirect leaking it is a
//     confidentiality bug and not merely an access one.
package safehttp

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"
)

const dialTimeout = 10 * time.Second

// IsDisallowedIP reports whether an address is one we must never connect to
// on a caller's behalf: loopback, RFC 1918 private, IPv6 ULA (fc00::/7),
// link-local (IPv4 169.254.0.0/16 — including cloud metadata at
// 169.254.169.254 — and IPv6 fe80::/10), CGNAT (100.64.0.0/10), unspecified,
// and multicast.
func IsDisallowedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() {
		return true
	}
	// CGNAT: 100.64.0.0/10. Not covered by IsPrivate.
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
	}
	return false
}

// ValidateURL rejects a URL we must not fetch: a non-HTTP scheme, a missing
// host, a host that will not resolve, or a host ANY of whose addresses is
// internal. Rejecting on any address (rather than all) means a name resolving
// to both a public and a private address cannot be used to reach the private
// one.
func ValidateURL(u *url.URL) error {
	if u == nil {
		return fmt.Errorf("no URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported URL scheme %q", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("invalid host")
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return fmt.Errorf("cannot resolve host")
	}
	for _, ip := range ips {
		if IsDisallowedIP(ip) {
			return fmt.Errorf("private/internal hosts are not allowed")
		}
	}
	return nil
}

// PinnedTransport returns a transport whose dialer re-resolves the hostname,
// verifies every returned address is public, and connects to a verified IP
// itself. Verifying and dialing the SAME resolution closes the DNS-rebinding
// window a standalone pre-check leaves open. TLS still handshakes against the
// original hostname, so certificate verification is unaffected.
func PinnedTransport() *http.Transport {
	return &http.Transport{
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: dialTimeout,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil || len(ips) == 0 {
				return nil, fmt.Errorf("cannot resolve host")
			}
			for _, ip := range ips {
				if IsDisallowedIP(ip) {
					return nil, fmt.Errorf("private/internal hosts are not allowed")
				}
			}
			dialer := &net.Dialer{Timeout: dialTimeout}
			var lastErr error
			for _, ip := range ips {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			return nil, lastErr
		},
	}
}

// PostJSON sends one JSON POST to a validated public URL and returns the
// response status. The body is read and discarded up to a small ceiling: a
// webhook's response is not data we consume, but draining lets the connection
// close cleanly.
//
// Redirects are refused rather than followed — see the package comment.
func PostJSON(
	ctx context.Context,
	rawURL string,
	body []byte,
	headers map[string]string,
	timeout time.Duration,
) (int, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return 0, fmt.Errorf("invalid URL: %w", err)
	}
	if err := ValidateURL(parsed); err != nil {
		return 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return 0, fmt.Errorf("invalid request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TinyCld/1.0")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout:   timeout,
		Transport: PinnedTransport(),
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return fmt.Errorf("redirects are not followed")
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	return resp.StatusCode, nil
}
```

- [ ] **Step 5: Add the redirect test**

Append to `safehttp_test.go`:

```go
func TestPostJSON_RefusesRedirect(t *testing.T) {
	// A public-looking endpoint that 302s to an internal address is the
	// SSRF shape a pre-check alone does not stop. We must refuse the hop
	// rather than re-validate it: following it would re-send the signed
	// body to a host the caller never named.
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	}))
	defer target.Close()

	// The test server listens on loopback, which ValidateURL rejects before
	// the redirect is ever reached — so drive the client directly to prove
	// the CheckRedirect policy, independent of the pre-check.
	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return fmt.Errorf("redirects are not followed")
		},
	}
	resp, err := client.Post(target.URL, "application/json", strings.NewReader("{}"))
	if err == nil {
		resp.Body.Close()
		t.Fatal("expected the redirect to be refused")
	}
	if !strings.Contains(err.Error(), "redirects are not followed") {
		t.Errorf("error = %v, want a redirect refusal", err)
	}
}

func TestPostJSON_RejectsInternalTargetBeforeDialing(t *testing.T) {
	_, err := PostJSON(context.Background(), "http://169.254.169.254/", []byte("{}"), nil, time.Second)
	if err == nil {
		t.Fatal("expected an SSRF rejection")
	}
	if !strings.Contains(err.Error(), "private/internal") {
		t.Errorf("error = %v, want a private/internal rejection", err)
	}
}
```

Add to the test file's imports: `"context"`, `"fmt"`, `"net/http"`,
`"net/http/httptest"`, `"strings"`, `"time"`.

- [ ] **Step 6: Run all the package's tests**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./safehttp/ -v
```

Expected: PASS, all tests.

- [ ] **Step 7: Verify core isolation still passes**

```bash
cd ~/code/tinycld/tinycld && pnpm run check:core-isolation
```

Expected: PASS. (This package names no feature.)

- [ ] **Step 8: Commit**

```bash
cd ~/code/tinycld/tinycld
git add core/server/safehttp/
git commit -m "feat(core): SSRF-guarded outbound HTTP helper

Lifted from calendar's ICS fetcher so both webhook directions share one
implementation. Unlike the GET path, redirects are refused rather than
re-validated: a POST following a 302 would re-send its signed body to a
host the caller never named."
```

---

## Task 2: The `core:post-webhook` action handler (Go)

**Files:**
- Create: `~/code/tinycld/tinycld/core/server/automation/actions_webhook.go`
- Test: `~/code/tinycld/tinycld/core/server/automation/actions_webhook_test.go`
- Modify: `~/code/tinycld/tinycld/core/server/automation/register.go:51`
- Read for reference: `~/code/tinycld/tinycld/core/server/automation/actions_email.go` (the template — mirror its structure and its ledger)

**Interfaces:**
- Consumes: `safehttp.PostJSON` (Task 1); `ActionRequest{Rule, OwnerID, Params, Record, Depth}` and `RegisterAction(ref string, h ActionHandler)` from `registry.go`.
- Produces:
  - `func registerCoreWebhookAction()` — called from `register.go`.
  - `var postWebhookNow` — the test seam, mirroring `sendEmailNow`.
  - Action ref `core:post-webhook`, params `url` and `secret`.

- [ ] **Step 1: Read the template**

```bash
sed -n '1,60p' ~/code/tinycld/tinycld/core/server/automation/actions_email.go
sed -n '95,150p' ~/code/tinycld/tinycld/core/server/automation/actions_email.go
```

Mirror: the `var sendEmailNow = func(...)` test seam, the in-memory
per-rule ledger, and the `reserveXSend` claim-before-send ordering.

- [ ] **Step 2: Write the failing test**

Create `~/code/tinycld/tinycld/core/server/automation/actions_webhook_test.go`:

```go
package automation

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestActionPostWebhook_PostsTriggerFieldsAsJSON(t *testing.T) {
	var gotURL string
	var gotBody []byte
	var gotHeaders map[string]string
	restore := stubPostWebhook(func(url string, body []byte, headers map[string]string) (int, error) {
		gotURL, gotBody, gotHeaders = url, body, headers
		return 200, nil
	})
	defer restore()

	err := actionPostWebhook(nil, ActionRequest{
		Params: map[string]string{"url": "https://hooks.example.com/abc"},
	})
	if err != nil {
		t.Fatalf("actionPostWebhook: %v", err)
	}
	if gotURL != "https://hooks.example.com/abc" {
		t.Errorf("url = %q", gotURL)
	}
	var decoded map[string]any
	if err := json.Unmarshal(gotBody, &decoded); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if _, signed := gotHeaders["X-TinyCld-Signature-256"]; signed {
		t.Error("unsigned request carries a signature header")
	}
}

func TestActionPostWebhook_SignsWhenSecretIsSet(t *testing.T) {
	var gotHeaders map[string]string
	restore := stubPostWebhook(func(_ string, _ []byte, headers map[string]string) (int, error) {
		gotHeaders = headers
		return 200, nil
	})
	defer restore()

	err := actionPostWebhook(nil, ActionRequest{
		Params: map[string]string{
			"url":    "https://hooks.example.com/abc",
			"secret": "shhh",
		},
	})
	if err != nil {
		t.Fatalf("actionPostWebhook: %v", err)
	}
	sig := gotHeaders["X-TinyCld-Signature-256"]
	if !strings.HasPrefix(sig, "sha256=") {
		t.Errorf("signature = %q, want a sha256= prefix", sig)
	}
}

func TestActionPostWebhook_RequiresAURL(t *testing.T) {
	restore := stubPostWebhook(func(string, []byte, map[string]string) (int, error) {
		t.Fatal("must not post without a URL")
		return 0, nil
	})
	defer restore()

	if err := actionPostWebhook(nil, ActionRequest{Params: map[string]string{}}); err == nil {
		t.Error("expected an error for a missing URL")
	}
}

func TestActionPostWebhook_RejectsNon2xx(t *testing.T) {
	restore := stubPostWebhook(func(string, []byte, map[string]string) (int, error) {
		return 500, nil
	})
	defer restore()

	err := actionPostWebhook(nil, ActionRequest{
		Params: map[string]string{"url": "https://hooks.example.com/abc"},
	})
	if err == nil {
		t.Error("expected an error for a 500 response")
	}
}

func TestReserveWebhookPost_EnforcesHourlyCeiling(t *testing.T) {
	webhookPostLedger.Lock()
	webhookPostLedger.posts = map[string][]time.Time{}
	webhookPostLedger.Unlock()

	now := time.Now()
	for i := 0; i < maxWebhookPostsPerRulePerHour; i++ {
		if err := reserveWebhookPost("rule1", now); err != nil {
			t.Fatalf("post %d rejected early: %v", i+1, err)
		}
	}
	if err := reserveWebhookPost("rule1", now); err == nil {
		t.Error("expected the ceiling to reject the next post")
	}
	// A different rule has its own budget.
	if err := reserveWebhookPost("rule2", now); err != nil {
		t.Errorf("a second rule was blocked by the first's budget: %v", err)
	}
	// An hour later the window has rolled.
	if err := reserveWebhookPost("rule1", now.Add(61*time.Minute)); err != nil {
		t.Errorf("the window did not roll: %v", err)
	}
}

// stubPostWebhook replaces the network seam and returns a restore func.
func stubPostWebhook(fn func(url string, body []byte, headers map[string]string) (int, error)) func() {
	original := postWebhookNow
	postWebhookNow = func(_ context.Context, url string, body []byte, headers map[string]string) (int, error) {
		return fn(url, body, headers)
	}
	return func() { postWebhookNow = original }
}
```

Add `"context"` to the test imports.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./automation/ -run TestActionPostWebhook -v
```

Expected: FAIL — `undefined: actionPostWebhook`, `undefined: postWebhookNow`.

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/tinycld/core/server/automation/actions_webhook.go`:

```go
package automation

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/safehttp"
)

// maxWebhookPostsPerRulePerHour caps how many outbound posts one rule may
// emit. The reasoning is actions_email.go's, unchanged: the engine's depth cap
// stops a rule re-triggering itself inside one dispatch but cannot see across
// dispatches, and a webhook whose receiver writes back into this deployment
// closes exactly that loop. The rule is the unit because core has no other
// key to meter on.
const maxWebhookPostsPerRulePerHour = 60

// webhookPostTimeout bounds one delivery. Receivers like Zapier acknowledge
// quickly; a slow one must not hold an action slot open.
const webhookPostTimeout = 10 * time.Second

// postWebhookNow is the seam tests replace. Production goes through safehttp,
// which validates the target and refuses redirects.
var postWebhookNow = func(
	ctx context.Context,
	url string,
	body []byte,
	headers map[string]string,
) (int, error) {
	return safehttp.PostJSON(ctx, url, body, headers, webhookPostTimeout)
}

// registerCoreWebhookAction installs core:post-webhook.
//
// Native, but native IN CORE, the actions_email.go argument: it ships in every
// build regardless of which feature packages an org installed, so "POST to my
// automation tool when X" exists on every deployment. It is also the outbound
// half of the integration story — an external service consuming these posts
// needs no package-specific code at all.
func registerCoreWebhookAction() {
	RegisterAction("core:post-webhook", actionPostWebhook)
}

// actionPostWebhook delivers one JSON POST on behalf of a rule.
//
// Native handlers are not pkgaccess-gated — the engine hands them a superuser
// app — so this validates its own inputs. `url` arrives after template
// substitution, so its value is only as trustworthy as the record that
// triggered the rule; safehttp.ValidateURL is what stands between a templated
// value and an internal address.
func actionPostWebhook(_ core.App, req ActionRequest) error {
	target := strings.TrimSpace(req.Params["url"])
	if target == "" {
		return fmt.Errorf("core:post-webhook: no url")
	}

	// A request with no rule (a dry-run style invocation) has nothing to
	// count against; every engine path supplies the rule.
	if req.Rule != nil {
		if err := reserveWebhookPost(req.Rule.Id, time.Now()); err != nil {
			return fmt.Errorf("core:post-webhook: %w", err)
		}
	}

	body, err := webhookBody(req)
	if err != nil {
		return fmt.Errorf("core:post-webhook: %w", err)
	}

	headers := map[string]string{}
	if secret := req.Params["secret"]; secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		headers["X-TinyCld-Signature-256"] = "sha256=" + hex.EncodeToString(mac.Sum(nil))
	}

	ctx, cancel := context.WithTimeout(context.Background(), webhookPostTimeout)
	defer cancel()

	status, err := postWebhookNow(ctx, target, body, headers)
	if err != nil {
		return fmt.Errorf("core:post-webhook: %w", err)
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("core:post-webhook: receiver returned %d", status)
	}
	return nil
}

// webhookBody renders the triggering record as the POST payload.
//
// PublicExport is what the engine already uses to expose a record to
// templates, so a webhook cannot see fields a rule's own {{placeholders}}
// could not — notably users.password and users.tokenKey, which the engine's
// exposure rules filter out everywhere.
func webhookBody(req ActionRequest) ([]byte, error) {
	payload := map[string]any{}
	if req.Record != nil {
		payload["collection"] = req.Record.Collection().Name
		payload["record"] = req.Record.PublicExport()
	}
	if req.Rule != nil {
		payload["rule"] = map[string]any{
			"id":   req.Rule.Id,
			"name": req.Rule.GetString("name"),
		}
	}
	return json.Marshal(payload)
}

// webhookPostLedger tracks each rule's posts inside the rolling hour, in
// memory. In-memory is deliberate, actions_email.go's reasoning: there is no
// query that can fail, so the cap cannot fail open — and an unavailable count
// must never be read as permission to send.
var webhookPostLedger = struct {
	sync.Mutex
	posts map[string][]time.Time
}{posts: map[string][]time.Time{}}

// reserveWebhookPost claims one slot for the rule, or reports it is over the
// hourly ceiling. Claimed BEFORE the post, so a concurrent dispatch cannot
// slip past the ceiling and a failed delivery still consumes its slot —
// over-counting is the safe direction for a loop guard.
func reserveWebhookPost(ruleID string, now time.Time) error {
	webhookPostLedger.Lock()
	defer webhookPostLedger.Unlock()

	cutoff := now.Add(-time.Hour)
	kept := make([]time.Time, 0, len(webhookPostLedger.posts[ruleID]))
	for _, at := range webhookPostLedger.posts[ruleID] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= maxWebhookPostsPerRulePerHour {
		webhookPostLedger.posts[ruleID] = kept
		return fmt.Errorf(
			"rule is over its ceiling of %d webhook posts per hour",
			maxWebhookPostsPerRulePerHour,
		)
	}
	webhookPostLedger.posts[ruleID] = append(kept, now)
	return nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestActionPostWebhook|TestReserveWebhookPost' -v
```

Expected: PASS, all five tests.

- [ ] **Step 6: Register the action at boot**

Read the surrounding lines, then add the call next to the email one:

```bash
sed -n '45,58p' ~/code/tinycld/tinycld/core/server/automation/register.go
```

Add immediately after the `registerCoreEmailAction()` line:

```go
	registerCoreWebhookAction()
```

- [ ] **Step 7: Run the whole automation package's tests**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./automation/
```

Expected: PASS. If a catalog-validation test fails because `core:post-webhook`
has no TS declaration yet, that is Task 3 — note it and proceed; do not weaken
the test.

- [ ] **Step 8: Commit**

```bash
cd ~/code/tinycld/tinycld
git add core/server/automation/actions_webhook.go core/server/automation/actions_webhook_test.go core/server/automation/register.go
git commit -m "feat(core): core:post-webhook automation action

Native-in-core for the same reason send-email is: it ships in every build,
so any deployment can POST a rule's trigger payload to an external service
without a package-specific integration. Per-rule hourly ceiling bounds a
cross-dispatch loop; safehttp validates the templated URL."
```

---

## Task 3: Declare `post-webhook` in the automation catalog (TypeScript)

The Go handler exists but the builder UI cannot offer it until it is declared.
Note that `core-defs.test.ts:16` asserts the exact action list with `toEqual`,
so it **will fail** until updated — that is the test doing its job.

**Files:**
- Modify: `~/code/tinycld/tinycld/core/lib/automation/core-defs.ts`
- Modify: `~/code/tinycld/tinycld/core/lib/automation/__tests__/core-defs.test.ts:16`

**Interfaces:**
- Consumes: `NativeActionDef` / `TypedParamDef` from `core/lib/automation/types.ts`.
- Produces: action id `post-webhook` in `CORE_AUTOMATION.actions`, params `url` and `secret`, both `type: 'text'`.

- [ ] **Step 1: Run the pinning test to see it pass before the change**

```bash
cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/core-defs.test.ts
```

Expected: PASS (baseline).

- [ ] **Step 2: Update the pinning test to expect the new action**

In `core/lib/automation/__tests__/core-defs.test.ts`, change the action-ids
assertion (line ~16). The list is alphabetically ordered, so `post-webhook`
sorts before `send-email`:

```ts
        expect(actionIds).toEqual(['apply-label', 'notify', 'post-webhook', 'send-email'])
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/core-defs.test.ts
```

Expected: FAIL — received list lacks `post-webhook`.

- [ ] **Step 4: Declare the action**

In `core/lib/automation/core-defs.ts`, insert this entry into the `actions`
array immediately BEFORE the `send-email` entry (keeping the array's existing
alphabetical order):

```ts
        {
            // The outbound half of the integration story: any trigger in any
            // package becomes a source for an external automation tool with
            // no package-specific code. Native IN CORE for send-email's
            // reason — it ships in every build.
            //
            // `secret` is optional; when set the body carries an
            // X-TinyCld-Signature-256 HMAC so the receiver can verify the
            // post came from this deployment. It is a rule param rather than
            // a system setting because each destination has its own.
            id: 'post-webhook',
            label: 'Post to a webhook',
            kind: 'native',
            params: [
                { key: 'url', type: 'text', label: 'URL' },
                { key: 'secret', type: 'text', label: 'Signing secret (optional)' },
            ],
        },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/core-defs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full member check**

```bash
cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg check
```

Expected: PASS — biome, tsc and vitest. Fix any failure at its root cause.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/tinycld
git add core/lib/automation/core-defs.ts core/lib/automation/__tests__/core-defs.test.ts
git commit -m "feat(core): declare post-webhook in the automation catalog"
```

---

## Task 4: Delivery-dedupe migration

The receiver must reject a replayed delivery. Providers supply a unique
delivery id per event and retry with the SAME id, so the id is the dedupe key.

**Files:**
- Create: `~/code/tinycld/tinycld/core/server/pb_migrations/1910000030_create_webhook_deliveries.js`
- Read for reference: `~/code/tinycld/tinycld/core/server/pb_migrations/1910000010_create_system_settings.js` (rule idiom for an admin/system table)

**Interfaces:**
- Produces: collection `webhook_deliveries` with fields `source` (text), `delivery_id` (text), `received` (autodate); unique index on `(source, delivery_id)`.

- [ ] **Step 1: Confirm the migration number is free**

```bash
ls ~/code/tinycld/tinycld/core/server/pb_migrations/ | grep '^19100000' | sort | tail -5
```

Expected: no `1910000030_*`. If one exists, use the next free number and adjust
the filename below.

- [ ] **Step 2: Write the migration**

Create the file:

```js
/// <reference path="../pb_data/types.d.ts" />
//
// webhook_deliveries — the replay ledger for inbound webhooks.
//
// A provider retries a failed delivery with the SAME delivery id, which is
// exactly what makes the id a dedupe key: a retry must be accepted as a
// duplicate (200, no work) rather than processed twice. Without this, a
// receiver that times out AFTER writing its rows does its work again on the
// retry.
//
// SERVER-WRITTEN, CLIENT-INVISIBLE. Every rule is nil: no client of any kind
// reads or writes this. A superuser bypasses nil rules, which is the only
// access path, and the receiver runs as one.
//
// Rows are pruned by age, not kept forever — the dedupe window only has to
// outlive a provider's retry schedule (GitHub's is hours, not days).
migrate(
    app => {
        const col = new Collection({
            id: 'pbc_webhook_deliveries',
            name: 'webhook_deliveries',
            type: 'base',
            system: false,
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'wd_source',
                    name: 'source',
                    type: 'text',
                    required: true,
                    max: 50,
                },
                {
                    id: 'wd_delivery_id',
                    name: 'delivery_id',
                    type: 'text',
                    required: true,
                    max: 200,
                },
                {
                    id: 'wd_received',
                    name: 'received',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_webhook_deliveries_unique ' +
                    'ON webhook_deliveries (source, delivery_id)',
                'CREATE INDEX idx_webhook_deliveries_received ' +
                    'ON webhook_deliveries (received)',
            ],
        })
        app.save(col)
    },
    app => {
        app.delete(app.findCollectionByNameOrId('webhook_deliveries'))
    }
)
```

- [ ] **Step 3: Apply the migration and confirm the schema regenerates**

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
```

`core/types/pbSchema.ts` is generated from the on-disk migrations, so it must
now know the collection. Verify:

```bash
grep -c "webhook_deliveries" ~/code/tinycld/tinycld/core/types/pbSchema.ts
```

Expected: at least 1. Do **not** hand-edit that file — it is gitignored and
regenerated.

- [ ] **Step 4: Typecheck**

```bash
cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld
git add core/server/pb_migrations/1910000030_create_webhook_deliveries.js
git commit -m "feat(core): webhook_deliveries replay ledger

A provider retries with the same delivery id, so the id is the dedupe key:
a retry must read as a duplicate rather than be processed twice."
```

---

## Task 5: The `webhookin` registry

**Files:**
- Create: `~/code/tinycld/tinycld/core/server/webhookin/webhookin.go`
- Test: `~/code/tinycld/tinycld/core/server/webhookin/webhookin_test.go`
- Read for reference: `~/code/tinycld/tinycld/core/server/automation/registry.go:90-175` (the registry + mutex idiom)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Source struct { Secret func(core.App, *http.Request) (string, error); DeliveryID func(*http.Request) string; Handle func(core.App, Delivery) error }`
  - `type Delivery struct { Source string; Event string; DeliveryID string; Body []byte; Header http.Header }`
  - `func Register(name string, s Source)`
  - `func lookup(name string) (Source, bool)`
  - `func registered() []string`

- [ ] **Step 1: Write the failing test**

Create `~/code/tinycld/tinycld/core/server/webhookin/webhookin_test.go`:

```go
package webhookin

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestRegister_ThenLookup(t *testing.T) {
	resetRegistry(t)

	Register("acme", Source{
		Secret:     func(core.App, *http.Request) (string, error) { return "s3cret", nil },
		DeliveryID: func(r *http.Request) string { return r.Header.Get("X-Acme-Delivery") },
		Handle:     func(core.App, Delivery) error { return nil },
	})

	got, ok := lookup("acme")
	if !ok {
		t.Fatal("lookup(acme) not found after Register")
	}
	if got.Handle == nil {
		t.Error("registered source lost its Handle")
	}
}

func TestLookup_UnknownSource(t *testing.T) {
	resetRegistry(t)
	if _, ok := lookup("nope"); ok {
		t.Error("lookup of an unregistered source succeeded")
	}
}

func TestRegister_LastWins(t *testing.T) {
	resetRegistry(t)
	Register("acme", Source{Handle: func(core.App, Delivery) error { return nil }})
	Register("acme", Source{Handle: func(core.App, Delivery) error { return errSentinel }})

	got, _ := lookup("acme")
	if err := got.Handle(nil, Delivery{}); err != errSentinel {
		t.Error("a re-registration did not replace the earlier source")
	}
}

func TestRegistered_ListsNames(t *testing.T) {
	resetRegistry(t)
	Register("acme", Source{})
	Register("widgets", Source{})

	names := registered()
	if len(names) != 2 {
		t.Fatalf("registered() = %v, want 2 entries", names)
	}
}
```

Add a small support file `~/code/tinycld/tinycld/core/server/webhookin/testsupport_test.go`:

```go
package webhookin

import (
	"errors"
	"testing"
)

var errSentinel = errors.New("sentinel")

// resetRegistry clears global registry state so each test starts clean.
func resetRegistry(t *testing.T) {
	t.Helper()
	registryMu.Lock()
	sources = map[string]Source{}
	registryMu.Unlock()
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./webhookin/ -v
```

Expected: FAIL — the package does not exist / does not compile.

- [ ] **Step 3: Write the implementation**

Create `~/code/tinycld/tinycld/core/server/webhookin/webhookin.go`:

```go
// Package webhookin receives signed webhooks from external services and hands
// them to whichever package registered that source.
//
// TRANSPORT ONLY, and the line matters. This package verifies signatures,
// rejects replays, meters requests and logs; it writes NO domain row and
// knows no collection name. Interpretation — "this payload means link these
// two records" — belongs to the package that owns the schema, because that is
// where the access rules live. A generic "any webhook may write any
// collection" facility would route around those rules, which for a
// rule-first package are its entire authorization story.
//
// Packages register from their own Register(app), so core never names a
// package: the oauth.RegisterPackage / search.RegisterSources pattern.
package webhookin

import (
	"net/http"
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// Delivery is one verified inbound webhook, handed to a source's Handle.
//
// Body is the RAW bytes the signature was computed over. A handler that needs
// structured data decodes them itself; re-encoding a decoded payload would
// not round-trip byte-for-byte and would invalidate any further verification.
type Delivery struct {
	Source     string
	Event      string
	DeliveryID string
	Body       []byte
	Header     http.Header
}

// Source is what a package registers to receive one provider's webhooks.
type Source struct {
	// Secret returns the HMAC-SHA256 signing secret for this request. A func
	// rather than a string because the secret lives in the database (it is
	// per-deployment, and rotatable) and must be read at request time, not at
	// boot. Returning an error fails the request closed.
	Secret func(app core.App, r *http.Request) (string, error)

	// SignatureHeader names the header carrying the provider's signature,
	// e.g. "X-Hub-Signature-256". Defaults to X-TinyCld-Signature-256.
	SignatureHeader string

	// EventHeader names the header carrying the event type, e.g.
	// "X-GitHub-Event". Optional; Delivery.Event is blank without it.
	EventHeader string

	// DeliveryID extracts the provider's unique per-delivery id, the replay
	// dedupe key. A source returning "" opts out of dedupe.
	DeliveryID func(r *http.Request) string

	// Handle interprets one verified delivery. Returning an error yields a
	// 500, which asks a well-behaved provider to retry.
	Handle func(app core.App, d Delivery) error
}

var (
	registryMu sync.RWMutex
	sources    = map[string]Source{}
)

// Register installs a source under a URL-safe name, reached at
// POST /api/webhooks/{name}. Last registration wins, matching
// automation.RegisterAction: a rebuild re-registering is not an error.
func Register(name string, s Source) {
	registryMu.Lock()
	defer registryMu.Unlock()
	sources[name] = s
}

func lookup(name string) (Source, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	s, ok := sources[name]
	return s, ok
}

func registered() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()
	names := make([]string, 0, len(sources))
	for name := range sources {
		names = append(names, name)
	}
	return names
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./webhookin/ -v
```

Expected: PASS, all four tests.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld
git add core/server/webhookin/
git commit -m "feat(core): webhookin source registry

Transport only: packages register a source and interpret their own payloads,
so core names no package and no generic path writes a domain row."
```

---

## Task 6: The receiver handler

**Files:**
- Create: `~/code/tinycld/tinycld/core/server/webhookin/receive.go`
- Test: `~/code/tinycld/tinycld/core/server/webhookin/receive_test.go`
- Modify: the core route-mounting site (located in Step 1)

**Interfaces:**
- Consumes: `Source`, `Delivery`, `lookup` (Task 5); collection `webhook_deliveries` (Task 4).
- Produces:
  - `func MountRoutes(se *core.ServeEvent)` — mounts `POST /api/webhooks/{source}`.
  - `func verifySignature(secret string, body []byte, header string) bool`
  - `func claimDelivery(app core.App, source, deliveryID string) (bool, error)` — false when already seen.

- [ ] **Step 1: Find where core mounts its routes**

```bash
grep -rn "OnServe()" ~/code/tinycld/tinycld/core/server/coreserver/*.go | grep -v _test | head
```

Record the file and the function that receives the `*core.ServeEvent`; Step 7
adds one call there.

- [ ] **Step 2: Write the failing test**

Create `~/code/tinycld/tinycld/core/server/webhookin/receive_test.go`:

```go
package webhookin

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestVerifySignature_AcceptsAMatchingDigest(t *testing.T) {
	secret := "s3cret"
	body := []byte(`{"hello":"world"}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	header := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !verifySignature(secret, body, header) {
		t.Error("a correct signature was rejected")
	}
}

func TestVerifySignature_RejectsTampering(t *testing.T) {
	secret := "s3cret"
	body := []byte(`{"hello":"world"}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	header := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if verifySignature(secret, []byte(`{"hello":"tampered"}`), header) {
		t.Error("a body that did not match its signature was accepted")
	}
	if verifySignature("wrong-secret", body, header) {
		t.Error("a signature under the wrong secret was accepted")
	}
}

func TestVerifySignature_RejectsMalformedHeaders(t *testing.T) {
	body := []byte(`{}`)
	for _, header := range []string{
		"",                  // absent
		"deadbeef",          // no algorithm prefix
		"sha1=deadbeef",     // wrong algorithm
		"sha256=",           // empty digest
		"sha256=not-hex-!!", // undecodable
	} {
		if verifySignature("s3cret", body, header) {
			t.Errorf("malformed header %q was accepted", header)
		}
	}
}

func TestVerifySignature_RejectsWhenNoSecretIsConfigured(t *testing.T) {
	// An unconfigured source must not fall open to "no secret, no check".
	body := []byte(`{}`)
	mac := hmac.New(sha256.New, []byte(""))
	mac.Write(body)
	header := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if verifySignature("", body, header) {
		t.Error("a blank secret was treated as valid configuration")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./webhookin/ -run TestVerifySignature -v
```

Expected: FAIL — `undefined: verifySignature`.

- [ ] **Step 4: Write the implementation**

Create `~/code/tinycld/tinycld/core/server/webhookin/receive.go`:

```go
package webhookin

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/logging"
)

// maxBodyBytes bounds one delivery. Providers cap their own payloads well
// below this; the limit exists so an unauthenticated route cannot be used to
// buffer arbitrary memory. Read BEFORE verification, because the signature is
// computed over the body we must therefore already hold.
const maxBodyBytes = 1 << 20 // 1 MiB

const defaultSignatureHeader = "X-TinyCld-Signature-256"

var log = logging.ForPackage("core")

// MountRoutes installs POST /api/webhooks/{source}.
//
// UNAUTHENTICATED by necessity — a provider holds no session and no OAuth
// token — so the HMAC signature IS the authentication, and every path below
// fails closed. The route must be excluded from OAuth scope classification
// rather than assigned a scope: it is not a caller acting for a user.
func MountRoutes(se *core.ServeEvent) {
	se.Router.POST("/api/webhooks/{source}", func(re *core.RequestEvent) error {
		name := re.Request.PathValue("source")
		source, ok := lookup(name)
		if !ok {
			// 404 rather than a hint that some other name would work.
			return re.NotFoundError("unknown webhook source", nil)
		}
		return handleDelivery(re, name, source)
	})
}

func handleDelivery(re *core.RequestEvent, name string, source Source) error {
	body, err := io.ReadAll(io.LimitReader(re.Request.Body, maxBodyBytes+1))
	if err != nil {
		return re.BadRequestError("could not read the request body", nil)
	}
	if len(body) > maxBodyBytes {
		return re.BadRequestError("payload too large", nil)
	}

	if source.Secret == nil {
		log.Error("webhook source has no secret resolver", "source", name)
		return re.InternalServerError("source is not configured", nil)
	}
	secret, err := source.Secret(re.App, re.Request)
	if err != nil || secret == "" {
		// Unconfigured is not permission. Fail closed.
		log.WarnContext(re.Request.Context(),
			"rejecting a webhook for a source with no usable secret",
			"source", name)
		return re.ForbiddenError("source is not configured", nil)
	}

	headerName := source.SignatureHeader
	if headerName == "" {
		headerName = defaultSignatureHeader
	}
	if !verifySignature(secret, body, re.Request.Header.Get(headerName)) {
		log.WarnContext(re.Request.Context(),
			"rejecting a webhook whose signature did not verify",
			"source", name)
		return re.ForbiddenError("signature verification failed", nil)
	}

	delivery := Delivery{
		Source: name,
		Body:   body,
		Header: re.Request.Header,
	}
	if source.EventHeader != "" {
		delivery.Event = re.Request.Header.Get(source.EventHeader)
	}
	if source.DeliveryID != nil {
		delivery.DeliveryID = source.DeliveryID(re.Request)
	}

	// Replay check AFTER verification: an unverified caller must not be able
	// to probe or populate the ledger.
	if delivery.DeliveryID != "" {
		fresh, err := claimDelivery(re.App, name, delivery.DeliveryID)
		if err != nil {
			return re.InternalServerError("could not record the delivery", nil)
		}
		if !fresh {
			// 200: a retry of work already done is a success, and any other
			// status invites the provider to keep retrying.
			return re.JSON(http.StatusOK, map[string]any{"duplicate": true})
		}
	}

	if source.Handle == nil {
		return re.InternalServerError("source has no handler", nil)
	}
	if err := source.Handle(re.App, delivery); err != nil {
		// 500 so a well-behaved provider retries. The delivery is already
		// claimed, so the retry will read as a duplicate — deliberately: a
		// handler that failed halfway must reconcile on its own terms rather
		// than have the same payload replayed into it.
		log.ErrorContext(re.Request.Context(), "webhook handler failed",
			"source", name, "event", delivery.Event, "error", err)
		return re.InternalServerError("handler failed", nil)
	}
	return re.JSON(http.StatusOK, map[string]any{"ok": true})
}

// verifySignature reports whether `header` is a valid sha256 HMAC of body
// under secret. Constant-time compare, and closed against every malformed
// shape: a blank secret, a missing or wrongly-prefixed header, and an
// undecodable digest all return false rather than skipping the check.
func verifySignature(secret string, body []byte, header string) bool {
	if secret == "" || header == "" {
		return false
	}
	const prefix = "sha256="
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	want, err := hex.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil || len(want) != sha256.Size {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), want)
}

// claimDelivery records this delivery id, reporting false when the provider
// has sent it before. The unique index on (source, delivery_id) is what makes
// the claim atomic — two concurrent retries race to insert and exactly one
// wins, so this cannot be defeated by timing.
func claimDelivery(app core.App, source, deliveryID string) (bool, error) {
	collection, err := app.FindCollectionByNameOrId("webhook_deliveries")
	if err != nil {
		return false, fmt.Errorf("webhook_deliveries collection: %w", err)
	}
	record := core.NewRecord(collection)
	record.Set("source", source)
	record.Set("delivery_id", deliveryID)
	if err := app.Save(record); err != nil {
		// A unique-constraint violation is the duplicate case, not a fault.
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./webhookin/ -v
```

Expected: PASS, all tests.

- [ ] **Step 6: Verify the error-helper names compile**

`re.NotFoundError` / `re.BadRequestError` / `re.ForbiddenError` /
`re.InternalServerError` are PocketBase `RequestEvent` helpers. Confirm the
signatures match this PocketBase version:

```bash
cd ~/code/tinycld/tinycld/core/server && go build ./webhookin/
```

Expected: no output. If a helper name differs, grep an existing endpoint for
the idiom actually in use and match it:

```bash
grep -rn "ForbiddenError\|BadRequestError" ~/code/tinycld/boards/server/endpoints_share_links.go | head -3
```

- [ ] **Step 7: Add the per-source rate limiter**

An unauthenticated route must be metered. `core/server/ratelimit` provides
`New(limit int, window time.Duration) *Limiter` and `(*Limiter).Allow(key string) bool`.

Add to `receive.go`'s imports: `"time"` and `"tinycld.org/core/ratelimit"`.

Add near the other constants:

```go
// deliveryLimiter meters inbound deliveries per source.
//
// Generous, because a provider legitimately bursts — a repo with many open
// PRs can deliver dozens of events in a few seconds — and the signature
// check already rejects a forged caller before any database write. This is a
// ceiling against a verified-but-runaway sender, not an authentication
// control.
var deliveryLimiter = ratelimit.New(300, time.Minute)
```

Then in `handleDelivery`, immediately AFTER the signature check passes and
BEFORE the replay claim, add:

```go
	// Metered after verification so an unverified caller cannot consume
	// another source's budget.
	if !deliveryLimiter.Allow(name) {
		log.WarnContext(re.Request.Context(),
			"rejecting a webhook over its rate ceiling", "source", name)
		return re.TooManyRequestsError("rate limit exceeded", nil)
	}
```

Confirm the helper name compiles; if `TooManyRequestsError` is absent in this
PocketBase version, grep for the idiom in use and match it:

```bash
cd ~/code/tinycld/tinycld/core/server && go build ./webhookin/ || \
  grep -rn "TooManyRequests\|StatusTooManyRequests" ./oauth/ratelimit.go | head -3
```

- [ ] **Step 8: Add the rate-limit test**

Append to `receive_test.go`:

```go
func TestDeliveryLimiter_MetersPerSource(t *testing.T) {
	limiter := ratelimit.New(2, time.Minute)

	if !limiter.Allow("acme") || !limiter.Allow("acme") {
		t.Fatal("the first two deliveries were rejected")
	}
	if limiter.Allow("acme") {
		t.Error("a third delivery slipped past the ceiling")
	}
	if !limiter.Allow("widgets") {
		t.Error("one source's burst consumed another's budget")
	}
}
```

Add `"testing"`-adjacent imports: `"time"` and `"tinycld.org/core/ratelimit"`.

Run it:

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./webhookin/ -run TestDeliveryLimiter -v
```

Expected: PASS.

- [ ] **Step 9: Mount the route**

In the file found in Step 1, inside the existing `OnServe()` binding, add:

```go
		webhookin.MountRoutes(e)
```

Add the import `"tinycld.org/core/webhookin"`. Match the surrounding code's
variable name for the `*core.ServeEvent` (it may be `e` or `se`).

- [ ] **Step 10: Build and run the core server tests**

```bash
cd ~/code/tinycld/tinycld/core/server && go build ./... && go test ./webhookin/ ./automation/ ./safehttp/
```

Expected: PASS.

- [ ] **Step 11: Verify core isolation**

```bash
cd ~/code/tinycld/tinycld && pnpm run check:core-isolation
```

Expected: PASS. Every name here is provider-agnostic; the tests use the
fictional source `acme`.

- [ ] **Step 12: Commit**

```bash
cd ~/code/tinycld/tinycld
git add core/server/webhookin/ core/server/coreserver/
git commit -m "feat(core): inbound webhook receiver

HMAC signature is the authentication, since a provider holds no session:
every path fails closed, including an unconfigured secret. Replay dedupe
claims the provider's delivery id through a unique index, so concurrent
retries cannot both win."
```

---

## Task 7: Full-suite verification and documentation

**Files:**
- Modify: `~/code/tinycld/tinycld/docs/automation.md`

- [ ] **Step 1: Run the complete core check**

```bash
cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg check
```

Expected: PASS — biome, tsc, vitest.

- [ ] **Step 2: Run the complete Go suite**

```bash
cd ~/code/tinycld/tinycld/core/server && go test ./...
```

Expected: PASS. Any failure here is diagnosed and fixed at its root cause —
never by skipping, re-running, or loosening an assertion.

- [ ] **Step 3: Run the ecosystem checks**

```bash
cd ~/code/tinycld && pnpm run checks
```

Expected: PASS, including `check:core-isolation`.

- [ ] **Step 4: Document the outbound action**

Read the document's existing structure first:

```bash
grep -n "^## \|^### " ~/code/tinycld/tinycld/docs/automation.md | head -30
```

Add a subsection documenting `core:post-webhook` under whichever heading
covers core-provided actions, following the surrounding prose style. Cover:
the two params; that the body is `{collection, record, rule}` JSON; that
`secret` produces an `X-TinyCld-Signature-256: sha256=<hex>` HMAC over the raw
body; the 60-posts-per-rule-per-hour ceiling; and that internal/private
addresses and redirects are refused.

- [ ] **Step 5: Document the inbound receiver**

In the same document, add a subsection for `webhookin`: the route shape
`POST /api/webhooks/{source}`, that a package registers a `Source` from its
own `Register(app)`, the `Source` fields, that the signature is the
authentication and an unconfigured secret fails closed, and that a repeated
delivery id returns `{"duplicate": true}` with a 200.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/tinycld
git add docs/automation.md
git commit -m "docs(core): document post-webhook and the webhookin receiver"
```

- [ ] **Step 7: Open the PR**

```bash
cd ~/code/tinycld/tinycld
git push -u origin feat/github-integration
gh pr create --title "feat(core): generic webhook layers, both directions" --body "$(cat <<'EOF'
Adds the two provider-agnostic webhook layers that boards' GitHub integration
and the upcoming Zapier integration both build on.

- `core:post-webhook` — a native-in-core automation action, so any trigger in
  any package can POST to an external service with no package-specific code.
- `webhookin` — an inbound receiver handling signature verification, replay
  dedupe and rate limiting. Transport only: packages register a source and
  interpret their own payloads, so core names no package.
- `safehttp` — SSRF guards lifted from calendar's ICS fetcher. Unlike the GET
  path, redirects are refused rather than re-validated, since a POST following
  a 302 would re-send its signed body to an unnamed host.

Useful on its own: it unblocks the outbound half of boards TODO item 23.

Design: `docs/superpowers/specs/2026-09-09-github-integration-design.md`
Follow-up: plan 2 (boards) consumes `webhookin`.
EOF
)"
```

---

## Self-review notes

**Spec coverage for this plan's scope:**

| Spec requirement | Task |
|---|---|
| `core:post-webhook` action, `url` + `secret` params | 2, 3 |
| Body is trigger fields as JSON | 2 (`webhookBody`) |
| `X-TinyCld-Signature-256` signing | 2 |
| SSRF guards lifted from calendar | 1 |
| Redirects NOT followed | 1 (impl + test) |
| Per-rule hourly rate ceiling | 2 |
| Timeout + no keep-alives | 1 |
| `webhookin` verifies HMAC | 6 |
| Dedupe on provider delivery id | 4, 6 |
| Rate limit per source | 6 (Steps 7–8) |
| Dispatch to package-registered handler | 5, 6 |
| Receiver writes no domain row | 5 (enforced by design: `Delivery` carries bytes, not records) |
| Registry pattern, core names no package | 5, 6 (+ isolation check in 6, 7) |
| Raw bytes captured before JSON decode | 6 (`Delivery.Body`) |

**Verified APIs.** `re.Request.PathValue("x")` is the router idiom in use
(`boards/server/endpoints_move_card.go:202`). `re.InternalServerError(msg, err)`
and siblings are the `RequestEvent` error helpers in use
(`boards/server/endpoints_share_otp.go:186`). `Record.PublicExport()` exists and
is the method core's own OAuth tests rely on to prove credential fields stay
hidden — which is why `webhookBody` uses it rather than reading columns
directly. `ratelimit.New(limit, window)` / `(*Limiter).Allow(key)` are
confirmed in `core/server/ratelimit/ratelimit.go`.

**Two helper names left to confirm at implementation time**, each with the grep
that resolves it inline: `re.TooManyRequestsError` (Task 6 Step 7) and
`re.NotFoundError` / `re.BadRequestError` / `re.ForbiddenError` (Task 6 Step 6).
Only `InternalServerError` was verified against a real call site.

**Type consistency check:** `postWebhookNow` has the same signature in Task 2's
stub helper and its implementation (`ctx, url, body, headers`). `Source` fields
used in Task 6 (`Secret`, `SignatureHeader`, `EventHeader`, `DeliveryID`,
`Handle`) all exist in Task 5's definition. `Delivery` fields set in Task 6
(`Source`, `Event`, `DeliveryID`, `Body`, `Header`) match Task 5's struct.

**Placeholder scan:** no TBDs. Two steps intentionally locate a file rather
than name it (Task 6 Step 1 for the route-mounting site, Task 7 Step 4 for the
docs heading) because the exact location was not verified while planning; both
give the grep that finds it.
