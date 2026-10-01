# Auto-upgrade 1 (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner setting, on by default, that makes a single-tenant install upgrade its packages itself in a maintenance window, with a neutral seam a composing server can replace.

**Architecture:** A new Go package `core/server/autoupgrade` holds the `Delegate` seam and the window type. `coreserver` holds the local scheduler (the default delegate on a build that can rebuild itself), the pure target selection, the notification gate and the boot reconcile. The flag, the window and the pause/blocked rows are PocketBase data, written by the UI through pbtsdb; a `system_settings` hook calls the delegate. The only new endpoint is a read-only status.

**Tech Stack:** Go (PocketBase), PocketBase JS migrations, React Native + Expo, pbtsdb / TanStack DB, React Hook Form + zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-auto-upgrade-1-core-design.md`

## Global Constraints

- Repo: `tinycld` (`~/code/tinycld/tinycld`). Go module `tinycld.org/core` at `core/server/`. Branch: `feat/auto-upgrade-core`.
- No hosting, router, tenant or supervisor names in code, comments, copy or help. Write "a composing server" in comments where needed.
- Setting keys, exactly: `autoupgrade.enabled`, `autoupgrade.window`. Default window `02:00-05:00`, server time.
- `autoupgrade.enabled` is seeded `true` by the migration. No fallback for a missing row.
- Only the owner (or a PB superuser) may write `autoupgrade.*` settings and `autoupgrade_state` rows.
- Notification gate: send on a new row or a changed fingerprint; one reminder when `last_notified` is 7 days old; never otherwise.
- Recipients: users with `role` `owner` or `admin` and `disabled != true`.
- A `rolled_back` auto job blocks its target set. A `failed` auto job (the live app was never changed) is not blocked; the next window tries again.
- The scheduler does nothing on a `go run` build (`isDevelopment()`) or when `TINYCLD_AUTOUPGRADE_DISABLED=1`. The switch still works.
- Register every hook in `RegisterSharedCore` (both compositions bind it, so `hosting/tenantboot/composition_parity_test.go` does not change). The only host-only line is `autoupgrade.SetDelegate(...)` in `Register`'s tail, which binds no hook.
- Biome: 4-space indent, single quotes, no semicolons, no `any`, no `biome-ignore`. No raw hex colors. No `console.*`.
- JSX: no ternaries, `.map()` or calculations in the return; conditional parts take `isVisible` and return `null`.
- Run `pnpm exec tinycld-pkg check` from `tinycld/` before each commit that touches TS; run `go test ./...` from `tinycld/core/server` before each commit that touches Go.

## File map

| File | Responsibility |
|---|---|
| `core/server/pb_migrations/2060000000_create_autoupgrade.js` | `autoupgrade_state` collection, `pkg_install_log.trigger` + `.changes`, seed `autoupgrade.enabled = true` |
| `core/server/autoupgrade/autoupgrade.go` | `Delegate`, `Starter`, `Status`, `SetDelegate`, `Current`, `Unavailable`, key constants |
| `core/server/autoupgrade/window.go` | `Window`, `ParseWindow`, `Contains`, `NextStart` |
| `core/server/installjob/installjob.go` | add `Job.Trigger` |
| `core/server/coreserver/autoupgrade_target.go` | `planUpgrade`, `newestTargets`, `withoutMajors`, `fingerprint`, `formatViolations` |
| `core/server/coreserver/autoupgrade_store.go` | `notifyDue`, `recordPause`, `clearPause`, `recordBlocked`, `remindBlocked`, `blockedFingerprints` |
| `core/server/coreserver/autoupgrade_notify.go` | recipients + the two email bodies |
| `core/server/coreserver/autoupgrade_local.go` | `localScheduler` (the default delegate) |
| `core/server/coreserver/autoupgrade_reconcile.go` | boot: turn a rolled-back auto job into a `blocked` row |
| `core/server/coreserver/autoupgrade_register.go` | `RegisterAutoUpgrade`: write guard, policy hook, status route, start |
| `core/server/coreserver/pkg_version_change.go` | extract `beginVersionChange` |
| `core/server/coreserver/pkg_install.go` | `createInstallLog` writes `trigger` + `changes` |
| `core/server/coreserver/server.go` | wire `RegisterAutoUpgrade`, `SetDelegate`, boot reconcile |
| `core/lib/pocketbase.ts` | `autoupgrade_state` collection |
| `core/components/setup/auto-upgrade-logic.ts` | pure: keys, window schema, status line, target text |
| `core/components/setup/use-auto-upgrade.ts` | hook: settings, rows, status, mutations |
| `core/components/setup/AutoUpgradeSection.tsx` | Packages page section |
| `core/components/setup/PackageManager.tsx` | mount the section |
| `core/components/setup/wizard/steps/AppsStep.tsx` | wizard checkbox |
| `core/help/package-versions.md` | help section |
| `playwright.config.ts`, `.github/workflows/smoke-test-image.yml` | `TINYCLD_AUTOUPGRADE_DISABLED=1` |
| `tests/e2e/auto-upgrade.spec.ts` | Packages page e2e |

---

### Task 1: Migration — state collection, install-log fields, default row

**Files:**
- Create: `core/server/pb_migrations/2060000000_create_autoupgrade.js`
- Test: `core/server/coreserver/autoupgrade_migration_test.go`

**Interfaces:**
- Produces: collection `autoupgrade_state` (id `pbc_autoupgrade_state`) with fields `kind` (select `pause`/`blocked`), `fingerprint` (text), `target` (json), `reason` (text), `first_seen` (date), `last_notified` (date), `cleared` (bool), `install_log` (relation → `pbc_pkg_ilog_01`, optional). `pkg_install_log` gains `trigger` (select `manual`/`auto`) and `changes` (json). `system_settings` row `autoupgrade.enabled = "true"`.

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import "testing"

func TestAutoUpgradeMigration(t *testing.T) {
	app := adminConsoleTestApp(t)

	col, err := app.FindCollectionByNameOrId("autoupgrade_state")
	if err != nil {
		t.Fatalf("autoupgrade_state missing: %v", err)
	}
	for _, f := range []string{"kind", "fingerprint", "target", "reason", "first_seen", "last_notified", "cleared", "install_log"} {
		if col.Fields.GetByName(f) == nil {
			t.Errorf("autoupgrade_state.%s missing", f)
		}
	}
	const owner = `@request.auth.id != "" && @request.auth.disabled != true && @request.auth.role = "owner"`
	if col.ListRule == nil || *col.ListRule != owner {
		t.Errorf("listRule = %v, want owner-only", col.ListRule)
	}
	if col.UpdateRule == nil || *col.UpdateRule != owner {
		t.Errorf("updateRule = %v, want owner-only", col.UpdateRule)
	}
	if col.CreateRule != nil || col.DeleteRule != nil {
		t.Error("create/delete must be server-only (nil rule)")
	}

	log, err := app.FindCollectionByNameOrId("pkg_install_log")
	if err != nil {
		t.Fatal(err)
	}
	if log.Fields.GetByName("trigger") == nil || log.Fields.GetByName("changes") == nil {
		t.Error("pkg_install_log.trigger / .changes missing")
	}

	row, err := app.FindFirstRecordByFilter("system_settings", "key = 'autoupgrade.enabled'")
	if err != nil {
		t.Fatalf("seed row missing: %v", err)
	}
	if row.GetString("value") != "true" {
		t.Errorf("autoupgrade.enabled = %q, want \"true\"", row.GetString("value"))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run TestAutoUpgradeMigration -v`
Expected: FAIL with `autoupgrade_state missing`.

- [ ] **Step 3: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />
// Automatic package upgrades. autoupgrade_state holds what the scheduler must
// remember across restarts: at most one conflict `pause`, and one `blocked` row
// per version set that was rolled back. Rows are written by the server only;
// the owner may set `cleared` to let a blocked set be tried again.
//
// pkg_install_log gains `trigger` and `changes` so a boot after a rollback can
// tell an automatic upgrade from a manual one and know which set it tried —
// the rollback restores the pre-upgrade DB, and the log row is the only record
// that survives it (it is written before the backup is taken).
//
// The setting is on by default: the row is seeded here, so every reader can
// treat a missing row as an error rather than guess a default.
const OWNER =
    '@request.auth.id != "" && @request.auth.disabled != true && @request.auth.role = "owner"'

