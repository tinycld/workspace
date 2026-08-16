# Workflow Rules — Package Trigger & Action Catalog

Companion to `2026-08-11-workflow-rules-design.md` (engine design) and
`tinycld/docs/automation.md` (package-author authoring guide). This document is
the proposed **master catalog**: which triggers and actions each package should
contribute, in what order, with the per-package mechanics needed to build them.

**Status: design only.** Nothing here is implemented. The catalog exists so the
per-package work can be picked up in waves without re-deriving the mechanics
each time.

## Where the engine actually stands

The rules work landed in phases, and the phases are on different branches. Read
this before starting any package work — the base branch determines what you can
verify.

| Piece | Location |
|---|---|
| Engine: registry, actions, eval, engine, endpoints, schedule | `tinycld` **`main`** (`core/server/automation/`) |
| Authoring types + structural validation | `tinycld` **`main`** (`core/lib/automation/`) |
| `rules` / `rule_runs` collections | `tinycld` **`main`** (`core/server/pb_migrations/1990000000`, `1990000001`) |
| Generator: `gen-automation.ts` → `server/automation_defs.json` | `tinycld` **`main`** |
| `automation_catalog` collection, builder UI, rules screens | `tinycld` **`feat/workflow-rules-ui`** — *not merged to main* |
| `docs/automation.md` authoring guide | `tinycld` **`feat/workflow-rules-ui`** — *not merged to main* |
| Only shipped package declarations | `mail` — one trigger, zero actions |

Two consequences for whoever implements a wave:

1. **A native action declared against `main` has no UI to be selected in.** The
   builder and the `automation_catalog` collection that feeds it are UI-branch
   only. Declarations and Go handlers can be written and unit-tested against
   `main`, but the plan's per-recipe e2e (drive the builder, assert the visible
   effect) requires the UI branch merged first.
2. **Land the UI phase before Wave 1**, or accept that Wave 1 ships verified by
   Go tests and `packages:generate` alone, with e2e deferred.

Today's shipped catalog is thin: **core** contributes `schedule`/`manual`
triggers and `apply-label`/`notify` actions; **mail** contributes
`message-received` and no actions. Every other package contributes nothing.

## Contract constraints that shaped the catalog

These come from the engine design and the authoring guide; they are why several
entries below are native rather than declarative.

- Triggers are record events (`create` / `update` + `watch` / `delete`) on one
  collection. Conditions and templates see only that collection's **own exposed
  columns** — no joined fields.
- `record-op` actions: `create` anywhere; `update` / `delete` only with
  `target: 'trigger-record'`, so only on triggers over the same collection.
- `set` on a multi-value relation **replaces** the whole value. Append/remove
  semantics require a native handler.
- No date math in params — "due in 3 days" needs a native handler taking an
  offset number.
- Native actions are available **wherever the org's build links the package's
  Go** — which is every deployment shape that has the package installed, a
  multi-org tenant included (its per-org artifact links exactly the org's
  package set; an earlier revision wrongly said tenants link no feature Go).
  Declared-but-unregistered is a supported state (UI greys it out as
  "needs \<pkg\>").
- Owner auto-detection only finds `user` / `owner` / `author` relations to
  `users`. Anything else needs `ownerField` or a registered resolver.
- Native handlers are **not** pkgaccess-gated — they receive a superuser `app`
  and must self-enforce. Only record-ops get the automatic check.
