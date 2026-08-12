# Workflow Rules Phase 1: Declaration Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the declaration half of the workflow-rules feature: the types packages use to declare automation triggers/actions, the manifest field + generator plumbing that carries them into the client config and a server JSON, the derived catalogs the future builder UI will read, and the `rules`/`rule_runs` collections — proven end-to-end by mail declaring a real trigger.

**Architecture:** Follows the spec at `docs/superpowers/specs/2026-08-11-workflow-rules-design.md`. Packages ship a pure-data `automation.ts` typed against their generated schema; the manifest points at it (`automation: { definitions: 'automation' }`). The generator imports it, validates it, emits it into `tinycld.config.ts` entries (client) and materializes merged JSON to `server/automation_defs.json` (future Go engine input). `derive-automation.ts` merges package definitions with core built-ins into ref-keyed catalogs. Phase 2 (Go engine + field resolution) and Phase 3 (UI) get their own plans.

**Tech Stack:** TypeScript, zod v4, vitest, PocketBase JS migrations, the existing generator (`tinycld/scripts/generate.ts`).

## Global Constraints

- Biome style: 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons. **Never use `any`**; never add biome-ignore comments.
- The workspace root is `~/code/tinycld/`. The `tinycld` member repo is `~/code/tinycld/tinycld/` (core nested at `tinycld/core/`); mail is its own repo at `~/code/tinycld/mail/`. **Commit tasks 1–7 in the `tinycld` repo, task 8 in the `mail` repo.** Never mention Claude in commit messages.
- Run vitest from the tinycld member: `cd ~/code/tinycld/tinycld && pnpm exec vitest run <path>`. Never run `pnpm install` inside a member.
- Manifest values and `automation.ts` must stay **pure data** (JSON-serializable, no computed values). `automation.ts` may use `import type` only.
- Core migrations are unreleased until the next release: these two new files may be edited in place during this phase, but must never be renamed once released.
- Siblings never import each other; core never imports a sibling. Core's automation modules must typecheck with zero feature packages linked (lean shell).
- If any check fails during a task, diagnose and fix at the source — never skip, re-run blindly, or work around.

## Phase 2 handoff notes (record here, do not solve now)

- `mail_messages` has **no user FK** (no `user`/`owner`/`author` column — mailboxes are shared; closest is `alias`). Personal-rule scoping for mail triggers cannot use the auto-detected owner field and needs an engine-level answer in Phase 2 (e.g. alias→mailbox-membership resolution, or org-rules-only for such triggers).
- Field **resolution** (column key → `FieldType`, relation target, select options) is deliberately absent from this phase. The client-generated `pbZodSchema.ts` lacks relation targets, so resolution belongs to Go, which has full collection metadata: the Phase 2 engine resolves at boot, and the `export-types` binary (which replays all migrations) is the natural place to also emit a resolved client catalog. Phase 1 catalogs carry raw declarations only.
- `core:notify` and all native-action *execution* is Phase 2 (`automation.RegisterAction` registry in Go).

Added during Phase 1 execution:

- **Dynamic (DB-installed) package catalogs:** `packageAutomation` is static-only (derive-components precedent). `usePackages()[].automation` carries the RAW `{ definitions }` manifest pointer, not resolved defs. Delivering catalogs for DB-installed packages needs resolved defs embedded in `manifest_json` at install time plus a hook-level catalog (e.g. `useAutomationCatalog`) merging static + dynamic.
- **`rule_runs` relation dot-traversal:** its list/view rules (`rule.owner = ...`) are the codebase's first use of relation traversal in an access rule; semantics are unverified until the engine writes runs. Phase 2 must smoke-test that a run is visible to the rule owner and invisible to an unrelated user.
- **Security rulings recorded in the spec:** `rules.updateRule` is body-locked (`@request.body.*:isset`); guests can't read org rules or create rules; org-rule runs are admin/owner-visible only.

---

### Task 1: Automation authoring types + helpers

**Files:**
- Create: `tinycld/core/lib/automation/types.ts`
- Create: `tinycld/core/lib/automation/helpers.ts`
- Test: `tinycld/core/lib/automation/__tests__/helpers.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; `SchemaDeclaration`-shaped generics only).
- Produces: types `AutomationDefinitions<S>`, `TriggerDef`, `ActionDef`, `RecordOp`, `ParamDef`, `FieldType`, `ConditionOp`, `SetValue`; helpers `OPERATORS_BY_TYPE: Record<FieldType, readonly ConditionOp[]>`, `NO_VALUE_OPS: ReadonlySet<ConditionOp>`, `ALL_OPS: readonly ConditionOp[]`, `humanizeFieldKey(key: string): string`, `qualifyRef(pkgSlug: string, id: string): string`, `parseRef(ref: string): { pkg: string; id: string }`. Later tasks import these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// tinycld/core/lib/automation/__tests__/helpers.test.ts
import { describe, expect, it } from 'vitest'
import {
    ALL_OPS,
    humanizeFieldKey,
    NO_VALUE_OPS,
    OPERATORS_BY_TYPE,
    parseRef,
    qualifyRef,
} from '../helpers'

describe('humanizeFieldKey', () => {
    it('replaces underscores and capitalizes the first letter only', () => {
        expect(humanizeFieldKey('has_attachments')).toBe('Has attachments')
        expect(humanizeFieldKey('subject')).toBe('Subject')
        expect(humanizeFieldKey('sender_email')).toBe('Sender email')
    })
})

describe('refs', () => {
    it('round-trips a qualified ref', () => {
        expect(qualifyRef('mail', 'message-received')).toBe('mail:message-received')
        expect(parseRef('mail:message-received')).toEqual({ pkg: 'mail', id: 'message-received' })
    })

    it('throws on a malformed ref', () => {
        expect(() => parseRef('no-colon')).toThrow(/malformed automation ref/)
    })
})

describe('operator sets', () => {
    it('covers every field type', () => {
        expect(Object.keys(OPERATORS_BY_TYPE).sort()).toEqual([
            'boolean',
            'date',
            'number',
            'relation',
            'select',
            'text',
        ])
    })

    it('every operator appears in ALL_OPS exactly once', () => {
        const flattened = Object.values(OPERATORS_BY_TYPE).flat()
        expect(new Set(flattened).size).toBe(flattened.length)
        expect([...flattened].sort()).toEqual([...ALL_OPS].sort())
    })

    it('value-less operators are exactly the is_true/is_false/is_empty set', () => {
        expect([...NO_VALUE_OPS].sort()).toEqual(['is_empty', 'is_false', 'is_true'])
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/helpers.test.ts`
Expected: FAIL — cannot resolve `../helpers`.

- [ ] **Step 3: Write the types module**