migrate(
    app => {
        const state = new Collection({
            id: 'pbc_autoupgrade_state',
            name: 'autoupgrade_state',
            type: 'base',
            system: false,
            listRule: OWNER,
            viewRule: OWNER,
            createRule: null,
            updateRule: OWNER,
            deleteRule: null,
            fields: [
                { id: 'aus_kind', name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['pause', 'blocked'] },
                { id: 'aus_fingerprint', name: 'fingerprint', type: 'text', required: true, max: 64 },
                { id: 'aus_target', name: 'target', type: 'json', maxSize: 20000 },
                { id: 'aus_reason', name: 'reason', type: 'text', max: 5000 },
                { id: 'aus_first_seen', name: 'first_seen', type: 'date' },
                { id: 'aus_last_notified', name: 'last_notified', type: 'date' },
                { id: 'aus_cleared', name: 'cleared', type: 'bool' },
                {
                    id: 'aus_install_log',
                    name: 'install_log',
                    type: 'relation',
                    required: false,
                    collectionId: 'pbc_pkg_ilog_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                { id: 'aus_created', name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
                { id: 'aus_updated', name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            ],
            indexes: [
                'CREATE INDEX `idx_autoupgrade_state_kind` ON `autoupgrade_state` (`kind`)',
            ],
        })
        app.save(state)

        const log = app.findCollectionByNameOrId('pkg_install_log')
        log.fields.add(
            new Field({ id: 'pil_trigger', name: 'trigger', type: 'select', maxSelect: 1, values: ['manual', 'auto'] })
        )
        log.fields.add(new Field({ id: 'pil_changes', name: 'changes', type: 'json', maxSize: 20000 }))
        app.save(log)

        const settings = app.findCollectionByNameOrId('system_settings')
        const row = new Record(settings)
        row.set('key', 'autoupgrade.enabled')
        row.set('value', 'true')
        row.set('is_secret', false)
        app.save(row)
    },
    app => {
        const settings = app.findCollectionByNameOrId('system_settings')
        const rows = app.findRecordsByFilter(settings, "key ~ 'autoupgrade.%'", '', 0, 0)
        for (const r of rows) {
            app.delete(r)
        }
        const log = app.findCollectionByNameOrId('pkg_install_log')
        log.fields.removeById('pil_trigger')
        log.fields.removeById('pil_changes')
        app.save(log)
        app.delete(app.findCollectionByNameOrId('autoupgrade_state'))
    }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run TestAutoUpgradeMigration -v`
Expected: PASS.

- [ ] **Step 5: Regenerate types and commit**

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
git add core/server/pb_migrations/2060000000_create_autoupgrade.js core/server/coreserver/autoupgrade_migration_test.go
git commit -m "feat(core): autoupgrade_state collection and default-on setting"
```

(`core/types/pbSchema.ts` is generated and gitignored; do not add it.)

---

### Task 2: `autoupgrade` package — seam and window

**Files:**
- Create: `core/server/autoupgrade/autoupgrade.go`, `core/server/autoupgrade/window.go`
- Test: `core/server/autoupgrade/window_test.go`, `core/server/autoupgrade/autoupgrade_test.go`

**Interfaces:**
- Produces:
  - `const KeyEnabled = "autoupgrade.enabled"`, `KeyWindow = "autoupgrade.window"`, `DefaultWindow = "02:00-05:00"`
  - `type Status struct { Available bool; Reason string; LastRun time.Time; LastResult string; NextCheck time.Time }` (JSON: `available`, `reason,omitempty`, `lastRun`, `lastResult`, `nextCheck`)
  - `type Delegate interface { PolicyChanged(ctx context.Context, enabled bool) error; Status(ctx context.Context) (Status, error) }`
  - `type Starter interface { Start(ctx context.Context) }`
  - `func SetDelegate(d Delegate)`, `func Current() Delegate` (nil when none), `func Unavailable(reason string) Status`
  - `type Window struct{ Start, End time.Duration }`, `func ParseWindow(s string) (Window, error)`, `func (w Window) Contains(t time.Time) bool`, `func (w Window) NextStart(after time.Time) time.Time`

- [ ] **Step 1: Write the failing tests**

`window_test.go`:

```go
package autoupgrade

import (
	"testing"
	"time"
)

func at(h, m int) time.Time { return time.Date(2026, 10, 1, h, m, 0, 0, time.Local) }

func TestParseWindow(t *testing.T) {
	w, err := ParseWindow("02:00-05:30")
	if err != nil {
		t.Fatal(err)
	}
	if w.Start != 2*time.Hour || w.End != 5*time.Hour+30*time.Minute {
		t.Fatalf("got %+v", w)
	}
	for _, bad := range []string{"", "2-5", "24:00-01:00", "02:00-02:00", "02:00_05:00", "02:60-03:00"} {
		if _, err := ParseWindow(bad); err == nil {
			t.Errorf("ParseWindow(%q) accepted", bad)
		}
	}
}

func TestWindowContains(t *testing.T) {
	day, _ := ParseWindow("02:00-05:00")
	cases := map[time.Time]bool{at(1, 59): false, at(2, 0): true, at(4, 59): true, at(5, 0): false}
	for tm, want := range cases {
		if got := day.Contains(tm); got != want {
			t.Errorf("day.Contains(%s) = %v", tm.Format("15:04"), got)
		}
	}
	night, _ := ParseWindow("23:00-01:00")
	for tm, want := range map[time.Time]bool{at(22, 59): false, at(23, 30): true, at(0, 30): true, at(1, 0): false} {
		if got := night.Contains(tm); got != want {
			t.Errorf("night.Contains(%s) = %v", tm.Format("15:04"), got)
		}
	}
}

func TestWindowNextStart(t *testing.T) {
	w, _ := ParseWindow("02:00-05:00")
	if got := w.NextStart(at(1, 0)); !got.Equal(at(2, 0)) {
		t.Errorf("before window: %s", got)
	}
	if got := w.NextStart(at(3, 0)); !got.Equal(at(2, 0).Add(24 * time.Hour)) {
		t.Errorf("inside window: %s", got)
	}
}
```

`autoupgrade_test.go`:

```go
package autoupgrade

import (
	"context"
	"testing"
)

type fake struct{}

func (fake) PolicyChanged(context.Context, bool) error   { return nil }
func (fake) Status(context.Context) (Status, error)      { return Status{Available: true}, nil }

func TestSetDelegate(t *testing.T) {
	t.Cleanup(func() { SetDelegate(nil) })
	if Current() != nil {
		t.Fatal("expected no delegate")
	}
	SetDelegate(fake{})
	if Current() == nil {
		t.Fatal("delegate not installed")
	}
}

func TestUnavailable(t *testing.T) {
	s := Unavailable("no toolchain")
	if s.Available || s.Reason != "no toolchain" {
		t.Fatalf("got %+v", s)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./autoupgrade -v`
Expected: FAIL (package does not compile: undefined `ParseWindow`, `SetDelegate`).

- [ ] **Step 3: Write the implementation**

`autoupgrade.go`:

```go
// Package autoupgrade is the seam through which a deployment decides how its
// packages are upgraded automatically. Core stores the owner's choice and shows
// the result; the Delegate does the work. A deployment that can rebuild itself
// installs a local scheduler; a composing server that owns this app's lifecycle
// installs its own Delegate and controls the cadence. Core does not know which.
//
// Like syscfg, it imports nothing from coreserver, so any package can read it.
package autoupgrade

import (
	"context"
	"sync"
	"time"
)

const (
	KeyEnabled    = "autoupgrade.enabled"
	KeyWindow     = "autoupgrade.window"
	DefaultWindow = "02:00-05:00"
)

// Status is what the Packages page shows. The pause and the blocked sets are
// rows the page reads itself; this carries only computed values.
type Status struct {
	Available  bool      `json:"available"`
	Reason     string    `json:"reason,omitempty"`
	LastRun    time.Time `json:"lastRun"`
	LastResult string    `json:"lastResult"`
	NextCheck  time.Time `json:"nextCheck"`
}

type Delegate interface {
	// PolicyChanged is called when the owner changes the flag, and once at boot.
	PolicyChanged(ctx context.Context, enabled bool) error
	Status(ctx context.Context) (Status, error)
}

// Starter is implemented by a Delegate that runs its own loop.
type Starter interface {
	Start(ctx context.Context)
}

var (
	mu      sync.RWMutex
	current Delegate
)

func SetDelegate(d Delegate) {
	mu.Lock()
	defer mu.Unlock()
	current = d
}

// Current returns the installed Delegate, or nil when this build has none.
func Current() Delegate {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

func Unavailable(reason string) Status {
	return Status{Available: false, Reason: reason}
}
```

`window.go`:

```go
package autoupgrade

import (
	"fmt"
	"regexp"
	"strconv"
	"time"
)

var windowPattern = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$`)

// Window is a daily span in server-local time. End before Start means the
// span crosses midnight.
type Window struct {
	Start, End time.Duration
}

func ParseWindow(s string) (Window, error) {
	m := windowPattern.FindStringSubmatch(s)
	if m == nil {
		return Window{}, fmt.Errorf("window %q: want HH:MM-HH:MM", s)
	}
	clock := func(h, mm string) time.Duration {
		hi, _ := strconv.Atoi(h)
		mi, _ := strconv.Atoi(mm)
		return time.Duration(hi)*time.Hour + time.Duration(mi)*time.Minute
	}
	w := Window{Start: clock(m[1], m[2]), End: clock(m[3], m[4])}
	if w.Start == w.End {
		return Window{}, fmt.Errorf("window %q: start and end are the same", s)
	}
	return w, nil
}

func sinceMidnight(t time.Time) time.Duration {
	h, m, s := t.Clock()
	return time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second
}

func (w Window) Contains(t time.Time) bool {
	d := sinceMidnight(t)
	if w.Start < w.End {
		return d >= w.Start && d < w.End
	}
	return d >= w.Start || d < w.End
}

// NextStart is the first window start strictly after `after`.
func (w Window) NextStart(after time.Time) time.Time {
	y, mo, d := after.Date()
	start := time.Date(y, mo, d, 0, 0, 0, 0, after.Location()).Add(w.Start)
	if !start.After(after) {
		start = start.Add(24 * time.Hour)
	}
	return start
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./autoupgrade -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/autoupgrade
git commit -m "feat(core): autoupgrade delegate seam and maintenance window"
```

---

### Task 3: Target selection and fingerprint

**Files:**
- Create: `core/server/coreserver/autoupgrade_target.go`
- Test: `core/server/coreserver/autoupgrade_target_test.go`

**Interfaces:**
- Consumes: `VersionInfo` (`pkg_versions.go`), `compatViolation` (= `pkgbuild.Violation`: `Package`, `Requires`, `Range`, `Found`).
- Produces:
  - `type solveFunc func(changes map[string]string) ([]compatViolation, error)`
  - `type upgradePlan struct { Target map[string]string; Wanted map[string]string; Violations []compatViolation; DroppedMajors bool }` — `Target` is nil when paused; `Wanted` is the full newest set (for the pause row).
  - `func planUpgrade(infos []VersionInfo, solve solveFunc) (upgradePlan, error)`
  - `func newestTargets(infos []VersionInfo) map[string]string`
  - `func withoutMajors(target, current map[string]string) map[string]string`
  - `func fingerprint(target map[string]string, violations []compatViolation) string` (16 hex chars)
  - `func formatViolations(v []compatViolation) string`
  - `func formatTarget(target map[string]string) string` (`"core 0.5.4, mail 0.6.0"`, sorted)

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"errors"
	"testing"
)

func infos(rows ...[3]string) []VersionInfo {
	out := make([]VersionInfo, 0, len(rows))
	for _, r := range rows {
		out = append(out, VersionInfo{Slug: r[0], Current: r[1], Latest: r[2], HasUpdate: r[1] != r[2]})
	}
	return out
}

func TestPlanUpgradeTakesNewestIncludingMajors(t *testing.T) {
	in := infos([3]string{"mail", "0.5.0", "1.0.0"}, [3]string{"core", "0.5.4", "0.5.4"})
	p, err := planUpgrade(in, func(map[string]string) ([]compatViolation, error) { return nil, nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Target) != 1 || p.Target["mail"] != "1.0.0" || p.DroppedMajors {
		t.Fatalf("got %+v", p)
	}
}

func TestPlanUpgradeDropsMajorsOnConflict(t *testing.T) {
	in := infos([3]string{"mail", "0.5.0", "1.0.0"}, [3]string{"drive", "0.3.0", "0.3.2"})
	solve := func(c map[string]string) ([]compatViolation, error) {
		if c["mail"] == "1.0.0" {
			return []compatViolation{{Package: "mail", Requires: "@tinycld/core", Range: ">=0.6", Found: "0.5.4"}}, nil
		}
		return nil, nil
	}
	p, err := planUpgrade(in, solve)
	if err != nil {
		t.Fatal(err)
	}
	if !p.DroppedMajors || p.Target["drive"] != "0.3.2" || p.Target["mail"] != "" {
		t.Fatalf("got %+v", p)
	}
}

func TestPlanUpgradePausesWhenNothingResolves(t *testing.T) {
	in := infos([3]string{"mail", "0.5.0", "0.5.1"})
	v := []compatViolation{{Package: "mail", Requires: "@tinycld/core", Range: ">=0.6", Found: "0.5.4"}}
	p, err := planUpgrade(in, func(map[string]string) ([]compatViolation, error) { return v, nil })
	if err != nil {
		t.Fatal(err)
	}
	if p.Target != nil || len(p.Violations) != 1 || p.Wanted["mail"] != "0.5.1" {
		t.Fatalf("got %+v", p)
	}
}

func TestPlanUpgradeNoUpdates(t *testing.T) {
	p, err := planUpgrade(infos([3]string{"mail", "0.5.0", "0.5.0"}), nil)
	if err != nil || p.Target != nil || p.Violations != nil {
		t.Fatalf("got %+v, %v", p, err)
	}
}

func TestPlanUpgradeSolveError(t *testing.T) {
	in := infos([3]string{"mail", "0.5.0", "0.5.1"})
	if _, err := planUpgrade(in, func(map[string]string) ([]compatViolation, error) { return nil, errors.New("db") }); err == nil {
		t.Fatal("want error")
	}
}

func TestFingerprintIsStableAndOrderFree(t *testing.T) {
	a := fingerprint(map[string]string{"mail": "1.0.0", "core": "0.6.0"}, nil)
	b := fingerprint(map[string]string{"core": "0.6.0", "mail": "1.0.0"}, nil)
	c := fingerprint(map[string]string{"core": "0.6.0", "mail": "1.0.1"}, nil)
	if a != b || a == c || len(a) != 16 {
		t.Fatalf("a=%s b=%s c=%s", a, b, c)
	}
	v := []compatViolation{{Package: "mail", Requires: "@tinycld/core", Range: ">=0.6", Found: "0.5.4"}}
	if fingerprint(map[string]string{"mail": "1.0.0"}, v) == fingerprint(map[string]string{"mail": "1.0.0"}, nil) {
		t.Fatal("violations must change the fingerprint")
	}
}

func TestFormatViolations(t *testing.T) {
	got := formatViolations([]compatViolation{{Package: "mail", Requires: "@tinycld/core", Range: ">=0.6 <0.7", Found: "0.5.4"}})
	want := "mail needs @tinycld/core >=0.6 <0.7 (found 0.5.4)"
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestFormatTarget(t *testing.T) {
	if got := formatTarget(map[string]string{"mail": "0.6.0", "core": "0.5.4"}); got != "core 0.5.4, mail 0.6.0" {
		t.Fatalf("got %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestPlanUpgrade|TestFingerprint|TestFormat' -v`
Expected: FAIL with `undefined: planUpgrade`.

- [ ] **Step 3: Write the implementation**

```go
package coreserver

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
)

type solveFunc func(changes map[string]string) ([]compatViolation, error)

// upgradePlan is one scheduler decision. Target nil + Violations set means the
// newest set cannot resolve even without majors: the run pauses.
type upgradePlan struct {
	Target        map[string]string
	Wanted        map[string]string
	Violations    []compatViolation
	DroppedMajors bool
}

func newestTargets(infos []VersionInfo) map[string]string {
	out := map[string]string{}
	for _, in := range infos {
		if in.HasUpdate && in.Latest != "" {
			out[in.Slug] = in.Latest
		}
	}
	return out
}

func isMajorBump(from, to string) bool {
	f, err1 := semver.NewVersion(from)
	t, err2 := semver.NewVersion(to)
	if err1 != nil || err2 != nil {
		return true // unknown shape: treat as the risky case
	}
	return t.Major() != f.Major()
}

func withoutMajors(target, current map[string]string) map[string]string {
	out := map[string]string{}
	for slug, to := range target {
		if !isMajorBump(current[slug], to) {
			out[slug] = to
		}
	}
	return out
}

func planUpgrade(infos []VersionInfo, solve solveFunc) (upgradePlan, error) {
	wanted := newestTargets(infos)
	if len(wanted) == 0 {
		return upgradePlan{}, nil
	}
	violations, err := solve(wanted)
	if err != nil {
		return upgradePlan{}, err
	}
	if len(violations) == 0 {
		return upgradePlan{Target: wanted, Wanted: wanted}, nil
	}

	current := map[string]string{}
	for _, in := range infos {
		current[in.Slug] = in.Current
	}
	minor := withoutMajors(wanted, current)
	if len(minor) > 0 && len(minor) < len(wanted) {
		v2, err := solve(minor)
		if err != nil {
			return upgradePlan{}, err
		}
		if len(v2) == 0 {
			return upgradePlan{Target: minor, Wanted: wanted, DroppedMajors: true}, nil
		}
	}
	return upgradePlan{Wanted: wanted, Violations: violations}, nil
}

func sortedPairs(target map[string]string) []string {
	pairs := make([]string, 0, len(target))
	for slug, v := range target {
		pairs = append(pairs, slug+"@"+v)
	}
	sort.Strings(pairs)
	return pairs
}

func fingerprint(target map[string]string, violations []compatViolation) string {
	parts := sortedPairs(target)
	vs := make([]string, 0, len(violations))
	for _, v := range violations {
		vs = append(vs, v.Package+"|"+v.Requires+"|"+v.Range+"|"+v.Found)
	}
	sort.Strings(vs)
	sum := sha256.Sum256([]byte(strings.Join(parts, ",") + "#" + strings.Join(vs, ",")))
	return hex.EncodeToString(sum[:8])
}

func formatViolations(v []compatViolation) string {
	lines := make([]string, 0, len(v))
	for _, x := range v {
		lines = append(lines, fmt.Sprintf("%s needs %s %s (found %s)", x.Package, x.Requires, x.Range, x.Found))
	}
	return strings.Join(lines, "\n")
}

func formatTarget(target map[string]string) string {
	pairs := sortedPairs(target)
	for i, p := range pairs {
		pairs[i] = strings.Replace(p, "@", " ", 1)
	}
	return strings.Join(pairs, ", ")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestPlanUpgrade|TestFingerprint|TestFormat' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/coreserver/autoupgrade_target.go core/server/coreserver/autoupgrade_target_test.go
git commit -m "feat(core): auto-upgrade target selection and fingerprint"
```

---

### Task 4: State rows, notification gate and emails

**Files:**
- Create: `core/server/coreserver/autoupgrade_store.go`, `core/server/coreserver/autoupgrade_notify.go`
- Test: `core/server/coreserver/autoupgrade_store_test.go`

**Interfaces:**
- Consumes: `autoupgrade_state` (Task 1), `fingerprint`, `formatTarget` (Task 3), `mailer.RenderTransactionalEmail`, `send` (`invite_lifecycle.go`).
- Produces:
  - `const reminderEvery = 7 * 24 * time.Hour`
  - `func notifyDue(lastNotified time.Time, sameFingerprint bool, now time.Time) bool`
  - `type mailFn func(toName, toEmail, subject, htmlBody, textBody string)`
  - `type notice struct { Subject, BodyText string }`
  - `func recordPause(app core.App, fp string, wanted map[string]string, reason string, now time.Time, notify func(notice)) error`
  - `func clearPause(app core.App) error`
  - `func recordBlocked(app core.App, fp string, target map[string]string, reason, installLogID string, now time.Time, notify func(notice)) error`
  - `func remindBlocked(app core.App, now time.Time, notify func(notice)) error`
  - `func blockedFingerprints(app core.App) (map[string]bool, error)`
  - `func notifyAdmins(app core.App, send mailFn, n notice)`
  - `func pauseNotice(wanted map[string]string, reason string, reminder bool) notice`, `func blockedNotice(target map[string]string, reason string, reminder bool) notice`

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestNotifyDue(t *testing.T) {
	now := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	if !notifyDue(now, false, now) {
		t.Error("a changed fingerprint must notify")
	}
	if notifyDue(now.Add(-6*24*time.Hour), true, now) {
		t.Error("same fingerprint within 7 days must not notify")
	}
	if !notifyDue(now.Add(-7*24*time.Hour), true, now) {
		t.Error("7-day reminder must notify")
	}
}

func TestRecordPauseGate(t *testing.T) {
	app := adminConsoleTestApp(t)
	var sent []notice
	notify := func(n notice) { sent = append(sent, n) }
	t0 := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	wanted := map[string]string{"mail": "0.6.0"}

	mustNil(t, recordPause(app, "fp1", wanted, "mail needs x", t0, notify))
	mustNil(t, recordPause(app, "fp1", wanted, "mail needs x", t0.Add(time.Hour), notify))
	if len(sent) != 1 {
		t.Fatalf("same pause sent %d emails, want 1", len(sent))
	}
	mustNil(t, recordPause(app, "fp2", wanted, "mail needs y", t0.Add(2*time.Hour), notify))
	if len(sent) != 2 {
		t.Fatalf("changed fingerprint: %d emails, want 2", len(sent))
	}
	mustNil(t, recordPause(app, "fp2", wanted, "mail needs y", t0.Add(2*time.Hour+7*24*time.Hour), notify))
	if len(sent) != 3 {
		t.Fatalf("reminder: %d emails, want 3", len(sent))
	}
	rows, _ := app.FindRecordsByFilter("autoupgrade_state", "kind = 'pause'", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("%d pause rows, want 1", len(rows))
	}

	mustNil(t, clearPause(app))
	mustNil(t, recordPause(app, "fp2", wanted, "mail needs y", t0.Add(8*24*time.Hour), notify))
	if len(sent) != 4 {
		t.Fatalf("pause after clear: %d emails, want 4", len(sent))
	}
}

func TestRecordBlockedOncePerInstallLog(t *testing.T) {
	app := adminConsoleTestApp(t)
	logID := newInstallLogRow(t, app)
	var sent []notice
	notify := func(n notice) { sent = append(sent, n) }
	t0 := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	target := map[string]string{"mail": "0.6.0"}

	mustNil(t, recordBlocked(app, "fpA", target, "rolled back", logID, t0, notify))
	mustNil(t, recordBlocked(app, "fpA", target, "rolled back", logID, t0, notify))
	if len(sent) != 1 {
		t.Fatalf("%d emails, want 1", len(sent))
	}
	fps, err := blockedFingerprints(app)
	mustNil(t, err)
	if !fps["fpA"] {
		t.Fatal("fpA not blocked")
	}

	mustNil(t, remindBlocked(app, t0.Add(24*time.Hour), notify))
	if len(sent) != 1 {
		t.Fatal("reminder sent before 7 days")
	}
	mustNil(t, remindBlocked(app, t0.Add(7*24*time.Hour), notify))
	if len(sent) != 2 {
		t.Fatal("7-day reminder not sent")
	}

	row, _ := app.FindFirstRecordByFilter("autoupgrade_state", "kind = 'blocked'")
	row.Set("cleared", true)
	mustNil(t, app.Save(row))
	fps, _ = blockedFingerprints(app)
	if fps["fpA"] {
		t.Fatal("a cleared set must not be blocked")
	}
}

func TestNotifyAdminsRecipients(t *testing.T) {
	app := adminConsoleTestApp(t)
	newUser(t, app, "owner@x.test", "owner", false)
	newUser(t, app, "admin@x.test", "admin", false)
	newUser(t, app, "member@x.test", "member", false)
	newUser(t, app, "gone@x.test", "admin", true)
	var to []string
	notifyAdmins(app, func(_, email, _, _, _ string) { to = append(to, email) }, pauseNotice(map[string]string{"mail": "0.6.0"}, "r", false))
	if len(to) != 2 {
		t.Fatalf("sent to %v, want owner + admin", to)
	}
}

func mustNil(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func newInstallLogRow(t *testing.T, app core.App) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("pkg_install_log")
	mustNil(t, err)
	r := core.NewRecord(col)
	r.Set("action", "version_change")
	r.Set("pkg_slug", "mail")
	r.Set("status", "rolled_back")
	r.Set("trigger", "auto")
	r.Set("changes", []map[string]string{{"slug": "mail", "targetVersion": "0.6.0"}})
	mustNil(t, app.Save(r))
	return r.Id
}

func newUser(t *testing.T, app core.App, email, role string, disabled bool) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	mustNil(t, err)
	u := core.NewRecord(col)
	u.SetEmail(email)
	u.SetPassword("Password1234!")
	u.SetVerified(true)
	u.Set("name", role)
	u.Set("role", role)
	u.Set("disabled", disabled)
	mustNil(t, app.Save(u))
	return u
}
```

If `users` requires more fields in the migrated schema (for example `username`), set them in `newUser` with the values the save error names.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestNotifyDue|TestRecordPause|TestRecordBlocked|TestNotifyAdmins' -v`
Expected: FAIL with `undefined: notifyDue`.

- [ ] **Step 3: Write `autoupgrade_store.go`**

```go
package coreserver

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const reminderEvery = 7 * 24 * time.Hour

// notice is one email, before it is addressed. Kept apart from the send so the
// gate can be tested by counting notices.
type notice struct {
	Subject  string
	BodyText string
}

func notifyDue(lastNotified time.Time, sameFingerprint bool, now time.Time) bool {
	return !sameFingerprint || now.Sub(lastNotified) >= reminderEvery
}

func stateCollection(app core.App) (*core.Collection, error) {
	return app.FindCollectionByNameOrId("autoupgrade_state")
}

// recordPause keeps the one pause row in step with the latest conflict. A
// repeat of the same conflict is silent until the 7-day reminder.
func recordPause(app core.App, fp string, wanted map[string]string, reason string, now time.Time, notify func(notice)) error {
	row, err := app.FindFirstRecordByFilter("autoupgrade_state", "kind = 'pause'")
	if err != nil {
		col, cErr := stateCollection(app)
		if cErr != nil {
			return cErr
		}
		row = core.NewRecord(col)
		row.Set("kind", "pause")
		row.Set("first_seen", now)
		row.Set("fingerprint", "")
	}
	same := row.GetString("fingerprint") == fp
	if !notifyDue(row.GetDateTime("last_notified").Time(), same, now) {
		return nil
	}
	if !same {
		row.Set("first_seen", now)
	}
	row.Set("fingerprint", fp)
	row.Set("target", wanted)
	row.Set("reason", reason)
	row.Set("last_notified", now)
	if err := app.Save(row); err != nil {
		return err
	}
	notify(pauseNotice(wanted, reason, same))
	return nil
}

func clearPause(app core.App) error {
	rows, err := app.FindRecordsByFilter("autoupgrade_state", "kind = 'pause'", "", 0, 0)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			return err
		}
	}
	return nil
}

// recordBlocked writes one blocked row per rolled-back job. The install log id
// makes it idempotent: a boot that runs the reconcile twice sends one email.
func recordBlocked(app core.App, fp string, target map[string]string, reason, installLogID string, now time.Time, notify func(notice)) error {
	if _, err := app.FindFirstRecordByFilter("autoupgrade_state",
		"kind = 'blocked' && install_log = {:id}", map[string]any{"id": installLogID}); err == nil {
		return nil
	}
	col, err := stateCollection(app)
	if err != nil {
		return err
	}
	row := core.NewRecord(col)
	row.Set("kind", "blocked")
	row.Set("fingerprint", fp)
	row.Set("target", target)
	row.Set("reason", reason)
	row.Set("install_log", installLogID)
	row.Set("first_seen", now)
	row.Set("last_notified", now)
	if err := app.Save(row); err != nil {
		return err
	}
	notify(blockedNotice(target, reason, false))
	return nil
}

func targetOf(row *core.Record) map[string]string {
	out := map[string]string{}
	_ = row.UnmarshalJSONField("target", &out)
	return out
}

func remindBlocked(app core.App, now time.Time, notify func(notice)) error {
	rows, err := app.FindRecordsByFilter("autoupgrade_state", "kind = 'blocked' && cleared = false", "", 0, 0)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if !notifyDue(r.GetDateTime("last_notified").Time(), true, now) {
			continue
		}
		r.Set("last_notified", now)
		if err := app.Save(r); err != nil {
			return err
		}
		notify(blockedNotice(targetOf(r), r.GetString("reason"), true))
	}
	return nil
}

func blockedFingerprints(app core.App) (map[string]bool, error) {
	rows, err := app.FindRecordsByFilter("autoupgrade_state", "kind = 'blocked' && cleared = false", "", 0, 0)
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.GetString("fingerprint")] = true
	}
	return out, nil
}
```

- [ ] **Step 4: Write `autoupgrade_notify.go`**

```go
package coreserver

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/approutes"
	"tinycld.org/core/mailer"
)

type mailFn func(toName, toEmail, subject, htmlBody, textBody string)

func pauseNotice(wanted map[string]string, reason string, reminder bool) notice {
	subject := "Automatic updates are paused"
	if reminder {
		subject = "Reminder: automatic updates are still paused"
	}
	body := fmt.Sprintf("New versions are available (%s), but they do not work with the packages you have installed:\n\n%s\n\nUpdates stay paused until this is resolved. You can update packages by hand on Settings → Packages.",
		formatTarget(wanted), reason)
	return notice{Subject: subject, BodyText: body}
}

func blockedNotice(target map[string]string, reason string, reminder bool) notice {
	subject := "An automatic update was rolled back"
	if reminder {
		subject = "Reminder: an automatic update is still blocked"
	}
	body := fmt.Sprintf("The update to %s was rolled back:\n\n%s\n\nIt will not be tried again until you clear it on Settings → Packages.",
		formatTarget(target), reason)
	return notice{Subject: subject, BodyText: body}
}

func notifyAdmins(app core.App, send mailFn, n notice) {
	users, err := app.FindRecordsByFilter("users",
		"(role = 'owner' || role = 'admin') && disabled != true", "", 0, 0)
	if err != nil {
		srvLog.Warn("auto-upgrade: cannot list recipients", "err", err)
		return
	}
	link := strings.TrimRight(app.Settings().Meta.AppURL, "/") + approutes.Href("settings/packages")
	for _, u := range users {
		html, text := mailer.RenderTransactionalEmail(mailer.TransactionalEmail{
			Eyebrow:  "Automatic updates",
			Greeting: mailer.Greeting(u.GetString("name")),
			BodyHTML: strings.ReplaceAll(mailer.EscapeHTML(n.BodyText), "\n", "<br>"),
			BodyText: n.BodyText,
			CTALabel: "Open Packages",
			CTALink:  link,
		})
		send(u.GetString("name"), u.Email(), n.Subject, html, text)
	}
}
```

Check `approutes.Href` accepts `"settings/packages"`; if the route table names it differently, use the name that `approutes` defines for `app/a/(app)/settings/packages.tsx`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestNotifyDue|TestRecordPause|TestRecordBlocked|TestNotifyAdmins' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/coreserver/autoupgrade_store.go core/server/coreserver/autoupgrade_notify.go core/server/coreserver/autoupgrade_store_test.go
git commit -m "feat(core): auto-upgrade pause/blocked rows with a gated notice"
```

---

### Task 5: Record the trigger and the changes on the install job

**Files:**
- Modify: `core/server/installjob/installjob.go:55-70` (Job struct)
- Modify: `core/server/coreserver/pkg_install.go:420-450` (`createInstallLog`)
- Modify: `core/server/coreserver/pkg_version_change.go:48-93` (`handleVersionChange`)
- Test: `core/server/coreserver/autoupgrade_begin_test.go`

**Interfaces:**
- Produces:
  - `installjob.Job.Trigger string` — `"manual"` or `"auto"`; `""` is written as `"manual"`.
  - `func beginVersionChange(app *pocketbase.PocketBase, changes []installjob.VersionChange, trigger string) (*installjob.Job, error)` — validates, runs the compat gate, claims the job, starts `runVersionChangeRebuild` in a goroutine. Errors: `errJobBusy` (`errors.New("another operation is in progress")`), a compat error, a validation error.
  - `createInstallLog` sets `trigger` and, when `job.Changes` is non-empty, `changes`.

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"errors"
	"testing"

	"tinycld.org/core/installjob"
)

func TestCreateInstallLogRecordsTriggerAndChanges(t *testing.T) {
	app := adminConsoleTestApp(t)
	job := installjob.New("version_change", "mail", "")
	job.Trigger = "auto"
	job.Changes = []installjob.VersionChange{{Slug: "mail", TargetVersion: "0.6.0"}}

	rec := createInstallLog(app, job, "version_change")
	if rec == nil {
		t.Fatal("no install log row")
	}
	if rec.GetString("trigger") != "auto" {
		t.Errorf("trigger = %q", rec.GetString("trigger"))
	}
	var got []installjob.VersionChange
	if err := rec.UnmarshalJSONField("changes", &got); err != nil || len(got) != 1 || got[0].TargetVersion != "0.6.0" {
		t.Errorf("changes = %+v, %v", got, err)
	}

	manual := createInstallLog(app, installjob.New("install", "x", ""), "install")
	if manual.GetString("trigger") != "manual" {
		t.Errorf("default trigger = %q", manual.GetString("trigger"))
	}
}

func TestBeginVersionChangeRefusesWhileBusy(t *testing.T) {
	busy := installjob.New("install", "x", "")
	if _, ok := installjob.Claim(busy); !ok {
		t.Fatal("could not claim")
	}
	t.Cleanup(func() { installjob.Release(busy) })

	_, err := beginVersionChange(nil, []installjob.VersionChange{{Slug: "mail", TargetVersion: "0.6.0"}}, "auto")
	if !errors.Is(err, errJobBusy) {
		t.Fatalf("err = %v, want errJobBusy", err)
	}
}
```

The second test passes `nil` for the app only to reach the busy check; `beginVersionChange` must check validation and the interlock **before** it touches `app`. Order inside it: validate → `installjob.Running()` → compat gate → claim.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestCreateInstallLogRecordsTrigger|TestBeginVersionChange' -v`
Expected: FAIL with `job.Trigger undefined`.

- [ ] **Step 3: Add `Trigger` to `installjob.Job`**

In `core/server/installjob/installjob.go`, inside `type Job struct`, after `Changes []VersionChange`:

```go
	// Trigger says who started the job: "manual" (a person) or "auto" (the
	// upgrade scheduler). Recorded on the install log so a boot after a
	// rollback can tell the two apart.
	Trigger string
```

- [ ] **Step 4: Write `trigger` and `changes` in `createInstallLog`**

In `core/server/coreserver/pkg_install.go`, in `createInstallLog`, after `record.Set("started_at", ...)`:

```go
	trigger := job.Trigger
	if trigger == "" {
		trigger = "manual"
	}
	record.Set("trigger", trigger)
	if len(job.Changes) > 0 {
		record.Set("changes", job.Changes)
	}
```

- [ ] **Step 5: Extract `beginVersionChange`**

Replace the body of `handleVersionChange` after the JSON decode in `pkg_version_change.go` with a call to the new function, and add the function:

```go
var errJobBusy = errors.New("another operation is in progress")

// beginVersionChange is the shared start of a version change for the HTTP
// handler and the upgrade scheduler: validate, gate on compatibility, claim
// the single-flight job, and run the rebuild in the background.
func beginVersionChange(app *pocketbase.PocketBase, changes []installjob.VersionChange, trigger string) (*installjob.Job, error) {
	if len(changes) == 0 {
		return nil, errors.New("at least one change is required")
	}
	for _, c := range changes {
		if !slugPattern.MatchString(c.Slug) {
			return nil, fmt.Errorf("invalid package slug: %s", c.Slug)
		}
		if c.TargetVersion == "" {
			return nil, fmt.Errorf("targetVersion is required for %s", c.Slug)
		}
		// Constrain the version charset before it is concatenated into an npm/git
		// install spec. exec.Command uses no shell so this can't *execute*, but a
		// loose value could smuggle an extra arg or option into npm pack / git.
		if !versionTokenPattern.MatchString(c.TargetVersion) {
			return nil, fmt.Errorf("invalid targetVersion for %s: %s", c.Slug, c.TargetVersion)
		}
	}
	if installjob.Running() {
		return nil, errJobBusy
	}
	// Pre-flight compat gate. The Versions UI runs the same solve as an
	// advisory check; this is the authoritative refusal.
	if err := checkVersionChangeCompat(app, changes); err != nil {
		return nil, err
	}
	job := installjob.New("version_change", changes[0].Slug, "")
	job.Changes = changes
	job.Trigger = trigger
	if _, ok := installjob.Claim(job); !ok {
		return nil, errJobBusy
	}
	go runVersionChangeRebuild(app, job)
	return job, nil
}

func handleVersionChange(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	var body struct {
		Changes []installjob.VersionChange `json:"changes"`
	}
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("Invalid request body", err)
	}
	job, err := beginVersionChange(app, body.Changes, "manual")
	if errors.Is(err, errJobBusy) {
		return re.JSON(http.StatusConflict, map[string]any{
			"error":      "Another operation is in progress",
			"currentJob": installjob.Current().Info(),
		})
	}
	if err != nil {
		return re.BadRequestError(err.Error(), err)
	}
	return re.JSON(http.StatusAccepted, map[string]any{"jobId": job.ID})
}
```

Add `"errors"` to the imports. `installjob.Current()` can be nil if the busy job finished between the two calls; guard it: compute `info := map[string]any{}`; `if cur := installjob.Current(); cur != nil { info = cur.Info() }`.

- [ ] **Step 6: Run the tests and the existing version-change tests**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestCreateInstallLogRecordsTrigger|TestBeginVersionChange|VersionChange' -v && go test ./installjob`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/installjob/installjob.go core/server/coreserver/pkg_install.go core/server/coreserver/pkg_version_change.go core/server/coreserver/autoupgrade_begin_test.go
git commit -m "feat(core): record trigger and changes on version-change jobs"
```

---

### Task 6: Local scheduler

**Files:**
- Create: `core/server/coreserver/autoupgrade_local.go`
- Test: `core/server/coreserver/autoupgrade_local_test.go`

**Interfaces:**
- Consumes: `autoupgrade.*` (Task 2), `planUpgrade`, `fingerprint`, `formatViolations` (Task 3), `recordPause`, `clearPause`, `remindBlocked`, `blockedFingerprints`, `notifyAdmins` (Task 4), `beginVersionChange` (Task 5), `versionInfosForRows`, `versionsForSpec`, `solveRegistryCompat`, `isDevelopment`.
- Produces:
  - `type localScheduler struct` with injectable fields `now func() time.Time`, `discover func() ([]VersionInfo, error)`, `solve solveFunc`, `apply func([]installjob.VersionChange) error`, `notify func(notice)`, `disabled string`.
  - `func newLocalScheduler(app *pocketbase.PocketBase) *localScheduler`
  - Methods: `PolicyChanged`, `Status`, `Start`, `tick(ctx context.Context) string`.
  - Result strings (also `Status.LastResult`): `resultDisabledPrefix = "checks disabled: "`, `"off"`, `"waiting for window"`, `"busy"`, `"no updates"`, `"paused: conflict"`, `"blocked"`, `"upgrading"`, `"failed: <err>"`.

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"context"
	"errors"
	"testing"
	"time"

	"tinycld.org/core/autoupgrade"
	"tinycld.org/core/installjob"
)

func setSetting(t *testing.T, key, value string) func(*localScheduler) {
	return func(s *localScheduler) {
		row, err := s.app.FindFirstRecordByFilter("system_settings", "key = {:k}", map[string]any{"k": key})
		if err != nil {
			col, _ := s.app.FindCollectionByNameOrId("system_settings")
			row = core.NewRecord(col)
			row.Set("key", key)
		}
		row.Set("value", value)
		mustNil(t, s.app.Save(row))
	}
}

func testScheduler(t *testing.T, at time.Time, in []VersionInfo, solve solveFunc) (*localScheduler, *[][]installjob.VersionChange, *[]notice) {
	t.Helper()
	app := adminConsoleTestApp(t)
	var applied [][]installjob.VersionChange
	var sent []notice
	s := &localScheduler{
		app:      app,
		now:      func() time.Time { return at },
		discover: func() ([]VersionInfo, error) { return in, nil },
		solve:    solve,
		apply: func(c []installjob.VersionChange) error {
			applied = append(applied, c)
			return nil
		},
		notify: func(n notice) { sent = append(sent, n) },
	}
	return s, &applied, &sent
}

var inWindow = time.Date(2026, 10, 1, 3, 0, 0, 0, time.Local)
var okSolve = func(map[string]string) ([]compatViolation, error) { return nil, nil }

func TestTickAppliesNewestInWindow(t *testing.T) {
	s, applied, _ := testScheduler(t, inWindow, infos([3]string{"mail", "0.5.0", "0.6.0"}), okSolve)
	if got := s.tick(context.Background()); got != "upgrading" {
		t.Fatalf("result %q", got)
	}
	if len(*applied) != 1 || (*applied)[0][0].TargetVersion != "0.6.0" {
		t.Fatalf("applied %+v", *applied)
	}
}

func TestTickSkipsOutsideWindowAndWhenOff(t *testing.T) {
	s, applied, _ := testScheduler(t, time.Date(2026, 10, 1, 12, 0, 0, 0, time.Local), infos([3]string{"mail", "0.5.0", "0.6.0"}), okSolve)
	if got := s.tick(context.Background()); got != "waiting for window" {
		t.Fatalf("result %q", got)
	}
	s.now = func() time.Time { return inWindow }
	setSetting(t, autoupgrade.KeyEnabled, "false")(s)
	if got := s.tick(context.Background()); got != "off" {
		t.Fatalf("result %q", got)
	}
	if len(*applied) != 0 {
		t.Fatal("applied while skipped")
	}
}

func TestTickHonorsCustomWindow(t *testing.T) {
	s, _, _ := testScheduler(t, time.Date(2026, 10, 1, 12, 30, 0, 0, time.Local), infos([3]string{"mail", "0.5.0", "0.6.0"}), okSolve)
	setSetting(t, autoupgrade.KeyWindow, "12:00-13:00")(s)
	if got := s.tick(context.Background()); got != "upgrading" {
		t.Fatalf("result %q", got)
	}
}

func TestTickPausesOnConflict(t *testing.T) {
	v := []compatViolation{{Package: "mail", Requires: "@tinycld/core", Range: ">=0.6", Found: "0.5.4"}}
	s, applied, sent := testScheduler(t, inWindow, infos([3]string{"mail", "0.5.0", "0.5.1"}),
		func(map[string]string) ([]compatViolation, error) { return v, nil })
	if got := s.tick(context.Background()); got != "paused: conflict" {
		t.Fatalf("result %q", got)
	}
	s.tick(context.Background())
	if len(*applied) != 0 || len(*sent) != 1 {
		t.Fatalf("applied=%d sent=%d", len(*applied), len(*sent))
	}
}

func TestTickClearsPauseWhenResolved(t *testing.T) {
	v := []compatViolation{{Package: "mail", Requires: "@tinycld/core", Range: ">=0.6", Found: "0.5.4"}}
	conflict := true
	s, _, _ := testScheduler(t, inWindow, infos([3]string{"mail", "0.5.0", "0.5.1"}),
		func(map[string]string) ([]compatViolation, error) {
			if conflict {
				return v, nil
			}
			return nil, nil
		})
	s.tick(context.Background())
	conflict = false
	if got := s.tick(context.Background()); got != "upgrading" {
		t.Fatalf("result %q", got)
	}
	if rows, _ := s.app.FindRecordsByFilter("autoupgrade_state", "kind = 'pause'", "", 0, 0); len(rows) != 0 {
		t.Fatal("pause row not cleared")
	}
}

func TestTickSkipsBlockedSet(t *testing.T) {
	s, applied, _ := testScheduler(t, inWindow, infos([3]string{"mail", "0.5.0", "0.6.0"}), okSolve)
	logID := newInstallLogRow(t, s.app)
	fp := fingerprint(map[string]string{"mail": "0.6.0"}, nil)
	mustNil(t, recordBlocked(s.app, fp, map[string]string{"mail": "0.6.0"}, "rolled back", logID, inWindow, func(notice) {}))
	if got := s.tick(context.Background()); got != "blocked" {
		t.Fatalf("result %q", got)
	}
	if len(*applied) != 0 {
		t.Fatal("applied a blocked set")
	}
}

func TestTickDisabled(t *testing.T) {
	s, applied, _ := testScheduler(t, inWindow, infos([3]string{"mail", "0.5.0", "0.6.0"}), okSolve)
	s.disabled = "development build"
	if got := s.tick(context.Background()); got != "checks disabled: development build" {
		t.Fatalf("result %q", got)
	}
	if len(*applied) != 0 {
		t.Fatal("applied while disabled")
	}
}

func TestTickApplyErrorIsReported(t *testing.T) {
	s, _, _ := testScheduler(t, inWindow, infos([3]string{"mail", "0.5.0", "0.6.0"}), okSolve)
	s.apply = func([]installjob.VersionChange) error { return errors.New("npm down") }
	if got := s.tick(context.Background()); got != "failed: npm down" {
		t.Fatalf("result %q", got)
	}
	st, err := s.Status(context.Background())
	mustNil(t, err)
	if !st.Available || st.LastResult != "failed: npm down" || st.NextCheck.IsZero() {
		t.Fatalf("status %+v", st)
	}
}
```

Add `"github.com/pocketbase/pocketbase/core"` to the test imports (used by `setSetting`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run TestTick -v`
Expected: FAIL with `undefined: localScheduler`.

- [ ] **Step 3: Write the implementation**

```go
package coreserver

import (
	"context"
	"os"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/autoupgrade"
	"tinycld.org/core/installjob"
)

const (
	tickEvery            = time.Hour
	resultDisabledPrefix = "checks disabled: "
)

// localScheduler is the Delegate for a deployment that can rebuild itself. It
// wakes every hour; inside the owner's window it applies the newest compatible
// set through the same path as a manual version change, so the entrypoint's
// health probe commits or rolls back exactly as it does for a person.
type localScheduler struct {
	app      core.App
	now      func() time.Time
	discover func() ([]VersionInfo, error)
	solve    solveFunc
	apply    func([]installjob.VersionChange) error
	notify   func(notice)
	// disabled is why ticks do nothing ("" = active). The switch still works:
	// a development build or a test server must not rebuild itself at 3am.
	disabled string

	mu         sync.Mutex
	lastRun    time.Time
	lastResult string
}

func newLocalScheduler(app *pocketbase.PocketBase) *localScheduler {
	s := &localScheduler{
		app: app,
		now: time.Now,
		discover: func() ([]VersionInfo, error) {
			rows, err := app.FindRecordsByFilter("pkg_registry", "id != ''", "slug", 0, 0)
			if err != nil {
				return nil, err
			}
			return versionInfosForRows(rows, versionsForSpec), nil
		},
		solve: func(c map[string]string) ([]compatViolation, error) { return solveRegistryCompat(app, c) },
		apply: func(c []installjob.VersionChange) error {
			_, err := beginVersionChange(app, c, "auto")
			return err
		},
		notify: func(n notice) { notifyAdmins(app, send, n) },
	}
	switch {
	case isDevelopment():
		s.disabled = "development build"
	case os.Getenv("TINYCLD_AUTOUPGRADE_DISABLED") == "1":
		s.disabled = "TINYCLD_AUTOUPGRADE_DISABLED is set"
	}
	return s
}

func readSystemSetting(app core.App, key string) string {
	row, err := app.FindFirstRecordByFilter("system_settings", "key = {:k}", map[string]any{"k": key})
	if err != nil {
		return ""
	}
	return row.GetString("value")
}

func (s *localScheduler) window() autoupgrade.Window {
	raw := readSystemSetting(s.app, autoupgrade.KeyWindow)
	if raw == "" {
		raw = autoupgrade.DefaultWindow
	}
	w, err := autoupgrade.ParseWindow(raw)
	if err != nil {
		srvLog.Warn("auto-upgrade: bad window, using default", "window", raw, "err", err)
		w, _ = autoupgrade.ParseWindow(autoupgrade.DefaultWindow)
	}
	return w
}

// PolicyChanged has nothing to push: every tick reads the stored flag.
func (s *localScheduler) PolicyChanged(_ context.Context, enabled bool) error {
	srvLog.Info("auto-upgrade policy", "enabled", enabled)
	return nil
}

func (s *localScheduler) Status(context.Context) (autoupgrade.Status, error) {
	s.mu.Lock()
	lastRun, lastResult := s.lastRun, s.lastResult
	s.mu.Unlock()
	if lastRun.IsZero() {
		lastRun, lastResult = lastAutoJob(s.app)
	}
	return autoupgrade.Status{
		Available:  true,
		LastRun:    lastRun,
		LastResult: lastResult,
		NextCheck:  s.window().NextStart(s.now()),
	}, nil
}

// lastAutoJob reads the newest automatic job from the install log, so the
// status survives the restart every upgrade ends with.
func lastAutoJob(app core.App) (time.Time, string) {
	rows, err := app.FindRecordsByFilter("pkg_install_log", "trigger = 'auto'", "-created", 1, 0)
	if err != nil || len(rows) == 0 {
		return time.Time{}, ""
	}
	results := map[string]string{"success": "upgraded", "rolled_back": "rolled back", "failed": "failed", "running": "upgrading"}
	return rows[0].GetDateTime("created").Time(), results[rows[0].GetString("status")]
}

func (s *localScheduler) Start(ctx context.Context) {
	go func() {
		t := time.NewTicker(tickEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.tick(ctx)
			}
		}
	}()
}

func (s *localScheduler) record(result string) string {
	s.mu.Lock()
	s.lastRun, s.lastResult = s.now(), result
	s.mu.Unlock()
	return result
}

func (s *localScheduler) tick(_ context.Context) string {
	if s.disabled != "" {
		return s.record(resultDisabledPrefix + s.disabled)
	}
	if readSystemSetting(s.app, autoupgrade.KeyEnabled) != "true" {
		return "off"
	}
	now := s.now()
	if !s.window().Contains(now) {
		return "waiting for window"
	}
	if installjob.Running() {
		return "busy"
	}
	if err := remindBlocked(s.app, now, s.notify); err != nil {
		srvLog.Warn("auto-upgrade: blocked reminders failed", "err", err)
	}

	infos, err := s.discover()
	if err != nil {
		return s.record("failed: " + err.Error())
	}
	plan, err := planUpgrade(infos, s.solve)
	if err != nil {
		return s.record("failed: " + err.Error())
	}
	if plan.Target == nil && len(plan.Violations) > 0 {
		fp := fingerprint(plan.Wanted, plan.Violations)
		if err := recordPause(s.app, fp, plan.Wanted, formatViolations(plan.Violations), now, s.notify); err != nil {
			srvLog.Warn("auto-upgrade: record pause failed", "err", err)
		}
		return s.record("paused: conflict")
	}
	if err := clearPause(s.app); err != nil {
		srvLog.Warn("auto-upgrade: clear pause failed", "err", err)
	}
	if len(plan.Target) == 0 {
		return s.record("no updates")
	}
	blocked, err := blockedFingerprints(s.app)
	if err != nil {
		return s.record("failed: " + err.Error())
	}
	if blocked[fingerprint(plan.Target, nil)] {
		return s.record("blocked")
	}

	changes := make([]installjob.VersionChange, 0, len(plan.Target))
	for _, slug := range sortedKeys(plan.Target) {
		changes = append(changes, installjob.VersionChange{Slug: slug, TargetVersion: plan.Target[slug]})
	}
	if err := s.apply(changes); err != nil {
		srvLog.Warn("auto-upgrade: apply failed", "err", err)
		return s.record("failed: " + err.Error())
	}
	return s.record("upgrading")
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
```

Add `"sort"` to the imports. If `sortedKeys` already exists in `coreserver`, reuse it and delete this copy.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run TestTick -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/coreserver/autoupgrade_local.go core/server/coreserver/autoupgrade_local_test.go
git commit -m "feat(core): local auto-upgrade scheduler"
```

---

### Task 7: Boot reconcile of rolled-back auto jobs

**Files:**
- Create: `core/server/coreserver/autoupgrade_reconcile.go`
- Modify: `core/server/coreserver/server.go:549` (call after `ReconcileRolledBackInstall`)
- Test: `core/server/coreserver/autoupgrade_reconcile_test.go`

**Interfaces:**
- Consumes: `recordBlocked`, `fingerprint`, `notifyAdmins`, `send`.
- Produces: `func reconcileAutoUpgradeResults(app core.App, now time.Time, notify func(notice))`.

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"testing"
	"time"
)

func TestReconcileBlocksRolledBackAutoJob(t *testing.T) {
	app := adminConsoleTestApp(t)
	newInstallLogRow(t, app) // auto, rolled_back, mail -> 0.6.0
	var sent []notice
	notify := func(n notice) { sent = append(sent, n) }
	now := time.Date(2026, 10, 1, 3, 10, 0, 0, time.UTC)

	reconcileAutoUpgradeResults(app, now, notify)
	reconcileAutoUpgradeResults(app, now, notify)

	fps, err := blockedFingerprints(app)
	mustNil(t, err)
	if !fps[fingerprint(map[string]string{"mail": "0.6.0"}, nil)] {
		t.Fatal("set not blocked")
	}
	if len(sent) != 1 {
		t.Fatalf("%d emails, want 1", len(sent))
	}
}

func TestReconcileIgnoresManualAndFailedJobs(t *testing.T) {
	app := adminConsoleTestApp(t)
	id := newInstallLogRow(t, app)
	row, _ := app.FindRecordById("pkg_install_log", id)
	row.Set("trigger", "manual")
	mustNil(t, app.Save(row))
	id2 := newInstallLogRow(t, app)
	row2, _ := app.FindRecordById("pkg_install_log", id2)
	row2.Set("status", "failed")
	mustNil(t, app.Save(row2))

	reconcileAutoUpgradeResults(app, time.Now(), func(notice) { t.Fatal("must not notify") })
	if fps, _ := blockedFingerprints(app); len(fps) != 0 {
		t.Fatalf("blocked %v", fps)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run TestReconcile -v`
Expected: FAIL with `undefined: reconcileAutoUpgradeResults`.

- [ ] **Step 3: Write the implementation**

```go
package coreserver

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/installjob"
)

const rolledBackReason = "The update did not pass its health check after the restart, so it was rolled back."

// reconcileAutoUpgradeResults runs at boot, after ReconcileRolledBackInstall
// has marked a stranded row rolled_back. Each rolled-back automatic job blocks
// its set so the next window does not try it again. A failed job is not
// blocked: it failed before the live app changed, so trying again is safe.
func reconcileAutoUpgradeResults(app core.App, now time.Time, notify func(notice)) {
	rows, err := app.FindRecordsByFilter("pkg_install_log",
		"trigger = 'auto' && status = 'rolled_back'", "-created", 0, 0)
	if err != nil {
		srvLog.Warn("auto-upgrade: reconcile query failed", "err", err)
		return
	}
	for _, r := range rows {
		var changes []installjob.VersionChange
		if err := r.UnmarshalJSONField("changes", &changes); err != nil || len(changes) == 0 {
			continue
		}
		target := make(map[string]string, len(changes))
		for _, c := range changes {
			target[c.Slug] = c.TargetVersion
		}
		if err := recordBlocked(app, fingerprint(target, nil), target, rolledBackReason, r.Id, now, notify); err != nil {
			srvLog.Warn("auto-upgrade: record blocked failed", "installLog", r.Id, "err", err)
		}
	}
}
```

- [ ] **Step 4: Call it at boot**

In `core/server/coreserver/server.go`, in `registerStaticServe`, directly after `ReconcileRolledBackInstall(e.App)`:

```go
			reconcileAutoUpgradeResults(e.App, time.Now(), func(n notice) { notifyAdmins(e.App, send, n) })
```

Add `"time"` to the imports of `server.go` if it is not there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run TestReconcile -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/coreserver/autoupgrade_reconcile.go core/server/coreserver/autoupgrade_reconcile_test.go core/server/coreserver/server.go
git commit -m "feat(core): block a rolled-back automatic update at boot"
```

---

### Task 8: Registration — write guard, policy hook, status route, delegate

**Files:**
- Create: `core/server/coreserver/autoupgrade_register.go`
- Modify: `core/server/coreserver/server.go` (`RegisterSharedCore`; `Register` host-only tail)
- Test: `core/server/coreserver/autoupgrade_register_test.go`

**Interfaces:**
- Consumes: `autoupgrade.*`, `newLocalScheduler`, `requireOwner`, `isOwner`, `syscfg.IsManaged`.
- Produces:
  - `func RegisterAutoUpgrade(app *pocketbase.PocketBase)` (shared).
  - `GET /api/admin/packages/auto-upgrade/status` → `{"windowManaged": bool, "status": autoupgrade.Status}` (owner or superuser).
  - `func guardAutoUpgradeWrite(e *core.RecordRequestEvent) error`
  - `func notifyPolicy(e *core.RecordEvent) error`

- [ ] **Step 1: Write the failing test**

```go
package coreserver

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/autoupgrade"
)

type recordingDelegate struct{ calls []bool }

func (d *recordingDelegate) PolicyChanged(_ context.Context, enabled bool) error {
	d.calls = append(d.calls, enabled)
	return nil
}
func (d *recordingDelegate) Status(context.Context) (autoupgrade.Status, error) {
	return autoupgrade.Status{Available: true, LastResult: "no updates"}, nil
}

func TestPolicyHookCallsDelegate(t *testing.T) {
	app := adminConsoleTestApp(t)
	d := &recordingDelegate{}
	autoupgrade.SetDelegate(d)
	t.Cleanup(func() { autoupgrade.SetDelegate(nil) })
	app.OnRecordAfterUpdateSuccess("system_settings").BindFunc(notifyPolicy)

	row, err := app.FindFirstRecordByFilter("system_settings", "key = 'autoupgrade.enabled'")
	mustNil(t, err)
	row.Set("value", "false")
	mustNil(t, app.Save(row))
	if len(d.calls) != 1 || d.calls[0] != false {
		t.Fatalf("calls %v", d.calls)
	}
}

func TestStatusRouteAndWriteGuard(t *testing.T) {
	app := adminConsoleTestApp(t)
	registerAutoUpgradeOn(app)
	ownerTok, err := newUser(t, app, "owner@x.test", "owner", false).NewAuthToken()
	mustNil(t, err)
	adminTok, err := newUser(t, app, "admin@x.test", "admin", false).NewAuthToken()
	mustNil(t, err)
	seed, err := app.FindFirstRecordByFilter("system_settings", "key = 'autoupgrade.enabled'")
	mustNil(t, err)
	factory := func(testing.TB) *tests.TestApp { return app }

	scenarios := []tests.ApiScenario{
		{
			Name:                  "status needs auth",
			Method:                http.MethodGet,
			URL:                   "/api/admin/packages/auto-upgrade/status",
			ExpectedStatus:        http.StatusUnauthorized,
			ExpectedContent:       []string{`"status":401`},
			TestAppFactory:        factory,
			DisableTestAppCleanup: true,
		},
		{
			Name:                  "status for the owner, no delegate",
			Method:                http.MethodGet,
			URL:                   "/api/admin/packages/auto-upgrade/status",
			Headers:               map[string]string{"Authorization": ownerTok},
			ExpectedStatus:        http.StatusOK,
			ExpectedContent:       []string{`"available":false`, `"windowManaged":false`},
			TestAppFactory:        factory,
			DisableTestAppCleanup: true,
		},
		{
			Name:                  "an admin cannot change the flag",
			Method:                http.MethodPatch,
			URL:                   "/api/collections/system_settings/records/" + seed.Id,
			Body:                  strings.NewReader(`{"value":"false"}`),
			Headers:               map[string]string{"Authorization": adminTok},
			ExpectedStatus:        http.StatusForbidden,
			ExpectedContent:       []string{`"status":403`},
			TestAppFactory:        factory,
			DisableTestAppCleanup: true,
		},
		{
			Name:                  "the owner can change the flag",
			Method:                http.MethodPatch,
			URL:                   "/api/collections/system_settings/records/" + seed.Id,
			Body:                  strings.NewReader(`{"value":"false"}`),
			Headers:               map[string]string{"Authorization": ownerTok},
			ExpectedStatus:        http.StatusOK,
			ExpectedContent:       []string{`"value":"false"`},
			TestAppFactory:        factory,
			DisableTestAppCleanup: true,
		},
	}
	for _, sc := range scenarios {
		sc.Test(t)
	}
}
```

The 401 body for an unauthenticated owner-only route comes from `requireOwner`; if it answers 403 for a missing token, change that scenario's expectation to what `requireOwner` returns (it is the existing gate, not new behavior).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestPolicyHook|TestStatusRoute' -v`
Expected: FAIL with `undefined: notifyPolicy`.

- [ ] **Step 3: Write the implementation**

```go
package coreserver

import (
	"context"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/autoupgrade"
	"tinycld.org/core/syscfg"
)

// RegisterAutoUpgrade binds the same hooks in every composition; which
// Delegate (if any) answers them is decided by whoever composed the app.
func RegisterAutoUpgrade(app *pocketbase.PocketBase) {
	registerAutoUpgradeOn(app)
}

func registerAutoUpgradeOn(app core.App) {
	app.OnRecordCreateRequest("system_settings").BindFunc(guardAutoUpgradeWrite)
	app.OnRecordUpdateRequest("system_settings").BindFunc(guardAutoUpgradeWrite)
	app.OnRecordDeleteRequest("system_settings").BindFunc(guardAutoUpgradeWrite)
	app.OnRecordAfterCreateSuccess("system_settings").BindFunc(notifyPolicy)
	app.OnRecordAfterUpdateSuccess("system_settings").BindFunc(notifyPolicy)

	ctx, cancel := context.WithCancel(context.Background())
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		cancel()
		return e.Next()
	})
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/admin/packages/auto-upgrade/status", func(re *core.RequestEvent) error {
			return handleAutoUpgradeStatus(re)
		}).BindFunc(requireOwner)

		if d := autoupgrade.Current(); d != nil {
			enabled := readSystemSetting(e.App, autoupgrade.KeyEnabled) == "true"
			if err := d.PolicyChanged(ctx, enabled); err != nil {
				srvLog.Warn("auto-upgrade: boot policy push failed", "err", err)
			}
			if s, ok := d.(autoupgrade.Starter); ok {
				s.Start(ctx)
			}
		}
		return e.Next()
	})
}

