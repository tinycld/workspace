# Delegated mail-domain provisioning

**Date:** 2026-09-16
**Status:** Design approved, not yet implemented

## Problem

A hosted org must be able to add a custom mail domain and get it working —
enrolled with the fleet's mail provider, with the DNS records it needs to
publish — without the tenant process ever holding the operator's Postmark
**account token**.

Every call in Postmark's Domains API is account-token authenticated. In
`github.com/mrz1836/postmark@v1.9.0/domains.go`:

| Call | Auth |
|---|---|
| `CreateDomain` | `postWithAccountToken` |
| `GetDomains` | `getWithAccountToken` |
| `GetDomain` | `getWithAccountToken` |
| `VerifyDKIM` / `VerifyReturnPath` | `putWithAccountToken` |

There is no server-token path to a domain's DKIM/SPF state. So the boundary is
not "creating vs. reading" — it is **account-token operations vs. everything
else**. Reading a domain's verification status is exactly as privileged as
enrolling it.

The account token is fleet-wide. Every tenant has its own superusers, so a
token placed in a tenant's `syscfg.json` or settings collection is readable by
that org — and an account token can enumerate, modify and delete *every other
org's* domains on the account.

## Current state

Three facts from the code, each of which shapes the design:

1. **`AddDomain` is dead code.** It sits on `Provider`
   (`mail/server/provider.go:32`) and is implemented for Postmark
   (`mail/server/postmark.go:186`), but has no production caller. Adding a
   domain in the UI (`mail/tinycld/mail/settings/provider.tsx:560`) is a bare
   client-side `domainsCollection.insert()`. tinycld never enrolls a domain
   with Postmark.

2. **The DNS records are fetched and discarded.** `checkOutbound`
   (`mail/server/domain_verify.go:135`) receives `DKIMHost`, `DKIMTextValue`,
   `ReturnPathDomain` and `ReturnPathCNAMEValue` from
   `CheckDomainVerification`, then copies only three booleans into
   `OutboundCheckResult`. The records the customer must publish are thrown
   away before reaching the client.

3. **The docs describe a feature that does not exist.**
   `mail/help/custom-domains.md` documents a "View setup instructions" button
   showing "the exact DNS records to add", and claims Postmark is asked to
   create a matching domain record on add. Neither is implemented.

The seam to delegate across, however, already exists in shape:
`AddDomain(ctx, domain) (*DomainVerification, error)` takes a plain string and
returns pure data. No credential appears in the signature.

## Architecture

### The seam: `core/server/maildomains`

A new core package, modelled directly on `core/server/syscfg`. `syscfg`
delegates a *value* a tenant must not hold; this delegates an *operation* a
tenant must not perform. Same shape, same claiming semantics, same rule that
core knows nothing about what composed it.

```go
// Registrar performs the mail-provider operations that require the operator's
// account-level credentials.
type Registrar interface {
    AddDomain(ctx context.Context, domain string) (*DomainRecords, error)
    GetDomain(ctx context.Context, domain string) (*DomainRecords, error)
}

// DomainRecords is pure data: the verification state and the DNS records the
// customer must publish. No credential crosses this type.
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

func SetRegistrar(r Registrar)  // sets `claimed`
func Current() Registrar
var ErrNotConfigured = errors.New(...)
```

The `claimed` flag is copied from `syscfg` for the same security reason
documented there: a supervising composition whose config failed to load
installs a registrar that can do nothing *yet*, and core must not respond by
handing the deployment its own credentials back. Fails closed.

`maildomains` names a capability, not a feature package — the same category as
the existing `mailer` and `syscfg` in core. No feature slug appears in it.

### Two implementations

**Direct** (`core/server/maildomains/postmark.go`) — reads
`mail.postmark_account_token` through `syscfg.Get` and calls Postmark
in-process. This is the single-tenant path; a self-administered deployment
legitimately holds its own account token, and its behaviour is unchanged.

**Delegating** (`hosting/maildomains/`) — marshals the call to JSON, POSTs it
over `ctl.sock`, unmarshals the reply. Registered by `tenantboot` at boot,
which sets `claimed`. The tenant holds no token and cannot fall back.

`mail` calls `maildomains.Current()` and does not know which implementation it
received — identical to how it already reads `syscfg`. The mail package never
learns that hosting exists.

### Router side

Two routes on the existing ctl.sock mux (`hosting/internal/controlplane/deploy.go`),
alongside `/api/v1/deploy`:

