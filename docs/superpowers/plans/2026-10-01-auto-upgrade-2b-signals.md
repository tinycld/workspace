# Auto-upgrade 2b (soak signals, snapshot retention, rollback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During a soak the rollout engine also watches each upgraded org's 5xx rate and its Sentry errors. The router keeps each upgrade's snapshot until 7 days after its rollout ends, and an operator can roll one org back to that snapshot and its previous build.

**Architecture:**
- The front router counts each org's proxied responses. A new `internal/traffic` package flushes the counts every minute into a new `org_traffic` collection, with one row for each org and each UTC hour.
- The engine stores a 7-day baseline on the `rollout_orgs` row when the deploy starts, and the release (recipe hash) when the deploy commits. Every 15 minutes during a soak, and once more when the soak ends, it compares the soak's numbers with that baseline.
- A new `internal/sentryapi` client reads Sentry's issues and events APIs. Tenants report the `org` tag and a release equal to their recipe hash.
- Each upgrade snapshot gets its own file, named after its deploy job. The router sends the tenant the list of snapshot names to keep, and the tenant deletes the others itself. The router never touches tenant files.
- The rollback route builds the org's previous package set. It writes a restore request for that snapshot, repoints the org and respawns the tenant.

**Tech Stack:** Go (PocketBase fork), the `tinycld.org/hosting` module, `github.com/getsentry/sentry-go`, bash (installer).