// guardAutoUpgradeWrite narrows the admin-wide system_settings rule: the
// upgrade policy is the owner's decision, as package installs are.
func guardAutoUpgradeWrite(e *core.RecordRequestEvent) error {
	if !strings.HasPrefix(e.Record.GetString("key"), "autoupgrade.") {
		return e.Next()
	}
	if e.HasSuperuserAuth() || isOwner(e.Auth) {
		return e.Next()
	}
	return e.ForbiddenError("Only the owner can change automatic updates.", nil)
}

func notifyPolicy(e *core.RecordEvent) error {
	if e.Record.GetString("key") == autoupgrade.KeyEnabled {
		if d := autoupgrade.Current(); d != nil {
			if err := d.PolicyChanged(context.Background(), e.Record.GetString("value") == "true"); err != nil {
				srvLog.Warn("auto-upgrade: policy push failed", "err", err)
			}
		}
	}
	return e.Next()
}

func handleAutoUpgradeStatus(re *core.RequestEvent) error {
	st := autoupgrade.Unavailable("This build cannot update itself. Download a new release to update.")
	if d := autoupgrade.Current(); d != nil {
		s, err := d.Status(re.Request.Context())
		if err != nil {
			return re.InternalServerError("Failed to read update status", err)
		}
		st = s
	}
	return re.JSON(http.StatusOK, map[string]any{
		"windowManaged": syscfg.IsManaged(autoupgrade.KeyWindow),
		"status":        st,
	})
}
```

- [ ] **Step 4: Wire it in `server.go`**

In `RegisterSharedCore`, after `RegisterPkgEnableHook(app)`:

```go
	// Automatic package updates: the write guard, the policy hook and the
	// status route are the same everywhere; the Delegate behind them is not.
	RegisterAutoUpgrade(app)
