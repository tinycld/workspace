# Auto-upgrade 2a (hosted rollout core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hosting router upgrades every org that has automatic updates on, in rings that start with sentinel orgs, reverts an org whose new build does not boot, halts on a boot failure or a crash during the soak, and emails the operators.

**Architecture:** A new `internal/rollout` package holds pure target/ring logic and a stateful `Engine` the router ticks every 15 minutes. The engine uses the existing `Deployer` (extended with a snapshot-taking deploy) and the builder's own peer check as the compat gate. A new `internal/opalert` package records gated operator alerts and emails control-plane superusers through the control plane's PocketBase SMTP settings, which the router now sets from `MT_SMTP_*`. The tenant installs a core `autoupgrade.Delegate` that forwards the owner's flag over `ctl.sock`.

**Tech Stack:** Go (PocketBase fork), the hosting module `tinycld.org/hosting`, core `tinycld.org/core` (`autoupgrade`, `pkgbuild`, `backup/snapshot`, `mailer`), bash (installer).

**Spec:** `docs/superpowers/specs/2026-10-01-auto-upgrade-2-hosted-rollout-design.md`. Part 2b (5xx and Sentry signals, Sentry tags on tenants) is a separate plan.

## Global Constraints

- Repos: `hosting` (`~/code/tinycld/hosting`) and `utils` (`~/code/tinycld/utils`). Branch in both: `feat/auto-upgrade-core` (same name as the core branch, so CI resolves core PR tinycld/tinycld#309). Do not edit the `tinycld` repo.
- Depends on core `tinycld.org/core/autoupgrade` (`Delegate`, `Starter`, `Status`, `SetDelegate`, `ParseWindow`, `MinWindow`, `KeyEnabled`, `KeyWindow`) from PR #309, resolved locally through `../tinycld`.
- Rings and soak defaults, exactly: ring 0 = orgs with `rollout_ring = "sentinel"`, soak 72h minor / 168h major; ring 1 = random sample of the rest, 5% (min 1, max 5), soak 48h / 120h; ring 2 = 25% of the rest, soak 24h / 72h; ring 3 = all remaining, no soak. Each soak is overridable by `MT_ROLLOUT_SOAK_R{0,1,2}_{MINOR,MAJOR}` (Go durations; malformed or ≤0 is a boot error).
- Window: `MT_UPGRADE_WINDOW`, default `02:00-05:00`, server-local time, parsed with core `autoupgrade.ParseWindow` (≥ 60 minutes). A ring only starts deploying inside the window; soaks run all day.
- Targets: per lockfile entry, the newest **stable** (no prerelease) version newer than the current one, majors included; git specs pinned as `<spec>#<tag>` via `pkgbuild.SpecForVersion`; npm entries become the bare version.
- Compat gate: `Deployer.BuildSet(target)`. A build error wrapping `builder.ErrPeerConflict` means "does not resolve": retry without majors, then pause. Any other build error is a build failure for that target (alert, no pause).
- A boot failure reverts that org (previous build + snapshot restore), halts the rollout, blocks its fingerprint and alerts. A crash during the soak flags the org (no revert), halts the rollout and alerts.
- Alert gate: send on a new alert row or a changed fingerprint; one reminder when `last_notified` is 7 days old; never otherwise. Recipients: every control-plane superuser.
- Secrets read from env are scrubbed (`scrubSecretEnv`). `MT_SMTP_PASSWORD` is a secret.
- Nothing in this plan mentions hosting in core; tenant-facing copy says "your provider" at most, never "hosting".
- Before every commit: `git branch --show-current` must print `feat/auto-upgrade-core`; stage explicit paths only. Run `go test ./...` from the hosting module root before each commit that touches Go; `gofmt -l .` must print nothing.
- Never edit the composition parity allowlists to make a test pass without recording a reason next to the entry.

## Out of scope here (part 2b or later)

- 5xx counting (`org_traffic`), the Sentry signal, and Sentry `org`/`release` tags on tenant events — part 2b.
- The operator's manual `POST /api/orgs/{slug}/rollback` and keeping upgrade snapshots for 7 days after a rollout ends. In this plan a committed upgrade drops its snapshot, exactly like a committed proposed deploy. Part 2b adds retention and the rollback route.
- Mirroring the router's pause/blocked state into the tenant's `autoupgrade_state` rows. The tenant shows the router's status text instead (Task 11/12), because a mirrored blocked row would offer the owner a "Clear" button that the router ignores.

## File map (hosting unless noted)

| File | Responsibility |
|---|---|
| `internal/controlplane/schema.go` | migration `1900000013_auto_upgrade.go` |
| `internal/builder/resolve.go`, `internal/builder/fetch_tags.go` | `ErrPeerConflict`; `FetchTags(dir)` |
| `internal/orgmanager/manager.go` | crash timestamps + `CrashesSince` |
| `internal/opalert/opalert.go` | gated operator alerts + email |
| `cmd/serve-router/smtp.go` | `ensureSMTP` from `MT_SMTP_*` |
| `internal/rollout/target.go` | pure: newest stable, pinned next lockfile, major detection, fingerprint |
| `internal/rollout/rings.go` | pure: config, ring selection, soak lengths |
| `internal/rollout/engine.go` | discovery, rollouts, deploys, soak checks |
| `internal/controlplane/deploy.go` | `DeployWithSnapshot` |
| `internal/controlplane/autoupgrade_ctl.go` | ctl routes `/api/v1/auto-upgrade` |
| `internal/controlplane/rollout_routes.go` | operator API |
| `tenantboot/autoupgrade.go` | tenant `autoupgrade.Delegate` |
| `tenantboot/deploy_channel.go` | `SetAutoUpgrade`, `AutoUpgradeStatus` |
| `cmd/serve-router/hooks.go` | managed `autoupgrade.window` prefix |
| `cmd/serve-router/rollout.go` | env config + engine loop wiring |
| `README.md` | "Automatic upgrades" section + env rows |
| `utils/hosting-install/install.sh`, `utils/hosting-install/README.md` | `SMTP_*` → `MT_SMTP_*` |

---

### Task 1: Control-plane schema

**Files:**
- Modify: `internal/controlplane/schema.go` (append a migration before `return list`; add `addAutoUpgrade`/`removeAutoUpgrade`)
- Test: `internal/controlplane/schema_autoupgrade_test.go`

**Interfaces:**
- Produces: `orgs.auto_upgrade` (bool), `orgs.rollout_ring` (select `sentinel`, optional). Collections (superuser-only: all rules nil):
  - `rollouts`: `packages` (json), `fingerprint` (text, required), `major` (bool), `state` (select `active|halted|done|abandoned|superseded`, required), `ring` (number, int), `ring_started` (date), `halt_reason` (text), `created`/`updated` (autodate). Index on `state`.
  - `rollout_orgs`: `rollout` (text, rollout id), `org` (text, slug), `ring` (number int), `from_lockfile` (json), `to_lockfile` (json), `state` (select `pending|deploying|soaking|passed|reverted|flagged`, required), `deploy_job` (text), `deployed_at` (date), `created`/`updated`. Indexes `rollout, ring` and `org`.
  - `rollout_blocks`: `fingerprint` (text, required, unique index), `packages` (json), `reason` (text), `created`.
  - `operator_alerts`: `kind` (text, required), `fingerprint` (text), `subject` (text), `detail` (text), `first_seen` (date), `last_notified` (date), `resolved` (bool), `created`/`updated`. Index on `kind`.

- [ ] **Step 1: Write the failing test**

```go
package controlplane

import "testing"

func TestSchema_AutoUpgrade(t *testing.T) {
	cp, _ := newProvCP(t)
	orgs, err := cp.App.FindCollectionByNameOrId("orgs")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"auto_upgrade", "rollout_ring"} {
		if orgs.Fields.GetByName(f) == nil {
			t.Errorf("orgs.%s missing", f)
		}
	}
	want := map[string][]string{
		"rollouts":        {"packages", "fingerprint", "major", "state", "ring", "ring_started", "halt_reason"},
		"rollout_orgs":    {"rollout", "org", "ring", "from_lockfile", "to_lockfile", "state", "deploy_job", "deployed_at"},
		"rollout_blocks":  {"fingerprint", "packages", "reason"},
		"operator_alerts": {"kind", "fingerprint", "subject", "detail", "first_seen", "last_notified", "resolved"},
	}
	for name, fields := range want {
		c, err := cp.App.FindCollectionByNameOrId(name)
		if err != nil {
			t.Errorf("%s missing: %v", name, err)
			continue
		}
		if c.ListRule != nil || c.ViewRule != nil || c.CreateRule != nil || c.UpdateRule != nil || c.DeleteRule != nil {
			t.Errorf("%s must be superuser-only (all rules nil)", name)
		}
		for _, f := range fields {
			if c.Fields.GetByName(f) == nil {
				t.Errorf("%s.%s missing", name, f)
			}
		}
	}
}

func TestSchema_AutoUpgradeDown(t *testing.T) {
	cp, _ := newProvCP(t)
	if err := removeAutoUpgrade(cp.App); err != nil {
		t.Fatal(err)
	}
	if err := removeAutoUpgrade(cp.App); err != nil {
		t.Fatalf("down must be idempotent: %v", err)
	}
	if _, err := cp.App.FindCollectionByNameOrId("rollouts"); err == nil {
		t.Fatal("rollouts survived down")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/code/tinycld/hosting && go test ./internal/controlplane -run TestSchema_AutoUpgrade -v`
Expected: FAIL (`orgs.auto_upgrade missing`, undefined `removeAutoUpgrade`).

- [ ] **Step 3: Implement**

Append before `return list` in `controlPlaneMigrations()`:

```go
	// Automatic upgrades: the org's opt-in, the operator's sentinel tag, and
	// the rollout state the router needs to survive its own restarts.
	list.Add(&core.Migration{
		File: "1900000013_auto_upgrade.go",
		Up:   addAutoUpgrade,
		Down: removeAutoUpgrade,
	})
```

Add the functions:

```go
func addAutoUpgrade(txApp core.App) error {
	orgs, err := txApp.FindCollectionByNameOrId("orgs")
	if err != nil {
		return err
	}
	if orgs.Fields.GetByName("auto_upgrade") == nil {
		orgs.Fields.Add(&core.BoolField{Name: "auto_upgrade"})
	}
	if orgs.Fields.GetByName("rollout_ring") == nil {
		orgs.Fields.Add(&core.SelectField{Name: "rollout_ring", MaxSelect: 1, Values: []string{"sentinel"}})
	}
	if err := txApp.Save(orgs); err != nil {
		return err
	}

	rollouts := core.NewBaseCollection("rollouts")
	rollouts.Fields.Add(&core.JSONField{Name: "packages", MaxSize: 20000})
	rollouts.Fields.Add(&core.TextField{Name: "fingerprint", Required: true})
	rollouts.Fields.Add(&core.BoolField{Name: "major"})
	rollouts.Fields.Add(&core.SelectField{Name: "state", Required: true, MaxSelect: 1,
		Values: []string{"active", "halted", "done", "abandoned", "superseded"}})
	rollouts.Fields.Add(&core.NumberField{Name: "ring", OnlyInt: true})
	rollouts.Fields.Add(&core.DateField{Name: "ring_started"})
	rollouts.Fields.Add(&core.TextField{Name: "halt_reason"})
	rollouts.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	rollouts.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	rollouts.AddIndex("idx_rollouts_state", false, "state", "")
	if err := txApp.Save(rollouts); err != nil {
		return err
	}

	ros := core.NewBaseCollection("rollout_orgs")
	ros.Fields.Add(&core.TextField{Name: "rollout", Required: true})
	ros.Fields.Add(&core.TextField{Name: "org", Required: true})
	ros.Fields.Add(&core.NumberField{Name: "ring", OnlyInt: true})
	ros.Fields.Add(&core.JSONField{Name: "from_lockfile", MaxSize: 20000})
	ros.Fields.Add(&core.JSONField{Name: "to_lockfile", MaxSize: 20000})
	ros.Fields.Add(&core.SelectField{Name: "state", Required: true, MaxSelect: 1,
		Values: []string{"pending", "deploying", "soaking", "passed", "reverted", "flagged"}})
	ros.Fields.Add(&core.TextField{Name: "deploy_job"})
	ros.Fields.Add(&core.DateField{Name: "deployed_at"})
	ros.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	ros.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	ros.AddIndex("idx_rollout_orgs_rollout", false, "rollout, ring", "")
	ros.AddIndex("idx_rollout_orgs_org", false, "org", "")
	if err := txApp.Save(ros); err != nil {
		return err
	}

	blocks := core.NewBaseCollection("rollout_blocks")
	blocks.Fields.Add(&core.TextField{Name: "fingerprint", Required: true})
	blocks.Fields.Add(&core.JSONField{Name: "packages", MaxSize: 20000})
	blocks.Fields.Add(&core.TextField{Name: "reason"})
	blocks.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	blocks.AddIndex("idx_rollout_blocks_fp", true, "fingerprint", "")
	if err := txApp.Save(blocks); err != nil {
		return err
	}

	alerts := core.NewBaseCollection("operator_alerts")
	alerts.Fields.Add(&core.TextField{Name: "kind", Required: true})
	alerts.Fields.Add(&core.TextField{Name: "fingerprint"})
	alerts.Fields.Add(&core.TextField{Name: "subject"})
	alerts.Fields.Add(&core.TextField{Name: "detail", Max: 20000})
	alerts.Fields.Add(&core.DateField{Name: "first_seen"})
	alerts.Fields.Add(&core.DateField{Name: "last_notified"})
	alerts.Fields.Add(&core.BoolField{Name: "resolved"})
	alerts.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	alerts.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	alerts.AddIndex("idx_operator_alerts_kind", false, "kind", "")
	return txApp.Save(alerts)
}

func removeAutoUpgrade(txApp core.App) error {
	for _, name := range []string{"operator_alerts", "rollout_blocks", "rollout_orgs", "rollouts"} {
		if c, err := txApp.FindCollectionByNameOrId(name); err == nil {
			if err := txApp.Delete(c); err != nil {
				return err
			}
		}
	}
	orgs, err := txApp.FindCollectionByNameOrId("orgs")
	if err != nil {
		return nil
	}
	orgs.Fields.RemoveByName("auto_upgrade")
	orgs.Fields.RemoveByName("rollout_ring")
	return txApp.Save(orgs)
}
```

Check the field type names against `core` in the fork (`third_party/pocketbase/core/field_*.go`); if a property name differs (for example `JSONField.MaxSize`), use the real one and say so in the report. If a new collection must be listed anywhere the control plane enumerates collections (grep `org_abuse_events` for such lists), add the new ones there too.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/controlplane -run 'TestSchema' -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/schema.go internal/controlplane/schema_autoupgrade_test.go
git commit -m "feat(controlplane): auto-upgrade schema"
```

---

### Task 2: Builder — peer-conflict sentinel and tag fetch

**Files:**
- Modify: `internal/builder/resolve.go` (`checkPeers`)
- Create: `internal/builder/fetch_tags.go`
- Test: `internal/builder/peer_conflict_test.go`, `internal/builder/fetch_tags_test.go`

**Interfaces:**
- Produces:
  - `var ErrPeerConflict = errors.New("package versions do not fit together")` in package `builder`; `checkPeers` returns `fmt.Errorf("%w: %w", ErrPeerConflict, violationsErr)` when there are violations, nil otherwise.
  - `func (b *Builder) FetchTags(dir string) error` — runs, confined like other fetches, `git -C <dir> fetch --tags --force --prune` and returns an error with the command output on failure.

- [ ] **Step 1: Write the failing tests**

`peer_conflict_test.go`:

```go
package builder

import (
	"errors"
	"testing"
)

func TestCheckPeersWrapsErrPeerConflict(t *testing.T) {
	res := &resolvedInput{
		Members: []resolvedMember{{Slug: "alpha", Version: "1.0.0"}},
		PeerVersions: map[string]map[string]string{
			"alpha": {"beta": ">=2.0.0"},
		},
	}
	err := checkPeers(res)
	if !errors.Is(err, ErrPeerConflict) {
		t.Fatalf("err = %v, want ErrPeerConflict", err)
	}
}

func TestCheckPeersOK(t *testing.T) {
	res := &resolvedInput{Members: []resolvedMember{{Slug: "alpha", Version: "1.0.0"}}}
	if err := checkPeers(res); err != nil {
		t.Fatal(err)
	}
}
```

Adapt the field and type names (`resolvedInput.Members`, the member struct name) to the real definitions in `resolve.go`.

`fetch_tags_test.go` — create a bare origin with a tag, clone it, add a new tag to the origin, call `FetchTags` on the clone, and assert the clone now has the new tag:

```go
package builder

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitRun(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func TestFetchTagsPicksUpANewTag(t *testing.T) {
	root := t.TempDir()
	origin := filepath.Join(root, "origin")
	gitRun(t, root, "init", "-q", origin)
	gitRun(t, origin, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "one")
	gitRun(t, origin, "tag", "v0.1.0")
	clone := filepath.Join(root, "clone")
	gitRun(t, root, "clone", "-q", origin, clone)
	gitRun(t, origin, "tag", "v0.2.0")

	b := newTestBuilder(t)
	if err := b.FetchTags(clone); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gitRun(t, clone, "tag"), "v0.2.0") {
		t.Fatal("v0.2.0 not fetched")
	}
}
```

Use the package's existing test constructor for a `*Builder` with no confinement (search `_test.go` files for one, for example used by `versions_test.go`); if none exists, construct `&Builder{cfg: Config{Logger: slog.Default()}}` the way the versions tests do, and name it `newTestBuilder` in this test file.

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./internal/builder -run 'TestCheckPeers|TestFetchTags' -v`
Expected: FAIL (undefined `ErrPeerConflict`, `FetchTags`).

- [ ] **Step 3: Implement**

In `resolve.go`, add the sentinel and change the return of `checkPeers`:

```go
// ErrPeerConflict marks a build refused because the set's peerVersions do not
// resolve. Callers that choose versions on their own (the upgrade rollout)
// need to tell "these versions do not fit together" from any other failure.
var ErrPeerConflict = errors.New("package versions do not fit together")
```

```go
	if err := pkgbuild.ViolationsError(pkgbuild.SolveCompat(resolved, peersBySlug)); err != nil {
		return fmt.Errorf("%w: %w", ErrPeerConflict, err)
	}
	return nil
```

`fetch_tags.go`:

```go
package builder

import "fmt"

// FetchTags refreshes the tags of a local member clone, so a git+file spec
// that points at it can see a release published after the clone was made.
// It runs confined, like every other fetch the builder performs.
func (b *Builder) FetchTags(dir string) error {
	out, err := runFetchCmd(dir, b.cfg.Confinement, b.cfg.Logger, nil,
		"git", "-C", dir, "fetch", "--tags", "--force", "--prune")
	if err != nil {
		return fmt.Errorf("fetch tags in %s: %w: %s", dir, err, out)
	}
	return nil
}
```

If `runFetchCmd`'s confinement needs the safe-directory `.gitconfig` that `listGitTagVersions` writes, reuse the same setup (factor a helper if needed) and say so in the report.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/builder/... -v -run 'TestCheckPeers|TestFetchTags'` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/builder/resolve.go internal/builder/fetch_tags.go internal/builder/peer_conflict_test.go internal/builder/fetch_tags_test.go
git commit -m "feat(builder): peer-conflict sentinel and tag fetch for member clones"
```

---

### Task 3: orgmanager — crash timestamps

**Files:**
- Modify: `internal/orgmanager/manager.go` (`noteCrash`, the `OrgManager` struct, new method)
- Test: `internal/orgmanager/crash_log_test.go`

**Interfaces:**
- Produces: `func (m *OrgManager) CrashesSince(slug string, since time.Time) int` — the number of unexpected exits of `slug` at or after `since`. The log keeps the last 64 timestamps per slug and is not cleared by `clearCrash` (the soak needs history that a healthy restart would otherwise erase).

- [ ] **Step 1: Write the failing test**

```go
package orgmanager

import (
	"testing"
	"time"
)

func TestCrashesSince(t *testing.T) {
	m := &OrgManager{crashes: map[string]*crashState{}}
	before := time.Now()
	m.noteCrash("acme")
	m.noteCrash("acme")
	m.clearCrash("acme")
	m.noteCrash("other")

	if got := m.CrashesSince("acme", before); got != 2 {
		t.Fatalf("acme crashes = %d, want 2 (clearCrash must not erase the log)", got)
	}
	if got := m.CrashesSince("acme", time.Now().Add(time.Second)); got != 0 {
		t.Fatalf("future window = %d, want 0", got)
	}
	if got := m.CrashesSince("nobody", before); got != 0 {
		t.Fatalf("unknown slug = %d", got)
	}
}
```

If `OrgManager` cannot be built as a bare literal (other fields needed by `noteCrash`), use the package's fake-manager constructor from `fake_spawner_test.go` and drive a real crash with `fakeProcess.crash()`.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/orgmanager -run TestCrashesSince -v`
Expected: FAIL (undefined `CrashesSince`).

- [ ] **Step 3: Implement**

Add to `OrgManager` (next to `crashes`): `crashLog map[string][]time.Time` and initialize it where `crashes` is initialized. In `noteCrash`, after `cs.consecutive++`:

```go
	if m.crashLog == nil {
		m.crashLog = map[string][]time.Time{}
	}
	log := append(m.crashLog[slug], time.Now())
	if len(log) > crashLogCap {
		log = log[len(log)-crashLogCap:]
	}
	m.crashLog[slug] = log
```

```go
// crashLogCap bounds the per-org crash history the upgrade soak reads.
const crashLogCap = 64

// CrashesSince reports how many times slug exited unexpectedly at or after
// since. Unlike the backoff state, this history survives a healthy restart:
// a rollout soak asks "did it crash at all since the deploy".
func (m *OrgManager) CrashesSince(slug string, since time.Time) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for _, at := range m.crashLog[slug] {
		if !at.Before(since) {
			n++
		}
	}
	return n
}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/orgmanager -run TestCrashesSince -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/orgmanager/manager.go internal/orgmanager/crash_log_test.go
git commit -m "feat(orgmanager): keep crash timestamps for upgrade soaks"
```

---

### Task 4: Operator alerts

**Files:**
- Create: `internal/opalert/opalert.go`
- Test: `internal/opalert/opalert_test.go`

**Interfaces:**
- Consumes: `operator_alerts` (Task 1), `coremailer.RenderTransactionalEmail` (`tinycld.org/core/mailer`), PocketBase `app.NewMailClient()`.
- Produces:
  - `type Alert struct { Kind, Fingerprint, Subject, Detail string }`
  - `const ReminderEvery = 7 * 24 * time.Hour`
  - `func Raise(app core.App, a Alert, now time.Time) error` — one row per `Kind` that is not resolved. New row or changed fingerprint → save + email + log at error; same fingerprint → email again only when `last_notified` is ≥ `ReminderEvery` old; otherwise nothing.
  - `func Resolve(app core.App, kind string) error` — marks the unresolved row of `kind` resolved.

- [ ] **Step 1: Write the failing test**

```go
package opalert

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/hosting/internal/controlplane"
	"tinycld.org/hosting/internal/testsupport"
)

func alertApp(t *testing.T) (core.App, *testsupport.Mailbox) {
	t.Helper()
	cp := controlplane.NewForTest(t)
	box := testsupport.CaptureMail(cp.App)
	col, err := cp.App.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	for _, email := range []string{"a@ops.test", "b@ops.test"} {
		su := core.NewRecord(col)
		su.SetEmail(email)
		su.SetPassword("operator-password")
		if err := cp.App.Save(su); err != nil {
			t.Fatal(err)
		}
	}
	return cp.App, box
}

func TestRaiseGate(t *testing.T) {
	app, box := alertApp(t)
	t0 := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	a := Alert{Kind: "rollout_halted", Fingerprint: "fp1", Subject: "Rollout halted", Detail: "acme did not boot"}

	must(t, Raise(app, a, t0))
	must(t, Raise(app, a, t0.Add(time.Hour)))
	if n := len(box.Messages("a@ops.test")); n != 1 {
		t.Fatalf("same alert sent %d times, want 1", n)
	}
	if n := len(box.Messages("b@ops.test")); n != 1 {
		t.Fatalf("second superuser got %d, want 1", n)
	}

	a.Fingerprint = "fp2"
	must(t, Raise(app, a, t0.Add(2*time.Hour)))
	if n := len(box.Messages("a@ops.test")); n != 2 {
		t.Fatalf("changed fingerprint: %d, want 2", n)
	}
	must(t, Raise(app, a, t0.Add(2*time.Hour+ReminderEvery)))
	if n := len(box.Messages("a@ops.test")); n != 3 {
		t.Fatalf("reminder: %d, want 3", n)
	}

	must(t, Resolve(app, "rollout_halted"))
	must(t, Raise(app, a, t0.Add(9*24*time.Hour)))
	if n := len(box.Messages("a@ops.test")); n != 4 {
		t.Fatalf("after resolve: %d, want 4", n)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
```

`controlplane.NewForTest` and `testsupport.CaptureMail` may not exist. Use the existing equivalents: the control-plane test constructor the controlplane tests use (for example `newProvCP`, which is unexported — if no exported constructor exists, add `func NewForTest(t testing.TB) *ControlPlane` to `internal/controlplane/testing.go` guarded so it is only used by tests, mirroring `newProvCP`), and the `Mailbox` capture (`(*Mailbox).capture` is unexported; add an exported `func CaptureMail(app core.App) *Mailbox` in `internal/testsupport/mailbox.go` that creates a Mailbox and calls `capture`). Report what you added.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/opalert -v`
Expected: FAIL (package does not compile).

- [ ] **Step 3: Implement**

```go
// Package opalert tells the people who run this router that something needs
// them: a rollout halted, an update paused, a build that keeps failing. Each
// alert is a durable row (so it can be listed after the fact) and an email to
// every control-plane superuser, gated so a condition that persists for days
// does not send one email per tick.
package opalert

import (
	"errors"
	"database/sql"
	"fmt"
	"net/mail"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
	coremailer "tinycld.org/core/mailer"
	"tinycld.org/core/logging"
)

const ReminderEvery = 7 * 24 * time.Hour

var log = logging.ForPackage("hosting")

type Alert struct {
	Kind        string
	Fingerprint string
	Subject     string
	Detail      string
}

func Raise(app core.App, a Alert, now time.Time) error {
	row, err := app.FindFirstRecordByFilter("operator_alerts",
		"kind = {:k} && resolved = false", map[string]any{"k": a.Kind})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	same := false
	if row == nil {
		col, err := app.FindCollectionByNameOrId("operator_alerts")
		if err != nil {
			return err
		}
		row = core.NewRecord(col)
		row.Set("kind", a.Kind)
		row.Set("first_seen", now)
	} else {
		same = row.GetString("fingerprint") == a.Fingerprint
		if same && now.Sub(row.GetDateTime("last_notified").Time()) < ReminderEvery {
			return nil
		}
		if !same {
			row.Set("first_seen", now)
		}
	}
	row.Set("fingerprint", a.Fingerprint)
	row.Set("subject", a.Subject)
	row.Set("detail", a.Detail)
	row.Set("last_notified", now)
	if err := app.Save(row); err != nil {
		return err
	}
	log.Error(a.Subject, "kind", a.Kind, "detail", a.Detail, "reminder", same)
	return email(app, a, same)
}

func Resolve(app core.App, kind string) error {
	rows, err := app.FindRecordsByFilter("operator_alerts",
		"kind = {:k} && resolved = false", "", 0, 0, map[string]any{"k": kind})
	if err != nil {
		return err
	}
	for _, r := range rows {
		r.Set("resolved", true)
		if err := app.Save(r); err != nil {
			return err
		}
	}
	return nil
}

func email(app core.App, a Alert, reminder bool) error {
	col, err := app.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return err
	}
	sus, err := app.FindAllRecords(col)
	if err != nil {
		return err
	}
	subject := a.Subject
	if reminder {
		subject = "Reminder: " + a.Subject
	}
	html, text := coremailer.RenderTransactionalEmail(coremailer.TransactionalEmail{
		Eyebrow:  "Router alert",
		BodyHTML: coremailer.EscapeHTML(a.Detail),
		BodyText: a.Detail,
	})
	meta := app.Settings().Meta
	from := mail.Address{Name: meta.SenderName, Address: meta.SenderAddress}
	var errs []error
	for _, su := range sus {
		msg := &mailer.Message{
			From:    from,
			To:      []mail.Address{{Address: su.Email()}},
			Subject: subject,
			HTML:    html,
			Text:    text,
		}
		if err := app.NewMailClient().Send(msg); err != nil {
			errs = append(errs, fmt.Errorf("send to %s: %w", su.Email(), err))
		}
	}
	return errors.Join(errs...)
}
```

Check `RenderTransactionalEmail`'s field names and `mailer.Message` fields against `internal/comserver/ready_mail.go`, which already sends this way, and follow it. Use the same `logging.ForPackage("hosting")` logger name other hosting packages use.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/opalert -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/opalert internal/testsupport/mailbox.go internal/controlplane/testing.go
git commit -m "feat(opalert): gated operator alerts with email to superusers"
```

