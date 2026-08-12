# Workflow Rules Phase 2: Go Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side rules engine in core Go: it reads the Phase-1 `server/automation_defs.json`, listens on record hooks / cron / a manual endpoint, evaluates rule conditions, executes record-op and native actions with the spec's security model, and logs every run to `rule_runs`.

**Architecture:** New package `core/server/automation/` (module path `tinycld.org/core/automation`), registered from `registerSharedCore` so both host and tenant compositions get it with no parity-test entry. Event intake fans into an in-process worker (channel + goroutine, `OnTerminate`-cancelled); all engine writes are superuser `app.Save` with explicit `pkgaccess` checks for personal rules; re-entrancy is bounded by a provenance sentinel (`sync.Map`), the same shape as mail's `recentlyIndexed`. Spec: `docs/superpowers/specs/2026-08-11-workflow-rules-design.md`; Phase-1 handoff notes: end of `2026-08-11-workflow-rules-1-declaration-pipeline.md`.

**Tech Stack:** Go (PocketBase fork v0.39.8 via `replace` → `third_party/pocketbase`), `pocketbase/tests` + `core/server/rlstest` for tests, existing `notify`/`pkgaccess` packages.

## Global Constraints

- Branches: continue on `feat/workflow-rules` in both repos (tinycld PR #180, mail PR #59 are open). Tasks 1–9 commit in the **tinycld repo**, task 10 in the **mail repo**. Never mention Claude in commit messages.
- Go style: `gofmt` clean; table-driven tests; doc comments explain "why". Test invocation: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v` (full: `go test ./...`). Mail: `cd /Users/nas/code/tinycld/mail/server && go test ./...`.
- Import the PB fork as the stock paths (`github.com/pocketbase/pocketbase/...`) — the `replace` directive does the swap. Never import a feature package from core.
- **Engine writes bypass PB API rules and pkgaccess** (model-level `app.Save` is superuser; pkgaccess guards REST request hooks only). Personal-rule record-ops MUST call `pkgaccess.WriteError(app, ownerRecord, slug)` first; org rules execute with system authority (admin-authored, documented in the spec).
- **`json` columns read via `Record.Get` return `types.JSONRaw`** — always `json.Marshal` the value then `json.Unmarshal` into the target struct (see `mail/server/notify_batcher.go:113` for why). Applies to `rules.conditions`, `rules.actions`, `rules.trigger_config`, and writes of `rule_runs.trigger_summary`/`results`.
- Background goroutines: guard with `appIsLive`-style checks (`app != nil && app.ConcurrentDB() != nil`) and cancel via `context.WithCancel` + `app.OnTerminate()` (pattern: `mail/server/register.go:267`).
- Semantic decisions locked by spec/Phase 1: operator set = Phase 1's `OPERATORS_BY_TYPE` (deduped `ALL_OPS`); AND/OR one-level AST; chain-depth cap 3; auto-disable after 20 consecutive fully-failed runs + `notify.NotifyUser`; prune `rule_runs` to 200 per rule; org rules run before personal, both by `order`; `stop_processing` on org stops everything downstream, on personal stops later personal rules only.
- Decisions made for this plan (surface objections at review, not mid-task): text operators compare **case-insensitively** (Gmail-filter semantics); unknown `{{placeholder}}` substitutes to empty string; the manual-run endpoint accepts only rules with a synthetic trigger (`core:manual` / `core:schedule`) and works regardless of `enabled` (it is the explicit test path); personal rules on triggers with **no resolvable owner** simply never fire (org rules still do) unless a package registers an owner resolver.
- If any check fails, diagnose and fix at the source — never skip, re-run blindly, or work around. If a brief-internal conflict emerges, STOP and report NEEDS_CONTEXT.

## File Structure (all under `tinycld/core/server/automation/` unless noted)

| File | Responsibility |
|---|---|
| `defs.go` | JSON wire types mirroring `automation_defs.json`; `LoadDefs(path)`; ref-keyed lookup |
| `eval.go` | Condition-AST evaluation + `watch` change detection (pure functions over records) |
| `template.go` | `{{field}}` substitution |
| `registry.go` | `RegisterAction`, `RegisterOwnerResolver`, owner auto-detection |
| `actions.go` | Record-op executor (`SetValue` resolution, pkgaccess check, provenance marking) |
| `engine.go` | Hook binding, rule matching/ordering, worker, chain-depth, run orchestration |
| `runs.go` | `rule_runs` writes, pruning, consecutive-failure auto-disable |
| `schedule.go` | Cron reconcile for `core:schedule` rules |
| `endpoints.go` | `POST /api/automation/rules/{id}/run`, `POST /api/automation/dry-run` |
| `coreserver/server.go` (modify) | Wire `automation.Register` into `registerSharedCore`; export defs path |
| `mail/server/automation.go` (mail repo) | Owner resolver for `mail:message-received` |

---

### Task 1: Defs wire types + loader (`defs.go`)

**Files:**
- Create: `tinycld/core/server/automation/defs.go`
- Test: `tinycld/core/server/automation/defs_test.go`

**Interfaces:**
- Consumes: the JSON emitted by `scripts/gen-automation.ts` (shape: `{ "packages": [{ "slug", "triggers": [...], "actions": [...] }] }`; trigger fields entries are `string | {key,label}`; record-op `set` values are `{param} | {context} | literal`).
- Produces (later tasks use these exact names): types `Defs`, `PackageDefs`, `TriggerDef`, `ActionDef`, `RecordOp`, `ParamDef`, `FieldRef`, `SetValue`; methods `LoadDefs(path string) (*Defs, error)` (missing file → `(&Defs{}, nil)`, the `tenantcfg.loadJSON` convention), `(*Defs) Trigger(ref string) (TriggerDef, string, bool)` (def, pkg slug, ok), `(*Defs) Action(ref string) (ActionDef, string, bool)`, `(*Defs) TriggersFor(collection, op string) []QualifiedTrigger` where `QualifiedTrigger = { Ref string; Pkg string; Def TriggerDef }`.

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/defs_test.go
package automation

import (
	"os"
	"path/filepath"
	"testing"
)

const fixtureJSON = `{
    "packages": [
        {
            "slug": "core",
            "triggers": [
                { "id": "schedule", "label": "On a schedule", "synthetic": "schedule" },
                { "id": "manual", "label": "Run manually", "synthetic": "manual" }
            ],
            "actions": [
                {
                    "id": "apply-label", "label": "Apply label", "kind": "record-op",
                    "collection": "label_assignments",
                    "op": { "type": "create", "set": {
                        "label": { "param": "label" },
                        "record_id": { "context": "record-id" },
                        "collection": { "context": "collection" },
                        "user": { "context": "owner" }
                    } },
                    "params": [{ "key": "label", "field": "label" }]
                },
                { "id": "notify", "label": "Send me a notification", "kind": "native",
                  "params": [{ "key": "title", "type": "text" }, { "key": "body", "type": "text" }] }
            ]
        },
        {
            "slug": "mail",
            "triggers": [
                { "id": "message-received", "label": "A message arrives",
                  "collection": "mail_messages", "on": "create",
                  "fields": ["subject", { "key": "sender_email", "label": "Sender" }] }
            ],
            "actions": []
        }
    ]
}`

func writeFixture(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "automation_defs.json")
	if err := os.WriteFile(p, []byte(fixtureJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadDefsMissingFileIsInert(t *testing.T) {
	defs, err := LoadDefs(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatalf("missing file must be inert, got %v", err)
	}
	if len(defs.Packages) != 0 {
		t.Fatalf("expected empty defs, got %d packages", len(defs.Packages))
	}
}

func TestLookupByQualifiedRef(t *testing.T) {
	defs, err := LoadDefs(writeFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	trig, pkg, ok := defs.Trigger("mail:message-received")
	if !ok || pkg != "mail" || trig.Collection != "mail_messages" || trig.On != "create" {
		t.Fatalf("trigger lookup failed: %+v %q %v", trig, pkg, ok)
	}
	if trig.Fields[1].Key != "sender_email" || trig.Fields[1].Label != "Sender" {
		t.Fatalf("mixed-form fields not decoded: %+v", trig.Fields)
	}
	act, pkg, ok := defs.Action("core:apply-label")
	if !ok || pkg != "core" || act.Kind != "record-op" || act.Op.Type != "create" {
		t.Fatalf("action lookup failed: %+v", act)
	}
	sv := act.Op.Set["record_id"]
	if sv.Context != "record-id" {
		t.Fatalf("context SetValue not decoded: %+v", sv)
	}
	if _, _, ok := defs.Trigger("mail:nope"); ok {
		t.Fatal("unknown ref must miss")
	}
}

func TestTriggersForCollectionOp(t *testing.T) {
	defs, _ := LoadDefs(writeFixture(t))
	hits := defs.TriggersFor("mail_messages", "create")
	if len(hits) != 1 || hits[0].Ref != "mail:message-received" {
		t.Fatalf("TriggersFor: %+v", hits)
	}
	if len(defs.TriggersFor("mail_messages", "delete")) != 0 {
		t.Fatal("op filter failed")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: FAIL to build — package doesn't exist yet.

- [ ] **Step 3: Implement defs.go**

```go
// tinycld/core/server/automation/defs.go
//
// Wire types for server/automation_defs.json, the generator's materialization
// of every package's automation.ts (plus core's built-ins). JSON-tagged
// mirrors, same rationale as tenantcfg's DAV mirrors: the TS side owns the
// authoring format, Go consumes a stable wire shape.
package automation

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// FieldRef decodes both wire forms: "subject" and {"key":..., "label":...}.
type FieldRef struct {
	Key   string
	Label string
}

func (f *FieldRef) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		return json.Unmarshal(b, &f.Key)
	}
	var obj struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	f.Key, f.Label = obj.Key, obj.Label
	return nil
}

// SetValue decodes {param}, {context}, or a bare literal.
type SetValue struct {
	Param   string
	Context string
	Literal any
}

func (s *SetValue) UnmarshalJSON(b []byte) error {
	var obj map[string]any
	if err := json.Unmarshal(b, &obj); err == nil {
		if p, ok := obj["param"].(string); ok {
			s.Param = p
			return nil
		}
		if c, ok := obj["context"].(string); ok {
			s.Context = c
			return nil
		}
	}
	return json.Unmarshal(b, &s.Literal)
}

type TriggerDef struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Collection string     `json:"collection"`
	On         string     `json:"on"`
	Watch      []string   `json:"watch"`
	Fields     []FieldRef `json:"fields"`
	OwnerField string     `json:"ownerField"`
	Synthetic  string     `json:"synthetic"`
}

type RecordOp struct {
	Type   string              `json:"type"`
	Target string              `json:"target"`
	Set    map[string]SetValue `json:"set"`
}

type ParamDef struct {
	Key     string   `json:"key"`
	Field   string   `json:"field"`
	Type    string   `json:"type"`
	Label   string   `json:"label"`
	Options []string `json:"options"`
}

type ActionDef struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Kind       string     `json:"kind"`
	Collection string     `json:"collection"`
	Op         RecordOp   `json:"op"`
	Params     []ParamDef `json:"params"`
}

type PackageDefs struct {
	Slug     string       `json:"slug"`
	Triggers []TriggerDef `json:"triggers"`
	Actions  []ActionDef  `json:"actions"`
}

type Defs struct {
	Packages []PackageDefs `json:"packages"`
}

type QualifiedTrigger struct {
	Ref string
	Pkg string
	Def TriggerDef
}

// LoadDefs reads the materialized defs. A missing file is an inert engine,
// not an error — matches tenantcfg.loadJSON: a workspace with no automation
// packages simply has nothing to do.
func LoadDefs(path string) (*Defs, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Defs{}, nil
		}
		return nil, fmt.Errorf("automation: read defs: %w", err)
	}
	var defs Defs
	if err := json.Unmarshal(raw, &defs); err != nil {
		return nil, fmt.Errorf("automation: parse defs %s: %w", path, err)
	}
	return &defs, nil
}

func splitRef(ref string) (pkg, id string, ok bool) {
	i := strings.IndexByte(ref, ':')
	if i <= 0 || i == len(ref)-1 {
		return "", "", false
	}
	return ref[:i], ref[i+1:], true
}

func (d *Defs) Trigger(ref string) (TriggerDef, string, bool) {
	pkg, id, ok := splitRef(ref)
	if !ok {
		return TriggerDef{}, "", false
	}
	for _, p := range d.Packages {
		if p.Slug != pkg {
			continue
		}
		for _, t := range p.Triggers {
			if t.ID == id {
				return t, p.Slug, true
			}
		}
	}
	return TriggerDef{}, "", false
}

func (d *Defs) Action(ref string) (ActionDef, string, bool) {
	pkg, id, ok := splitRef(ref)
	if !ok {
		return ActionDef{}, "", false
	}
	for _, p := range d.Packages {
		if p.Slug != pkg {
			continue
		}
		for _, a := range p.Actions {
			if a.ID == id {
				return a, p.Slug, true
			}
		}
	}
	return ActionDef{}, "", false
}

