# Auto-upgrade 4b (hosted tenant swap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deploy moves a hosted org onto its new build without refused requests. The old tenant process goes read-only and keeps serving reads. The new build starts beside it, migrates and passes readiness. Then traffic moves to the new process, and the old one drains and exits.

**Architecture:**
- The tenant gets a cfg.sock route, `/api/v1/read-only`. The route enters or leaves core's read-only mode and reports a fingerprint of the applied migrations.
- Each tenant process gets its own socket directory, `run/<slug>/<generation>/`, so two processes of one org can live at the same time.
- A new `OrgManager.Swap` method does the swap and returns a `SwapOutcome`. `Deployer.finish` calls it through a new `SwapFunc` seam, and keeps the old evict-then-respawn flow as the fallback.
- During the swap the org's cgroup memory and pids limits are doubled. The router does not count 503 responses of a swapping org as 5xx.

**Tech Stack:** Go (PocketBase fork, `tinycld.org/hosting`, `tinycld.org/core/readonly`).

**Spec:** `docs/superpowers/specs/2026-10-01-auto-upgrade-4-zero-downtime-restarts-design.md`, sections "Shared rule: the write pause" and "D2: hosted tenant swap". Builds on plan 4a (`docs/superpowers/plans/2026-10-02-auto-upgrade-4a-read-only-mode.md`, tinycld PR #312) and plan 2b (hosting PR #66).

## Global Constraints

- **Repo and branch:**
  - `hosting` (`~/code/tinycld/hosting`): branch `feat/read-only-mode`, created from `feat/auto-upgrade-signals` (PR #66).
  - The branch name is the same as core's (tinycld PR #312), so CI resolves the core that has `tinycld.org/core/readonly`.
  - Do not edit the `tinycld` repo. Core does not change in this plan.
- **Spec values, verbatim:**
  - "`Deployer.finish` changes from "evict, then respawn" to: 1. Put the old tenant in read-only mode. 2. Spawn the new build beside it on a new socket. 3. Wait for readiness. 4. Move the `OrgManager` entry to the new process and socket. New requests go to it. 5. Drain and stop the old process."
  - "The org's uid, cgroup and data dir are the same for both processes. The cgroup memory and pids limits must allow two processes for a short time."
  - "If the new process does not pass readiness, the old one leaves read-only mode and keeps serving. If the migrations already ran, the revert path from part 2 (restore the snapshot, then start the old build) still applies."
  - "Not counting `503 read_only` in the router's 5xx signal (`internal/traffic`), so a swap does not raise an org's 5xx ratio." (from plan 4a, "Out of scope")
  - Testing: "during a swap, a write gets `503 read_only` with `Retry-After`, reads continue, and an open realtime subscription reconnects and gets the next event. A new build that fails readiness leaves the old process serving and writable."
- **Decisions this plan makes where the spec is silent or cannot be followed literally.** The controller surfaces them to the user before Task 1.
  1. **Read-only through a cfg.sock route, not `SIGUSR2`.** The route confirms the mode is on, and its 404 tells the router that the tenant's build has no read-only mode. A build that predates the mode ignores `SIGUSR2` and would keep writing during the migration. Leaving the mode needs a route anyway, because `readonly.Leave` is an internal call. `SIGUSR2` stays in core for other supervisors.
  2. **One socket directory per process, not one socket file per generation.** The spec names `run/<slug>/<slug>.<generation>.sock`. But an org has up to six sockets (HTTP, cfg, ctl, IMAP, SMTP, MX), and five of them have fixed names. So each process gets `run/<slug>/<generation>/` with the existing names inside it. The directory is removed when the process is dead.
  3. **The readiness-failure outcome depends on the migrations.** Before the swap, the old tenant reports a fingerprint of `_migrations`. If the new build fails, the router reads the fingerprint again.
     - Same fingerprint: the old build's files are linked again, the old process leaves read-only mode and keeps serving (`SwapKeptOld`). No snapshot is restored.
     - Different or unknown fingerprint: the old process stays read-only. The Deployer runs the part-2 revert path: it stops the old process and boots the previous build, which applies the snapshot at boot (`SwapRevert`). The snapshot restore runs only at boot, so it needs a fresh process.
  4. **Fallback to evict-then-respawn** when the org is not resident, when its build has no read-only route (every artifact built before this plan), or when the router cannot take a spawn slot. So the first deploy of each org after this ships still cold-starts once.
  5. **Cgroup limits:** during the swap, `memory.max` and `pids.max` of `tenant-<slug>` are doubled. They are restored when the old process is dead, or when the swap fails. `cpu.max` does not change. There is no measuring step: two full processes is the upper bound, and the doubled limit covers it.
  6. **5xx:** while a slug is swapping, the router does not count its 503 responses. The router knows when a swap runs, so core needs no marker. A real 503 of the new process during the 10 s drain is not counted either. This is accepted.
  7. **Rollback and the ctl `POST /api/v1/restart` route keep evict-then-respawn.** A rollback restores a snapshot at boot, which needs a fresh process.
  8. **Known limit:** `MaterializeBuild` repoints the org's `pb_public`/`pb_hooks`/`pb_migrations` links before the new process starts. So for the few seconds of the swap the old process serves the new build's static files. Tenants run with `HooksWatch` off (`tenantboot/register.go:324`), so the hook link change does not restart the old process.
  9. **Core floor:** `tenantboot` now imports `tinycld.org/core/readonly`. The builder compiles the hosting tree against each recipe's core, so a recipe whose core predates PR #312 no longer builds. The hosting deploy must not ship before that core release.
- **Data safety:** the router never creates, renames or removes a file inside an org dir except through `materialize.MaterializeBuild`, as today. It never opens a tenant database.
- **Logging:** use `m.cfg.Logger` / `inst.log` in `internal/orgmanager`, `d.log` in the Deployer, and `tbLog` in `tenantboot`. Use `slog` key-value pairs with `"slug", slug`. Do not use `fmt.Print*` in runtime code.
- **Comments** explain why, not what. Match the comment density of the file you edit.
- **Before every commit:**
  - `git branch --show-current` must print `feat/read-only-mode`.
  - Stage explicit paths only.
  - From the hosting module root, `go build ./... && go vet ./...` and `go test ./... -count=1` must pass, and `gofmt -l .` must print nothing.
  - If a test fails anywhere, find the root cause and fix it. Never skip it, run it again, or raise a timeout.
- Commit messages and PR text never mention Claude.

## Out of scope (later plans)

- **Plan 4c (D1):** router handoff. The router does not survive a restart during a swap. A router crash in the middle of a swap orphans both tenant processes, as today, because no `Pdeathsig` is set.
- **Plan 4d (D3):** single-tenant supervisor.
- Making the first post-ship deploy of each org swap (decision 4).
- Pausing writes that do not come from an HTTP request to `/api/` (spec "Known limits").

## File map

| File | Responsibility |
|---|---|
| `tenantcfg/readonly.go` (new) | `ReadOnlyRequest`, `ReadOnlyState`, `ReadOnlyRoute` |
| `tenantboot/readonly_route.go` (new) | `registerReadOnly(app, mux)`: GET/POST `/api/v1/read-only` |
| `tenantboot/register.go` | calls `registerReadOnly` |
| `internal/cgrouplimits/cgrouplimits.go` | `(Limits).ForSwap()` |
| `internal/orgmanager/spawn.go` | `HeadroomSpawner` interface |
| `internal/orgmanager/spawn_linux.go` | `writeCgroupLimits`; `(*linuxSpawner).SwapHeadroom` |
| `internal/orgmanager/manager.go` | generation socket dirs; `prepare` split out of `load`; `Swap`, `Swapping`; `Config.SwapPaused` |
| `internal/orgmanager/instance.go` | `sockDir`, `buildDir` fields |
| `internal/orgmanager/readonly_client.go` (new) | `readOnlyState`, `setReadOnly`, `errReadOnlyUnsupported` |
| `internal/orgmanager/swap.go` (new) | `SwapOutcome`; `Swap`; `failSwap` |
| `internal/controlplane/provisioning.go`, `deploy.go` | `SwapFunc`; `SetSwap`; `finish` uses the swap |
| `cmd/serve-router/main.go`, `traffic.go` | wiring; `observeTraffic` |

---

### Task 1: Tenant read-only route

**Files:**
- Create: `tenantcfg/readonly.go`, `tenantboot/readonly_route.go`
- Modify: `tenantboot/register.go` (next to `registerUpgradeSnapshot(cfgMux, opts.OrgDir)`, ~line 283)
- Test: `tenantboot/readonly_route_test.go`

**Interfaces:**
- Produces:
  - `const tenantcfg.ReadOnlyRoute = "/api/v1/read-only"`
  - `type tenantcfg.ReadOnlyRequest struct { Active bool \`json:"active"\` }`
  - `type tenantcfg.ReadOnlyState struct { Active bool \`json:"active"\`; Migrations string \`json:"migrations"\` }`
  - `GET /api/v1/read-only` returns 200 `ReadOnlyState`.
  - `POST /api/v1/read-only` with body `ReadOnlyRequest` calls `readonly.Enter()` or `readonly.Leave()`, then returns 200 `ReadOnlyState`. A bad body gets 400.

- [ ] **Step 1: Write the failing tests**

```go
package tenantboot

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/readonly"
	"tinycld.org/hosting/tenantcfg"
)

func readOnlyMux(t *testing.T) (*http.ServeMux, *tests.TestApp) {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	t.Cleanup(readonly.Leave)
	mux := http.NewServeMux()
	registerReadOnly(app, mux)
	return mux, app
}

func serveReadOnly(t *testing.T, mux *http.ServeMux, method, body string) (int, tenantcfg.ReadOnlyState) {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, tenantcfg.ReadOnlyRoute, strings.NewReader(body)))
	var st tenantcfg.ReadOnlyState
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
			t.Fatalf("decode: %v (%s)", err, rec.Body.String())
		}
	}
	return rec.Code, st
}

// The router enters the mode before a swap and must know it took effect.
func TestReadOnlyRoute_EnterAndLeave(t *testing.T) {
	mux, _ := readOnlyMux(t)
	code, st := serveReadOnly(t, mux, http.MethodPost, `{"active":true}`)
	if code != http.StatusOK || !st.Active || !readonly.Active() {
		t.Fatalf("enter: code %d, state %+v, Active() %v", code, st, readonly.Active())
	}
	code, st = serveReadOnly(t, mux, http.MethodPost, `{"active":false}`)
	if code != http.StatusOK || st.Active || readonly.Active() {
		t.Fatalf("leave: code %d, state %+v, Active() %v", code, st, readonly.Active())
	}
}

// The fingerprint tells the router whether a failed new build changed the
// schema: it must change when a migration is recorded.
func TestReadOnlyRoute_FingerprintFollowsMigrations(t *testing.T) {
	mux, app := readOnlyMux(t)
	_, before := serveReadOnly(t, mux, http.MethodGet, "")
	if before.Migrations == "" {
		t.Fatal("empty fingerprint on a migrated app")
	}
	if _, err := app.DB().NewQuery("INSERT INTO _migrations (file, applied) VALUES ('9999999999_test.go', 9999999999999999)").Execute(); err != nil {
		t.Fatal(err)
	}
	_, after := serveReadOnly(t, mux, http.MethodGet, "")
	if after.Migrations == before.Migrations {
		t.Fatalf("fingerprint %q did not change after a new migration", after.Migrations)
	}
}

func TestReadOnlyRoute_RejectsBadBody(t *testing.T) {
	mux, _ := readOnlyMux(t)
	if code, _ := serveReadOnly(t, mux, http.MethodPost, `{`); code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", code)
	}
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ~/code/tinycld/hosting && go test ./tenantboot -run TestReadOnlyRoute -v`
Expected: build failure (`registerReadOnly` and `tenantcfg.ReadOnlyRoute` undefined).

- [ ] **Step 3: Implement**

`tenantcfg/readonly.go`:

```go
package tenantcfg

// ReadOnlyRoute is the cfg.sock route through which the router pauses a
// tenant's writes for a swap and reads the tenant's migration state.
const ReadOnlyRoute = "/api/v1/read-only"

// ReadOnlyRequest is the POST body of ReadOnlyRoute.
type ReadOnlyRequest struct {
	Active bool `json:"active"`
}

// ReadOnlyState is the reply of ReadOnlyRoute. Migrations fingerprints the
// applied migrations: if a new build fails readiness and this value did not
// change, the database was not migrated and the old process can keep serving.
type ReadOnlyState struct {
	Active     bool   `json:"active"`
	Migrations string `json:"migrations"`
}
```

`tenantboot/readonly_route.go`:

```go
package tenantboot

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/readonly"
	"tinycld.org/hosting/tenantcfg"
)

// registerReadOnly lets the router pause this tenant's writes while a new
// build migrates the shared database, and tell afterwards whether it did.
func registerReadOnly(app core.App, mux *http.ServeMux) {
	reply := func(w http.ResponseWriter) {
		fp, err := migrationFingerprint(app)
		if err != nil {
			tbLog.Error("read-only: could not read migrations", "error", err)
			http.Error(w, "read migrations", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, tenantcfg.ReadOnlyState{Active: readonly.Active(), Migrations: fp})
	}
	mux.HandleFunc("GET "+tenantcfg.ReadOnlyRoute, func(w http.ResponseWriter, r *http.Request) { reply(w) })
	mux.HandleFunc("POST "+tenantcfg.ReadOnlyRoute, func(w http.ResponseWriter, r *http.Request) {
		var req tenantcfg.ReadOnlyRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil {
			http.Error(w, "invalid read-only request", http.StatusBadRequest)
			return
		}
		if req.Active {
			readonly.Enter()
		} else {
			readonly.Leave()
		}
		reply(w)
	})
}

// migrationFingerprint is the count of applied migrations and the newest one.
// Every migration run adds a row, so any schema change by another process on
// the same database changes it.
func migrationFingerprint(app core.App) (string, error) {
	var row struct {
		N    int    `db:"n"`
		Last string `db:"last"`
	}
	err := app.DB().NewQuery(
		"SELECT COUNT(*) AS n, COALESCE((SELECT file FROM _migrations ORDER BY applied DESC, file DESC LIMIT 1), '') AS last FROM _migrations",
	).One(&row)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%s", row.N, row.Last), nil
}
```

`writeJSON` already exists in `tenantboot` (used by `registerUpgradeSnapshot`); reuse it. In `register.go`, add `registerReadOnly(app, cfgMux)` in the block that registers the other cfg.sock routes (the same `if cfgMux != nil` scope as `registerUpgradeSnapshot`).

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./tenantboot -run TestReadOnlyRoute -v -count=1`, then the full gate from Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add tenantcfg/readonly.go tenantboot/readonly_route.go tenantboot/readonly_route_test.go tenantboot/register.go
git commit -m "feat(tenantboot): cfg.sock route to pause writes and report migration state"
```

---

### Task 2: Cgroup headroom for a swap

**Files:**
- Modify: `internal/cgrouplimits/cgrouplimits.go`, `internal/orgmanager/spawn.go`, `internal/orgmanager/spawn_linux.go` (`placeInCgroup`, ~283-314)
- Test: `internal/cgrouplimits/cgrouplimits_test.go`, `internal/orgmanager/headroom_linux_test.go` (new, `//go:build linux`)

**Interfaces:**
- Produces:
  - `func (l cgrouplimits.Limits) ForSwap() cgrouplimits.Limits`: `MemoryMax` and `PidsMax` doubled; `"max"` and `""` unchanged; `CPUMax` unchanged.
  - `type orgmanager.HeadroomSpawner interface { SwapHeadroom(slug string) (restore func(), err error) }`
  - `func writeCgroupLimits(dir string, lim TenantLimits) error` (linux)

- [ ] **Step 1: Write the failing tests**

In `cgrouplimits_test.go`:

```go
func TestForSwapDoublesMemoryAndPids(t *testing.T) {
	cases := []struct{ in, want Limits }{
		{Limits{MemoryMax: "536870912", PidsMax: "256", CPUMax: "50000 100000"}, Limits{MemoryMax: "1073741824", PidsMax: "512", CPUMax: "50000 100000"}},
		{Limits{MemoryMax: "512M", PidsMax: "max"}, Limits{MemoryMax: "1073741824", PidsMax: "max"}},
		{Limits{}, Limits{}},
		{Limits{MemoryMax: "max"}, Limits{MemoryMax: "max"}},
	}
	for _, c := range cases {
		if got := c.in.ForSwap(); got != c.want {
			t.Errorf("ForSwap(%+v) = %+v, want %+v", c.in, got, c.want)
		}
	}
}
```

`internal/orgmanager/headroom_linux_test.go`:

```go
//go:build linux

package orgmanager

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readLimit(t *testing.T, dir, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(b))
}

// The cgroup files are plain files in a temp dir here: the test checks what
// is written and that restore puts the configured limits back.
func TestSwapHeadroomRaisesThenRestores(t *testing.T) {
	root := t.TempDir()
	lim := TenantLimits{MemoryMax: "536870912", PidsMax: "256"}
	s := &linuxSpawner{conf: LinuxConfinement{CgroupRoot: root, Limits: lim}}
	dir := filepath.Join(root, "tenant-acme")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeCgroupLimits(dir, lim); err != nil {
		t.Fatal(err)
	}

	restore, err := s.SwapHeadroom("acme")
	if err != nil {
		t.Fatal(err)
	}
	if got := readLimit(t, dir, "memory.max"); got != "1073741824" {
		t.Fatalf("memory.max during swap = %s", got)
	}
	if got := readLimit(t, dir, "pids.max"); got != "512" {
		t.Fatalf("pids.max during swap = %s", got)
	}
	restore()
	if got := readLimit(t, dir, "memory.max"); got != "536870912" {
		t.Fatalf("memory.max after restore = %s", got)
	}
	if got := readLimit(t, dir, "pids.max"); got != "256" {
		t.Fatalf("pids.max after restore = %s", got)
	}
}

func TestSwapHeadroomWithoutCgroupIsANoop(t *testing.T) {
	s := &linuxSpawner{conf: LinuxConfinement{}}
	restore, err := s.SwapHeadroom("acme")
	if err != nil || restore == nil {
		t.Fatalf("restore %v, err %v", restore, err)
	}
	restore()
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/cgrouplimits ./internal/orgmanager -run 'ForSwap|SwapHeadroom' -v`
Expected: build failure. On darwin the linux test does not build; the cgrouplimits test still fails.

- [ ] **Step 3: Implement**

`cgrouplimits.go`:

```go
// ForSwap is the limit set for the seconds in which a tenant's old and new
// processes share its cgroup during a swap. Two full processes is the upper
// bound, so memory and pids double. CPU is a rate, not a capacity, and stays.
func (l Limits) ForSwap() Limits {
	out := l
	if b, ok := l.MemoryMaxBytes(); ok {
		out.MemoryMax = strconv.FormatUint(2*b, 10)
	}
	if n, err := strconv.Atoi(l.PidsMax); err == nil {
		out.PidsMax = strconv.Itoa(2 * n)
	}
	return out
}
```

`spawn.go`, below `Spawner`:

```go
// HeadroomSpawner is a Spawner whose tenants run under cgroup limits. A swap
// runs two processes of one org in the same group for a few seconds, so it
// raises the limits first and restores them when the old process is gone.
type HeadroomSpawner interface {
	SwapHeadroom(slug string) (restore func(), err error)
}
```

`spawn_linux.go`: move the write loop of `placeInCgroup` (the `for _, f := range ... memory.max/pids.max/cpu.max` loop) into `writeCgroupLimits(dir string, lim TenantLimits) error`, and call it from `placeInCgroup`. Behaviour of `placeInCgroup` does not change. Then add:

```go
func (s *linuxSpawner) SwapHeadroom(slug string) (func(), error) {
	if s.conf.CgroupRoot == "" || !s.conf.Limits.Any() {
		return func() {}, nil
	}
	dir := filepath.Join(s.conf.CgroupRoot, "tenant-"+slug)
	if err := writeCgroupLimits(dir, s.conf.Limits.ForSwap()); err != nil {
		return nil, fmt.Errorf("raise cgroup limits for %s: %w", slug, err)
	}
	return func() {
		// A failed restore leaves the doubled limit until the org's next
		// spawn, which writes the configured limits again.
		_ = writeCgroupLimits(dir, s.conf.Limits)
	}, nil
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/cgrouplimits ./internal/orgmanager -run 'ForSwap|SwapHeadroom|Confinement' -v -count=1` (the linux test runs only on Linux; on darwin confirm `GOOS=linux go vet ./internal/orgmanager` is clean), then the full gate.

- [ ] **Step 5: Commit**

```bash
git add internal/cgrouplimits/cgrouplimits.go internal/cgrouplimits/cgrouplimits_test.go internal/orgmanager/spawn.go internal/orgmanager/spawn_linux.go internal/orgmanager/headroom_linux_test.go
git commit -m "feat(orgmanager): double a tenant's memory and pids limits for a swap"
```

---

### Task 3: One socket directory per tenant process

**Files:**
- Modify: `internal/orgmanager/manager.go` (`orgSockets` ~956, `socketPaths` ~1005-1072, `spawn` ~779-918, `OrgManager` struct ~313, `New`), `internal/orgmanager/instance.go` (`OrgInstance` fields)
- Test: `internal/orgmanager/socket_generation_test.go` (new); update layout assertions in `mail_sockets_test.go` (~40, ~60) and `socket_fallback_test.go`

**Interfaces:**
- Produces:
  - `orgSockets.dir string`: the process's own socket directory.
  - `OrgInstance.sockDir string`
  - `func (m *OrgManager) newGeneration() string`: base-36 of a per-manager counter that starts at `time.Now().Unix()`, so a restarted router does not reuse the names of a previous run.
  - Layout: `<Root>/run/<slug>/` is root-owned `0711`; `<Root>/run/<slug>/<generation>/` is the tenant's `0700` dir that holds `<slug>.sock`, `cfg.sock`, `ctl.sock`, `imap.sock`, `smtp.sock`, `mx.sock`. The fallback is `<fallback>/<slug>/<generation>/s.sock` with the same names.

- [ ] **Step 1: Write the failing tests**

```go
package orgmanager

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// Two processes of one org must never share a socket path: a swap runs the
// old and the new process at the same time.
func TestSpawn_EachProcessGetsItsOwnSocketDir(t *testing.T) {
	sp := &fakeSpawner{}
	m := newTestManager(t, sp)
	first, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	m.Evict("acme")
	second, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	if first.sockDir == second.sockDir {
		t.Fatalf("both processes use %s", first.sockDir)
	}
	if filepath.Dir(first.sockDir) != filepath.Dir(second.sockDir) {
		t.Fatalf("socket dirs %s and %s are not siblings under run/<slug>", first.sockDir, second.sockDir)
	}
	if filepath.Dir(second.sockPath) != second.sockDir || filepath.Dir(second.cfgSock) != second.sockDir {
		t.Fatalf("sockets %s / %s are not in %s", second.sockPath, second.cfgSock, second.sockDir)
	}
}

// A process's directory goes with it, and a directory left by a router that
// died is swept by the next spawn of that org.
func TestSpawn_SocketDirIsRemovedWhenTheProcessIsDead(t *testing.T) {
	sp := &fakeSpawner{}
	m := newTestManager(t, sp)
	inst, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(filepath.Dir(inst.sockDir), "leftover")
	if err := os.Mkdir(stale, 0o700); err != nil {
		t.Fatal(err)
	}
	if !m.EvictAndWait("acme", killTimeout+drainTimeout) {
		t.Fatal("evict did not finish")
	}
	waitFor(t, "old socket dir removed", func() bool { _, err := os.Lstat(inst.sockDir); return os.IsNotExist(err) })
	if _, err := m.Get(context.Background(), "acme"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale dir %s survived the next spawn (err=%v)", stale, err)
	}
}
```

Use the existing helpers in `manager_test.go` / `fake_spawner_test.go` (`newTestManager`, `waitFor`). If their names or signatures differ, adapt the calls, not the assertions.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/orgmanager -run 'TestSpawn_EachProcess|TestSpawn_SocketDir' -v`
Expected: build failure (`sockDir` undefined).

- [ ] **Step 3: Implement**

1. `OrgManager` gets `gen atomic.Uint64` and `liveSockDirs map[string]struct{}` (guarded by `m.mu`). In `New`, `m.gen.Store(uint64(time.Now().Unix()))` and make the map.

   ```go
   // newGeneration names one tenant process's socket directory. Unique per
   // process, so an old and a new process of one org never share a path.
   func (m *OrgManager) newGeneration() string {
   	return strconv.FormatUint(m.gen.Add(1), 36)
   }
   ```

2. `orgSockets` gets `dir string`. In `socketPaths`, put the sockets one level deeper. The primary branch becomes:

   ```go
   gen := m.newGeneration()
   runDir := filepath.Join(m.cfg.Root, "run")
   slugDir := filepath.Join(runDir, slug)
   primaryDir := filepath.Join(slugDir, gen)
   if len(filepath.Join(primaryDir, longestBase(slug+".sock"))) <= maxSocketPath {
   	for _, d := range []struct {
   		path string
   		mode os.FileMode
   	}{{runDir, 0o711}, {slugDir, 0o711}, {primaryDir, 0o700}} {
   		if err := secureRuntimeDir(d.path, d.mode); err != nil {
   			return orgSockets{}, fmt.Errorf("%w: create socket dir for %s: %v", orgerr.ErrOrgUnavailable, slug, err)
   		}
   	}
   	s := build(primaryDir, slug+".sock")
   	s.dir = primaryDir
   	return s, nil
   }
   ```

   Do the same in the fallback branch: `fallbackDir := filepath.Join(fallbackParent, slug, gen)`, with `<fallbackParent>/<slug>` at `0o711`. Update the doc comment of `socketPaths`: the per-org dir is now traversal-only (`0711`), and each process's dir under it is the one the spawner chowns. The Linux spawner already chowns `filepath.Dir(req.SocketPath)` (now the generation dir) and heals its parent (now `run/<slug>`) to root `0711` (`spawn_linux.go` ~186-199). Update that comment so it names the new levels.

3. In `spawn`:
   - Keep the stale-socket loop. It now clears paths in a fresh directory.
   - Before it, sweep stale generation dirs of this org:

     ```go
     m.sweepSocketDirs(filepath.Dir(socks.dir), socks.dir)
     ```

     ```go
     // sweepSocketDirs removes what a dead router left under one org's socket
     // dir. Directories of live processes stay: an evicted process may still
     // be draining in its own directory while its replacement spawns.
     func (m *OrgManager) sweepSocketDirs(slugDir, keep string) {
     	entries, err := os.ReadDir(slugDir)
     	if err != nil {
     		return
     	}
     	m.mu.RLock()
     	defer m.mu.RUnlock()
     	for _, e := range entries {
     		p := filepath.Join(slugDir, e.Name())
     		if _, live := m.liveSockDirs[p]; live || p == keep {
     			continue
     		}
     		if err := os.RemoveAll(p); err != nil {
     			m.cfg.Logger.Warn("could not remove stale socket path", "path", p, "error", err)
     		}
     	}
     }
     ```

     This also removes the files of the old flat layout (`run/<slug>/<slug>.sock`, `cfg.sock`, …) on the first spawn after the upgrade.
   - Register the dir under `m.mu` before the child starts: `m.liveSockDirs[socks.dir] = struct{}{}`. Set `inst.sockDir = socks.dir`.
   - Right after `go m.supervise(inst)`, start the reaper:

     ```go
     go func() {
     	<-inst.dead
     	// The process is gone, so nothing will dial or bind these sockets
     	// again; shutdown's own removals after this see ENOENT, which they
     	// already tolerate.
     	m.mu.Lock()
     	delete(m.liveSockDirs, inst.sockDir)
     	m.mu.Unlock()
     	if err := os.RemoveAll(inst.sockDir); err != nil {
     		inst.log.Warn("could not remove socket dir", "slug", inst.slug, "error", err)
     	}
     }()
     ```

   - If `spawn` returns an error before the child starts (after the dir was registered), delete the map entry and `os.RemoveAll(socks.dir)` before returning.
4. Update `mail_sockets_test.go`, `socket_fallback_test.go` and any other test that asserts `run/acme/acme.sock` or `run/acme/cfg.sock`. Assert the file is `<run>/acme/<one generation dir>/acme.sock` (use `filepath.Glob`). Do not weaken the other assertions in those tests.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/orgmanager -count=1 -v -run 'Socket|Spawn|Evict|Mail'`, then the full gate. The real-binary tests in `tenant_e2e_test.go` must pass too: they check that a tenant binds and serves on the new paths.

- [ ] **Step 5: Commit**

```bash
git add internal/orgmanager/manager.go internal/orgmanager/instance.go internal/orgmanager/spawn_linux.go internal/orgmanager/socket_generation_test.go internal/orgmanager/mail_sockets_test.go internal/orgmanager/socket_fallback_test.go
git commit -m "feat(orgmanager): give each tenant process its own socket directory"
```

(Add any other test file you updated in step 3.4 to the `git add` line.)

---

### Task 4: Split boot preparation out of `load`

This is a refactor with no change in behaviour. `Swap` (Task 5) needs the preparation without the admission and publish steps of `load`.

**Files:**
- Modify: `internal/orgmanager/manager.go` (`load` ~542-723), `internal/orgmanager/instance.go`
- Test: existing `internal/orgmanager` tests (no new test; the refactor must not change behaviour). Add one assertion for `buildDir` to an existing successful-`Get` test in `manager_test.go`.

**Interfaces:**
- Produces:
  - `type preparedBoot struct { src bootSource; cfgs runtimeConfigs; withMail bool; buildDir string; spawnOrigin string }`
  - `func (m *OrgManager) prepare(slug, orgDir string, rec OrgRecord) (preparedBoot, error)`: the code of `load` from the `rec.RecipeHash == ""` check to the `release` computation, inclusive (resolve build, `MaterializeBuild`, `ensureTenantDirs`, every `write*Config`, `resolvedSlugs`, `writeAppConfig`, release). Use the record type `load` already uses (`rec` from `m.cfg.LookupOrg`); write its real type name in place of `OrgRecord`.
  - `OrgInstance.buildDir string`: the build directory (`ref.Dir`) that the process booted from. `load` sets it after `spawn` returns.

- [ ] **Step 1: Add the assertion**

In the existing test that does a successful `Get` with an artifact fixture (`manager_test.go`, the test that uses `buildArtifact`/`resolveBuilds`), add:

```go
if inst.buildDir == "" {
	t.Fatal("instance does not record the build it booted from")
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/orgmanager -run <that test> -v`
Expected: build failure (`buildDir` undefined).

- [ ] **Step 3: Implement**

Move the code into `prepare` without changing its order or its error messages. `load` becomes, after the spawn slot:

```go
orgDir := filepath.Join(m.cfg.Root, "pb_orgs", slug)
p, err := m.prepare(slug, orgDir, rec)
if err != nil {
	return nil, err
}
inst, err := m.spawn(ctx, slug, orgDir, p.src, p.cfgs, p.withMail)
if err != nil {
	m.noteCrash(slug)
	return nil, err
}
inst.buildDir = p.buildDir
```

The publish block and the `reconcileAppURL` call that follow stay as they are, with `spawnOrigin` read from `p.spawnOrigin`.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/orgmanager -count=1`, then the full gate.

- [ ] **Step 5: Commit**

```bash
git add internal/orgmanager/manager.go internal/orgmanager/instance.go internal/orgmanager/manager_test.go
git commit -m "refactor(orgmanager): split boot preparation out of load"
```

---

### Task 5: `OrgManager.Swap`

**Files:**
- Create: `internal/orgmanager/swap.go`, `internal/orgmanager/readonly_client.go`
- Modify: `internal/orgmanager/manager.go` (`Config`: `SwapPaused`; `OrgManager`: `swapping map[string]int`)
- Test: `internal/orgmanager/swap_test.go`

**Interfaces:**
- Consumes: `tenantcfg.ReadOnlyRoute`, `ReadOnlyRequest`, `ReadOnlyState` (Task 1); `HeadroomSpawner` (Task 2); `sockDir`, `newGeneration` (Task 3); `prepare`, `buildDir` (Task 4); `cfgSockClient(sockPath) *http.Client` and `pushTimeout` (existing, `cfgsock_client.go`, `planpush.go`).
- Produces:
  ```go
  type SwapOutcome int
  const (
  	SwapUnavailable SwapOutcome = iota
  	SwapCommitted
  	SwapKeptOld
  	SwapRevert
  )
  func (m *OrgManager) Swap(ctx context.Context, slug string) (SwapOutcome, error)
  func (m *OrgManager) Swapping(slug string) bool
  // Config:
  SwapPaused func(slug string) // test hook: runs after the old process is read-only, before the new one spawns; nil in production
  ```
  - `SwapUnavailable, nil`: nothing changed. The caller replaces the tenant the old way.
  - `SwapCommitted, nil`: the new process serves; the old one is draining.
  - `SwapKeptOld, err`: the new build failed and the database was not migrated. The old process serves the previous build and accepts writes again.
  - `SwapRevert, err`: the new build failed and the database may have changed. The old process is still resident and read-only. The caller must run the revert path.

- [ ] **Step 1: Write the failing tests**

`swap_test.go`. The fake tenant's cfg handler holds the read-only state and a fingerprint the test can change:

```go
package orgmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"tinycld.org/hosting/tenantcfg"
)

type fakeReadOnly struct {
	mu          sync.Mutex
	active      bool
	migrations  string
	unsupported bool
}

func (f *fakeReadOnly) handler() http.Handler {
	mux := http.NewServeMux()
	reply := func(w http.ResponseWriter) {
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(tenantcfg.ReadOnlyState{Active: f.active, Migrations: f.migrations})
	}
	mux.HandleFunc(tenantcfg.ReadOnlyRoute, func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		unsupported := f.unsupported
		f.mu.Unlock()
		if unsupported {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodPost {
			var req tenantcfg.ReadOnlyRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			f.mu.Lock()
			f.active = req.Active
			f.mu.Unlock()
		}
		reply(w)
	})
	return mux
}

func (f *fakeReadOnly) isActive() bool { f.mu.Lock(); defer f.mu.Unlock(); return f.active }

func swapManager(t *testing.T) (*OrgManager, *fakeSpawner, *fakeReadOnly) {
	t.Helper()
	ro := &fakeReadOnly{migrations: "3:1700000000_init.go"}
	sp := &fakeSpawner{cfgHandler: ro.handler()}
	m := newTestManager(t, sp)
	return m, sp, ro
}

func TestSwap_NotResidentIsUnavailable(t *testing.T) {
	m, sp, _ := swapManager(t)
	out, err := m.Swap(context.Background(), "acme")
	if out != SwapUnavailable || err != nil || sp.spawnCount() != 0 {
		t.Fatalf("outcome %v, err %v, spawns %d", out, err, sp.spawnCount())
	}
}

// A build from before read-only mode answers 404: swapping would let it
// keep writing while the new build migrates.
func TestSwap_BuildWithoutReadOnlyIsUnavailable(t *testing.T) {
	m, sp, ro := swapManager(t)
	old, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	ro.mu.Lock()
	ro.unsupported = true
	ro.mu.Unlock()
	out, err := m.Swap(context.Background(), "acme")
	if out != SwapUnavailable || err != nil || sp.spawnCount() != 1 {
		t.Fatalf("outcome %v, err %v, spawns %d", out, err, sp.spawnCount())
	}
	if cur, _ := m.Get(context.Background(), "acme"); cur != old {
		t.Fatal("resident instance changed")
	}
}

func TestSwap_CommitMovesTrafficThenStopsTheOld(t *testing.T) {
	m, _, ro := swapManager(t)
	old, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	var sawReadOnly bool
	m.cfg.SwapPaused = func(string) { sawReadOnly = ro.isActive() && m.Swapping("acme") }

	out, err := m.Swap(context.Background(), "acme")
	if out != SwapCommitted || err != nil {
		t.Fatalf("outcome %v, err %v", out, err)
	}
	if !sawReadOnly {
		t.Fatal("the old process was not read-only (or not marked swapping) before the new one spawned")
	}
	cur, err := m.Get(context.Background(), "acme")
	if err != nil || cur == old {
		t.Fatalf("resident instance not replaced (err %v)", err)
	}
	if cur.sockDir == old.sockDir {
		t.Fatal("new process reuses the old socket dir")
	}
	waitFor(t, "old process stopped", func() bool {
		select {
		case <-old.dead:
			return true
		default:
			return false
		}
	})
	waitFor(t, "swap flag cleared", func() bool { return !m.Swapping("acme") })
	waitFor(t, "old socket dir removed", func() bool { _, err := os.Lstat(old.sockDir); return os.IsNotExist(err) })
}

// The new build fails before it touched the schema: the old process takes
// writes again and the org's links point back at the build it runs.
func TestSwap_FailureWithoutMigrationKeepsTheOld(t *testing.T) {
	m, sp, ro := swapManager(t)
	old, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	sp.failReady = true
	out, err := m.Swap(context.Background(), "acme")
	if out != SwapKeptOld || err == nil {
		t.Fatalf("outcome %v, err %v", out, err)
	}
	if ro.isActive() {
		t.Fatal("old process is still read-only")
	}
	if cur, _ := m.Get(context.Background(), "acme"); cur != old {
		t.Fatal("old process is no longer resident")
	}
	// MaterializeBuild links <orgDir>/pb_hooks to <buildDir>/pb_hooks.
	target, err := os.Readlink(filepath.Join(m.cfg.Root, "pb_orgs", "acme", "pb_hooks"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(old.buildDir, "pb_hooks"); target != want {
		t.Fatalf("pb_hooks -> %s, want the old build's %s", target, want)
	}
	if m.Swapping("acme") {
		t.Fatal("still marked swapping")
	}
}

// The new build ran a migration before it failed: only the revert path
// (snapshot restore at boot) can undo that, so the old process stays
// read-only for the caller to replace.
func TestSwap_FailureAfterMigrationAsksForRevert(t *testing.T) {
	m, sp, ro := swapManager(t)
	old, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	m.cfg.SwapPaused = func(string) {
		ro.mu.Lock()
		ro.migrations = "4:1800000000_new.go"
		ro.mu.Unlock()
	}
	sp.failReady = true
	out, err := m.Swap(context.Background(), "acme")
	if out != SwapRevert || err == nil {
		t.Fatalf("outcome %v, err %v", out, err)
	}
	if !ro.isActive() {
		t.Fatal("old process left read-only mode over a migrated schema")
	}
	if cur, _ := m.Get(context.Background(), "acme"); cur != old {
		t.Fatal("old process is no longer resident")
	}
}

// An eviction during the swap (suspend, archive) wins: the new process is
// not published.
func TestSwap_EvictDuringSwapIsNotUndone(t *testing.T) {
	m, _, _ := swapManager(t)
	if _, err := m.Get(context.Background(), "acme"); err != nil {
		t.Fatal(err)
	}
	m.cfg.SwapPaused = func(slug string) { m.Evict(slug) }
	out, err := m.Swap(context.Background(), "acme")
	if out != SwapCommitted || err != nil {
		t.Fatalf("outcome %v, err %v", out, err)
	}
	m.mu.RLock()
	_, resident := m.orgs["acme"]
	m.mu.RUnlock()
	if resident {
		t.Fatal("swap published an instance after the org was evicted")
	}
}

type headroomSpawner struct {
	*fakeSpawner
	mu       sync.Mutex
	raised   int
	restored int
}

func (h *headroomSpawner) SwapHeadroom(string) (func(), error) {
	h.mu.Lock()
	h.raised++
	h.mu.Unlock()
	return func() { h.mu.Lock(); h.restored++; h.mu.Unlock() }, nil
}

func TestSwap_RaisesHeadroomUntilTheOldProcessIsGone(t *testing.T) {
	ro := &fakeReadOnly{migrations: "3:x"}
	hs := &headroomSpawner{fakeSpawner: &fakeSpawner{cfgHandler: ro.handler()}}
	m := newTestManager(t, hs)
	old, err := m.Get(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	if out, err := m.Swap(context.Background(), "acme"); out != SwapCommitted || err != nil {
		t.Fatalf("outcome %v, err %v", out, err)
	}
	<-old.dead
	waitFor(t, "limits restored", func() bool { hs.mu.Lock(); defer hs.mu.Unlock(); return hs.restored == 1 })
	hs.mu.Lock()
	defer hs.mu.Unlock()
	if hs.raised != 1 {
		t.Fatalf("raised %d times", hs.raised)
	}
}
```

`newTestManager` must accept a `Spawner`; if it takes `*fakeSpawner` only, widen its parameter. If `fakeSpawner.failReady` is not a plain field that a test may set after the first spawn, add the smallest accessor that lets it. The test manager must resolve the org through an artifact fixture (`buildArtifact`/`resolveBuilds`), so that `prepare` materializes a real build dir; use the same setup as the existing artifact-backed `Get` test.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/orgmanager -run TestSwap -v`
Expected: build failure (`Swap`, `SwapOutcome` undefined).

- [ ] **Step 3: Implement**

`readonly_client.go`:

```go
package orgmanager

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"tinycld.org/hosting/tenantcfg"
)

// errReadOnlyUnsupported: the tenant's build has no read-only route. It was
// built before the mode existed and would keep writing during a swap.
var errReadOnlyUnsupported = errors.New("tenant build has no read-only route")

func readOnlyState(ctx context.Context, cfgSock string) (tenantcfg.ReadOnlyState, error) {
	return readOnlyCall(ctx, cfgSock, http.MethodGet, nil)
}

func setReadOnly(ctx context.Context, cfgSock string, active bool) (tenantcfg.ReadOnlyState, error) {
	body, err := json.Marshal(tenantcfg.ReadOnlyRequest{Active: active})
	if err != nil {
		return tenantcfg.ReadOnlyState{}, err
	}
	return readOnlyCall(ctx, cfgSock, http.MethodPost, body)
}

func readOnlyCall(ctx context.Context, cfgSock, method string, body []byte) (tenantcfg.ReadOnlyState, error) {
	var st tenantcfg.ReadOnlyState
	if cfgSock == "" {
		return st, errReadOnlyUnsupported
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://tenant"+tenantcfg.ReadOnlyRoute, bytes.NewReader(body))
	if err != nil {
		return st, err
	}
	res, err := cfgSockClient(cfgSock).Do(req)
	if err != nil {
		return st, err
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusNotFound:
		return st, errReadOnlyUnsupported
	case res.StatusCode != http.StatusOK:
		return st, fmt.Errorf("read-only route: status %d", res.StatusCode)
	}
	return st, json.NewDecoder(res.Body).Decode(&st)
}
```

`swap.go`:

```go
package orgmanager

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"

	"tinycld.org/hosting/internal/materialize"
	"tinycld.org/hosting/internal/orgerr"
)

// SwapOutcome tells the caller of Swap what state the org is in.
type SwapOutcome int

const (
	// SwapUnavailable: nothing changed; replace the tenant the old way.
	SwapUnavailable SwapOutcome = iota
	// SwapCommitted: the new process serves; the old one drains and exits.
	SwapCommitted
	// SwapKeptOld: the new build failed before the schema changed; the old
	// process serves the previous build and takes writes again.
	SwapKeptOld
	// SwapRevert: the new build failed and may have migrated the database;
	// the old process is still resident and read-only, and only a boot of
	// the previous build (which restores the snapshot) can undo it.
	SwapRevert
)

// Swap moves a resident org onto the build its record now names without a
// cold start. The old process goes read-only first, so it cannot write
// against a schema the new build is migrating, and it keeps serving reads
// until the new process is ready.
func (m *OrgManager) Swap(ctx context.Context, slug string) (SwapOutcome, error) {
	m.mu.RLock()
	old := m.orgs[slug]
	startEpoch := m.evictEpoch[slug]
	m.mu.RUnlock()
	if old == nil {
		return SwapUnavailable, nil
	}
	rec, ok := m.cfg.LookupOrg(slug)
	if !ok || refuseStatus(slug, rec.Status, nil) != nil {
		return SwapUnavailable, nil
	}

	before, err := setReadOnly(ctx, old.cfgSock, true)
	if err != nil {
		if !errors.Is(err, errReadOnlyUnsupported) {
			m.cfg.Logger.Warn("swap: could not pause the old process; replacing it cold", "slug", slug, "error", err)
		}
		return SwapUnavailable, nil
	}
	m.markSwapping(slug)
	restore := m.swapHeadroom(slug)

	if m.cfg.SwapPaused != nil {
		m.cfg.SwapPaused(slug)
	}

	releaseSlot, err := m.acquireSpawnSlot(ctx, slug)
	if err != nil {
		m.leaveReadOnly(old, slug)
		restore()
		m.unmarkSwapping(slug)
		return SwapUnavailable, nil
	}
	defer releaseSlot()

	orgDir := filepath.Join(m.cfg.Root, "pb_orgs", slug)
	p, err := m.prepare(slug, orgDir, rec)
	if err != nil {
		return m.failSwap(old, slug, orgDir, before.Migrations, restore, err)
	}
	inst, err := m.spawn(ctx, slug, orgDir, p.src, p.cfgs, p.withMail)
	if err != nil {
		return m.failSwap(old, slug, orgDir, before.Migrations, restore, err)
	}
	inst.buildDir = p.buildDir

	m.mu.Lock()
	if m.closed || m.evictEpoch[slug] != startEpoch {
		// An eviction (suspend, archive, shutdown) landed during the swap
		// and already stopped the old process. The new build passed
		// readiness, so the deploy stands; the next Get boots it.
		m.mu.Unlock()
		go inst.shutdown(drainTimeout, killTimeout)
		restore()
		m.unmarkSwapping(slug)
		return SwapCommitted, nil
	}
	m.orgs[slug] = inst
	m.mu.Unlock()
	close(inst.published)
	if m.cfg.OrgURL != nil {
		go m.reconcileAppURL(context.WithoutCancel(ctx), slug, inst, p.spawnOrigin)
	}

	go func() {
		old.shutdown(drainTimeout, killTimeout)
		restore()
		m.unmarkSwapping(slug)
	}()
	return SwapCommitted, nil
}

// failSwap decides between keeping the old process and asking for a revert.
// The old process saw every migration the new one ran (same database), so an
// unchanged fingerprint means the schema it serves is still its own.
func (m *OrgManager) failSwap(old *OrgInstance, slug, orgDir, before string, restore func(), cause error) (SwapOutcome, error) {
	defer restore()
	defer m.unmarkSwapping(slug)
	ctx, cancel := context.WithTimeout(context.Background(), pushTimeout)
	defer cancel()
	after, err := readOnlyState(ctx, old.cfgSock)
	if err != nil || after.Migrations != before || old.buildDir == "" {
		return SwapRevert, fmt.Errorf("%w: new build failed: %w", orgerr.ErrOrgUnavailable, cause)
	}
	if err := materialize.MaterializeBuild(orgDir, old.buildDir); err != nil {
		return SwapRevert, fmt.Errorf("relink the previous build of %s: %w (new build failed: %w)", slug, err, cause)
	}
	if _, err := setReadOnly(ctx, old.cfgSock, false); err != nil {
		return SwapRevert, fmt.Errorf("resume writes on %s: %w (new build failed: %w)", slug, err, cause)
	}
	return SwapKeptOld, fmt.Errorf("new build failed: %w", cause)
}

func (m *OrgManager) leaveReadOnly(old *OrgInstance, slug string) {
	ctx, cancel := context.WithTimeout(context.Background(), pushTimeout)
	defer cancel()
	if _, err := setReadOnly(ctx, old.cfgSock, false); err != nil {
		m.cfg.Logger.Error("swap: could not resume writes on the old process", "slug", slug, "error", err)
	}
}

func (m *OrgManager) swapHeadroom(slug string) func() {
	hs, ok := m.cfg.Spawner.(HeadroomSpawner)
	if !ok {
		return func() {}
	}
	restore, err := hs.SwapHeadroom(slug)
	if err != nil {
		// The swap still runs: the limits only risk an OOM kill of one of
		// the two processes, which readiness or the drain then reports.
		m.cfg.Logger.Warn("swap: could not raise cgroup limits", "slug", slug, "error", err)
		return func() {}
	}
	return restore
}

// Swapping reports whether slug is in a swap, from the moment its old
// process is read-only until that process is gone. The traffic counter
// skips the org's 503s for that window.
func (m *OrgManager) Swapping(slug string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.swapping[slug] > 0
}

func (m *OrgManager) markSwapping(slug string) {
	m.mu.Lock()
	m.swapping[slug]++
	m.mu.Unlock()
}

func (m *OrgManager) unmarkSwapping(slug string) {
	m.mu.Lock()
	if m.swapping[slug]--; m.swapping[slug] <= 0 {
		delete(m.swapping, slug)
	}
	m.mu.Unlock()
}
```

In `manager.go`: add `swapping map[string]int` to `OrgManager` (guarded by `mu`, made in `New`) and `SwapPaused func(slug string)` to `Config`, with the doc comment "test hook: runs after the old process is read-only, before the new one spawns; nil in production". Use the real name of the `Spawner` field of `Config` in `swapHeadroom`.

`spawn` does not call `noteCrash`; `load` does. `Swap` deliberately does not: the old process still serves, so a failed new build must not put the org into crash backoff.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/orgmanager -run TestSwap -v -race -count=1`, then the full gate.

- [ ] **Step 5: Commit**

```bash
git add internal/orgmanager/swap.go internal/orgmanager/readonly_client.go internal/orgmanager/swap_test.go internal/orgmanager/manager.go
git commit -m "feat(orgmanager): swap a resident tenant onto its new build"
```

(Add `manager_test.go` / `fake_spawner_test.go` if you changed a helper.)

---

### Task 6: The Deployer swaps

**Files:**
- Modify: `internal/controlplane/provisioning.go` (seam types ~38-62; `EnableBuilds` ~426; add `SetSwap` next to `SetUpgradeSnapshot` ~461), `internal/controlplane/deploy.go` (`Deployer` struct ~74-205; `finish` ~907-979), `cmd/serve-router/main.go` (next to `prov.SetUpgradeSnapshot`, ~338)
- Test: `internal/controlplane/deploy_swap_test.go` (new)

**Interfaces:**
- Consumes: `orgmanager.SwapOutcome` and its constants, `(*OrgManager).Swap` (Task 5).
- Produces:
  - `type SwapFunc func(ctx context.Context, slug string) (orgmanager.SwapOutcome, error)`
  - `func (p *Provisioner) SetSwap(fn SwapFunc)`, `func (d *Deployer) SetSwap(fn SwapFunc)`

- [ ] **Step 1: Write the failing tests**

Model them on `deploy_test.go` (`newDeployHarness`, `fakeArtifactBuilder`, `waitUntil`, `nextLock`, `hashOld`) and `deploy_snapshot_test.go` (`fakeTenantSnapshot`, `writeLiveDB`). Read those helpers first and use their real names and signatures.

```go
package controlplane

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"tinycld.org/hosting/internal/orgmanager"
	"tinycld.org/hosting/tenantcfg"
)

type swapSeams struct {
	evicted, verified, swapped atomic.Int32
}

// swapDeployer is the Deployer of TestDeploy_CommitsOnHealthyRespawn with a
// swap seam that returns the given result. verify fails like a broken build
// would, so a test that reaches it by mistake cannot commit.
func swapDeployer(t *testing.T, h *deployHarness, out orgmanager.SwapOutcome, swapErr error) (*Deployer, *swapSeams, *fakeTenant) {
	t.Helper()
	s := &swapSeams{}
	tenant := &fakeTenant{}
	d := newDeployer(h.cp.App, h.root, &fakeArtifactBuilder{hash: hashNew},
		func(string) { s.evicted.Add(1) },
		func(context.Context, string) error { s.verified.Add(1); return nil },
		nil, quietTestLogger())
	d.snapshot = fakeTenantSnapshot(t, h, tenant)
	d.SetSwap(func(context.Context, string) (orgmanager.SwapOutcome, error) {
		s.swapped.Add(1)
		return out, swapErr
	})
	return d, s, tenant
}

func TestDeploy_SwapCommitSkipsEvict(t *testing.T) {
	h := newDeployHarness(t)
	d, s, _ := swapDeployer(t, h, orgmanager.SwapCommitted, nil)
	if _, err := d.Deploy(context.Background(), "acme", nextLock, "job_1"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "committed", func() bool { return h.lastDeployment(t).GetString("status") == "committed" })
	if s.swapped.Load() != 1 || s.evicted.Load() != 0 || s.verified.Load() != 0 {
		t.Fatalf("swap=%d evict=%d verify=%d, want 1/0/0", s.swapped.Load(), s.evicted.Load(), s.verified.Load())
	}
}

func TestDeploy_SwapUnavailableFallsBackToEvictAndRespawn(t *testing.T) {
	h := newDeployHarness(t)
	d, s, _ := swapDeployer(t, h, orgmanager.SwapUnavailable, nil)
	if _, err := d.Deploy(context.Background(), "acme", nextLock, "job_1"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "committed", func() bool { return h.lastDeployment(t).GetString("status") == "committed" })
	if s.evicted.Load() != 1 || s.verified.Load() != 1 {
		t.Fatalf("evict=%d verify=%d, want 1/1", s.evicted.Load(), s.verified.Load())
	}
}

// The old process never stopped and the schema is unchanged: only the record
// goes back. A restore request here would make the next boot roll back data
// written after the failed deploy.
func TestDeploy_SwapKeptOldRevertsTheRowWithoutRestart(t *testing.T) {
	h := newDeployHarness(t)
	writeLiveDB(t, h, "live")
	d, s, _ := swapDeployer(t, h, orgmanager.SwapKeptOld, errors.New("boot failed: hook threw"))
	if _, err := d.DeployWithSnapshot(context.Background(), "acme", map[string]string{"tinycld": "1.1.0"}, "job_auto"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "reverted", func() bool { return h.lastDeployment(t).GetString("status") == "reverted" })
	if got := h.org(t).GetString("recipe_hash"); got != hashOld {
		t.Fatalf("org row recipe_hash = %s, want %s", got, hashOld)
	}
	if _, err := os.Stat(tenantcfg.RestoreSnapshotPath(h.orgDir)); !os.IsNotExist(err) {
		t.Fatalf("a kept-old swap wrote a restore request (err=%v)", err)
	}
	res, ok, err := tenantcfg.LoadDeployResult(h.orgDir)
	if err != nil || !ok || res.Status != tenantcfg.DeployReverted || res.JobID != "job_auto" || res.RecipeHash != hashOld {
		t.Fatalf("deploy result = %+v (ok=%v err=%v)", res, ok, err)
	}
	if s.evicted.Load() != 0 || s.verified.Load() != 0 {
		t.Fatalf("evict=%d verify=%d, want 0/0", s.evicted.Load(), s.verified.Load())
	}
	if !strings.Contains(h.lastDeployment(t).GetString("error"), "boot failed") {
		t.Fatalf("deployment error = %q", h.lastDeployment(t).GetString("error"))
	}
}

func TestDeploy_SwapRevertRunsThePart2RevertPath(t *testing.T) {
	h := newDeployHarness(t)
	writeLiveDB(t, h, "migrated-then-crashed")
	d, s, _ := swapDeployer(t, h, orgmanager.SwapRevert, errors.New("boot failed: hook threw"))
	if _, err := d.DeployWithSnapshot(context.Background(), "acme", map[string]string{"tinycld": "1.1.0"}, "job_auto"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "reverted", func() bool { return h.lastDeployment(t).GetString("status") == "reverted" })
	req, ok, err := tenantcfg.LoadRestoreSnapshot(h.orgDir)
	if err != nil || !ok || req.JobID != "job_auto" {
		t.Fatalf("restore request = %+v (ok=%v err=%v)", req, ok, err)
	}
	// One evict stops the read-only old process; one verify boots the
	// previous build, which applies the restore.
	if s.evicted.Load() != 1 || s.verified.Load() != 1 {
		t.Fatalf("evict=%d verify=%d, want 1/1", s.evicted.Load(), s.verified.Load())
	}
}
```

`fakeTenant`, `fakeTenantSnapshot`, `writeLiveDB`, `waitUntil`, `nextLock`, `hashOld` and `hashNew` are existing helpers in `deploy_test.go` / `deploy_snapshot_test.go`. If one of them has a different signature (for example `fakeTenantSnapshot` takes the tenant by value), adapt the call, not the assertion.

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./internal/controlplane -run 'TestDeploy_Swap' -v`
Expected: build failure (`SetSwap` undefined).

- [ ] **Step 3: Implement**

In `provisioning.go`, next to the other seam types:

```go
// SwapFunc moves a resident org onto its new build without a cold start
// (orgmanager.Swap). nil means every deploy evicts and respawns.
type SwapFunc func(ctx context.Context, slug string) (orgmanager.SwapOutcome, error)
```

Add a `swap SwapFunc` field to `Provisioner` and `Deployer`, and setters that follow `SetUpgradeSnapshot` exactly (the Provisioner setter also sets it on `p.deployer` when it exists; `EnableBuilds` copies `p.swap` into the new Deployer the way it copies `p.upgradeSnapshot`).

In `finish`, replace `d.evict(slug)` and the verify block before `if bootErr == nil` with:

```go
outcome := orgmanager.SwapUnavailable
var bootErr error
if d.swap != nil {
	ctx, cancel := context.WithTimeout(context.Background(), tenantVerifyTimeout)
	outcome, bootErr = d.swap(ctx, slug)
	cancel()
}
switch outcome {
case orgmanager.SwapKeptOld:
	d.keepOld(slug, dep, prev, jobID, bootErr)
	return
case orgmanager.SwapUnavailable:
	d.evict(slug)
	if d.verify != nil {
		ctx, cancel := context.WithTimeout(context.Background(), tenantVerifyTimeout)
		bootErr = d.verify(ctx, slug)
		cancel()
	}
}
```

`SwapCommitted` reaches `if bootErr == nil` with a nil error and commits. `SwapRevert` reaches the existing revert path with its error, and that path's `d.evict(slug)` stops the read-only old process before the previous build boots.

```go
// keepOld settles a deploy whose new build failed before it touched the
// schema. The old process never stopped and is serving the previous build,
// so only the record goes back: no snapshot restore, no restart.
func (d *Deployer) keepOld(slug string, dep *core.Record, prev orgBuildState, jobID string, bootErr error) {
	orgDir := filepath.Join(d.root, "pb_orgs", slug)
	if err := d.restoreOrgRow(slug, prev); err != nil {
		d.log.Error("deploy: could not restore the org row after a failed swap", "slug", slug, "error", err)
	}
	d.writeDeployResult(orgDir, tenantcfg.DeployResult{JobID: jobID, Status: tenantcfg.DeployReverted, Error: bootErr.Error(), RecipeHash: prev.recipeHash, CompletedAt: time.Now().UTC()})
	d.setDeploymentStatus(dep, "reverted", bootErr)
}
```

Match the error handling of the existing revert block for `restoreOrgRow` (read lines ~939-948 and do what they do on its error). If the existing block logs with different keys, use its keys.

In `cmd/serve-router/main.go`, next to `prov.SetUpgradeSnapshot(...)`: `prov.SetSwap(func(ctx context.Context, slug string) (orgmanager.SwapOutcome, error) { return mgr.Swap(ctx, slug) })`. The closure reads `mgr` at call time, like `evictOrg`.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./internal/controlplane -run 'TestDeploy' -v -count=1`, then the full gate. Every existing `TestDeploy_*`, `TestDeployWithSnapshot_*` and rollout test must still pass: they set no swap, so they take `SwapUnavailable`.

- [ ] **Step 5: Commit**

```bash
git add internal/controlplane/provisioning.go internal/controlplane/deploy.go internal/controlplane/deploy_swap_test.go cmd/serve-router/main.go
git commit -m "feat(controlplane): deploys swap the tenant instead of evicting it"
```

---

### Task 7: A swap does not raise the 5xx signal

**Files:**
- Modify: `cmd/serve-router/traffic.go`, `cmd/serve-router/main.go` (`Observe: counter.Observe`, ~606)
- Test: `cmd/serve-router/traffic_test.go` (create it if it does not exist)

**Interfaces:**
- Consumes: `(*OrgManager).Swapping` (Task 5).
- Produces: `func observeTraffic(observe func(slug string, status int), swapping func(slug string) bool) func(slug string, status int)`

- [ ] **Step 1: Write the failing test**

```go
package main

import (
	"net/http"
	"testing"
)

func TestObserveTrafficSkipsA503WhileSwapping(t *testing.T) {
	var got []int
	record := func(_ string, status int) { got = append(got, status) }
	swapping := func(slug string) bool { return slug == "acme" }
	observe := observeTraffic(record, swapping)

	observe("acme", http.StatusServiceUnavailable)
	observe("acme", http.StatusInternalServerError)
	observe("acme", http.StatusOK)
	observe("beta", http.StatusServiceUnavailable)

	want := []int{http.StatusInternalServerError, http.StatusOK, http.StatusServiceUnavailable}
	if len(got) != len(want) {
		t.Fatalf("observed %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("observed %v, want %v", got, want)
		}
	}
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./cmd/serve-router -run TestObserveTraffic -v`
Expected: build failure (`observeTraffic` undefined).

- [ ] **Step 3: Implement**

In `traffic.go`:

```go
// observeTraffic drops a swapping org's 503s: its old process refuses writes
// (read_only) and the router answers stragglers with a restart page, both on
// purpose, and neither may count against the new build in the 5xx signal.
func observeTraffic(observe func(slug string, status int), swapping func(slug string) bool) func(slug string, status int) {
	return func(slug string, status int) {
		if status == http.StatusServiceUnavailable && swapping(slug) {
			return
		}
		observe(slug, status)
	}
}
```

In `main.go`: `Observe: observeTraffic(counter.Observe, func(slug string) bool { return mgr.Swapping(slug) }),`. Check that `mgr` is assigned before the server starts serving; it is a package-level `var` closure read at call time, like `evictOrg`.

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./cmd/serve-router -count=1`, then the full gate.

- [ ] **Step 5: Commit**

```bash
git add cmd/serve-router/traffic.go cmd/serve-router/traffic_test.go cmd/serve-router/main.go
git commit -m "feat(serve-router): a tenant swap does not count toward the 5xx signal"
```

---

### Task 8: End to end with real tenants

**Files:**
- Test: `internal/controlplane/swap_tenant_e2e_test.go` (new)
- Modify: `internal/controlplane/rollout_tenant_e2e_test.go` only to share helpers (for example to let `newRolloutStack` wire `SetSwap` and `SwapPaused`).

**Interfaces:**
- Consumes: everything above. The stack in `rollout_tenant_e2e_test.go` (`newRolloutStack`, `mapBuilder`, `killableSpawner`, `testsupport.BuildTenantBinary`, `CommitArtifact`) and its notes collection helpers. Read that file first.

The test proves the spec's D2 testing line against real tenant binaries. All three tests skip under `-short`, like the other real-binary tests.

- [ ] **Step 1: Write the tests**

1. **`TestSwapTenantE2E_WritesPauseReadsContinueRealtimeReconnects`**
   1. Build the stack with `SetSwap(mgr.Swap)` and an `orgmanager.Config.SwapPaused` hook that blocks on a channel the test controls. Boot the org on the current build with `mgr.Get`. Record the old process's pid.
   2. Open `GET /api/realtime` through `mgr.Get(...).Mux()`, read `PB_CONNECT`, subscribe to the notes collection. Use the SSE-reading pattern of `tinycld/core/server/coreserver/readonly_e2e_test.go` (read it), with a 5 s bound on every read.
   3. Start a deploy to the next build in a goroutine.
   4. When the hook fires:
      - `POST` a note: want 503, `Retry-After: 2`, and a body whose decoded `code` is `read_only`.
      - `GET` the notes list: want 200.
      - `mgr.Swapping(slug)` is true.
   5. Release the hook. Wait for the deployments row to be `committed`.
   6. The old SSE stream ends (EOF) within `drainTimeout + killTimeout` plus 5 s. Open a new stream (this is what pbtsdb does), subscribe again, `POST` a note: want 200, and the new stream delivers its create event within 5 s.
   7. The resident process's pid is not the old pid. `mgr.Swapping(slug)` becomes false.
2. **`TestSwapTenantE2E_FailedReadinessKeepsTheOldServingAndWritable`**
   - The next build fails readiness without a migration. Use the failing build of `TestRolloutTenantE2E_FailedBootRestoresPreviousBuildAndData` (a hook that throws). Check that it adds no migration file; if it does, make a failing build without one.
   - After the deploy settles as `reverted`: the resident pid is the old pid, a `POST` note gets 200, and the deployments row's error names the boot failure.
3. **`TestSwapTenantE2E_FailedReadinessAfterMigrationRestoresSnapshot`**
   - The next build adds a migration, then fails readiness (the migration file plus the throwing hook).
   - Run it through `DeployWithSnapshot` (snapshot mode) after writing a note.
   - After the deploy settles as `reverted`: the resident pid is a new pid (the previous build booted again), the note written before the deploy exists, and the new build's migration is not in `_migrations` (query through the tenant's API or the snapshot-restore assertions of the existing revert test, whichever the existing test uses).

Write each step as code. Bound every wait (use `waitUntil` or a `select` with `time.After`). No sleeps without a condition.

- [ ] **Step 2: Run, expect PASS**

Run: `go test ./internal/controlplane -run TestSwapTenantE2E -v -race -count=1`

These tests use Tasks 1-7, so they should pass at once. To show that test 1 can fail, set the Deployer's swap to nil for a moment and watch step 4 never fire (the test fails on its bound). Restore it, and say in the report that you did this.

- [ ] **Step 3: Run the full gate**

From the hosting root: `go build ./... && go vet ./...`, `go test ./... -count=1`, `gofmt -l .`.

- [ ] **Step 4: Commit**

```bash
git add internal/controlplane/swap_tenant_e2e_test.go internal/controlplane/rollout_tenant_e2e_test.go
git commit -m "test(controlplane): tenant swap end to end with real tenants"
```
