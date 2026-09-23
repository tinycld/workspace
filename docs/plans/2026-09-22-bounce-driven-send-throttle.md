# Bounce-driven send throttling

**Status:** planned. The enforcement half is built (see *Already shipped*);
this plan covers the detection half that drives it automatically.

**Goal.** When an org's outbound mail starts generating hard bounces or spam
complaints at a rate that threatens the sending reputation every org on the
host shares, hold that org to a trickle automatically and leave it there
pending a human review.

**Non-goal.** Automatic suspension. Suspending an org stops it being spawned
at all (`orgmanager/manager.go:427-431`), so it loses mail, drive, calendar
and the app together, and its inbound mail sits in senders' retry queues for
a few days before bouncing permanently — usually over one compromised
account. Throttling contains the same harm at a fraction of the blast radius.
Suspension stays a decision a human makes, through the existing
`POST /orgs/{slug}/suspend`.

## Already shipped

The lever exists and works today; only the automatic trigger is missing.

| Piece | Where |
|---|---|
| `sendquota` seam — `PerDay` + `PerHour`, zero means unlimited | `tinycld/core/server/sendquota/` |
| Enforcement, both windows, fails closed | `mail/server/send_gate.go` — `checkSendAllowed` |
| `Plan.MailSendsPerHour`, pushed per-org over that org's cfg socket | `hosting/limits/cache.go`, `hosting/limits/register.go` |
| `PushPlan(ctx, slug, p)` — live, per-org, no respawn | `hosting/internal/orgmanager/planpush.go:38` |

**An operator can throttle one org right now** with a single plan push. What
follows is what makes that automatic.

## Why the bounce webhook must move to the router

Three findings, each verified:

**There is one Postmark server for the whole fleet.** `SystemConfig` is
documented as "shared by every org on this host"
(`orgmanager/manager.go:249-259`), and `writeSyscfgConfig`
(`manager.go:1347-1359`) materializes identical content into every org dir.
Postmark configures its bounce webhook on the *server* object, so there is
exactly one bounce URL for every org.

**So the tenant-side endpoint cannot be the configured URL.** It is reachable
— `mail/server/register.go:335-339` builds it from the tenant's own `AppURL`,
and the frontrouter proxies it — but pointing the fleet's single bounce URL
at one org's hostname is obviously wrong. `hosting/` contains **no Postmark
webhook configuration code at all**, so today an operator sets that URL by
hand and it can only name one destination.

**A suspended or throttled org still needs its bounces counted.** If the
decision lived in the tenant, firing it would cut off the evidence that
justified it — and the evidence needed to lift it.

The precedent already points this way: hosted **inbound** mail does not use
Postmark's inbound webhook either. The router terminates :25 itself and
relays over each org's `mx.sock` (`hosting/internal/mailrouter/mx.go`).
Bounces are the same shape.

## Steps

### 1. Bounce classification (mail only, no hosting concepts)

**Self-contained and valuable on its own. Every later step depends on it.**

`handleBounce` (`mail/server/endpoints_bounce.go:13-69`) parses `BounceType`
and **throws it away** — everything collapses to `bounced` or
`spam_complaint`. A soft bounce (mailbox full, greylisting) is stored
identically to a hard one (the address does not exist), and only the hard one
signals abuse.

- Add to `postmarkBouncePayload` (`mail/server/postmark.go:151-159`) and
  `BounceEvent` (`mail/server/provider.go:54-61`): `From`, `TypeCode`,
  `Inactive`, and Postmark's bounce `ID`.
  - `From` is what step 4 attributes by. Note the *inbound* payload already
    parses it (`postmark.go:52`); the bounce one does not.
  - `TypeCode` is Postmark's stable numeric identifier; `Type` is a display
    string. Classify on the code, fall back to the string.
  - `ID` is what step 4 dedupes replays on.
- Classify into hard / soft / complaint. Keep `delivery_status` behaviour
  exactly as it is — the display status and the counting key are different
  things and must not be conflated.
- Unknown types **log and do not count**. Postmark adds types; a new one
  landing silently in the hard-bounce bucket is an unreviewed threshold
  change.

