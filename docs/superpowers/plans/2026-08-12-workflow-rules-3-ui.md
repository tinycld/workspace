# Workflow Rules Phase 3: UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow rules user-visible: a resolved-field catalog served by the engine, the RuleBuilder (stacked When/If/Then cards) and RulesPanel (list/toggle/reorder/history) in core, mounted in personal settings (with an org segment) and embedded in mail, with help topics and e2e coverage.

**Architecture:** The engine materializes a resolved trigger/action catalog into a new read-only `automation_catalog` collection at boot (types, relation targets + display fields, select options, native-action availability) — the `pkg_registry` pattern: server-owned registry rows, client reads via `useOrgLiveQuery` like everything else. The rows are derived output, not source of truth: boot-time sync rebuilds them from the defs + collection schemas + handler registry (all boot-stable), reconciling by ref. UI components live in `core/components/rules/` and are imported by mail via the existing `./components/*` exports glob. The rule draft is managed by a purpose-built `useRuleDraft` hook (NOT react-hook-form — the nested conditions AST isn't a flat form and `useFieldArray` has zero codebase precedent; RHF stays for what it's good at elsewhere). Validation reuses Phase 1's zod schemas at save time. Spec: `docs/superpowers/specs/2026-08-11-workflow-rules-design.md`; handoff notes at the end of the phase 1+2 plan docs.

**Tech Stack:** Go (catalog endpoint in `core/server/automation/`), React Native + Uniwind className styling, TanStack Query (`useQuery` via `pb.send`), pbtsdb (`useOrgLiveQuery`/`useMutation`), Zustand (builder open-state), Playwright.

## Global Constraints