```

In `Register`'s host-only tail, inside the existing `if opts.supportsSelfRebuild() {` block that calls `RegisterPackageInstallEndpoints(app)`:

```go
		// A deployment that can rebuild itself also schedules its own updates.
		// SetDelegate binds no hook, so the composition parity test is
		// unaffected.
		autoupgrade.SetDelegate(newLocalScheduler(app))
```

Add `"tinycld.org/core/autoupgrade"` to the `server.go` imports.

- [ ] **Step 5: Run the tests, the whole coreserver suite and the parity test**

Run:
```bash
cd ~/code/tinycld/tinycld/core/server && go test ./coreserver -run 'TestPolicyHook|TestStatusRoute' -v && go test ./...
cd ~/code/tinycld/hosting && go test ./tenantboot -run TestTenantCompositionMatchesHostMinusRecordedExceptions -v
```
Expected: PASS. If the parity test fails, a hook was added outside `RegisterSharedCore`; move it, do not edit the allowlist.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/coreserver/autoupgrade_register.go core/server/coreserver/autoupgrade_register_test.go core/server/coreserver/server.go
git commit -m "feat(core): register auto-upgrade hooks and the local scheduler"
```

---

### Task 9: Client logic and hook

**Files:**
- Modify: `core/lib/pocketbase.ts` (add the collection after `system_settings`)
- Create: `core/components/setup/auto-upgrade-logic.ts`, `core/components/setup/use-auto-upgrade.ts`
- Test: `core/components/setup/__tests__/auto-upgrade-logic.test.ts`

**Interfaces:**
- Consumes: `useSystemSettings` (`system-settings-store.ts`), `PB_SERVER_ADDR`, `useStore`, `useMutation`/`mutation`.
- Produces:
  - `auto-upgrade-logic.ts`: `KEY_ENABLED`, `KEY_WINDOW`, `DEFAULT_WINDOW`, `windowSchema` (zod), `type AutoUpgradeStatus = { available: boolean; reason?: string; lastRun: string; lastResult: string; nextCheck: string }`, `type AutoUpgradeStatusResponse = { windowManaged: boolean; status: AutoUpgradeStatus }`, `isOn(value: string | undefined): boolean`, `statusLine(s: AutoUpgradeStatus): string`, `formatTarget(target: Record<string, string>): string`.
  - `use-auto-upgrade.ts`: `useAutoUpgrade(pb: PocketBase, enabled = true)` returning `{ isOn, window, windowManaged, status, pause, blocked, setOn, saveWindow, clearBlocked, isReady }` where `pause` is `{ reason: string; target: Record<string, string> } | undefined` and `blocked` is `{ id: string; reason: string; target: Record<string, string> }[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { formatTarget, isOn, statusLine, windowSchema } from '../auto-upgrade-logic'

describe('isOn', () => {
    it('is on only for the stored string "true"', () => {
        expect(isOn('true')).toBe(true)
        expect(isOn('false')).toBe(false)
        expect(isOn(undefined)).toBe(false)
    })
})

describe('windowSchema', () => {
    it('accepts HH:MM-HH:MM and refuses equal ends', () => {
        expect(windowSchema.safeParse('02:00-05:00').success).toBe(true)
        expect(windowSchema.safeParse('23:00-01:00').success).toBe(true)
        expect(windowSchema.safeParse('2:00-5:00').success).toBe(false)
        expect(windowSchema.safeParse('02:00-02:00').success).toBe(false)
        expect(windowSchema.safeParse('24:00-01:00').success).toBe(false)
    })
})

describe('statusLine', () => {
    it('shows the reason when unavailable', () => {
        expect(
            statusLine({ available: false, reason: 'No toolchain', lastRun: '', lastResult: '', nextCheck: '' })
        ).toBe('No toolchain')
    })
    it('shows the last result and next check', () => {
        expect(
            statusLine({
                available: true,
                lastRun: '2026-10-01T03:00:00Z',
                lastResult: 'no updates',
                nextCheck: '2026-10-02T02:00:00Z',
            })
        ).toMatch(/^Last check: no updates · Next check: /)
    })
    it('says never when there is no run yet', () => {
        expect(
            statusLine({ available: true, lastRun: '0001-01-01T00:00:00Z', lastResult: '', nextCheck: '2026-10-02T02:00:00Z' })
        ).toMatch(/^No check yet · Next check: /)
    })
})

describe('formatTarget', () => {
    it('sorts by package', () => {
        expect(formatTarget({ mail: '0.6.0', core: '0.5.4' })).toBe('core 0.5.4, mail 0.6.0')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/components/setup/__tests__/auto-upgrade-logic.test.ts`
Expected: FAIL (cannot resolve `../auto-upgrade-logic`).

- [ ] **Step 3: Write `auto-upgrade-logic.ts`**

```ts
import { z } from '@tinycld/core/ui/form'

// Pure, React/pbtsdb-free rules behind the automatic-updates controls, so they
// are unit-testable without rendering.

export const KEY_ENABLED = 'autoupgrade.enabled'
export const KEY_WINDOW = 'autoupgrade.window'
export const DEFAULT_WINDOW = '02:00-05:00'

export interface AutoUpgradeStatus {
    available: boolean
    reason?: string
    lastRun: string
    lastResult: string
    nextCheck: string
}

export interface AutoUpgradeStatusResponse {
    windowManaged: boolean
    status: AutoUpgradeStatus
}

const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/

export const windowSchema = z
    .string()
    .regex(WINDOW_PATTERN, 'Use HH:MM-HH:MM, for example 02:00-05:00')
    .refine(v => v.slice(0, 5) !== v.slice(6), 'Start and end must differ')

export function isOn(value: string | undefined): boolean {
    return value === 'true'
}

// Go marshals a zero time.Time as year 1; treat it as "never".
function hasRun(iso: string): boolean {
    return iso !== '' && !iso.startsWith('0001-')
}

function shortDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function statusLine(s: AutoUpgradeStatus): string {
    if (!s.available) return s.reason ?? 'Automatic updates are not available on this server.'
    const last = hasRun(s.lastRun) ? `Last check: ${s.lastResult}` : 'No check yet'
    return `${last} · Next check: ${shortDate(s.nextCheck)}`
}

export function formatTarget(target: Record<string, string>): string {
    return Object.keys(target)
        .sort()
        .map(slug => `${slug} ${target[slug]}`)
        .join(', ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/components/setup/__tests__/auto-upgrade-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the collection to `core/lib/pocketbase.ts`**

After the `system_settings` collection:

```ts
// Automatic-update memory: the current conflict pause and the version sets
// that were rolled back. Owner-only; the server writes rows, the owner only
// sets `cleared`. See the create_autoupgrade migration.
const autoupgrade_state = newCollection('autoupgrade_state', {
    omitOnInsert: ['created', 'updated'],
    ...onDemand,
    ...indexing,
})
```

Add `autoupgrade_state` to the object of collections exported from that file, in the same way `system_settings` is listed.

- [ ] **Step 6: Write `use-auto-upgrade.ts`**

```ts
import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type PocketBase from 'pocketbase'
import {
    type AutoUpgradeStatusResponse,
    DEFAULT_WINDOW,
    isOn,
    KEY_ENABLED,
    KEY_WINDOW,
} from './auto-upgrade-logic'
import { useSystemSettings } from './system-settings-store'

async function fetchStatus(pb: PocketBase): Promise<AutoUpgradeStatusResponse> {
    const res = await fetch(`${PB_SERVER_ADDR}/api/admin/packages/auto-upgrade/status`, {
        headers: { Authorization: pb.authStore.token },
    })
    if (!res.ok) throw new Error(`auto-upgrade status failed: ${res.status}`)
    return res.json() as Promise<AutoUpgradeStatusResponse>
}

// One place for the automatic-updates controls on the Packages page and in the
// setup wizard: the stored flag and window, the pause and blocked rows, and the
// computed status from the server.
export function useAutoUpgrade(pb: PocketBase, enabled = true) {
    const { byKey, upsert, isReady } = useSystemSettings('autoupgrade')
    const [stateCollection] = useStore('autoupgrade_state')

    const { data: pauses = [] } = useLiveQuery(query =>
        query.from({ s: stateCollection }).where(({ s }) => eq(s.kind, 'pause'))
    )
    const { data: blockedRows = [] } = useLiveQuery(query =>
        query
            .from({ s: stateCollection })
            .where(({ s }) => and(eq(s.kind, 'blocked'), eq(s.cleared, false)))
            .select(({ s }) => ({ id: s.id, reason: s.reason, target: s.target }))
    )

    const statusQuery = useQuery({
        queryKey: ['auto-upgrade-status'],
        queryFn: () => fetchStatus(pb),
        enabled,
    })

    const clear = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield stateCollection.update(id, draft => {
                draft.cleared = true
            })
        }),
    })

    const pause = pauses[0]
    return {
        isReady,
        isOn: isOn(byKey.get(KEY_ENABLED)?.value),
        window: byKey.get(KEY_WINDOW)?.value ?? DEFAULT_WINDOW,
        windowManaged: statusQuery.data?.windowManaged ?? false,
        status: statusQuery.data?.status,
        pause: pause ? { reason: pause.reason, target: pause.target as Record<string, string> } : undefined,
        blocked: blockedRows.map(r => ({ ...r, target: r.target as Record<string, string> })),
        setOn: (next: boolean) => upsert.mutate({ key: KEY_ENABLED, value: String(next), isSecret: false }),
        saveWindow: upsert,
        clearBlocked: (id: string) => clear.mutate(id),
    }
}
```

If the generated row type already types `target` as `Record<string, string>`, drop the casts. Never widen to `any`.

- [ ] **Step 7: Typecheck and commit**

Run: `cd ~/code/tinycld/tinycld && pnpm exec tinycld-pkg typecheck`
Expected: no errors.

```bash
cd ~/code/tinycld/tinycld && git add core/lib/pocketbase.ts core/components/setup/auto-upgrade-logic.ts core/components/setup/use-auto-upgrade.ts core/components/setup/__tests__/auto-upgrade-logic.test.ts
git commit -m "feat(core): auto-upgrade client logic and hook"
```

---

### Task 10: Packages page section and e2e

**Files:**
- Create: `core/components/setup/AutoUpgradeSection.tsx`
- Modify: `core/components/setup/PackageManager.tsx:194-215` (mount above the "Installed" list)
- Modify: `playwright.config.ts` (`SERVER_ENV` gets `TINYCLD_AUTOUPGRADE_DISABLED: '1'`)
- Modify: `.github/workflows/smoke-test-image.yml:81` (`docker run -e TINYCLD_AUTOUPGRADE_DISABLED=1 …`)
- Test: `tests/e2e/auto-upgrade.spec.ts`

**Interfaces:**
- Consumes: `useAutoUpgrade` (Task 9), `Switch` (`@tinycld/core/ui/switch`), `Panel`, `PanelIntro`, `SaveRow` (`components/settings/system/panel-chrome`), `TextInput`, `useForm`, `zodResolver`, `z`.
- Produces: `export function AutoUpgradeSection({ pb, isVisible }: { pb: PocketBase; isVisible: boolean })`. Test ids: `autoupgrade-switch`, `autoupgrade-status`, `autoupgrade-window-save`, `autoupgrade-pause`, `autoupgrade-blocked-<id>`, `autoupgrade-clear-<id>`.

- [ ] **Step 1: Write the failing e2e test**

```ts
import { expect, test } from '@playwright/test'
import { clickSidebarItem, login, navigateToPackage } from './helpers'