(Stage only the helper files you actually created or changed.)

---

### Task 5: Router SMTP from the environment

**Files:**
- Create: `cmd/serve-router/smtp.go`
- Modify: `cmd/serve-router/main.go` (call `ensureSMTP` next to `ensureSuperuser`; add `MT_SMTP_PASSWORD` to `scrubSecretEnv`'s list)
- Test: `cmd/serve-router/smtp_test.go`

**Interfaces:**
- Produces: `func ensureSMTP(app core.App, getenv func(string) string) error`. Env: `MT_SMTP_HOST`, `MT_SMTP_PORT` (default `587`), `MT_SMTP_USER`, `MT_SMTP_PASSWORD`, `MT_SMTP_FROM` (an address, optionally `Name <addr>`). All unset → log one warning "operator alerts are log-only" and return nil. `MT_SMTP_HOST` set but `MT_SMTP_FROM` missing, or a non-numeric port, → error (boot fails). Otherwise set `Settings().SMTP` (Enabled, Host, Port, Username, Password, TLS false/AuthMethod default) and `Settings().Meta.SenderAddress`/`SenderName`, then `app.Save(settings)`.

- [ ] **Step 1: Write the failing test**

```go
package main

import "testing"

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestEnsureSMTP(t *testing.T) {
	app := newControlPlaneForTest(t)
	err := ensureSMTP(app, envOf(map[string]string{
		"MT_SMTP_HOST":     "smtp.example.test",
		"MT_SMTP_PORT":     "2525",
		"MT_SMTP_USER":     "router",
		"MT_SMTP_PASSWORD": "pw",
		"MT_SMTP_FROM":     "Router <router@example.test>",
	}))
	if err != nil {
		t.Fatal(err)
	}
	s := app.Settings()
	if !s.SMTP.Enabled || s.SMTP.Host != "smtp.example.test" || s.SMTP.Port != 2525 || s.SMTP.Username != "router" {
		t.Fatalf("smtp = %+v", s.SMTP)
	}
	if s.Meta.SenderAddress != "router@example.test" || s.Meta.SenderName != "Router" {
		t.Fatalf("sender = %q <%q>", s.Meta.SenderName, s.Meta.SenderAddress)
	}
}

func TestEnsureSMTPUnsetIsLogOnly(t *testing.T) {
	app := newControlPlaneForTest(t)
	if err := ensureSMTP(app, envOf(nil)); err != nil {
		t.Fatal(err)
	}
	if app.Settings().SMTP.Enabled {
		t.Fatal("SMTP enabled without config")
	}
}

func TestEnsureSMTPRefusesMissingFrom(t *testing.T) {
	app := newControlPlaneForTest(t)
	if err := ensureSMTP(app, envOf(map[string]string{"MT_SMTP_HOST": "h"})); err == nil {
		t.Fatal("want error")
	}
}
```

Use the existing control-plane test constructor available to `cmd/serve-router` tests (grep `_test.go` in `cmd/serve-router` for how they build an app); name the helper `newControlPlaneForTest` only if none exists.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./cmd/serve-router -run TestEnsureSMTP -v`
Expected: FAIL (undefined `ensureSMTP`).

- [ ] **Step 3: Implement `smtp.go`**

```go
package main

import (
	"fmt"
	"log"
	"net/mail"
	"strconv"

	"github.com/pocketbase/pocketbase/core"
)

// ensureSMTP points the control plane's mailer at the operator's SMTP server,
// so router alerts reach a person. Unset leaves alerts in the log and the
// operator_alerts collection only.
func ensureSMTP(app core.App, getenv func(string) string) error {
	host := getenv("MT_SMTP_HOST")
	if host == "" {
		log.Printf("MT_SMTP_HOST not set; operator alerts are log-only")
		return nil
	}
	fromRaw := getenv("MT_SMTP_FROM")
	if fromRaw == "" {
		return fmt.Errorf("MT_SMTP_FROM is required when MT_SMTP_HOST is set")
	}
	from, err := mail.ParseAddress(fromRaw)
	if err != nil {
		return fmt.Errorf("MT_SMTP_FROM: %w", err)
	}
	port := 587
	if p := getenv("MT_SMTP_PORT"); p != "" {
		if port, err = strconv.Atoi(p); err != nil || port <= 0 {
			return fmt.Errorf("MT_SMTP_PORT %q is not a port", p)
		}
	}
	s := app.Settings()
	s.SMTP.Enabled = true
	s.SMTP.Host = host
	s.SMTP.Port = port
	s.SMTP.Username = getenv("MT_SMTP_USER")
	s.SMTP.Password = getenv("MT_SMTP_PASSWORD")
	s.Meta.SenderAddress = from.Address
	s.Meta.SenderName = from.Name
	return app.Save(s)
}
```

In `main.go`, call it right after `ensureSuperuser(app)` (same error handling: a returned error fails boot), passing `os.Getenv`, and add `"MT_SMTP_PASSWORD"` to the `scrubSecretEnv` key list. `ensureSMTP` must run before `scrubSecretEnv`.

- [ ] **Step 4: Run tests**

Run: `go test ./cmd/serve-router -run TestEnsureSMTP -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cmd/serve-router/smtp.go cmd/serve-router/smtp_test.go cmd/serve-router/main.go
git commit -m "feat(router): SMTP for operator alerts from MT_SMTP_*"
```

---

### Task 6: Rollout targets (pure)

**Files:**
- Create: `internal/rollout/target.go`
- Test: `internal/rollout/target_test.go`

**Interfaces:**
- Consumes: `pkgbuild.ClassifySpec`, `pkgbuild.SpecForVersion`, `pkgbuild.SourceGit` (`tinycld.org/core/pkgbuild`).
- Produces:
  - `type VersionsFunc func(spec string) []string` — newest-first versions (raw tags for git, e.g. `v0.6.0`).
  - `type Upgrade struct { Next map[string]string; Changes map[string]string; Major bool }` — `Next` is the full pinned lockfile; `Changes` maps lockfile name → new version (normalized without `v`).
  - `func PlanUpgrade(lock map[string]string, versions VersionsFunc) (Upgrade, error)` — empty `Changes` when nothing is newer.
  - `func WithoutMajors(lock map[string]string, u Upgrade) Upgrade` — keeps only non-major changes (entries with a major change keep their current lockfile value).
  - `func Fingerprint(changes map[string]string) string` — 16 hex chars of sha256 over sorted `name@version`.
  - `func CurrentVersion(value string) string` — the version a lockfile value pins: the `#ref` of a git spec (without `v`), or the npm value itself; `""` for an unpinned git spec.

- [ ] **Step 1: Write the failing test**

```go
package rollout

import "testing"

func vers(m map[string][]string) VersionsFunc {
	return func(spec string) []string { return m[spec] }
}

const gitAlpha = "git+file:///srv/mt/alpha"

func TestPlanUpgradePinsNewestStable(t *testing.T) {
	lock := map[string]string{"alpha": gitAlpha + "#v0.5.0", "beta": "1.2.0"}
	u, err := PlanUpgrade(lock, vers(map[string][]string{
		gitAlpha:     {"v0.7.0-rc.1", "v0.6.0", "v0.5.0"},
		"beta@1.2.0": {"2.0.0", "1.3.0", "1.2.0"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if u.Next["alpha"] != gitAlpha+"#v0.6.0" || u.Next["beta"] != "2.0.0" {
		t.Fatalf("next = %v", u.Next)
	}
	if u.Changes["alpha"] != "0.6.0" || u.Changes["beta"] != "2.0.0" || !u.Major {
		t.Fatalf("changes = %v major=%v", u.Changes, u.Major)
	}
}

func TestPlanUpgradeNothingNewer(t *testing.T) {
	lock := map[string]string{"alpha": gitAlpha + "#v0.6.0"}
	u, err := PlanUpgrade(lock, vers(map[string][]string{gitAlpha: {"v0.7.0-beta", "v0.6.0"}}))
	if err != nil || len(u.Changes) != 0 {
		t.Fatalf("u=%+v err=%v", u, err)
	}
}

func TestPlanUpgradeUnpinnedGitIsSkipped(t *testing.T) {
	lock := map[string]string{"alpha": gitAlpha}
	u, err := PlanUpgrade(lock, vers(map[string][]string{gitAlpha: {"v0.6.0"}}))
	if err != nil || len(u.Changes) != 0 {
		t.Fatalf("an unpinned spec has no known current version; got %+v err=%v", u, err)
	}
}

func TestWithoutMajors(t *testing.T) {
	lock := map[string]string{"alpha": gitAlpha + "#v0.5.0", "beta": "1.2.0"}
	u, _ := PlanUpgrade(lock, vers(map[string][]string{
		gitAlpha:     {"v0.6.0"},
		"beta@1.2.0": {"2.0.0"},
	}))
	m := WithoutMajors(lock, u)
	if m.Next["beta"] != "1.2.0" || m.Next["alpha"] != gitAlpha+"#v0.6.0" || m.Major || len(m.Changes) != 1 {
		t.Fatalf("got %+v", m)
	}
}

func TestFingerprint(t *testing.T) {
	a := Fingerprint(map[string]string{"alpha": "0.6.0", "beta": "2.0.0"})
	b := Fingerprint(map[string]string{"beta": "2.0.0", "alpha": "0.6.0"})
	if a != b || len(a) != 16 || a == Fingerprint(map[string]string{"alpha": "0.6.1"}) {
		t.Fatalf("a=%s b=%s", a, b)
	}
}
```

Note on the npm key: the spec passed to `versions` for an npm entry is `name + "@" + value` (the same shape `specForLockEntry` builds in `controlplane/deploy.go`). An unpinned git spec has no current version, so it is skipped; the installer's default lockfile pins nothing today, which is why Task 14's README tells the operator to pin it once.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/rollout -run 'TestPlanUpgrade|TestWithoutMajors|TestFingerprint' -v`
Expected: FAIL (package does not compile).

- [ ] **Step 3: Implement**

```go
// Package rollout upgrades opted-in orgs in rings, watching each ring before
// the next one starts. target.go is the pure part: what each org should move
// to, given what it runs and what is published.
package rollout

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
	"tinycld.org/core/pkgbuild"
)