```ts
// tinycld/core/lib/automation/types.ts
// Authoring types for a package's automation.ts (pure data, spec:
// docs/superpowers/specs/2026-08-11-workflow-rules-design.md). The S generic is
// the package's generated schema map ({ collection: { type, relations } }), so
// collection and field references are compile-checked in the package.

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'relation'

export type ConditionOp =
    | 'contains'
    | 'not_contains'
    | 'equals'
    | 'starts_with'
    | 'eq'
    | 'neq'
    | 'gt'
    | 'lt'
    | 'is_true'
    | 'is_false'
    | 'before'
    | 'after'
    | 'within_last_days'
    | 'is'
    | 'is_not'
    | 'is_empty'

type AnySchema = Record<string, { type: Record<string, unknown> }>
type CollectionsOf<S> = keyof S & string
type FieldsOf<S, C extends keyof S> = S[C] extends { type: infer T } ? keyof T & string : string

/** A trigger field entry: bare column key, or key + display-label override. */
export type FieldRef<F extends string = string> = F | { key: F; label: string }

export interface RecordTriggerDefBase<C extends string, F extends string> {
    id: string
    label: string
    collection: C
    on: 'create' | 'update' | 'delete'
    /** update triggers only: fire only when one of these columns changed */
    watch?: F[]
    /** omitted = expose every schema column (see spec: contract rules) */
    fields?: FieldRef<F>[]
    /** override the auto-detected user/owner/author owner column */
    ownerField?: F
}

export type RecordTriggerDef<S = AnySchema> = {
    [C in CollectionsOf<S>]: RecordTriggerDefBase<C, FieldsOf<S, C>>
}[CollectionsOf<S>]

/**
 * Core-only synthetic triggers with no backing record (core:schedule,
 * core:manual). Declared by core's own catalog; the generator rejects them in
 * feature packages.
 */
export interface SyntheticTriggerDef {
    id: string
    label: string
    synthetic: 'schedule' | 'manual'
}

export type TriggerDef<S = AnySchema> = RecordTriggerDef<S> | SyntheticTriggerDef

/**
 * A value written by a record-op `set` entry:
 * - `{ param }`: the rule author supplies it (static value or template)
 * - `{ context }`: engine-provided — the trigger record's id, its collection
 *   name, or the executing rule's owner id
 * - literal: fixed at declaration time
 */
export type SetValue =
    | { param: string }
    | { context: 'record-id' | 'collection' | 'owner' }
    | string
    | number
    | boolean

export type RecordOp<F extends string = string> =
    | { type: 'update'; target: 'trigger-record'; set: Partial<Record<F, SetValue>> }
    | { type: 'delete'; target: 'trigger-record' }
    | { type: 'create'; set: Partial<Record<F, SetValue>> }

/** Column-referencing param (type/relation resolved from the column in Phase 2) */
export interface ColumnParamDef<F extends string = string> {
    key: string
    field: F
    label?: string
}

/** Novel param (not a DB column) — declares its own type */
export interface TypedParamDef {
    key: string
    type: FieldType
    label?: string
    options?: string[]
}

export type ParamDef<F extends string = string> = ColumnParamDef<F> | TypedParamDef

export type RecordOpActionDef<S = AnySchema> = {
    [C in CollectionsOf<S>]: {
        id: string
        label: string
        kind: 'record-op'
        collection: C
        op: RecordOp<FieldsOf<S, C>>
        params?: ParamDef<FieldsOf<S, C>>[]
    }
}[CollectionsOf<S>]

export interface NativeActionDef {
    id: string
    label: string
    kind: 'native'
    params?: TypedParamDef[]
}

export type ActionDef<S = AnySchema> = RecordOpActionDef<S> | NativeActionDef

export interface AutomationDefinitions<S = AnySchema> {
    triggers?: TriggerDef<S>[]
    actions?: ActionDef<S>[]
}
```

- [ ] **Step 4: Write the helpers module**

```ts
// tinycld/core/lib/automation/helpers.ts
import type { ConditionOp, FieldType } from './types'

export const OPERATORS_BY_TYPE: Record<FieldType, readonly ConditionOp[]> = {
    text: ['contains', 'not_contains', 'equals', 'starts_with'],
    number: ['eq', 'neq', 'gt', 'lt'],
    boolean: ['is_true', 'is_false'],
    date: ['before', 'after', 'within_last_days'],
    relation: ['is', 'is_not', 'is_empty'],
    select: ['is', 'is_not'],
}

export const ALL_OPS: readonly ConditionOp[] = Object.values(OPERATORS_BY_TYPE).flat()

export const NO_VALUE_OPS: ReadonlySet<ConditionOp> = new Set(['is_true', 'is_false', 'is_empty'])

export function humanizeFieldKey(key: string): string {
    const spaced = key.replace(/_/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function qualifyRef(pkgSlug: string, id: string): string {
    return `${pkgSlug}:${id}`
}

export function parseRef(ref: string): { pkg: string; id: string } {
    const idx = ref.indexOf(':')
    if (idx <= 0 || idx === ref.length - 1) {
        throw new Error(`malformed automation ref: '${ref}'`)
    }
    return { pkg: ref.slice(0, idx), id: ref.slice(idx + 1) }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/helpers.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add core/lib/automation/types.ts core/lib/automation/helpers.ts core/lib/automation/__tests__/helpers.test.ts
git commit -m "feat(automation): authoring types and operator helpers"
```

---

### Task 2: Zod schemas for stored rule JSON + definitions validation

