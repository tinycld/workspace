# mail

Full email for your organization — threaded conversations, rich-text composer, attachments, delivery tracking, a privacy-preserving image proxy, custom domains, and native IMAP + SMTP servers so any desktop or mobile mail client just works.

A feature package for the [tinycld](https://tinycld.org/) ecosystem. Lives as a standalone git repo alongside the [`tinycld`](https://tinycld.org/) app shell and other sibling packages (`drive`, `contacts`, `calendar`, `calc`, `text`, `google-takeout-import`). The app shell bundles `@tinycld/core` inside it — there is no separate core repo to clone.

## What it does

Sits on top of a transactional mail provider (Postmark today, pluggable in code). Outbound mail flows through the provider's REST API; inbound mail arrives via a webhook from the provider after DNS routing; in between, Mail holds the canonical record of every message in PocketBase with proper threading, per-user state, and an SQLite FTS5 search index.

User-facing features:

- **Personal and shared mailboxes** — every user gets a personal mailbox auto-created when they join an org; shared mailboxes can have additional members with `owner` or `member` roles. Personal mailboxes are cleaned up when their `user_org` is removed.
- **Mailbox aliases** — multiple addresses per mailbox (`support@`, `help@`, `contact@` all landing in the same mailbox). The compose window's **From** picker exposes the primary plus every alias; replies use whichever address the inbound message was sent *to*.
- **Threaded conversations** — server-side grouping using RFC 5322 `In-Reply-To` and `References` headers, with a normalized-subject fallback. Per-thread read / starred / folder state is **per-user-org**, so shared-mailbox members don't step on each other's read state.
- **Folders** — Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash, Archive. Starred is a flag (orthogonal to folder); the other six are mutually-exclusive `folder` enum values on `mail_thread_state`. All Mail is a view that ignores folder placement.
- **Unified All Inboxes** — when a user has 2+ mailboxes, a synthetic "All Inboxes" entry tops the sidebar with the union of new unread threads across every mailbox.
- **Rich-text composer** — web and native editors (web is contenteditable, native is a separate component), with attachments, inline images via `cid:` rewriting, recipient autocomplete (sources from [Contacts](help://contacts:getting-started) when installed), and auto-saved drafts.
- **Delivery tracking** — every outgoing message carries a `delivery_status` enum (`draft` | `sending` | `sent` | `delivered` | `bounced` | `spam_complaint`). The bounce webhook updates the status as Postmark callbacks arrive.
- **Privacy-preserving image proxy** — all external images in inbound HTML are rewritten to `/api/mail/image-proxy?token=<auth>&url=<original>`. The proxy fetches images server-side with a 1-hour in-memory cache (500-entry LRU), refuses private IPs (SSRF guard), and caps responses at 10 MB. Senders see your server's IP and not your browser.
- **HTML sanitization** — every inbound HTML body is run through `bluemonday`'s UGC policy with table support enabled, before it touches a client. `<script>`, `<iframe>`, `<form>`, event handlers, and unsafe URL schemes are stripped; tables and inline styles for common elements are preserved so corporate templates still render.
- **Attachment thumbnails** — server-side thumbnail generation via `core/thumbnails` for PDFs, Office docs, EPUBs, and HEIC photos. Plain images get on-demand `?thumb=` via PocketBase. Generated asynchronously on the same hook that fires for new messages.
- **Custom domains** — verify your own domain end-to-end (MX → Postmark inbound, plus SPF / DKIM / Return-Path for outbound) from the Provider settings screen. A background ticker reverifies pending domains every hour so DNS propagation eventually flips them green automatically.
- **Postmark integration** — outbound via the Postmark REST API, inbound via per-domain webhook secret URL, bounce / spam-complaint callbacks via a parallel webhook. The provider abstraction (`server/provider.go`) is pluggable, but Postmark is the only implementation today.
- **IMAP server** (port **993** implicit TLS in prod, `:1143` plain in dev) — full read / state-sync support via `github.com/emersion/go-imap/v2`. IDLE for push, UID validity for offline-safe sync, RFC 5322 message fetch, namespacing across mailboxes. Apple Mail, Thunderbird, mutt, mobile clients all work.
- **SMTP submission** (port **465** implicit TLS in prod, `:1587` plain in dev) — send via any mail client using TinyCld credentials. Validates the `From:` header against actual mailbox / alias ownership before submitting to the provider. 25 MB total message size cap.
- **Labels** — colored tags attached to `mail_thread_state` (per-user-org), backed by core's unified `labels` / `label_assignments` collections shared with [Contacts](help://contacts:labels) and other packages.
- **Search** — SQLite FTS5 across subject, snippet, sender name / email, recipient names / emails, message body (HTML-stripped), and attachment filenames. Prefix matching (`joh*`). Advanced filters: from / to / subject substrings, has-attachment, before / after dates, "has words" / "doesn't have words" with FTS `NOT`. Filters can be typed inline as `key:value` or set via the Advanced panel.
- **Realtime updates** — message arrivals, read-state changes, and folder moves propagate via PocketBase's built-in collection-realtime subscriptions (`pbtsdb` `useLiveQuery`). IMAP IDLE notifications are dispatched through an internal mailbox-keyed notifier so IMAP clients see new messages within a second.
- **Audit logging** — `mail_domains`, `mail_mailboxes`, `mail_mailbox_members`, `mail_mailbox_aliases`, `mail_messages`, and `mail_thread_state` all register with `core/audit`, with per-collection `ResolveOrg` callbacks walking up through `mailbox → domain → org`.
- **Notifications** — new-message arrivals are buffered per-user and dispatched in batched core-notify pings every two minutes, so users get one summary notification per cycle instead of one per message.

## Mounting with IMAP and SMTP

For users connecting Apple Mail, Thunderbird, DAVx5, mutt, or any other standard mail client:

| Protocol | Port (prod) | Encryption  | Auth                       |
|----------|-------------|-------------|----------------------------|
| **IMAP** | **993**     | implicit TLS | TinyCld email + password |
| **SMTP** | **465**     | implicit TLS | TinyCld email + password |

There's also a `/.well-known/webdav` style discovery for IMAP via the standard `_imaps._tcp` SRV record if you set one up; no equivalent for SMTP. Most clients prompt for the hostname and port directly.

Per-client connection walkthroughs (Apple Mail macOS / iOS, Thunderbird, mutt) live in the in-app help topics `mail:imap` and `mail:smtp` — they live there rather than in this README so they stay in sync with what users actually see in those clients.

In dev mode, plain listeners run on `:1143` (IMAP) and `:1587` (SMTP) with optional STARTTLS so curl / openssl-based testing is easy. Set `IMAP_ENABLED=false` or `SMTP_ENABLED=false` to disable either server.

## Theory of operations

The short version: every message is a `mail_messages` row owned by a `mail_threads` row owned by a `mail_mailboxes` row owned by a `mail_domains` row owned by an `org`. Per-user state (read, starred, folder, labels) is a separate `mail_thread_state` row per `(thread, user_org)`. The mail provider (Postmark) is an HTTP API for outbound and a pair of webhooks for inbound + bounces. IMAP and SMTP are network servers wrapping the same collections.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client (React Native / web)                                         │
│                                                                      │
│   Sidebar  ThreadList  ThreadView  Compose  ProviderSettings         │
│                       │                                              │
│                       ▼                                              │
│   pbtsdb useLiveQuery  +  useLabels / useLabelMutations (core)       │
│                       │                                              │
│                       ▼                                              │
│   PocketBase REST + realtime subscriptions ──────┐                   │
└──────────────────────────────────────────────────┼───────────────────┘
                                                   │
┌──────────────────────────────────────────────────┼───────────────────┐
│  Server (Go, PocketBase + tinycld.org/core)      │                   │
│                                                  ▼                   │
│   Collections                                                        │
│     mail_domains, mail_mailboxes, mail_mailbox_members,              │
│     mail_mailbox_aliases, mail_threads, mail_messages,               │
│     mail_thread_state, mail_imap_mailbox_state, fts_mail_threads     │
│                                                                      │
│   Hooks (register.go)                                                │
│     OnRecordAfterCreate(user_org):       auto-create personal mbox   │
│     OnRecordAfterDelete(user_org):       reap orphan personal mboxes │
│     OnRecordCreate(mail_domains):        auto-generate webhook secret│
│     OnRecordAfter*(mail_threads):        sync fts_mail_threads       │
│     OnRecordAfter*(mail_messages):       sync FTS + thumbnails +     │
│                                          IDLE notifier + notify batch│
│     OnRecordAfterUpdate(mail_thread_state): IDLE notifier            │
│                                                                      │
│   API endpoints (register.go)                                        │
│     POST  /api/mail/send                          (auth)             │
│     POST  /api/mail/draft                         (auth)             │
│     GET   /api/mail/search                        (auth, FTS)        │
│     POST  /api/mail/domains/{id}/verify           (auth, admin/owner)│
│     GET   /api/mail/domains/{id}/webhook-urls     (auth)             │
│     POST  /api/mail/inbound/{token}               (webhook secret)   │
│     POST  /api/mail/bounces/{token}               (webhook secret)   │
│     GET   /api/mail/image-proxy?token=...&url=... (auth via token)   │
│                                                                      │
│   IMAP server                                                        │
│     :993  implicit TLS (prod) / :1143 plain (dev)                    │
│     Login → PocketBase ValidatePassword                              │
│     IDLE supported; UID validity per mailbox                         │
│                                                                      │
│   SMTP submission server                                             │
│     :465  implicit TLS (prod) / :1587 plain (dev)                    │
│     Login → same; From-header ownership check                        │
│     25 MB max message; SMTPUTF8                                      │
│                                                                      │
│   Background loops                                                   │
│     startDomainReverifyLoop  (hourly re-verify of pending domains)   │
│     startMailBatcher         (per-user new-mail digest every 2 min)  │
└──────────────────────────────────────────────────────────────────────┘
```

### Collection layout

```
mail_domains
  org, domain, webhook_secret, verification_details (json)
mail_mailboxes
  domain, address (local part), display_name, type ('personal'|'shared'), name
mail_mailbox_members
  mailbox, user_org, role ('owner'|'member')
  UNIQUE(mailbox, user_org)
mail_mailbox_aliases
  mailbox, address (local part)
mail_threads
  mailbox, subject, last_message_at, message_count, has_attachments
mail_messages
  thread, sender_*, recipients_*, subject, html_body, plain_body,
  attachments (file list), attachment_thumbnails (file list),
  cid_map (json), delivery_status, message_id, in_reply_to, references,
  total_size, alias (relation, nullable)
mail_thread_state
  thread, user_org, folder ('inbox'|'sent'|'drafts'|'trash'|'spam'|'archive'),
  read, starred
mail_imap_mailbox_state
  mailbox, uid_validity, uid_next   (one row per mailbox; UNIQUE(mailbox))
fts_mail_threads
  FTS5 virtual table mirroring mail_threads (subject, snippet, sender, recipients)
fts_mail_messages
  FTS5 virtual table mirroring mail_messages (body, attachments names)
mail_folder_counts
  SQL view aggregating counts per (mailbox, user_org, folder)
```

The folder-counts view (`1830000000_create_mail_folder_counts_view.js`) is what the sidebar's per-folder badge numbers query — a single materialized COUNT per mailbox × user_org × folder, so the sidebar doesn't run six separate filtered counts per mailbox.

### Threading

`findOrCreateThread(mailboxID, subject, inReplyTo, references)` in `store.go` is the single entry point. The matching priority:

1. If `In-Reply-To` is set, look up an existing message with that `message_id`; if found, return its thread.
2. Otherwise walk the `References` chain from newest to oldest, returning the first thread that has a matching message.
3. Otherwise normalize the subject (strip `Re:` / `Fwd:` / etc.) and look up the most recent thread in the same mailbox with the same normalized subject; if found within a recency window, return it.
4. Otherwise create a fresh thread.

Two unrelated emails with the same subject won't merge as long as one of the first two strategies fires — which is true for any reply-driven conversation. The subject-match fallback is the only path that can produce false-positive merges, and the recency window keeps that to a minimum.

### Inbound flow

A message arrives at `support@example.com`:

1. **DNS / Postmark** — `example.com`'s MX records point at `inbound.postmarkapp.com`. Postmark accepts the message.
2. **Postmark webhook** — Postmark POSTs the parsed JSON to `/api/mail/inbound/{webhook_secret}` on your TinyCld instance, where the secret is the 32-character hex `webhook_secret` stamped onto `mail_domains` at creation time.
3. **Auth** — TinyCld's handler validates the secret via `isValidDomainWebhookSecret` (looks up the domain whose secret matches). Note: the URL itself is the credential — there's no signature, because Postmark uses URL-based auth for inbound webhooks.
4. **Parse** — `provider.ParseInbound(body)` produces a normalized `InboundMessage` with sender, recipients, subject, headers, HTML / plain bodies, and attachments.
5. **Resolve recipients** — for each `To` recipient, find a `mail_mailboxes` row with matching `(domain, address)` or a `mail_mailbox_aliases` row with matching `(mailbox.domain, address)`. Unmatched recipients are logged and dropped (no bounce sent back).
6. **Store** — `storeMessage` finds-or-creates the thread, inserts the `mail_messages` row, persists attachments (one PB file per attachment plus generated thumbnails), and creates `mail_thread_state` rows for every member of the mailbox with `folder='inbox'`, `read=false`.
7. **Sanitize** — the HTML body is run through `sanitizeEmailHTML` (bluemonday UGC + tables + cid scheme) before persistence. Plain-text version is kept verbatim.
8. **CID rewriting** — `buildCIDMap` zips each attachment's `Content-ID` header (normalized to strip angle brackets and `cid:` prefix) with its stored filename, persisted on `mail_messages.cid_map` as JSON. The client uses this map to rewrite `<img src="cid:...">` to actual file URLs at render time.
9. **Post-hooks** — FTS sync, attachment thumbnail generation (`generateAttachmentThumbnails` via `core/thumbnails`), IMAP IDLE notifier ping for any connected IMAP clients of this mailbox, and buffered notification dispatch.

### Outbound flow

Composing a message in the web UI:

1. Draft auto-save POSTs to `/api/mail/draft` every few keystrokes. The handler upserts a `mail_messages` row with `delivery_status='draft'`, threaded into a draft thread if one exists (matched on the in-progress message's `In-Reply-To` for replies, or a fresh thread for new compositions).
2. Hit Send → `POST /api/mail/send`. The handler validates: the user owns the From mailbox / alias, the To list is non-empty, the message size is under 25 MB.
3. The send handler flips `delivery_status` to `sending`, then calls `provider.Send(message)` — for Postmark, this is `POST /email` with subject, body, recipients, attachments base64-encoded.
4. On success, the provider returns a `MessageID` that gets persisted on the `mail_messages` row as `message_id`, and `delivery_status` flips to `sent`.
5. Postmark eventually POSTs delivery, bounce, or spam-complaint callbacks to `/api/mail/bounces/{webhook_secret}`. The handler looks up the message by its `message_id` and updates `delivery_status` to `delivered`, `bounced`, or `spam_complaint`.
6. If `provider.Send` fails synchronously, the message stays in `sending` and the API returns the error to the client (so the Send button shows the failure).

### SMTP submission server

`server/smtp_server.go` is a thin wrapper around `github.com/emersion/go-smtp`. The session backend (`smtp_session.go`):

- **AUTH** validates email + password via `app.FindAuthRecordByEmail("users", ...) + ValidatePassword`.
- **MAIL FROM** records the sender address.
- **RCPT TO** is accepted unconditionally (the recipient validity is the provider's job, not ours).
- **DATA** parses the incoming RFC 5322 message, **validates** the `From:` header is one of the authenticated user's mailbox primaries or aliases — if not, return `550 You don't own this address`.
- Hands the message off to the same `provider.Send` path as the web UI.

The 25 MB limit is enforced via `smtp.Server.MaxMessageBytes`. UTF-8 (`SMTPUTF8`) and 60-second read / write timeouts are set.

### IMAP server

`server/imap_server.go` wraps `github.com/emersion/go-imap/v2/imapserver`. Per-session state lives in `imapSession` (`imap_session.go`):

- **LOGIN** — same auth as SMTP. Loads every `user_org` for the user, then every `mail_mailbox_members` row, then materializes a per-mailbox namespace in the form `<orgSlug>/<mailbox-name>` (or just the mailbox name when the user is single-org).
- **LIST** — returns the standard set: `INBOX`, `Sent`, `Drafts`, `Trash`, `Spam`, `Archive`, with the appropriate `\Sent` / `\Drafts` / `\Trash` / `\Junk` / `\Archive` special-use flags.
- **SELECT** — opens a mailbox/folder, returning UID validity and UID next. UID validity and the next-UID counter live on `mail_imap_mailbox_state`, keyed per-mailbox (one row per `mail_mailboxes` record, regardless of how many members it has). UID assignment is serialized through an in-process per-mailbox mutex (`mailboxUIDMutex`) so monotonicity is guaranteed under concurrent inbound writes.
- **FETCH** — converts `mail_messages` rows to RFC 5322 bytes on the fly via `imap_rfc5322.go`. This is the only place TinyCld emits raw RFC 5322 — internally everything is structured fields.
- **IDLE** — the session subscribes to a per-mailbox channel via the package's `globalNotifier`. When the package-level hooks see a new `mail_messages` row or a `mail_thread_state` change for a mailbox, they `globalNotifier.notify(mailboxID)`, which wakes up every IDLE'd session subscribed to that mailbox and dispatches an `EXISTS` / `EXPUNGE` / flag-update untagged response.

### Domain verification

`mail_domains` has a `verification_details` JSON column with four sub-results: MX, Postmark, Outbound (which itself splits SPF / DKIM / Return-Path), plus a top-level `ProviderConfigured` flag. `handleVerifyDomain` (`endpoints_verify_domain.go`) runs all four checks in parallel:

- **MX** — `net.LookupMX(domain)`, expected target is `inbound.postmarkapp.com`.
- **Postmark** — calls Postmark's API to confirm a server-side domain record exists for this domain and that inbound is configured.
- **Outbound** — looks up SPF (`v=spf1 ... include:spf.mtasv.net`), DKIM (CNAME at `<selector>._domainkey`), and Return-Path (CNAME at `pm-bounces`).

Per-domain verify runs are serialized via `verifyLocks` so the user-triggered Verify and the hourly background tick can't race.

`startDomainReverifyLoop` runs every hour: lists every `mail_domains` row whose verification is still incomplete (any of MX, Postmark, SPF, DKIM, Return-Path showing false) and re-runs verification. The result is persisted back to `verification_details`. So DNS records that propagate slowly eventually flip the row green without user intervention.

### Image proxy

The proxy endpoint at `/api/mail/image-proxy` is auth-gated by a *query token*, not a header — sandboxed iframes used for rendering HTML email bodies can't send custom headers. The token is a PocketBase auth token resolved via `app.FindAuthRecordByToken`; same token your web client already has.

The proxy validates the requested URL:

- Scheme must be `http` or `https`.
- Hostname must not resolve to a private / loopback IP (`isPrivateHost`, RFC 1918 + 100.64.0.0/10 + IPv6 ULA + link-local) — prevents using the proxy as an SSRF probe of internal services.
- Response must be under 10 MB.
- Follows at most 3 redirects.
- 15-second per-request timeout.

A 500-entry in-process LRU cache keys on the full upstream URL with a 1-hour TTL; cache hits don't re-fetch upstream. The cache is process-local — clustering would need a shared cache backend.

### Notification batcher

When a new `mail_messages` row is created, `bufferMailNotification` runs in a goroutine and pushes the message ID into a per-user buffer (`notify_batcher.go`). Every 2 minutes (`startMailBatcher` ticker), the buffer is drained: per user, every buffered message is collapsed into a single `mail.new` notification ("You have N new messages") dispatched via `core/notify`. This keeps mobile push storms in check when a long thread arrives.

If a user has zero buffered messages when the tick fires, nothing is dispatched — no idle pings.

### Cross-package coupling

- **Contacts (optional)** — when installed, the composer's recipient autocomplete queries `contacts` for matching names / emails alongside the org directory. If Contacts isn't installed, autocomplete falls back to org-directory-only.
- **Drive (planned)** — large attachments (>25 MB) could be diverted to Drive automatically with a share link inserted in the body. Not yet implemented.

Mail itself doesn't require any other package; it works standalone.

## Platform support

| Feature                              | Web | iPad |
|--------------------------------------|-----|------|
| Read / list / view threads           | ✅  | ✅   |
| Compose / reply / forward            | ✅  | ✅   |
| Attachments                          | ✅  | ✅   |
| Inline images                        | ✅  | ✅   |
| Star / archive / trash / move        | ✅  | ✅   |
| Labels                               | ✅  | ✅   |
| FTS search + advanced filters        | ✅  | ✅   |
| Provider / domain / mailbox settings | ✅  | ✅ (admin/owner) |
| Realtime / IDLE updates              | ✅  | ✅   |
| IMAP connection                      | OS-native (Apple Mail, Thunderbird, mutt) | — |
| SMTP submission                      | OS-native | — |
| Keyboard shortcuts                   | ✅  | external keyboard only |

iPhone (small phone screens) isn't supported yet.

## Server package layout

```
server/
    register.go                Register(app) — hooks, endpoints, IMAP/SMTP startup
    lifecycle.go               auto-create / reap personal mailboxes
    provider.go                Provider interface
    postmark.go                Postmark provider (REST + webhook signature)
    noop.go                    no-op provider for tests / unconfigured orgs
    aliases.go                 alias resolution + From-header building
    store.go                   findOrCreateThread, storeMessage
    sanitize.go                bluemonday HTML sanitization, plain-text extraction
    cid_rewrite.go             Content-ID normalization, cid_map builder
    thumbnails.go              attachment thumbnail generation
    domain_verify.go           MX / Postmark / SPF / DKIM / Return-Path checks
    domain_verify_ticker.go    hourly background reverify loop
    search.go                  fts_mail_threads / fts_mail_messages sync hooks
    endpoints_send.go          /api/mail/send
    endpoints_draft.go         /api/mail/draft
    endpoints_search.go        /api/mail/search (FTS + advanced filters)
    endpoints_inbound.go       /api/mail/inbound/{token}
    endpoints_bounce.go        /api/mail/bounces/{token}
    endpoints_verify_domain.go /api/mail/domains/{id}/verify
    endpoints_image_proxy.go   /api/mail/image-proxy
    imap_server.go             :993 / :1143 startup
    imap_session.go            per-connection state, LOGIN, namespacing
    imap_folders.go            INBOX / Sent / Drafts / Trash / Spam / Archive
    imap_idle.go               globalNotifier + IDLE response dispatch
    imap_uid.go                UID validity / UID next per (mailbox, user_org)
    imap_rfc5322.go            on-the-fly RFC 5322 emission for FETCH
    smtp_server.go             :465 / :1587 startup
    smtp_session.go            AUTH, From-header ownership check, DATA → Send
    tls.go                     shared TLS config resolution (env vars / autocert)
    notify_batcher.go          buffered new-mail notification batcher (2 min tick)
    auth.go                    HTTP Basic auth helper
    thread_markers.go          unread / has_attachments / first_draft markers
```

Go module: `tinycld.org/packages/mail`. Imports `tinycld.org/core/{audit,notify,thumbnails}` via the standard go.mod replace directive the app shell installs.

## Client package layout

```
tinycld/mail/
    manifest.ts            package manifest (slug, nav, sidebar, settings, server, help)
    sidebar.tsx            All Inboxes + per-mailbox sections + labels
    collections.ts         mail_* + label_assignments pbtsdb registration
    types.ts               MailSchema (merged into MergedSchema)
    seed.ts                sample data
    screens/
        index.tsx          thread list (folder / label / search aware)
        [id].tsx           thread view + inline reply
    settings/
        provider.tsx       Postmark settings + domain list
        mailboxes.tsx      mailbox CRUD + member CRUD + alias CRUD
    components/
        ComposeWindow + ComposeFields + ComposeToolbar + ComposeHeader
        InlineComposeForm + InlineReply
        FromIdentityPicker (mailboxes + aliases) + RecipientField + RecipientSuggestionList
        AttachmentRibbon + AttachmentStrip + AttachmentThumbnail + DropOverlay
        EmailHeader + EmailBody + EmailRow + EmailListToolbar + EmailDetailToolbar
        SearchBar + AdvancedSearchDropdown
        LabelBadge
        MailboxSidebarSection + UnifiedInboxSection
        RichTextEditor (.web / .native variants)
        ContactSuggestionsList (when Contacts is installed)
    hooks/
        useMailboxes + useMailboxFolderCounts + useDefaultMailbox
        useThreadListItems + useMailSelection + useMailListShortcuts
        useComposeState + useAttachments + useSaveDraft + useMailSendReadiness
        useMailEditor (.web / .native) + useOpenReply + useFileDrop
        useMailSearch + useRecipientSuggestions
        useMailBulkActions + useLabels
    stores/
        compose-store         zustand: open compose windows + their drafts
        sidebar-store         zustand: per-mailbox expand/collapse state
        thread-list-store     zustand: list selection, focus, scroll
```

## Development

```sh
# Clone the app shell and this package as siblings
cd ~/code/tinycld
git clone git@github.com:tinycld/tinycld.git
git clone git@github.com:tinycld/mail.git

# Install deps in the app shell
cd tinycld
npm install

# Link this package into the app shell
npm run packages:link ../mail

# Run the full stack (Expo + PocketBase + IMAP + SMTP servers)
npm run dev
```

By default `npm run dev` binds IMAP to `:1143` and SMTP to `:1587` (dev mode plain-text listeners). Set `IMAP_ENABLED=false` / `SMTP_ENABLED=false` to disable.

## Standalone checks

Lint and typecheck both run from the app shell — biome and TypeScript live there, and the app shell's tsconfig pulls in `expo`'s base config, `uniwind` type augments, and the live `~/types/pbSchema` generated from PocketBase, none of which a standalone invocation in this package can see. Biome's config lives in `tinycld/biome.json` and applies to every linked package (there is no `biome.json` in this repo).

```sh
cd ../tinycld
npm run packages:link ../mail    # only needed once per checkout
npm run lint                     # scans this package via the app's biome rules
npm run typecheck                # full app-shell tsc
npm run test:unit                # vitest, including this package's tests/
npm run test:go                  # go test on this package's server/
```

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and vitest on every push to `main` and every PR. It clones `tinycld/tinycld@main` into a sibling directory, installs the app shell's deps, links this package in, and runs the checks — exactly what a developer does locally.

## Package anatomy

- `manifest.ts` — single source of truth for capabilities (routes, nav, sidebar, settings panels, collections, migrations, server module, help)
- `package.json` — name, exports map, peer deps
- `tsconfig.json` — typecheck config (lint config lives in the app shell's `biome.json`)
- `pb-migrations/` — PocketBase migrations (symlinked into the app shell's server on `packages:generate`)
- `server/` — Go server module, registered by the generator
- `help/` — in-app help topics (markdown + frontmatter)
- `tests/` — vitest unit tests (sibling tests run from the app shell)
- `tinycld/mail/` — TypeScript source