func (d *Defs) TriggersFor(collection, op string) []QualifiedTrigger {
	var out []QualifiedTrigger
	for _, p := range d.Packages {
		for _, t := range p.Triggers {
			if t.Synthetic == "" && t.Collection == collection && t.On == op {
				out = append(out, QualifiedTrigger{Ref: p.Slug + ":" + t.ID, Pkg: p.Slug, Def: t})
			}
		}
	}
	return out
}
```

Create the package with `go.mod` untouched — it's a subpackage of the existing `tinycld.org/core` module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS (3 tests). Also run `gofmt -l automation/` — must print nothing.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/defs.go core/server/automation/defs_test.go
git commit -m "feat(automation): engine wire types and defs loader"
```

---

### Task 2: Condition evaluator + watch detection (`eval.go`)

**Files:**
- Create: `tinycld/core/server/automation/eval.go`
- Test: `tinycld/core/server/automation/eval_test.go`

**Interfaces:**
- Consumes: `*core.Record` (PB fork); the stored `rules.conditions` AST (`{match, groups:[{match, conditions:[{field,op,value}]}]}`).
- Produces: `type ConditionsAST struct { Match string; Groups []ConditionGroup }`, `ConditionGroup { Match string; Conditions []Condition }`, `Condition { Field, Op string; Value any }` (all JSON-tagged lowercase); `EvaluateConditions(ast ConditionsAST, record *core.Record) bool` (empty groups → true); `WatchChanged(record *core.Record, watch []string) bool` (compares `record.Original()`; empty watch → true); `DecodeConditions(raw any) (ConditionsAST, error)` (handles the `types.JSONRaw` marshal/unmarshal dance).
- Operator semantics (op implies the coercion — no schema needed at eval time): `contains`/`not_contains`/`equals`/`starts_with` case-insensitive over `normalize(value)`; `eq`/`neq`/`gt`/`lt` via `toFloat` (records: `GetFloat`); `is_true`/`is_false` via `GetBool`; `before`/`after` compare `GetDateTime(field).Time()` against the condition value parsed as a PB datetime string; `within_last_days` = field time after `now - N*24h`; `is`/`is_not` string equality, with multi-value fields (`[]string`) matching if ANY element equals; `is_empty` = zero/empty value. Unknown op → condition false (never error).
- `normalize` mirrors `audit.fieldToString`: `string` as-is; `[]string` joined by `","`; else `fmt.Sprintf("%v")`.

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/eval_test.go
package automation

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func evalRecord(t *testing.T) (*tests.TestApp, *core.Record) {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Cleanup() })

	col := core.NewBaseCollection("eval_things")
	col.Fields.Add(&core.TextField{Name: "subject"})
	col.Fields.Add(&core.TextField{Name: "sender"})
	col.Fields.Add(&core.BoolField{Name: "flagged"})
	col.Fields.Add(&core.NumberField{Name: "size"})
	col.Fields.Add(&core.DateField{Name: "happened"})
	col.Fields.Add(&core.SelectField{Name: "tags", Values: []string{"a", "b", "c"}, MaxSelect: 3})
	if err := app.Save(col); err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("subject", "Invoice #42 attached")
	r.Set("sender", "billing@ACME.com")
	r.Set("flagged", true)
	r.Set("size", 1500)
	r.Set("happened", time.Now().Add(-48*time.Hour).UTC().Format("2006-01-02 15:04:05.000Z"))
	r.Set("tags", []string{"a", "c"})
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return app, r
}

func cond(field, op string, value any) Condition {
	return Condition{Field: field, Op: op, Value: value}
}

func one(c Condition) ConditionsAST {
	return ConditionsAST{Match: "all", Groups: []ConditionGroup{{Match: "all", Conditions: []Condition{c}}}}
}

func TestOperatorTable(t *testing.T) {
	_, r := evalRecord(t)
	cases := []struct {
		name string
		c    Condition
		want bool
	}{
		{"contains ci", cond("subject", "contains", "invoice"), true},
		{"contains miss", cond("subject", "contains", "receipt"), false},
		{"not_contains", cond("subject", "not_contains", "receipt"), true},
		{"equals ci", cond("sender", "equals", "Billing@acme.com"), true},
		{"starts_with", cond("subject", "starts_with", "invoice #"), true},
		{"eq", cond("size", "eq", 1500), true},
		{"neq", cond("size", "neq", 1500), false},
		{"gt", cond("size", "gt", 1000), true},
		{"lt", cond("size", "lt", 1000), false},
		{"is_true", cond("flagged", "is_true", nil), true},
		{"is_false", cond("flagged", "is_false", nil), false},
		{"within_last_days hit", cond("happened", "within_last_days", 7), true},
		{"within_last_days miss", cond("happened", "within_last_days", 1), false},
		{"is multi-match", cond("tags", "is", "c"), true},
		{"is multi-miss", cond("tags", "is", "b"), false},
		{"is_not", cond("tags", "is_not", "b"), true},
		{"is_empty miss", cond("subject", "is_empty", nil), false},
		{"unknown op", cond("subject", "regex", ".*"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := EvaluateConditions(one(tc.c), r); got != tc.want {
				t.Fatalf("%s: got %v want %v", tc.name, got, tc.want)
			}
		})
	}
}

func TestGroupSemantics(t *testing.T) {
	_, r := evalRecord(t)
	hit := cond("subject", "contains", "invoice")
	miss := cond("subject", "contains", "receipt")

	anyGroup := ConditionGroup{Match: "any", Conditions: []Condition{miss, hit}}
	allGroup := ConditionGroup{Match: "all", Conditions: []Condition{hit, miss}}

	if !EvaluateConditions(ConditionsAST{Match: "all", Groups: []ConditionGroup{anyGroup}}, r) {
		t.Fatal("any-group with one hit must pass")
	}
	if EvaluateConditions(ConditionsAST{Match: "all", Groups: []ConditionGroup{anyGroup, allGroup}}, r) {
		t.Fatal("all-of-groups with a failing group must fail")
	}
	if !EvaluateConditions(ConditionsAST{Match: "any", Groups: []ConditionGroup{anyGroup, allGroup}}, r) {
		t.Fatal("any-of-groups with a passing group must pass")
	}
	if !EvaluateConditions(ConditionsAST{}, r) {
		t.Fatal("empty AST must pass (no conditions = always match)")
	}
}

