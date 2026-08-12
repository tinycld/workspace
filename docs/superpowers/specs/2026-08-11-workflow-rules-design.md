# Workflow Rules — Design

**Date:** 2026-08-11
**Status:** Approved design, pre-implementation

## Summary

User-editable automation rules for the tinycld ecosystem: packages declare **triggers** (record-change events, plus core-provided schedule/manual triggers) and **actions** as pure data; a generic engine in core matches events against user-authored rules (conditions + ordered actions) and executes them server-side. Cross-package from day one ("when a mail arrives → create a calendar reminder titled {{subject}}"), with both personal (per-user) and org (admin) rule tiers, full run observability, and a stacked-card When/If/Then builder UI that works on web and native.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Scope | Cross-package generic engine from day one |
| Ownership | Personal rules AND org (admin) rules, one engine |
| Trigger types | Record events + scheduled (cron) + manual ("run now") |
| Builder UI | Stacked step cards (When / If / Then), not sentence builder or node canvas |
| Condition expressiveness | One level of AND/OR groups (no arbitrary nesting) |
| Data flow into actions | `{{field}}` template placeholders from trigger payload; all text params templatable; no full expression language |
| Observability | `rule_runs` log per execution + dry-run test mode at authoring time |
| UI location | Core-owned UI in personal settings + admin settings; packages embed a pre-filtered panel (e.g. Mail → Rules) |
| Architecture | Data-driven core engine consuming manifest-declared catalogs (Approach 1) |

