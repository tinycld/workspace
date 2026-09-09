# GitHub Integration for Boards — Design

**Date:** 2026-09-09
**Status:** Approved design, pre-implementation
**Spans:** `tinycld` (core) + `boards` — core merges first (see *Delivery order*)

## Summary

Link GitHub pull requests to boards cards, and let the existing rules engine
move a card when its PRs merge. A PR is matched to a card by the card key
(`OTTER-123`) appearing in the branch name, PR title or PR body, or by an
explicit manual link. GitHub POSTs to a webhook; the receiver writes a
`boards_pr_links` row; a server-owned rollup derives `pr_state` on the card;
four new triggers fire off that column and the shipped `move-card` action does
the rest.

Two of the three layers are generic and land in **core**, because Zapier is the
next integration and needs both: a `core:post-webhook` action (outbound) and a
`webhookin` receiver (inbound transport). Only the GitHub *interpretation* —
"this branch names OTTER-123, and all its sibling PRs have now merged" — lives
in boards.

This closes TODO item 24 and unblocks the outbound half of item 23.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Where the code lives | Boards owns GitHub meaning; core owns generic webhook transport both directions |
| `org-github` as host | **Rejected — it is not a package.** It is the GitHub org profile repo (`profile/README.md` + a hero SVG). TODO item 24's instruction cannot be followed as written |
| Enablement | No preference switch. Git is inactive until a board is linked to a repo; the connection *is* the enablement |
| Transport | Webhook only. GitHub retries failed deliveries and offers manual redelivery; no poller, no reconciling sweep |
| Auth | GitHub App, self-registered per deployment, credentials in `system_settings` (`is_secret`) |
| Linkage | Branch name + PR title/body + manual link. **Not** commit messages |
| Multi-PR semantics | **All linked PRs must merge** (Linear's rule), not first-merge (Jira's) |
| Triggers | PR opened, PR merged, review requested, PR approved. **Not** draft, **not** closed-unmerged |
| PR state vocabulary | Two columns: provider-neutral `state`, provider-specific `review_state` |
| Automation surface | Rule triggers in the existing engine, not a bespoke settings block |