- Branches: create `feat/workflow-rules-ui` in the tinycld repo from `feat/comment-editor-core-fixes` (head `2acba60` — phases 1+2 live there; if PR #181 has merged, branch from `main` instead) and in the mail repo from `refactor/file-drop-from-core` (head `6b72940`; if PR #60 merged, from `main`). Tasks 1–8 and 10–11 commit in tinycld; tasks 9 and 12 in mail. Never mention Claude in commit messages.
- Style: RN primitives + Tailwind `className` with semantic tokens only (no raw hex, no `StyleSheet.create`); `useThemeColor` only for Lucide `color` props / Pressable style callbacks; 4-space indent, single quotes, ES5 trailing commas; never `any`; no biome-ignore. Keep JSX declaration-free (no `.map()`/ternaries in returns; `isVisible` prop + `return null` for conditional components). Comments explain why.
- Data: `useOrgLiveQuery` reads, `useMutation`/`mutation` from `@tinycld/core/lib/mutations` writes, `pb.send` (never fetch) for Go endpoints wrapped in TanStack `useQuery`/`useMutation` hooks that return named verbs. No raw PB REST in components or e2e (webhook ingress via mail's `deliverInbound` helper is the real delivery path and is allowed).
- Checks: `cd /Users/nas/code/tinycld/tinycld && pnpm exec tinycld-pkg check` (member), `cd core/server && go test ./automation/ -v` (Go), `pnpm test:e2e -- -g "<pattern>"` from `tinycld/` for core e2e, `pnpm exec tinycld-pkg test:e2e` from `mail/` for mail e2e. Playwright retries are 0 — a flake is a bug; never `page.goto()` mid-SPA; gate on rendered elements, not URLs.
- Engine contracts the UI must respect (phase 2 handoff): condition fields outside the trigger's exposed set fail closed — build pickers strictly from the catalog; date condition values may be PB datetime, bare date, or RFC3339; text ops case-insensitive; don't offer `is_empty` for number fields; dry-run applies trigger filters but CANNOT scope owner-less triggers (mail) for non-admins — surface that 400 gracefully, not as an error toast; manual run works only for `core:manual`/`core:schedule` rules and ignores `enabled`.
- A user-facing feature isn't done without in-app help (Mac glyphs only for shortcuts; no hardcoded hostnames).
- If any check fails, diagnose and fix at the source. Brief-internal conflicts → STOP, NEEDS_CONTEXT.

## File Structure

| File | Responsibility |
|---|---|
| `core/server/pb_migrations/2000000000_create_automation_catalog.js` | The read-only catalog collection |
| `core/server/automation/catalog.go` (+test) | Boot-time catalog materialization into `automation_catalog` |
| `core/lib/pocketbase.ts` (modify) | Register the `automation_catalog` client store |
| `core/lib/automation/api.ts` | Hand-declared TS mirrors of catalog/dry-run/run payloads |
| `core/lib/automation/use-automation-catalog.ts` | `useAutomationCatalog()` query hook |
| `core/lib/automation/use-rule-mutations.ts` | CRUD + reorder + runNow + dryRun hooks |
| `core/lib/automation/draft.ts` (+test) | `RuleDraft` type, record⇄draft (de)serialization, validation |
| `core/lib/stores/rules-ui-store.ts` | Builder/history open-target Zustand store |
| `core/components/rules/RulesPanel.tsx` | List: rows, toggles, reorder, delete, badges, empty state |
| `core/components/rules/RuleRow.tsx` | One rule row (summary sentence, switch, drag handle, actions) |
| `core/components/rules/RuleBuilder.tsx` | The When/If/Then editor (drawer on web, BottomDrawer mobile) |
| `core/components/rules/TriggerCard.tsx` | WHEN card: trigger picker + schedule config |
| `core/components/rules/ConditionsCard.tsx` | IF card: groups + condition rows |
| `core/components/rules/ConditionRow.tsx` | field ▸ operator ▸ value-input row |
| `core/components/rules/ValueInput.tsx` | Type-switched condition/param value editor |
| `core/components/rules/RelationRecordPicker.tsx` | Generic record picker for relation fields |
| `core/components/rules/ActionsCard.tsx` | THEN card: ordered actions + param editors + placeholder menu |
| `core/components/rules/DryRunPanel.tsx` | Preview results / graceful unscopable message |
| `core/components/rules/RunHistory.tsx` | Per-rule `rule_runs` drawer |
| `app/(app)/settings/rules.tsx` + `settings/index.tsx` edit | Personal + org mount |
| `mail/tinycld/mail/screens/rules.tsx` + `sidebar.tsx` edit (mail repo) | Embedded mail view |
| `core/help/rules.md`, `mail/help/rules.md` (mail repo) | Help topics |
| `tinycld/tests/e2e/rules.spec.ts`, `mail/tests/rules.spec.ts` (mail repo) | E2E |

Fidelity note for implementers: logic-bearing code (Go, hooks, draft, serialization, reindex) is specified verbatim below; component tasks specify exact props/state contracts, behavior, and the established idioms to copy (named file references), with key snippets — transcribe the contracts exactly and follow the referenced patterns for JSX assembly.

---

### Task 1: Materialized catalog collection (Go + migration)

**Files:**
- Create: `tinycld/core/server/pb_migrations/2000000000_create_automation_catalog.js`
- Create: `tinycld/core/server/automation/catalog.go`
- Modify: `tinycld/core/server/automation/register.go` (call `engine.syncCatalog()` after `engine.Start()` in the `OnServe` binding — handlers register in `RegisterExtras` before `OnServe`, so availability is accurate by then)
- Modify: `tinycld/core/lib/pocketbase.ts` (register the client store + add to `coreStores`)
- Test: `tinycld/core/server/automation/catalog_test.go`

**Interfaces:**
- **Migration** (unreleased phase — follow the `1990000000_create_rules.js` conventions; collection id `pbc_automation_catalog_01`): fields `ref` (text, required), `kind` (select: `trigger`/`action`, required), `pkg` (text), `label` (text), `definition` (json), `available` (bool), autodates; unique index on `ref`; access rules — read for authenticated non-guests (`@request.auth.id != "" && @request.auth.role != "guest"`, matching the rules-collection posture), `createRule`/`updateRule`/`deleteRule` all `null` (engine-only writes, the `rule_runs` pattern).
- **Client store** (`pocketbase.ts`): `const automation_catalog = newCollection('automation_catalog', { omitOnInsert: ['created', 'updated'], ...indexing })`, added to `coreStores` — the `pkg_registry` shape.
- **`catalog.go`** produces `(*Engine) buildCatalog(app core.App) catalogResponse` (pure derivation, unit-testable) and `(*Engine) syncCatalog()` (reconcile rows by `ref`: upsert changed/new, delete stale — the cron-reconcile shape; writes are plain superuser `app.Save` with NO `markEngineWrite` — provenance sentinels exist for rule-dispatchable collections, and no defs can declare a trigger on `automation_catalog`). The row's `definition` json carries the resolved `catalogTrigger`/`catalogAction` struct (below) verbatim; `available` is duplicated as a real column so the UI can filter without parsing json.
- Derivation structs (these become the `definition` payload AND the TS mirror in Task 2):

```go
type catalogField struct {
	Key            string   `json:"key"`
	Label          string   `json:"label"`
	Type           string   `json:"type"` // text|number|boolean|date|select|relation
	Options        []string `json:"options,omitempty"`
	RelationTarget string   `json:"relationTarget,omitempty"` // collection NAME
	DisplayField   string   `json:"displayField,omitempty"`   // for relation targets
}

type catalogTrigger struct {
	Ref       string         `json:"ref"`
	Pkg       string         `json:"pkg"`
	Label     string         `json:"label"`
	Synthetic string         `json:"synthetic,omitempty"`
	Collection string        `json:"collection,omitempty"`
	Fields    []catalogField `json:"fields,omitempty"` // resolved exposed set, declaration order then alphabetical for open triggers
}

type catalogParam struct {
	Key     string       `json:"key"`
	Label   string       `json:"label"`
	Field   catalogField `json:"field"` // resolved type info (novel params synthesize from ParamDef.Type)
	Template bool        `json:"template"` // true for text params when the trigger has fields (UI shows the placeholder menu)
}

type catalogAction struct {
	Ref        string         `json:"ref"`
	Pkg        string         `json:"pkg"`
	Label      string         `json:"label"`
	Kind       string         `json:"kind"`
	Collection string         `json:"collection,omitempty"`
	OpType     string         `json:"opType,omitempty"`  // create|update|delete (record-ops)
	OpTarget   string         `json:"opTarget,omitempty"` // trigger-record when applicable
	Params     []catalogParam `json:"params,omitempty"`
	Available  bool           `json:"available"` // native: handler registered; record-op: always true
}

type catalogResponse struct {
	Triggers []catalogTrigger `json:"triggers"`
	Actions  []catalogAction  `json:"actions"`
}
```

- Resolution rules (mirror `eval`/`template` semantics):
  - Field type from the PB field type switch (`schema_gen.go` precedent): Text/Email/URL/Editor → `text`; Number → `number`; Bool → `boolean`; Date/Autodate → `date`; Select → `select` + `Options` = `f.Values`; Relation → `relation` + `RelationTarget` resolved from `f.CollectionId` to the collection NAME + `DisplayField`.
  - `DisplayField` heuristic: first existing field among `name`, `title`, `label`, `subject`, `display_name`, `email`, `username` on the target collection; else `"id"`.
  - Trigger fields: the declared allowlist resolved in declaration order (label = declared override else `humanize`d key — reimplement `humanizeFieldKey` in Go: underscores → spaces, capitalize first letter); for open triggers (no `fields`), every column that would pass `exposedFields` (skip id/`_`-prefix/hidden/system-except-autodate), sorted alphabetically. Skip columns whose type resolves to json/file/password (no operators).
  - `Available`: for `kind == "native"`, `_, ok := actionHandler(ref)`; record-ops always true.
  - Actions whose collection doesn't exist in this deployment (package data absent) → `Available: false` rather than omitted, so the UI can show "needs X".
- Add `humanizeFieldKeyGo` (or inline) with the same output as the TS helper — the test asserts `has_attachments → "Has attachments"`.

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/catalog_test.go
package automation

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func catalogApp(t *testing.T) (*tests.TestApp, *Engine) {
	t.Helper()
	t.Cleanup(ResetRegistriesForTest)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Cleanup() })
	users, _ := app.FindCollectionByNameOrId("users")

	folders := core.NewBaseCollection("cat_folders")
	folders.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(folders); err != nil {
		t.Fatal(err)
	}
	items := core.NewBaseCollection("cat_items")
	items.Fields.Add(&core.TextField{Name: "subject"})
	items.Fields.Add(&core.BoolField{Name: "has_attachments"})
	items.Fields.Add(&core.SelectField{Name: "status", Values: []string{"new", "done"}, MaxSelect: 1})
	items.Fields.Add(&core.RelationField{Name: "folder", CollectionId: folders.Id, MaxSelect: 1})
	items.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1})
	if err := app.Save(items); err != nil {
		t.Fatal(err)
	}

	defs := &Defs{Packages: []PackageDefs{
		{Slug: "core", Triggers: []TriggerDef{{ID: "manual", Label: "Run manually", Synthetic: "manual"}},
			Actions: []ActionDef{{ID: "notify", Label: "Notify", Kind: "native",
				Params: []ParamDef{{Key: "title", Type: "text"}}}}},
		{Slug: "cat", Triggers: []TriggerDef{{
			ID: "item-created", Label: "An item is created", Collection: "cat_items", On: "create",
			Fields: []FieldRef{{Key: "subject"}, {Key: "has_attachments"}, {Key: "folder"}, {Key: "status"}},
		}},
			Actions: []ActionDef{{ID: "set-folder", Label: "Move to folder", Kind: "record-op",
				Collection: "cat_items",
				Op:         RecordOp{Type: "update", Target: "trigger-record", Set: map[string]SetValue{"folder": {Param: "folder"}}},
				Params:     []ParamDef{{Key: "folder", Field: "folder"}}}}},
	}}
	return app, NewEngine(app, defs)
}