**Rejected approaches:** client-side evaluation (ruled out: `syncMode: 'on-demand'` means the client doesn't hold high-volume rows; server-originated writes like inbound SMTP are the most important triggers; rules must run while the app is closed). A semantic event bus (packages `Emit('mail.message.received')`) was liked but deferred — see *Future: event bus* below.

## Architecture

```
manifests (automation: { definitions }) ─┐
                                         ├─ generator → tinycld.config.ts → derive-automation.ts → builder UI catalogs
                                         └─ generator → materialized JSON → core Go engine

record hooks (all write paths) ─┐
app.Cron() (scheduled)          ├─→ trigger matcher → condition evaluator → action executor → rule_runs log
POST …/run (manual)            ─┘
```

- Packages contribute **catalogs, not code** (except optional native-action Go/TS handlers).
- Core owns: the manifest contract, storage (`rules`, `rule_runs`), the Go engine, and all UI components.
- The engine lives in **core Go**, so it runs in multi-org tenant mode (where no package Go is linked). Record-op actions and core-native actions work everywhere; package-native actions are single-tenant only.

## Manifest contract

The manifest gains one small field pointing at a definitions module (pattern: same as `collections`/`seed`):

```ts
automation: { definitions: 'automation' },   // exports-map subpath → <pkg-root>/automation.ts
```

`automation.ts` is a TS module default-exporting pure data, typed against the package's generated schema so field references are compile-checked. The generator imports it for the client config and **materializes it to JSON** for the Go engine (same idiom as the `caldav` block → `.runtime/caldav.json`).

```ts
import type { AutomationDefinitions } from '@tinycld/core/lib/automation/types'

export default {
    triggers: [
        // minimal form — fields omitted = expose every schema column
        { id: 'contact-added', label: 'A contact is added', collection: 'contacts', on: 'create' },
        {
            id: 'message-received',
            label: 'A message arrives',
            collection: 'mail_messages',
            on: 'create',
            // curated allowlist with optional label overrides
            fields: ['subject', 'folder', 'has_attachments', { key: 'from', label: 'Sender' }],
        },
        {
            id: 'message-moved',
            label: 'A message is moved',
            collection: 'mail_messages',
            on: 'update',
            watch: ['folder'],        // update triggers fire only when a watched field changed
        },
    ],
    actions: [
        {
            id: 'move-to-folder',
            label: 'Move to folder',
            kind: 'record-op',
            collection: 'mail_messages',
            op: { type: 'update', target: 'trigger-record', set: { folder: { param: 'folder' } } },
            params: [{ key: 'folder', field: 'folder' }],   // inherits type + relation target from column
        },
        {
            id: 'send-message',
            label: 'Send a message',
            kind: 'native',           // dispatches to a Go handler registered at boot
            params: [
                { key: 'to', type: 'text' },
                { key: 'subject', type: 'text' },
                { key: 'body', type: 'text' },
            ],
        },
    ],
} satisfies AutomationDefinitions<MailSchema>
```

### Contract rules

- **Types resolve from the DB schema, never redeclared.** Trigger fields and column-referencing params (`{ key, field }`) get their type, relation target, and select options from the schema — client-side from generated types/config, server-side from PocketBase collection metadata. Only novel params (not DB columns) declare a `type`.
- **Field labels:** humanized from the column name by default (`has_attachments` → "Has attachments"); object-form override when the name reads badly. PocketBase's field schema has no label slot, so there is nowhere DB-side to put labels; if more surfaces ever need field labels, lift them to a shared per-package map then — not now.
- **`fields` omitted → all columns exposed** (plus `created`/`updated`). Types with no operator set (`json`, `file`) and PB system internals are auto-skipped. `fields` present = curated allowlist.
- **Templates need no flag:** every text param accepts `{{field}}` placeholders whenever the trigger has fields; the engine substitutes before the action runs. The builder inserts placeholders via a picker (not free-typed).
- **Cross-package compatibility is structural:** `target: 'trigger-record'` record-ops are offered only for triggers on the same collection; `type: 'create'` record-ops work with any trigger. No compatibility matrices to maintain.
- **Param/field type set is closed:** `text`, `number`, `boolean`, `date`, `select`, `relation`. Each type carries its operator set (text: contains / not contains / equals / starts with; number: = ≠ > <; boolean: is true/false; date: before / after / within last N days; relation: is / is not / is empty; select: is / is not). The condition UI is generated entirely from this.

### Core built-ins

Core ships its own catalog: triggers `core:schedule` (cron config in `trigger_config`) and `core:manual` (run-now button); actions `core:apply-label` (polymorphic `label_assignments`) and `core:notify` (existing `notify.NotifyUser`). Core-native actions run in core Go and therefore work in tenants.

Schedule/manual rules have no trigger record: no conditions, no trigger-targeting actions, no field templates — the builder simply doesn't offer them. v1 scheduled rules are "at time X, do these actions."

### Native action registration

Package Go registers handlers from its existing `Register(app)` (mirroring `$`-binding registration): `automation.RegisterAction('mail:send-message', handler)`. A declared native action with no registered handler (tenant mode, or package removed) renders greyed out in the builder and flips affected rules to "inactive: needs X".

## Data model

Two new **core** collections (core migrations, append-only once released).

### `rules`

| field | type | notes |
|---|---|---|
| `name` | text | user's label |
| `scope` | select `personal`/`org` | org rules editable by admins only |
| `owner` | relation → users | author; personal rules execute as this user |
| `trigger` | text | qualified ref: `mail:message-received`, `core:schedule` |
| `trigger_config` | json | cron expression for `core:schedule`; empty otherwise |
| `conditions` | json | AST below |
| `actions` | json | ordered `[{ ref, params }]`; params hold static values and `{{field}}` templates |
| `enabled` | bool | |
| `order` | number | execution order among rules sharing a trigger |
| `stop_processing` | bool | if matched, skip later rules |

Access rules (as implemented in Phase 1): personal rules readable/writable by `owner`, with the update rule **body-locked** so an owner cannot PATCH `scope` or `owner` (a personal rule could otherwise self-escalate to org scope, which the engine runs with system authority). Org rules are readable by all authenticated **non-guest** users (so members can see why org automation touches their data) but writable by admins/owners only; guests can neither read org rules nor create rules of any scope (matches the house guest-exclusion posture). UI writes go through `useMutation`; reads through `useOrgLiveQuery`.

### Condition AST (`conditions`)

One level of grouping, no recursion — mirrors the builder's "+ add condition / + add OR group":

```json
{
    "match": "all",
    "groups": [
        { "match": "any", "conditions": [
            { "field": "from", "op": "contains", "value": "@acme.com" },
            { "field": "from", "op": "contains", "value": "@example.com" }
        ]},
        { "match": "all", "conditions": [
            { "field": "has_attachments", "op": "is_true" }
        ]}
    ]
}
```

### `rule_runs`

| field | type | notes |
|---|---|---|
| `rule` | relation → rules | cascade delete |
| `fired_at` | date | |
| `matched` | bool | logged even on non-match — that's how "why didn't it fire" gets debugged |
| `trigger_summary` | json | snapshot of exposed trigger fields at fire time |
| `results` | json | per-action `{ ref, status, message }` |
| `error` | text | top-level engine failure |
| `duration_ms` | number | |

Engine prunes to the most recent 200 runs per rule. `rule_runs` is never client-writable. Visibility (ruling during Phase 1, tighter than the original draft): a personal rule's runs are visible to its owner; an **org** rule's runs are visible to admins/owners only — `trigger_summary` snapshots can contain other users' record data, so org-rule runs are not member-visible even though the org rule itself is. Phase 3 UI must build to this, not the earlier "whoever can read the rule" wording.

### Validation

Zod schemas validate `conditions`/`actions` at save time; the Go engine re-validates on load. A rule referencing a trigger/action from an uninstalled package shows as "inactive: needs package X" — never silently dropped, never erroring per-event.

## Execution engine (`core/server/automation/`)

- **Intake:** one central set of wildcard record hooks (`OnRecordAfterCreateSuccess()` etc.). In-memory index of enabled rules keyed by `(collection, op)`, rebuilt on `rules` changes via its own record hook — zero rules ≈ one map miss per write. `watch` compares against the record's original values.
- **Scoping:** personal rules fire only on records their owner owns, resolved via the record's user-FK (auto-detect `user`/`owner`/`author` relation → users; optional `ownerField` override on the trigger declaration). Org rules fire on all matching events.
- **Ordering:** org rules first (by `order`), then personal (by `order`). `stop_processing` on an org rule stops everything downstream; on a personal rule, only later personal rules.
- **Async:** hooks enqueue to a small worker pool — rule execution never blocks the write path (e.g. SMTP delivery). Events for the same record stay ordered; per-action timeout.
- **Identity:** personal rules execute actions as the owner through standard pkgaccess checks. Org rules execute with system authority (admin-authored; documented, deliberate). Restrict-never-widen holds: a rule can never exceed its author's reach.
- **Loop protection:** engine writes carry provenance (rule id + chain depth) in context; chains cap at depth 3, logging `chain-depth-exceeded` to `rule_runs`. A rule never re-fires on its own write to the same record.
- **Action errors:** actions run in order; a failure is recorded in `results` and remaining actions still run. 20 consecutive fully-failed runs → auto-disable + `notify.NotifyUser` to the owner. No silent zombie rules.
- **Scheduled:** rules with `core:schedule` sync to `app.Cron()` entries (id = rule id) on boot and rules-change.
- **Manual:** `POST /api/automation/rules/{id}/run`, auth'd owner/admin — used by the "Run now" button.
- **Dry run:** endpoint evaluates a candidate rule (unsaved definition accepted) against the caller's most recent 50 records of the trigger collection without executing actions; returns per-record match results for the builder's preview.
- **Errors to Sentry:** engine faults go through `captureException('automation.<stage>', err, extra)`.

## UI (core-owned)

Shared building blocks in `tinycld/core/`:

- **`RulesPanel`** — list with enable toggles, reorder (up/down affordances on touch), scope badges, degraded "needs X" state, run-status line. Accepts a filter (package prefix, scope).
- **`RuleBuilder`** — stacked When/If/Then step cards; react-hook-form + zod; trigger picker grouped by package (from `derive-automation.ts` catalogs via `usePackages()`); condition rows generated from field types; action params with template-placeholder picker; native actions greyed when unavailable.
- **`RunHistory`** — per-rule view over `rule_runs`.
- **Dry-run preview** — "would have matched 3 of your last 50 messages", with the matching records listed.

Mount points:

1. **Settings → Rules** (personal). Requires a non-admin-gated settings surface — today's per-package settings route is admin-only, so personal rules mount in the user-level settings area.
2. **Admin → Org rules** — same `RulesPanel` with `scope="org"`, via the existing `systemSettings` mechanism.
3. **Embedded package view** — core exports `RulesPanel`/`RuleBuilder`; a package mounts them on its own route (e.g. Mail sidebar "Rules") pre-filtered to its triggers, with "+ New rule" pre-scoped. Same records as the settings surfaces — no forked UI.

Org rules appear read-only in personal lists. Everything works on web **and** native (vertical layouts, standard pickers, no drag-critical interactions).

Data access follows house rules throughout: `useOrgLiveQuery` reads, `useMutation` writes, no raw PB calls.

## Ecosystem integration checklist

- Add `automation` to `PackageManifest` (`core/lib/packages/types.ts`) and the generator.
- **Update the dynamic-entry field whitelist in `use-packages.ts` (~lines 36–54)** — otherwise DB-installed packages silently lose their automation catalogs.
- New `core/lib/packages/derive-automation.ts` (`packageTriggers` / `packageActions`), following the existing derive-* pattern.
- Generator materializes merged automation JSON for the Go engine (single-tenant) and per-org `.runtime/` (tenants).
- `rules`/`rule_runs` are core-owned collections (like `labels`), outside the `<slug>_*` pkgaccess naming convention; rule execution applies pkgaccess when acting on package collections, not on the rule records themselves.
- In-app help: core topic `automation-rules` (creating rules, conditions, run history, dry run) + short mail topic for the embedded view; shortcuts written with Mac glyphs; no hardcoded hostnames.

## Testing

- **Go unit** (`core/server/automation/`): table-driven condition evaluator (every operator × type), template substitution (missing fields, non-text values), trigger matching incl. `watch`, owner resolution, org→personal ordering + `stop_processing`, loop-protection depth cap, auto-disable, run pruning.
- **TS unit** (vitest; mocks only via `tests/unit.helpers.tsx`): zod validation of `conditions`/`actions`, `derive-automation` catalogs (omitted-`fields` default, label humanization), builder form logic (operator sets, template picker availability, native-action greying).
- **E2E** (playwright; drive the UI, no raw PB writes; `login`/`navigateToPackage` helpers): create a mail rule via the builder → cause a matching message via the UI → assert label applied + run in history; dry-run preview spec; embedded Mail → Rules parity spec.
- **Degradation:** lean-shell boot with zero automation packages; absent-package rule renders "needs X" and is skipped without erroring.

## Future: event bus (documented, not built)

If a trigger is ever discovered that cannot be expressed as a record change (e.g. "sync completed", "import finished" — though today those write status records), add `kind: 'custom'` triggers: package Go emits `automation.Emit('mail:some-event', payload)` and the engine treats it as a synthetic event with manifest-declared fields. The engine's matcher/evaluator/executor are unchanged — only intake grows. Do not build until a concrete trigger demands it.

## Out of scope for v1

- Arbitrary condition nesting; full expression language (date math, string ops).
- Conditions/templates on scheduled rules.
- Cross-user actions in personal rules.
- Rule import/export, sharing, or templates gallery.
- Client-side evaluation of any kind.