**Spec:** `docs/superpowers/specs/2026-10-01-auto-upgrade-2-hosted-rollout-design.md`, the "2b (signals)" scope. Builds on plan `docs/superpowers/plans/2026-10-01-auto-upgrade-2a-rollout-core.md` (hosting PR #65, utils PR #30) and part 3 (utils PR #31).

## Global Constraints

- **Repos and branches**
  - `hosting` (`~/code/tinycld/hosting`): branch `feat/auto-upgrade-signals`, created from `feat/auto-upgrade-core` (PR #65).
  - `utils` (`~/code/tinycld/utils`, Task 11 only): branch `feat/auto-upgrade-signals`, created from `feat/deploy-upgrade` (PR #31).
  - Do not edit the `tinycld` repo. Core does not change in this plan.
  - CI resolves core by branch name. The controller pushes a `feat/auto-upgrade-signals` branch to `tinycld/tinycld` at the head of `feat/auto-upgrade-core` (no new commits) before it opens the hosting PR, unless core PR #309 is already merged.
- **Spec values, verbatim:** "soak ratio > `max(2 × baseline, baseline + 0.5%)` and ≥ 200 requests in the soak". "An org with fewer than 200 requests in the soak uses only the crash and Sentry signals." "Rows older than 30 days are deleted by the hourly sweep." "The check runs every 15 minutes during a soak." "Snapshots are deleted 7 days after their rollout is `done`, `abandoned` or `superseded`."
- **Signal outcome:** this follows the 2a ruling, which overrides the spec's "halts on any signal".
  - Ring 0: a fired signal sets the row to `flagged`, halts the rollout, blocks its fingerprint and alerts. This is `Engine.halt(..., block=true)`, the same path as a ring-0 crash.
  - Rings 1–3: the row goes to `flagged`, an org-level alert is sent, and the rollout continues (`Engine.orgFailed`).
  - The org stays on the new build either way.
- **Sentry:**
  - `MT_SENTRY_API_TOKEN`, `MT_SENTRY_ORG` and `MT_SENTRY_PROJECT` are all needed. `MT_SENTRY_API_URL` is optional (default `https://sentry.io`).
  - All four are read before `scrubSecretEnv` and are added to its list.
  - If any of the three required variables is missing, the router logs one warning at boot and runs with no Sentry signal.
  - A Sentry API error during a check logs a warning and counts as "no signal". A Sentry outage must never flag or halt anything.
- **Decisions this plan makes where the spec is silent** (the controller surfaces these to the user):
  1. **5xx scope.** Only responses that the tenant handler wrote are counted. The cold-start interstitial and a client that hung up (nothing written) are not counted.
  2. **Sentry event-rate floor.** The rate signal needs at least 10 events in the soak, so a zero baseline does not flag on one event.
  3. **Hourly granularity.** The soak's traffic starts at the UTC hour of `deployed_at`, so the first hour mixes pre-deploy and post-deploy requests. The baseline is the 168 hours before the hour in which the deploy started.
  4. **Rollback scope.** Rollback sets the row to `rolled_back` and does not change the rollout's state. The operator abandons the rollout if the target is bad. Rollback needs the body `{"confirm": true}` and refuses with 409 when the org's packages changed after the upgrade.
  5. **No `snapshot_dir` field.** The snapshot name is the row's `deploy_job`, at `<org>/.deploy/upgrade-snapshots/<deploy_job>.db`.
  6. **Prune grace.** A tenant prune never deletes a snapshot file less than 24 hours old. This closes the race between a keep list and a snapshot taken just after it.
- **Data safety:** the router (root) never creates, renames or removes a file inside an org dir. It only uses `tenantcfg.WriteRuntimeFile` and `os.Lstat`. The tenant does every snapshot write, prune and restore as its own uid.
- **Logging:** use `logging.ForPackage("hosting")` in `internal/*` and `tenantboot`. In `cmd/serve-router`, follow the file's existing `log.Printf`/`slog` use. Do not use `fmt.Print*` in runtime code.
- **Comments** explain why, not what. Match the comment density of the file you edit.
- **Before every commit:**
  - `git branch --show-current` must print `feat/auto-upgrade-signals`.
  - Stage explicit paths only.
  - From the hosting module root, `go test ./...` must pass and `gofmt -l .` must print nothing.
  - Do not touch `stash@{0}` in utils (local credentials).
- Commit messages and PR text never mention Claude.

## File map (hosting unless noted)

| File | Responsibility |
|---|---|
| `internal/controlplane/schema.go` | migration `1900000015_rollout_signals.go`: `org_traffic`, `rollout_orgs.baseline`/`release`, state `rolled_back` |
| `internal/traffic/traffic.go` (new) | `Counter` (Observe/Flush), `TotalsBetween`, `Sweep`, `Run`, `HourOf` |
| `internal/frontrouter/frontrouter.go`, `internal/server/serve.go` | `Config.Observe` / `Params.Observe`; status recorder |
| `internal/orgmanager/spawn.go`, `spawn_exec.go`, `manager.go` | `SpawnRequest.Release` → `SENTRY_RELEASE`; `ResidentSlugs` |
| `tenantboot/sentry_scope.go` (new), `tenantboot/register.go` | `org` tag on the Sentry scope |
| `internal/sentryapi/sentryapi.go` (new) | Sentry REST client + env config |
| `internal/rollout/signals.go` (new), `engine.go` | baseline, release, soak signal checks |
| `tenantcfg/deployresult.go` | `RestoreSnapshot.Snapshot`, `UpgradeSnapshotRequest`, `UpgradeSnapshotPath`, `ValidUpgradeSnapshotName` |
| `tenantboot/upgrade_snapshot.go`, `tenantboot/pkg_state.go`, `tenantboot/pkg_deploy.go` | per-job snapshots, prune, restore by name, leave a result a restore is waiting on |
| `internal/orgmanager/backuppush.go` | `UpgradeSnapshot(ctx, slug, job, keep)`, `PruneUpgradeSnapshots` |
| `internal/controlplane/upgrade_snapshots.go` (new), `deploy.go` | `UpgradeSnapshotsToKeep`; per-job snapshot refs; `Rollback` |
| `internal/controlplane/rollback_route.go` (new), `provisioning.go` | `POST /api/orgs/{slug}/rollback` |
| `cmd/serve-router/main.go`, `rollout.go`, `traffic.go` (new) | wiring: counter, Sentry client, snapshot prune sweep |
| `internal/controlplane/rollout_tenant_e2e_test.go` | 5xx-flag and rollback e2e |
| `README.md` | "Automatic upgrades": signals, retention, rollback, new `MT_*` |
| utils `hosting-install/install.sh`, README | `SENTRY_API_*` → `MT_SENTRY_*`, carried on re-run |

---

### Task 1: Schema: `org_traffic`, baseline, release, `rolled_back`

**Files:**
- Modify: `internal/controlplane/schema.go`: append the migration after `1900000014_rollout_org_failed.go`
- Test: `internal/controlplane/schema_autoupgrade_test.go`

**Interfaces:**
- Produces:
  - collection `org_traffic`: `org` text required, `hour` date required, `requests` int, `status_5xx` int; unique index `(org, hour)`, index `(hour)`; superuser-only.
  - `rollout_orgs.baseline` (json), `rollout_orgs.release` (text).
  - `rollout_orgs.state` gains the value `rolled_back`.

- [ ] **Step 1: Write the failing test** (append to `schema_autoupgrade_test.go`)

```go
func TestSchema_RolloutSignals(t *testing.T) {
	cp, _ := newProvCP(t)
	tr, err := cp.App.FindCollectionByNameOrId("org_traffic")
	if err != nil {
		t.Fatal(err)
	}
	if tr.ListRule != nil || tr.ViewRule != nil || tr.CreateRule != nil || tr.UpdateRule != nil || tr.DeleteRule != nil {
		t.Error("org_traffic must be superuser-only")
	}
	for _, f := range []string{"org", "hour", "requests", "status_5xx"} {
		if tr.Fields.GetByName(f) == nil {
			t.Errorf("org_traffic.%s missing", f)
		}
	}
	unique := false
	for _, idx := range tr.Indexes {
		if strings.Contains(idx, "UNIQUE") && strings.Contains(idx, "`org`") && strings.Contains(idx, "`hour`") {
			unique = true
		}
	}
	if !unique {
		t.Errorf("org_traffic needs a unique (org, hour) index: %v", tr.Indexes)
	}

	ros, err := cp.App.FindCollectionByNameOrId("rollout_orgs")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"baseline", "release"} {
		if ros.Fields.GetByName(f) == nil {
			t.Errorf("rollout_orgs.%s missing", f)
		}
	}
	state := ros.Fields.GetByName("state").(*core.SelectField)
	if !slices.Contains(state.Values, "rolled_back") {
		t.Errorf("rollout_orgs.state values = %v, want rolled_back", state.Values)
	}
}

func TestSchema_RolloutSignalsDown(t *testing.T) {
	cp, _ := newProvCP(t)
	for range 2 { // idempotent
		if err := removeRolloutSignals(cp.App); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := cp.App.FindCollectionByNameOrId("org_traffic"); err == nil {
		t.Error("org_traffic still present after down")
	}
}
```

Add `"strings"` to the imports.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/controlplane -run 'TestSchema_RolloutSignals' -v`
Expected: FAIL (`org_traffic` not found; `removeRolloutSignals` undefined, so the build fails).

- [ ] **Step 3: Implement**

In `controlPlaneMigrations()`, after the `1900000014` entry:

```go
	// Soak signals: hourly per-org response counts for the 5xx signal, and
	// the baseline and release a rollout row is judged against; an operator
	// rollback is its own final state. Appended for the same reason as every
	// migration above.
	list.Add(&core.Migration{
		File: "1900000015_rollout_signals.go",
		Up:   addRolloutSignals,
		Down: removeRolloutSignals,
	})
```

Below `removeRolloutOrgFailed`:

```go
// addRolloutSignals adds what the soak signals and the operator rollback
// need:
//
//   - org_traffic: one row per org per UTC hour, requests and 5xx answered by
//     the org's tenant. The 5xx signal compares a soak's ratio with the 7
//     days before the deploy; the router deletes rows older than 30 days.
//   - rollout_orgs.baseline: that 7-day comparison base, fixed when the
//     deploy starts so later traffic cannot move it.
//   - rollout_orgs.release: the recipe hash the org committed on, which is
//     the Sentry release its tenant reports.
//   - rollout_orgs.state "rolled_back": an operator put the org back on its
//     previous build and pre-upgrade data.
func addRolloutSignals(txApp core.App) error {
	if _, err := txApp.FindCollectionByNameOrId("org_traffic"); err != nil {
		tr := core.NewBaseCollection("org_traffic")
		tr.Fields.Add(&core.TextField{Name: "org", Required: true})
		tr.Fields.Add(&core.DateField{Name: "hour", Required: true})
		tr.Fields.Add(&core.NumberField{Name: "requests", OnlyInt: true})
		tr.Fields.Add(&core.NumberField{Name: "status_5xx", OnlyInt: true})
		tr.AddIndex("idx_org_traffic_org_hour", true, "org, hour", "")
		tr.AddIndex("idx_org_traffic_hour", false, "hour", "")
		if err := txApp.Save(tr); err != nil {
			return err
		}
	}

	ros, err := txApp.FindCollectionByNameOrId("rollout_orgs")
	if err != nil {
		return err
	}
	if ros.Fields.GetByName("baseline") == nil {
		ros.Fields.Add(&core.JSONField{Name: "baseline", MaxSize: 2000})
	}
	if ros.Fields.GetByName("release") == nil {
		ros.Fields.Add(&core.TextField{Name: "release"})
	}
	state, ok := ros.Fields.GetByName("state").(*core.SelectField)
	if !ok {
		return errors.New("rollout_orgs.state is not a select field")
	}
	if !slices.Contains(state.Values, "rolled_back") {
		state.Values = append(state.Values, "rolled_back")
	}
	return txApp.Save(ros)
}

func removeRolloutSignals(txApp core.App) error {
	if c, err := txApp.FindCollectionByNameOrId("org_traffic"); err == nil {
		if err := txApp.Delete(c); err != nil {
			return err
		}
	}
	ros, err := txApp.FindCollectionByNameOrId("rollout_orgs")
	if err != nil {
		return nil
	}
	ros.Fields.RemoveByName("baseline")
	ros.Fields.RemoveByName("release")
	if state, ok := ros.Fields.GetByName("state").(*core.SelectField); ok {
		state.Values = slices.DeleteFunc(state.Values, func(v string) bool { return v == "rolled_back" })
	}
	return txApp.Save(ros)
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/controlplane -run 'TestSchema' -v`, then `go test ./...`

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/schema.go internal/controlplane/schema_autoupgrade_test.go
git commit -m "feat(controlplane): org_traffic and rollout signal fields"
```

---

### Task 2: `internal/traffic`: count, flush, total, sweep

**Files:**
- Create: `internal/traffic/traffic.go`
- Test: `internal/traffic/traffic_test.go`

**Interfaces:**
- Consumes: the `org_traffic` collection (Task 1).
- Produces:
  - `type Totals struct{ Requests, Status5xx int64 }`
  - `func HourOf(t time.Time) time.Time`: UTC, truncated to the hour
  - `func NewCounter(now func() time.Time) *Counter`
  - `func (c *Counter) Observe(slug string, status int)`
  - `func (c *Counter) Flush(app core.App) error`
  - `func TotalsBetween(app core.App, slug string, from, to time.Time) (Totals, error)`: rows with `from <= hour < to`
  - `func Sweep(app core.App, now time.Time) error`: deletes rows with `hour < HourOf(now) - Retention`
  - `const Retention = 30 * 24 * time.Hour`
  - `func Run(ctx context.Context, app core.App, c *Counter, flushEvery time.Duration)`

- [ ] **Step 1: Write the failing tests**

```go
package traffic

import (
	"testing"
	"time"

	"tinycld.org/hosting/internal/controlplane"
)

var t0 = time.Date(2026, 10, 1, 3, 20, 0, 0, time.UTC)

func TestObserveFlushTotals(t *testing.T) {
	app := controlplane.NewForTest(t).App
	clock := t0
	c := NewCounter(func() time.Time { return clock })
	c.Observe("acme", 200)
	c.Observe("acme", 502)
	c.Observe("acme", 404) // a 4xx is a request, not an error
	c.Observe("beta", 500)
	if err := c.Flush(app); err != nil {
		t.Fatal(err)
	}
	clock = t0.Add(time.Hour)
	c.Observe("acme", 503)
	if err := c.Flush(app); err != nil {
		t.Fatal(err)
	}
	// A second flush of the same hour adds to its row rather than replacing it.
	c.Observe("acme", 200)
	if err := c.Flush(app); err != nil {
		t.Fatal(err)
	}

	got, err := TotalsBetween(app, "acme", HourOf(t0), HourOf(t0).Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if got != (Totals{Requests: 5, Status5xx: 2}) {
		t.Fatalf("acme totals = %+v", got)
	}
	first, _ := TotalsBetween(app, "acme", HourOf(t0), HourOf(t0).Add(time.Hour))
	if first != (Totals{Requests: 3, Status5xx: 1}) {
		t.Fatalf("acme first hour = %+v (the upper bound is exclusive)", first)
	}
	beta, _ := TotalsBetween(app, "beta", HourOf(t0), HourOf(t0).Add(time.Hour))
	if beta != (Totals{Requests: 1, Status5xx: 1}) {
		t.Fatalf("beta = %+v", beta)
	}
	none, _ := TotalsBetween(app, "nobody", HourOf(t0), HourOf(t0).Add(time.Hour))
	if none != (Totals{}) {
		t.Fatalf("unknown org = %+v", none)
	}
}

func TestFlushKeepsCountsWhenTheWriteFails(t *testing.T) {
	cp := controlplane.NewForTest(t)
	c := NewCounter(func() time.Time { return t0 })
	c.Observe("acme", 500)
	col, err := cp.App.FindCollectionByNameOrId(Collection)
	if err != nil {
		t.Fatal(err)
	}
	if err := cp.App.Delete(col); err != nil {
		t.Fatal(err)
	}
	if err := c.Flush(cp.App); err == nil {
		t.Fatal("Flush with no collection must fail")
	}
	if err := addRolloutSignalsForTest(cp.App); err != nil {
		t.Fatal(err)
	}
	if err := c.Flush(cp.App); err != nil {
		t.Fatal(err)
	}
	got, _ := TotalsBetween(cp.App, "acme", HourOf(t0), HourOf(t0).Add(time.Hour))
	if got != (Totals{Requests: 1, Status5xx: 1}) {
		t.Fatalf("after retry = %+v, want the count kept from the failed flush", got)
	}
}

func TestSweepDropsRowsOlderThan30Days(t *testing.T) {
	app := controlplane.NewForTest(t).App
	clock := t0.Add(-Retention - time.Hour)
	c := NewCounter(func() time.Time { return clock })
	c.Observe("acme", 200)
	clock = t0.Add(-Retention + time.Hour)
	c.Observe("acme", 200)
	if err := c.Flush(app); err != nil {
		t.Fatal(err)
	}
	if err := Sweep(app, t0); err != nil {
		t.Fatal(err)
	}
	got, _ := TotalsBetween(app, "acme", t0.Add(-60*24*time.Hour), t0)
	if got.Requests != 1 {
		t.Fatalf("after sweep = %+v, want only the row inside 30 days", got)
	}
}
```

For `addRolloutSignalsForTest`, add `export_test.go`-style access in controlplane. Create `internal/controlplane/export_signals.go`, a non-test file that test packages outside controlplane can call:

```go
package controlplane

import "github.com/pocketbase/pocketbase/core"

// AddRolloutSignalsForTest re-runs the org_traffic migration, for a test
// that removed the collection to make a write fail.
func AddRolloutSignalsForTest(app core.App) error { return addRolloutSignals(app) }
```

In the test, use `controlplane.AddRolloutSignalsForTest(cp.App)` in place of `addRolloutSignalsForTest(cp.App)`.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/traffic -v`
Expected: build failure (package `traffic` is empty).

- [ ] **Step 3: Implement `internal/traffic/traffic.go`**

```go
// Package traffic counts the responses each org's tenant answers, per UTC
// hour, for the rollout engine's 5xx signal. Counting is in memory on the
// request path; a loop adds the counts to org_traffic once a minute, so a
// request never waits on the control plane's database.
package traffic

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"tinycld.org/core/logging"
)

var log = logging.ForPackage("hosting")

const Collection = "org_traffic"

// Retention is how long org_traffic keeps an hour. A baseline reads 7 days;
// the rest is room for an operator looking back at an incident.
const Retention = 30 * 24 * time.Hour

type Totals struct {
	Requests  int64
	Status5xx int64
}

func (t Totals) add(o Totals) Totals {
	return Totals{Requests: t.Requests + o.Requests, Status5xx: t.Status5xx + o.Status5xx}
}

// HourOf is the org_traffic bucket a moment falls in.
func HourOf(t time.Time) time.Time { return t.UTC().Truncate(time.Hour) }

type key struct {
	slug string
	hour time.Time
}

type Counter struct {
	now    func() time.Time
	mu     sync.Mutex
	counts map[key]Totals
}

func NewCounter(now func() time.Time) *Counter {
	return &Counter{now: now, counts: map[key]Totals{}}
}

func (c *Counter) Observe(slug string, status int) {
	t := Totals{Requests: 1}
	if status >= 500 && status <= 599 {
		t.Status5xx = 1
	}
	k := key{slug: slug, hour: HourOf(c.now())}
	c.mu.Lock()
	c.counts[k] = c.counts[k].add(t)
	c.mu.Unlock()
}

// Flush adds the counts gathered since the last flush to org_traffic. A
// bucket whose write fails goes back into the counter, so the next flush
// retries it rather than losing it.
func (c *Counter) Flush(app core.App) error {
	c.mu.Lock()
	pending := c.counts
	c.counts = map[key]Totals{}
	c.mu.Unlock()

	var errs []error
	for k, t := range pending {
		if err := addHour(app, k.slug, k.hour, t); err != nil {
			errs = append(errs, err)
			c.mu.Lock()
			c.counts[k] = c.counts[k].add(t)
			c.mu.Unlock()
		}
	}
	return errors.Join(errs...)
}

func addHour(app core.App, slug string, hour time.Time, t Totals) error {
	at, err := types.ParseDateTime(hour)
	if err != nil {
		return err
	}
	return app.RunInTransaction(func(tx core.App) error {
		rec, err := tx.FindFirstRecordByFilter(Collection, "org = {:o} && hour = {:h}",
			dbx.Params{"o": slug, "h": at.String()})
		if errors.Is(err, sql.ErrNoRows) {
			col, cErr := tx.FindCollectionByNameOrId(Collection)
			if cErr != nil {
				return cErr
			}
			rec = core.NewRecord(col)
			rec.Set("org", slug)
			rec.Set("hour", at)
		} else if err != nil {
			return err
		}
		rec.Set("requests", int64(rec.GetInt("requests"))+t.Requests)
		rec.Set("status_5xx", int64(rec.GetInt("status_5xx"))+t.Status5xx)
		return tx.Save(rec)
	})
}

// TotalsBetween sums an org's hours from from (inclusive) to to (exclusive).
// Both are compared as stored strings, which sort as times because every
// row is written in the same UTC layout.
func TotalsBetween(app core.App, slug string, from, to time.Time) (Totals, error) {
	f, err := types.ParseDateTime(HourOf(from))
	if err != nil {
		return Totals{}, err
	}
	u, err := types.ParseDateTime(HourOf(to))
	if err != nil {
		return Totals{}, err
	}
	var out struct {
		Requests  int64 `db:"requests"`
		Status5xx int64 `db:"s5xx"`
	}
	err = app.DB().NewQuery(
		"SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(status_5xx), 0) AS s5xx " +
			"FROM " + Collection + " WHERE org = {:o} AND hour >= {:f} AND hour < {:t}").
		Bind(dbx.Params{"o": slug, "f": f.String(), "t": u.String()}).
		One(&out)
	return Totals{Requests: out.Requests, Status5xx: out.Status5xx}, err
}

func Sweep(app core.App, now time.Time) error {
	cut, err := types.ParseDateTime(HourOf(now).Add(-Retention))
	if err != nil {
		return err
	}
	_, err = app.DB().NewQuery("DELETE FROM " + Collection + " WHERE hour < {:c}").
		Bind(dbx.Params{"c": cut.String()}).Execute()
	return err
}

// Run flushes every flushEvery and sweeps once an hour until ctx ends. It
// does not flush on the way out: the control plane closes during shutdown,
// and at most one interval of counts is lost.
func Run(ctx context.Context, app core.App, c *Counter, flushEvery time.Duration) {
	t := time.NewTicker(flushEvery)
	defer t.Stop()
	var lastSweep time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			if err := c.Flush(app); err != nil {
				log.Warn("traffic: flush failed; counts kept for the next flush", "error", err)
			}
			if now.Sub(lastSweep) >= time.Hour {
				if err := Sweep(app, now); err != nil {
					log.Warn("traffic: sweep failed", "error", err)
				}
				lastSweep = now
			}
		}
	}
}
```

If `controlplane.NewForTest` does not run migration `1900000015`, check how `NewForTest` builds its schema, and make it run the full list.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/traffic -v -race`, then `go test ./...`

- [ ] **Step 5: Commit**

```bash
git add internal/traffic/traffic.go internal/traffic/traffic_test.go internal/controlplane/export_signals.go
git commit -m "feat(traffic): count org responses per hour into org_traffic"
```

---

### Task 3: The front router counts what each tenant answers

**Files:**
- Modify: `internal/frontrouter/frontrouter.go` (`Config.Observe`, `serveOrg`)
- Modify: `internal/server/serve.go` (`Params.Observe` → `frontrouter.Config.Observe`)
- Create: `cmd/serve-router/traffic.go`
- Modify: `cmd/serve-router/main.go` (build the counter, pass `Observe`, start `traffic.Run`)
- Test: `internal/frontrouter/frontrouter_test.go`

**Interfaces:**
- Consumes: `traffic.NewCounter`, `(*Counter).Observe`, `traffic.Run` (Task 2).
- Produces:
  - `frontrouter.Config.Observe func(slug string, status int)`: called once for each org response that the tenant handler wrote a status for. Nil disables counting.
  - `server.Params.Observe`, with the same type.

- [ ] **Step 1: Write the failing tests** (append to `frontrouter_test.go`; reuse the file's existing helpers for building a `FrontRouter` with a fake `GetOrg`, and keep their names)

```go
func TestObserveCountsTenantResponses(t *testing.T) {
	type obs struct {
		slug   string
		status int
	}
	var got []obs
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/boom":
			w.WriteHeader(http.StatusBadGateway)
		case "/silent":
			// The client hung up: the proxy writes nothing.
		case "/stream":
			if err := http.NewResponseController(w).Flush(); err != nil {
				t.Errorf("flush through the recorder: %v", err)
			}
			_, _ = w.Write([]byte("data"))
		default:
			_, _ = w.Write([]byte("ok"))
		}
	})
	f := New(Config{
		BaseDomain: "example.test",
		GetOrg:     func(context.Context, string) (http.Handler, error) { return handler, nil },
		Observe:    func(slug string, status int) { got = append(got, obs{slug, status}) },
	})
	for _, path := range []string{"/", "/boom", "/silent", "/stream"} {
		req := httptest.NewRequest(http.MethodGet, "http://acme.example.test"+path, nil)
		f.ServeHTTP(httptest.NewRecorder(), req)
	}
	want := []obs{{"acme", 200}, {"acme", 502}, {"acme", 200}}
	if !slices.Equal(got, want) {
		t.Fatalf("observed %v, want %v", got, want)
	}
}

func TestObserveSkipsUnavailableAndUnknown(t *testing.T) {
	called := false
	f := New(Config{
		BaseDomain: "example.test",
		GetOrg: func(_ context.Context, slug string) (http.Handler, error) {
			if slug == "cold" {
				return nil, orgerr.ErrOrgUnavailable
			}
			return nil, errors.New("unknown org")
		},
		Observe: func(string, int) { called = true },
	})
	for _, host := range []string{"cold.example.test", "nobody.example.test"} {
		f.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://"+host+"/", nil))
	}
	if called {
		t.Fatal("the interstitial and the not-found page are the router's, not the tenant's: not counted")
	}
}
```

Add the imports the file lacks (`slices`, `errors`, `orgerr`).

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/frontrouter -run TestObserve -v`
Expected: build failure (`Config.Observe` undefined).

- [ ] **Step 3: Implement**

In `Config`, after `LookupHost`:

```go
	// Observe receives the status of every response an org's tenant wrote,
	// for the rollout engine's 5xx signal (internal/traffic). The router's
	// own pages — the starting-up interstitial, not-found — are not the
	// tenant's answers and are not observed, nor is a request the client
	// abandoned before anything was written. Nil observes nothing.
	Observe func(slug string, status int)
```

In `serveOrg`, replace the `case err == nil && h != nil:` body:

```go
	case err == nil && h != nil:
		if f.cfg.Observe == nil {
			h.ServeHTTP(w, r)
			return
		}
		rec := &statusRecorder{ResponseWriter: w}
		h.ServeHTTP(rec, r)
		if rec.status != 0 {
			f.cfg.Observe(slug, rec.status)
		}
```

At the end of the file:

```go
// statusRecorder notes the first final status a handler writes. Unwrap lets
// http.ResponseController reach the real writer, so the tenant proxy's
// flushes (SSE) and hijacks (WebSocket upgrades) pass straight through.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 && code >= 200 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }
```

In `internal/server/serve.go`, add to `Params`:

```go
	// Observe is frontrouter.Config.Observe.
	Observe func(slug string, status int)
```

and pass `Observe: p.Observe,` in `BuildHandler`.

Create `cmd/serve-router/traffic.go`:

```go
package main

import (
	"time"

	"tinycld.org/hosting/internal/traffic"
)

// trafficFlushEvery is how often counted responses reach org_traffic. The
// 5xx signal checks every 15 minutes, so a minute's lag is noise.
const trafficFlushEvery = time.Minute

func newTrafficCounter() *traffic.Counter { return traffic.NewCounter(time.Now) }
```

In `main.go` `run`:
- Before `server.Serve`, build `counter := newTrafficCounter()` and start `go traffic.Run(ctx, cp.App, counter, trafficFlushEvery)`. Place it next to the other `go ...` loops after `ctx` exists.
- Pass `Observe: counter.Observe,` in the `server.Params{...}` literal.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/frontrouter ./internal/server ./cmd/serve-router -v -run 'TestObserve|TestBuildHandler'`, then `go test ./...`

- [ ] **Step 5: Commit**

```bash
git add internal/frontrouter/frontrouter.go internal/frontrouter/frontrouter_test.go internal/server/serve.go cmd/serve-router/traffic.go cmd/serve-router/main.go
git commit -m "feat(frontrouter): count each org's tenant responses for the 5xx signal"
```

---

### Task 4: Tenants report the `org` tag and their release to Sentry

**Files:**
- Modify: `internal/orgmanager/spawn.go` (`SpawnRequest.Release`)
- Modify: `internal/orgmanager/spawn_exec.go` (`SENTRY_RELEASE` env)
- Modify: `internal/orgmanager/manager.go` (pass `rec.RecipeHash`: add `release string` to `runtimeConfigs`, set it where `runtimeConfigs{...}` is built, and pass `Release: cfgs.release` in the `SpawnRequest{...}` literal)
- Create: `tenantboot/sentry_scope.go`
- Modify: `tenantboot/register.go` (call `tagSentryScope(opts.Slug)` at the start of `RegisterTenant`)
- Test: `internal/orgmanager/spawn_exec_test.go` (or the file that tests the exec command's env, if one exists), `tenantboot/sentry_scope_test.go`

**Interfaces:**
- Produces:
  - `orgmanager.SpawnRequest.Release string`
  - `func tagSentryScope(slug string)` (tenantboot, unexported)
  - Tenant events carry `tags.org = <slug>` and `release = <recipe_hash>`.

Core's `initSentryFromConfig` calls `sentry.Init` with no `Release`. sentry-go then reads `SENTRY_RELEASE` from the environment (`defaultRelease`, sentry-go `util.go`). `sentry.Init` rebinds only the client, so tags set on the hub's scope survive every re-init. Core does not change.

- [ ] **Step 1: Write the failing tests**

`tenantboot/sentry_scope_test.go`:

```go
package tenantboot

import (
	"testing"

	"github.com/getsentry/sentry-go"
)

type captureTransport struct{ events []*sentry.Event }

func (c *captureTransport) Configure(sentry.ClientOptions)        {}
func (c *captureTransport) SendEvent(e *sentry.Event)             { c.events = append(c.events, e) }
func (c *captureTransport) Flush(time.Duration) bool              { return true }
func (c *captureTransport) FlushWithContext(context.Context) bool { return true }
func (c *captureTransport) Close()                                {}

// The org tag must survive a later sentry.Init, which is how core applies
// the operator's DSN once system settings load.
func TestTagSentryScopeSurvivesReinit(t *testing.T) {
	tagSentryScope("acme")
	tr := &captureTransport{}
	if err := sentry.Init(sentry.ClientOptions{Dsn: "https://k@example.test/1", Transport: tr}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sentry.Init(sentry.ClientOptions{}) })
	sentry.CaptureMessage("x")
	if len(tr.events) != 1 || tr.events[0].Tags["org"] != "acme" {
		t.Fatalf("events = %+v, want one tagged org=acme", tr.events)
	}
}
```

If the installed sentry-go `Transport` interface has a different method set, match it and keep the test's intent. Add imports `context` and `time`.

For the exec env, add a test next to the existing tests of the function that builds `exec.Cmd` in `spawn_exec.go`. Find the function name and its tests with `grep -n "cmd.Env" -B40 internal/orgmanager/spawn_exec.go`.

```go
func TestSpawnEnvCarriesRelease(t *testing.T) {
	cmd := buildTenantCmd(SpawnRequest{ /* the minimal fields the existing tests use */ Release: "abc123"}, quietLogger())
	if !slices.Contains(cmd.Env, "SENTRY_RELEASE=abc123") {
		t.Fatalf("env = %v", cmd.Env)
	}
	cmd = buildTenantCmd(SpawnRequest{ /* same */ }, quietLogger())
	for _, kv := range cmd.Env {
		if strings.HasPrefix(kv, "SENTRY_RELEASE=") {
			t.Fatalf("no release must set no SENTRY_RELEASE: %v", cmd.Env)
		}
	}
}
```

Use the real builder function name in place of `buildTenantCmd`, and the package's existing quiet-logger helper.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./tenantboot -run TestTagSentryScope -v` and `go test ./internal/orgmanager -run TestSpawnEnvCarriesRelease -v`
Expected: build failures.

- [ ] **Step 3: Implement**

`tenantboot/sentry_scope.go`:

```go
package tenantboot

import "github.com/getsentry/sentry-go"

// tagSentryScope marks every event this tenant reports with its org, so the
// router's rollout engine can count one org's errors in a Sentry project the
// whole fleet shares. The release (the build's recipe hash) comes from
// SENTRY_RELEASE, which the router sets when it spawns the tenant.
func tagSentryScope(slug string) {
	sentry.ConfigureScope(func(s *sentry.Scope) { s.SetTag("org", slug) })
}
```

`spawn.go`, in `SpawnRequest`:

```go
	// Release is the org's recipe hash. The tenant reports it as its Sentry
	// release (SENTRY_RELEASE), so a new error can be traced to the build
	// that introduced it. Empty sets nothing.
	Release string
```

In `spawn_exec.go`, after the `cmd.Env = []string{...}` literal:

```go
	if req.Release != "" {
		cmd.Env = append(cmd.Env, "SENTRY_RELEASE="+req.Release)
	}
```

The release is a router-trusted hash and is not tenant input. It is still validated, because env lines go to a process: in the manager, set `release` only when the recipe hash matches `^[A-Za-z0-9._-]{1,200}$`, and leave it empty otherwise.

- [ ] **Step 4: Run, expect PASS**

Run the two tests, then `go test ./...`. The composition parity tests must still pass, because no hook is added.

- [ ] **Step 5: Commit**

```bash
git add tenantboot/sentry_scope.go tenantboot/sentry_scope_test.go tenantboot/register.go internal/orgmanager/spawn.go internal/orgmanager/spawn_exec.go internal/orgmanager/manager.go internal/orgmanager/<exec test file>
git commit -m "feat(tenant): tag Sentry events with the org and the build's release"
```

---

### Task 5: `internal/sentryapi`: the router's Sentry client

**Files:**
- Create: `internal/sentryapi/sentryapi.go`
- Test: `internal/sentryapi/sentryapi_test.go`

**Interfaces:**
- Produces:
  - `type Client struct { BaseURL, Token, Org, Project string; HTTP *http.Client }`
  - `func FromEnv(getenv func(string) string) (*Client, bool)`: false when any of `MT_SENTRY_API_TOKEN`, `MT_SENTRY_ORG`, `MT_SENTRY_PROJECT` is empty. `MT_SENTRY_API_URL` defaults to `https://sentry.io`.
  - `var EnvKeys = []string{"MT_SENTRY_API_TOKEN", "MT_SENTRY_ORG", "MT_SENTRY_PROJECT", "MT_SENTRY_API_URL"}`
  - `func (c *Client) NewIssues(ctx context.Context, org, release string) (int, error)`
  - `func (c *Client) EventCount(ctx context.Context, org string, start, end time.Time) (int64, error)`

The two endpoints:
- New issues: `GET {base}/api/0/projects/{Org}/{Project}/issues/?query=firstRelease:"{release}" org:{org}&statsPeriod=14d`. The response is a JSON array, and the count is its length.
- Events: `GET {base}/api/0/organizations/{Org}/events/?dataset=errors&field=count()&query=project:{Project} org:{org}&start={RFC3339}&end={RFC3339}`. The response is `{"data":[{"count()":N}]}`.

Both requests send `Authorization: Bearer {Token}`. A non-200 response is an error that includes the status. Bodies are read through `io.LimitReader(…, 1<<20)`. The default `HTTP` timeout is 30s.

- [ ] **Step 1: Write the failing tests**

```go
package sentryapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func fake(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &Client{BaseURL: srv.URL, Token: "tok", Org: "acme-co", Project: "tenants", HTTP: srv.Client()}
}

func TestNewIssues(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/0/projects/acme-co/tenants/issues/" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("auth = %q", got)
		}
		if q := r.URL.Query().Get("query"); q != `firstRelease:"abc" org:shop` {
			t.Errorf("query = %q", q)
		}
		_ = json.NewEncoder(w).Encode([]map[string]string{{"id": "1"}, {"id": "2"}})
	})
	n, err := c.NewIssues(context.Background(), "shop", "abc")
	if err != nil || n != 2 {
		t.Fatalf("NewIssues = %d, %v", n, err)
	}
}

func TestEventCount(t *testing.T) {
	start := time.Date(2026, 10, 1, 2, 0, 0, 0, time.UTC)
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.URL.Path != "/api/0/organizations/acme-co/events/" || q.Get("field") != "count()" ||
			q.Get("dataset") != "errors" || q.Get("query") != "project:tenants org:shop" ||
			q.Get("start") != "2026-10-01T02:00:00Z" || q.Get("end") != "2026-10-01T03:00:00Z" {
			t.Errorf("request = %s %v", r.URL.Path, q)
		}
		_, _ = w.Write([]byte(`{"data":[{"count()":17}]}`))
	})
	n, err := c.EventCount(context.Background(), "shop", start, start.Add(time.Hour))
	if err != nil || n != 17 {
		t.Fatalf("EventCount = %d, %v", n, err)
	}
}

func TestErrorStatus(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", http.StatusForbidden) })
	if _, err := c.NewIssues(context.Background(), "shop", "abc"); err == nil {
		t.Fatal("403 must be an error")
	}
	if _, err := c.EventCount(context.Background(), "shop", time.Now(), time.Now()); err == nil {
		t.Fatal("403 must be an error")
	}
}

func TestFromEnv(t *testing.T) {
	env := map[string]string{"MT_SENTRY_API_TOKEN": "t", "MT_SENTRY_ORG": "o", "MT_SENTRY_PROJECT": "p"}
	c, ok := FromEnv(func(k string) string { return env[k] })
	if !ok || c.BaseURL != "https://sentry.io" || c.Token != "t" || c.Org != "o" || c.Project != "p" {
		t.Fatalf("FromEnv = %+v %v", c, ok)
	}
	delete(env, "MT_SENTRY_PROJECT")
	if _, ok := FromEnv(func(k string) string { return env[k] }); ok {
		t.Fatal("a missing project must disable the client")
	}
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/sentryapi -v`

- [ ] **Step 3: Implement `internal/sentryapi/sentryapi.go`**

```go
// Package sentryapi reads the two numbers the rollout engine's Sentry signal
// needs: how many issues a release introduced for one org, and how many
// error events one org sent in a span of time. Tenants tag their events with
// org=<slug> and report their recipe hash as the release (tenantboot), so
// both are queries over the fleet's one Sentry project.
package sentryapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var EnvKeys = []string{"MT_SENTRY_API_TOKEN", "MT_SENTRY_ORG", "MT_SENTRY_PROJECT", "MT_SENTRY_API_URL"}

const defaultBaseURL = "https://sentry.io"

const replyLimit = 1 << 20

type Client struct {
	BaseURL string
	Token   string
	Org     string // the Sentry organization slug
	Project string // the Sentry project the tenants report to
	HTTP    *http.Client
}

func FromEnv(getenv func(string) string) (*Client, bool) {
	c := &Client{
		BaseURL: strings.TrimRight(getenv("MT_SENTRY_API_URL"), "/"),
		Token:   getenv("MT_SENTRY_API_TOKEN"),
		Org:     getenv("MT_SENTRY_ORG"),
		Project: getenv("MT_SENTRY_PROJECT"),
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
	if c.BaseURL == "" {
		c.BaseURL = defaultBaseURL
	}
	return c, c.Token != "" && c.Org != "" && c.Project != ""
}

// NewIssues counts the issues whose first event came from release in org.
func (c *Client) NewIssues(ctx context.Context, org, release string) (int, error) {
	q := url.Values{}
	q.Set("query", fmt.Sprintf("firstRelease:%q org:%s", release, org))
	q.Set("statsPeriod", "14d")
	var issues []json.RawMessage
	if err := c.get(ctx, fmt.Sprintf("/api/0/projects/%s/%s/issues/", url.PathEscape(c.Org), url.PathEscape(c.Project)), q, &issues); err != nil {
		return 0, err
	}
	return len(issues), nil
}

// EventCount counts org's error events from start to end.
func (c *Client) EventCount(ctx context.Context, org string, start, end time.Time) (int64, error) {
	q := url.Values{}
	q.Set("dataset", "errors")
	q.Set("field", "count()")
	q.Set("query", fmt.Sprintf("project:%s org:%s", c.Project, org))
	q.Set("start", start.UTC().Format(time.RFC3339))
	q.Set("end", end.UTC().Format(time.RFC3339))
	var out struct {
		Data []map[string]int64 `json:"data"`
	}
	if err := c.get(ctx, fmt.Sprintf("/api/0/organizations/%s/events/", url.PathEscape(c.Org)), q, &out); err != nil {
		return 0, err
	}
	if len(out.Data) == 0 {
		return 0, nil
	}
	return out.Data[0]["count()"], nil
}

func (c *Client) get(ctx context.Context, path string, q url.Values, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("sentry %s: %w", path, err)
	}
	defer resp.Body.Close()
	body := io.LimitReader(resp.Body, replyLimit)
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(body, 512))
		return fmt.Errorf("sentry %s: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	if err := json.NewDecoder(body).Decode(into); err != nil {
		return fmt.Errorf("sentry %s: decode: %w", path, err)
	}
	return nil
}
```

The `%q` in `NewIssues` produces `firstRelease:"abc"`, which is what the test expects.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/sentryapi -v`, then `go test ./...`

- [ ] **Step 5: Commit**

```bash
git add internal/sentryapi/sentryapi.go internal/sentryapi/sentryapi_test.go
git commit -m "feat(sentryapi): new-issue and event-count queries for one org"
```

---

### Task 6: The engine watches 5xx and Sentry during a soak

**Files:**
- Create: `internal/rollout/signals.go`
- Modify: `internal/rollout/engine.go`
  - `Deps.Sentry`
  - `Engine.lastSignal`
  - baseline in `deployNext`
  - release in `observeDeploys`
  - signal check in `checkSoaks`, which now takes `ctx`
- Modify: `cmd/serve-router/rollout.go`: `newRolloutEngine` takes `sentry rollout.SentryAPI` and sets `Deps.Sentry`
- Modify: `cmd/serve-router/main.go`
  - read `sentryapi.FromEnv(os.Getenv)` before `scrubSecretEnv`
  - log one warning when it is not configured
  - append `sentryapi.EnvKeys` to `scrubSecretEnv`'s list
  - pass the client, or nil, to `newRolloutEngine`
- Test: `internal/rollout/signals_test.go`

**Interfaces:**
- Consumes: `traffic.TotalsBetween`, `traffic.HourOf`, `traffic.Totals` (Task 2); `rollout_orgs.baseline`/`release` (Task 1).
- Produces:

```go
type SentryAPI interface {
	NewIssues(ctx context.Context, org, release string) (int, error)
	EventCount(ctx context.Context, org string, start, end time.Time) (int64, error)
}
type Baseline struct {
	Requests     int64   `json:"requests"`
	Status5xx    int64   `json:"status5xx"`
	SentryEvents *int64  `json:"sentryEvents,omitempty"`
	Hours        float64 `json:"hours"`
}
const (
	BaselineWindow  = 7 * 24 * time.Hour
	SignalEvery     = 15 * time.Minute
	MinSoakRequests = 200
	MinSoakEvents   = 10
)
func fivexxFires(base Baseline, soak traffic.Totals) bool
func sentryRateFires(base Baseline, events int64, soakHours float64) bool
```

`*sentryapi.Client` satisfies `SentryAPI`. A nil `Deps.Sentry` turns the Sentry signal off. In Go, a nil `*sentryapi.Client` stored in the interface is not a nil interface. So in `main.go`, pass a literal `nil` when the client is not configured, not a nil pointer.

- [ ] **Step 1: Write the failing tests** (`internal/rollout/signals_test.go`)

```go
package rollout

import (
	"context"
	"errors"
	"testing"
	"time"

	"tinycld.org/hosting/internal/traffic"
)

func ptr(n int64) *int64 { return &n }

func TestFivexxFires(t *testing.T) {
	cases := []struct {
		name string
		base Baseline
		soak traffic.Totals
		want bool
	}{
		{"too few requests", Baseline{Requests: 1000}, traffic.Totals{Requests: 199, Status5xx: 199}, false},
		{"zero baseline, under 0.5%", Baseline{}, traffic.Totals{Requests: 1000, Status5xx: 5}, false},
		{"zero baseline, over 0.5%", Baseline{}, traffic.Totals{Requests: 1000, Status5xx: 6}, true},
		{"1% baseline, 2.0% soak", Baseline{Requests: 1000, Status5xx: 10}, traffic.Totals{Requests: 1000, Status5xx: 20}, false},
		{"1% baseline, 2.1% soak", Baseline{Requests: 1000, Status5xx: 10}, traffic.Totals{Requests: 1000, Status5xx: 21}, true},
		{"0.1% baseline uses +0.5%", Baseline{Requests: 1000, Status5xx: 1}, traffic.Totals{Requests: 1000, Status5xx: 6}, false},
	}
	for _, c := range cases {
		if got := fivexxFires(c.base, c.soak); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

func TestSentryRateFires(t *testing.T) {
	week := BaselineWindow.Hours()
	if sentryRateFires(Baseline{Hours: week}, 50, 1) {
		t.Error("no Sentry baseline (nil) must not fire")
	}
	if sentryRateFires(Baseline{SentryEvents: ptr(0), Hours: week}, 9, 1) {
		t.Error("fewer than MinSoakEvents must not fire")
	}
	if !sentryRateFires(Baseline{SentryEvents: ptr(0), Hours: week}, 10, 1) {
		t.Error("10 events on a zero baseline fires")
	}
	// 168 events a week is 1/hour; 2/hour is not above 2x, 2.5/hour is.
	if sentryRateFires(Baseline{SentryEvents: ptr(168), Hours: week}, 20, 10) {
		t.Error("exactly 2x must not fire")
	}
	if !sentryRateFires(Baseline{SentryEvents: ptr(168), Hours: week}, 25, 10) {
		t.Error("2.5x fires")
	}
}

type fakeSentry struct {
	issues int
	events int64
	err    error
	calls  int
}

func (f *fakeSentry) NewIssues(context.Context, string, string) (int, error) {
	f.calls++
	return f.issues, f.err
}
func (f *fakeSentry) EventCount(context.Context, string, time.Time, time.Time) (int64, error) {
	return f.events, f.err
}

// soakingWorld is one sentinel org mid-soak at the start of the window.
func soakingWorld(t *testing.T) (*fakeWorld, *Engine) {
	t.Helper()
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	e := w.engine()
	e.d.Config = shortSoaks()
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "committed" })
	_ = e.Tick(context.Background(), now)
	_ = e.Tick(context.Background(), now.Add(time.Minute))
	if s := w.rolloutOrg(t, "s1").GetString("state"); s != "soaking" {
		t.Fatalf("setup: s1 = %s", s)
	}
	return w, e
}

func observe(t *testing.T, w *fakeWorld, at time.Time, ok, failed int) {
	t.Helper()
	c := traffic.NewCounter(func() time.Time { return at })
	for range ok {
		c.Observe("s1", 200)
	}
	for range failed {
		c.Observe("s1", 500)
	}
	if err := c.Flush(w.app); err != nil {
		t.Fatal(err)
	}
}

func TestSoak5xxFlagsRing0(t *testing.T) {
	w, e := soakingWorld(t)
	observe(t, w, now.Add(5*time.Minute), 190, 10)
	_ = e.Tick(context.Background(), now.Add(20*time.Minute))
	if s := w.rolloutOrg(t, "s1").GetString("state"); s != "flagged" {
		t.Fatalf("s1 = %s, want flagged", s)
	}
	if w.rollout(t).GetString("state") != "halted" || w.blocks() != 1 {
		t.Fatalf("ring 0 must halt and block: rollout=%s blocks=%d", w.rollout(t).GetString("state"), w.blocks())
	}
}

func TestSoakBaselineIsStoredAtDeploy(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	observe(t, w, now.Add(-48*time.Hour), 900, 100)
	e := w.engine()
	e.d.Config = shortSoaks()
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "committed" })
	e.d.Sentry = &fakeSentry{events: 42}
	_ = e.Tick(context.Background(), now)
	var b Baseline
	if err := w.rolloutOrg(t, "s1").UnmarshalJSONField("baseline", &b); err != nil {
		t.Fatal(err)
	}
	if b.Requests != 1000 || b.Status5xx != 100 || b.SentryEvents == nil || *b.SentryEvents != 42 || b.Hours != BaselineWindow.Hours() {
		t.Fatalf("baseline = %+v", b)
	}
}

func TestSoakHighBaselineDoesNotFlag(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	observe(t, w, now.Add(-48*time.Hour), 900, 100) // 10% before the upgrade
	e := w.engine()
	e.d.Config = shortSoaks()
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "committed" })
	_ = e.Tick(context.Background(), now)
	_ = e.Tick(context.Background(), now.Add(time.Minute))
	observe(t, w, now.Add(5*time.Minute), 180, 20) // still 10%
	_ = e.Tick(context.Background(), now.Add(20*time.Minute))
	if s := w.rolloutOrg(t, "s1").GetString("state"); s != "soaking" {
		t.Fatalf("s1 = %s, want soaking", s)
	}
}