test.describe('automatic updates', () => {
    test('owner turns automatic updates off and on', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'settings')
        await clickSidebarItem(page, 'Packages')
        const toggle = page.getByTestId('autoupgrade-switch')
        await expect(toggle).toBeVisible({ timeout: 20_000 })

        // On by default: the migration seeds the row.
        await expect(toggle).toHaveAttribute('aria-checked', 'true')
        await expect(page.getByTestId('autoupgrade-status')).toContainText('Next check')

        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', 'false')

        // The value is stored, not local state: it survives a fresh load of the screen.
        await navigateToPackage(page, 'settings')
        await clickSidebarItem(page, 'Packages')
        await expect(page.getByTestId('autoupgrade-switch')).toHaveAttribute('aria-checked', 'false')

        await page.getByTestId('autoupgrade-switch').click()
        await expect(page.getByTestId('autoupgrade-switch')).toHaveAttribute('aria-checked', 'true')
    })
})
```

Check how `Switch` exposes its checked state (`accessibilityState={{ checked }}` renders `aria-checked` on web). If it uses a different attribute, assert on that one.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec playwright test tests/e2e/auto-upgrade.spec.ts`
Expected: FAIL (`autoupgrade-switch` not found).

- [ ] **Step 3: Write `AutoUpgradeSection.tsx`**