func TestCatalogResolution(t *testing.T) {
	app, eng := catalogApp(t)
	res := eng.buildCatalog(app)

	var item *catalogTrigger
	for i := range res.Triggers {
		if res.Triggers[i].Ref == "cat:item-created" {
			item = &res.Triggers[i]
		}
	}
	if item == nil {
		t.Fatal("trigger missing from catalog")
	}
	byKey := map[string]catalogField{}
	for _, f := range item.Fields {
		byKey[f.Key] = f
	}
	if byKey["subject"].Type != "text" || byKey["has_attachments"].Type != "boolean" {
		t.Fatalf("basic types: %+v", byKey)
	}
	if byKey["has_attachments"].Label != "Has attachments" {
		t.Fatalf("humanized label: %q", byKey["has_attachments"].Label)
	}
	if byKey["status"].Type != "select" || len(byKey["status"].Options) != 2 {
		t.Fatalf("select options: %+v", byKey["status"])
	}
	f := byKey["folder"]
	if f.Type != "relation" || f.RelationTarget != "cat_folders" || f.DisplayField != "name" {
		t.Fatalf("relation resolution: %+v", f)
	}
}

func TestCatalogActionAvailability(t *testing.T) {
	app, eng := catalogApp(t)
	res := eng.buildCatalog(app)
	get := func(ref string) catalogAction {
		for _, a := range res.Actions {
			if a.Ref == ref {
				return a
			}
		}
		t.Fatalf("action %s missing", ref)
		return catalogAction{}
	}
	if get("core:notify").Available {
		t.Fatal("native action without a handler must be unavailable")
	}
	RegisterAction("core:notify", func(a core.App, req ActionRequest) error { return nil })
	if !eng.buildCatalog(app).Actions[actionIndex(eng.buildCatalog(app).Actions, "core:notify")].Available {
		t.Fatal("registered native action must be available")
	}
	sf := get("cat:set-folder")
	if !sf.Available || sf.OpTarget != "trigger-record" || sf.Params[0].Field.RelationTarget != "cat_folders" {
		t.Fatalf("record-op resolution: %+v", sf)
	}
}

func actionIndex(actions []catalogAction, ref string) int {
	for i, a := range actions {
		if a.Ref == ref {
			return i
		}
	}
	return -1
}
```

Additional test (append to the Step 1 file): `TestSyncCatalogReconciles` — apply the real migrations (`rlstest` idiom established in the package), run `syncCatalog()`, assert one row per trigger/action with `definition` json round-tripping the derived struct and `available` mirrored as a column; register the missing native handler, re-sync, assert the row's `available` flipped and NO duplicate row exists (unique ref); remove an action from the engine's defs (build a second Engine with fewer defs sharing the app), re-sync, assert the stale row was deleted.

- [ ] **Step 2: Run to verify RED** — `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run TestCatalog -v` → FAIL (undefined symbols).

- [ ] **Step 3: Implement** — the migration, `catalog.go` (`buildCatalog` + `syncCatalog` per the Interfaces block; resolution reuses the same security skip rules as `template.go`'s `exposedFields` — factor a shared `resolvableColumns(col)` if it keeps the filters single-sourced), the `register.go` sync call, and the `pocketbase.ts` store registration.

- [ ] **Step 4: GREEN + full suite + regen** — `go test ./automation/ -v` all pass; `gofmt -l automation/` empty; `go test ./...` green; `cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate` (regenerates `pbSchema.ts` with the new `AutomationCatalog` interface) then `pnpm exec tinycld-pkg typecheck` clean.

- [ ] **Step 5: Commit (tinycld)** — `git add core/server/pb_migrations/2000000000_create_automation_catalog.js core/server/automation/catalog.go core/server/automation/catalog_test.go core/server/automation/register.go core/lib/pocketbase.ts && git commit -m "feat(automation): materialized catalog collection"`

---

### Task 2: Client API layer (`api.ts` + catalog hook)

**Files:**
- Create: `tinycld/core/lib/automation/api.ts`
- Create: `tinycld/core/lib/automation/use-automation-catalog.ts`
- Test: `tinycld/core/lib/automation/__tests__/api.test.ts`

(`use-rule-mutations.ts` moves to Task 3 — it imports `draftToRecord`, which doesn't exist until the draft model lands.)

**Interfaces:**
- `api.ts`: hand-declared mirrors (the `useSearchResults.ts` precedent — comment `/** mirrors core/server/automation/catalog.go */`): `CatalogField`, `CatalogTrigger`, `CatalogParam`, `CatalogAction`, `CatalogResponse`, `DryRunRequest { trigger: string; conditions: ConditionsAst }`, `DryRunResponse { total: number; matches: { id: string; summary: Record<string, unknown> }[] }`, `RunResponse { queued: boolean }`. `ConditionsAst`/`RuleActionItem` TS types derive from Phase 1's zod schemas via `z.infer` re-export (`export type ConditionsAst = z.infer<typeof conditionsAstSchema>`).
- `use-automation-catalog.ts` — a live query over the materialized collection (house idiom; reacts to re-syncs automatically), assembling the `CatalogResponse` shape the rest of the UI consumes:

```ts
import { useMemo } from 'react'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { CatalogAction, CatalogResponse, CatalogTrigger } from './api'