func TestSoakNewSentryIssueFlags(t *testing.T) {
	w, e := soakingWorld(t)
	e.d.Sentry = &fakeSentry{issues: 1}
	_ = e.Tick(context.Background(), now.Add(20*time.Minute))
	if s := w.rolloutOrg(t, "s1").GetString("state"); s != "flagged" {
		t.Fatalf("s1 = %s, want flagged", s)
	}
}

func TestSoakSentryOutageDoesNotFlag(t *testing.T) {
	w, e := soakingWorld(t)
	e.d.Sentry = &fakeSentry{issues: 5, err: errors.New("sentry down")}
	_ = e.Tick(context.Background(), now.Add(20*time.Minute))
	if s := w.rolloutOrg(t, "s1").GetString("state"); s != "soaking" {
		t.Fatalf("s1 = %s, want soaking", s)
	}
}

func TestSoakSignalsRunEvery15Minutes(t *testing.T) {
	_, e := soakingWorld(t)
	f := &fakeSentry{}
	e.d.Sentry = f
	for i := range 15 { // one tick a minute for 15 minutes
		_ = e.Tick(context.Background(), now.Add(time.Duration(2+i)*time.Minute))
	}
	if f.calls != 1 {
		t.Fatalf("checks in 15 minutes = %d, want 1", f.calls)
	}
	_ = e.Tick(context.Background(), now.Add(17*time.Minute))
	if f.calls != 2 {
		t.Fatalf("checks after 15 minutes = %d, want 2", f.calls)
	}
}