**Files:**
- Create: `tinycld/core/lib/automation/schemas.ts`
- Test: `tinycld/core/lib/automation/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: `ALL_OPS`, `NO_VALUE_OPS` from `./helpers`; `AutomationDefinitions` from `./types`.
- Produces: `conditionSchema`, `conditionGroupSchema`, `conditionsAstSchema`, `ruleActionSchema`, `ruleActionsSchema` (zod schemas validating the `rules.conditions` / `rules.actions` JSON columns), and `validateDefinitions(pkgSlug: string, defs: AutomationDefinitions, opts?: { allowSynthetic?: boolean }): string[]` returning human-readable errors (empty = valid). Task 5's generator and Phase 3's builder both call these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// tinycld/core/lib/automation/__tests__/schemas.test.ts
import { describe, expect, it } from 'vitest'
import { conditionsAstSchema, ruleActionsSchema, validateDefinitions } from '../schemas'
import type { AutomationDefinitions } from '../types'

const validAst = {
    match: 'all',
    groups: [
        {
            match: 'any',
            conditions: [
                { field: 'sender_email', op: 'contains', value: '@acme.com' },
                { field: 'sender_email', op: 'contains', value: '@example.com' },
            ],
        },
        { match: 'all', conditions: [{ field: 'has_attachments', op: 'is_true' }] },
    ],
}

describe('conditionsAstSchema', () => {
    it('accepts the spec example AST', () => {
        expect(conditionsAstSchema.safeParse(validAst).success).toBe(true)
    })

    it('accepts an empty groups array (rule with no conditions)', () => {
        expect(conditionsAstSchema.safeParse({ match: 'all', groups: [] }).success).toBe(true)
    })

    it('rejects an unknown operator', () => {
        const bad = { match: 'all', groups: [{ match: 'any', conditions: [{ field: 'x', op: 'regex', value: 'y' }] }] }
        expect(conditionsAstSchema.safeParse(bad).success).toBe(false)
    })

    it('rejects a value-carrying op with no value', () => {
        const bad = { match: 'all', groups: [{ match: 'any', conditions: [{ field: 'x', op: 'contains' }] }] }
        expect(conditionsAstSchema.safeParse(bad).success).toBe(false)
    })

    it('accepts a value-less op with no value', () => {
        const ok = { match: 'all', groups: [{ match: 'any', conditions: [{ field: 'x', op: 'is_empty' }] }] }
        expect(conditionsAstSchema.safeParse(ok).success).toBe(true)
    })

    it('rejects a group with zero conditions', () => {
        const bad = { match: 'all', groups: [{ match: 'any', conditions: [] }] }
        expect(conditionsAstSchema.safeParse(bad).success).toBe(false)
    })
})

describe('ruleActionsSchema', () => {
    it('accepts an ordered action list with qualified refs', () => {
        const ok = [
            { ref: 'mail:move-to-folder', params: { folder: 'abc123def456ghi' } },
            { ref: 'core:apply-label', params: { label: 'abc123def456ghi' } },
        ]
        expect(ruleActionsSchema.safeParse(ok).success).toBe(true)
    })

    it('rejects an unqualified ref and an empty list', () => {
        expect(ruleActionsSchema.safeParse([{ ref: 'move-to-folder', params: {} }]).success).toBe(false)
        expect(ruleActionsSchema.safeParse([]).success).toBe(false)
    })

    it('defaults params to an empty object', () => {
        const parsed = ruleActionsSchema.parse([{ ref: 'core:notify' }])
        expect(parsed[0].params).toEqual({})
    })
})

describe('validateDefinitions', () => {
    const good: AutomationDefinitions = {
        triggers: [
            { id: 'message-received', label: 'A message arrives', collection: 'mail_messages', on: 'create' },
        ],
        actions: [
            {
                id: 'move-to-folder',
                label: 'Move to folder',
                kind: 'record-op',
                collection: 'mail_messages',
                op: { type: 'update', target: 'trigger-record', set: { alias: { param: 'alias' } } },
                params: [{ key: 'alias', field: 'alias' }],
            },
        ],
    }

    it('returns no errors for a valid definition set', () => {
        expect(validateDefinitions('mail', good)).toEqual([])
    })

    it('rejects malformed and duplicate ids', () => {
        const dup: AutomationDefinitions = {
            triggers: [
                { id: 'Same_Id', label: 'x', collection: 'c', on: 'create' },
                { id: 'Same_Id', label: 'y', collection: 'c', on: 'create' },
            ],
        }
        const errors = validateDefinitions('mail', dup)
        expect(errors.some(e => e.includes('kebab-case'))).toBe(true)
        expect(errors.some(e => e.includes('duplicate'))).toBe(true)
    })

    it('rejects synthetic triggers outside core', () => {
        const synthetic: AutomationDefinitions = {
            triggers: [{ id: 'schedule', label: 'On a schedule', synthetic: 'schedule' }],
        }
        expect(validateDefinitions('mail', synthetic).some(e => e.includes('synthetic'))).toBe(true)
        expect(validateDefinitions('core', synthetic, { allowSynthetic: true })).toEqual([])
    })

    it('rejects a record-op whose set references an undeclared param', () => {
        const bad: AutomationDefinitions = {
            actions: [
                {
                    id: 'move',
                    label: 'Move',
                    kind: 'record-op',
                    collection: 'c',
                    op: { type: 'update', target: 'trigger-record', set: { folder: { param: 'missing' } } },
                    params: [],
                },
            ],
        }
        expect(validateDefinitions('mail', bad).some(e => e.includes('missing'))).toBe(true)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/schemas.test.ts`
Expected: FAIL — cannot resolve `../schemas`.

- [ ] **Step 3: Write the schemas module**

```ts
// tinycld/core/lib/automation/schemas.ts
import { z } from 'zod'
import { ALL_OPS, NO_VALUE_OPS } from './helpers'
import type { AutomationDefinitions, ConditionOp } from './types'

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const REF_RE = /^[a-z0-9-]+:[a-z0-9-]+$/

export const conditionSchema = z
    .object({
        field: z.string().min(1),
        op: z.enum(ALL_OPS as [ConditionOp, ...ConditionOp[]]),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })
    .superRefine((c, ctx) => {
        if (!NO_VALUE_OPS.has(c.op) && c.value === undefined) {
            ctx.addIssue({ code: 'custom', message: `operator '${c.op}' requires a value` })
        }
    })

export const conditionGroupSchema = z.object({
    match: z.enum(['all', 'any']),
    conditions: z.array(conditionSchema).min(1),
})

// One level of grouping by construction: groups contain conditions, never
// other groups (spec: condition AST).
export const conditionsAstSchema = z.object({
    match: z.enum(['all', 'any']),
    groups: z.array(conditionGroupSchema),
})

export const ruleActionSchema = z.object({
    ref: z.string().regex(REF_RE, 'action ref must be qualified as <pkg>:<id>'),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})

export const ruleActionsSchema = z.array(ruleActionSchema).min(1)

function checkId(errors: string[], pkgSlug: string, what: string, id: string, seen: Set<string>) {
    if (!ID_RE.test(id)) {
        errors.push(`${pkgSlug}: ${what} id '${id}' must be kebab-case ([a-z0-9-])`)
    }
    if (seen.has(id)) errors.push(`${pkgSlug}: duplicate ${what} id '${id}'`)
    seen.add(id)
}

/**
 * Structural validation of a package's automation definitions. Collection and
 * column EXISTENCE is not checked here — the package's own typecheck enforces
 * it at compile time, and Phase 2's Go resolution re-checks at runtime.
 */
export function validateDefinitions(
    pkgSlug: string,
    defs: AutomationDefinitions,
    opts: { allowSynthetic?: boolean } = {}
): string[] {
    const errors: string[] = []
    const triggerIds = new Set<string>()
    for (const t of defs.triggers ?? []) {
        checkId(errors, pkgSlug, 'trigger', t.id, triggerIds)
        if ('synthetic' in t) {
            if (!opts.allowSynthetic) {
                errors.push(`${pkgSlug}: trigger '${t.id}' is synthetic — only core may declare synthetic triggers`)
            }
        } else if (!t.collection) {
            errors.push(`${pkgSlug}: trigger '${t.id}' has no collection`)
        }
    }
    const actionIds = new Set<string>()
    for (const a of defs.actions ?? []) {
        checkId(errors, pkgSlug, 'action', a.id, actionIds)
        const paramKeys = new Set<string>()
        for (const p of a.params ?? []) {
            if (paramKeys.has(p.key)) errors.push(`${pkgSlug}: action '${a.id}' duplicate param '${p.key}'`)
            paramKeys.add(p.key)
        }
        if (a.kind === 'record-op') {
            if (!a.collection) errors.push(`${pkgSlug}: record-op action '${a.id}' has no collection`)
            if (a.op.type !== 'delete') {
                for (const v of Object.values(a.op.set)) {
                    if (typeof v === 'object' && v !== null && 'param' in v && !paramKeys.has(v.param)) {
                        errors.push(`${pkgSlug}: action '${a.id}' set references undeclared param '${v.param}'`)
                    }
                }
            }
        }
    }
    return errors
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add core/lib/automation/schemas.ts core/lib/automation/__tests__/schemas.test.ts
git commit -m "feat(automation): zod schemas for rule JSON and definitions validation"
```