export function useAutomationCatalog(): { catalog: CatalogResponse | undefined; isReady: boolean } {
    const [catalogCollection] = useStore('automation_catalog')
    const { data: rows, isReady } = useOrgLiveQuery(query =>
        query.from({ automation_catalog: catalogCollection })
    )
    // definition is a json column: tolerate malformed rows (skip, don't throw) —
    // the engine owns the writes, but a version-skewed client must not crash.
    const catalog = useMemo(() => {
        if (!rows) return undefined
        const triggers: CatalogTrigger[] = []
        const actions: CatalogAction[] = []
        for (const row of rows) {
            const def = row.definition as CatalogTrigger | CatalogAction | null
            if (!def || typeof def !== 'object' || !('ref' in def)) continue
            if (row.kind === 'trigger') triggers.push(def as CatalogTrigger)
            if (row.kind === 'action') actions.push({ ...(def as CatalogAction), available: row.available })
        }
        return { triggers, actions }
    }, [rows])
    return { catalog, isReady }
}
```

- (moved to Task 3) `use-rule-mutations.ts` — named-verb hooks over pbtsdb + `pb.send`:

```ts
import { eq } from '@tanstack/db'
import { newRecordId } from 'pbtsdb/core'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentUserId } from '@tinycld/core/lib/use-org-live-query'
import type { DryRunRequest, DryRunResponse, RunResponse } from './api'
import type { RuleDraft } from './draft'
import { draftToRecord } from './draft'

export function useRuleMutations() {
    const [rulesCollection] = useStore('rules')
    const userId = useCurrentUserId()

    const save = useMutation({
        mutationFn: mutation(function* (draft: RuleDraft) {
            const fields = draftToRecord(draft)
            if (draft.id) {
                yield rulesCollection.update(draft.id, r => Object.assign(r, fields))
            } else {
                yield rulesCollection.insert({ id: newRecordId(), owner: userId, ...fields })
            }
        }),
    })
    const remove = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield rulesCollection.delete(id)
        }),
    })
    const setEnabled = useMutation({
        mutationFn: mutation(function* ({ id, enabled }: { id: string; enabled: boolean }) {
            yield rulesCollection.update(id, r => {
                r.enabled = enabled
            })
        }),
    })
    // First order-column reindex in the codebase: one parallel array-yield,
    // renumbering every row to its new index keeps the invariant simple.
    const reorder = useMutation({
        mutationFn: mutation(function* (orderedIds: string[]) {
            yield orderedIds.map((id, index) =>
                rulesCollection.update(id, r => {
                    r.order = index
                })
            )
        }),
    })
    const runNow = useMutation({
        mutationFn: async (id: string): Promise<RunResponse> =>
            await pb.send(`/api/automation/rules/${id}/run`, { method: 'POST' }),
    })
    const dryRun = useMutation({
        mutationFn: async (body: DryRunRequest): Promise<DryRunResponse> =>
            await pb.send('/api/automation/dry-run', { method: 'POST', body }),
    })

    return { save, remove, setEnabled, reorder, runNow, dryRun }
}
```

(Verify `useCurrentUserId` exists — check `use-org-live-query.ts` exports; if the id comes from a different hook (e.g. an auth store selector used by `useOrgLiveQuery` internally), use that and note it. Default `onError` toasting from `useMutation` is deliberate — no per-hook onError except where the builder maps validation errors.)

- [ ] **Step 1: Failing test** — `api.test.ts`: type-level `satisfies` checks that `ConditionsAst` round-trips through Phase 1's `conditionsAstSchema.parse` and that a representative `CatalogResponse` literal (mirroring catalog_test.go's fixture output) typechecks; runtime assertion that `conditionsAstSchema.parse` accepts the literal used by the builder default (`{ match: 'all', groups: [] }`).
- [ ] **Step 2: RED** — `pnpm exec vitest run core/lib/automation/__tests__/api.test.ts` fails to resolve.
- [ ] **Step 3: Implement `api.ts` + `use-automation-catalog.ts`** (the mutations-hook code block above lands in Task 3).
- [ ] **Step 4: GREEN + typecheck** — vitest passes; `pnpm exec tinycld-pkg typecheck` clean.
- [ ] **Step 5: Commit (tinycld)** — `feat(automation): client catalog types and hook`

---

### Task 3: Rule draft model (`draft.ts`) + mutations hook

**Files:**
- Create: `tinycld/core/lib/automation/draft.ts`
- Create: `tinycld/core/lib/automation/use-rule-mutations.ts` (the code block specified in Task 2's Interfaces — implement it here, verbatim, after `draft.ts` exists)
- Test: `tinycld/core/lib/automation/__tests__/draft.test.ts`

**Interfaces:**

```ts
export interface RuleDraft {
    id?: string
    name: string
    scope: 'personal' | 'org'
    trigger: string // qualified ref; '' = unset
    triggerConfig: { cron?: string }
    conditions: ConditionsAst
    actions: { ref: string; params: Record<string, string | number | boolean> }[]
    enabled: boolean
    stopProcessing: boolean
    order: number
}