```tsx
import { Panel, PanelIntro, SaveRow } from '@tinycld/core/components/settings/system/panel-chrome'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Switch } from '@tinycld/core/ui/switch'
import type PocketBase from 'pocketbase'
import { Text, View } from 'react-native'
import { formatTarget, KEY_WINDOW, statusLine, windowSchema } from './auto-upgrade-logic'
import { useAutoUpgrade } from './use-auto-upgrade'

const SWITCH_LABEL = 'Automatically upgrade packages when new versions are available'
const formSchema = z.object({ window: windowSchema })

type AutoUpgrade = ReturnType<typeof useAutoUpgrade>

function WindowEditor({ au, isVisible }: { au: AutoUpgrade; isVisible: boolean }) {
    const {
        control,
        handleSubmit,
        setError,
        formState: { errors, isSubmitted, isDirty, isSubmitting },
    } = useForm({
        resolver: zodResolver(formSchema),
        values: { window: au.window },
        mode: 'onChange',
    })
    if (!isVisible) return null
    const onSubmit = handleSubmit(data =>
        au.saveWindow.mutate(
            { key: KEY_WINDOW, value: data.window, isSecret: false },
            {
                onError: err =>
                    setError('window', { message: err instanceof Error ? err.message : 'Failed to save' }),
            }
        )
    )
    return (
        <View className="gap-2">
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            <TextInput
                control={control}
                name="window"
                label="Update window (server time)"
                placeholder="02:00-05:00"
                autoCapitalize="none"
                hint="Updates start only inside this window."
            />
            <SaveRow
                testID="autoupgrade-window-save"
                onPress={onSubmit}
                isPending={au.saveWindow.isPending}
                isDisabled={isSubmitting || !isDirty}
            />
        </View>
    )
}

function PauseNotice({ pause }: { pause: AutoUpgrade['pause'] }) {
    if (!pause) return null
    return (
        <View testID="autoupgrade-pause" className="gap-1 rounded-lg border border-border bg-surface-secondary p-3">
            <Text className="text-sm font-semibold text-foreground">
                Updates paused: {formatTarget(pause.target)} conflicts with installed packages
            </Text>
            <Text className="text-xs text-muted-foreground">{pause.reason}</Text>
        </View>
    )
}

function BlockedRow({ row, onClear }: { row: AutoUpgrade['blocked'][number]; onClear: (id: string) => void }) {
    return (
        <View testID={`autoupgrade-blocked-${row.id}`} className="flex-row items-center gap-3 rounded-lg border border-border p-3">
            <View className="flex-1 gap-0.5">
                <Text className="text-sm font-semibold text-foreground">Blocked: {formatTarget(row.target)}</Text>
                <Text className="text-xs text-muted-foreground">{row.reason}</Text>
            </View>
            <Button testID={`autoupgrade-clear-${row.id}`} size="sm" variant="outline" onPress={() => onClear(row.id)}>
                <ButtonText>Clear</ButtonText>
            </Button>
        </View>
    )
}

export function AutoUpgradeSection({ pb, isVisible }: { pb: PocketBase; isVisible: boolean }) {
    const au = useAutoUpgrade(pb, isVisible)
    if (!isVisible) return null
    const available = au.status?.available ?? false
    const line = au.status ? statusLine(au.status) : ''
    const blockedRows = au.blocked.map(row => <BlockedRow key={row.id} row={row} onClear={au.clearBlocked} />)
    return (
        <Panel label="Automatic updates">
            <PanelIntro>
                New versions are installed in the update window. A version that fails its health check is
                rolled back and not tried again until you clear it.
            </PanelIntro>
            <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm text-foreground">{SWITCH_LABEL}</Text>
                <Switch
                    testID="autoupgrade-switch"
                    accessibilityLabel={SWITCH_LABEL}
                    value={au.isOn}
                    isDisabled={!available || !au.isReady}
                    onValueChange={au.setOn}
                />
            </View>
            <Text testID="autoupgrade-status" className="text-xs text-muted-foreground">
                {line}
            </Text>
            <WindowEditor au={au} isVisible={available && !au.windowManaged} />
            <PauseNotice pause={au.pause} />
            <View className="gap-2">{blockedRows}</View>
        </Panel>
    )
}
```