**What counts:** spam complaints (strongest signal — a human pressed the
button), hard bounces / blocked / bad-address, and `SpamNotification` (a
receiving server's filter saying the same thing). **What never counts:** soft
bounces, transient, DNS errors, auto-responders, unsubscribes,
address changes, manual deactivations.

### 2. Router-side bounce endpoint

**Decided:** hosting owns this handler. It is the fleet's single bounce
destination, and the URL an operator configures in Postmark.

- Mount `POST /api/mail/bounce/{secret}` on the control plane's existing
  route group (`internal/controlplane/provisioning.go:446`). **Not**
  superuser-gated — it is a webhook, and the shared secret is the auth, the
  same posture the tenant's per-domain secret already uses.
- The secret is fleet-wide, not per-org: there is one Postmark server and so
  one URL. Store it beside the other operator-owned values on the control
  plane, never in a tenant's DB. Rotating it means updating one field in
  Postmark, so make the value readable back to the operator.
- Reject an unknown or absent secret with a bare 404 rather than a 401 — a
  webhook endpoint that distinguishes "wrong secret" from "no such route"
  tells a prober it has found something.
- Attribute by sending domain: parse the bounce's `From`, take its domain,
  and resolve it with the **existing** `MailDomainLookup(domain) → slug`
  (`internal/controlplane/mail_domains.go:19-30`). No tenant change and no
  new vocabulary in mail.
- Dedupe on Postmark's bounce `ID`. Postmark retries, and an operator can
  replay from the dashboard — idempotent for *display* is not idempotent for
  a *counter*. Copy `claimDelivery` (`core/server/webhookin/receive.go:192`),
  which already implements exactly this with a unique index and retention.
- **Forward the raw body to the owning tenant** so `handleBounce` still marks
  the message and the user still sees "this bounced" in their Sent folder.
  Best-effort; must not block the 200 back to Postmark.
- An unattributable bounce is counted nowhere and logged. An uncounted bounce
  is a smaller problem than a misattributed one.

### 3. Per-org counters and evaluation

- Counters on the control plane, keyed by org and window. They must live
  router-side so a throttled org's bounces keep arriving and keep counting —
  that is what makes lifting the throttle evidence-based.
- The denominator (sends) is the tenant's; the numerator (bounces) is the
  router's. Fetch sends over the org's **cfg socket** — router-dialed,
  tenant-bound, no public route. Never over `ctl.sock`: that is
  tenant-dialed, and a tenant pushing "my bounce rate is fine" is a
  compromised tenant reporting zeros.
- **The pulled denominator is untrusted.** A tenant that inflates its send
  count drives the rate toward zero, which is why the absolute event floors
  below are not optional — a spam run trips on the numerator regardless of
  what the tenant claims.

**Thresholds** — all operator-tunable, stored in `control_settings` beside
the plans table, never in a tenant's DB:

| Signal | Rate | Min sends in window | Min events |
|---|---|---|---|
| Spam complaints | > 0.5% | ≥ 200 | ≥ 3 |
| Hard bounces | > 15% | ≥ 200 | ≥ 20 |

Rolling 7 days, evaluated hourly (matching the domain re-verification
ticker's cadence).

*Why not Postmark's own 5% / 0.1%:* those are **account-wide** across the
whole fleet. Setting each org's trip point at the account limit means an org
at 0.4% is unthrottleable while being four times the entire account's budget
on its own. Trip at ~5× the account limit and alert a human at 0.1%.

*Why the 200-send floor:* it answers "a brand-new org's first message
bouncing is 100%". Below 200 the rate is statistically meaningless and the
harm is negligible. It is also 2× the per-message recipient cap, so the
smallest possible trip is "two full-fanout messages and everything about them
was wrong".

*Interaction to check:* if an org's `MailSendsPerDay` is below ~30, the
200-send floor over 7 days is unreachable and this never fires. Worth a
startup log line.

### 4. The ladder

**Tier 1 — warn.** First breach: record it, notify the operator, notify the
org owner with the actual numbers and what to do. Nothing is restricted.

**Tier 2 — throttle.** Still in breach 24h later: push
`MailSendsPerHour = 5` (configurable). This is the real enforcement and it
works end to end today — `PushPlan` reaches one org live, and mail's gate
already refuses above it with a message pointing at an administrator.

**Decided: the org owner is told, by automated mail, when the throttle
lands.** They will discover it within minutes anyway — the next bulk send
fails — and a refusal they cannot explain is worse than one that arrives with
a reason. The mail states what was measured, what the ceiling now is, that it
lifts automatically in 48 hours, and how to ask for an immediate review.

This does tell an attacker inside a compromised org that they have been
noticed. Accepted, for two reasons: the throttle already announces itself the
moment they try to send, and step 5 disables the individual account before
the org-wide ladder reaches this tier in exactly the case where the attacker
is a user rather than the org.

Send it through core's mailer, not through the org's own mail package — it
must reach the owner while the org is throttled, and it must not consume the
org's throttled budget. Core's transactional path already bypasses mail's
send gate, so this works by construction.

**Decided: a throttle expires after 48 hours, or is lifted immediately on
review.** Both matter. Expiry stops an org being forgotten in a throttled
state when nobody gets to the review; manual lifting means a false positive
costs minutes rather than two days.

**The 48 hours is per-plan**, carried as a `Plan` field beside the ceilings
it governs (`MailThrottleHours`, say). A paying org with a contract and a
known human behind it reasonably gets a shorter hold than a free one, and the
value belongs with the other things a plan sells rather than as a constant.
Zero means "use the default" rather than "expires instantly" — the unlimited
convention does not fit a duration, so this is the one place the zero rule
differs and it must be commented as such.

- Store the expiry as a timestamp on the org, not a duration — a duration
  needs a start time anyway, and a timestamp survives a router restart. The
  plan supplies the length; the org row records when this particular throttle
  ends.
- A sweeper lifts expired throttles. There is an hourly precedent to follow
  in `cmd/serve-router/main.go:438` (`sweepBuilds`); this gets its own beside
  it. **Hourly granularity means a 48h throttle lifts somewhere in 48–49h.**
  State that in the notification rather than promising an exact hour.
- Expiry lifts the throttle; it does **not** clear the breach. If the org is
  still over threshold at the next evaluation it is re-throttled, which is
  the correct outcome and is why expiry is safe to automate.
- A manual lift **must** clear the counters, or the org re-trips within the
  hour and the operator concludes the feature is broken.
- Re-throttling after an expiry should escalate to a human rather than
  looping silently: a second throttle inside a week is a review, not a
  statistic.

**The throttle is visible in settings**, not only in the notification mail.
Someone whose sending has broken looks at mail settings, which is already
where the DNS verification state lives — so that is where this belongs too.

`GET /api/plan` (`hosting/limits/endpoint.go:30`) already serves the org's
resolved limits to any authenticated user, so this needs no new channel:
surface the hourly ceiling and the expiry timestamp through the existing
`Status`, and have the settings screen render them when the ceiling is set.
Show the expiry as a time, not a countdown — an hourly sweeper cannot honour
a ticking clock.

**Tier 3 — page a human.** Do **not** auto-suspend. If an org is still
generating complaints on a starvation send budget, that is a person's
decision with a person's context.

**Circuit breaker, mandatory.** Cap automatic throttles at 2 orgs per rolling
24 hours, fleet-wide. Any mechanism that can throttle N orgs automatically
can throttle all of them on a bug or a provider incident — a replayed week of
webhooks, a denominator that reads zero because a migration renamed a field.
Two is enough to stop a real incident and small enough that a bug pages
somebody instead of causing an outage. **If the recent-throttle count cannot
be read, assume it is at the cap and do not throttle.**

**Lifting** happens either way — automatically at expiry, or immediately on
review. See Tier 2 above for what each one clears.

### 5. Per-user containment (do this before Tier 2 fires org-wide)

The most likely real incident is **one phished account**, not an abusive org.
`mail_messages.sent_by` is server-owned and unforgeable —
`registerSentByGuard` (`mail/server/sent_by_guard.go`) blanks it on client
create and restores it on client update, precisely so a member cannot blame
their sending on someone else.

So: if ≥80% of an org's complaints in the window trace to a single `sent_by`,
**disable that user** (`users.disabled`, which core already enforces at auth
and refresh) and notify the org owner — and do not advance the org's ladder.
That turns the common case from an org-wide throttle into one account
lockout, which is what mature mail providers do.

The tenant should make this call locally: it already has the
`message_id → sent_by` join, and "disable one of my own users" is exactly the
authority a tenant should have.

## Fail-open / fail-closed

Three components, three postures — easy to get wrong by analogy.

| Component | Posture | Why |
|---|---|---|
| Mail's send gate (shipped) | **CLOSED** | Refusing costs one message, retried. Mail that left cannot be recalled. |
| Threshold evaluation | **OPEN** | "Failing closed" here means throttling an org because a number could not be computed. `limits/cache.go`'s rule applies: refuse only on a definite, successfully-computed over-limit. |
| Circuit breaker | **CLOSED** | If the recent-throttle count is unreadable, assume the cap is reached. Fail-closed in form, fail-open in effect — the safe direction either way. |

Specifically: a non-resident tenant, an unreachable cfg socket, a partial
stats read, or `Sent == 0` with non-zero bounces → **log loudly, do nothing**.
That last one is the classic bug: it reads as an infinite rate and is
overwhelmingly more likely to be a broken denominator than an org that sent
nothing and got fifty bounces.

## Risks

**A legitimate org with a stale list.** The most likely trigger by a wide
margin. Mitigated by hard bounces never escalating past Tier 2, the 15%
threshold being 3× Postmark's, and the 24h warning carrying the numbers.
Residual: a legitimate annual re-engagement send gets throttled mid-campaign.
That is the correct outcome; document it and offer a "tell us before a large
send" path.

**Joe-jobs are mostly self-defending.** Bounces from forged mail go to the
forged return-path, not to the fleet's Postmark server — Postmark only
reports on mail it actually sent. This is not luck: `checkDomainAuthenticated`
requires the return-path CNAME precisely so bounces route back to the
provider.

**Webhook replay** — covered by the `ID` dedupe in step 2, and it is the
difference between a counter and a corrupted counter.

**A throttled org's user experience.** They can still receive, still read,
still reply. They will see a refusal on a bulk send with a message telling
them to contact an administrator. That message is the whole UX of this
feature and should be reviewed as such.

## Sequencing

1. **Bounce classification** — mail only, self-contained, useful alone.
2. **Router bounce endpoint** + attribution + dedupe.
3. **Counters + evaluation** + thresholds in `control_settings`.
4. **Per-user containment** (step 5 above) — ship before the org-wide ladder.
5. **Ladder + circuit breaker**, with Tier 2 behind an operator flag
   defaulting **off** for the first release.

Steps 2–5 are hosting-only. Step 1 is mail-only. Nothing here needs a core
change — the seam already exists.

## Open questions

- **Does the operator want the throttle reason surfaced too**, or only its
  existence and expiry? Saying "your mail generated 40 spam complaints" is
  more actionable than "you are rate-limited", but it also tells a
  compromised account exactly what tripped the detection.