func TestWatchChanged(t *testing.T) {
	app, r := evalRecord(t)
	r.Set("subject", "Changed subject")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	// After Save, Original() reflects pre-save state only inside hooks; emulate
	// by building the comparison directly: load fresh, mutate in memory.
	fresh, err := app.FindRecordById("eval_things", r.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("sender", "other@acme.com")
	if !WatchChanged(fresh, []string{"sender"}) {
		t.Fatal("watched field changed → true")
	}
	if WatchChanged(fresh, []string{"subject"}) {
		t.Fatal("unwatched-change only → false")
	}
	if !WatchChanged(fresh, nil) {
		t.Fatal("empty watch → always true")
	}
}

func TestDecodeConditions(t *testing.T) {
	ast, err := DecodeConditions(map[string]any{
		"match": "all",
		"groups": []any{map[string]any{
			"match":      "any",
			"conditions": []any{map[string]any{"field": "subject", "op": "contains", "value": "x"}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if ast.Groups[0].Conditions[0].Field != "subject" {
		t.Fatalf("decode failed: %+v", ast)
	}
	empty, err := DecodeConditions(nil)
	if err != nil || len(empty.Groups) != 0 {
		t.Fatalf("nil decodes to empty AST: %+v %v", empty, err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestOperator|TestGroup|TestWatch|TestDecode' -v`
Expected: FAIL — symbols undefined.

- [ ] **Step 3: Implement eval.go**

```go
// tinycld/core/server/automation/eval.go
package automation

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

type Condition struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

type ConditionGroup struct {
	Match      string      `json:"match"`
	Conditions []Condition `json:"conditions"`
}

type ConditionsAST struct {
	Match  string           `json:"match"`
	Groups []ConditionGroup `json:"groups"`
}

// DecodeConditions round-trips through JSON because Record.Get on a json
// column yields types.JSONRaw (see notify_batcher.go's hard-won comment) and
// the client stores plain objects — one path handles both.
func DecodeConditions(raw any) (ConditionsAST, error) {
	var ast ConditionsAST
	if raw == nil {
		return ast, nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return ast, err
	}
	if len(b) == 0 || string(b) == "null" || string(b) == `""` {
		return ast, nil
	}
	return ast, json.Unmarshal(b, &ast)
}

// normalize mirrors audit.fieldToString: one canonical string per value.
func normalize(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []string:
		return strings.Join(t, ",")
	default:
		return fmt.Sprintf("%v", t)
	}
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		var f float64
		_, err := fmt.Sscanf(t, "%g", &f)
		return f, err == nil
	default:
		return 0, false
	}
}

func stringValues(record *core.Record, field string) []string {
	if vs := record.GetStringSlice(field); len(vs) > 0 {
		return vs
	}
	if s := record.GetString(field); s != "" {
		return []string{s}
	}
	return nil
}

func evalCondition(c Condition, record *core.Record) bool {
	switch c.Op {
	case "contains", "not_contains", "equals", "starts_with":
		field := strings.ToLower(normalize(record.Get(c.Field)))
		want := strings.ToLower(normalize(c.Value))
		var hit bool
		switch c.Op {
		case "contains":
			hit = strings.Contains(field, want)
		case "not_contains":
			return !strings.Contains(field, want)
		case "equals":
			hit = field == want
		case "starts_with":
			hit = strings.HasPrefix(field, want)
		}
		return hit
	case "eq", "neq", "gt", "lt":
		have := record.GetFloat(c.Field)
		want, ok := toFloat(c.Value)
		if !ok {
			return false
		}
		switch c.Op {
		case "eq":
			return have == want
		case "neq":
			return have != want
		case "gt":
			return have > want
		case "lt":
			return have < want
		}
	case "is_true":
		return record.GetBool(c.Field)
	case "is_false":
		return !record.GetBool(c.Field)
	case "before", "after", "within_last_days":
		have := record.GetDateTime(c.Field).Time()
		if have.IsZero() {
			return false
		}
		if c.Op == "within_last_days" {
			days, ok := toFloat(c.Value)
			if !ok {
				return false
			}
			return have.After(time.Now().Add(-time.Duration(days*24) * time.Hour))
		}
		want, err := time.Parse("2006-01-02 15:04:05.000Z", normalize(c.Value))
		if err != nil {
			// Date-only form from the builder ("2026-08-11")
			want, err = time.Parse("2006-01-02", normalize(c.Value))
			if err != nil {
				return false
			}
		}
		if c.Op == "before" {
			return have.Before(want)
		}
		return have.After(want)
	case "is", "is_not":
		want := normalize(c.Value)
		hit := false
		for _, v := range stringValues(record, c.Field) {
			if v == want {
				hit = true
				break
			}
		}
		if c.Op == "is" {
			return hit
		}
		return !hit
	case "is_empty":
		return len(stringValues(record, c.Field)) == 0 && normalize(record.Get(c.Field)) == ""
	}
	// Unknown operator: a rule authored against a newer core than this one.
	// Fail closed (no match) rather than erroring the whole dispatch.
	return false
}

func evalGroup(g ConditionGroup, record *core.Record) bool {
	if len(g.Conditions) == 0 {
		return true
	}
	for _, c := range g.Conditions {
		hit := evalCondition(c, record)
		if g.Match == "any" && hit {
			return true
		}
		if g.Match != "any" && !hit {
			return false
		}
	}
	return g.Match != "any"
}

// EvaluateConditions applies the one-level AND/OR AST. No conditions = match.
func EvaluateConditions(ast ConditionsAST, record *core.Record) bool {
	if len(ast.Groups) == 0 {
		return true
	}
	for _, g := range ast.Groups {
		hit := evalGroup(g, record)
		if ast.Match == "any" && hit {
			return true
		}
		if ast.Match != "any" && !hit {
			return false
		}
	}
	return ast.Match != "any"
}

// WatchChanged reports whether any watched field differs from the record's
// original values. Empty watch = fire on every update.
func WatchChanged(record *core.Record, watch []string) bool {
	if len(watch) == 0 {
		return true
	}
	original := record.Original()
	for _, f := range watch {
		if normalize(record.Get(f)) != normalize(original.Get(f)) {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS. `gofmt -l automation/` prints nothing.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/eval.go core/server/automation/eval_test.go
git commit -m "feat(automation): condition evaluator and watch detection"
```

---

### Task 3: Template substitution (`template.go`)

**Files:**
- Create: `tinycld/core/server/automation/template.go`
- Test: `tinycld/core/server/automation/template_test.go`

**Interfaces:**
- Produces: `SubstituteTemplates(s string, record *core.Record, trigger TriggerDef) string`. Placeholders are `{{field}}` (optional surrounding whitespace inside braces). Only fields **exposed by the trigger** substitute: if `trigger.Fields` is non-empty, its keys are the allowlist; if empty, every non-system field of the record's collection plus `created`/`updated`. Unknown or non-exposed placeholders substitute to the empty string (locked decision). Values render via `normalize`. A nil record (synthetic trigger) returns the input unchanged.

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/template_test.go
package automation

import "testing"

func TestSubstituteTemplates(t *testing.T) {
	_, r := evalRecord(t)
	trig := TriggerDef{Fields: []FieldRef{{Key: "subject"}, {Key: "sender"}}}

	cases := []struct{ in, want string }{
		{"Re: {{subject}}", "Re: Invoice #42 attached"},
		{"{{ subject }} from {{sender}}", "Invoice #42 attached from billing@ACME.com"},
		{"{{size}}", ""},          // not exposed by the trigger's allowlist
		{"{{nonexistent}}", ""},   // unknown field
		{"no placeholders", "no placeholders"},
		{"{{subject", "{{subject"}, // unterminated stays verbatim
	}
	for _, tc := range cases {
		if got := SubstituteTemplates(tc.in, r, trig); got != tc.want {
			t.Fatalf("%q: got %q want %q", tc.in, got, tc.want)
		}
	}

	// Empty Fields = all non-system columns exposed.
	open := TriggerDef{}
	if got := SubstituteTemplates("{{size}}", r, open); got != "1500" {
		t.Fatalf("open trigger exposes all columns, got %q", got)
	}
	if got := SubstituteTemplates("{{subject}}", nil, trig); got != "{{subject}}" {
		t.Fatalf("nil record leaves input unchanged, got %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run TestSubstitute -v`
Expected: FAIL — `SubstituteTemplates` undefined.

- [ ] **Step 3: Implement template.go**

```go
// tinycld/core/server/automation/template.go
package automation

import (
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

var placeholderRe = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_]+)\s*\}\}`)

// exposedFields returns the set of field keys rule templates/conditions may
// see for this trigger: the declared allowlist, or (when the declaration
// omitted fields) every non-system column plus created/updated — mirroring
// the Phase 1 contract ("fields omitted = expose every schema column").
func exposedFields(record *core.Record, trigger TriggerDef) map[string]bool {
	out := map[string]bool{}
	if len(trigger.Fields) > 0 {
		for _, f := range trigger.Fields {
			out[f.Key] = true
		}
		return out
	}
	for _, field := range record.Collection().Fields {
		name := field.GetName()
		if name == "id" || strings.HasPrefix(name, "_") {
			continue
		}
		out[name] = true
	}
	return out
}

// SubstituteTemplates fills {{field}} placeholders from the trigger record.
// Non-exposed and unknown fields become empty strings: a template must never
// leak a column the trigger's declaration curated away.
func SubstituteTemplates(s string, record *core.Record, trigger TriggerDef) string {
	if record == nil || !strings.Contains(s, "{{") {
		return s
	}
	exposed := exposedFields(record, trigger)
	return placeholderRe.ReplaceAllStringFunc(s, func(m string) string {
		key := placeholderRe.FindStringSubmatch(m)[1]
		if !exposed[key] {
			return ""
		}
		return normalize(record.Get(key))
	})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS. `gofmt -l automation/` prints nothing.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/template.go core/server/automation/template_test.go
git commit -m "feat(automation): trigger-scoped template substitution"
```

---

### Task 4: Registries + owner resolution (`registry.go`)

**Files:**
- Create: `tinycld/core/server/automation/registry.go`
- Test: `tinycld/core/server/automation/registry_test.go`

**Interfaces:**
- Produces:
  - `type ActionHandler func(app core.App, req ActionRequest) error` with `ActionRequest { Rule *core.Record; OwnerID string; Params map[string]string; Record *core.Record }` (Params are post-template-substitution strings; Record nil for synthetic triggers).
  - `RegisterAction(ref string, h ActionHandler)` / `actionHandler(ref) (ActionHandler, bool)` — package-level registry guarded by a mutex; re-registering a ref replaces (needed for tests).
  - `type OwnerResolver func(app core.App, record *core.Record) []string` (user ids the event "belongs to"; empty = no personal scope).
  - `RegisterOwnerResolver(triggerRef string, r OwnerResolver)` / `ResolveOwners(app core.App, triggerRef string, trigger TriggerDef, record *core.Record) []string`.
  - Auto-detection inside `ResolveOwners` when no resolver is registered: use `trigger.OwnerField` if set; otherwise the first of `user`, `owner`, `author` that exists on the record's collection as a `*core.RelationField` targeting the `users` collection (`_pb_users_auth_`). Returns the record's value(s) for that field. Nil record → nil.
  - `ResetRegistriesForTest()` — clears both maps (test hygiene, same spirit as `previewqueue.ResetForTest`).
- Consumed by: Task 5 (native dispatch), Task 6 (personal-rule scoping), Task 10 (mail resolver).

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/registry_test.go
package automation

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestActionRegistry(t *testing.T) {
	t.Cleanup(ResetRegistriesForTest)
	called := false
	RegisterAction("mail:send-message", func(app core.App, req ActionRequest) error {
		called = true
		return nil
	})
	h, ok := actionHandler("mail:send-message")
	if !ok {
		t.Fatal("registered handler must resolve")
	}
	if err := h(nil, ActionRequest{}); err != nil || !called {
		t.Fatal("handler must be invocable")
	}
	if _, ok := actionHandler("mail:unregistered"); ok {
		t.Fatal("unknown ref must miss")
	}
}

func TestOwnerAutoDetect(t *testing.T) {
	t.Cleanup(ResetRegistriesForTest)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Cleanup() })
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	col := core.NewBaseCollection("owned_things")
	col.Fields.Add(&core.TextField{Name: "title"})
	col.Fields.Add(&core.RelationField{Name: "owner", CollectionId: users.Id, MaxSelect: 1})
	if err := app.Save(col); err != nil {
		t.Fatal(err)
	}

	u, err := app.FindFirstRecordByFilter("users", "id != ''")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("title", "x")
	r.Set("owner", u.Id)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}

	owners := ResolveOwners(app, "pkg:thing-created", TriggerDef{Collection: "owned_things", On: "create"}, r)
	if len(owners) != 1 || owners[0] != u.Id {
		t.Fatalf("auto-detect via 'owner' relation: %v", owners)
	}

	// No user-relation field → no personal scope.
	bare := core.NewBaseCollection("bare_things")
	bare.Fields.Add(&core.TextField{Name: "title"})
	if err := app.Save(bare); err != nil {
		t.Fatal(err)
	}
	br := core.NewRecord(bare)
	br.Set("title", "y")
	if err := app.Save(br); err != nil {
		t.Fatal(err)
	}
	if owners := ResolveOwners(app, "pkg:bare", TriggerDef{Collection: "bare_things"}, br); len(owners) != 0 {
		t.Fatalf("unresolvable owner must be empty, got %v", owners)
	}

	// A registered resolver wins over auto-detection.
	RegisterOwnerResolver("pkg:bare", func(app core.App, record *core.Record) []string {
		return []string{"custom-user-id"}
	})
	if owners := ResolveOwners(app, "pkg:bare", TriggerDef{Collection: "bare_things"}, br); len(owners) != 1 || owners[0] != "custom-user-id" {
		t.Fatalf("resolver must win: %v", owners)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestActionRegistry|TestOwnerAutoDetect' -v`
Expected: FAIL — symbols undefined.

- [ ] **Step 3: Implement registry.go**

```go
// tinycld/core/server/automation/registry.go
package automation

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// ActionRequest is what a native action handler receives. Params are already
// template-substituted strings; Record is nil for synthetic triggers.
type ActionRequest struct {
	Rule    *core.Record
	OwnerID string
	Params  map[string]string
	Record  *core.Record
}

type ActionHandler func(app core.App, req ActionRequest) error

// OwnerResolver maps a trigger record to the user ids the event belongs to,
// for triggers whose collection has no direct user FK (e.g. mail's shared
// mailboxes). Empty result = the event has no personal scope.
type OwnerResolver func(app core.App, record *core.Record) []string

var (
	registryMu     sync.RWMutex
	actionHandlers = map[string]ActionHandler{}
	ownerResolvers = map[string]OwnerResolver{}
)

// RegisterAction installs the Go handler for a native action ref. Packages
// call this from their Register(app), mirroring $-binding registration.
func RegisterAction(ref string, h ActionHandler) {
	registryMu.Lock()
	defer registryMu.Unlock()
	actionHandlers[ref] = h
}

func actionHandler(ref string) (ActionHandler, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	h, ok := actionHandlers[ref]
	return h, ok
}

// RegisterOwnerResolver overrides owner auto-detection for one trigger ref.
func RegisterOwnerResolver(triggerRef string, r OwnerResolver) {
	registryMu.Lock()
	defer registryMu.Unlock()
	ownerResolvers[triggerRef] = r
}

func ResetRegistriesForTest() {
	registryMu.Lock()
	defer registryMu.Unlock()
	actionHandlers = map[string]ActionHandler{}
	ownerResolvers = map[string]OwnerResolver{}
}

var autoOwnerFields = []string{"user", "owner", "author"}

// ResolveOwners: registered resolver > declared ownerField > auto-detected
// user/owner/author relation → users. Empty = personal rules never match
// this event (locked Phase 2 decision — org rules still fire).
func ResolveOwners(app core.App, triggerRef string, trigger TriggerDef, record *core.Record) []string {
	if record == nil {
		return nil
	}
	registryMu.RLock()
	resolver, hasResolver := ownerResolvers[triggerRef]
	registryMu.RUnlock()
	if hasResolver {
		return resolver(app, record)
	}

	candidates := autoOwnerFields
	if trigger.OwnerField != "" {
		candidates = []string{trigger.OwnerField}
	}
	usersCol, err := app.FindCachedCollectionByNameOrId("users")
	if err != nil {
		return nil
	}
	for _, name := range candidates {
		field := record.Collection().Fields.GetByName(name)
		rel, ok := field.(*core.RelationField)
		if !ok || rel.CollectionId != usersCol.Id {
			continue
		}
		return stringValues(record, name)
	}
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS. `gofmt -l automation/` prints nothing.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/registry.go core/server/automation/registry_test.go
git commit -m "feat(automation): action and owner-resolver registries"
```

---

### Task 5: Record-op executor (`actions.go`)

**Files:**
- Create: `tinycld/core/server/automation/actions.go`
- Test: `tinycld/core/server/automation/actions_test.go`

**Interfaces:**
- Consumes: `ActionDef`/`RecordOp`/`SetValue` (Task 1), `SubstituteTemplates` (Task 3), `actionHandler` (Task 4), `pkgaccess.WriteError`, the provenance sentinel (declared here, consumed by Task 6).
- Produces:
  - `ExecuteAction(app core.App, defs *Defs, ref string, rawParams map[string]any, rule *core.Record, trigger TriggerDef, record *core.Record, depth int) error` — resolves the action by ref; substitutes templates into every string param; dispatches `kind: 'native'` to the registry (missing handler → error `"native action <ref> has no registered handler (package Go not linked?)"`); executes `kind: 'record-op'`:
    - `target: 'trigger-record'` ops require `record != nil` and `record.Collection().Name == action.Collection` (else error).
    - `type: 'create'` builds a new record in `action.Collection`; `type: 'update'` mutates the trigger record's fields; `type: 'delete'` deletes the trigger record.
    - `set` values resolve: `{param: k}` → substituted param string; `{context: 'record-id'}` → `record.Id`; `{context: 'collection'}` → `record.Collection().Name`; `{context: 'owner'}` → the rule's execution owner id; literal → as-is.
    - **pkgaccess:** when `rule.GetString("scope") == "personal"`, load the owner user record and call `pkgaccess.WriteError(app, owner, slug)` where slug = the action's owning package (the ref's pkg part; for `core:*` record-ops skip — core collections are not package-gated). Org rules skip the check (system authority, spec-documented).
    - Before `app.Save`/`app.Delete`, call `markEngineWrite(recordID, rule.Id, depth)` so the resulting hook event carries provenance.
  - `markEngineWrite(recordID, ruleID string, depth int)` / `takeEngineWrite(recordID string) (engineWrite, bool)` over a package-level `sync.Map` (`engineWrite { RuleID string; Depth int }`) — the `recentlyIndexed` sentinel shape. For creates the id isn't known pre-Save: generate it with `core.GenerateDefaultRandomId()` and `record.Set("id", ...)` first, then mark, then Save.

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/actions_test.go
package automation

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// actionApp builds: users (fixture), label_assignments-like target collection,
// a source collection, one user, one source record, and a personal rule record
// shape (plain base collection standing in for `rules` — executor only reads
// scope/owner via GetString).
func actionApp(t *testing.T) (*tests.TestApp, *core.Record, *core.Record, *Defs) {
	t.Helper()
	t.Cleanup(ResetRegistriesForTest)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Cleanup() })
	users, _ := app.FindCollectionByNameOrId("users")

	src := core.NewBaseCollection("things")
	src.Fields.Add(&core.TextField{Name: "title"})
	src.Fields.Add(&core.TextField{Name: "status"})
	if err := app.Save(src); err != nil {
		t.Fatal(err)
	}
	tgt := core.NewBaseCollection("thing_labels")
	tgt.Fields.Add(&core.TextField{Name: "label"})
	tgt.Fields.Add(&core.TextField{Name: "record_id"})
	tgt.Fields.Add(&core.TextField{Name: "collection"})
	tgt.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1})
	if err := app.Save(tgt); err != nil {
		t.Fatal(err)
	}
	rulesCol := core.NewBaseCollection("fake_rules")
	rulesCol.Fields.Add(&core.TextField{Name: "scope"})
	rulesCol.Fields.Add(&core.TextField{Name: "owner"})
	if err := app.Save(rulesCol); err != nil {
		t.Fatal(err)
	}

	u, _ := app.FindFirstRecordByFilter("users", "id != ''")
	rec := core.NewRecord(src)
	rec.Set("title", "Invoice #7")
	rec.Set("status", "new")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	rule := core.NewRecord(rulesCol)
	rule.Set("scope", "org")
	rule.Set("owner", u.Id)
	if err := app.Save(rule); err != nil {
		t.Fatal(err)
	}

	defs := &Defs{Packages: []PackageDefs{{
		Slug: "core",
		Actions: []ActionDef{
			{
				ID: "apply-label", Kind: "record-op", Collection: "thing_labels",
				Op: RecordOp{Type: "create", Set: map[string]SetValue{
					"label":      {Param: "label"},
					"record_id":  {Context: "record-id"},
					"collection": {Context: "collection"},
					"user":       {Context: "owner"},
				}},
				Params: []ParamDef{{Key: "label", Field: "label"}},
			},
			{ID: "notify", Kind: "native", Params: []ParamDef{{Key: "title", Type: "text"}}},
		},
	}, {
		Slug: "things",
		Actions: []ActionDef{{
			ID: "set-status", Kind: "record-op", Collection: "things",
			Op:     RecordOp{Type: "update", Target: "trigger-record", Set: map[string]SetValue{"status": {Param: "status"}}},
			Params: []ParamDef{{Key: "status", Field: "status"}},
		}},
	}}}
	return app, rec, rule, defs
}

var openTrigger = TriggerDef{Collection: "things", On: "create"}

func TestRecordOpCreateWithContext(t *testing.T) {
	app, rec, rule, defs := actionApp(t)
	err := ExecuteAction(app, defs, "core:apply-label", map[string]any{"label": "Finance {{title}}"}, rule, openTrigger, rec, 0)
	if err != nil {
		t.Fatal(err)
	}
	made, err := app.FindFirstRecordByFilter("thing_labels", "record_id = {:id}", map[string]any{"id": rec.Id})
	if err != nil {
		t.Fatal(err)
	}
	if made.GetString("label") != "Finance Invoice #7" {
		t.Fatalf("template param: %q", made.GetString("label"))
	}
	if made.GetString("collection") != "things" || made.GetString("user") != rule.GetString("owner") {
		t.Fatalf("context values: %+v", made.PublicExport())
	}
	if _, ok := takeEngineWrite(made.Id); !ok {
		t.Fatal("engine create must carry provenance")
	}
}

func TestRecordOpUpdateTriggerRecord(t *testing.T) {
	app, rec, rule, defs := actionApp(t)
	if err := ExecuteAction(app, defs, "things:set-status", map[string]any{"status": "filed"}, rule, openTrigger, rec, 1); err != nil {
		t.Fatal(err)
	}
	fresh, _ := app.FindRecordById("things", rec.Id)
	if fresh.GetString("status") != "filed" {
		t.Fatal("update did not apply")
	}
	w, ok := takeEngineWrite(rec.Id)
	if !ok || w.Depth != 1 || w.RuleID != rule.Id {
		t.Fatalf("provenance: %+v %v", w, ok)
	}
}

func TestNativeDispatchAndMissingHandler(t *testing.T) {
	app, rec, rule, defs := actionApp(t)
	var got ActionRequest
	RegisterAction("core:notify", func(a core.App, req ActionRequest) error {
		got = req
		return nil
	})
	err := ExecuteAction(app, defs, "core:notify", map[string]any{"title": "Got {{title}}"}, rule, openTrigger, rec, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Params["title"] != "Got Invoice #7" {
		t.Fatalf("substituted params must reach handler: %+v", got.Params)
	}
	ResetRegistriesForTest()
	if err := ExecuteAction(app, defs, "core:notify", nil, rule, openTrigger, rec, 0); err == nil {
		t.Fatal("missing native handler must error")
	}
}

func TestTriggerRecordOpNeedsMatchingCollection(t *testing.T) {
	app, _, rule, defs := actionApp(t)
	if err := ExecuteAction(app, defs, "things:set-status", nil, rule, openTrigger, nil, 0); err == nil {
		t.Fatal("trigger-record op with nil record must error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestRecordOp|TestNative|TestTriggerRecordOp' -v`
Expected: FAIL — symbols undefined.

- [ ] **Step 3: Implement actions.go**

```go
// tinycld/core/server/automation/actions.go
package automation

import (
	"fmt"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/pkgaccess"
)

type engineWrite struct {
	RuleID string
	Depth  int
}

// engineWrites carries provenance from an engine-performed Save/Delete to the
// record hook it fires — the recentlyIndexed sentinel shape from mail. Entries
// are consumed by the dispatcher (Task 6); stale entries are harmless.
var engineWrites sync.Map

func markEngineWrite(recordID, ruleID string, depth int) {
	engineWrites.Store(recordID, engineWrite{RuleID: ruleID, Depth: depth})
}

func takeEngineWrite(recordID string) (engineWrite, bool) {
	v, ok := engineWrites.LoadAndDelete(recordID)
	if !ok {
		return engineWrite{}, false
	}
	return v.(engineWrite), true
}

func substituteParams(defs ActionDef, raw map[string]any, record *core.Record, trigger TriggerDef) map[string]string {
	out := map[string]string{}
	for _, p := range defs.Params {
		v, ok := raw[p.Key]
		if !ok {
			continue
		}
		s := normalize(v)
		out[p.Key] = SubstituteTemplates(s, record, trigger)
	}
	return out
}

func resolveSetValue(sv SetValue, params map[string]string, record *core.Record, ownerID string) (any, error) {
	switch {
	case sv.Param != "":
		return params[sv.Param], nil
	case sv.Context != "":
		switch sv.Context {
		case "record-id":
			if record == nil {
				return nil, fmt.Errorf("context record-id with no trigger record")
			}
			return record.Id, nil
		case "collection":
			if record == nil {
				return nil, fmt.Errorf("context collection with no trigger record")
			}
			return record.Collection().Name, nil
		case "owner":
			return ownerID, nil
		default:
			return nil, fmt.Errorf("unknown set context %q", sv.Context)
		}
	default:
		return sv.Literal, nil
	}
}

// checkPersonalAccess applies pkgaccess to personal-rule record-ops. The
// engine writes with superuser Save, which bypasses the REST guard entirely
// (pkgaccess binds request hooks only) — so the engine re-applies the check
// itself. Org rules run with system authority: admin-authored, documented in
// the spec. Core-owned collections (pkg "core") are not package-gated.
func checkPersonalAccess(app core.App, rule *core.Record, pkg string) error {
	if rule.GetString("scope") != "personal" || pkg == "core" {
		return nil
	}
	owner, err := app.FindRecordById("users", rule.GetString("owner"))
	if err != nil {
		return fmt.Errorf("rule owner lookup: %w", err)
	}
	return pkgaccess.WriteError(app, owner, pkg)
}

// ExecuteAction runs one rule action against one trigger event. depth is the
// chain depth to stamp onto any resulting engine write.
func ExecuteAction(app core.App, defs *Defs, ref string, rawParams map[string]any, rule *core.Record, trigger TriggerDef, record *core.Record, depth int) error {
	action, pkg, ok := defs.Action(ref)
	if !ok {
		return fmt.Errorf("unknown action %q (package uninstalled?)", ref)
	}
	ownerID := rule.GetString("owner")
	params := substituteParams(action, rawParams, record, trigger)

	if action.Kind == "native" {
		h, ok := actionHandler(ref)
		if !ok {
			return fmt.Errorf("native action %q has no registered handler (package Go not linked?)", ref)
		}
		return h(app, ActionRequest{Rule: rule, OwnerID: ownerID, Params: params, Record: record})
	}

	if err := checkPersonalAccess(app, rule, pkg); err != nil {
		return err
	}

	switch action.Op.Type {
	case "create":
		col, err := app.FindCollectionByNameOrId(action.Collection)
		if err != nil {
			return fmt.Errorf("action collection %q: %w", action.Collection, err)
		}
		made := core.NewRecord(col)
		made.Set("id", core.GenerateDefaultRandomId())
		for field, sv := range action.Op.Set {
			v, err := resolveSetValue(sv, params, record, ownerID)
			if err != nil {
				return err
			}
			made.Set(field, v)
		}
		markEngineWrite(made.Id, rule.Id, depth)
		return app.Save(made)
	case "update", "delete":
		if action.Op.Target != "trigger-record" {
			return fmt.Errorf("record-op %q: unsupported target %q", ref, action.Op.Target)
		}
		if record == nil {
			return fmt.Errorf("record-op %q targets the trigger record but the trigger has none", ref)
		}
		if record.Collection().Name != action.Collection {
			return fmt.Errorf("record-op %q: trigger record is %q, action declares %q", ref, record.Collection().Name, action.Collection)
		}
		if action.Op.Type == "delete" {
			markEngineWrite(record.Id, rule.Id, depth)
			return app.Delete(record)
		}
		for field, sv := range action.Op.Set {
			v, err := resolveSetValue(sv, params, record, ownerID)
			if err != nil {
				return err
			}
			record.Set(field, v)
		}
		markEngineWrite(record.Id, rule.Id, depth)
		return app.Save(record)
	default:
		return fmt.Errorf("record-op %q: unknown op type %q", ref, action.Op.Type)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS. `gofmt -l automation/` prints nothing. (If the `tinycld.org/core/pkgaccess` import path differs — check `core/server/pkgaccess/pkgaccess.go`'s package clause and an existing importer such as `coreserver/server.go` — use the exact path found there and note it in your report.)

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/actions.go core/server/automation/actions_test.go
git commit -m "feat(automation): record-op executor with provenance and pkgaccess"
```

---

### Task 6: Run log + auto-disable (`runs.go`)

**Files:**
- Create: `tinycld/core/server/automation/runs.go`
- Test: `tinycld/core/server/automation/runs_test.go`

**Interfaces:**
- Consumes: real `rules`/`rule_runs` collections (apply via `rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb_migrations"))`), `notify.NotifyUser`, `exposedFields` (Task 3).
- Produces:
  - `type ActionResult struct { Ref string; Status string; Message string }` (`Status` ∈ `ok`/`error`), `type RunOutcome struct { Matched bool; Results []ActionResult; Err string; Duration time.Duration }`.
  - `WriteRun(app core.App, rule *core.Record, record *core.Record, trigger TriggerDef, outcome RunOutcome)` — inserts a `rule_runs` record (`fired_at` = now UTC in PB format, `matched`, `trigger_summary` = map of the trigger's exposed fields → normalized values (nil record → nil), `results` marshaled, `error`, `duration_ms`), then prunes: fetch `FindRecordsByFilter("rule_runs", "rule = {:id}", "-fired_at", 50, keepRunsPerRule, ...)` in a loop and delete — `keepRunsPerRule = 200`.
  - `recordRunResult(app core.App, rule *core.Record, fullyFailed bool)` — in-memory `sync.Map` ruleID → consecutive-failure count; reset on any non-fully-failed run; at `autoDisableAfter = 20`, set `enabled = false` on the rule (`markEngineWrite` first so the rules-change hook knows), save, and `go notify.NotifyUser(...)` with `Type: "automation_disabled"`, `Package: "core"`, a title naming the rule, `URL: "/"`. Counter is in-memory by design (a restart resets the streak; `rule_runs` is the durable record) — document this in a comment.
  - `ResetRunStateForTest()`.

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/runs_test.go
package automation

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/rlstest"
)

func runsApp(t *testing.T) (core.App, *core.Record) {
	t.Helper()
	t.Cleanup(ResetRunStateForTest)
	app := rlstest.NewApp(t)
	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb_migrations"))

	u, err := app.FindFirstRecordByFilter("users", "id != ''")
	if err != nil {
		t.Fatal(err)
	}
	rulesCol, err := app.FindCollectionByNameOrId("rules")
	if err != nil {
		t.Fatal(err)
	}
	rule := core.NewRecord(rulesCol)
	rule.Set("name", "Test rule")
	rule.Set("scope", "personal")
	rule.Set("owner", u.Id)
	rule.Set("trigger", "core:manual")
	rule.Set("enabled", true)
	if err := app.Save(rule); err != nil {
		t.Fatal(err)
	}
	return app, rule
}

func TestWriteRunAndPrune(t *testing.T) {
	app, rule := runsApp(t)
	outcome := RunOutcome{
		Matched:  true,
		Results:  []ActionResult{{Ref: "core:notify", Status: "ok"}},
		Duration: 12 * time.Millisecond,
	}
	WriteRun(app, rule, nil, TriggerDef{}, outcome)

	runs, err := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "-fired_at", 0, 0, map[string]any{"id": rule.Id})
	if err != nil || len(runs) != 1 {
		t.Fatalf("expected 1 run: %v %v", len(runs), err)
	}
	if !runs[0].GetBool("matched") || runs[0].GetInt("duration_ms") != 12 {
		t.Fatalf("run fields: %+v", runs[0].PublicExport())
	}
}

func TestPruneKeeps200(t *testing.T) {
	app, rule := runsApp(t)
	col, _ := app.FindCollectionByNameOrId("rule_runs")
	for i := 0; i < 205; i++ {
		r := core.NewRecord(col)
		r.Set("rule", rule.Id)
		r.Set("fired_at", time.Now().Add(-time.Duration(i)*time.Minute).UTC().Format("2006-01-02 15:04:05.000Z"))
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	WriteRun(app, rule, nil, TriggerDef{}, RunOutcome{Matched: false})
	runs, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": rule.Id})
	if len(runs) != keepRunsPerRule {
		t.Fatalf("prune: got %d want %d", len(runs), keepRunsPerRule)
	}
}

func TestAutoDisableAfterConsecutiveFailures(t *testing.T) {
	app, rule := runsApp(t)
	for i := 0; i < autoDisableAfter-1; i++ {
		recordRunResult(app, rule, true)
	}
	fresh, _ := app.FindRecordById("rules", rule.Id)
	if !fresh.GetBool("enabled") {
		t.Fatal("must not disable before the threshold")
	}
	recordRunResult(app, rule, false) // success resets the streak
	for i := 0; i < autoDisableAfter; i++ {
		recordRunResult(app, rule, true)
	}
	fresh, _ = app.FindRecordById("rules", rule.Id)
	if fresh.GetBool("enabled") {
		t.Fatal(fmt.Sprintf("must disable after %d consecutive failures", autoDisableAfter))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestWriteRun|TestPrune|TestAutoDisable' -v`
Expected: FAIL — symbols undefined. (If `rlstest.MigrationsDir(t, "../pb_migrations")` resolves wrong from the `automation/` package dir, check how `coreserver/org_pkg_access_rls_test.go` calls it and mirror the relative path; note in report.)

- [ ] **Step 3: Implement runs.go**

```go
// tinycld/core/server/automation/runs.go
package automation

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/notify"
)

const (
	keepRunsPerRule  = 200
	autoDisableAfter = 20
)

type ActionResult struct {
	Ref     string `json:"ref"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type RunOutcome struct {
	Matched  bool
	Results  []ActionResult
	Err      string
	Duration time.Duration
}

func triggerSummary(record *core.Record, trigger TriggerDef) map[string]any {
	if record == nil {
		return nil
	}
	out := map[string]any{}
	for key := range exposedFields(record, trigger) {
		out[key] = normalize(record.Get(key))
	}
	return out
}

// WriteRun logs one engine run — matched or not: "why didn't it fire" is
// debugged from non-match rows. Failures to log are reported to the app
// logger, never propagated: the run already happened.
func WriteRun(app core.App, rule *core.Record, record *core.Record, trigger TriggerDef, outcome RunOutcome) {
	col, err := app.FindCollectionByNameOrId("rule_runs")
	if err != nil {
		app.Logger().Error("automation: rule_runs collection missing", "err", err)
		return
	}
	run := core.NewRecord(col)
	run.Set("rule", rule.Id)
	run.Set("fired_at", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))
	run.Set("matched", outcome.Matched)
	run.Set("trigger_summary", triggerSummary(record, trigger))
	if len(outcome.Results) > 0 {
		b, _ := json.Marshal(outcome.Results)
		run.Set("results", json.RawMessage(b))
	}
	run.Set("error", outcome.Err)
	run.Set("duration_ms", outcome.Duration.Milliseconds())
	if err := app.Save(run); err != nil {
		app.Logger().Error("automation: write rule_run", "rule", rule.Id, "err", err)
		return
	}
	pruneRuns(app, rule.Id)
}

func pruneRuns(app core.App, ruleID string) {
	for {
		extra, err := app.FindRecordsByFilter(
			"rule_runs", "rule = {:id}", "-fired_at", 50, keepRunsPerRule,
			map[string]any{"id": ruleID},
		)
		if err != nil || len(extra) == 0 {
			return
		}
		for _, r := range extra {
			if err := app.Delete(r); err != nil {
				app.Logger().Error("automation: prune rule_run", "err", err)
				return
			}
		}
		if len(extra) < 50 {
			return
		}
	}
}

// failureStreaks is in-memory by design: a restart resets the streak, and
// rule_runs is the durable record. Good enough to stop a hot broken rule.
var failureStreaks sync.Map

func ResetRunStateForTest() {
	failureStreaks = sync.Map{}
}

func recordRunResult(app core.App, rule *core.Record, fullyFailed bool) {
	if !fullyFailed {
		failureStreaks.Delete(rule.Id)
		return
	}
	n := 1
	if v, ok := failureStreaks.Load(rule.Id); ok {
		n = v.(int) + 1
	}
	failureStreaks.Store(rule.Id, n)
	if n < autoDisableAfter {
		return
	}
	failureStreaks.Delete(rule.Id)
	rule.Set("enabled", false)
	markEngineWrite(rule.Id, rule.Id, 0)
	if err := app.Save(rule); err != nil {
		app.Logger().Error("automation: auto-disable", "rule", rule.Id, "err", err)
		return
	}
	go notify.NotifyUser(app, notify.NotifyParams{
		UserID:  rule.GetString("owner"),
		Type:    "automation_disabled",
		Package: "core",
		Title:   "Automation rule disabled",
		Body:    "\"" + rule.GetString("name") + "\" failed repeatedly and was turned off.",
		URL:     "/",
	})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS. `gofmt -l automation/` prints nothing. (Import path for notify: check `coreserver/server.go`'s import block and use the exact module path.)

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/runs.go core/server/automation/runs_test.go
git commit -m "feat(automation): run logging, pruning, and auto-disable"
```

---

### Task 7: Engine dispatch (`engine.go`)

**Files:**
- Create: `tinycld/core/server/automation/engine.go`
- Test: `tinycld/core/server/automation/engine_test.go`

**Interfaces:**
- Consumes: everything above; real `rules` migrations in tests.
- Produces:
  - `type Engine struct { app core.App; defs *Defs; queue chan event; cancel context.CancelFunc }` with `event { TriggerRef string; Trigger TriggerDef; Record *core.Record; Depth int; SourceRule string }`.
  - `NewEngine(app core.App, defs *Defs) *Engine`; `(*Engine) Start()` — binds hooks + starts one worker goroutine (cancelled via `app.OnTerminate()`); `(*Engine) enqueue(ev event)` (non-blocking send on a 1024-buffered channel; on overflow log + drop — a lost dispatch is recoverable from the data, a blocked SMTP delivery is not); `(*Engine) dispatch(ev event)` (exported for tests as `DispatchForTest`).
  - **Hook binding** (`Start`): for each distinct `(collection, op)` across `defs.TriggersFor`, bind `app.OnRecordAfterCreateSuccess(col)` / `AfterUpdateSuccess` / `AfterDeleteSuccess` with a shared handler that: consumes `takeEngineWrite(e.Record.Id)` → provenance `(depth+1, sourceRule)`, caps at `maxChainDepth = 3` (over-cap: for each rule on that trigger write a `rule_runs` row with `Err: "chain-depth-exceeded"`? No — one log line + a run row against the SOURCE rule with `Err: "chain-depth-exceeded"`; keep it to the source rule), evaluates `WatchChanged` for update triggers, then enqueues one event per matching trigger def. **Also** binds `rules`-change hooks (create/update/delete) that call `engine.reloadScheduleFor(rule)` (Task 8 wires the body; this task stubs it as a no-op method so the binding compiles).
  - **dispatch**: loads enabled rules for the ref (`FindRecordsByFilter("rules", "trigger = {:ref} && enabled = true", "order", 0, 0, ...)`), partitions org-first-then-personal preserving `order` within each, resolves owners once (`ResolveOwners`), filters personal rules to `owners` containing the rule's owner; for each surviving rule: skip if `ev.SourceRule == rule.Id` (self-retrigger guard), evaluate conditions (`DecodeConditions(rule.Get("conditions"))`; decode error → run row with `Err`), non-match → `WriteRun(matched=false)` and continue; match → decode actions (`rule.Get("actions")` → `[]struct{ Ref string; Params map[string]any }` via the same marshal/unmarshal dance), run in order collecting `ActionResult`s (an action error records `status: "error"` and CONTINUES to later actions — mail-filter semantics), per-action timeout `30s` enforced by running the action in a goroutine with a `select` on `time.After` (on timeout record error; the goroutine is abandoned — document why: PB has no ctx-cancellable Save), `WriteRun(matched=true, results)`, `recordRunResult(app, rule, allActionsFailed)`, and honor `stop_processing`: org rule → stop everything; personal → stop later personal.
- Worker: single goroutine draining the queue (`for { select { case ev := <-q: e.dispatch(ev); case <-ctx.Done(): return } }`) with an `appIsLive`-style guard at the top of each dispatch.

- [ ] **Step 1: Write the failing test**

The test exercises the full loop through real hooks: create a rule via the real `rules` collection, save a matching record in a test collection, wait for the run row.

```go
// tinycld/core/server/automation/engine_test.go
package automation

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/rlstest"
)

// engineApp: real rules/rule_runs migrations + a "tickets" collection with an
// owner relation + defs declaring a create trigger and a set-status action.
func engineApp(t *testing.T) (core.App, *Engine, *core.Record) {
	t.Helper()
	t.Cleanup(ResetRegistriesForTest)
	t.Cleanup(ResetRunStateForTest)
	app := rlstest.NewApp(t)
	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb_migrations"))
	users, _ := app.FindCollectionByNameOrId("users")

	col := core.NewBaseCollection("tickets")
	col.Fields.Add(&core.TextField{Name: "title"})
	col.Fields.Add(&core.TextField{Name: "status"})
	col.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1})
	if err := app.Save(col); err != nil {
		t.Fatal(err)
	}

	defs := &Defs{Packages: []PackageDefs{{
		Slug: "tickets",
		Triggers: []TriggerDef{{ID: "ticket-created", Label: "created", Collection: "tickets", On: "create"}},
		Actions: []ActionDef{{
			ID: "set-status", Label: "set", Kind: "record-op", Collection: "tickets",
			Op:     RecordOp{Type: "update", Target: "trigger-record", Set: map[string]SetValue{"status": {Param: "status"}}},
			Params: []ParamDef{{Key: "status", Field: "status"}},
		}},
	}}}
	eng := NewEngine(app, defs)
	eng.Start()

	u, _ := app.FindFirstRecordByFilter("users", "id != ''")
	return app, eng, u
}

func makeRule(t *testing.T, app core.App, owner, scope string, conditions, actions any, order int, stop bool) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("rules")
	r := core.NewRecord(col)
	r.Set("name", "r")
	r.Set("scope", scope)
	r.Set("owner", owner)
	r.Set("trigger", "tickets:ticket-created")
	r.Set("conditions", conditions)
	r.Set("actions", actions)
	r.Set("enabled", true)
	r.Set("order", order)
	r.Set("stop_processing", stop)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func waitForRuns(t *testing.T, app core.App, ruleID string, want int) []*core.Record {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		runs, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "-fired_at", 0, 0, map[string]any{"id": ruleID})
		if len(runs) >= want {
			return runs
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d runs of %s", want, ruleID)
	return nil
}

func TestEndToEndMatchAndAction(t *testing.T) {
	app, _, u := engineApp(t)
	rule := makeRule(t, app, u.Id, "personal",
		map[string]any{"match": "all", "groups": []any{map[string]any{
			"match": "any", "conditions": []any{map[string]any{"field": "title", "op": "contains", "value": "urgent"}},
		}}},
		[]any{map[string]any{"ref": "tickets:set-status", "params": map[string]any{"status": "triaged"}}},
		0, false)

	col, _ := app.FindCollectionByNameOrId("tickets")
	rec := core.NewRecord(col)
	rec.Set("title", "URGENT: disk full")
	rec.Set("user", u.Id)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}

	runs := waitForRuns(t, app, rule.Id, 1)
	if !runs[0].GetBool("matched") {
		t.Fatal("rule must match")
	}
	fresh, _ := app.FindRecordById("tickets", rec.Id)
	if fresh.GetString("status") != "triaged" {
		t.Fatalf("action must apply: %q", fresh.GetString("status"))
	}
}

func TestNonMatchIsLogged(t *testing.T) {
	app, _, u := engineApp(t)
	rule := makeRule(t, app, u.Id, "personal",
		map[string]any{"match": "all", "groups": []any{map[string]any{
			"match": "any", "conditions": []any{map[string]any{"field": "title", "op": "contains", "value": "nope"}},
		}}},
		[]any{map[string]any{"ref": "tickets:set-status", "params": map[string]any{"status": "x"}}},
		0, false)

	col, _ := app.FindCollectionByNameOrId("tickets")
	rec := core.NewRecord(col)
	rec.Set("title", "routine")
	rec.Set("user", u.Id)
	app.Save(rec)

	runs := waitForRuns(t, app, rule.Id, 1)
	if runs[0].GetBool("matched") {
		t.Fatal("non-match must log matched=false")
	}
	fresh, _ := app.FindRecordById("tickets", rec.Id)
	if fresh.GetString("status") != "" {
		t.Fatal("no action on non-match")
	}
}

func TestPersonalScopeFiltering(t *testing.T) {
	app, _, u := engineApp(t)
	// Rule owned by u, but the ticket belongs to a second user → must not fire.
	users, _ := app.FindCollectionByNameOrId("users")
	other := core.NewRecord(users)
	other.Set("email", "other@example.com")
	other.Set("username", "otheruser")
	other.Set("name", "Other")
	other.SetPassword("0123456789")
	if err := app.Save(other); err != nil {
		t.Fatal(err)
	}
	rule := makeRule(t, app, u.Id, "personal", nil,
		[]any{map[string]any{"ref": "tickets:set-status", "params": map[string]any{"status": "x"}}}, 0, false)

	col, _ := app.FindCollectionByNameOrId("tickets")
	rec := core.NewRecord(col)
	rec.Set("title", "anything")
	rec.Set("user", other.Id)
	app.Save(rec)

	// Give the worker a beat, then assert NO run row exists.
	time.Sleep(300 * time.Millisecond)
	runs, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": rule.Id})
	if len(runs) != 0 {
		t.Fatalf("personal rule must not fire on another user's record: %d runs", len(runs))
	}
	_ = rule
}

func TestStopProcessingAndOrdering(t *testing.T) {
	app, _, u := engineApp(t)
	first := makeRule(t, app, u.Id, "personal", nil,
		[]any{map[string]any{"ref": "tickets:set-status", "params": map[string]any{"status": "from-first"}}}, 0, true)
	second := makeRule(t, app, u.Id, "personal", nil,
		[]any{map[string]any{"ref": "tickets:set-status", "params": map[string]any{"status": "from-second"}}}, 1, false)

	col, _ := app.FindCollectionByNameOrId("tickets")
	rec := core.NewRecord(col)
	rec.Set("title", "t")
	rec.Set("user", u.Id)
	app.Save(rec)

	waitForRuns(t, app, first.Id, 1)
	time.Sleep(300 * time.Millisecond)
	runs, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": second.Id})
	if len(runs) != 0 {
		t.Fatal("stop_processing must skip later personal rules")
	}
	fresh, _ := app.FindRecordById("tickets", rec.Id)
	if fresh.GetString("status") != "from-first" {
		t.Fatalf("first rule's action must have applied: %q", fresh.GetString("status"))
	}
}

func TestSelfRetriggerAndChainDepth(t *testing.T) {
	app, _, u := engineApp(t)
	// set-status writes the trigger record → refires the update hook. There is
	// no update trigger declared, so the direct loop risk is create-only here;
	// assert the self-retrigger guard via provenance: rule fires once, and the
	// engine-write sentinel was consumed (no unbounded growth).
	rule := makeRule(t, app, u.Id, "personal", nil,
		[]any{map[string]any{"ref": "tickets:set-status", "params": map[string]any{"status": "done"}}}, 0, false)

	col, _ := app.FindCollectionByNameOrId("tickets")
	rec := core.NewRecord(col)
	rec.Set("title", "t")
	rec.Set("user", u.Id)
	app.Save(rec)

	waitForRuns(t, app, rule.Id, 1)
	time.Sleep(300 * time.Millisecond)
	runs, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": rule.Id})
	if len(runs) != 1 {
		t.Fatalf("rule must fire exactly once, got %d", len(runs))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestEndToEnd|TestNonMatch|TestPersonal|TestStop|TestSelfRetrigger' -v`
Expected: FAIL — `Engine`/`NewEngine` undefined.

- [ ] **Step 3: Implement engine.go**

```go
// tinycld/core/server/automation/engine.go
package automation

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	maxChainDepth    = 3
	actionTimeout    = 30 * time.Second
	dispatchQueueLen = 1024
)

type event struct {
	TriggerRef string
	Trigger    TriggerDef
	Record     *core.Record
	Depth      int
	SourceRule string
}

type Engine struct {
	app    core.App
	defs   *Defs
	queue  chan event
	cancel context.CancelFunc
}

func NewEngine(app core.App, defs *Defs) *Engine {
	return &Engine{app: app, defs: defs, queue: make(chan event, dispatchQueueLen)}
}

func appIsLive(app core.App) bool {
	return app != nil && app.ConcurrentDB() != nil
}

// Start binds one hook per distinct (collection, op) named by the defs, plus
// the rules-change hooks for schedule reconciliation, and launches the worker.
// Rule execution never runs on the hook goroutine: a slow rule must not block
// an SMTP delivery.
func (e *Engine) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		cancel()
		return te.Next()
	})
	go e.worker(ctx)

	type colOp struct{ col, op string }
	seen := map[colOp]bool{}
	for _, p := range e.defs.Packages {
		for _, t := range p.Triggers {
			if t.Synthetic != "" {
				continue
			}
			key := colOp{t.Collection, t.On}
			if seen[key] {
				continue
			}
			seen[key] = true
			handler := e.recordHookHandler(key.col, key.op)
			switch key.op {
			case "create":
				e.app.OnRecordAfterCreateSuccess(key.col).BindFunc(handler)
			case "update":
				e.app.OnRecordAfterUpdateSuccess(key.col).BindFunc(handler)
			case "delete":
				e.app.OnRecordAfterDeleteSuccess(key.col).BindFunc(handler)
			}
		}
	}

	reload := func(ev *core.RecordEvent) error {
		e.reloadScheduleFor(ev.Record)
		return ev.Next()
	}
	e.app.OnRecordAfterCreateSuccess("rules").BindFunc(reload)
	e.app.OnRecordAfterUpdateSuccess("rules").BindFunc(reload)
	e.app.OnRecordAfterDeleteSuccess("rules").BindFunc(reload)
}

// reloadScheduleFor is completed in the schedule task; the hook binding above
// must exist from the start so no rules write is missed between tasks.
func (e *Engine) reloadScheduleFor(rule *core.Record) {}

func (e *Engine) recordHookHandler(col, op string) func(*core.RecordEvent) error {
	return func(ev *core.RecordEvent) error {
		depth := 0
		source := ""
		if w, ok := takeEngineWrite(ev.Record.Id); ok {
			depth = w.Depth + 1
			source = w.RuleID
		}
		if depth > maxChainDepth {
			e.app.Logger().Warn("automation: chain depth exceeded", "collection", col, "record", ev.Record.Id, "sourceRule", source)
			if source != "" {
				if rule, err := e.app.FindRecordById("rules", source); err == nil {
					WriteRun(e.app, rule, ev.Record, TriggerDef{}, RunOutcome{Err: "chain-depth-exceeded"})
				}
			}
			return ev.Next()
		}
		for _, qt := range e.defs.TriggersFor(col, op) {
			if op == "update" && !WatchChanged(ev.Record, qt.Def.Watch) {
				continue
			}
			e.enqueue(event{TriggerRef: qt.Ref, Trigger: qt.Def, Record: ev.Record, Depth: depth, SourceRule: source})
		}
		return ev.Next()
	}
}

func (e *Engine) enqueue(ev event) {
	select {
	case e.queue <- ev:
	default:
		// A dropped dispatch is recoverable (the data is in the DB); a blocked
		// write path is not. Log loudly and move on.
		e.app.Logger().Error("automation: dispatch queue full, dropping event", "trigger", ev.TriggerRef)
	}
}

func (e *Engine) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-e.queue:
			if !appIsLive(e.app) {
				return
			}
			e.dispatch(ev)
		}
	}
}

// DispatchForTest runs one event synchronously.
func (e *Engine) DispatchForTest(ev event) { e.dispatch(ev) }

type storedAction struct {
	Ref    string         `json:"ref"`
	Params map[string]any `json:"params"`
}

func decodeActions(raw any) ([]storedAction, error) {
	var out []storedAction
	if raw == nil {
		return out, nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	if len(b) == 0 || string(b) == "null" || string(b) == `""` {
		return out, nil
	}
	return out, json.Unmarshal(b, &out)
}

func (e *Engine) dispatch(ev event) {
	rules, err := e.app.FindRecordsByFilter(
		"rules", "trigger = {:ref} && enabled = true", "order", 0, 0,
		map[string]any{"ref": ev.TriggerRef},
	)
	if err != nil || len(rules) == 0 {
		return
	}
	// Org rules first, then personal — order preserved within each tier.
	sort.SliceStable(rules, func(i, j int) bool {
		si, sj := rules[i].GetString("scope"), rules[j].GetString("scope")
		if si != sj {
			return si == "org"
		}
		return false
	})

	owners := ResolveOwners(e.app, ev.TriggerRef, ev.Trigger, ev.Record)
	ownerSet := map[string]bool{}
	for _, id := range owners {
		ownerSet[id] = true
	}

	stopped := false
	for _, rule := range rules {
		if stopped {
			break
		}
		if rule.Id == ev.SourceRule {
			continue // a rule never re-fires on its own write
		}
		if rule.GetString("scope") == "personal" && !ownerSet[rule.GetString("owner")] {
			continue
		}
		start := time.Now()

		ast, err := DecodeConditions(rule.Get("conditions"))
		if err != nil {
			WriteRun(e.app, rule, ev.Record, ev.Trigger, RunOutcome{Err: "invalid conditions: " + err.Error(), Duration: time.Since(start)})
			continue
		}
		if !EvaluateConditions(ast, ev.Record) {
			WriteRun(e.app, rule, ev.Record, ev.Trigger, RunOutcome{Matched: false, Duration: time.Since(start)})
			continue
		}

		actions, err := decodeActions(rule.Get("actions"))
		if err != nil {
			WriteRun(e.app, rule, ev.Record, ev.Trigger, RunOutcome{Matched: true, Err: "invalid actions: " + err.Error(), Duration: time.Since(start)})
			continue
		}
		results := make([]ActionResult, 0, len(actions))
		failed := 0
		for _, a := range actions {
			res := ActionResult{Ref: a.Ref, Status: "ok"}
			if err := e.runActionWithTimeout(a, rule, ev); err != nil {
				res.Status = "error"
				res.Message = err.Error()
				failed++
			}
			results = append(results, res)
		}
		WriteRun(e.app, rule, ev.Record, ev.Trigger, RunOutcome{Matched: true, Results: results, Duration: time.Since(start)})
		recordRunResult(e.app, rule, len(actions) > 0 && failed == len(actions))

		if rule.GetBool("stop_processing") {
			if rule.GetString("scope") == "org" {
				stopped = true // org stop halts everything downstream
			} else {
				stopped = true // personal stop halts later personal rules — org already ran (org-first ordering)
			}
		}
	}
}

type timeoutErr struct{}

func (timeoutErr) Error() string { return "action timed out" }

// runActionWithTimeout abandons (does not kill) an overrunning action: the PB
// SDK has no context-cancellable Save, so the goroutine finishes on its own
// while the run is recorded as timed out.
func (e *Engine) runActionWithTimeout(a storedAction, rule *core.Record, ev event) error {
	done := make(chan error, 1)
	go func() {
		done <- ExecuteAction(e.app, e.defs, a.Ref, a.Params, rule, ev.Trigger, ev.Record, ev.Depth)
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(actionTimeout):
		return timeoutErr{}
	}
}
```

Note on the `stop_processing` branches: with org-first ordering both branches set `stopped = true`; the split is kept explicit (with comments) because the tiers' semantics differ in the spec and a future interleaving change must not silently merge them. If the reviewer flags it as duplication, collapsing to one line with the comment is acceptable.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS (all tasks so far). `gofmt -l automation/` prints nothing.

- [ ] **Step 5: Run the whole core suite**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./...`
Expected: PASS everywhere (the new hooks must not disturb existing suites).

- [ ] **Step 6: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/engine.go core/server/automation/engine_test.go
git commit -m "feat(automation): dispatch engine with scoping, ordering, and loop protection"
```

---

### Task 8: Scheduled rules (`schedule.go`)

**Files:**
- Create: `tinycld/core/server/automation/schedule.go`
- Modify: `tinycld/core/server/automation/engine.go` (replace the `reloadScheduleFor` stub)
- Test: `tinycld/core/server/automation/schedule_test.go`

**Interfaces:**
- Produces: `(*Engine) syncSchedules()` (called from `Start` after hook binding: loads all enabled `core:schedule` rules and registers each) and the real `(*Engine) reloadScheduleFor(rule *core.Record)` (single-rule reconcile: `trigger == "core:schedule" && enabled && cron expr valid` → `app.Cron().Add("automation:"+rule.Id, expr, fn)` (Add replaces by id); otherwise `app.Cron().Remove("automation:" + rule.Id)`). The cron fn enqueues `event{TriggerRef: "core:schedule", Record: nil}` — dispatch already handles nil records (conditions AST empty → match; trigger-record ops error per action executor; templates pass through). `trigger_config` decodes via the marshal/unmarshal dance to `struct { Cron string }`. Invalid cron expression → log warn + write a run row with `Err: "invalid schedule: <expr>"` so the user can see why it never fires.
- Scheduled dispatch scoping: no record → `ResolveOwners` returns nil → personal scheduled rules still run **for their owner** — special-case in `dispatch`: when `ev.Record == nil`, skip the personal-owner filter entirely (the rule firing IS the owner's context).

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/schedule_test.go
package automation

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/rlstest"
)

func scheduleApp(t *testing.T) (core.App, *Engine, *core.Record) {
	t.Helper()
	t.Cleanup(ResetRegistriesForTest)
	t.Cleanup(ResetRunStateForTest)
	app := rlstest.NewApp(t)
	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb_migrations"))
	defs := &Defs{Packages: []PackageDefs{{
		Slug:     "core",
		Triggers: []TriggerDef{{ID: "schedule", Synthetic: "schedule"}, {ID: "manual", Synthetic: "manual"}},
	}}}
	eng := NewEngine(app, defs)
	eng.Start()
	u, _ := app.FindFirstRecordByFilter("users", "id != ''")
	return app, eng, u
}

func scheduleRule(t *testing.T, app core.App, owner, cron string, enabled bool) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("rules")
	r := core.NewRecord(col)
	r.Set("name", "sched")
	r.Set("scope", "personal")
	r.Set("owner", owner)
	r.Set("trigger", "core:schedule")
	r.Set("trigger_config", map[string]any{"cron": cron})
	r.Set("enabled", enabled)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func hasJob(app core.App, ruleID string) bool {
	for _, j := range app.Cron().Jobs() {
		if j.Id() == "automation:"+ruleID {
			return true
		}
	}
	return false
}

func TestScheduleReconcile(t *testing.T) {
	app, _, u := scheduleApp(t)
	rule := scheduleRule(t, app, u.Id, "0 8 * * *", true)
	if !hasJob(app, rule.Id) {
		t.Fatal("enabled schedule rule must register a cron job")
	}

	rule.Set("enabled", false)
	if err := app.Save(rule); err != nil {
		t.Fatal(err)
	}
	if hasJob(app, rule.Id) {
		t.Fatal("disabling must remove the job")
	}

	rule.Set("enabled", true)
	if err := app.Save(rule); err != nil {
		t.Fatal(err)
	}
	if !hasJob(app, rule.Id) {
		t.Fatal("re-enabling must re-add the job")
	}

	if err := app.Delete(rule); err != nil {
		t.Fatal(err)
	}
	if hasJob(app, rule.Id) {
		t.Fatal("deleting must remove the job")
	}
}

func TestSyncSchedulesOnBoot(t *testing.T) {
	app, _, u := scheduleApp(t)
	// Rule created while "engine offline": simulate by removing the job, then sync.
	rule := scheduleRule(t, app, u.Id, "*/5 * * * *", true)
	app.Cron().Remove("automation:" + rule.Id)
	eng2 := NewEngine(app, &Defs{})
	eng2.syncSchedules()
	if !hasJob(app, rule.Id) {
		t.Fatal("syncSchedules must pick up existing enabled rules")
	}
}

func TestInvalidCronIsSurfaced(t *testing.T) {
	app, _, u := scheduleApp(t)
	rule := scheduleRule(t, app, u.Id, "not a cron", true)
	if hasJob(app, rule.Id) {
		t.Fatal("invalid cron must not register")
	}
	runs, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": rule.Id})
	if len(runs) != 1 || runs[0].GetString("error") == "" {
		t.Fatalf("invalid cron must write an explanatory run row: %d", len(runs))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestSchedule|TestSync|TestInvalidCron' -v`
Expected: FAIL — `syncSchedules` undefined / reconcile is a stub. (If `cron.Job` has no exported `Id()` — check `third_party/pocketbase/tools/cron/cron.go` — adapt `hasJob` to whatever the jobs API exposes, e.g. `Total()` + re-Add semantics, and note it in your report.)

- [ ] **Step 3: Implement schedule.go and wire the stub**

```go
// tinycld/core/server/automation/schedule.go
package automation

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
)

type scheduleConfig struct {
	Cron string `json:"cron"`
}

func decodeScheduleConfig(raw any) scheduleConfig {
	var cfg scheduleConfig
	if raw == nil {
		return cfg
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(b, &cfg)
	return cfg
}

func scheduleJobID(ruleID string) string { return "automation:" + ruleID }

// syncSchedules registers cron jobs for every enabled core:schedule rule.
// Called once from Start; per-rule changes reconcile via reloadScheduleFor.
func (e *Engine) syncSchedules() {
	rules, err := e.app.FindRecordsByFilter(
		"rules", "trigger = 'core:schedule' && enabled = true", "", 0, 0,
	)
	if err != nil {
		e.app.Logger().Error("automation: load schedule rules", "err", err)
		return
	}
	for _, r := range rules {
		e.reloadScheduleFor(r)
	}
}
```

In `engine.go`, replace the stub with the real reconcile, and call `e.syncSchedules()` at the end of `Start()`:

```go
// reloadScheduleFor reconciles one rule's cron registration after any rules
// write — the base_backup.go loadJob shape: Add replaces by id, Remove is a
// no-op for unknown ids, so this is idempotent for every transition
// (create/enable/disable/delete/edit-expression).
func (e *Engine) reloadScheduleFor(rule *core.Record) {
	jobID := scheduleJobID(rule.Id)
	if rule.GetString("trigger") != "core:schedule" || !rule.GetBool("enabled") {
		e.app.Cron().Remove(jobID)
		return
	}
	cfg := decodeScheduleConfig(rule.Get("trigger_config"))
	trigger, _, _ := e.defs.Trigger("core:schedule")
	ruleID := rule.Id
	err := e.app.Cron().Add(jobID, cfg.Cron, func() {
		if !appIsLive(e.app) {
			return
		}
		e.enqueue(event{TriggerRef: "core:schedule", Trigger: trigger, Record: nil})
		_ = ruleID // rule targeting happens in dispatch via the trigger filter
	})
	if err != nil {
		e.app.Logger().Warn("automation: invalid schedule", "rule", rule.Id, "cron", cfg.Cron, "err", err)
		WriteRun(e.app, rule, nil, TriggerDef{}, RunOutcome{Err: "invalid schedule: " + cfg.Cron})
	}
}
```

**Also part of this task — three `engine.go` changes** (a scheduled firing must target ONE rule, not every `core:schedule` rule, since each has its own cadence):

1. Add `RuleID string` to the `event` struct (empty = all rules on the trigger, which stays the record-hook path's behavior).
2. In the cron fn above, set `RuleID: ruleID` on the enqueued event (replacing the `_ = ruleID` placeholder).
3. In `dispatch`, when `ev.RuleID != ""` filter the loaded rules to that id, and when `ev.Record == nil` skip the personal-owner filter entirely (the rule firing IS the owner's context — there is no record to scope by).

Add to `schedule_test.go`:

```go
func TestScheduledDispatchTargetsOneRule(t *testing.T) {
	app, eng, u := scheduleApp(t)
	a := scheduleRule(t, app, u.Id, "0 8 * * *", true)
	b := scheduleRule(t, app, u.Id, "0 9 * * *", true)

	trigger, _, _ := eng.defs.Trigger("core:schedule")
	eng.DispatchForTest(event{TriggerRef: "core:schedule", Trigger: trigger, RuleID: a.Id})

	runsA, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": a.Id})
	runsB, _ := app.FindRecordsByFilter("rule_runs", "rule = {:id}", "", 0, 0, map[string]any{"id": b.Id})
	if len(runsA) != 1 || len(runsB) != 0 {
		t.Fatalf("scheduled dispatch must hit exactly its rule: a=%d b=%d", len(runsA), len(runsB))
	}
	if !runsA[0].GetBool("matched") {
		t.Fatal("nil-record dispatch with empty conditions must match (personal owner filter skipped)")
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v`
Expected: PASS — including all earlier tasks' tests (the `event` struct change compiles everywhere). `gofmt -l automation/` prints nothing.

- [ ] **Step 5: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/schedule.go core/server/automation/schedule_test.go core/server/automation/engine.go core/server/automation/engine_test.go
git commit -m "feat(automation): cron-backed scheduled rules with per-rule reconcile"
```

---

### Task 9: Endpoints + wiring into coreserver

**Files:**
- Create: `tinycld/core/server/automation/endpoints.go`
- Create: `tinycld/core/server/automation/register.go`
- Modify: `tinycld/core/server/coreserver/server.go` (`registerSharedCore`, ~line 258 block end) + export the defs path
- Test: `tinycld/core/server/automation/endpoints_test.go`, plus the composition parity suite must stay green

**Interfaces:**
- `register.go` produces the package's front door:
  ```go
  type Options struct{ DefsPath string }
  func Register(app *pocketbase.PocketBase, opts Options) // LoadDefs; if empty defs → log info + return (inert);
                                                          // core native handlers (core:notify via notify.NotifyUser, in a goroutine);
                                                          // NewEngine + OnServe-bound Start (hooks need collections ready);
                                                          // registerEndpoints(app, engine)
  ```
  `core:notify` handler: params `title`/`body`/`url` → `notify.NotifyUser(app, notify.NotifyParams{UserID: req.OwnerID, Type: "automation", Package: "core", Title: ..., Body: ..., URL: ...})` wrapped in `go func()` with an `appIsLive` guard (I/O; invite.go precedent).
- `endpoints.go` produces (bound in `OnServe`, both `.BindFunc(requireAuth)`-style guarded — reuse the one-liner shape from `coreserver/invite.go`, defined locally):
  - `POST /api/automation/rules/{id}/run` — load rule by id; 404 unknown; caller must be the owner or org-admin (`role` owner/admin — local `isAdmin` helper matching `invite.go:53`); rule's trigger must be synthetic (`core:manual`/`core:schedule`) else 400 `"only manual/scheduled rules can be run directly"`; enqueue `event{TriggerRef: rule.GetString("trigger"), RuleID: rule.Id}` (works regardless of `enabled` — locked decision); respond `{"queued": true}`.
  - `POST /api/automation/dry-run` — body `{ "trigger": "mail:message-received", "conditions": {...} }` (BindBody); resolve trigger (400 unknown/synthetic); load the caller's recent records: `FindRecordsByFilter(trigger.Collection, ownerFilter, "-created", 50, 0)` where ownerFilter scopes to the caller via the auto-detected owner field (`ResolveOwners` machinery exposed as `ownerFilterFor(app, triggerRef, trigger) (filterExpr string, ok bool)`: returns `"<field> = {:caller}"` when a user-relation field resolves); when no owner field resolves: admins get the last 50 unscoped, non-admins get 403 (they could otherwise probe other users' data); evaluate conditions against each record; respond `{ "total": N, "matches": [{"id", "summary"}] }` where summary = `triggerSummary(record, trigger)`. **No actions execute.**
- `server.go` wiring: in `registerSharedCore`, after `search.Register(app)`:
  ```go
  automation.Register(app, automation.Options{DefsPath: filepath.Join(resolveServerDir(), "automation_defs.json")})
  ```
  (import `tinycld.org/core/automation`; `resolveServerDir` is already in coreserver — no export needed since the call site lives there.)

- [ ] **Step 1: Write the failing test**

```go
// tinycld/core/server/automation/endpoints_test.go
package automation

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Endpoint auth/validation logic is factored into plain funcs so it tests
// without HTTP scaffolding; the route bindings are thin.
func TestRunEndpointValidation(t *testing.T) {
	app, _, u := scheduleApp(t)
	manual := scheduleRule(t, app, u.Id, "0 8 * * *", true) // trigger core:schedule → synthetic, runnable
	col, _ := app.FindCollectionByNameOrId("rules")
	recordRule := core.NewRecord(col)
	recordRule.Set("name", "rec")
	recordRule.Set("scope", "personal")
	recordRule.Set("owner", u.Id)
	recordRule.Set("trigger", "tickets:ticket-created")
	recordRule.Set("enabled", true)
	if err := app.Save(recordRule); err != nil {
		t.Fatal(err)
	}

	if err := validateManualRun(manual, u); err != nil {
		t.Fatalf("owner running a synthetic-trigger rule must pass: %v", err)
	}
	if err := validateManualRun(recordRule, u); err == nil {
		t.Fatal("record-trigger rules must be rejected")
	}

	users, _ := app.FindCollectionByNameOrId("users")
	stranger := core.NewRecord(users)
	stranger.Set("email", "s@example.com")
	stranger.Set("username", "stranger1")
	stranger.Set("name", "S")
	stranger.Set("role", "member")
	stranger.SetPassword("0123456789")
	if err := app.Save(stranger); err != nil {
		t.Fatal(err)
	}
	if err := validateManualRun(manual, stranger); err == nil {
		t.Fatal("non-owner non-admin must be rejected")
	}
	stranger.Set("role", "admin")
	if err := validateManualRun(manual, stranger); err != nil {
		t.Fatalf("admin may run any rule: %v", err)
	}
}

func TestDryRunScoping(t *testing.T) {
	app, eng, u := engineApp(t) // tickets collection + trigger defs from Task 7's helper
	col, _ := app.FindCollectionByNameOrId("tickets")
	for _, title := range []string{"urgent: a", "routine b", "URGENT c"} {
		r := core.NewRecord(col)
		r.Set("title", title)
		r.Set("user", u.Id)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	ast := ConditionsAST{Match: "all", Groups: []ConditionGroup{{
		Match:      "any",
		Conditions: []Condition{{Field: "title", Op: "contains", Value: "urgent"}},
	}}}
	res, err := eng.dryRun(u, "tickets:ticket-created", ast)
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 3 || len(res.Matches) != 2 {
		t.Fatalf("dry run: total=%d matches=%d", res.Total, len(res.Matches))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -run 'TestRunEndpoint|TestDryRun' -v`
Expected: FAIL — `validateManualRun` / `dryRun` undefined.

- [ ] **Step 3: Implement endpoints.go + register.go, wire server.go**

`endpoints.go` — the testable core plus thin bindings:

```go
// tinycld/core/server/automation/endpoints.go
package automation

import (
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

func isAdmin(user *core.Record) bool {
	if user == nil {
		return false
	}
	role := user.GetString("role")
	return role == "owner" || role == "admin"
}

func validateManualRun(rule *core.Record, caller *core.Record) error {
	if caller == nil {
		return fmt.Errorf("authentication required")
	}
	if rule.GetString("owner") != caller.Id && !isAdmin(caller) {
		return fmt.Errorf("not your rule")
	}
	switch rule.GetString("trigger") {
	case "core:manual", "core:schedule":
		return nil
	default:
		return fmt.Errorf("only manual/scheduled rules can be run directly")
	}
}

type dryRunMatch struct {
	ID      string         `json:"id"`
	Summary map[string]any `json:"summary"`
}

type dryRunResult struct {
	Total   int           `json:"total"`
	Matches []dryRunMatch `json:"matches"`
}

// ownerFilterFor builds the caller-scoping filter for dry runs from the same
// owner-field detection the dispatcher uses. ok=false when the collection has
// no resolvable owner field.
func (e *Engine) ownerFilterFor(trigger TriggerDef) (string, bool) {
	col, err := e.app.FindCollectionByNameOrId(trigger.Collection)
	if err != nil {
		return "", false
	}
	usersCol, err := e.app.FindCachedCollectionByNameOrId("users")
	if err != nil {
		return "", false
	}
	candidates := autoOwnerFields
	if trigger.OwnerField != "" {
		candidates = []string{trigger.OwnerField}
	}
	for _, name := range candidates {
		if rel, ok := col.Fields.GetByName(name).(*core.RelationField); ok && rel.CollectionId == usersCol.Id {
			return name + " = {:caller}", true
		}
	}
	return "", false
}

func (e *Engine) dryRun(caller *core.Record, triggerRef string, ast ConditionsAST) (dryRunResult, error) {
	var out dryRunResult
	trigger, _, ok := e.defs.Trigger(triggerRef)
	if !ok || trigger.Synthetic != "" {
		return out, fmt.Errorf("unknown or synthetic trigger %q", triggerRef)
	}
	filter, scoped := e.ownerFilterFor(trigger)
	params := map[string]any{}
	if scoped {
		params["caller"] = caller.Id
	} else {
		if !isAdmin(caller) {
			return out, fmt.Errorf("this trigger's records cannot be scoped to you; ask an admin to test it")
		}
		filter = "id != ''"
	}
	records, err := e.app.FindRecordsByFilter(trigger.Collection, filter, "-created", 50, 0, params)
	if err != nil {
		return out, err
	}
	out.Total = len(records)
	for _, r := range records {
		if EvaluateConditions(ast, r) {
			out.Matches = append(out.Matches, dryRunMatch{ID: r.Id, Summary: triggerSummary(r, trigger)})
		}
	}
	return out, nil
}

func requireAuth(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}

func registerEndpoints(app core.App, engine *Engine) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/automation/rules/{id}/run", func(re *core.RequestEvent) error {
			rule, err := re.App.FindRecordById("rules", re.Request.PathValue("id"))
			if err != nil {
				return re.NotFoundError("rule not found", err)
			}
			if err := validateManualRun(rule, re.Auth); err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			trigger, _, _ := engine.defs.Trigger(rule.GetString("trigger"))
			engine.enqueue(event{TriggerRef: rule.GetString("trigger"), Trigger: trigger, RuleID: rule.Id})
			return re.JSON(http.StatusOK, map[string]any{"queued": true})
		}).BindFunc(requireAuth)

		se.Router.POST("/api/automation/dry-run", func(re *core.RequestEvent) error {
			var body struct {
				Trigger    string        `json:"trigger"`
				Conditions ConditionsAST `json:"conditions"`
			}
			if err := re.BindBody(&body); err != nil {
				return re.BadRequestError("invalid body", err)
			}
			res, err := engine.dryRun(re.Auth, body.Trigger, body.Conditions)
			if err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			return re.JSON(http.StatusOK, res)
		}).BindFunc(requireAuth)

		return se.Next()
	})
}
```

`register.go`:

```go
// tinycld/core/server/automation/register.go
package automation

import (
	"github.com/pocketbase/pocketbase"

	"tinycld.org/core/notify"
)

type Options struct {
	DefsPath string
}

// Register wires the rules engine into an app. With no materialized defs the
// engine is inert: no hooks bound, no endpoints — a workspace without
// automation packages pays one file-stat.
func Register(app *pocketbase.PocketBase, opts Options) {
	defs, err := LoadDefs(opts.DefsPath)
	if err != nil {
		app.Logger().Error("automation: defs unreadable, engine disabled", "err", err)
		return
	}
	if len(defs.Packages) == 0 {
		app.Logger().Info("automation: no definitions, engine inert")
		return
	}

	RegisterAction("core:notify", func(a core.App, req ActionRequest) error {
		go func() {
			if !appIsLive(a) {
				return
			}
			notify.NotifyUser(a, notify.NotifyParams{
				UserID:  req.OwnerID,
				Type:    "automation",
				Package: "core",
				Title:   req.Params["title"],
				Body:    req.Params["body"],
				URL:     req.Params["url"],
			})
		}()
		return nil
	})

	engine := NewEngine(app, defs)
	registerEndpoints(app, engine)
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		engine.Start()
		return se.Next()
	})
}
```

(Adjust the `core` import — `github.com/pocketbase/pocketbase/core` — as needed; `Start` binds record hooks which is legal at any point, but doing it in `OnServe` keeps boot order deterministic after migrations.)

`coreserver/server.go` — add to `registerSharedCore` after `search.Register(app)`:

```go
	automation.Register(app, automation.Options{
		DefsPath: filepath.Join(resolveServerDir(), "automation_defs.json"),
	})
```

with imports `"path/filepath"` (if absent) and `"tinycld.org/core/automation"`.

- [ ] **Step 4: Run the automation suite, then the full core suite (parity test included)**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go test ./automation/ -v && go test ./...`
Expected: all PASS — `registerSharedCore` additions appear in both compositions, so `composition_parity_test.go` needs no allowlist change. If it fails, the wiring landed in the wrong place — fix the placement, don't touch the allowlist.

- [ ] **Step 5: Boot smoke test via the app shell**

Run: `cd /Users/nas/code/tinycld/tinycld/server && go build ./... && go test -tags no_ui ./...`
Expected: builds + tests pass (the shell links coreserver; this catches import cycles or missing symbols at the composition root).

- [ ] **Step 6: Commit (tinycld repo)**

```bash
cd /Users/nas/code/tinycld/tinycld
git add core/server/automation/endpoints.go core/server/automation/register.go core/server/automation/endpoints_test.go core/server/coreserver/server.go
git commit -m "feat(automation): manual-run and dry-run endpoints, engine wired into coreserver"
```

---

### Task 10: Mail owner resolver (mail repo)

**Files:**
- Create: `mail/server/automation.go`
- Test: `mail/server/automation_test.go`
- Modify: `mail/server/register.go` (one call in `Register`)

**Interfaces:**
- Consumes: `automation.RegisterOwnerResolver` (Task 4) via the `tinycld.org/core/automation` import (mail's go.mod already depends on `tinycld.org/core` — verify the `replace` covers it; it does, same module).
- Produces: `registerAutomationResolver()` called from mail's `Register(app)`, installing an `OwnerResolver` for `"mail:message-received"` that maps a message record → the user ids who own it. **Resolution logic:** a `mail_messages` record reaches users through its mailbox/alias — find how mail's own code answers "which users does this message belong to" (start from `mail/server/register.go`'s message-arrival hooks and `notify_batcher.go`, which already notifies specific users about arriving mail — `bufferMailNotification` resolves recipients today; reuse exactly that resolution path, extracted into a shared helper if it isn't one already). The resolver must tolerate absent/malformed data by returning nil (org rules still work).
- This task intentionally specifies the *contract* and the *source to mirror* rather than verbatim lookup code: the mailbox-membership schema is mail's own, and `notify_batcher.go`'s existing recipient resolution is the authoritative implementation to reuse. If that resolution cannot be cleanly shared, STOP and report NEEDS_CONTEXT with what you found.

- [ ] **Step 1: Read the existing resolution**

Read `mail/server/notify_batcher.go` and the message-arrival hooks in `mail/server/register.go`. Identify the function that maps an arriving message to the user(s) to notify. Note its name and signature in your report.

- [ ] **Step 2: Write the failing test**

Model the test on how mail's existing server tests build message/mailbox fixtures — find a `*_test.go` in `mail/server/` that constructs mailbox + message records and mirror its setup. The test asserts:

```go
// mail/server/automation_test.go — shape (adapt fixture setup to mail's existing test helpers)
func TestMessageOwnerResolution(t *testing.T) {
	// build: user A with a mailbox/alias, user B unrelated, one message delivered to A's mailbox
	// resolver := messageOwnerResolver(app-under-test)
	// owners := resolver(app, messageRecord)
	// assert owners == []string{A.Id}
	// assert a message with a dangling/unknown alias resolves to nil (not an error)
}
```

If `mail/server` has no existing test constructing mailbox+message fixtures, report NEEDS_CONTEXT with what helpers do exist rather than inventing schema assumptions.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/nas/code/tinycld/mail/server && go test ./ -run TestMessageOwnerResolution -v`
Expected: FAIL — resolver undefined.

- [ ] **Step 4: Implement + wire**

`mail/server/automation.go`: `messageOwnerResolver` reusing the identified resolution helper; `registerAutomationResolver()` calling `automation.RegisterOwnerResolver("mail:message-received", ...)`. Add the `registerAutomationResolver()` call inside mail's `Register(app)` near its other hook registrations.

- [ ] **Step 5: Run mail's server suite**

Run: `cd /Users/nas/code/tinycld/mail/server && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit (mail repo)**

```bash
cd /Users/nas/code/tinycld/mail
git add server/automation.go server/automation_test.go server/register.go
git commit -m "feat: resolve message owners for personal automation rules"
```

---

## Phase 2 exit criteria

- `cd core/server && go test ./...` and `cd server && go test -tags no_ui ./...` and `cd mail/server && go test ./...` all pass; `gofmt -l` clean on new files.
- With the Phase-1 `automation_defs.json` present, the engine binds hooks for `mail_messages` create, `core:schedule` rules sync to cron, and `/api/automation/rules/{id}/run` + `/api/automation/dry-run` respond.
- A personal rule on `tickets`-style collections end-to-end: record saved → conditions evaluated → action applied → `rule_runs` row (verified by the Task 7 suite against real migrations — this also discharges Phase 1's deferred smoke test of the `rule_runs` dot-traversal access rules, whose readability should be asserted in the Task 7 review if not covered).
- The member client is untouched (no TS changes in this phase); `pnpm exec tinycld-pkg check` still passes in `tinycld/`.

**Next (Phase 3 — UI):** RulesPanel / RuleBuilder / RunHistory / dry-run preview, the three mount points, the resolved-field catalog for the builder (Go-resolved, served or generated), dynamic-package catalog handling (see Phase 1 handoff), help topics, e2e specs.