export function emptyDraft(scope: RuleDraft['scope']): RuleDraft
export function recordToDraft(record: RulesRecord): RuleDraft   // tolerant: malformed JSON → empty AST/actions
export function draftToRecord(draft: RuleDraft): RulesRecordFields // name/scope/trigger/trigger_config/conditions/actions/enabled/stop_processing/order
export function validateDraft(draft: RuleDraft, catalog: CatalogResponse | undefined): string[]
```

`validateDraft` returns human messages (empty = valid): name required; trigger required and present in catalog; synthetic triggers → no conditions, no trigger-record actions; conditions parse via `conditionsAstSchema` and every condition field exists in the trigger's catalog fields with an operator legal for its type (`OPERATORS_BY_TYPE`); at least one action; every action ref in catalog and `Available`; trigger-record actions only when action.Collection === trigger.Collection; every required param present (params with `field` refs and text params may be empty strings — only enforce non-empty for relation params, matching what the engine can execute); schedule trigger requires a non-empty cron string. Record types come from the generated `Rules` interface (`@tinycld/core/types/pbSchema`) — define `RulesRecordFields = Omit<Rules, 'id' | 'owner' | 'created' | 'updated'>`.

- [ ] **Step 1: Failing tests** — table tests: `emptyDraft` validates clean except name/trigger/actions messages; record⇄draft round-trip preserves all fields; malformed `conditions` JSON in a record degrades to empty AST (no throw); `validateDraft` catches: unknown trigger, condition on a field not in catalog, illegal operator for type, unavailable action, trigger-record action against a different collection, schedule rule without cron, synthetic trigger with conditions. Build a small in-test `CatalogResponse` fixture (mirror Task 1's).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement `draft.ts`** (pure functions, no React), **then `use-rule-mutations.ts`** per the code block in Task 2's Interfaces (verify `useCurrentUserId` as noted there).
- [ ] **Step 4: GREEN** — vitest + typecheck clean.
- [ ] **Step 5: Commit (tinycld)** — `feat(automation): rule draft model, validation, and mutation hooks`

---

### Task 4: Builder pickers (TriggerCard, ConditionRow, ValueInput, RelationRecordPicker)

**Files:**
- Create: `tinycld/core/components/rules/{TriggerCard,ConditionsCard,ConditionRow,ValueInput,RelationRecordPicker}.tsx`
- Create: `tinycld/core/lib/stores/rules-ui-store.ts`
- Test: `tinycld/core/lib/automation/__tests__/condition-helpers.test.ts` (extract any non-trivial pure logic these components need into `core/lib/automation/condition-helpers.ts` and test it there — e.g. `operatorsForField(field: CatalogField)`, which drops `is_empty` for numbers and returns `OPERATORS_BY_TYPE[type]` otherwise, and `operatorLabel(op)` mapping snake_case ops to human labels)

**Contracts (transcribe exactly; assemble JSX per the referenced idioms):**
- All components receive data via props — no internal fetching except `RelationRecordPicker` (which live-queries its target collection). Card chrome copies the `SectionCard` idiom (`rounded-xl border p-4 bg-surface-secondary border-border`, `personal.tsx:501`); pickers use `@tinycld/core/ui/menu` (`Menu` + `MenuActionItem` from `core/components/DropdownMenu.tsx`); text/number inputs use `@tinycld/core/ui/PlainInput` / controlled `NumberInput`-style inputs (NOT the RHF form components — the builder is not an RHF form).
- `rules-ui-store.ts` (Zustand, non-persisted with a comment why — a restored open builder would reopen a dialog the user didn't ask for, the search-palette rationale):

```ts
interface RulesUiState {
    builder: { mode: 'closed' } | { mode: 'create'; scope: 'personal' | 'org'; presetPkg?: string } | { mode: 'edit'; ruleId: string }
    historyRuleId: string | null
    openCreate: (scope: 'personal' | 'org', presetPkg?: string) => void
    openEdit: (ruleId: string) => void
    closeBuilder: () => void
    openHistory: (ruleId: string) => void
    closeHistory: () => void
}
```

- `TriggerCard`: props `{ draft: RuleDraft; catalog: CatalogResponse; onChange: (patch: Partial<RuleDraft>) => void; isLocked: boolean }`. Renders the WHEN card: a Menu grouped by package (`Menu.Label` per pkg, `MenuActionItem` per trigger; when `presetPkg` filtering is on the parent passes a pre-filtered catalog). Selecting a trigger resets conditions/actions via `onChange({ trigger, conditions: emptyAst, actions: [] })` — changing the trigger invalidates both. `isLocked` (edit mode) renders the trigger as static text (changing a saved rule's trigger is a delete+recreate decision, per spec simplicity). When the selected trigger is `core:schedule`, render the schedule row: a Menu of presets (`Every hour → 0 * * * *`, `Every day at 8:00 → 0 8 * * *`, `Every Monday at 8:00 → 0 8 * * 1`, `Custom…`) plus a monospace `PlainInput` for the raw cron string bound to `draft.triggerConfig.cron`.
- `ConditionsCard`: props `{ draft; catalog; onChange }`. Hidden entirely (`return null`) for synthetic triggers. Renders the IF card: top-level match toggle ("all groups" / "any group" — `SelectInput`-style pill pair is fine here), group boxes each with their own any/all pill pair and `ConditionRow`s, `+ add condition` per group, `+ add OR group` at the bottom, per-row and per-group remove (Trash2 icon buttons). All AST surgery is pure helpers in `condition-helpers.ts` (`addGroup`, `addCondition`, `updateCondition`, `removeCondition`, `removeGroup` — immutable updates), tested in this task.
- `ConditionRow`: props `{ condition; fields: CatalogField[]; onChange; onRemove }`. Three cells: field Menu (labels from catalog), operator Menu (`operatorsForField`), and `ValueInput` (hidden for `NO_VALUE_OPS` members). Changing field resets op to the first legal one and clears value; changing op to an incompatible-value op clears value.
- `ValueInput`: props `{ field: CatalogField; op: string; value: unknown; onChange: (v: string | number | boolean) => void }` — type switch: text → `PlainInput`; number (incl. `within_last_days` regardless of field type) → numeric input; select → Menu of `field.options`; relation → `RelationRecordPicker`; date → `PlainInput` with `YYYY-MM-DD` placeholder (a native date picker is out of scope; the engine accepts bare dates); boolean ops carry no value.
- `RelationRecordPicker`: props `{ target: string; displayField: string; value: string; onChange: (id: string) => void }`. Uses `useStore(target as never)`-style dynamic access — **no**: `useStore` is typed by name. Instead query via the registered collection when it exists in the store map; the practical approach is `useOrgLiveQuery` over the collection obtained from a `useStore`-compatible lookup. Implement as: accept an optional `collection` prop resolved by the caller when the target is a known core/package store, else fall back to a one-shot `pb.collection(target).getList(1, 50)` wrapped in `useQuery` (read-only; allowed — reads are rule-governed) with a comment explaining why raw read here: relation targets are arbitrary collections not guaranteed to be in the client store registry. Renders a Menu of up to 50 records showing `record[displayField] ?? record.id`, with the current value's label resolved from the same list.
- Everything must render acceptably on native: Menus are the existing cross-platform component; no drag interactions in this task.

- [ ] **Step 1: Failing tests** — `condition-helpers.test.ts`: `operatorsForField` (number excludes `is_empty`; select returns is/is_not; unknown type → []); AST surgery helpers (add/update/remove preserve immutability and shape); `operatorLabel` covers every op in `ALL_OPS`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement helpers + the five components + store.**
- [ ] **Step 4: GREEN + member check** — vitest, then `pnpm exec tinycld-pkg check` (biome + tsc + unit).
- [ ] **Step 5: Commit (tinycld)** — `feat(automation): rule builder picker components`

---

### Task 5: ActionsCard + template placeholders + DryRunPanel

**Files:**
- Create: `tinycld/core/components/rules/{ActionsCard,DryRunPanel}.tsx`
- Modify: `tinycld/core/lib/automation/condition-helpers.ts` (+ action list helpers) and its test

**Contracts:**
- `ActionsCard`: props `{ draft; catalog; onChange }`. THEN card: ordered action entries (index-numbered), `+ add action` Menu listing compatible actions — compatibility computed by a pure helper `compatibleActions(catalog, trigger): CatalogAction[]`: record-ops with `opTarget === 'trigger-record'` only when `action.collection === trigger.collection`; `opType === 'create'` record-ops and native actions always listed; synthetic triggers exclude trigger-record ops entirely. Unavailable actions (`available: false`) render disabled with a "needs {pkg}" suffix (`MenuActionItem disabled`). Each entry renders its params: one labeled input per `catalogParam` via `ValueInput` (relation params get the picker via `field.relationTarget`); text params with `template: true` get a trailing `{{ }}` icon button opening a Menu of the trigger's fields — selecting appends `{{key}}` to the param value. Remove per entry; reorder within actions via up/down icon buttons (not drag — small lists, avoids nesting a SortableList inside the builder drawer).
- `DryRunPanel`: props `{ draft; catalog; isVisible }`. Renders a "Test against recent items" `Button` (hidden for synthetic triggers) calling `useRuleMutations().dryRun` with `{ trigger: draft.trigger, conditions: draft.conditions }`. States: pending spinner; success → "Matched {matches.length} of the last {total}" + up to 10 match rows rendering `summary` values of the trigger's first two catalog fields; **the 400 "cannot be scoped" case renders as an informational row** (`text-muted`, no error styling): the server message verbatim plus "Org admins can test this trigger." — detect by `error` from the mutation and render its message; never toast it (pass explicit `onError: () => {}` with a comment referencing the phase-2 handoff).
- Helpers into `condition-helpers.ts`: `compatibleActions`, `moveAction(actions, from, to)`, `appendPlaceholder(value, key)`.

- [ ] **Step 1: Failing tests** — `compatibleActions` (trigger-record op filtered by collection; synthetic trigger excludes trigger-record ops; unavailable stays listed with `available:false`); `moveAction` bounds; `appendPlaceholder` formatting.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN + `tinycld-pkg check`.**
- [ ] **Step 5: Commit (tinycld)** — `feat(automation): action editor and dry-run preview`

---

### Task 6: RuleBuilder assembly + useRuleDraft

**Files:**
- Create: `tinycld/core/components/rules/RuleBuilder.tsx`
- Create: `tinycld/core/lib/automation/use-rule-draft.ts`
- Test: extend `draft.test.ts` if `use-rule-draft` grows pure logic (keep the hook thin: one `useState<RuleDraft>` + `patch` callback + `validate` memo)

**Contracts:**
- `useRuleDraft(initial: RuleDraft)` returns `{ draft, patch: (p: Partial<RuleDraft>) => void, errors: string[] | null, validate: (catalog) => boolean }` — `errors` populated only after a failed `validate` (submit-time validation, not keystroke).
- `RuleBuilder`: props `{ isOpen: boolean; onClose: () => void; scope: 'personal' | 'org'; ruleId?: string; presetPkg?: string }`. Wrapper: `Modal` size `lg` on web breakpoints, `BottomDrawer` on mobile — copy the responsive split from `NotificationDrawer.tsx` (and remember BottomDrawer's mount-region constraint). Loads the existing rule for edit mode via `useOrgLiveQuery` + `recordToDraft`; loads `useAutomationCatalog()` (spinner until ready; error → `EmptyState` with retry). Body: name `PlainInput`, `TriggerCard` (locked in edit mode), `ConditionsCard`, `ActionsCard`, `DryRunPanel`, footer row with `stop_processing` `Toggle`, Cancel `Button variant="outline"`, Save `Button` (disabled while `save.isPending`). Save: `validate(catalog)` → on failure render the error list above the footer (`text-danger`, the FormErrorSummary visual idiom, hand-rolled since this isn't RHF); on success `save.mutate(draft)` then `onClose()` via `onSuccess`. Org scope + non-admin → the whole builder is never opened (panel gates it), but defensively render read-only if it happens.
- Register an Escape-to-close only if `Modal` doesn't already (it does — scope `MODAL`; do not double-register).

- [ ] **Step 1–4: implement + member check green** (the builder's correctness is exercised by unit-tested helpers underneath and the e2e specs in Tasks 10/12; no new unit test file unless pure logic emerges).
- [ ] **Step 5: Commit (tinycld)** — `feat(automation): rule builder`

---

### Task 7: RulesPanel + RuleRow + RunHistory

**Files:**
- Create: `tinycld/core/components/rules/{RulesPanel,RuleRow,RunHistory}.tsx`
- Create: `tinycld/core/components/rules/rule-summary.ts` (+ test `__tests__/rule-summary.test.ts` under `core/lib/automation/` or colocated per existing convention — check where component-adjacent pure helpers are tested; `core/lib/automation/__tests__/` is established, prefer it)

**Contracts:**
- `rule-summary.ts`: `ruleSummary(record, catalog): string` — "⚡ {trigger label} · {n} condition(s) · {action labels joined}"-style single line (use words, not emoji, if the design reads better: "When a message arrives · 2 conditions · Move to folder, Apply label"); unknown refs (uninstalled package) → `needsPackage(record, catalog): string | null` returning the missing pkg slug. Tested.
- `RulesPanel`: props `{ scope: 'personal' | 'org'; pkgFilter?: string; canEdit: boolean }`. Data: `useOrgLiveQuery` — personal: `and(eq(r.scope,'personal'), eq(r.owner, userId))`; org: `eq(r.scope,'org')`; ordered by `order` asc. `pkgFilter` filters client-side on `parseRef(r.trigger).pkg === pkgFilter` (plus actions touching the pkg — keep to trigger pkg for v1, matching the spec's "rules with mail:* triggers"). Renders: header row (`+ New rule` Button when `canEdit`, opening `rules-ui-store.openCreate(scope, pkgFilter)`), `SortableList` of `RuleRow`s when `canEdit` (drag handle; `onReorder` → `reorder.mutate(orderedIds)`) else a plain list; `EmptyState` (`message: 'No rules yet — automate repetitive steps with a rule.'`, action opens create) when empty. Requires a `GestureHandlerRootView` ancestor — the mount screens provide it (Task 8). Renders `RuleBuilder` + `RunHistory` wired to the store (single instances at panel level).
- `RuleRow`: props `{ rule; catalog; canEdit }`. Layout: drag handle (`SortableDragHandle`, hidden when `!canEdit`) · name + summary line (`text-muted text-sm`) · badges (org scope pill when in a mixed context; `needs {pkg}` warning pill when `needsPackage` hits — row renders at reduced opacity) · last-run line (see below) · enabled `Switch` (disabled when `!canEdit`) · overflow Menu (Edit, Run history, Run now [only for synthetic-trigger rules; calls `runNow` and toasts "Queued" via `notify.emit`… check `notify.emit` requires registered event names — if adding an event to the typed registry is required, instead render transient local feedback: swap the menu item label to "Queued ✓" for 2s], Delete → `ConfirmDialog` `isDestructive`).
  - Last-run line: a per-row `useOrgLiveQuery` on `rule_runs` limited to the newest row for this rule would be N queries; instead the panel does ONE query for the newest run per visible rule set (`rule_runs` where `rule` in visible ids is not expressible — TanStack DB joins are: join `rules ⋈ rule_runs` and reduce in `.select()`… keep it simple and honest: query all `rule_runs` for the panel's rules joined via `.join()` on rule id, reduce to latest per rule in a memo. `mail/hooks/useMailboxes.ts` is the join reference).
- `RunHistory`: props `{ ruleId: string | null; onClose }` — drawer (responsive like the builder) listing that rule's `rule_runs` ordered `fired_at` desc: matched/no-match pill (`bg-success-soft` / muted), fired_at (relative time — check for an existing relative-time helper in core before writing one; mail renders message dates somewhere reusable), duration, per-action results (ref + ok/error + message), `error` row in `text-danger` when set. Empty → "No runs yet."

- [ ] **Step 1: Failing tests** — `rule-summary.test.ts` with a catalog fixture: summary composition, unknown-trigger → needsPackage, action label joining, condition count.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN + `tinycld-pkg check`.**
- [ ] **Step 5: Commit (tinycld)** — `feat(automation): rules panel, rows, and run history`

---

### Task 8: Mount in settings (personal + org)

**Files:**
- Create: `tinycld/app/(app)/settings/rules.tsx`
- Modify: `tinycld/app/(app)/settings/index.tsx` (Account group + AdminSettings group links)

**Contracts:**
- `settings/rules.tsx`: copy `labels.tsx`'s skeleton (back arrow + icon + title). Wrap content in `GestureHandlerRootView className="flex-1"` (SortableList requirement). Two segments (the `SelectInput` pill-pair idiom or two Pressable tabs — match `personal.tsx`'s section header style): **My rules** → `<RulesPanel scope="personal" canEdit />; **Organization** → `<RulesPanel scope="org" canEdit={isAdmin} />` (`useCurrentRole`). Non-admins see org rules read-only (RLS already permits reads; the panel renders without edit affordances). Title row gets `<HelpIcon topic="core:rules" />`.
- `settings/index.tsx`: `SettingsLink label="Rules"` with a `Workflow` Lucide icon in the **Account** group (visible to every member), navigating to `orgHref('settings/rules')`. No separate admin entry (the org segment lives inside the same screen — one surface, per the recon's recommendation).
- **Spec deviation, deliberate:** the spec's "Admin → Org rules via the existing systemSettings mechanism" predates the recon finding that `systemSettings` renders in the pre-auth `/setup` system console (deployment scope), not org administration — org admin IS `/settings` gated on `isAdmin`. The org segment on this screen is the correct realization of the spec's intent; note it in the spec after this task ships.

- [ ] **Step 1: Implement both.**
- [ ] **Step 2: Verify by running** — `pnpm exec tinycld-pkg check` clean; then boot the dev app (`cd tinycld && pnpm run dev`) long enough to click Settings → Rules, create a personal manual-trigger rule with a notify action, and confirm it saves and lists (manual smoke; the automated equivalent lands in Task 10). If booting the app isn't feasible in the execution environment, note it and rely on Task 10's e2e.
- [ ] **Step 3: Commit (tinycld)** — `feat(automation): rules screens in settings`

---

### Task 9: Mail embedded view (mail repo)

**Files:**
- Create: `mail/tinycld/mail/screens/rules.tsx`
- Modify: `mail/tinycld/mail/sidebar.tsx`

**Contracts:**
- `screens/rules.tsx`: screen shell matching mail's other screens (check `screens/index.tsx` for the header/container idiom), rendering `<GestureHandlerRootView className="flex-1">` wrapping `<RulesPanel scope="personal" pkgFilter="mail" canEdit />` imported from `@tinycld/core/components/rules/RulesPanel`, with a screen title "Mail rules" and `<HelpIcon topic="mail:rules" />`. The `+ New rule` flow opens the builder with the trigger picker pre-filtered to mail (the `presetPkg` plumbing from Task 4).
- `sidebar.tsx`: a `SidebarItem label="Rules" icon={Workflow}` after the existing settings-area items, `onPress={() => router.push(orgHref('mail/rules'))}`, `isActive` per the file's existing pattern, `testID="mail-sidebar-rules"`.
- Run the generator (`cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate`) — the `./screens/*` glob already exports the new screen; confirm `app/(app)/mail/rules.tsx` was emitted.

- [ ] **Step 1: Implement.** **Step 2: `pnpm run packages:generate` + both member typechecks clean (`mail`, `tinycld`).**
- [ ] **Step 3: Commit (mail repo)** — `feat: embedded rules view`

---

### Task 10: Help topics + core e2e

**Files:**
- Create: `tinycld/core/help/rules.md`
- Create: `tinycld/tests/e2e/rules.spec.ts`
- Modify (if needed): `tinycld/core/components/NotificationDrawer.tsx` — add a `Workflow` icon mapping for a future `automation` package key ONLY if the engine's notifications (Package: "core") don't already render acceptably; default is no change.

**Contracts:**
- `core/help/rules.md` frontmatter `title: Automation rules`, `summary: Automate repetitive steps when things happen`, `tags: [rules, automation, workflow]`. Body (task-oriented prose): creating a rule (Settings → Rules → New rule; When/If/Then walkthrough), personal vs organization rules (who sees/edits what; org rules run with admin authority), testing a rule (dry run; the "ask an admin" case for shared-mailbox triggers; Run now for scheduled/manual rules), run history and what "didn't match" rows mean, auto-disable after repeated failures. Cross-link `[Mail rules](help://mail:rules)`. No hardcoded hostnames; any shortcut mentions in Mac glyphs.
- `tests/e2e/rules.spec.ts` (runs in the app shell suite): uses `login`, then `page.getByTestId('nav-settings').click()` + `clickSidebarItem(page, 'Rules')`-style navigation (mirror `navigateToMailboxSettings`'s element-gated pattern). Specs:
  1. **Create + run a manual rule end-to-end:** New rule → name it (unique via `Date.now()` suffix — the e2e DB persists between tests) → trigger "Run manually" (core) → action "Send me a notification" with a unique title → Save → row appears with the summary line → overflow menu → Run now → open the notification bell → the unique title appears. (This exercises builder → engine → notifications with zero package dependencies.)
  2. **Validation surfaces:** New rule → Save with empty name/trigger → error list shows both messages; Cancel.
  3. **Toggle + delete:** toggle the created rule's switch off (assert switch state), delete via overflow → ConfirmDialog → row gone.
  4. **Run history:** after spec 1's run, open Run history → at least one row, matched pill visible.
- Run `pnpm run packages:generate` after adding the help file; assert the topic renders by adding to spec: navigate to Help → search "rules" → topic title visible (mirror `help.spec.ts`'s idioms).

- [ ] **Step 1: Write the help topic + spec.** **Step 2: `pnpm run packages:generate`.**
- [ ] **Step 3: Run the specs** — from `tinycld/`: `pnpm test:e2e -- -g "rules"` (the e2e serve harness per `scripts/e2e-serve.ts`; follow however `mail`'s CI target boots it — check `package.json` scripts for the canonical local invocation, likely `pnpm run test:e2e` orchestrates serve+run). All green; fix root causes on any flake.
- [ ] **Step 4: Commit (tinycld)** — `feat(automation): help topic and rules e2e`

---

### Task 11: Phase 1+2 deferred-minor sweep (tinycld)

**Files:** as needed per item.

Small items the earlier final reviews deferred to "the UI phase", now due:
- `core/components/NotificationDrawer.tsx`: engine notifications carry `package: "core"` and render with the Shield icon — acceptable; confirm visually in Task 10's spec run and change nothing unless it renders wrong. (Record the outcome in the report.)
- Confirm `tinycld/lib/generated/uniwind-sources.css` picks up any classes used only in mail's `screens/rules.tsx` (the `@source` scanning gap) — if mail-only classes miss, they're all standard classes already used in core; verify one styled element in the Task 12 spec.
- The Phase-2 ledger's "dry-run resolver-aware scoping" stays deferred (server work, not UI) — ensure the DryRunPanel message (Task 5) is the UI's complete handling; add a `// Phase-4 candidate:` comment at the DryRunPanel call site referencing the endpoints.go comment.

- [ ] **Step 1: Verify each; make only the changes that prove necessary.** **Step 2: member check green.** **Step 3: Commit (tinycld) if anything changed** — `chore(automation): ui-phase sweep of deferred items`

---

### Task 12: Mail e2e — the flagship flow (mail repo)

**Files:**
- Create: `mail/tests/rules.spec.ts`
- Create: `mail/help/rules.md`
- Modify: `mail/manifest.ts` only if `help` isn't already declared (it is — no change expected)

**Contracts:**
- `mail/help/rules.md`: `title: Mail rules`, `summary: Automatically file, label, and react to incoming mail`. Body: the Rules sidebar entry, that mail rules are the same rules as Settings → Rules filtered to mail, an example (label invoices), the shared-mailbox dry-run caveat, cross-link `[Automation rules](help://core:rules)`.
- `mail/tests/rules.spec.ts` (mail's playwright config, 90s timeout): `login` + `navigateToPackage(page, 'mail', …)`; then:
  1. **Flagship:** sidebar → Rules → New rule (trigger picker already scoped to mail) → trigger "A message arrives" → condition: Subject contains a unique token → action: core "Apply label" with an existing label (create the label first through the UI via the label manager if the seed provides none — check mail/core seeds; `LabelManagerDialog` is reachable from mail's sidebar) → Save. Deliver an inbound message containing the token via `deliverInbound()` from `mail/tests/helpers.ts` (the real ingress path). Poll the mail UI for the message, then assert the label appears on it (however mail renders labels on list rows), and Run history for the rule shows a matched run.
  2. **Non-match logged:** deliver a second message WITHOUT the token; open the rule's Run history; assert a `Didn't match` row exists (proves observability of non-matches).
  3. **Dry-run graceful degradation:** in the builder (edit the rule), press "Test against recent items"; assert the informational message renders (TEST_USER may be an admin — check `helpers.ts`; if the primary test user is an admin, use `createInvitedUser` to get a member, log in as them, create a personal mail rule, and assert the message there — the invited-user path exists exactly for this).
  4. **Parity:** the rule created in mail's embedded view is visible in Settings → Rules (personal segment).
- Never create/edit data via raw PB calls; `deliverInbound` is the sanctioned ingress.

- [ ] **Step 1: Write help + spec.** **Step 2: `pnpm run packages:generate`** (help). **Step 3: run `cd /Users/nas/code/tinycld/mail && pnpm exec tinycld-pkg test:e2e -- -g "rules"`** — green, root-cause any flake.
- [ ] **Step 4: Commit (mail repo)** — `feat: mail rules e2e and help topic`

---

## Phase 3 exit criteria

- `pnpm exec tinycld-pkg check` green in `tinycld/`; `go test ./...` green in `core/server`; both e2e suites' rules specs green.
- A member (non-admin) can: create/edit/toggle/reorder/delete personal rules from Settings → Rules; see org rules read-only; test a rule (dry run where scopable, informational message where not); run a manual rule and see the notification; read run history including non-matches.
- Mail's sidebar has Rules; its panel is the same records filtered to mail; the flagship deliver→label→history flow passes.
- Help topics exist for `core:rules` and `mail:rules` and render in the help hub.

**Follow-ups deliberately out of scope** (tracked in phase-2 handoff): resolver-aware dry-run scoping; dynamic (DB-installed) package catalogs (`useAutomationCatalog` serves them automatically once install-time defs reach the engine — a future re-sync updates the `automation_catalog` rows and every open client reacts live, which is exactly why the catalog is a collection); mail's dead `direction` guard; native date-picker for date conditions.