type VersionsFunc func(spec string) []string

type Upgrade struct {
	Next    map[string]string
	Changes map[string]string
	Major   bool
}

func CurrentVersion(value string) string {
	if src, _ := pkgbuild.ClassifySpec(value); src == pkgbuild.SourceGit {
		i := strings.Index(value, "#")
		if i < 0 {
			return ""
		}
		return strings.TrimPrefix(value[i+1:], "v")
	}
	return value
}

func specFor(name, value string) string {
	if src, _ := pkgbuild.ClassifySpec(value); src == pkgbuild.SourceGit {
		if i := strings.Index(value, "#"); i >= 0 {
			return value[:i]
		}
		return value
	}
	return name + "@" + value
}

// newestStable returns the newest non-prerelease entry of versions that is
// newer than current, as listed (git tags keep their "v").
func newestStable(versions []string, current string) (string, *semver.Version) {
	cur, err := semver.NewVersion(current)
	if err != nil {
		return "", nil
	}
	var best string
	var bestV *semver.Version
	for _, raw := range versions {
		v, err := semver.NewVersion(raw)
		if err != nil || v.Prerelease() != "" || !v.GreaterThan(cur) {
			continue
		}
		if bestV == nil || v.GreaterThan(bestV) {
			best, bestV = raw, v
		}
	}
	return best, bestV
}