---

### Task 3: Core built-in catalog

**Files:**
- Create: `tinycld/core/lib/automation/core-defs.ts`
- Test: `tinycld/core/lib/automation/__tests__/core-defs.test.ts`

**Interfaces:**
- Consumes: `AutomationDefinitions` from `./types`, `validateDefinitions` from `./schemas`.
- Produces: `CORE_AUTOMATION: AutomationDefinitions` and `CORE_PKG_SLUG = 'core'`. Task 5 merges it into the server JSON; Task 6 merges it into the client catalogs.

- [ ] **Step 1: Write the failing test**

```ts
// tinycld/core/lib/automation/__tests__/core-defs.test.ts
import { describe, expect, it } from 'vitest'
import { CORE_AUTOMATION, CORE_PKG_SLUG } from '../core-defs'
import { validateDefinitions } from '../schemas'

describe('CORE_AUTOMATION', () => {
    it('is a valid definition set (synthetic triggers allowed for core)', () => {
        expect(validateDefinitions(CORE_PKG_SLUG, CORE_AUTOMATION, { allowSynthetic: true })).toEqual([])
    })

    it('declares the built-in triggers and actions from the spec', () => {
        const triggerIds = (CORE_AUTOMATION.triggers ?? []).map(t => t.id)
        const actionIds = (CORE_AUTOMATION.actions ?? []).map(a => a.id)
        expect(triggerIds).toEqual(['schedule', 'manual'])
        expect(actionIds).toEqual(['apply-label', 'notify'])
    })

    it('apply-label writes a polymorphic label_assignments record from context', () => {
        const applyLabel = (CORE_AUTOMATION.actions ?? []).find(a => a.id === 'apply-label')
        expect(applyLabel).toMatchObject({
            kind: 'record-op',
            collection: 'label_assignments',
            op: {
                type: 'create',
                set: {
                    label: { param: 'label' },
                    record_id: { context: 'record-id' },
                    collection: { context: 'collection' },
                    user: { context: 'owner' },
                },
            },
        })
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/core-defs.test.ts`
Expected: FAIL — cannot resolve `../core-defs`.

- [ ] **Step 3: Write the module**

The `label_assignments` columns below are real (see `core/types/pbSchema.ts`: `label`, `record_id`, `collection`, `user`). `core:notify` params mirror `notify.NotifyUser`'s title/body/url; its Go handler is registered in Phase 2.

```ts
// tinycld/core/lib/automation/core-defs.ts
import type { AutomationDefinitions } from './types'

export const CORE_PKG_SLUG = 'core'

// Core's own trigger/action catalog. Typed loosely (no schema generic): core's
// collections are part of the base Schema, and this module must not import the
// generated pbSchema to stay usable in the generator's node context.
export const CORE_AUTOMATION: AutomationDefinitions = {
    triggers: [
        { id: 'schedule', label: 'On a schedule', synthetic: 'schedule' },
        { id: 'manual', label: 'Run manually', synthetic: 'manual' },
    ],
    actions: [
        {
            id: 'apply-label',
            label: 'Apply label',
            kind: 'record-op',
            collection: 'label_assignments',
            op: {
                type: 'create',
                set: {
                    label: { param: 'label' },
                    record_id: { context: 'record-id' },
                    collection: { context: 'collection' },
                    user: { context: 'owner' },
                },
            },
            params: [{ key: 'label', field: 'label' }],
        },
        {
            id: 'notify',
            label: 'Send me a notification',
            kind: 'native',
            params: [
                { key: 'title', type: 'text' },
                { key: 'body', type: 'text' },
                { key: 'url', type: 'text', label: 'Link (optional)' },
            ],
        },
    ],
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/automation/__tests__/core-defs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add core/lib/automation/core-defs.ts core/lib/automation/__tests__/core-defs.test.ts
git commit -m "feat(automation): core built-in trigger/action catalog"
```

---

### Task 4: Manifest field + config emission

**Files:**
- Modify: `tinycld/core/lib/packages/types.ts` (after the `search` field, ~line 274)
- Modify: `tinycld/scripts/load-manifest.ts` (interface, after `search`, ~line 124)
- Modify: `tinycld/scripts/describe-packages.ts` (`ConfigPkg` mapping, ~line 46)
- Modify: `tinycld/scripts/gen-config.ts` (`ConfigPkg` interface ~line 46, `validateConfigPkg` ~line 80, `buildConfigSource` import + entry emission)
- Modify: `tinycld/core/lib/packages/config-types.ts` (`PackageEntry` ~line 95, `definePackageEntry` ~line 119)
- Test: `tinycld/scripts/__tests__/gen-config.test.ts`, `tinycld/scripts/__tests__/describe-packages.test.ts`

**Interfaces:**
- Consumes: `AutomationDefinitions` from `@tinycld/core/lib/automation/types`.
- Produces: manifest field `automation?: { definitions: string }` (subpath, e.g. `'automation'`); `ConfigPkg.automation?: string`; generated config entries carry `automation: <ident>Automation` (a default import of `<packageName>/<subpath>`); `PackageEntry.automation?: AutomationDefinitions`. Task 6's derive reads `entry.automation`; Task 5 reads `manifest.automation.definitions`.

- [ ] **Step 1: Write the failing tests**

Append to `tinycld/scripts/__tests__/gen-config.test.ts` inside `describe('buildConfigSource', ...)`:

```ts
    it('imports and attaches automation definitions when declared', () => {
        const withAutomation: ConfigPkg = { ...contacts, automation: 'automation' }
        const src = buildConfigSource([withAutomation])
        expect(src).toContain("import contactsAutomation from '@tinycld/contacts/automation'")
        expect(src).toContain('automation: contactsAutomation,')
    })

    it('omits automation entirely when not declared', () => {
        const src = buildConfigSource([contacts])
        expect(src).not.toContain('automation')
    })
```