func TestSoakChecksOnceMoreAtTheEnd(t *testing.T) {
	w, e := soakingWorld(t)
	f := &fakeSentry{}
	e.d.Sentry = f
	_ = e.Tick(context.Background(), now.Add(2*time.Minute))
	f.issues = 1
	// The soak (1h, shortSoaks) ends; the last check sees the new issue.
	_ = e.Tick(context.Background(), now.Add(time.Hour+5*time.Minute))
	if s := w.rolloutOrg(t, "s1").GetString("state"); s != "flagged" {
		t.Fatalf("s1 = %s, want flagged, not passed", s)
	}
}

func TestSoakLaterRingSignalContinues(t *testing.T) {
	w, e := laterRingWorld(t)
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "committed" })
	e.d.Sentry = &fakeSentry{issues: 1}
	tickUntil(t, e, now, func() bool { return w.rollout(t).GetString("state") == "done" })
	for _, slug := range []string{"o1", "o2"} {
		if s := w.rolloutOrg(t, slug).GetString("state"); s != "flagged" {
			t.Errorf("%s = %s, want flagged", slug, s)
		}
	}
	if w.blocks() != 0 {
		t.Fatal("a later-ring signal must not block the target")
	}
}
```

Check the setup in `soakingWorld` against the fake world's existing tick behaviour (see `TestAdvanceFlagsCrashDuringSoak`): the first `Tick` discovers and deploys, and a later one observes the commit. Adjust the number of setup ticks, not the assertions. `w.deployOutcome` records the committed row with `w.commitAt = now`, so `deployed_at = now`.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/rollout -run 'TestFivexx|TestSentryRate|TestSoak' -v`