If `Panel`/`PanelIntro`/`SaveRow` are not exported from `panel-chrome`, import them from where `SentryPanel.tsx` imports them. If the `Button` path differs, use the one `PackageManager.tsx` imports.

- [ ] **Step 4: Mount it in `PackageManager.tsx`**

Directly after the `<PageHeader … />` element:

```tsx
            <AutoUpgradeSection pb={pb} isVisible={isVisible} />
```

and add `import { AutoUpgradeSection } from './AutoUpgradeSection'`.

- [ ] **Step 5: Keep test servers from updating themselves**

In `playwright.config.ts`, add to the `SERVER_ENV` object:

```ts
    // The e2e server is a real build that can rebuild itself; without this a
    // run inside the update window would try to update its own packages.
    TINYCLD_AUTOUPGRADE_DISABLED: '1',
```

In `.github/workflows/smoke-test-image.yml`, change the run line to:

```yaml
          docker run -d --name tinycld-smoke -e TINYCLD_AUTOUPGRADE_DISABLED=1 -p 7090:7090 ${{ steps.imgref.outputs.image }}
```

- [ ] **Step 6: Run the e2e and the checks**

Run:
```bash
cd ~/code/tinycld/tinycld && pnpm exec playwright test tests/e2e/auto-upgrade.spec.ts
pnpm exec tinycld-pkg check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/components/setup/AutoUpgradeSection.tsx core/components/setup/PackageManager.tsx playwright.config.ts .github/workflows/smoke-test-image.yml tests/e2e/auto-upgrade.spec.ts
git commit -m "feat(core): automatic updates section on Settings → Packages"
```