Append to `tinycld/scripts/__tests__/describe-packages.test.ts` (follow the file's existing manifest-fixture style — build a minimal `PackageManifest` and assert on the returned `ConfigPkg`):

```ts
    it('maps manifest.automation.definitions to ConfigPkg.automation', () => {
        const pkg = manifestToConfigPkg('@tinycld/contacts', {
            name: 'Contacts',
            slug: 'contacts',
            version: '0.1.0',
            description: 'd',
            automation: { definitions: 'automation' },
        })
        expect(pkg.automation).toBe('automation')
    })

    it('leaves ConfigPkg.automation undefined when the manifest has none', () => {
        const pkg = manifestToConfigPkg('@tinycld/contacts', {
            name: 'Contacts',
            slug: 'contacts',
            version: '0.1.0',
            description: 'd',
        })
        expect(pkg.automation).toBeUndefined()
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/gen-config.test.ts scripts/__tests__/describe-packages.test.ts`
Expected: FAIL — `automation` unknown on `ConfigPkg` (type error) / assertions unmet.

- [ ] **Step 3: Implement the plumbing**

In `core/lib/packages/types.ts`, after the `search` field:

```ts
    /**
     * Workflow-rules catalog. `definitions` is a package-exports subpath (like
     * `seed.script`) resolving to a TS module default-exporting an
     * AutomationDefinitions object — pure data, typed against the package's
     * schema. See docs/superpowers/specs/2026-08-11-workflow-rules-design.md.
     */
    automation?: {
        definitions: string
    }
```

In `scripts/load-manifest.ts`, add to the local `PackageManifest` interface after `search`:

```ts
    // Workflow-rules catalog: exports subpath to the package's
    // AutomationDefinitions module. See core/lib/packages/types.ts.
    automation?: { definitions: string }
```

In `scripts/gen-config.ts`:

```ts
// ConfigPkg gains (after `search?: ConfigSearch`):
    automation?: string // exports subpath to the AutomationDefinitions module

// validateConfigPkg gains:
    if (p.automation) assertSafeImportField('automation', p.automation)

// buildConfigSource import loop (next to the hasRegister import block):
        if (p.automation) {
            lines.push(`import ${ident(p.slug)}Automation from '${p.packageName}/${p.automation}'`)
        }

// buildConfigSource entry emission (after the eventSources block, before the closing `})`):
        if (p.automation) lines.push(`        automation: ${ident(p.slug)}Automation,`)
```

In `scripts/describe-packages.ts`, add to the returned object (next to the `search` spread):

```ts
        ...(manifest.automation ? { automation: manifest.automation.definitions } : {}),
```

In `core/lib/packages/config-types.ts`: import the type and add the field in **both** `PackageEntry` and the `definePackageEntry` parameter literal:

```ts
import type { AutomationDefinitions } from '../automation/types'

// in PackageEntry<S, R>:
    automation?: AutomationDefinitions

// in definePackageEntry's entry parameter type:
        automation?: PackageEntry<S, R>['automation']
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/gen-config.test.ts scripts/__tests__/describe-packages.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the member**

Run: `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg typecheck`
Expected: clean. Fix any error at the source before continuing.

- [ ] **Step 6: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add core/lib/packages/types.ts core/lib/packages/config-types.ts scripts/load-manifest.ts scripts/describe-packages.ts scripts/gen-config.ts scripts/__tests__/gen-config.test.ts scripts/__tests__/describe-packages.test.ts
git commit -m "feat(automation): manifest automation field flows into the generated config"
```

---

### Task 5: Generator materialization (`gen-automation.ts`)

**Files:**
- Create: `tinycld/scripts/gen-automation.ts`
- Modify: `tinycld/scripts/generate.ts` (in `main()`, section 1, right after `const configPkgs: ConfigPkg[] = ...` ~line 623)
- Modify: `tinycld/.gitignore` (next to `/server/pb_migrations/`, ~line 89)
- Test: `tinycld/scripts/__tests__/gen-automation.test.ts`

**Interfaces:**
- Consumes: `AutomationDefinitions` + `validateDefinitions` + `CORE_AUTOMATION`/`CORE_PKG_SLUG` from `@tinycld/core/lib/automation/*`; `Feature`-shaped inputs `{ name, dir, manifest }`; `SERVER_DIR` from `./paths`.
- Produces: `loadAutomationDefs(packageDir: string, packageName: string, subpath: string): Promise<AutomationDefinitions>` (resolves via the package.json `exports` map, then dynamic-imports the file — same tsx mechanism as `loadManifest`); `mergeAutomationDefs(features: { slug: string; defs: AutomationDefinitions }[]): MergedAutomation` where `MergedAutomation = { packages: { slug: string; triggers: TriggerDef[]; actions: ActionDef[] }[] }` (core first, then features sorted by slug; throws on any `validateDefinitions` error); `emitAutomationDefs(merged: MergedAutomation): void` writing pretty-printed JSON to `path.join(SERVER_DIR, 'automation_defs.json')`. `generate.ts` calls all three; Phase 2's Go engine reads the JSON.

- [ ] **Step 1: Write the failing test**

```ts
// tinycld/scripts/__tests__/gen-automation.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAutomationDefs, mergeAutomationDefs } from '../gen-automation'

const tmpDirs: string[] = []
afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function makePkg(exportsMap: Record<string, string>, files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-automation-'))
    tmpDirs.push(dir)
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: '@tinycld/fake', exports: exportsMap })
    )
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
    return dir
}

describe('loadAutomationDefs', () => {
    it('resolves the subpath through the exports map and imports the module', async () => {
        // .js fixture on purpose: vitest's transform pipeline doesn't cover a
        // dynamic import of a bare .ts file in tmpdir. Production targets are
        // .ts and load fine because the generator runs under tsx.
        const dir = makePkg(
            { './automation': './tinycld/fake/automation.js' },
            {
                'tinycld/fake/automation.js':
                    "export default { triggers: [{ id: 'thing-created', label: 'A thing is created', collection: 'fake_things', on: 'create' }] }\n",
            }
        )
        const defs = await loadAutomationDefs(dir, '@tinycld/fake', 'automation')
        expect(defs.triggers?.[0]?.id).toBe('thing-created')
    })

    it('throws a clear error when the exports map lacks the subpath', async () => {
        const dir = makePkg({}, {})
        await expect(loadAutomationDefs(dir, '@tinycld/fake', 'automation')).rejects.toThrow(
            /no '\.\/automation' entry/
        )
    })
})

describe('mergeAutomationDefs', () => {
    it('puts core first and validates every package', () => {
        const merged = mergeAutomationDefs([
            {
                slug: 'mail',
                defs: {
                    triggers: [
                        { id: 'message-received', label: 'A message arrives', collection: 'mail_messages', on: 'create' },
                    ],
                },
            },
        ])
        expect(merged.packages[0].slug).toBe('core')
        expect(merged.packages[0].triggers.map(t => t.id)).toEqual(['schedule', 'manual'])
        expect(merged.packages[1].slug).toBe('mail')
    })

    it('throws when a feature declares a synthetic trigger', () => {
        expect(() =>
            mergeAutomationDefs([
                { slug: 'mail', defs: { triggers: [{ id: 'x', label: 'x', synthetic: 'schedule' }] } },
            ])
        ).toThrow(/synthetic/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/gen-automation.test.ts`
Expected: FAIL — cannot resolve `../gen-automation`.

- [ ] **Step 3: Implement gen-automation.ts**