- Published trigger/action ids are API. Renaming one orphans existing rules.
- Every action must close the loop trigger → action → **visible effect**. The
  known `core:apply-label`-on-`mail_messages` gap (message-scoped assignments
  vs. mail's thread-scoped label views) is the cautionary tale.

Tiers: **T1** = users expect it immediately; **T2** = high value, second wave;
**T3** = worthwhile but deferrable.

## Schema corrections to earlier drafts

An audit of the shipped migrations turned up four facts that earlier drafts of
this catalog got wrong. They change the declarations, so they are recorded here
rather than left to be rediscovered.

1. **`core/types/pbSchema.ts` is a stale multi-org snapshot** and disagrees with
   the package migrations on relation column names — it declares `user_org` /
   `mentioned_user_org` / `author: UserOrg` where the migrations declare `user` /
   `mentioned_user` / `author → _pb_users_auth_`. The migrations and each
   package's `collections.ts` are the source of truth. Use `user` and
   `mentioned_user`.
2. **`calendar_events` has no `owner`/`user` column** — the creator column is
   `created_by`, which auto-detection does *not* find. Ownership beyond the
   creator lives entirely in `calendar_members`; `calendar_calendars` itself
   carries no owner column at all.
3. **`comment_mentions` has no `updated` column** (only `created`), and its
   recipient column is `mentioned_user`.
4. **`calc_comments` has no `quoted_text`** — that field is text-only. Its
   columns are `drive_item`, `sheet_id`, `row`, `col`, `parent_comment`, `body`,
   `resolved_at`, `author`, `author_name`.

Unrelated drift noticed in passing, worth a separate fix: `calendar/package.json`
says `0.2.1` while `calendar/manifest.ts` says `0.3.0`.

---

## core (additions)

| Kind | Id | Label | Tier | Mechanics |
|---|---|---|---|---|
| Action | `core:send-email` | Send an email | **T1** | Native **in core**, so it works in multi-org tenants too. Backed by the unified core mailer (`core/server/mailer/`, `DefaultSender()`); grey out via `CanDeliver()`. Params `to`, `subject`, `body`, all templatable. The universal "email me/the team when X". |
| Trigger | `core:user-added` | A user joins | T2 | `users` on create. Fields `name`, `username`, `email`, `role`. Enables onboarding recipes (welcome mail, add to a board, create a contact). |
| Action | `core:webhook` | Call a webhook (POST) | T3 | Native in core, but **new code** — core has no outbound-HTTP capability today. Needs SSRF guards; lift `validateICSURL` / `isDisallowedIP` from `calendar/server/subscription.go` into core. Users arriving from IFTTT/Zapier will ask for it. |

## mail — the action gap

Users coming to mail expect *filters*. The trigger exists; the actions do not.
Folder / read / star state lives per-user on `mail_thread_state`, not on the
message, so these are **native**, built on `store.go:ensureThreadState`.

**Org-scope semantics (decided): act on all mailbox members.** Org rules are
admin-authored, so an org "archive spam" rule archives for everyone in the
mailbox — a rule that moved mail for only its author would be surprising.
Personal rules continue to act solely as the rule owner. Reuse
`register.go:mailboxMembersForMessage` for the member fan-out; it is the same
path the existing owner resolver uses.

| Kind | Id | Label | Tier | Mechanics |
|---|---|---|---|---|
| Action | `mail:move-to-folder` | Move to folder | **T1** | Native. Param `folder` select `[archive, trash, spam, inbox]`. The classic filter action. |
| Action | `mail:mark-as-read` | Mark as read | **T1** | Native, no params. |
| Action | `mail:forward-message` | Forward the message | **T1** | Native via the send path (`endpoints_send.go`). Param `to`. "Forward invoices to accounting." |
| Action | `mail:send-message` | Send a message | **T1** | Native (the spec's own example). Params `to`, `subject`, `body`, templatable → auto-replies and digests. **Loop guard:** the engine's depth cap does not stop an auto-reply answering an auto-responder; add a per-rule hourly cap in the handler. |
| Action | `mail:star-message` | Star the message | T2 | Native via thread state. |
| Trigger | `mail:message-bounced` | A message bounces | T2 | `mail_messages` update, `watch: [delivery_status]`, Go trigger filter for status ∈ {`bounced`, `spam_complaint`}. Fields `subject`, `bounce_reason`, `delivery_status`. |

**Not proposed:** a `mail_thread_state`-based "message starred" trigger. Its
templates cannot reach `subject` or sender (no joined fields), so the flagship
recipe "star → create a card titled {{subject}}" does not work. Revisit when the
event bus lands.

## contacts

Direct `owner` relation to `users` — auto-detection works, no resolver needed.
Pure record-op package, no Go required.

| Kind | Id | Label | Tier | Mechanics |
|---|---|---|---|---|
| Trigger | `contacts:contact-added` | A contact is added | **T1** | `contacts` create. Fields `first_name`, `last_name`, `email`, `phone`, `company`, `job_title`, `favorite`. |
| Action | `contacts:add-contact` | Add a contact | **T1** | Record-op create. Params `first_name`, `last_name`, `email`, `company` (templatable); `set` includes `owner: { context: 'owner' }`. The killer cross-package recipe: "message arrives → add {{sender_name}} / {{sender_email}} to contacts". **No dedupe in v1** — the Go `vcard_uid` hook fires normally; acceptable, but call out duplicate behavior in the help topic. |
| Trigger | `contacts:contact-updated` | A contact changes | T3 | `contacts` update, watching the real columns only (skip `vcard_uid`, `deleted_at`). |

## calendar

`calendar_events.created_by` is the creator, and auto-detection does not find
it. A trigger can declare `ownerField: 'created_by'`, but that scopes personal
rules to the creator alone — for shared calendars, register a resolver that
fans out over `calendar_members` (mail's pattern):
`automation.RegisterOwnerResolver("calendar:event-added", …)`.

| Kind | Id | Label | Tier | Mechanics |
|---|---|---|---|---|
| Trigger | `calendar:event-added` | An event is added | **T1** | `calendar_events` create. Fields `title`, `location`, `start`, `end`, `all_day`, `calendar`, `from_subscription` (lets users filter feed-imported vs. authored). |
| Action | `calendar:create-event` | Create an event | **T1** | **Native**, because v1 has no date math. Params `calendar` (relation), `title` / `description` (templatable), `starts_in_days` (number), `duration_minutes` (number), `all_day` (boolean), `reminder_minutes` (number). Handler inserts the record; the existing reminder scheduler (`reminders.go`) picks it up. Follow `subscription.go:148` for the insert pattern — there is no ready-made create helper. The marquee recipe: "mail arrives → reminder titled {{subject}}". |
| Trigger | `calendar:event-rescheduled` | An event is rescheduled | T2 | `calendar_events` update, `watch: [start, end]`. |
| Trigger | `calendar:event-removed` | An event is removed | T2 | `calendar_events` delete. |
| Trigger | `calendar:feed-sync-failed` | A calendar feed fails to sync | T3 | `calendar_calendars` update, `watch: [subscription_error]`, Go filter for non-empty error. Owner resolution needs the `calendar_members` resolver — the collection has no owner column. Admin hygiene. |

## drive

`drive_items.created_by` needs `ownerField: 'created_by'`. Drive is also the
natural home for the cross-cutting mention trigger, since it owns
`comment_mentions` (written by drive, text, and calc alike).

| Kind | Id | Label | Tier | Mechanics |
|---|---|---|---|---|
| Trigger | `drive:file-added` | A file is added | **T1** | `drive_items` create, `ownerField: 'created_by'`. Fields `name`, `mime_type`, `size`, `is_folder`, `parent`. Conditions on `parent` and `mime_type` cover both "watched folder" and "a doc/sheet was created" — which is why text and calc need no document-created triggers of their own. |
| Action | `drive:move-to-folder` | Move to folder | **T1** | Record-op update, `target: 'trigger-record'`, `set: { parent: { param: 'parent' } }`, param `parent` inherits the relation. Auto-filing: "PDF lands in Inbox → move to Invoices". |
| Trigger | `drive:mentioned-in-comment` | I'm mentioned in a comment | **T1** | `comment_mentions` create, `ownerField: 'mentioned_user'`. One trigger covers doc, sheet, and file comments across three packages. Note the collection has only `created`, no `updated`. |
| Trigger | `drive:file-shared` | A file is shared with me | T2 | `drive_shares` create — `user` is the recipient and auto-detection finds it. Fields `item`, `role`. |
| Action | `drive:share-with-user` | Share with a user | T2 | Native over `permissions.go:createOwnerShare` plus the existing invite-mail path. Params `user` (relation), `role` (select, `owner` excluded). |
| Trigger | `drive:share-link-created` | A public link is created | T3 | `drive_share_links` create. Compliance: "notify admins when anything is shared publicly". |
| Action | `drive:snapshot-version` | Snapshot a version | T3 | Native over `versions.go:snapshotCurrentFile`. Mostly useful once scheduled rules can target records. |

## cards

Deliberately **out of scope for this pass** — cards is under active development
on `feat/card-reporter`. Its catalog (card-created / card-moved / card-completed
/ card-assigned triggers, `create-card` / `move-card` actions, and the
`cards_project_members` owner resolver) is the richest surface in the ecosystem
and deserves its own document once that branch settles. Note for whoever picks
it up: every kanban action is a record write, so most of it is declarative —
except `create-card` (must resolve `project` from the list and let
`allocateNumber` run), assignee/label appends (multi-relation `set` replaces),
and due dates (date math).

## text / calc

Content edits are Yjs CRDT operations — invisible to record triggers. The
high-value events are already covered elsewhere: document and workbook creation
by `drive:file-added` + a `mime_type` condition, @-mentions by
`drive:mentioned-in-comment`. What remains:

| Kind | Id | Label | Tier | Mechanics |
|---|---|---|---|---|
| Trigger | `text:comment-added` | A doc comment is added | T2 | `text_comments` create. `author` auto-detects, but that scopes personal rules to the comment's author — register a resolver for doc participants (`drive_items.created_by` + `drive_shares`) so the *document owner* gets notified. Fields `body`, `quoted_text`, `author_name`. |
| Trigger | `calc:comment-added` | A sheet comment is added | T3 | `calc_comments` create, same resolver shape. **No `quoted_text`** — fields are `body`, `author_name`, `sheet_id`, `row`, `col`. |

**No text/calc actions in v1** — nothing record-shaped closes a visible loop.

## Excluded packages

`google-takeout-import` owns zero collections and its import progress is
client-side only; "import finished" is exactly the deferred event-bus case in
the engine design (or a future `takeout_import_jobs` status collection).
`search-alpha`, `search-beta`, and `shortcut-stub` are E2E stubs.

---

## Known expectation gaps — document, don't build

1. **Time-based record triggers** — "card is overdue", "event starts in 15
   minutes". Not expressible: scheduled rules have no trigger record and no
   conditions in v1. This is the single thing users will reach for and not
   find; say so in the help topic. Future: scheduled-query triggers, or the
   event bus.
2. **Joined-field templates** — a per-user-state trigger (a starred thread)
   cannot template the parent record's fields.
3. **Digest / batching** — "email me a daily summary of new cards" needs
   scheduled rules plus a query. Out of scope.

## Rollout order

- **Wave 1 (T1 — ships the "wow" recipes):** mail actions (`move-to-folder`,
  `mark-as-read`, `forward-message`, `send-message`), `core:send-email`,
  `contacts:contact-added` / `add-contact`, `calendar:event-added` /
  `create-event`, `drive:file-added` / `move-to-folder` /
  `mentioned-in-comment`.
- **Wave 2 (T2):** drive sharing, calendar reschedule/remove,
  `mail:message-bounced`, `mail:star-message`, `core:user-added`,
  `text:comment-added`.
- **Wave 3 (T3):** `core:webhook`, share-link/compliance triggers, version
  snapshots, `contacts:contact-updated`, `calc:comment-added`.

Cards slots in as its own wave whenever `feat/card-reporter` settles.

## Implementation pattern, per package

Mirrors mail, which is the reference implementation.

1. **Manifest:** add `automation: { definitions: 'automation' }`, and the
   matching `"./automation": "./tinycld/<slug>/automation.ts"` entry to the
   package.json `exports` map. Both are required; the generator errors clearly
   if the exports entry is missing.
2. **`tinycld/<slug>/automation.ts`** — pure data, `satisfies
   AutomationDefinitions<Schema>`, importing its own types **relatively**
   (`./types`, never the `~/` self-alias — the module loads under the app
   shell's tsconfig). `import type` only; it must stay JSON-serializable.
3. **`server/automation.go`** where Go is needed — `RegisterOwnerResolver`
   (calendar, text/calc comments), `RegisterTriggerFilter`
   (`message-bounced`, `feed-sync-failed`), `RegisterAction` for every native
   action. Call these from the package's `registerShared(app)` **before hooks
   load**, exactly as `mail/server/register.go:93` does.
4. **`cd tinycld && pnpm run packages:generate`** — runs structural validation
   and materializes `server/automation_defs.json`.
5. **Tests:** Go table-driven against real migrations, per
   `mail/server/automation_test.go` (the `rlstest` idiom), for every resolver,
   filter, and handler; then `pnpm exec tinycld-pkg check` in the member.
6. **Help:** update the package's rules help topic and core's `rules` topic with
   worked recipes, and state the time-based-trigger gap.

Branching, since every member is its own repo: cut a fresh branch **off each
member's `main`** rather than stacking on the unrelated feature branches those
repos currently sit on (`fix/carddav-uid-field`, `refactor/share-link-core-helpers`,
and so on).

## Verification, for the eventual implementation

- `pnpm run packages:generate` passes validation; inspect
  `server/automation_defs.json` for the merged catalog.
- Per-member `pnpm exec tinycld-pkg check`.
- E2E smoke per Wave-1 recipe — mail-arrives → create-contact, file-added →
  move-to-folder, calendar create-event — each driving the builder UI and
  asserting both the visible effect and the `rule_runs` entry. **Requires the
  UI phase on main first** (see *Where the engine actually stands*). Use each
  package's real ingress, never raw PB writes; `mail/tests/rules.spec.ts` is the
  reference.
- Lean-shell check: a workspace without calendar/drive still generates and
  boots, and rules referencing absent packages render "needs \<pkg\>".