- [ ] **Step 3: Implement**

`internal/rollout/signals.go`:

```go
package rollout

import (
	"context"
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/hosting/internal/traffic"
)

// SentryAPI is the slice of internal/sentryapi the soak checks use. Nil in
// Deps turns the Sentry signal off.
type SentryAPI interface {
	NewIssues(ctx context.Context, org, release string) (int, error)
	EventCount(ctx context.Context, org string, start, end time.Time) (int64, error)
}

// Baseline is an org's error level over the BaselineWindow before its
// deploy, fixed on its rollout_orgs row when the deploy starts.
type Baseline struct {
	Requests  int64 `json:"requests"`
	Status5xx int64 `json:"status5xx"`
	// SentryEvents is nil when the Sentry signal is off or Sentry could not
	// be read at deploy time; the rate comparison is then skipped.
	SentryEvents *int64  `json:"sentryEvents,omitempty"`
	Hours        float64 `json:"hours"`
}

const (
	BaselineWindow = 7 * 24 * time.Hour
	SignalEvery    = 15 * time.Minute
	// MinSoakRequests: below this many requests a ratio is noise, and the
	// org is judged by crashes and Sentry alone.
	MinSoakRequests = 200
	// MinSoakEvents keeps a quiet org (zero baseline) from flagging on one
	// stray error.
	MinSoakEvents = 10
	sentryTimeout = 30 * time.Second
)

func fivexxFires(base Baseline, soak traffic.Totals) bool {
	if soak.Requests < MinSoakRequests {
		return false
	}
	baseRatio := 0.0
	if base.Requests > 0 {
		baseRatio = float64(base.Status5xx) / float64(base.Requests)
	}
	ratio := float64(soak.Status5xx) / float64(soak.Requests)
	return ratio > max(2*baseRatio, baseRatio+0.005)
}

func sentryRateFires(base Baseline, events int64, soakHours float64) bool {
	if base.SentryEvents == nil || events < MinSoakEvents || soakHours <= 0 {
		return false
	}
	baseRate := 0.0
	if base.Hours > 0 {
		baseRate = float64(*base.SentryEvents) / base.Hours
	}
	return float64(events)/soakHours > 2*baseRate
}

// baseline measures org over the BaselineWindow ending at the hour now falls
// in. A Sentry failure leaves SentryEvents nil rather than failing the
// deploy: the signal is a safety net, not a gate.
func (e *Engine) baseline(ctx context.Context, org string, now time.Time) (Baseline, error) {
	end := traffic.HourOf(now)
	t, err := traffic.TotalsBetween(e.d.App, org, end.Add(-BaselineWindow), end)
	if err != nil {
		return Baseline{}, err
	}
	b := Baseline{Requests: t.Requests, Status5xx: t.Status5xx, Hours: BaselineWindow.Hours()}
	if e.d.Sentry == nil {
		return b, nil
	}
	sctx, cancel := context.WithTimeout(ctx, sentryTimeout)
	defer cancel()
	n, err := e.d.Sentry.EventCount(sctx, org, end.Add(-BaselineWindow), end)
	if err != nil {
		log.Warn("rollout: no Sentry baseline; the event-rate check is off for this deploy", "org", org, "error", err)
		return b, nil
	}
	b.SentryEvents = &n
	return b, nil
}

// signalDue reports whether a soaking row's 5xx and Sentry checks should run
// now: every SignalEvery, and always on the tick its soak ends.
func (e *Engine) signalDue(rowID string, now time.Time, soakDone bool) bool {
	last, ok := e.lastSignal[rowID]
	if soakDone || !ok || now.Sub(last) >= SignalEvery {
		e.lastSignal[rowID] = now
		return true
	}
	return false
}

// soakSignal returns why a soaking org looks worse than before its upgrade,
// or "" when it does not. Only a control-plane read error is returned as an
// error; a Sentry failure is logged and treated as no signal.
func (e *Engine) soakSignal(ctx context.Context, row *core.Record, now time.Time) (string, error) {
	org := row.GetString("org")
	deployedAt := row.GetDateTime("deployed_at").Time()
	var base Baseline
	// A row deployed before 2b has no baseline and compares against zero.
	_ = row.UnmarshalJSONField("baseline", &base)

	soak, err := traffic.TotalsBetween(e.d.App, org, traffic.HourOf(deployedAt), traffic.HourOf(now).Add(time.Hour))
	if err != nil {
		return "", err
	}
	if fivexxFires(base, soak) {
		return fmt.Sprintf("%s: %d of %d requests failed (5xx) since the upgrade; before it, %d of %d",
			org, soak.Status5xx, soak.Requests, base.Status5xx, base.Requests), nil
	}
	if e.d.Sentry == nil {
		return "", nil
	}
	sctx, cancel := context.WithTimeout(ctx, sentryTimeout)
	defer cancel()
	if release := row.GetString("release"); release != "" {
		n, err := e.d.Sentry.NewIssues(sctx, org, release)
		if err != nil {
			log.Warn("rollout: Sentry check failed; skipped", "org", org, "error", err)
			return "", nil
		}
		if n > 0 {
			return fmt.Sprintf("%s: %d new Sentry issue(s) first seen on release %s", org, n, release), nil
		}
	}
	events, err := e.d.Sentry.EventCount(sctx, org, deployedAt, now)
	if err != nil {
		log.Warn("rollout: Sentry check failed; skipped", "org", org, "error", err)
		return "", nil
	}
	if sentryRateFires(base, events, now.Sub(deployedAt).Hours()) {
		return fmt.Sprintf("%s: %d Sentry events in %s since the upgrade, over twice the rate before it",
			org, events, now.Sub(deployedAt).Round(time.Minute)), nil
	}
	return "", nil
}
```

`engine.go` changes:
1. `Deps`: add `Sentry SentryAPI // nil: no Sentry signal`.
2. `Engine`: add `lastSignal map[string]time.Time`, written only from Tick's goroutine. Initialize it in `New`: `return &Engine{d: d, lastSignal: map[string]time.Time{}}`.
3. `advanceRollout`: call `e.checkSoaks(ctx, rollout, now)`.
4. `observeDeploys`, `case "committed"`: add `"release": dep.GetString("recipe_hash")` to the `setRow` map.
5. `deployNext`, just before `setRow(... "pending" → "deploying" ...)`:
   ```go
   base, err := e.baseline(ctx, org, now)
   if err != nil {
       return err
   }
   ```
   Then add `"baseline": base` to that `setRow` map. Move the `org := row.GetString("org")` line above this block.
6. `checkSoaks(ctx context.Context, rollout *core.Record, now time.Time)`. After the existing crash block and before the `if now.Sub(deployedAt) < soak` test:
   ```go
   soakDone := now.Sub(deployedAt) >= soak
   if e.signalDue(row.Id, now, soakDone) {
       reason, err := e.soakSignal(ctx, row, now)
       if err != nil {
           return false, err
       }
       if reason != "" {
           delete(e.lastSignal, row.Id)
           if row.GetInt("ring") == 0 {
               return e.halt(rollout, row, "soaking", "flagged", reason, "Rollout halted: "+org+" got worse after the upgrade", true, now)
           }
           if err := e.orgFailed(rollout, row, "soaking", "flagged", reason,
               "Upgrade of "+org+" got worse after the upgrade; rollout continues", now); err != nil {
               return false, err
           }
           continue
       }
   }
   if !soakDone {
       continue
   }
   delete(e.lastSignal, row.Id)
   ```
   Replace the old `if now.Sub(deployedAt) < soak { continue }` with this block. Keep the existing pass write after it.
7. Update the `checkSoaks` doc comment: it now also runs the 5xx and Sentry checks, every `SignalEvery` and when the soak ends.

`cmd/serve-router/rollout.go`: `newRolloutEngine(..., sentry rollout.SentryAPI)` sets `Sentry: sentry`.

`cmd/serve-router/main.go`:
- Next to `rolloutCfg` (before `scrubSecretEnv`), add:
  ```go
  // The rollout's Sentry signal reads the fleet's Sentry project. Read before scrubSecretEnv, which removes the token.
  var rolloutSentry rollout.SentryAPI
  if c, ok := sentryapi.FromEnv(os.Getenv); ok {
      rolloutSentry = c
  } else {
      log.Printf("MT_SENTRY_API_TOKEN, MT_SENTRY_ORG and MT_SENTRY_PROJECT are not all set; the rollout's Sentry signal is off")
  }
  ```
- Pass `rolloutSentry` to `newRolloutEngine`.
- In `scrubSecretEnv`, append `"MT_SENTRY_API_TOKEN", "MT_SENTRY_ORG", "MT_SENTRY_PROJECT", "MT_SENTRY_API_URL"` to the list. The spec scrubs all three, and the URL goes with them.
- Update `cmd/serve-router/rollout_test.go` for the new `newRolloutEngine` parameter if a test calls it.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/rollout -v -race`, then `go test ./...`. The existing advance tests must pass unchanged. A nil `Sentry` and no traffic rows mean no signal.

- [ ] **Step 5: Commit**

```bash
git add internal/rollout/signals.go internal/rollout/signals_test.go internal/rollout/engine.go cmd/serve-router/rollout.go cmd/serve-router/main.go cmd/serve-router/rollout_test.go
git commit -m "feat(rollout): flag a soaking org on a 5xx or Sentry regression"
```

---

### Task 7: Tenant side: one snapshot per upgrade, pruned by the router's keep list

**Files:**
- Modify: `tenantcfg/deployresult.go`
- Modify: `tenantboot/upgrade_snapshot.go`
- Modify: `tenantboot/pkg_deploy.go`: move `hostedSnapshot`'s VACUUM into `vacuumInto(dbPath, dest string) error` and call it from both places
- Modify: `tenantboot/pkg_state.go` (`reconcileDeployResult`)
- Test: `tenantcfg/deployresult_test.go`, `tenantboot/upgrade_snapshot_test.go`

**Interfaces:**
- Produces (tenantcfg):

```go
// RestoreSnapshot gains:
	// Snapshot names an upgrade snapshot (UpgradeSnapshotPath). Empty means
	// .deploy/backup.db, the snapshot a tenant-proposed deploy takes.
	Snapshot string `json:"snapshot,omitempty"`