```ts
// tinycld/scripts/gen-automation.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CORE_AUTOMATION, CORE_PKG_SLUG } from '../core/lib/automation/core-defs'
import { validateDefinitions } from '../core/lib/automation/schemas'
import type { ActionDef, AutomationDefinitions, TriggerDef } from '../core/lib/automation/types'
import { SERVER_DIR } from './paths'

export interface MergedAutomation {
    packages: { slug: string; triggers: TriggerDef[]; actions: ActionDef[] }[]
}

// Resolve an exports-map subpath to a file and import it, the same way tsx
// lets loadManifest import member TS directly. We read package.json ourselves
// (rather than createRequire) so the error names the missing entry precisely.
export async function loadAutomationDefs(
    packageDir: string,
    packageName: string,
    subpath: string
): Promise<AutomationDefinitions> {
    const pkgJsonPath = path.join(packageDir, 'package.json')
    const exportsMap = (JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).exports ?? {}) as Record<
        string,
        string
    >
    const rel = exportsMap[`./${subpath}`]
    if (!rel) {
        throw new Error(
            `[generate] ${packageName}: manifest declares automation definitions '${subpath}' but package.json exports has no './${subpath}' entry`
        )
    }
    const mod = await import(pathToFileURL(path.join(packageDir, rel)).href)
    return mod.default as AutomationDefinitions
}

export function mergeAutomationDefs(
    features: { slug: string; defs: AutomationDefinitions }[]
): MergedAutomation {
    const errors = [
        ...validateDefinitions(CORE_PKG_SLUG, CORE_AUTOMATION, { allowSynthetic: true }),
        ...features.flatMap(f => validateDefinitions(f.slug, f.defs)),
    ]
    if (errors.length > 0) {
        throw new Error(`[generate] invalid automation definitions:\n  ${errors.join('\n  ')}`)
    }
    const sorted = [...features].sort((a, b) => a.slug.localeCompare(b.slug))
    return {
        packages: [
            {
                slug: CORE_PKG_SLUG,
                triggers: CORE_AUTOMATION.triggers ?? [],
                actions: CORE_AUTOMATION.actions ?? [],
            },
            ...sorted.map(f => ({
                slug: f.slug,
                triggers: f.defs.triggers ?? [],
                actions: f.defs.actions ?? [],
            })),
        ],
    }
}

// Materialized for the Go engine (Phase 2 input) — same idiom as the caldav
// manifest block: TS is the authoring format, the server consumes JSON.
export function emitAutomationDefs(merged: MergedAutomation): void {
    fs.writeFileSync(
        path.join(SERVER_DIR, 'automation_defs.json'),
        `${JSON.stringify(merged, null, 4)}\n`
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run scripts/__tests__/gen-automation.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into generate.ts and gitignore**

In `scripts/generate.ts` `main()`, immediately after the `configPkgs` assembly (~line 623), add:

```ts
    // --- 1b. automation definitions → server/automation_defs.json ----------
    const automationFeatures = await Promise.all(
        features
            .filter(f => f.manifest.automation)
            .map(async f => ({
                slug: f.manifest.slug,
                defs: await loadAutomationDefs(
                    f.dir,
                    f.name,
                    (f.manifest.automation as { definitions: string }).definitions
                ),
            }))
    )
    emitAutomationDefs(mergeAutomationDefs(automationFeatures))
```

with the import at the top of the file:

```ts
import { emitAutomationDefs, loadAutomationDefs, mergeAutomationDefs } from './gen-automation'
```

(If `f.manifest.automation` narrows cleanly without the `as` cast because Task 4's interface change is in scope, drop the cast.)

In `tinycld/.gitignore`, next to `/server/pb_migrations/`:

```
/server/automation_defs.json
```

(`biome.json` already excludes `server` — no biome change needed.)

- [ ] **Step 6: Run the generator to prove the pipeline holds with zero automation packages**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate`
Expected: succeeds; `server/automation_defs.json` exists and contains only the `core` package block. Verify:

```bash
cd ~/code/tinycld/tinycld && python3 -c "import json;d=json.load(open('server/automation_defs.json'));print([p['slug'] for p in d['packages']])"
```

Expected output: `['core']`

- [ ] **Step 7: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add scripts/gen-automation.ts scripts/generate.ts scripts/__tests__/gen-automation.test.ts .gitignore
git commit -m "feat(automation): generator materializes merged definitions for the server"
```

---

### Task 6: Client catalogs (`derive-automation.ts`) + dynamic-package whitelist

**Files:**
- Create: `tinycld/core/lib/packages/derive-automation.ts`
- Modify: `tinycld/core/lib/packages/use-packages.ts` (dynamic-entry whitelist, ~line 36–54)
- Test: `tinycld/core/lib/packages/__tests__/derive-automation.test.ts`

**Interfaces:**
- Consumes: `tinycldConfig` entries shaped `{ manifest: { name, slug }, automation?: AutomationDefinitions }`; `CORE_AUTOMATION`/`CORE_PKG_SLUG` from `../automation/core-defs`; `qualifyRef` from `../automation/helpers`.
- Produces: `deriveAutomation(entries): AutomationCatalog` where

  ```ts
  interface AutomationCatalog {
      triggers: Record<string, { pkgSlug: string; pkgName: string; def: TriggerDef }>
      actions: Record<string, { pkgSlug: string; pkgName: string; def: ActionDef }>
      byPackage: { pkgSlug: string; pkgName: string; triggers: TriggerDef[]; actions: ActionDef[] }[]
  }
  ```

  keyed by qualified refs (`'mail:message-received'`), core always present and first in `byPackage`; plus module-level `export const packageAutomation = deriveAutomation(tinycldConfig)` (mirrors `derive-components.ts`). Phase 3's builder UI reads `packageAutomation`.

- [ ] **Step 1: Write the failing test**

```ts
// tinycld/core/lib/packages/__tests__/derive-automation.test.ts
import { describe, expect, it } from 'vitest'
import { deriveAutomation } from '../derive-automation'

const mailEntry = {
    manifest: { name: 'Mail', slug: 'mail' },
    automation: {
        triggers: [
            { id: 'message-received', label: 'A message arrives', collection: 'mail_messages', on: 'create' as const },
        ],
        actions: [],
    },
}
const plainEntry = { manifest: { name: 'Calc', slug: 'calc' } }