**Rejected approaches.** A polling fallback (rejected once the reachability
premise was corrected — see *A corrected premise* below). A generic inbound
row-writer that lets any webhook write any collection (rejected: it routes
around the access rules, which are boards' entire authorization story). Hosting
the integration in core as a named GitHub feature (rejected: CLAUDE.md forbids
core naming a package or a vendor surface; the registry pattern is the
sanctioned route).

### A corrected premise

An earlier draft of this design proposed a polling fallback, on the reading
that self-hosted instances bind to `127.0.0.1` and so cannot receive webhooks.
**That reading was wrong.** `127.0.0.1:8090` is the *first-run, pre-setup*
default in `2026-09-09-single-binary-distribution-design.md`; any configured
deployment sets `--http`/`--https`. The product already assumes public
reachability — inbound SMTP, share links opened by outside people, and
`mail_domains.webhook_secret`, which exists precisely because an external
provider already POSTs to these instances.

Recorded because the rejected design was more than twice the size, and the
premise is the only thing that justified it.

## Architecture

```
GitHub ──POST──▶ core/webhookin ──dispatch──▶ boards github handler
                 (HMAC, dedupe,              (parse keys, write links)
                  rate-limit, log)                     │
                                                       ▼
                                            boards_pr_links rows
                                                       │
                                              pr_rollup.go (server)
                                                       │
                                                       ▼
                                     boards_cards.pr_state / pr_review_state
                                                       │
                                            ┌──────────┴──────────┐
                                            ▼                     ▼
                                    automation triggers      PR chip on card
                                    (pr-opened, pr-merged,   (one model, two
                                     -review-requested,       readers)
                                     -approved)
                                            │
                                            ▼
                                    move-card (already ships)


rule fires ──▶ core:post-webhook ──POST──▶ Zapier / anything
              (SSRF-guarded, signed, rate-limited)
```

### The load-bearing insight

**Every trigger in boards is a row change in a collection.** There is no
"external event" trigger type in the engine (`core/server/automation/`), and
this design does not add one. `comment-reacted` fires on a create in
`boards_comment_reactions`; `card-overdue` fires on a stamp column being set.

So the webhook's entire job is to write a row. The rules engine — conditions,
actions, run logging, the builder UI — is reached through machinery that
already exists and needs no modification.

The corollary drives the schema: `boards_pr_links` carries a denormalized
`project`, for exactly the reason `boards_comment_reactions` carries `card`.
`cardOwnerResolver` (`boards/server/automation.go`) reads `project`, and already
serves all 16 boards triggers across three collections (`boards_cards`,
`boards_comment_reactions`, `boards_sprints`). A PR-link row plugs into the
existing owner resolver with **no new authorization machinery**.

### One model, two readers

The research surfaced a design smell in Jira worth naming so it is not
reproduced: Jira's *display* layer computes the correct all-merged semantic
("MERGED if there are no open pull requests, and at least one has merged")
while its *automation* layer cannot reuse it — automation smart values are
bound to the single triggering event, so a rule fires on the first merge even
though the panel beside it knows better.

`pr_state` on the card is computed **once**, server-side, and read by both the
PR chip and the trigger filters. They cannot disagree.

## Core layer 1 — outbound (`core:post-webhook`)

`core/server/automation/actions_webhook.go`, modelled directly on the adjacent
`actions_email.go`.

Native-in-core, for the reason that file already gives for email: it ships in
every build regardless of installed packages, so an org gets "POST to Zapier
when X" whether or not it installed boards. This makes all 16 existing boards
triggers — and every other package's — a Zapier source immediately.

| Param | Meaning |
|---|---|
| `url` | Destination. Templatable |
| `secret` | Optional. When set, body is signed `X-TinyCld-Signature-256: sha256=…` |

Body is the trigger payload's fields as JSON.

Three controls, each with a specific precedent:

- **SSRF.** Lift `isDisallowedIP` and `newPinnedTransport` from
  `calendar/server/subscription.go` into a shared core helper. That
  implementation is already thorough — loopback, RFC 1918, IPv6 ULA,
  link-local including cloud metadata (`169.254.169.254`), CGNAT — and it
  re-resolves at dial time and connects to the verified IP, closing the
  DNS-rebinding window a standalone pre-check leaves open. This is the guard
  TODO item 23 names as the blocker for `core:webhook`.
- **Redirects are NOT followed.** The calendar fetcher re-validates each hop,
  which is right for a GET. A POST that follows a 302 re-sends its body — and
  its signature — to a host the rule author never named. Fail instead.
- **Rate ceiling**, per rule per hour, keyed on the rule exactly as
  `maxEmailsPerRulePerHour` is, and for the same loop-control reason recorded
  there: two systems each doing one hop can loop forever.

Timeout and `DisableKeepAlives` as the calendar transport sets them.

## Core layer 2 — inbound (`core/server/webhookin/`)

**Transport only.** It verifies, dedupes, rate-limits, logs, and dispatches. It
writes no domain rows and knows no collection names.

| Concern | Behavior |
|---|---|
| Signature | HMAC-SHA256 over the raw body, constant-time compare. Raw bytes must be captured before any JSON decode |
| Replay | Dedupe on a provider-supplied delivery id (GitHub: `X-GitHub-Delivery`), stored with a TTL |
| Rate limit | Per registered source, reusing `core/server/ratelimit` |
| Dispatch | To a handler the package registered |

Packages register at boot, following the registry pattern CLAUDE.md mandates
so that **core never names a package**:

```go
// boards/server/register.go
webhookin.Register("github", webhookin.Source{
    Secret:     secretLookup,
    DeliveryID: func(r *http.Request) string { return r.Header.Get("X-GitHub-Delivery") },
    Handle:     handleGitHubEvent,
})
```

Same shape as `oauth.RegisterPackage`, `search.RegisterSources`,
`quota.RegisterSources`.

**Why the receiver does not write rows.** A generic "any webhook may write any
collection" facility would bypass the PocketBase access rules. CLAUDE.md is
explicit that boards is rule-first — the rules are the entire authorization
for any caller that does not pass through a hook — and `boards/server/register.go`
restates it. Interpretation stays in the package that owns the schema.

## Boards layer — GitHub meaning

### Schema: `boards_pr_links`

One row per (PR, card) pair.

| Column | Type | Notes |
|---|---|---|
| `card` | relation → `boards_cards` | |
| `project` | relation → `boards_projects` | Denormalized. Feeds `cardOwnerResolver` |
| `repo` | text | `owner/name` |
| `number` | number | PR number |
| `url`, `title`, `author` | text | Display |
| `state` | select | **Provider-neutral:** `open` / `merged` / `closed` |
| `review_state` | select | **Provider-specific,** nullable: `in_review` / `approved` |
| `link_source` | select | `branch` / `title` / `body` / `manual` |
| `unlinked` | bool | Tombstone — see *Sticky inference* |

`UNIQUE (repo, number, card)`.

**Why two state columns.** `state` is what any forge or a Zapier-driven link
can honestly set, and it is what the rollup reads. `approved` and `in_review`
are GitHub review concepts that do not transfer. Folding them into one enum
would mean a later GitLab or Zapier source either abuses `approved` to mean
something slightly different, or needs the enum reinterpreted — and per
CLAUDE.md, appending values to a released migration is allowed while
reinterpreting one is not. Settling this now is cheaper than a migration later.

### Linkage matching

Scan the PR head branch, title, and body for `[A-Z0-9]+-[1-9][0-9]*`, resolved
through the existing `parseCardKey` grammar. The Go half already exists in
`boards/cli/key.go` and is held in step with `lib/card-key.ts` by paired test
tables — extend both tables, per the warning in that file's header.

Case-insensitive on the slug (`parseCardKey` already uppercases). Leading zeros
rejected, as it already does. Multiple keys in one PR link multiple cards.

Commit-message scanning is **out of scope**: it multiplies webhook volume
across every branch, and Jira's equivalent (Smart Commits) fails silently when
a committer email does not resolve to exactly one user.

### Sticky inference — the failure mode that drives `unlinked`

From the research, and structural rather than incidental:

> Branch-name linkage is re-derived from immutable branch state on every
> webhook. A manual unlink deletes a derived fact, so the next push recomputes
> and restores it.

Linear's documented answer is `skip OTTER-123` / `ignore OTTER-123` in the PR
**description** — durable precisely because the description is mutable while
the branch name is not. Both halves are required here:

1. Unlinking a `branch`-sourced link sets `unlinked = true` as a tombstone;
   re-derivation skips tombstoned pairs.
2. `skip OTTER-123` / `ignore OTTER-123` in the PR body suppresses the link at
   source.

Without these, "I unlinked it and it came back" is a week-one bug report.

### Rollup (`boards/server/pr_rollup.go`)

Modelled on `epic_rollup.go`. On any change to a card's PR links, recompute:

- `pr_state`: `none` (no live links) / `open` (any link `open`) / `merged`
  (links exist, none `open`, at least one `merged`) / `closed`.
- `pr_review_state`: highest review state across live links.

**All-merged** falls out of "no link remains `open`". Server-owned, like the
epic rollup and `list_changed_at`; no client writes it.

### Triggers

Four, all watching card columns, gated by `RegisterTriggerFilter` exactly as
`sprintBecameActive` gates the sprint triggers — checking `Original()` so a
same-state re-save cannot fire.

| Trigger | Watches | Filter |
|---|---|---|
| `boards:pr-opened` | `pr_state` | `none → open` |
| `boards:pr-merged` | `pr_state` | `open → merged` |
| `boards:pr-review-requested` | `pr_review_state` | `→ in_review` |
| `boards:pr-approved` | `pr_review_state` | `→ approved` |

All four register `cardOwnerResolver`, joining the list in `registerAutomation`.

**No new actions.** `move-card` ships already.

Draft PRs are deliberately not a distinct trigger, and closed-unmerged is not a
trigger. Both were considered and dropped; Linear notably has no
closed-unmerged event either.

### Auth and setup

GitHub App, **self-registered per deployment**. Admin → Settings → GitHub walks
through `github.com/settings/apps/new` with a prefilled manifest; the callback
returns App ID, private key and webhook secret, stored in `system_settings`
with `is_secret = true` (never injected into the web bundle — see that
migration's header).

Per board: install on repositories, writing `boards_project_repos`.

Requested permissions, read-only: metadata, contents, pull requests. **No write
scopes.** Linear requests write on code, actions, workflows and issues in order
to post linkback comments; this design does not write back to GitHub at all,
so it should not ask for the ability to.

### Events subscribed

`pull_request` (opened, reopened, closed, edited, synchronize, ready_for_review)
and `pull_request_review` (submitted).

## The things that bite

Each drawn from a scar already recorded in this codebase.

1. **`boards/server/oauth_scopes.go` must be updated in the same PR.** That
   file records this bug twice in its own header: `boards_epics` shipped with
   no entry and was default-denied for the life of the feature, and the move
   endpoint 403'd for OAuth tokens while working for sessions. Add
   `boards_pr_links` and `boards_project_repos`.
   - The **connection** rows (`boards_project_repos`) are **read-only** for
     OAuth callers, following the reasoning that file already applies to
     `boards_project_members` and `boards_share_links`: a credential granting
     access to source repositories is a categorically larger grant than
     editing cards, and `boards:write` reads on a consent screen as "change my
     cards".
   - The **webhook route is unauthenticated** (HMAC-verified) and must be
     *excluded* from scope classification, not scoped.

2. **Actor attribution.** A PR merge has no session user, but `actor.go`
   captures who did what for activity rows and the automation engine resolves
   a rule owner. Webhook-driven writes need an explicit system actor;
   `boards_activity` rows should read as the integration, not as a person.

3. **`boards_activity.kind` gains `pr_linked` / `pr_merged`** by *appending* to
   the enum — the pattern `1980000016` already used for `link_added` /
   `link_removed`.

4. **Migrations are frozen once released** (CLAUDE.md). New migrations start at
   `1980000021`. The two-column state vocabulary was settled during
   brainstorming for exactly this reason.

5. **Cross-repo branch naming.** CLAUDE.md already instructs using one branch
   name across core and packages. That is precisely the case all-merged
   semantics protects: a card spanning `tinycld` and `boards` must not reach
   Done when only the core PR lands.

## Risks

**GitHub App viability in self-hosted contexts — verify before building.** The
research found that Jira Data Center rejects the GitHub App model outright,
because OAuth token refresh fails after 8 hours in that deployment shape. It is
*unverified* whether this applies here: a TinyCld deployment registers its own
App rather than consuming a vendor's, which is a materially different
arrangement, and installation-token refresh is a server-to-server flow.

**Mitigation:** spike this first. It is the one choice that is expensive to
reverse, since it shapes setup UX, stored credential shape, and the migration.
If it does not hold, the fallback is a fine-grained PAT per connection — same
schema, different credential column.

**Unverified upstream details**, flagged rather than assumed: Linear's exact
default branch-format string (three contradictory secondary sources), and its
published issue-ID regex (never published; only the `ID-123` shape). Neither
blocks this design — boards has its own key grammar — but do not cite them as
precedent without checking.

## Delivery order

CLAUDE.md: changes spanning core and packages either share a branch name, or
the core PR merges first.

1. **core** — `webhookin/`, `core:post-webhook`, SSRF helper extracted from
   calendar. Independently useful: it unblocks Zapier's outbound half and TODO
   item 23 with no boards work.
2. **boards** — migrations, webhook handler, rollup, triggers, UI, CLI,
   `oauth_scopes.go`, help topic.

Shared branch name `feat/github-integration` if run concurrently.

## Testing

- **Rules:** `*_rls_test.go` for the new collections, plus an entry in the
  shipped-rules table (`server/shipped_rules_test.go`) — that table exists
  because drive lost a guest-exclusion clause when a migration restated a rule.
- **Matching:** extend the paired tables in `cli/key_test.go` and
  `lib/card-key.test.ts` together.
- **Rollup:** the all-merged transition with 1, 2 and 3 links; a tombstoned
  link; re-derivation after a push.
- **Triggers:** `Original()`-based filters must not fire on a same-state
  re-save — the case the existing filters in `server/automation.go` already
  guard by checking `Original()`.
- **Webhook:** signature rejection, replay dedupe, oversized body, unknown
  source.
- **SSRF:** reuse calendar's cases, plus a redirect-to-internal case asserting
  the POST is refused rather than followed.
- **`oauth_scopes_test.go`:** the new collections appear with the intended
  access, pinning the surface as that file's header requires.

## Out of scope

- Write-back to GitHub (linkback comments, status checks). Linear's docs name
  linkbacks as its main notification-noise complaint.
- Commit-message scanning and Jira-style smart commits.
- Draft-PR and closed-unmerged triggers.
- GitLab, Bitbucket, and Zapier's *inbound* direction — the receiver is built
  generic to accept them; wiring them is separate work.
- Branch creation from a card, and a "copy branch name" affordance. Worth
  revisiting once linkage proves out; the key grammar already supports it.
- Cumulative flow and the rest of TODO item 21.