func PlanUpgrade(lock map[string]string, versions VersionsFunc) (Upgrade, error) {
	u := Upgrade{Next: map[string]string{}, Changes: map[string]string{}}
	for name, value := range lock {
		u.Next[name] = value
		current := CurrentVersion(value)
		if current == "" {
			continue
		}
		raw, v := newestStable(versions(specFor(name, value)), current)
		if v == nil {
			continue
		}
		next := v.String()
		if src, _ := pkgbuild.ClassifySpec(value); src == pkgbuild.SourceGit {
			pinned, err := pkgbuild.SpecForVersion(specFor(name, value), raw)
			if err != nil {
				return Upgrade{}, fmt.Errorf("pin %s: %w", name, err)
			}
			u.Next[name] = pinned
		} else {
			u.Next[name] = next
		}
		u.Changes[name] = next
		if cur, _ := semver.NewVersion(current); cur != nil && v.Major() != cur.Major() {
			u.Major = true
		}
	}
	return u, nil
}

func WithoutMajors(lock map[string]string, u Upgrade) Upgrade {
	out := Upgrade{Next: map[string]string{}, Changes: map[string]string{}}
	for name, value := range lock {
		out.Next[name] = value
	}
	for name, to := range u.Changes {
		cur, err1 := semver.NewVersion(CurrentVersion(lock[name]))
		next, err2 := semver.NewVersion(to)
		if err1 != nil || err2 != nil || next.Major() != cur.Major() {
			continue
		}
		out.Next[name] = u.Next[name]
		out.Changes[name] = to
	}
	return out
}

func Fingerprint(changes map[string]string) string {
	pairs := make([]string, 0, len(changes))
	for name, v := range changes {
		pairs = append(pairs, name+"@"+v)
	}
	sort.Strings(pairs)
	sum := sha256.Sum256([]byte(strings.Join(pairs, ",")))
	return hex.EncodeToString(sum[:8])
}
```

Check `pkgbuild.ClassifySpec`'s return types (`(PkgSource, string)`) and that `SpecForVersion(spec, "v0.6.0")` returns `spec#v0.6.0` for git; adapt if needed.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/rollout -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/rollout/target.go internal/rollout/target_test.go
git commit -m "feat(rollout): pinned upgrade targets"
```

---

### Task 7: Rings and config (pure)

**Files:**
- Create: `internal/rollout/rings.go`
- Test: `internal/rollout/rings_test.go`

**Interfaces:**
- Consumes: core `autoupgrade.Window`, `autoupgrade.ParseWindow`.
- Produces:
  - `type Config struct { Window autoupgrade.Window; Soak [3][2]time.Duration }` — `Soak[ring][0]` minor, `[1]` major.
  - `func DefaultConfig() Config` — window `02:00-05:00`; soaks 72h/168h, 48h/120h, 24h/72h.
  - `func LoadConfig(getenv func(string) string) (Config, error)` — `MT_UPGRADE_WINDOW`, `MT_ROLLOUT_SOAK_R{0,1,2}_{MINOR,MAJOR}`; malformed or ≤0 is an error.
  - `func (c Config) SoakFor(ring int, major bool) time.Duration` — 0 for ring 3.
  - `type Candidate struct { Slug string; Sentinel bool }`
  - `func AssignRings(cands []Candidate, rnd *rand.Rand) map[string]int` — ring 0 = sentinels; ring 1 = `clamp(ceil(5% of rest), 1, 5)` random picks from the rest (0 if no rest); ring 2 = `ceil(25% of the remaining)` random picks; ring 3 = everything left.
  - `const LastRing = 3`

- [ ] **Step 1: Write the failing test**

```go
package rollout

import (
	"fmt"
	"math/rand"
	"testing"
	"time"
)

func TestDefaultConfigSoaks(t *testing.T) {
	c := DefaultConfig()
	if c.SoakFor(0, false) != 72*time.Hour || c.SoakFor(0, true) != 168*time.Hour ||
		c.SoakFor(1, false) != 48*time.Hour || c.SoakFor(2, true) != 72*time.Hour || c.SoakFor(3, true) != 0 {
		t.Fatalf("soaks = %+v", c.Soak)
	}
}