describe('deriveAutomation', () => {
    it('always includes the core catalog, first', () => {
        const catalog = deriveAutomation([] as never)
        expect(catalog.byPackage[0].pkgSlug).toBe('core')
        expect(catalog.triggers['core:schedule']).toBeDefined()
        expect(catalog.triggers['core:manual']).toBeDefined()
        expect(catalog.actions['core:apply-label']).toBeDefined()
        expect(catalog.actions['core:notify']).toBeDefined()
    })

    it('keys package declarations by qualified ref and skips packages without automation', () => {
        const catalog = deriveAutomation([mailEntry, plainEntry] as never)
        expect(catalog.triggers['mail:message-received']).toMatchObject({
            pkgSlug: 'mail',
            pkgName: 'Mail',
        })
        expect(catalog.byPackage.map(p => p.pkgSlug)).toEqual(['core', 'mail'])
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/packages/__tests__/derive-automation.test.ts`
Expected: FAIL — cannot resolve `../derive-automation`.

- [ ] **Step 3: Implement derive-automation.ts**

```ts
// tinycld/core/lib/packages/derive-automation.ts
import { tinycldConfig } from '@tinycld/app-generated/tinycld-config'
import { CORE_AUTOMATION, CORE_PKG_SLUG } from '../automation/core-defs'
import { qualifyRef } from '../automation/helpers'
import type { ActionDef, AutomationDefinitions, TriggerDef } from '../automation/types'

export interface CatalogTrigger {
    pkgSlug: string
    pkgName: string
    def: TriggerDef
}
export interface CatalogAction {
    pkgSlug: string
    pkgName: string
    def: ActionDef
}
export interface AutomationPackageGroup {
    pkgSlug: string
    pkgName: string
    triggers: TriggerDef[]
    actions: ActionDef[]
}
export interface AutomationCatalog {
    triggers: Record<string, CatalogTrigger>
    actions: Record<string, CatalogAction>
    byPackage: AutomationPackageGroup[]
}

type AutomationEntryLike = {
    manifest: { name: string; slug: string }
    automation?: AutomationDefinitions
}

/** Ref-keyed trigger/action catalogs; core built-ins always present, first. */
export function deriveAutomation(entries: readonly AutomationEntryLike[]): AutomationCatalog {
    const catalog: AutomationCatalog = { triggers: {}, actions: {}, byPackage: [] }
    const sources: { pkgSlug: string; pkgName: string; defs: AutomationDefinitions }[] = [
        { pkgSlug: CORE_PKG_SLUG, pkgName: 'Core', defs: CORE_AUTOMATION },
    ]
    for (const e of entries) {
        if (!e.automation) continue
        sources.push({ pkgSlug: e.manifest.slug, pkgName: e.manifest.name, defs: e.automation })
    }
    for (const { pkgSlug, pkgName, defs } of sources) {
        const triggers = defs.triggers ?? []
        const actions = defs.actions ?? []
        for (const def of triggers) {
            catalog.triggers[qualifyRef(pkgSlug, def.id)] = { pkgSlug, pkgName, def }
        }
        for (const def of actions) {
            catalog.actions[qualifyRef(pkgSlug, def.id)] = { pkgSlug, pkgName, def }
        }
        catalog.byPackage.push({ pkgSlug, pkgName, triggers, actions })
    }
    return catalog
}

export const packageAutomation: AutomationCatalog = deriveAutomation(tinycldConfig)
```

- [ ] **Step 4: Update the use-packages.ts dynamic-entry whitelist**

This is the spec's called-out gotcha: without this line, DB-installed packages silently lose their automation catalogs. In `use-packages.ts`, inside the `dynamicEntries.push({ ... })` literal (after `server: manifest.server,`):

```ts
                automation: manifest.automation,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/packages/__tests__/derive-automation.test.ts && pnpm exec tinycld-pkg typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add core/lib/packages/derive-automation.ts core/lib/packages/use-packages.ts core/lib/packages/__tests__/derive-automation.test.ts
git commit -m "feat(automation): derived client catalogs and dynamic-package passthrough"
```

---

### Task 7: `rules` + `rule_runs` collections

**Files:**
- Create: `tinycld/core/server/pb_migrations/1990000000_create_rules.js`
- Create: `tinycld/core/server/pb_migrations/1990000001_create_rule_runs.js`
  (amended during execution: the originally planned `1910000000`/`1910000001` collided with shipped migrations)
- Modify: `tinycld/core/lib/pocketbase.ts` (collection registrations after `notifications` ~line 316, `coreStores` ~line 327)

**Interfaces:**
- Consumes: migration conventions from `1790000000_create_notifications.js`; `newCollection` in `pocketbase.ts`.
- Produces: collections `rules` and `rule_runs` exactly as specced (field names below are what Phases 2/3 read: `name`, `scope`, `owner`, `trigger`, `trigger_config`, `conditions`, `actions`, `enabled`, `order`, `stop_processing`; `rule`, `fired_at`, `matched`, `trigger_summary`, `results`, `error`, `duration_ms`); pbtsdb stores `useStore('rules')` / `useStore('rule_runs')`; generated `Rules` / `RuleRuns` interfaces in `pbSchema.ts`.

- [ ] **Step 1: Write the rules migration**

```js
// tinycld/core/server/pb_migrations/1990000000_create_rules.js
/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const rules = new Collection({
            id: 'pbc_rules_01',
            name: 'rules',
            type: 'base',
            system: false,
            // Personal rules: owner only. Org rules: readable by every
            // authenticated user (so people can see why org automation touches
            // their data) but writable only by admins/owners.
            listRule: "owner = @request.auth.id || (scope = 'org' && @request.auth.id != '')",
            viewRule: "owner = @request.auth.id || (scope = 'org' && @request.auth.id != '')",
            createRule:
                "@request.auth.id != '' && owner = @request.auth.id && (scope = 'personal' || @request.auth.role = 'admin' || @request.auth.role = 'owner')",
            updateRule:
                "(scope = 'personal' && owner = @request.auth.id) || (scope = 'org' && (@request.auth.role = 'admin' || @request.auth.role = 'owner'))",
            deleteRule:
                "(scope = 'personal' && owner = @request.auth.id) || (scope = 'org' && (@request.auth.role = 'admin' || @request.auth.role = 'owner'))",
            fields: [
                {
                    id: 'rules_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    max: 200,
                },
                {
                    id: 'rules_scope',
                    name: 'scope',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['personal', 'org'],
                },
                {
                    id: 'rules_owner',
                    name: 'owner',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'rules_trigger',
                    name: 'trigger',
                    type: 'text',
                    required: true,
                    max: 200,
                },
                {
                    id: 'rules_trigger_config',
                    name: 'trigger_config',
                    type: 'json',
                },
                {
                    id: 'rules_conditions',
                    name: 'conditions',
                    type: 'json',
                },
                {
                    id: 'rules_actions',
                    name: 'actions',
                    type: 'json',
                },
                {
                    id: 'rules_enabled',
                    name: 'enabled',
                    type: 'bool',
                },
                {
                    id: 'rules_order',
                    name: 'order',
                    type: 'number',
                },
                {
                    id: 'rules_stop_processing',
                    name: 'stop_processing',
                    type: 'bool',
                },
                {
                    id: 'rules_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'rules_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_rules_owner` ON `rules` (`owner`, `enabled`)',
                'CREATE INDEX `idx_rules_trigger` ON `rules` (`trigger`, `enabled`)',
            ],
        })
        app.save(rules)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('rules')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
```

- [ ] **Step 2: Write the rule_runs migration**

```js
// tinycld/core/server/pb_migrations/1990000001_create_rule_runs.js
/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const runs = new Collection({
            id: 'pbc_rule_runs_01',
            name: 'rule_runs',
            type: 'base',
            system: false,
            // Readable by whoever can read the rule; written only by the
            // engine (superuser DAO) — no client create/update/delete.
            listRule:
                "rule.owner = @request.auth.id || (rule.scope = 'org' && (@request.auth.role = 'admin' || @request.auth.role = 'owner'))",
            viewRule:
                "rule.owner = @request.auth.id || (rule.scope = 'org' && (@request.auth.role = 'admin' || @request.auth.role = 'owner'))",
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'rr_rule',
                    name: 'rule',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_rules_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'rr_fired_at',
                    name: 'fired_at',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'rr_matched',
                    name: 'matched',
                    type: 'bool',
                },
                {
                    id: 'rr_trigger_summary',
                    name: 'trigger_summary',
                    type: 'json',
                },
                {
                    id: 'rr_results',
                    name: 'results',
                    type: 'json',
                },
                {
                    id: 'rr_error',
                    name: 'error',
                    type: 'text',
                    max: 2000,
                },
                {
                    id: 'rr_duration_ms',
                    name: 'duration_ms',
                    type: 'number',
                },
                {
                    id: 'rr_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'rr_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_rule_runs_rule` ON `rule_runs` (`rule`, `fired_at`)',
            ],
        })
        app.save(runs)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('rule_runs')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
```

- [ ] **Step 3: Register the client stores**

In `core/lib/pocketbase.ts`, after the `notifications` registration (~line 317):

```ts
const rules = newCollection('rules', {
    omitOnInsert: ['created', 'updated'],
    expand: { owner: users },
    ...indexing,
})

const rule_runs = newCollection('rule_runs', {
    omitOnInsert: ['created', 'updated'],
    expand: { rule: rules },
    ...indexing,
})
```

and add `rules,` and `rule_runs,` to the `coreStores` object literal.

- [ ] **Step 4: Regenerate the schema types and typecheck**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate`
Expected: succeeds; `core/types/pbSchema.ts` now contains `export interface Rules` (with `scope: 'personal' | 'org'`) and `export interface RuleRuns`. Verify:

```bash
grep -c "export interface Rules\b\|export interface RuleRuns\b" ~/code/tinycld/tinycld/core/types/pbSchema.ts
```

Expected output: `2`

Then: `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg typecheck`
Expected: clean.

- [ ] **Step 5: Run the full member check**

Run: `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg check`
Expected: biome + tsc + vitest all pass. Fix any failure at its source.

- [ ] **Step 6: Commit (tinycld repo)**

```bash
cd ~/code/tinycld/tinycld
git add core/server/pb_migrations/1990000000_create_rules.js core/server/pb_migrations/1990000001_create_rule_runs.js core/lib/pocketbase.ts
git commit -m "feat(automation): rules and rule_runs collections"
```

---

### Task 8: Mail declares a real trigger (proof of pipeline)

**Files:**
- Create: `mail/tinycld/mail/automation.ts`
- Modify: `mail/package.json` (`exports` map, next to `"./seed"`)
- Modify: `mail/manifest.ts` (after `search`, ~line 25)

**Interfaces:**
- Consumes: `AutomationDefinitions` from `@tinycld/core/lib/automation/types`; `MailSchema` from `~/tinycld/mail/types`.
- Produces: `mail:message-received` in the generated catalogs and `server/automation_defs.json`. Real `mail_messages` columns only (`sender_email`, `sender_name`, `subject`, `has_attachments`, `alias` — there is **no** `folder` or user-FK column on this collection).

- [ ] **Step 1: Write the definitions module**

```ts
// mail/tinycld/mail/automation.ts
import type { AutomationDefinitions } from '@tinycld/core/lib/automation/types'
// Relative, NOT the ~/ self-alias: this module is config-reachable (imported by
// the generated tinycld.config.ts under the app shell's tsconfig, where mail's
// self-alias doesn't resolve) — same reason collections.ts imports './types'.
import type { MailSchema } from './types'

// NOTE: mail_messages has no user FK (mailboxes are shared) — personal-rule
// owner resolution for this trigger is defined in the engine phase. No
// ownerField is declared here on purpose.
const automation = {
    triggers: [
        {
            id: 'message-received',
            label: 'A message arrives',
            collection: 'mail_messages',
            on: 'create',
            fields: [
                'subject',
                { key: 'sender_email', label: 'Sender' },
                { key: 'sender_name', label: 'Sender name' },
                'has_attachments',
                { key: 'alias', label: 'Received via alias' },
            ],
        },
    ],
} satisfies AutomationDefinitions<MailSchema>

export default automation
```

- [ ] **Step 2: Expose it in the exports map and manifest**

In `mail/package.json` `exports`, next to `"./seed"`:

```json
        "./automation": "./tinycld/mail/automation.ts",
```

In `mail/manifest.ts`, after the `search` line:

```ts
    automation: { definitions: 'automation' },
```

- [ ] **Step 3: Run the generator and verify end-to-end**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate`
Expected: succeeds. Then verify all three outputs:

```bash
cd ~/code/tinycld/tinycld
python3 -c "import json;d=json.load(open('server/automation_defs.json'));m=[p for p in d['packages'] if p['slug']=='mail'][0];print(m['triggers'][0]['id'])"
grep -n "mailAutomation" tinycld.config.ts
```

Expected: `message-received` printed, and `tinycld.config.ts` contains both `import mailAutomation from '@tinycld/mail/automation'` and `automation: mailAutomation,`.

- [ ] **Step 4: Typecheck both members**

Run: `cd ~/code/tinycld/mail && pnpm exec tinycld-pkg typecheck && cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg typecheck`
Expected: both clean. (A typo'd column name in `automation.ts` must fail mail's typecheck — that's the schema-typing guarantee working. Optionally verify by temporarily misspelling `subject` and watching it fail, then restore.)

- [ ] **Step 5: Sanity-check the catalog derivation picks mail up**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/lib/packages/__tests__/derive-automation.test.ts`
Expected: PASS (the unit test covers the mail-shaped entry; the generated config now carries the real one).

- [ ] **Step 6: Commit (mail repo)**

```bash
cd ~/code/tinycld/mail
git add tinycld/mail/automation.ts package.json manifest.ts
git commit -m "feat: declare the message-received automation trigger"
```

---

## Phase 1 exit criteria

- `pnpm exec tinycld-pkg check` passes in `tinycld/`; `pnpm exec tinycld-pkg typecheck` passes in `mail/`.
- `server/automation_defs.json` contains `core` (schedule/manual/apply-label/notify) and `mail` (message-received).
- `packageAutomation.triggers['mail:message-received']` and `['core:schedule']` resolve in the app.
- `useStore('rules')` / `useStore('rule_runs')` typecheck with the generated `Rules`/`RuleRuns` types.
- The lean shell still works: with mail absent, generation succeeds and the catalogs contain only core.

**Next:** Plan 2 (engine) covers the Go automation package (matcher, evaluator, executor, cron, manual/dry-run endpoints, `rule_runs` writes, pruning, auto-disable), field resolution via collection metadata, `automation.RegisterAction` + mail/core native handlers, and the mail owner-resolution question flagged above. Plan 3 (UI) covers RulesPanel/RuleBuilder/RunHistory, the three mount points, help topics, and e2e.