---

### Task 11: Wizard checkbox

**Files:**
- Modify: `core/components/setup/wizard/steps/AppsStep.tsx`
- Modify: `tests/install/setup-and-packages.spec.ts` (bootstrap test)
- Test: `core/components/setup/wizard/steps/__tests__/apps-step.test.ts` (add a case for `autoUpdateChoiceOf`)

**Interfaces:**
- Consumes: `useAutoUpgrade` (Task 9), `pb` from `@tinycld/core/lib/pocketbase`.
- Produces: `export function autoUpdateChoiceOf(status: AutoUpgradeStatus | undefined, value: boolean): { isVisible: boolean; isOn: boolean }` in `app-choices.ts`. Test id `setup-autoupgrade`.

- [ ] **Step 1: Write the failing unit test**

Append to `apps-step.test.ts`:

```ts
import { autoUpdateChoiceOf } from '../app-choices'

describe('autoUpdateChoiceOf', () => {
    it('is hidden until the server says updates are available', () => {
        expect(autoUpdateChoiceOf(undefined, true)).toEqual({ isVisible: false, isOn: true })
        expect(
            autoUpdateChoiceOf({ available: false, reason: 'x', lastRun: '', lastResult: '', nextCheck: '' }, true)
        ).toEqual({ isVisible: false, isOn: true })
    })
    it('shows the stored value when available', () => {
        const status = { available: true, lastRun: '', lastResult: '', nextCheck: '' }
        expect(autoUpdateChoiceOf(status, false)).toEqual({ isVisible: true, isOn: false })
    })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld && pnpm exec vitest run core/components/setup/wizard/steps/__tests__/apps-step.test.ts`
Expected: FAIL (`autoUpdateChoiceOf` is not exported).

- [ ] **Step 3: Add `autoUpdateChoiceOf` to `app-choices.ts`**

```ts
import type { AutoUpgradeStatus } from '@tinycld/core/components/setup/auto-upgrade-logic'

// The wizard offers automatic updates only where the server can do them; on a
// build that cannot update itself the choice would be a promise it cannot keep.
export function autoUpdateChoiceOf(
    status: AutoUpgradeStatus | undefined,
    value: boolean
): { isVisible: boolean; isOn: boolean } {
    return { isVisible: status?.available ?? false, isOn: value }
}
```

- [ ] **Step 4: Add the checkbox to `AppsStep.tsx`**

Add a component and render it under the cards, before `SetupContinueButton`:

```tsx
function AutoUpdateChoice() {
    const au = useAutoUpgrade(pb)
    const choice = autoUpdateChoiceOf(au.status, au.isOn)
    if (!choice.isVisible) return null
    return (
        <Pressable
            testID="setup-autoupgrade"
            onPress={() => au.setOn(!choice.isOn)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: choice.isOn }}
            accessibilityLabel="Upgrade apps automatically when new versions are available"
            className="mb-6 flex-row items-center gap-3"
        >
            <CheckMark isOn={choice.isOn} />
            <Text className="flex-1 text-sm text-foreground">
                Upgrade apps automatically when new versions are available
            </Text>
        </Pressable>
    )
}
```

In `AppsStep`'s return, after the cards `View`:

```tsx
            <AutoUpdateChoice />
```

Imports: `import { pb } from '@tinycld/core/lib/pocketbase'`, `import { useAutoUpgrade } from '@tinycld/core/components/setup/use-auto-upgrade'`, and `autoUpdateChoiceOf` from `./app-choices`.

- [ ] **Step 5: Assert it in the install smoke test**

In `tests/install/setup-and-packages.spec.ts`, in the bootstrap test, before `completeSetupBySkipping(page)` is called, add:

```ts
        // Automatic updates are offered on the apps step and on by default.
        await expectSetupStep(page, CORE_STEP_IDS.apps)
        await expect(page.getByTestId('setup-autoupgrade')).toHaveAttribute('aria-checked', 'true')
```

Import `expectSetupStep` and `CORE_STEP_IDS` from `../../core/e2e-setup-helpers`. If the bootstrap test reaches the apps step only inside `completeSetupBySkipping`, continue the earlier steps with `continueSetupSteps(page, [CORE_STEP_IDS.workspace])` first, then assert, then call `completeSetupBySkipping(page)`.

This test runs in the docker smoke workflow (Task 10 sets `TINYCLD_AUTOUPGRADE_DISABLED=1` there). The flag disables ticks only, so the status is still `available: true` and the checkbox shows.

- [ ] **Step 6: Run the unit test and the checks**

Run:
```bash
cd ~/code/tinycld/tinycld && pnpm exec vitest run core/components/setup/wizard/steps/__tests__/apps-step.test.ts
pnpm exec tinycld-pkg check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/components/setup/wizard/steps/AppsStep.tsx core/components/setup/wizard/steps/app-choices.ts core/components/setup/wizard/steps/__tests__/apps-step.test.ts tests/install/setup-and-packages.spec.ts
git commit -m "feat(core): offer automatic updates in the setup wizard"
```

---

### Task 12: Help topic

**Files:**
- Modify: `core/help/package-versions.md` (new section at the end; add `automatic` to `tags`)

- [ ] **Step 1: Add the section**

```markdown
## Automatic updates

To keep packages up to date without doing it yourself, turn on
**Automatically upgrade packages when new versions are available** at the top of
**Settings → Packages**. It is on for a new server. You can also set it in the setup
wizard, on the step where you choose your apps.

When it is on, the server checks for new versions every hour. It installs them only
inside the **update window** (02:00–05:00 server time unless you change it). It takes
the newest version of each package, including major versions, when the whole set is
compatible. If a major version does not fit, it installs the others and leaves the
major version for later.

**Updates paused.** If no compatible set exists, nothing is installed, and the owner
and admins get one email that names the conflicting packages. The email is sent again
only when the conflict changes, or as a reminder after 7 days. The pause clears itself
when a compatible set is available.

**Blocked updates.** If an update fails its health check after the restart, the server
rolls it back to the previous version and blocks that set of versions. The owner and
admins get one email. A blocked set is not tried again until you select **Clear** next
to it on **Settings → Packages**.

Only the owner can change these settings.
```

- [ ] **Step 2: Regenerate and check**

Run:
```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate && pnpm exec tinycld-pkg check
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/help/package-versions.md
git commit -m "docs(core): help for automatic updates"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full Go suite**

Run: `cd ~/code/tinycld/tinycld/core/server && go test ./...`
Expected: PASS.

- [ ] **Step 2: Hosting parity test (unchanged allowlist)**

Run: `cd ~/code/tinycld/hosting && go test ./tenantboot -run TestTenantCompositionMatchesHostMinusRecordedExceptions -v`
Expected: PASS.

- [ ] **Step 3: Workspace checks**

Run: `cd ~/code/tinycld/tinycld && pnpm run checks && pnpm exec tinycld-pkg check && pnpm run check:core-isolation`
Expected: PASS. `check:core-isolation` must pass without a new allowlist entry.

- [ ] **Step 4: e2e for the new spec and the admin specs it sits beside**

Run: `cd ~/code/tinycld/tinycld && pnpm exec playwright test tests/e2e/auto-upgrade.spec.ts tests/e2e/admin-role-access.spec.ts`
Expected: PASS.