type UpgradeSnapshotRequest struct {
	Job  string   `json:"job"`
	Keep []string `json:"keep"`
}
type UpgradeSnapshotPrune struct {
	Keep []string `json:"keep"`
}
func ValidUpgradeSnapshotName(name string) bool // ^[A-Za-z0-9_-]{1,128}$
func UpgradeSnapshotPath(orgDir, name string) string // <orgDir>/.deploy/upgrade-snapshots/<name>.db
const UpgradeSnapshotPruneGrace = 24 * time.Hour
```

- cfg.sock routes:
  - `POST /api/v1/upgrade-snapshot`, body `UpgradeSnapshotRequest`. It writes `UpgradeSnapshotPath(orgDir, Job)` and returns its `SnapshotFingerprint`. It then deletes every other `*.db` in that dir whose name is not in `Keep` and whose mtime is older than `UpgradeSnapshotPruneGrace`.
  - `POST /api/v1/upgrade-snapshot/prune`, body `UpgradeSnapshotPrune`, does only the prune, and returns 204.
  - Both return 400 when any name fails `ValidUpgradeSnapshotName`.
- Restore: when `req.Snapshot != ""`, the restore reads `UpgradeSnapshotPath(orgDir, req.Snapshot)` (after validating the name) and no longer reads `hostedSnapshotPath`.
- `reconcileDeployResult` leaves the result file in place, and returns `""`, when a restore request exists whose `JobID` equals the result's `JobID`. The next boot applies the restore and then consumes the result.

- [ ] **Step 1: Write the failing tests**

`tenantcfg/deployresult_test.go` (append):

```go
func TestUpgradeSnapshotNames(t *testing.T) {
	for _, ok := range []string{"auto_abc123_acme", "rollback_x", "a-b_C9"} {
		if !ValidUpgradeSnapshotName(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "../x", "a/b", "a.db", strings.Repeat("a", 129), "a b"} {
		if ValidUpgradeSnapshotName(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
	if got := UpgradeSnapshotPath("/o", "j1"); got != "/o/.deploy/upgrade-snapshots/j1.db" {
		t.Fatalf("path = %s", got)
	}
}
```

`tenantboot/upgrade_snapshot_test.go`: read the existing tests first and reuse their org-dir and database helpers (the ones that seed `pb_data/data.db` and post to the cfg mux). Add:

```go
func TestUpgradeSnapshotPerJobAndPrune(t *testing.T) {
	orgDir := newSnapshotOrgDir(t) // the existing helper that seeds pb_data/data.db
	old := tenantcfg.UpgradeSnapshotPath(orgDir, "auto_old_acme")
	kept := tenantcfg.UpgradeSnapshotPath(orgDir, "auto_kept_acme")
	fresh := tenantcfg.UpgradeSnapshotPath(orgDir, "auto_fresh_acme")
	for _, p := range []string{old, kept, fresh} {
		writeFile(t, p, "x")
	}
	stale := time.Now().Add(-tenantcfg.UpgradeSnapshotPruneGrace - time.Hour)
	for _, p := range []string{old, kept} {
		if err := os.Chtimes(p, stale, stale); err != nil {
			t.Fatal(err)
		}
	}

	fp, err := takeUpgradeSnapshot(orgDir, tenantcfg.UpgradeSnapshotRequest{Job: "auto_new_acme", Keep: []string{"auto_kept_acme"}})
	if err != nil {
		t.Fatal(err)
	}
	fi, err := os.Lstat(tenantcfg.UpgradeSnapshotPath(orgDir, "auto_new_acme"))
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := snapshotFingerprint(fi); got != fp {
		t.Fatalf("fingerprint %+v does not name the file written (%+v)", fp, got)
	}
	if _, err := os.Lstat(old); !os.IsNotExist(err) {
		t.Error("an old snapshot outside the keep list must be pruned")
	}
	for _, p := range []string{kept, fresh} {
		if _, err := os.Lstat(p); err != nil {
			t.Errorf("%s must stay (kept, or inside the grace): %v", p, err)
		}
	}
}

func TestUpgradeSnapshotRoutesRejectBadNames(t *testing.T) {
	orgDir := newSnapshotOrgDir(t)
	mux := http.NewServeMux()
	registerUpgradeSnapshot(mux, orgDir)
	for path, body := range map[string]string{
		"/api/v1/upgrade-snapshot":       `{"job":"../x","keep":[]}`,
		"/api/v1/upgrade-snapshot/prune": `{"keep":["a/b"]}`,
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", path, rec.Code)
		}
	}
}

func TestRestoreByUpgradeSnapshotName(t *testing.T) {
	orgDir := newSnapshotOrgDir(t)
	fp, err := takeUpgradeSnapshot(orgDir, tenantcfg.UpgradeSnapshotRequest{Job: "auto_r1_acme"})
	if err != nil {
		t.Fatal(err)
	}
	// write a restore request {fp, JobID: "rollback_1", Snapshot: "auto_r1_acme"} and a
	// reverted deploy result for JobID "rollback_1" with the existing helpers,
	// change data.db, run applyPendingSnapshotRestore(orgDir), and assert
	// data.db is the snapshot again and the snapshot file is gone.
	_ = fp
}

func TestReconcileLeavesAResultARestoreWaitsOn(t *testing.T) {
	// With a restore request and a reverted result for the same job,
	// reconcileDeployResult must return "" and leave the result file in place.
	// With a request for a different job, it consumes the result as before.
}
```

Write out the bodies of the last two tests with the existing helpers in `upgrade_snapshot_test.go` and `pkg_state_test.go`. Do not leave them as comments: each must fail before Step 3 and pass after it.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./tenantcfg ./tenantboot -run 'TestUpgradeSnapshot|TestRestoreByUpgradeSnapshotName|TestReconcileLeaves' -v`

- [ ] **Step 3: Implement**

`tenantcfg/deployresult.go`: add the `Snapshot` field, the two request types, and:

```go
var upgradeSnapshotName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// ValidUpgradeSnapshotName guards every name that becomes a path under the
// org dir: the router and the tenant both build paths from it.
func ValidUpgradeSnapshotName(name string) bool { return upgradeSnapshotName.MatchString(name) }

// UpgradeSnapshotPath is where the tenant keeps the snapshot it took before
// the unattended upgrade named name (the deploy job). One file per upgrade,
// so an operator can still roll an org back days after its upgrade.
func UpgradeSnapshotPath(orgDir, name string) string {
	return filepath.Join(orgDir, ".deploy", "upgrade-snapshots", name+".db")
}

// UpgradeSnapshotPruneGrace protects a snapshot taken after the router read
// its keep list: a prune never removes a file younger than this.
const UpgradeSnapshotPruneGrace = 24 * time.Hour
```

`tenantboot/upgrade_snapshot.go`:
- Change `registerUpgradeSnapshot`'s handler to decode an `UpgradeSnapshotRequest` (`http.MaxBytesReader(w, r.Body, 64<<10)`) and validate `Job` and every `Keep` name (400 on a bad one). It then calls `takeUpgradeSnapshot(orgDir, req)`.
- Add the `/prune` handler: it decodes and validates `UpgradeSnapshotPrune`, calls `pruneUpgradeSnapshots(orgDir, keep, time.Now())`, and returns 204. It returns 500 if the prune returns an error.
- New `takeUpgradeSnapshot(orgDir string, req tenantcfg.UpgradeSnapshotRequest) (tenantcfg.SnapshotFingerprint, error)`:
  1. `MkdirAll` the parent dir with mode 0o755.
  2. Remove a file left at the job's path, as `hostedSnapshot` does: VACUUM INTO refuses to overwrite.
  3. Call `vacuumInto(filepath.Join(orgDir, "pb_data", "data.db"), path)`.
  4. Take the fingerprint, as now.
  5. Call `pruneUpgradeSnapshots(orgDir, append(req.Keep, req.Job), time.Now())`. A prune error is logged at warn and does not fail the snapshot.
- New `pruneUpgradeSnapshots(orgDir string, keep []string, now time.Time) error`:
  1. Read the dir. A dir that does not exist returns nil.
  2. For each entry `name.db`, where `name` passes `ValidUpgradeSnapshotName`, the entry is a regular file (`Lstat`), `name` is not in `keep`, and `now - mtime >= UpgradeSnapshotPruneGrace`, call `os.Remove`.
  3. Skip any other entry.
- `applyPendingSnapshotRestore`: choose `backupPath := hostedSnapshotPath(orgDir)`. If `req.Snapshot != ""`, refuse an invalid name (log at error, then return; the deferred consume still runs) and otherwise use `tenantcfg.UpgradeSnapshotPath(orgDir, req.Snapshot)`.
- `dropCommittedSnapshot` stays as it is. It only touches `.deploy/backup.db`, which upgrades no longer write.
- Update the file's top comment: one snapshot per upgrade, kept until the router's keep list drops it.

`tenantboot/pkg_deploy.go`: extract the VACUUM block of `hostedSnapshot` into `vacuumInto(dbPath, dest string) error`, keeping the quote check. `hostedSnapshot` then calls it.

`tenantboot/pkg_state.go`, in `reconcileDeployResult`, right after the `!ok` return:

```go
	// A restore request for this same job is waiting for the next boot (an
	// operator rollback): the boot needs this result to honour it, so the
	// running build must not consume it first.
	if req, ok, _ := tenantcfg.LoadRestoreSnapshot(orgDir); ok && req.JobID == res.JobID {
		return ""
	}
```

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./tenantcfg ./tenantboot -v -run 'Snapshot|Reconcile'`, then `go test ./...`.

`internal/orgmanager` still calls the snapshot route with no body. Its tests may fail until Task 8, because an empty body fails validation. If so, do Step 3 of Task 8's `orgmanager` change here as well, so every commit is green.

- [ ] **Step 5: Commit**

```bash
git add tenantcfg/deployresult.go tenantcfg/deployresult_test.go tenantboot/upgrade_snapshot.go tenantboot/upgrade_snapshot_test.go tenantboot/pkg_deploy.go tenantboot/pkg_state.go tenantboot/pkg_state_test.go
git commit -m "feat(tenant): keep one snapshot per upgrade, pruned by the router's keep list"
```

---

### Task 8: Router side: keep lists, per-job snapshots, the prune sweep

**Files:**
- Create: `internal/controlplane/upgrade_snapshots.go`
- Modify: `internal/controlplane/deploy.go`
  - change the type `UpgradeSnapshotFunc`
  - add `snapshotRef.name`
  - add `captureSnapshotAt`
  - update `requestSnapshotRestore`
  - update the `snapshotTake` branch of `deploy`
- Modify: `internal/orgmanager/backuppush.go`
  - `UpgradeSnapshot(ctx, slug, job, keep)`
  - `PruneUpgradeSnapshots(ctx, slug, keep)`
- Modify: `internal/orgmanager/manager.go` (`ResidentSlugs`)
- Modify: `cmd/serve-router/main.go` (wiring the new signature; start `sweepUpgradeSnapshots`), `cmd/serve-router/traffic.go` → add the sweep func here or in a new `cmd/serve-router/snapshots.go`
- Modify: every caller of `SetUpgradeSnapshot` and `mgr.UpgradeSnapshot` listed by `grep -rn "UpgradeSnapshot(" --include='*.go' .`, including `rollout_tenant_e2e_test.go` and `deploy_snapshot_test.go`
- Test: `internal/controlplane/upgrade_snapshots_test.go`, `internal/controlplane/deploy_snapshot_test.go`, `internal/orgmanager/upgradesnapshot_test.go`

**Interfaces:**
- Consumes: `tenantcfg.UpgradeSnapshotRequest`, `UpgradeSnapshotPrune`, `UpgradeSnapshotPath`, `ValidUpgradeSnapshotName`, `RestoreSnapshot.Snapshot` (Task 7).
- Produces:
  - `type UpgradeSnapshotFunc func(ctx context.Context, slug, job string, keep []string) (tenantcfg.SnapshotFingerprint, error)`
  - `const UpgradeSnapshotRetention = 7 * 24 * time.Hour`
  - `func UpgradeSnapshotsToKeep(app core.App, slug string, now time.Time) ([]string, error)`
  - `func (m *OrgManager) UpgradeSnapshot(ctx context.Context, slug, job string, keep []string) (tenantcfg.SnapshotFingerprint, error)`
  - `func (m *OrgManager) PruneUpgradeSnapshots(ctx context.Context, slug string, keep []string) error`: a no-op returning nil for an org that is not resident. It never spawns.
  - `func (m *OrgManager) ResidentSlugs() []string`: sorted.
  - `snapshotRef.name string`: `""` means `.deploy/backup.db`.
  - `func captureSnapshotAt(path, name string) snapshotRef`

Keep rule (`UpgradeSnapshotsToKeep`): it returns the `deploy_job` of each `rollout_orgs` row that meets all of these:
- `org = slug` and `deploy_job != ''`;
- `state` is `deploying`, `soaking`, `passed` or `flagged`;
- the row's rollout is `active` or `halted`, or it is `done`/`abandoned`/`superseded` with `now - rollout.updated < UpgradeSnapshotRetention`.

Rows whose rollout no longer exists are not kept. The result is sorted and has no duplicates.

- [ ] **Step 1: Write the failing tests**

`internal/controlplane/upgrade_snapshots_test.go`:

```go
package controlplane

import (
	"slices"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestUpgradeSnapshotsToKeep(t *testing.T) {
	cp, _ := newProvCP(t)
	app := cp.App
	mk := func(state string, age time.Duration) string {
		col, _ := app.FindCollectionByNameOrId("rollouts")
		r := core.NewRecord(col)
		r.Set("fingerprint", state+age.String())
		r.Set("state", state)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		if age > 0 {
			at := time.Now().Add(-age).UTC().Format("2006-01-02 15:04:05.000Z")
			if _, err := app.DB().NewQuery("UPDATE rollouts SET updated = {:u} WHERE id = {:id}").
				Bind(map[string]any{"u": at, "id": r.Id}).Execute(); err != nil {
				t.Fatal(err)
			}
		}
		return r.Id
	}
	row := func(rollout, org, state, job string) {
		col, _ := app.FindCollectionByNameOrId("rollout_orgs")
		r := core.NewRecord(col)
		r.Set("rollout", rollout)
		r.Set("org", org)
		r.Set("state", state)
		r.Set("deploy_job", job)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	active := mk("active", 0)
	recent := mk("done", 6*24*time.Hour)
	expired := mk("done", 8*24*time.Hour)
	row(active, "acme", "soaking", "j_active")
	row(active, "acme", "reverted", "j_reverted") // consumed by the restore
	row(recent, "acme", "passed", "j_recent")
	row(expired, "acme", "passed", "j_expired")
	row(active, "other", "soaking", "j_other")
	row("gone", "acme", "passed", "j_orphan")

	got, err := UpgradeSnapshotsToKeep(app, "acme", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"j_active", "j_recent"}; !slices.Equal(got, want) {
		t.Fatalf("keep = %v, want %v", got, want)
	}
}
```

In `deploy_snapshot_test.go`, update `fakeTenantSnapshot` to the new signature. It must write the snapshot at `tenantcfg.UpgradeSnapshotPath(orgDir, job)`, and it records the `job` and `keep` it received. Then add:

```go
// The upgrade's snapshot is named after its job, the keep list carries the
// org's still-retained snapshots, and a failed boot asks for that named file.
func TestDeployWithSnapshotNamesTheSnapshotByJob(t *testing.T) {
	// Arrange as the existing failed-boot test in this file does, with job
	// "auto_r1_acme". Assert: the fake saw job "auto_r1_acme"; the restore
	// request at tenantcfg.RestoreSnapshotPath(orgDir) has Snapshot ==
	// "auto_r1_acme" and JobID == "auto_r1_acme"; and with the snapshot file
	// removed before the boot fails, the deployment error says the snapshot
	// is missing (errSnapshotMissing), as before.
}
```

Write that body out in full from the neighbouring test in the same file.

`internal/orgmanager/upgradesnapshot_test.go`: update the existing calls to `UpgradeSnapshot(ctx, "acme", "auto_x_acme", []string{"k"})` and assert that the fake cfg.sock server got the JSON body `{"job":"auto_x_acme","keep":["k"]}`. Add:

```go
func TestPruneUpgradeSnapshotsSkipsIdleOrgs(t *testing.T) {
	m := newManagerWithNoResidents(t) // follow the file's existing setup helper
	if err := m.PruneUpgradeSnapshots(context.Background(), "acme", nil); err != nil {
		t.Fatalf("an idle org is skipped, not an error: %v", err)
	}
}
```

Use the file's real helpers. If the existing setup makes `acme` resident, add one resident case that asserts the prune body reached the fake socket, plus the idle case.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/controlplane ./internal/orgmanager -run 'TestUpgradeSnapshotsToKeep|Snapshot|Prune' -v`

- [ ] **Step 3: Implement**

`internal/controlplane/upgrade_snapshots.go`:

```go
package controlplane

import (
	"database/sql"
	"errors"
	"slices"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// UpgradeSnapshotRetention is how long after its rollout ends an upgrade's
// snapshot stays on disk, so an operator can still roll the org back.
const UpgradeSnapshotRetention = 7 * 24 * time.Hour

// UpgradeSnapshotsToKeep lists the upgrade snapshots (by deploy job) an org's
// tenant must keep: every upgrade still in a live rollout, and every one
// whose rollout ended less than UpgradeSnapshotRetention ago. The tenant
// deletes the rest itself; the router never removes files in the org dir.
func UpgradeSnapshotsToKeep(app core.App, slug string, now time.Time) ([]string, error) {
	rows, err := app.FindRecordsByFilter("rollout_orgs",
		"org = {:o} && deploy_job != '' && (state = 'deploying' || state = 'soaking' || state = 'passed' || state = 'flagged')",
		"", 0, 0, map[string]any{"o": slug})
	if err != nil {
		return nil, err
	}
	var keep []string
	for _, row := range rows {
		rollout, err := app.FindRecordById("rollouts", row.GetString("rollout"))
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		switch rollout.GetString("state") {
		case "active", "halted":
		default:
			if now.Sub(rollout.GetDateTime("updated").Time()) >= UpgradeSnapshotRetention {
				continue
			}
		}
		keep = append(keep, row.GetString("deploy_job"))
	}
	slices.Sort(keep)
	return slices.Compact(keep), nil
}
```

`deploy.go`:
- Change the `UpgradeSnapshotFunc` type and its doc comment: the tenant writes `.deploy/upgrade-snapshots/<job>.db` and prunes the others that are not in `keep`.
- In `deploy`, `case snapshotTake:`

```go
	case snapshotTake:
		if !tenantcfg.ValidUpgradeSnapshotName(jobID) {
			err := fmt.Errorf("job id %q cannot name an upgrade snapshot", jobID)
			d.recordDeployment(rec.Id, lfBytes, res.RecipeHash, jobID, "failed", err)
			return "", err
		}
		keep, err := UpgradeSnapshotsToKeep(d.app, slug, time.Now())
		if err != nil {
			err = fmt.Errorf("snapshot keep list: %w", err)
			d.recordDeployment(rec.Id, lfBytes, res.RecipeHash, jobID, "failed", err)
			return "", err
		}
		fp, err := takeSnapshot(ctx, slug, jobID, keep)
		if err != nil {
			err = fmt.Errorf("snapshot before upgrade: %w", err)
			d.recordDeployment(rec.Id, lfBytes, res.RecipeHash, jobID, "failed", err)
			return "", err
		}
		snap = snapshotRefFrom(fp, jobID)
```

- `snapshotRef`: add `name string`. `snapshotRefFrom(fp, name)` sets it.
- `captureSnapshot(orgDir)` becomes `captureSnapshotAt(snapshotPath(orgDir), "")` for the proposed case. Add:

```go
// captureSnapshotAt fingerprints the snapshot at path via Lstat, as
// captureSnapshot always has; name is what a restore request will call it.
func captureSnapshotAt(path, name string) snapshotRef {
	fi, err := os.Lstat(path)
	if err != nil || !fi.Mode().IsRegular() {
		return snapshotRef{}
	}
	ref := snapshotRef{exists: true, name: name, size: fi.Size(), modTime: fi.ModTime()}
	if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
		ref.ino = sys.Ino
	}
	return ref
}

func (r snapshotRef) path(orgDir string) string {
	if r.name == "" {
		return snapshotPath(orgDir)
	}
	return tenantcfg.UpgradeSnapshotPath(orgDir, r.name)
}
```

- `matches` also compares `name`.
- `requestSnapshotRestore`: compare `captureSnapshotAt(snap.path(orgDir), snap.name)`, and write `tenantcfg.RestoreSnapshot{SnapshotFingerprint: snap.fingerprint(), JobID: jobID, Snapshot: snap.name}`.

`orgmanager/backuppush.go`:
- `UpgradeSnapshot(ctx, slug, job string, keep []string)` marshals `tenantcfg.UpgradeSnapshotRequest{Job: job, Keep: keep}` and sends it as the POST body with `Content-Type: application/json`.
- `PruneUpgradeSnapshots(ctx, slug, keep)`:
  1. Call `m.resolveCfgSock(slug)`. A "not resident" error returns nil. Check this with a typed sentinel, not a string match: add `var errNotResident = errors.New("org is not resident")` and wrap it in `resolveCfgSock`'s not-resident branch.
  2. POST `tenantcfg.UpgradeSnapshotPrune{Keep: keep}` to `/api/v1/upgrade-snapshot/prune`, using `newCfgSockClient`.
  3. A non-204 reply is an error.

`orgmanager/manager.go`:

```go
// ResidentSlugs lists the orgs with a running tenant, for sweeps that must
// not wake an idle org.
func (m *OrgManager) ResidentSlugs() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]string, 0, len(m.orgs))
	for slug := range m.orgs {
		out = append(out, slug)
	}
	slices.Sort(out)
	return out
}
```

Router wiring (`main.go`): `prov.SetUpgradeSnapshot(func(ctx context.Context, slug, job string, keep []string) (tenantcfg.SnapshotFingerprint, error) { return mgr.UpgradeSnapshot(ctx, slug, job, keep) })`. Then add `go sweepUpgradeSnapshots(ctx, cp.App, mgr)` next to `runRollouts`. Put it in `cmd/serve-router/snapshots.go`:

```go
package main

import (
	"context"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/hosting/internal/controlplane"
	"tinycld.org/hosting/internal/orgmanager"
)

// sweepUpgradeSnapshots tells each running tenant, once an hour, which
// upgrade snapshots it must keep; the tenant deletes the rest. An idle org
// is not woken for this: its next upgrade snapshot carries the same list.
func sweepUpgradeSnapshots(ctx context.Context, app core.App, mgr *orgmanager.OrgManager) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			for _, slug := range mgr.ResidentSlugs() {
				keep, err := controlplane.UpgradeSnapshotsToKeep(app, slug, now)
				if err != nil {
					log.Printf("upgrade snapshots: keep list for %s: %v", slug, err)
					continue
				}
				if err := mgr.PruneUpgradeSnapshots(ctx, slug, keep); err != nil {
					log.Printf("upgrade snapshots: prune %s: %v", slug, err)
				}
			}
		}
	}
}
```

Update `rollout_tenant_e2e_test.go`. `s.deployer.SetUpgradeSnapshot(s.mgr.UpgradeSnapshot)` now type-checks as is. Update the closure in `TestRolloutTenantE2E_FailedBootRestoresPreviousBuildAndData` to the new signature.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/controlplane ./internal/orgmanager ./cmd/serve-router -v -run 'Snapshot|Prune|Keep'`, then `go test ./...`. Then run the real-tenant e2e: `go test ./internal/controlplane -run TestRolloutTenantE2E -v`. The failed-boot test must still restore the data.

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/upgrade_snapshots.go internal/controlplane/upgrade_snapshots_test.go internal/controlplane/deploy.go internal/controlplane/deploy_snapshot_test.go internal/controlplane/rollout_tenant_e2e_test.go internal/orgmanager/backuppush.go internal/orgmanager/manager.go internal/orgmanager/upgradesnapshot_test.go cmd/serve-router/main.go cmd/serve-router/snapshots.go
git commit -m "feat(rollout): keep upgrade snapshots 7 days after their rollout ends"
```

---

### Task 9: `POST /api/orgs/{slug}/rollback`

**Files:**
- Modify: `internal/controlplane/deploy.go` (`Rollback`, `ErrNoUpgradeSnapshot`)
- Create: `internal/controlplane/rollback_route.go`
- Modify: `internal/controlplane/provisioning.go` (after `registerRolloutRoutes(g, p.app)`: `registerRollbackRoute(g, p.app, p.deployer)`)
- Test: `internal/controlplane/rollback_route_test.go`, and a real-tenant case in `rollout_tenant_e2e_test.go`

**Interfaces:**
- Consumes:
  - `UpgradeSnapshotsToKeep` and `captureSnapshotAt` (Task 8)
  - `requestSnapshotRestore`, `repointOrg`, `writeDeployResult`, `recordDeployment`, `setDeploymentStatus`, `begin`/`end`, `trackHash`/`untrackHash`, `buildSet`, `finishing` (2a)
- Produces:
  - `var ErrNoUpgradeSnapshot = errors.New("the upgrade snapshot is gone; this org cannot be rolled back")`
  - `func (d *Deployer) Rollback(ctx context.Context, slug string, prev map[string]string, snapshot, jobID string) (string, error)`
  - Route `POST /api/orgs/{slug}/rollback`, superuser only, body `{"confirm": true}`:
    - 202 `{"recipeHash", "restoredTo", "warning"}`
    - 400: no confirm
    - 404: no upgrade to roll back
    - 409: the org changed after the upgrade, or a deploy is busy
    - 429: rate-limited
    - 410: the snapshot has expired or is missing
    - 500: any other error

Route logic:
1. Find the newest `rollout_orgs` row for the org with state `soaking`, `passed` or `flagged`, sorted `-deployed_at`. If there is none, return 404 "no upgrade to roll back".
2. Decode `from_lockfile` and `to_lockfile`. Decode the org's `lockfile` the same way as the rollout code (a JSON object of name→spec). If it does not equal `to_lockfile` (`maps.Equal`), return 409 "the org's packages changed after the upgrade; rolling back would undo that change".
3. If the row's `deploy_job` is not in `UpgradeSnapshotsToKeep(app, slug, now)`, return 410.
4. Call `jobID := "rollback_" + row.Id`, then `hash, err := d.Rollback(ctx, slug, from, row.deploy_job, jobID)`. Map `ErrDeployBusy` → 409, `ErrDeployRateLimited` → 429, `ErrNoUpgradeSnapshot` → 410, and any other error → 500.
5. Call `SetStateIf(app, "rollout_orgs", row.Id, []string{row.state}, {"state": "rolled_back"})`.
6. Return 202 with `warning`: `"The org's data is restored to how it was at <deployed_at RFC3339>. Everything written after that is lost. The rollout is unchanged; abandon it if this version is bad."`

`Rollback` logic:
1. Validate both names with `tenantcfg.ValidUpgradeSnapshotName`.
2. `begin(slug)`; the org must be `active`.
3. Marshal the lockfile.
4. `snap := captureSnapshotAt(tenantcfg.UpgradeSnapshotPath(orgDir, snapshot), snapshot)`. If it does not exist, return `ErrNoUpgradeSnapshot`.
5. Call `buildSet(ctx, slug, prev, "")`. On error, `recordDeployment` with "failed" and return the error.
6. Call `trackHash`, then `recordDeployment` with "proposed", then `prevState, err := repointOrg(...)`.
7. Call `requestSnapshotRestore(orgDir, jobID, snap)`, then `writeDeployResult(orgDir, {JobID: jobID, Status: DeployReverted, Error: "rolled back by an operator", RecipeHash: res.RecipeHash, CompletedAt: now})`.
   - If the restore request fails, put the org row back to `prevState` (the same transaction body as `finish`'s revert, extracted into a helper `restoreOrgRow(slug, prevState) error` that both paths use). Then mark the deployment failed, call `end` and `untrack`, and return the error wrapped in `ErrNoUpgradeSnapshot` when it is `errSnapshotMissing`.
8. Set `settled = true`. Start a goroutine on `d.finishing` that runs `evict(slug)` and then `verify` with `tenantVerifyTimeout`. It sets the deployment status to "committed" when ready, or to "failed" and logs at error otherwise. It then calls `end` and `untrack`.
9. Return `res.RecipeHash`.

Explain the order in a comment: the previous build must find both the request and the result when it opens the database, and a tenant still running the upgraded build leaves that result in place (Task 7).

- [ ] **Step 1: Write the failing tests**

`rollback_route_test.go` (package `controlplane`). Use `newProvCP` and the existing deploy harness from `deploy_snapshot_test.go` (fake builder, fake verify), and seed rows the way `upgrade_snapshots_test.go` does. Cases:

```go
func TestRollbackRoute(t *testing.T) {
	// Each sub-test seeds an org on lockfile {"tinycld":"1.1.0"} with a rollout_orgs
	// row (from {"tinycld":"1.0.0"} → to {"tinycld":"1.1.0"}, state "passed",
	// deploy_job "auto_r1_acme", deployed_at set) in an active rollout, and an
	// upgrade snapshot file at tenantcfg.UpgradeSnapshotPath(orgDir, "auto_r1_acme")
	// (the test writes it directly — it plays the tenant).
	t.Run("no confirm is 400", ...)
	t.Run("no upgraded row is 404", ...)
	t.Run("lockfile changed since is 409", ...)
	t.Run("expired rollout is 410", ...)          // rollout done, updated 8 days ago
	t.Run("missing snapshot file is 410", ...)
	t.Run("not a superuser is 401/403", ...)
	t.Run("rolls back", func(t *testing.T) {
		// 202; body.warning mentions "lost"; the org row is on the 1.0.0
		// build; the restore request names Snapshot "auto_r1_acme" with
		// JobID "rollback_<rowId>"; deploy-result is reverted for the same
		// job; the row is rolled_back; the rollout is still active.
	})
}
```

Write every sub-test body in full. Use the route-testing pattern already in `rollout_routes_test.go` (find its helper for an authenticated superuser request and reuse it).

Real-tenant e2e (`rollout_tenant_e2e_test.go`):

```go
// An operator rollback after a good upgrade puts the org back on the
// previous build with the data from just before the upgrade.
func TestRolloutTenantE2E_RollbackRestoresBuildAndData(t *testing.T) {
	s := newRolloutStack(t, map[string]string{
		"pb_hooks/main.pb.js":               versionHook("B"),
		"pb_migrations/1700000000_notes.js": notesMigration,
	}, time.Hour)
	s.addNote(t, "pre")
	s.tickUntil(t, "the org to soak", func() bool { return s.orgRowState(t) == "soaking" })
	s.addNote(t, "after-upgrade")
	if v := s.version(t); v != "B" {
		t.Fatalf("version = %s", v)
	}
	row, err := s.cp.App.FindFirstRecordByFilter("rollout_orgs", "org = {:o}", map[string]any{"o": rolloutSlug})
	if err != nil {
		t.Fatal(err)
	}
	var from map[string]string
	if err := row.UnmarshalJSONField("from_lockfile", &from); err != nil {
		t.Fatal(err)
	}
	if _, err := s.deployer.Rollback(context.Background(), rolloutSlug, from, row.GetString("deploy_job"), "rollback_"+row.Id); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	s.deployer.WaitForDeploys()
	if v := s.version(t); v != "A" {
		t.Fatalf("version after rollback = %s, want A", v)
	}
	if got := s.notes(t); len(got) != 1 || got[0] != "pre" {
		t.Fatalf("notes = %v, want only the pre-upgrade note", got)
	}
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/controlplane -run 'TestRollbackRoute|TestRolloutTenantE2E_Rollback' -v`

- [ ] **Step 3: Implement** `Rollback`, `restoreOrgRow`, the route and its registration, as specified above.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/controlplane -run 'Rollback|TestRolloutTenantE2E' -v`, then `go test ./...`

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/deploy.go internal/controlplane/rollback_route.go internal/controlplane/rollback_route_test.go internal/controlplane/provisioning.go internal/controlplane/rollout_tenant_e2e_test.go
git commit -m "feat(rollout): operator rollback to the upgrade snapshot and previous build"
```

---

### Task 10: Real-tenant 5xx signal e2e and the README

**Files:**
- Modify: `internal/controlplane/rollout_tenant_e2e_test.go`
- Modify: `README.md` ("Automatic upgrades" section and the env table)

**Interfaces:**
- Consumes: `frontrouter.New` with `Observe` (Task 3), `traffic.NewCounter`/`Flush` (Task 2), the engine's signal check (Task 6).

- [ ] **Step 1: Write the e2e test**

```go
// 5xx answers from the new build during a ring-0 soak flag the org and halt
// the rollout; the org stays on the new build.
func TestRolloutTenantE2E_Ring0FivexxDuringSoakHalts(t *testing.T) {
	s := newRolloutStack(t, map[string]string{
		"pb_hooks/main.pb.js": versionHook("B") +
			"\nrouterAdd('GET','/boom',(e)=>e.json(500,{}))",
		"pb_migrations/1700000000_notes.js": notesMigration,
	}, time.Hour)
	counter := traffic.NewCounter(time.Now)
	front := frontrouter.New(frontrouter.Config{
		BaseDomain: "example.test",
		GetOrg: func(ctx context.Context, slug string) (http.Handler, error) {
			inst, err := s.mgr.Get(ctx, slug)
			if err != nil {
				return nil, err
			}
			return inst.Mux(), nil
		},
		Observe: counter.Observe,
	})

	s.tickUntil(t, "the org to soak", func() bool { return s.orgRowState(t) == "soaking" })
	for i := range 250 {
		path := "/version"
		if i%10 == 0 {
			path = "/boom" // 10% failures
		}
		rec := httptest.NewRecorder()
		front.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://"+rolloutSlug+".example.test"+path, nil))
	}
	if err := counter.Flush(s.cp.App); err != nil {
		t.Fatal(err)
	}

	s.tick(t)

	if got := s.orgRowState(t); got != "flagged" {
		t.Fatalf("org row = %s, want flagged", got)
	}
	if got := s.rolloutState(t); got != "halted" {
		t.Fatalf("rollout = %s, want halted", got)
	}
	if v := s.version(t); v != "B" {
		t.Fatalf("version = %s, want the new build kept", v)
	}
}
```

The first signal check for a row runs on the first tick that sees it soaking. If that tick is the one in `tickUntil`, the check ran before any traffic. Then `s.tick` here is less than 15 minutes later and does not check. In that case, give `newRolloutStack` a way to reset the engine's per-row timer: an exported `(*Engine).ResetSignalTimers()` used only by tests is acceptable if it has a doc comment saying so. Or drive the tick with `now.Add(SignalEvery)`. Choose the second if `Tick`'s `now` can move ahead of the wall clock without breaking the deployer, and say which one you chose in the report.

- [ ] **Step 2: Run, expect PASS**

Run: `go test ./internal/controlplane -run TestRolloutTenantE2E -v`

- [ ] **Step 3: README**

In `README.md` "Automatic upgrades", add subsections, keeping the section's existing style:
- **Signals during a soak.**
  - A crash is checked every minute. 5xx and Sentry are checked every 15 minutes, and once more when the soak ends.
  - State the exact 5xx rule: ratio > max(2 × baseline, baseline + 0.5%), at least 200 soak requests, with the baseline from the 7 days before the deploy.
  - The Sentry rules: any issue first seen on the new release, or more than 2× the baseline event rate with at least 10 events.
  - Ring 0 halts and blocks; later rings flag the org and continue. Nothing is rolled back automatically after a good start.
  - What is counted (tenant answers only) and the first-hour mix.
- **Sentry.**
  - The tenants send `org` and `release` (the recipe hash).
  - `MT_SENTRY_ORG` and `MT_SENTRY_PROJECT` must name the project that the fleet `sentry.dsn` reports to.
  - The token needs the `event:read` and `project:read` scopes.
- **Upgrade snapshots and rollback.**
  - One snapshot per upgrade at `<org>/.deploy/upgrade-snapshots/<job>.db`, kept until 7 days after the rollout ends.
  - `POST /api/orgs/{slug}/rollback` with `{"confirm": true}`, and what it loses.
  - It does not change the rollout; abandon the rollout if the version is bad.
  - Its status codes.
- Add the `POST /api/orgs/{slug}/rollback` row to the operator API table, if the section has one.
- Env table: `MT_SENTRY_API_TOKEN`, `MT_SENTRY_ORG`, `MT_SENTRY_PROJECT`, `MT_SENTRY_API_URL` (default `https://sentry.io`). Each is scrubbed from the environment after boot.

- [ ] **Step 4: Run** `go test ./...` and `gofmt -l .`

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/rollout_tenant_e2e_test.go README.md
git commit -m "test(rollout): real-tenant 5xx signal; docs: soak signals, snapshots, rollback"
```

---

### Task 11 (utils): installer writes and keeps the Sentry API settings

**Files (utils repo, branch `feat/auto-upgrade-signals` from `feat/deploy-upgrade`):**
- Modify: `hosting-install/install.sh`. Use the `SMTP_*` blocks as the pattern: env input, a `carry_settings` entry, and the `hosting.env` write.
- Modify: `hosting-install/README.md` (environment reference)
- Test: `hosting-install/tests/carry_settings_test.sh`

**Interfaces:**
- Inputs: `SENTRY_API_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_API_URL` (all optional).
- Output: `hosting.env` lines `MT_SENTRY_API_TOKEN=…`, `MT_SENTRY_ORG=…`, `MT_SENTRY_PROJECT=…`, `MT_SENTRY_API_URL=…`. Only the set ones are written.
- On a re-run with a variable unset, `carry_settings` keeps the value from the existing `hosting.env`, the same way it treats `SMTP_*`.

- [ ] **Step 1: Add the failing case** to `carry_settings_test.sh`. Follow its existing cases exactly: an existing `hosting.env` with `MT_SENTRY_ORG=acme` and a re-run without `SENTRY_ORG` keeps `MT_SENTRY_ORG=acme`; a re-run with `SENTRY_ORG=other` writes `other`.
- [ ] **Step 2: Run** `bash hosting-install/tests/carry_settings_test.sh` and expect the new case to FAIL.
- [ ] **Step 3: Implement** in `install.sh`, mirroring the `SMTP_*` handling line for line. `hosting.env` is already mode 0600, and the token is a secret there like `SMTP_PASSWORD`.
- [ ] **Step 4: Run all of these and expect PASS, with clean output:**
  - `bash hosting-install/tests/carry_settings_test.sh`
  - `bash hosting-install/tests/resolve_only_test.sh`
  - `bash tests/deploy_upgrade_test.sh`
  - `bash -n hosting-install/install.sh`
  - `shellcheck hosting-install/install.sh hosting-install/tests/*.sh`
- [ ] **Step 5: Commit**

```bash
git add hosting-install/install.sh hosting-install/README.md hosting-install/tests/carry_settings_test.sh
git commit -m "feat(hosting-install): write and keep the rollout's Sentry API settings"
```