```
POST /api/v1/maildomain/add     {"domain":"acme.com"} -> DomainRecords
POST /api/v1/maildomain/status  {"domain":"acme.com"} -> DomainRecords
```

`ctl.sock` is router-bound and tenant-dialed
(`hosting/internal/orgmanager/controlsock.go:33`). **Authentication is the
filesystem**: the socket lives in the org's 0700 tenant-uid directory, so the
dialer can only be that org's uid. The org is implicit in which socket the
request arrived on. Nothing is minted, rotated, or leakable.

The router reads `mail.postmark_account_token` from the control plane's
`control_settings.system_config` blob — the same store
`hosting/internal/controlplane/systemconfig.go` already manages — and calls
Postmark itself.

That key must therefore be **removed from the set pushed to tenants**. Today
`newProviderFromSystem` (`mail/server/register.go:441-442`) reads both tokens,
and an operator following the README would place both in syscfg. After this
change the account token is router-only: it stays in `system_config`, is
covered by a managed prefix so no org can set its own, and is filtered out of
the materialized `syscfg.json` and the `cfg.sock` push. The server token
continues to flow to tenants as it does now.

### Postmark account-level uniqueness

A domain is unique per Postmark account. If org A enrolls `acme.com`, org B's
later `CreateDomain("acme.com")` fails at Postmark, because both orgs share the
operator's account.

This is not a permission gate and introduces none. It is an error path that
must be **legible**: the router maps Postmark's 422 to a distinct error, and
the UI renders "this domain is already configured on this host" rather than a
raw provider message. The first enrollment wins; no silent takeover is possible
either way, since neither org ever holds the token.

## One key in, not two

The account token can derive the server token, so requiring both is redundant
input. In `postmark@v1.9.0/servers.go`, `Server` carries
`APITokens []string` (line 17), and `GetServers` / `GetServer` are
account-token calls (lines 171, 189) that return it populated.

`mail.postmark_server_token` therefore becomes a **derived value rather than an
operator input**. Whoever holds the account token — the router when hosted, the
deployment itself when standalone — resolves the server token from Postmark and
caches it, instead of an administrator pasting a second key.

This removes a real failure mode, not just a setup step. Today nothing checks
that the pasted pair belongs together: a server token from a *different* server
than the account being managed produces a half-broken deployment where sending
works and domain verification silently does not, with no error pointing at the
mismatch.

Resolution rules:

- The token is resolved lazily on first need and cached in memory, refreshed on
  a Postmark auth failure. It is never written to a tenant's database.
- Which server is chosen: the single server on the account, or — when the
  account has several — the one named by an optional `mail.postmark_server_name`
  setting. If the account has multiple servers and no name is configured, that
  is a configuration error surfaced to the operator, never a silent pick.
- **Hosted:** the router resolves it and continues to push
  `mail.postmark_server_token` down through syscfg exactly as it does today.
  Tenants are unaffected — they still receive a server token and never see the
  account token. The change is purely in where that value originates.
- **Standalone:** the direct registrar resolves it from the deployment's own
  account token. An existing deployment that still has a server token stored
  keeps working — an explicitly configured value wins over derivation, so no
  migration is forced.

`mail.postmark_server_token` stays a supported settings key for that reason,
and for any deployment that deliberately wants to supply a scoped token without
handing tinycld account-level access.

**The router is a credential proxy, not a policy checkpoint.** It does not
decide whether an org may have a domain. Tenant admins and owners create their
own `mail_domains` rows freely and will commonly have several; that stays
entirely the tenant's business and requires no operator involvement. The router
is involved solely because the account token cannot live in a tenant.

Consequently `org_mail_domains` is **not** used to gate these calls. It remains
what it is today: the operator-assigned inbound-MX routing registry.

## What stays in the tenant

`mail/server/domain_verify.go` keeps its three-check structure. Only
`checkOutbound` changes — from `provider.CheckDomainVerification` to
`maildomains.Current().GetDomain`.

| Check | Auth required | Location |
|---|---|---|
| `checkMX` (`LookupMX`) | none | tenant, unchanged |
| `checkProviderInbound` (`GetCurrentServer`) | server token | tenant, unchanged |
| `checkOutbound` (SPF/DKIM/return-path) | **account token** | **delegated** |

`CheckInboundDomain` genuinely uses the server token and stays in the tenant.
`Provider.AddDomain` and `Provider.CheckDomainVerification` are removed from the
mail `Provider` interface; their Postmark implementations move into the direct
registrar, and `SMTPProvider`'s pure-DNS `CheckDomainVerification` becomes an
SMTP registrar implementation (it needs no credentials and continues to work
unchanged for self-hosted SMTP).