func TestLoadConfig(t *testing.T) {
	c, err := LoadConfig(func(k string) string {
		return map[string]string{"MT_UPGRADE_WINDOW": "01:00-03:00", "MT_ROLLOUT_SOAK_R1_MAJOR": "10m"}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	if c.SoakFor(1, true) != 10*time.Minute || c.SoakFor(0, false) != 72*time.Hour {
		t.Fatalf("soaks = %+v", c.Soak)
	}
	for _, bad := range []map[string]string{
		{"MT_UPGRADE_WINDOW": "01:00-01:30"},
		{"MT_ROLLOUT_SOAK_R0_MINOR": "soon"},
		{"MT_ROLLOUT_SOAK_R2_MAJOR": "0s"},
	} {
		if _, err := LoadConfig(func(k string) string { return bad[k] }); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
}

func TestAssignRings(t *testing.T) {
	var cands []Candidate
	cands = append(cands, Candidate{Slug: "s1", Sentinel: true}, Candidate{Slug: "s2", Sentinel: true})
	for i := 0; i < 100; i++ {
		cands = append(cands, Candidate{Slug: fmt.Sprintf("o%d", i)})
	}
	rings := AssignRings(cands, rand.New(rand.NewSource(1)))
	count := map[int]int{}
	for _, r := range rings {
		count[r]++
	}
	if rings["s1"] != 0 || rings["s2"] != 0 || count[0] != 2 {
		t.Fatalf("ring 0 = %d", count[0])
	}
	if count[1] != 5 || count[2] != 24 || count[3] != 71 {
		t.Fatalf("rings = %v", count)
	}
}

func TestAssignRingsSmall(t *testing.T) {
	rings := AssignRings([]Candidate{{Slug: "only"}}, rand.New(rand.NewSource(1)))
	if rings["only"] != 1 {
		t.Fatalf("a lone org goes in ring 1 (min 1), got %d", rings["only"])
	}
}
```

(100 non-sentinels: ring 1 = clamp(ceil(5), 1, 5) = 5; remaining 95; ring 2 = ceil(23.75) = 24; ring 3 = 71.)

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/rollout -run 'TestDefaultConfig|TestLoadConfig|TestAssignRings' -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
package rollout

import (
	"fmt"
	"math"
	"math/rand"
	"time"

	"tinycld.org/core/autoupgrade"
)

const LastRing = 3

type Config struct {
	Window autoupgrade.Window
	Soak   [3][2]time.Duration
}

func DefaultConfig() Config {
	w, _ := autoupgrade.ParseWindow(autoupgrade.DefaultWindow)
	return Config{Window: w, Soak: [3][2]time.Duration{
		{72 * time.Hour, 168 * time.Hour},
		{48 * time.Hour, 120 * time.Hour},
		{24 * time.Hour, 72 * time.Hour},
	}}
}

func LoadConfig(getenv func(string) string) (Config, error) {
	c := DefaultConfig()
	if raw := getenv("MT_UPGRADE_WINDOW"); raw != "" {
		w, err := autoupgrade.ParseWindow(raw)
		if err != nil {
			return Config{}, fmt.Errorf("MT_UPGRADE_WINDOW: %w", err)
		}
		c.Window = w
	}
	for ring := 0; ring < 3; ring++ {
		for i, kind := range []string{"MINOR", "MAJOR"} {
			name := fmt.Sprintf("MT_ROLLOUT_SOAK_R%d_%s", ring, kind)
			raw := getenv(name)
			if raw == "" {
				continue
			}
			d, err := time.ParseDuration(raw)
			if err != nil || d <= 0 {
				return Config{}, fmt.Errorf("%s: %q is not a positive duration", name, raw)
			}
			c.Soak[ring][i] = d
		}
	}
	return c, nil
}

func (c Config) SoakFor(ring int, major bool) time.Duration {
	if ring < 0 || ring >= 3 {
		return 0
	}
	if major {
		return c.Soak[ring][1]
	}
	return c.Soak[ring][0]
}

type Candidate struct {
	Slug     string
	Sentinel bool
}

func AssignRings(cands []Candidate, rnd *rand.Rand) map[string]int {
	out := map[string]int{}
	var rest []string
	for _, c := range cands {
		if c.Sentinel {
			out[c.Slug] = 0
		} else {
			rest = append(rest, c.Slug)
		}
	}
	rnd.Shuffle(len(rest), func(i, j int) { rest[i], rest[j] = rest[j], rest[i] })
	n1 := 0
	if len(rest) > 0 {
		n1 = min(max(int(math.Ceil(float64(len(rest))*0.05)), 1), 5, len(rest))
	}
	for _, s := range rest[:n1] {
		out[s] = 1
	}
	rest = rest[n1:]
	n2 := int(math.Ceil(float64(len(rest)) * 0.25))
	for _, s := range rest[:n2] {
		out[s] = 2
	}
	for _, s := range rest[n2:] {
		out[s] = LastRing
	}
	return out
}
```

`autoupgrade.DefaultWindow` is the core constant `"02:00-05:00"`.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/rollout -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/rollout/rings.go internal/rollout/rings_test.go
git commit -m "feat(rollout): rings, soak lengths and env config"
```

---

### Task 8: Deploy with a snapshot

**Files:**
- Modify: `internal/controlplane/deploy.go` (`deploy` gains a snapshot mode; new `DeployWithSnapshot`)
- Test: `internal/controlplane/deploy_snapshot_test.go`

**Interfaces:**
- Consumes: `snapshot.VacuumReadOnly(src, dest string) error` (`tinycld.org/core/backup/snapshot`), existing `snapshotPath`, `captureSnapshot`, `restoreSnapshot`, `finish`.
- Produces: `func (d *Deployer) DeployWithSnapshot(ctx context.Context, slug string, next map[string]string, jobID string) (string, error)` — like `Deploy`, but first copies the live `pb_data/data.db` into `.deploy/backup.db` with `VacuumReadOnly` (removing any stale file first), gives the copy (and any `data.db-shm`/`-wal` the copy created) the owner and group of `data.db`, fingerprints it with `captureSnapshot`, and passes that ref to `finish` so a failed boot restores it. A snapshot error aborts the deploy before the build (recorded as a `failed` deployments row).

- [ ] **Step 1: Write the failing test**

Model it on the existing reverted-deploy test in `deploy_test.go` (the one using `DeployProposed`), but with a real SQLite file:

```go
package controlplane

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func writeDB(t *testing.T, path, value string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS t (v TEXT); DELETE FROM t; INSERT INTO t VALUES (?)`, value); err != nil {
		t.Fatal(err)
	}
}

func readDB(t *testing.T, path string) string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var v string
	if err := db.QueryRow(`SELECT v FROM t`).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDeployWithSnapshotRestoresOnBootFailure(t *testing.T) {
	h := newDeployHarness(t)
	dbPath := filepath.Join(h.orgDir, "pb_data", "data.db")
	writeDB(t, dbPath, "before")

	verify := func(ctx context.Context, slug string) error {
		rec, err := h.cp.App.FindFirstRecordByData("orgs", "slug", slug)
		if err != nil {
			return err
		}
		if rec.GetString("recipe_hash") == hashNew {
			writeDB(t, dbPath, "migrated-then-crashed")
			return fmt.Errorf("boot failed")
		}
		return nil
	}
	d := newDeployer(h.cp.App, h.root, &fakeArtifactBuilder{hash: hashNew},
		func(string) {}, verify, nil, quietTestLogger())

	if _, err := d.DeployWithSnapshot(context.Background(), "acme", map[string]string{"tinycld": "1.1.0"}, "job_auto"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "reverted", func() bool { return h.lastDeployment(t).GetString("status") == "reverted" })
	if got := readDB(t, dbPath); got != "before" {
		t.Fatalf("db = %q, want the pre-deploy snapshot", got)
	}
}

func TestDeployWithSnapshotDropsSnapshotOnCommit(t *testing.T) {
	h := newDeployHarness(t)
	writeDB(t, filepath.Join(h.orgDir, "pb_data", "data.db"), "before")
	d := newDeployer(h.cp.App, h.root, &fakeArtifactBuilder{hash: hashNew},
		func(string) {}, func(context.Context, string) error { return nil }, nil, quietTestLogger())
	if _, err := d.DeployWithSnapshot(context.Background(), "acme", map[string]string{"tinycld": "1.1.0"}, "job_auto"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "committed", func() bool { return h.lastDeployment(t).GetString("status") == "committed" })
	if _, err := os.Stat(snapshotPath(h.orgDir)); !os.IsNotExist(err) {
		t.Fatalf("snapshot not dropped: %v", err)
	}
}
```

Use the SQLite driver the module already depends on (grep `go.mod` for `modernc.org/sqlite` or the fork's driver) and add the `os` import.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/controlplane -run TestDeployWithSnapshot -v`
Expected: FAIL (undefined `DeployWithSnapshot`).

- [ ] **Step 3: Implement**

Change `deploy`'s `proposed bool` parameter into a mode so all three entry points share one body:

```go
type snapshotMode int

const (
	snapshotNone     snapshotMode = iota // operator deploy: never restore
	snapshotProposed                     // the tenant wrote .deploy/backup.db before proposing
	snapshotTake                         // the router takes the snapshot itself
)
```

`Deploy` passes `snapshotNone`, `DeployProposed` passes `snapshotProposed`, and:

```go
// DeployWithSnapshot is Deploy for an unattended upgrade: nobody is watching,
// so a build that fails its boot must come back with the data it had. The
// router copies the live database itself (VACUUM INTO, read-only, while the
// tenant serves) and the revert restores that copy.
func (d *Deployer) DeployWithSnapshot(ctx context.Context, slug string, next map[string]string, jobID string) (string, error) {
	return d.deploy(ctx, slug, next, jobID, snapshotTake, "")
}
```

Inside `deploy`, before `d.buildSet(...)`, for `snapshotTake`:

```go
	orgDir := filepath.Join(d.root, "pb_orgs", slug)
	if mode == snapshotTake {
		if err := takeSnapshot(orgDir); err != nil {
			d.recordDeployment(rec.Id, lfBytes, "", jobID, "failed", err)
			return "", fmt.Errorf("snapshot before upgrade: %w", err)
		}
	}
```

and where the ref is captured:

```go
	var snap snapshotRef
	if mode != snapshotNone {
		snap = captureSnapshot(orgDir)
	}
```

Add:

```go
// takeSnapshot copies the org's live database to .deploy/backup.db and gives
// the copy the database's own owner, so the tenant (a different uid) can open
// it after a restore.
func takeSnapshot(orgDir string) error {
	src := filepath.Join(orgDir, "pb_data", "data.db")
	dest := snapshotPath(orgDir)
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return err
	}
	if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := snapshot.VacuumReadOnly(src, dest); err != nil {
		return err
	}
	fi, err := os.Stat(src)
	if err != nil {
		return err
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	for _, p := range []string{filepath.Dir(dest), dest, src + "-shm", src + "-wal"} {
		if err := os.Chown(p, int(st.Uid), int(st.Gid)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
```

Keep every existing deploy test passing unchanged.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/controlplane -run 'Deploy' -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/deploy.go internal/controlplane/deploy_snapshot_test.go
git commit -m "feat(controlplane): deploy with a router-taken snapshot"
```

---

### Task 9: Rollout engine — discovery and rollouts

**Files:**
- Create: `internal/rollout/engine.go`, `internal/rollout/store.go`
- Test: `internal/rollout/discover_test.go`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 6, 7.
- Produces:
  - ```go
    type Deps struct {
        App        core.App
        Versions   VersionsFunc                                           // builder.VersionsForSpec, versions only
        FetchTags  func(dir string) error                                 // builder.FetchTags
        Build      func(ctx context.Context, lock map[string]string) error // Deployer.BuildSet, error only
        Deploy     func(ctx context.Context, slug string, next map[string]string, jobID string) error // Deployer.DeployWithSnapshot
        Crashes    func(slug string, since time.Time) int                  // OrgManager.CrashesSince
        Alert      func(a opalert.Alert, now time.Time) error              // opalert.Raise bound to App
        Rand       *rand.Rand
        Config     Config
        CloneRoot  string // $MT_HOME; git+file specs under it are fetched
    }
    type Engine struct{ d Deps }
    func New(d Deps) *Engine
    func (e *Engine) Discover(ctx context.Context, now time.Time) error
    ```
  - `Discover`:
    1. For each distinct `git+file://<CloneRoot>/...` spec in active opted-in orgs' lockfiles, call `FetchTags(dir)`; log and continue on error.
    2. For each `orgs` row with `status = 'active' && auto_upgrade = true`: parse `lockfile` (JSON object), `PlanUpgrade` with `Versions`. Skip when no changes.
    3. Compat: `Build(target.Next)`. On `errors.Is(err, builder.ErrPeerConflict)`: try `WithoutMajors`; if that has changes and builds, use it; otherwise `Alert(kind "update_paused:<slug>", fingerprint = Fingerprint(changes), subject "Updates paused for <slug>", detail = the error text)` and skip. Any other build error: `Alert(kind "update_build_failed:<slug>", ...)` and skip.
    4. Skip a target whose fingerprint is in `rollout_blocks`.
    5. Group orgs by fingerprint. For each group: if an `active` or `halted` rollout with this fingerprint exists, add any org not yet in it as `pending` in ring 3; otherwise supersede (see below) and create a new `active` rollout at ring 0 with `ring_started` empty and one `rollout_orgs` row per org (`pending`, `from_lockfile` = current, `to_lockfile` = target, `ring` from `AssignRings` over the group, with `Sentinel` from `orgs.rollout_ring == "sentinel"`).
    6. Supersede: an `active` rollout whose `packages` share a package name with the new target and whose version for it is lower → set it `superseded`, delete its `pending` `rollout_orgs` rows (those orgs are in the new rollout already, because their own target was computed fresh).
  - `store.go` holds small helpers: `activeOptedIn(app) ([]*core.Record, error)`, `lockOf(rec) (map[string]string, error)`, `isBlocked(app, fp) (bool, error)`, `findRollout(app, fp) (*core.Record, error)` (state `active` or `halted`), `createRollout(app, fp string, changes map[string]string, major bool) (*core.Record, error)`, `addRolloutOrg(app, rolloutID, slug string, ring int, from, to map[string]string) error`.

- [ ] **Step 1: Write the failing test**

Use an in-package fake for `Deps` and the control-plane test app (from Task 4's `controlplane.NewForTest`):

```go
package rollout

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/hosting/internal/builder"
	"tinycld.org/hosting/internal/controlplane"
	"tinycld.org/hosting/internal/opalert"
)

type fakeWorld struct {
	app      core.App
	versions map[string][]string
	buildErr func(lock map[string]string) error
	alerts   []opalert.Alert
}

func newWorld(t *testing.T) *fakeWorld {
	cp := controlplane.NewForTest(t)
	return &fakeWorld{app: cp.App, versions: map[string][]string{}, buildErr: func(map[string]string) error { return nil }}
}

func (w *fakeWorld) org(t *testing.T, slug string, lock map[string]string, optIn, sentinel bool) {
	t.Helper()
	col, err := w.app.FindCollectionByNameOrId("orgs")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(lock)
	r := core.NewRecord(col)
	r.Set("slug", slug)
	r.Set("status", "active")
	r.Set("data_dir", "pb_orgs/"+slug)
	r.Set("lockfile", string(b))
	r.Set("auto_upgrade", optIn)
	if sentinel {
		r.Set("rollout_ring", "sentinel")
	}
	if err := w.app.Save(r); err != nil {
		t.Fatal(err)
	}
}

func (w *fakeWorld) engine() *Engine {
	return New(Deps{
		App:       w.app,
		Versions:  func(spec string) []string { return w.versions[spec] },
		FetchTags: func(string) error { return nil },
		Build:     func(_ context.Context, lock map[string]string) error { return w.buildErr(lock) },
		Deploy:    func(context.Context, string, map[string]string, string) error { return nil },
		Crashes:   func(string, time.Time) int { return 0 },
		Alert:     func(a opalert.Alert, _ time.Time) error { w.alerts = append(w.alerts, a); return nil },
		Rand:      rand.New(rand.NewSource(1)),
		Config:    DefaultConfig(),
	})
}

var now = time.Date(2026, 10, 1, 3, 0, 0, 0, time.Local)

func TestDiscoverCreatesOneRolloutPerTarget(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	w.org(t, "o1", map[string]string{"alpha": "1.0.0"}, true, false)
	w.org(t, "out", map[string]string{"alpha": "1.0.0"}, false, false)

	if err := w.engine().Discover(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	rs, _ := w.app.FindRecordsByFilter("rollouts", "1=1", "", 0, 0)
	if len(rs) != 1 || rs[0].GetString("state") != "active" {
		t.Fatalf("rollouts = %d", len(rs))
	}
	ros, _ := w.app.FindRecordsByFilter("rollout_orgs", "1=1", "org", 0, 0)
	if len(ros) != 2 {
		t.Fatalf("rollout_orgs = %d, want 2 (opted-out org excluded)", len(ros))
	}
	if ros[1].GetString("org") != "s1" || ros[1].GetInt("ring") != 0 {
		t.Fatalf("sentinel not in ring 0: %s ring %d", ros[1].GetString("org"), ros[1].GetInt("ring"))
	}

	// A second discovery with nothing new adds nothing.
	if err := w.engine().Discover(context.Background(), now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if rs, _ := w.app.FindRecordsByFilter("rollouts", "1=1", "", 0, 0); len(rs) != 1 {
		t.Fatalf("rollouts after rerun = %d", len(rs))
	}
}

func TestDiscoverDropsMajorsOnPeerConflict(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"2.0.0", "1.0.0"}
	w.versions["beta@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.buildErr = func(lock map[string]string) error {
		if lock["alpha"] == "2.0.0" {
			return fmt.Errorf("%w: alpha needs core 2", builder.ErrPeerConflict)
		}
		return nil
	}
	w.org(t, "o1", map[string]string{"alpha": "1.0.0", "beta": "1.0.0"}, true, false)
	if err := w.engine().Discover(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	rs, _ := w.app.FindRecordsByFilter("rollouts", "1=1", "", 0, 0)
	if len(rs) != 1 || rs[0].GetBool("major") {
		t.Fatalf("want one minor rollout, got %d", len(rs))
	}
	var pk map[string]string
	_ = rs[0].UnmarshalJSONField("packages", &pk)
	if pk["beta"] != "1.1.0" || pk["alpha"] != "" {
		t.Fatalf("packages = %v", pk)
	}
}

func TestDiscoverPausesWhenNothingFits(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.buildErr = func(map[string]string) error { return fmt.Errorf("%w: no", builder.ErrPeerConflict) }
	w.org(t, "o1", map[string]string{"alpha": "1.0.0"}, true, false)
	if err := w.engine().Discover(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if rs, _ := w.app.FindRecordsByFilter("rollouts", "1=1", "", 0, 0); len(rs) != 0 {
		t.Fatal("rollout created for a set that does not build")
	}
	if len(w.alerts) != 1 || w.alerts[0].Kind != "update_paused:o1" {
		t.Fatalf("alerts = %+v", w.alerts)
	}
}

func TestDiscoverSkipsBlocked(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "o1", map[string]string{"alpha": "1.0.0"}, true, false)
	col, _ := w.app.FindCollectionByNameOrId("rollout_blocks")
	b := core.NewRecord(col)
	b.Set("fingerprint", Fingerprint(map[string]string{"alpha": "1.1.0"}))
	if err := w.app.Save(b); err != nil {
		t.Fatal(err)
	}
	if err := w.engine().Discover(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if rs, _ := w.app.FindRecordsByFilter("rollouts", "1=1", "", 0, 0); len(rs) != 0 {
		t.Fatal("blocked target rolled out")
	}
}

func TestDiscoverSupersedes(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "o1", map[string]string{"alpha": "1.0.0"}, true, false)
	if err := w.engine().Discover(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	w.versions["alpha@1.0.0"] = []string{"1.2.0", "1.1.0", "1.0.0"}
	if err := w.engine().Discover(context.Background(), now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	old, _ := w.app.FindFirstRecordByFilter("rollouts", "fingerprint = {:f}", map[string]any{"f": Fingerprint(map[string]string{"alpha": "1.1.0"})})
	if old.GetString("state") != "superseded" {
		t.Fatalf("old rollout state = %s", old.GetString("state"))
	}
	ros, _ := w.app.FindRecordsByFilter("rollout_orgs", "rollout = {:r}", "", 0, 0, map[string]any{"r": old.Id})
	if len(ros) != 0 {
		t.Fatal("pending orgs left on the superseded rollout")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/rollout -run TestDiscover -v`
Expected: FAIL (undefined `New`, `Deps`).

- [ ] **Step 3: Implement `store.go` and the `Discover` half of `engine.go`**

Write the helpers listed under Interfaces and `Discover` following steps 1–6 exactly. Notes the implementer needs:

- The fetch in step 1: a lockfile value is under the clone root when `strings.HasPrefix(spec, "git+file://"+CloneRoot+"/")`; the dir is the spec with the `git+file://` prefix and any `#ref` removed. De-duplicate dirs.
- `rollouts.packages` stores `Changes` (name → version); `major` = `Upgrade.Major`.
- When grouping, process orgs in slug order so test output is stable.
- Alert kinds must be the exact strings above; the fingerprint for a pause is `Fingerprint(changes)` of the full (with-majors) target plus nothing else.
- `Discover` returns an error only when the database fails; per-org problems are alerts and logs.
- Comments explain "why", not "what".

- [ ] **Step 4: Run tests**

Run: `go test ./internal/rollout -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/rollout/engine.go internal/rollout/store.go internal/rollout/discover_test.go
git commit -m "feat(rollout): discover targets and open rollouts"
```

---

### Task 10: Rollout engine — advance, deploy, soak

**Files:**
- Modify: `internal/rollout/engine.go`, `internal/rollout/store.go`
- Test: `internal/rollout/advance_test.go`

**Interfaces:**
- Produces: `func (e *Engine) Advance(ctx context.Context, now time.Time) error` and `func (e *Engine) Tick(ctx context.Context, now time.Time) error` (= `Discover` then `Advance`). For each `active` rollout, in this order:
  1. **Observe deploys.** For each `deploying` row: read the newest `deployments` row with `job_id = rollout_orgs.deploy_job`. `committed` → `soaking`, `deployed_at = now`. `reverted` or `failed` → row `reverted`; rollout `halted`, `halt_reason = "<org>: <deployments.error>"`; insert `rollout_blocks` (fingerprint, packages, reason); `Alert{Kind: "rollout_halted:<rolloutID>", Fingerprint: <rolloutID>+":"+<org>, Subject: "Rollout halted: <org> did not start on the new version", Detail: ...}`. `proposed` → still running, skip.
  2. **Soak check.** For each `soaking` row: if `Crashes(org, deployed_at) > 0` → row `flagged`, rollout `halted`, alert (same kind, subject "Rollout halted: <org> crashed after the upgrade"). Else if `now - deployed_at >= Config.SoakFor(ring, major)` → `passed`.
  3. **Ring complete?** When every row of the current ring is `passed` (and the ring had rows, or the ring is empty): move to the next ring that has rows (`ring = next`, `ring_started` empty). After ring 3 completes → rollout `done`; `opalert.Resolve`-style resolution is not needed for done.
  4. **Deploy.** Only when `Config.Window.Contains(now)`: if no row in this rollout is `deploying`, take the next `pending` row of the current ring (slug order), set `ring_started` if empty, generate `jobID = "auto_" + rolloutID + "_" + org`, set row `deploying` + `deploy_job`, then call `Deploy(ctx, org, to_lockfile, jobID)`. A `Deploy` error → treat like a revert (row `reverted`, halt, block, alert). One deploy per rollout per tick keeps the builder queue and the risk small.
  - A `halted` rollout is skipped entirely until an operator resumes it.
  - The soak for ring 3 is 0, so ring-3 rows pass on the first check after commit.

- [ ] **Step 1: Write the failing test**

Reuse `fakeWorld` from Task 9's test file. Add a fake deployments writer: the fake `Deploy` creates a `deployments` row with `job_id` and a status chosen by the test.

```go
package rollout

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func (w *fakeWorld) deployOutcome(t *testing.T, status func(slug string) string) func(context.Context, string, map[string]string, string) error {
	return func(_ context.Context, slug string, _ map[string]string, job string) error {
		col, err := w.app.FindCollectionByNameOrId("deployments")
		if err != nil {
			return err
		}
		org, err := w.app.FindFirstRecordByData("orgs", "slug", slug)
		if err != nil {
			return err
		}
		r := core.NewRecord(col)
		r.Set("org", org.Id)
		r.Set("job_id", job)
		r.Set("status", status(slug))
		r.Set("error", "boot failed")
		return w.app.Save(r)
	}
}

func shortSoaks() Config {
	c := DefaultConfig()
	for r := range c.Soak {
		c.Soak[r] = [2]time.Duration{time.Hour, time.Hour}
	}
	return c
}

func TestAdvanceRunsAllRings(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	w.org(t, "o1", map[string]string{"alpha": "1.0.0"}, true, false)
	w.org(t, "o2", map[string]string{"alpha": "1.0.0"}, true, false)
	e := w.engine()
	e.d.Config = shortSoaks()
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "committed" })

	at := now
	for i := 0; i < 40; i++ {
		if err := e.Tick(context.Background(), at); err != nil {
			t.Fatal(err)
		}
		at = at.Add(30 * time.Minute)
		if !e.d.Config.Window.Contains(at) {
			at = e.d.Config.Window.NextStart(at)
		}
	}
	r, _ := w.app.FindFirstRecordByFilter("rollouts", "1=1")
	if r.GetString("state") != "done" {
		t.Fatalf("state = %s ring = %d", r.GetString("state"), r.GetInt("ring"))
	}
}

func TestAdvanceHaltsOnRevert(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	w.org(t, "o1", map[string]string{"alpha": "1.0.0"}, true, false)
	e := w.engine()
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "reverted" })

	for i := 0; i < 3; i++ {
		if err := e.Tick(context.Background(), now.Add(time.Duration(i)*15*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	r, _ := w.app.FindFirstRecordByFilter("rollouts", "1=1")
	if r.GetString("state") != "halted" {
		t.Fatalf("state = %s", r.GetString("state"))
	}
	if b, _ := w.app.FindRecordsByFilter("rollout_blocks", "1=1", "", 0, 0); len(b) != 1 {
		t.Fatal("target not blocked")
	}
	if len(w.alerts) != 1 {
		t.Fatalf("alerts = %d", len(w.alerts))
	}
	o1, _ := w.app.FindFirstRecordByFilter("rollout_orgs", "org = 'o1'")
	if o1.GetString("state") != "pending" {
		t.Fatalf("o1 deployed after the halt: %s", o1.GetString("state"))
	}
}

func TestAdvanceFlagsCrashDuringSoak(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	e := w.engine()
	e.d.Deploy = w.deployOutcome(t, func(string) string { return "committed" })
	crashed := false
	e.d.Crashes = func(string, time.Time) int {
		if crashed {
			return 1
		}
		return 0
	}
	_ = e.Tick(context.Background(), now)
	_ = e.Tick(context.Background(), now.Add(15*time.Minute))
	crashed = true
	_ = e.Tick(context.Background(), now.Add(30*time.Minute))
	s1, _ := w.app.FindFirstRecordByFilter("rollout_orgs", "org = 's1'")
	r, _ := w.app.FindFirstRecordByFilter("rollouts", "1=1")
	if s1.GetString("state") != "flagged" || r.GetString("state") != "halted" {
		t.Fatalf("s1=%s rollout=%s", s1.GetString("state"), r.GetString("state"))
	}
}

func TestAdvanceWaitsForWindow(t *testing.T) {
	w := newWorld(t)
	w.versions["alpha@1.0.0"] = []string{"1.1.0", "1.0.0"}
	w.org(t, "s1", map[string]string{"alpha": "1.0.0"}, true, true)
	e := w.engine()
	deploys := 0
	e.d.Deploy = func(context.Context, string, map[string]string, string) error { deploys++; return nil }
	noon := time.Date(2026, 10, 1, 12, 0, 0, 0, time.Local)
	_ = e.Tick(context.Background(), noon)
	if deploys != 0 {
		t.Fatal("deployed outside the window")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/rollout -run TestAdvance -v`
Expected: FAIL (undefined `Advance`/`Tick`).

- [ ] **Step 3: Implement `Advance` and `Tick`**

Follow steps 1–4 under Interfaces exactly. Put each step in its own method (`observeDeploys`, `checkSoaks`, `advanceRing`, `deployNext`) and a `halt(rollout, row, reason, subject)` helper shared by revert, deploy error and crash, so the block + alert logic exists once.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/rollout -v` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/rollout/engine.go internal/rollout/store.go internal/rollout/advance_test.go
git commit -m "feat(rollout): deploy rings, watch soaks, halt on failure"
```

---

### Task 11: ctl.sock routes for the tenant

**Files:**
- Create: `internal/controlplane/autoupgrade_ctl.go`
- Modify: `internal/controlplane/deploy.go` (`Handler`: register the two routes before `return withDeprecatedV1Prefix(mux)`)
- Test: `internal/controlplane/autoupgrade_ctl_test.go`

**Interfaces:**
- Produces:
  - `POST /api/v1/auto-upgrade` body `{"enabled": bool}` → sets `orgs.auto_upgrade` for the socket's slug; 200 `{"enabled": bool}`; 400 on a bad body. Throttled like the plan route.
  - `GET /api/v1/auto-upgrade` → 200 `{"lastRun": RFC3339|"", "lastResult": string, "nextCheck": RFC3339}` where:
    - `lastResult` comes from the org's newest `rollout_orgs` row: `pending` → `"scheduled: <packages>"`; `deploying` → `"upgrading"`; `soaking`/`passed` → `"upgraded to <packages>"`; `reverted` → `"held: the upgrade did not start and was undone"`; `flagged` → `"held: under review by your provider"`; no row → `"up to date"`. `<packages>` = `name version` pairs, sorted, comma-separated.
    - `lastRun` = that row's `updated` (empty when no row).
    - `nextCheck` = `Config.Window.NextStart(now)`.
  - `func autoUpgradeStatusFor(app core.App, slug string, window autoupgrade.Window, now time.Time) (map[string]any, error)` (unit-testable).
  - The `Deployer` gets a `SetRolloutWindow(w autoupgrade.Window)` setter (default `DefaultConfig().Window` from the core default) so `Handler` can compute `nextCheck`; the router calls it in Task 13.

- [ ] **Step 1: Write the failing test**

```go
package controlplane

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tinycld.org/core/autoupgrade"
)

func TestCtlAutoUpgradeSetsFlag(t *testing.T) {
	h := newDeployHarness(t)
	d := newDeployer(h.cp.App, h.root, &fakeArtifactBuilder{hash: hashNew}, func(string) {}, nil, nil, quietTestLogger())
	srv := d.Handler("acme")

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auto-upgrade", bytes.NewBufferString(`{"enabled":true}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !h.org(t).GetBool("auto_upgrade") {
		t.Fatal("flag not stored")
	}
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auto-upgrade", bytes.NewBufferString(`nope`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad body: %d", rec.Code)
	}
}

func TestAutoUpgradeStatusFor(t *testing.T) {
	h := newDeployHarness(t)
	w, _ := autoupgrade.ParseWindow("02:00-05:00")
	at := time.Date(2026, 10, 1, 12, 0, 0, 0, time.Local)

	got, err := autoUpgradeStatusFor(h.cp.App, "acme", w, at)
	if err != nil {
		t.Fatal(err)
	}
	if got["lastResult"] != "up to date" || got["nextCheck"] != w.NextStart(at).Format(time.RFC3339) {
		t.Fatalf("got %v", got)
	}

	col, _ := h.cp.App.FindCollectionByNameOrId("rollout_orgs")
	r := core.NewRecord(col)
	r.Set("rollout", "r1")
	r.Set("org", "acme")
	r.Set("state", "pending")
	r.Set("to_lockfile", map[string]string{"tinycld": "1.1.0"})
	if err := h.cp.App.Save(r); err != nil {
		t.Fatal(err)
	}
	rollouts, _ := h.cp.App.FindCollectionByNameOrId("rollouts")
	ro := core.NewRecord(rollouts)
	ro.Id = "r1"
	ro.Set("fingerprint", "x")
	ro.Set("state", "active")
	ro.Set("packages", map[string]string{"tinycld": "1.1.0"})
	if err := h.cp.App.Save(ro); err != nil {
		t.Fatal(err)
	}
	got, _ = autoUpgradeStatusFor(h.cp.App, "acme", w, at)
	if got["lastResult"] != "scheduled: tinycld 1.1.0" {
		t.Fatalf("got %v", got["lastResult"])
	}
}
```

Add the `core` import. The packages text comes from the rollout's `packages`, looked up by `rollout_orgs.rollout`. PocketBase record ids have a fixed length (15); if `"r1"` is rejected, generate the rollout first and use its id in the `rollout_orgs` row.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/controlplane -run 'TestCtlAutoUpgrade|TestAutoUpgradeStatusFor' -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`autoupgrade_ctl.go` holds `autoUpgradeStatusFor`, the result-text mapping and a `registerAutoUpgradeCtl(mux *http.ServeMux, d *Deployer, slug string, throttle func(http.ResponseWriter) bool)` called from `Handler` before `return withDeprecatedV1Prefix(mux)`. Copy the body-decoding style of the `POST /api/v1/plan` handler (`http.MaxBytesReader(w, r.Body, 4<<10)`, `writeCtlJSON`). Add the `rolloutWindow autoupgrade.Window` field, its setter and its default to `Deployer`.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/controlplane -v -run 'AutoUpgrade'` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/autoupgrade_ctl.go internal/controlplane/autoupgrade_ctl_test.go internal/controlplane/deploy.go
git commit -m "feat(controlplane): auto-upgrade routes on the control socket"
```

---

### Task 12: Tenant delegate

**Files:**
- Modify: `tenantboot/deploy_channel.go` (two methods)
- Create: `tenantboot/autoupgrade.go`
- Modify: `tenantboot/register.go` (install the delegate in the `opts.ControlSocket != ""` block, next to `backup.SetRestart`)
- Modify: `tenantboot/backup_wiring_test.go` (`resetCompositionClaims` also calls `autoupgrade.SetDelegate(nil)`)
- Test: `tenantboot/autoupgrade_test.go`

**Interfaces:**
- Consumes: core `autoupgrade.Delegate`, `autoupgrade.Status`, `autoupgrade.SetDelegate`; Task 11 routes.
- Produces:
  - `func (c *DeployChannel) SetAutoUpgrade(ctx context.Context, enabled bool) error` → `POST /api/v1/auto-upgrade`.
  - `func (c *DeployChannel) AutoUpgradeStatus(ctx context.Context) (ctlAutoUpgradeStatus, error)` → `GET /api/v1/auto-upgrade`; `type ctlAutoUpgradeStatus struct { LastRun, LastResult, NextCheck string }` with JSON tags `lastRun`, `lastResult`, `nextCheck`.
  - `type hostedAutoUpgrade struct{ ch *DeployChannel }` implementing `autoupgrade.Delegate`: `PolicyChanged` → `SetAutoUpgrade`; `Status` → `AutoUpgradeStatus` mapped to `autoupgrade.Status{Available: true, LastRun, LastResult, NextCheck}` (parse RFC3339; empty → zero time). A ctl error from `Status` returns `autoupgrade.Status{Available: true, LastResult: "status unavailable"}` and nil error, so the Packages page still renders.
  - `func newHostedAutoUpgrade(ch *DeployChannel) autoupgrade.Delegate`.

- [ ] **Step 1: Write the failing test**

```go
package tenantboot

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestHostedAutoUpgradeForwardsPolicyAndStatus(t *testing.T) {
	var sent map[string]any
	sock := serveCtl(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/auto-upgrade":
			_ = json.NewDecoder(r.Body).Decode(&sent)
			_, _ = w.Write([]byte(`{"enabled":false}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/auto-upgrade":
			_, _ = w.Write([]byte(`{"lastRun":"","lastResult":"up to date","nextCheck":"2026-10-02T02:00:00Z"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	d := newHostedAutoUpgrade(NewDeployChannel(sock))

	if err := d.PolicyChanged(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if sent["enabled"] != false {
		t.Fatalf("sent %v", sent)
	}
	st, err := d.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !st.Available || st.LastResult != "up to date" || st.NextCheck.IsZero() || !st.LastRun.IsZero() {
		t.Fatalf("status %+v", st)
	}
}

func TestHostedAutoUpgradeStatusSurvivesCtlError(t *testing.T) {
	sock := serveCtl(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) })
	st, err := newHostedAutoUpgrade(NewDeployChannel(sock)).Status(context.Background())
	if err != nil || !st.Available || st.LastResult != "status unavailable" {
		t.Fatalf("st=%+v err=%v", st, err)
	}
}
```

Also extend the existing `wireTenant`-based wiring test (in `backup_wiring_test.go`) with one assertion: after `wireTenant(t)`, `autoupgrade.Current()` is not nil.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./tenantboot -run 'TestHostedAutoUpgrade' -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`deploy_channel.go`:

```go
type ctlAutoUpgradeStatus struct {
	LastRun    string `json:"lastRun"`
	LastResult string `json:"lastResult"`
	NextCheck  string `json:"nextCheck"`
}

func (c *DeployChannel) SetAutoUpgrade(ctx context.Context, enabled bool) error {
	return c.call(ctx, c.client, http.MethodPost, "/api/v1/auto-upgrade", map[string]any{"enabled": enabled}, nil)
}

func (c *DeployChannel) AutoUpgradeStatus(ctx context.Context) (ctlAutoUpgradeStatus, error) {
	var out ctlAutoUpgradeStatus
	err := c.call(ctx, c.client, http.MethodGet, "/api/v1/auto-upgrade", nil, &out)
	return out, err
}
```

`autoupgrade.go`:

```go
package tenantboot

import (
	"context"
	"time"

	"tinycld.org/core/autoupgrade"
)

// hostedAutoUpgrade is the org's side of automatic upgrades on a router: the
// owner's switch is forwarded to the router, which decides when upgrades run.
type hostedAutoUpgrade struct{ ch *DeployChannel }

func newHostedAutoUpgrade(ch *DeployChannel) autoupgrade.Delegate { return &hostedAutoUpgrade{ch: ch} }

func (h *hostedAutoUpgrade) PolicyChanged(ctx context.Context, enabled bool) error {
	return h.ch.SetAutoUpgrade(ctx, enabled)
}

func (h *hostedAutoUpgrade) Status(ctx context.Context) (autoupgrade.Status, error) {
	s, err := h.ch.AutoUpgradeStatus(ctx)
	if err != nil {
		// The Packages page must still render; the router being briefly
		// unreachable is not the owner's problem to debug.
		return autoupgrade.Status{Available: true, LastResult: "status unavailable"}, nil
	}
	return autoupgrade.Status{
		Available:  true,
		LastRun:    parseRFC3339(s.LastRun),
		LastResult: s.LastResult,
		NextCheck:  parseRFC3339(s.NextCheck),
	}, nil
}

func parseRFC3339(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
```

`register.go`, inside `if opts.ControlSocket != "" {` after `backup.SetRestart(...)`:

```go
			// The owner's automatic-updates switch goes to the router, which
			// schedules upgrades across orgs; core asks this delegate for the
			// status it shows on Settings → Packages.
			autoupgrade.SetDelegate(newHostedAutoUpgrade(ch))
```

- [ ] **Step 4: Run tests**

Run: `go test ./tenantboot -v -run 'AutoUpgrade|Wiring|Parity'` then `go test ./...`
Expected: PASS (the parity test is unaffected: `SetDelegate` binds no hook, and the block is not reached in the parity composition).

- [ ] **Step 5: Commit**

```bash
git add tenantboot/deploy_channel.go tenantboot/autoupgrade.go tenantboot/autoupgrade_test.go tenantboot/register.go tenantboot/backup_wiring_test.go
git commit -m "feat(tenantboot): forward the auto-upgrade switch to the router"
```

---

### Task 13: Managed window prefix

**Files:**
- Modify: `cmd/serve-router/hooks.go` (an `enforceManagedAutoUpgrade` step in both tenant syscfg pipelines)
- Test: `cmd/serve-router/hooks_autoupgrade_test.go`

**Interfaces:**
- Produces: `func enforceManagedAutoUpgrade(cfg syscfg.Config) syscfg.Config` — adds `autoupgradeManagedPrefix = "autoupgrade.window"` to `ManagedPrefixes` if absent (copying the slice), and leaves `Values` untouched. Applied right after `enforceHostedMail(...)` at both call sites (spawn and push).

- [ ] **Step 1: Write the failing test**

```go
package main

import (
	"slices"
	"testing"

	"tinycld.org/hosting/syscfg"
)

func TestEnforceManagedAutoUpgrade(t *testing.T) {
	in := syscfg.Config{ManagedPrefixes: []string{"mail."}}
	out := enforceManagedAutoUpgrade(in)
	if !slices.Contains(out.ManagedPrefixes, "autoupgrade.window") {
		t.Fatalf("prefixes = %v", out.ManagedPrefixes)
	}
	if len(in.ManagedPrefixes) != 1 {
		t.Fatal("input slice mutated")
	}
	again := enforceManagedAutoUpgrade(out)
	if len(again.ManagedPrefixes) != len(out.ManagedPrefixes) {
		t.Fatal("prefix added twice")
	}
}
```

Adapt the `syscfg` import path to the one `hooks.go` uses. Also check that `validateSystemConfig` (controlplane/systemconfig.go) accepts the prefix if it ever validates the tenant view; if it would reject `autoupgrade.window`, stop and report.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./cmd/serve-router -run TestEnforceManagedAutoUpgrade -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
// autoupgradeManagedPrefix hides the upgrade-window editor in every org: the
// router runs one window for all of them.
const autoupgradeManagedPrefix = "autoupgrade.window"

func enforceManagedAutoUpgrade(cfg syscfg.Config) syscfg.Config {
	if slices.Contains(cfg.ManagedPrefixes, autoupgradeManagedPrefix) {
		return cfg
	}
	out := cfg
	out.ManagedPrefixes = append(slices.Clone(cfg.ManagedPrefixes), autoupgradeManagedPrefix)
	return out
}
```

Wrap both pipelines: `enforceManagedAutoUpgrade(enforceHostedMail(syscfg.TenantSyscfg(cfg)))`.

- [ ] **Step 4: Run tests**

Run: `go test ./cmd/serve-router -v -run 'Enforce|Syscfg'` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cmd/serve-router/hooks.go cmd/serve-router/hooks_autoupgrade_test.go
git commit -m "feat(router): the upgrade window is managed for every org"
```

---

### Task 14: Operator API

**Files:**
- Create: `internal/controlplane/rollout_routes.go`
- Modify: `internal/controlplane/provisioning.go` (`RegisterRoutes` calls `registerRolloutRoutes(g)`)
- Test: `internal/controlplane/rollout_routes_test.go`

**Interfaces:**
- Produces (all `.Bind(apis.RequireSuperuserAuth())`):
  - `GET /api/rollouts` → `{"rollouts": [...]}` newest first (id, packages, major, state, ring, ring_started, halt_reason, created).
  - `GET /api/rollouts/{id}` → `{"rollout": {...}, "orgs": [...]}` (org, ring, state, deployed_at).
  - `POST /api/rollouts/{id}/resume` → `halted` → `active`; 409 from any other state.
  - `POST /api/rollouts/{id}/advance` → on an `active` rollout, marks every `soaking` row of the current ring `passed`; 409 otherwise.
  - `POST /api/rollouts/{id}/abandon` → state `abandoned`, inserts a `rollout_blocks` row for its fingerprint (if absent); 409 if already `done|abandoned|superseded`.
  - `DELETE /api/rollout-blocks/{id}` → deletes the block; 404 if missing.
  - `PATCH /api/orgs/{slug}/rollout-ring` body `{"ring": "sentinel" | ""}` → sets `orgs.rollout_ring`; 400 on another value; 404 on an unknown slug.
  - `PATCH /api/orgs/{slug}/auto-upgrade` is NOT added: the org owner owns the switch.

- [ ] **Step 1: Write the failing test**

Use `planRoutesFixture`'s pattern (`newProvCP`, `NewProvisioner(...).RegisterRoutes()`, `apis.BuildServeMux`, `superuserToken`, `do`):

```go
package controlplane

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func rolloutFixture(t *testing.T) (http.Handler, string, *ControlPlane, *core.Record) {
	t.Helper()
	cp, root := newProvCP(t)
	NewProvisioner(cp.App, root, func(string) {}, nil, nil).RegisterRoutes()
	mux, err := apis.BuildServeMux(cp.App, apis.ServeConfig{})
	if err != nil {
		t.Fatal(err)
	}
	col, _ := cp.App.FindCollectionByNameOrId("rollouts")
	r := core.NewRecord(col)
	r.Set("fingerprint", "fp1")
	r.Set("state", "halted")
	r.Set("packages", map[string]string{"alpha": "1.1.0"})
	if err := cp.App.Save(r); err != nil {
		t.Fatal(err)
	}
	return mux, superuserToken(t, cp.App), cp, r
}

func TestRolloutRoutes(t *testing.T) {
	mux, token, cp, r := rolloutFixture(t)

	if rec := do(t, mux, http.MethodGet, "/api/rollouts", "", ""); rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
		t.Fatalf("unauthenticated list: %d", rec.Code)
	}
	rec := do(t, mux, http.MethodGet, "/api/rollouts", token, "")
	var list struct{ Rollouts []map[string]any }
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != http.StatusOK || len(list.Rollouts) != 1 {
		t.Fatalf("list %d %s", rec.Code, rec.Body)
	}

	if rec := do(t, mux, http.MethodPost, "/api/rollouts/"+r.Id+"/resume", token, ""); rec.Code != http.StatusOK {
		t.Fatalf("resume %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, mux, http.MethodPost, "/api/rollouts/"+r.Id+"/resume", token, ""); rec.Code != http.StatusConflict {
		t.Fatalf("resume active: %d", rec.Code)
	}
	if rec := do(t, mux, http.MethodPost, "/api/rollouts/"+r.Id+"/abandon", token, ""); rec.Code != http.StatusOK {
		t.Fatalf("abandon %d", rec.Code)
	}
	blocks, _ := cp.App.FindRecordsByFilter("rollout_blocks", "fingerprint = 'fp1'", "", 0, 0)
	if len(blocks) != 1 {
		t.Fatal("abandon did not block")
	}
	if rec := do(t, mux, http.MethodDelete, "/api/rollout-blocks/"+blocks[0].Id, token, ""); rec.Code != http.StatusNoContent && rec.Code != http.StatusOK {
		t.Fatalf("unblock %d", rec.Code)
	}
}

func TestRolloutRingRoute(t *testing.T) {
	mux, token, cp, _ := rolloutFixture(t)
	col, _ := cp.App.FindCollectionByNameOrId("orgs")
	o := core.NewRecord(col)
	o.Set("slug", "acme")
	o.Set("status", "active")
	o.Set("data_dir", "pb_orgs/acme")
	o.Set("lockfile", `{"tinycld":"1.0.0"}`)
	if err := cp.App.Save(o); err != nil {
		t.Fatal(err)
	}
	if rec := do(t, mux, http.MethodPatch, "/api/orgs/acme/rollout-ring", token, `{"ring":"sentinel"}`); rec.Code != http.StatusOK {
		t.Fatalf("set ring %d %s", rec.Code, rec.Body)
	}
	o, _ = cp.App.FindFirstRecordByData("orgs", "slug", "acme")
	if o.GetString("rollout_ring") != "sentinel" {
		t.Fatal("ring not stored")
	}
	if rec := do(t, mux, http.MethodPatch, "/api/orgs/acme/rollout-ring", token, `{"ring":"gold"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad ring %d", rec.Code)
	}
	if rec := do(t, mux, http.MethodPatch, "/api/orgs/nope/rollout-ring", token, `{"ring":""}`); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown org %d", rec.Code)
	}
}
```

Match `NewProvisioner`'s real argument list to `planRoutesFixture`'s call.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/controlplane -run 'TestRollout' -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`rollout_routes.go` with `func registerRolloutRoutes(g *router.RouterGroup[*core.RequestEvent], app core.App)` (match the `registerDRRoutes` signature), each route bound with `apis.RequireSuperuserAuth()`. Call it from `RegisterRoutes` next to `registerDRRoutes`. State changes go through one helper `setRolloutState(app, id, from []string, to string) (*core.Record, int, error)` that returns 404/409 codes, so resume and abandon share the checks.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/controlplane -v -run 'Rollout'` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/rollout_routes.go internal/controlplane/rollout_routes_test.go internal/controlplane/provisioning.go
git commit -m "feat(controlplane): operator API for rollouts"
```

---

### Task 15: Wire the engine into the router

**Files:**
- Create: `cmd/serve-router/rollout.go`
- Modify: `cmd/serve-router/main.go` (load config at boot with the other env; start the loop next to `sweepBuilds`; pass the window to the deployer)
- Test: `cmd/serve-router/rollout_test.go`

**Interfaces:**
- Consumes: `rollout.LoadConfig`, `rollout.New`, `rollout.Deps`, `(*builder.Builder).VersionsForSpec`, `(*builder.Builder).FetchTags`, `(*controlplane.Deployer).BuildSet`, `.DeployWithSnapshot`, `.SetRolloutWindow`, `(*orgmanager.OrgManager).CrashesSince`, `opalert.Raise`.
- Produces:
  - `func newRolloutEngine(app core.App, bld *builder.Builder, dep *controlplane.Deployer, mgr *orgmanager.OrgManager, cfg rollout.Config, mtHome string) *rollout.Engine` — builds `Deps` with: `Versions` = versions only from `bld.VersionsForSpec` (an error string → log at warn, return nil); `Build` = `dep.BuildSet` returning only the error; `Deploy` = `dep.DeployWithSnapshot` returning only the error; `Alert` = `opalert.Raise(app, a, now)`; `Rand` seeded from the time; `CloneRoot` = `mtHome`.
  - `func runRollouts(ctx context.Context, eng *rollout.Engine, every time.Duration)` — ticks `eng.Tick(ctx, time.Now())` every `every` (15 minutes in production), logs a returned error, stops on `ctx.Done()`; runs one tick right away.
  - In `main.go`: `cfg, err := rollout.LoadConfig(os.Getenv)` with the other boot-time env checks (a returned error fails boot); `MT_HOME` for the clone root comes from the dir that holds `MT_HOSTING_DIR` (the installer sets `MT_HOSTING_DIR=$MT_HOME/hosting`, so `filepath.Dir(MT_HOSTING_DIR)`); `prov.Deployer().SetRolloutWindow(cfg.Window)`; `if bld != nil { go runRollouts(ctx, newRolloutEngine(...), 15*time.Minute) }` next to `go sweepBuilds(...)`. Without a builder, no rollouts (log once at info).

- [ ] **Step 1: Write the failing test**

```go
package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type countingTicker struct{ n atomic.Int32 }

func (c *countingTicker) Tick(context.Context, time.Time) error { c.n.Add(1); return nil }

func TestRunRolloutsTicksAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	c := &countingTicker{}
	done := make(chan struct{})
	go func() { runRollouts(ctx, c, 10*time.Millisecond); close(done) }()
	time.Sleep(55 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runRollouts did not stop on cancel")
	}
	if c.n.Load() < 3 {
		t.Fatalf("ticks = %d", c.n.Load())
	}
}
```

To make this testable, `runRollouts` takes an interface `type rolloutTicker interface{ Tick(context.Context, time.Time) error }`, which `*rollout.Engine` satisfies.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./cmd/serve-router -run TestRunRollouts -v`
Expected: FAIL.

- [ ] **Step 3: Implement** `rollout.go` per Interfaces and the `main.go` wiring. Follow `sweepBuilds`'s loop shape.

- [ ] **Step 4: Run tests**

Run: `go test ./cmd/serve-router -v -run 'Rollout'` then `go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cmd/serve-router/rollout.go cmd/serve-router/rollout_test.go cmd/serve-router/main.go
git commit -m "feat(router): run the upgrade rollout loop"
```

---

### Task 16: Installer SMTP and docs

**Files:**
- Modify (utils repo): `utils/hosting-install/install.sh`, `utils/hosting-install/README.md`
- Modify (hosting): `README.md`

**Interfaces:**
- Installer env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Written into `hosting.env` as `MT_SMTP_*` through a `smtp_block` built before the heredoc, like `mail_block`; when `SMTP_HOST` is unset the block is a commented explanation. `SMTP_PASSWORD` is carried across re-runs from the existing `hosting.env` (same `sed -n 's/^MT_SMTP_PASSWORD=//p'` pattern as `MT_SUPERUSER_PASSWORD`) when not supplied. Also `UPGRADE_WINDOW` → `MT_UPGRADE_WINDOW` (commented default when unset).

- [ ] **Step 1: Installer change** (utils repo, branch `feat/auto-upgrade-core`). Add to the configuration comment block at the top: the five `SMTP_*` variables and `UPGRADE_WINDOW`. Build `smtp_block` and splice `$smtp_block` into the heredoc after `$mail_block`. Verify with `bash -n hosting-install/install.sh` and by running the block-building section in a subshell with sample env (print the result) — paste the output in the report.

- [ ] **Step 2: Installer README.** Under "Environment reference", add the six variables with one line each. Add a short "Router alerts" paragraph: without SMTP, alerts are only in the log and in the `operator_alerts` collection.

- [ ] **Step 3: Hosting README.** Add an "Automatic upgrades" section after "Artifact-backed orgs & the deploy protocol":
  - what opting in means (the org owner's switch, on by default);
  - the lockfile must pin each member (`git+file://…#vX.Y.Z` or an exact npm version) — an unpinned git spec is never upgraded; show the default-lockfile example from the installer README with `#v<version>` added;
  - discovery every 15 minutes, `git fetch --tags` on the member clones;
  - rings and soaks (the table from Global Constraints), the window;
  - what halts a rollout (boot failure → revert + block; crash during the soak → flag, no revert) and the alerts;
  - the operator API table from Task 14 with one `curl` example (`POST /api/rollouts/{id}/resume`);
  - note that 5xx and Sentry signals come in a later change.
  Add rows to the env table: `MT_UPGRADE_WINDOW`, `MT_ROLLOUT_SOAK_R{0,1,2}_{MINOR,MAJOR}`, `MT_SMTP_HOST`, `MT_SMTP_PORT`, `MT_SMTP_USER`, `MT_SMTP_PASSWORD` (scrubbed), `MT_SMTP_FROM`.

- [ ] **Step 4: Commit (two repos)**

```bash
cd ~/code/tinycld/utils && git branch --show-current && git add hosting-install/install.sh hosting-install/README.md && git commit -m "feat(hosting-install): SMTP and upgrade window settings"
cd ~/code/tinycld/hosting && git branch --show-current && git add README.md && git commit -m "docs: automatic upgrades"
```

---

### Task 17: Final verification

- [ ] **Step 1:** `cd ~/code/tinycld/hosting && go test ./... && gofmt -l . && go vet ./...` — all pass, nothing printed by gofmt.
- [ ] **Step 2:** The composition parity test: `go test ./tenantboot -run TestTenantCompositionMatchesHostMinusRecordedExceptions -v` — PASS with no allowlist change.
- [ ] **Step 3:** `cd ~/code/tinycld/utils && bash -n hosting-install/install.sh`.
- [ ] **Step 4:** In the report, list every task's commits and any deviation from this plan.