The hourly re-verify loop (`mail/server/domain_verify_ticker.go`) keeps working
as-is; its outbound leg simply makes an extra unix-socket hop. No second
polling mechanism is built — this one already exists and is sufficient, with
the Verify button covering on-demand checks.

## Surfacing the DNS records

1. **Persist** the four record values into the existing `verification_details`
   JSON column (`mail_domains`, added by
   `mail/pb-migrations/1713000012_mail_domain_verification.js`, 10 KB budget).
   No migration required.
2. **Widen** `OutboundCheckResult` in `mail/server/api/api.go` to carry the
   record values alongside the booleans; regenerate `mail-api.ts`.
3. **Enroll on add.** The add-domain flow becomes a server endpoint that calls
   `maildomains.Current().AddDomain` and then writes the row, replacing the
   bare client-side insert. The records therefore exist before the customer is
   asked to publish anything.
4. **Display** them in `DomainVerificationPanel` as a copyable host/type/value
   table, reusing the clipboard affordance already built for `WebhookURLs`.
   This is the "View setup instructions" surface
   `mail/help/custom-domains.md` already documents.
5. **Correct the help topic** to describe what now actually happens.

## Error handling

- Registrar unset or unclaimed: `ErrNotConfigured`. The verify endpoint's
  existing `Configured()` 400 path covers it.
- ctl.sock unreachable: recorded as a *check* failure in
  `verification_details.outbound.error`, never as a domain failure. A transport
  problem must not mark a working domain broken.
- Postmark API error: the message is propagated; the token never is.
- Duplicate enrollment: distinct error, rendered as host-level duplication.

### Known defect, fixed here

`verified` is currently derived from MX + inbound-domain only
(`domain_verify.go:174`), so a domain Postmark has never heard of can display a
green "Verified" badge while being unable to send at all. Now that enrollment
is real and its state is retrievable, `verified` also requires that the
registrar knows the domain — for Postmark, that it is enrolled on the account.
The SMTP registrar reports "known" unconditionally, since a self-hosted
deployment enrolls nothing, so its `verified` semantics are unchanged.
SPF/DKIM/return-path remain advisory in both cases.

## Testing

- **Seam unit tests** — a fake `Registrar`; `mail` tests never reach Postmark.
  The existing `fakeProvider` in `domain_verify_test.go` is the model.
- **Router route tests** (`hosting/internal/controlplane`) — against a stub
  Postmark HTTP server, covering success, duplicate-domain, and provider error.
- **Boundary test** — assert `mail.postmark_account_token` never appears in a
  materialized `syscfg.json`, in a `cfg.sock` push body, or in any other
  tenant-reachable config, even when an operator has set it in
  `system_config`. This is the invariant the whole design exists to protect, so
  it is tested directly rather than inferred from the filtering code.
- **Parity test** — one seam contract exercised against both the direct and the
  delegating implementation, so single-tenant and hosted cannot drift.
- **Token derivation** — against the stub Postmark server: resolves and caches
  the server token from the account token; an explicitly configured server
  token wins over derivation; a multi-server account with no
  `mail.postmark_server_name` raises a configuration error rather than picking
  one; a Postmark auth failure invalidates the cache and re-resolves.
- **E2E** — add a domain through the UI and assert the DNS records render and
  are copyable, driving the UI rather than writing rows directly.

## Out of scope

- DNS automation. Publishing records stays the customer's work; no registrar
  API integration.
- DKIM signing. Still the provider's job; tinycld generates no keypair.
- **Per-org Postmark servers.** One account, one shared server, as today.
  Deliberately deferred rather than dismissed: now that the router holds the
  account token it *could* `CreateServer` per org (which returns a populated
  `APITokens`, `servers.go:201`) and give each tenant its own server token.
  That would be a genuine isolation win — one org's leaked server token
  currently exposes the whole fleet's sending, and every org's message streams
  share one Postmark server.

  It is out of scope here because it breaks assumptions this spec relies on:
  `mail.postmark_server_token` would become per-org, contradicting syscfg's
  "one value serves every org" model for that key; `CheckInboundDomain`
  (`mail/server/postmark.go:218`) documents that it assumes one server and
  would need `GetServers`; server lifecycle joins org provisioning and
  offboarding; and inbound webhook URLs are per-server, changing
  `webhook-urls` and inbound routing. Worth its own design.
- Custom web hostnames. Orgs remain at `<slug>.<base>` for HTTP and mail
  client configuration.
