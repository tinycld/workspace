# Backup Repositories (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every backup behind one `Repository` interface, add a Proxmox Backup Server (PBS) repository that gives deduplicated (differential) backups, and let a self-hosted org back up to it on a cron schedule.

**Architecture:** A PocketBase-free `snapshot` package produces a consistent snapshot of a `pb_data` directory (DB copy + file list + manifest) while a delete hold stops file deletes. A PocketBase-free `repo` package defines `Repository`; the existing tar/zstd/age archive becomes the `archive` implementation and PBS becomes the `pbs` implementation (on the gopbs fork). The engine (`backup`) takes a snapshot, hands it to a repository, and restores from either an archive stream or a repository through a shared `arm` package that also serves out-of-process callers.

**Tech Stack:** Go 1.27 (PocketBase fork v0.40.4, `modernc.org/sqlite`, `filippo.io/age`, `github.com/klauspost/compress/zstd`, `github.com/osshield/gopbs` via the fork `github.com/nathanstitt/gopbs`), React Native + Expo (pbtsdb, TanStack DB, React Hook Form + zod), cobra CLI, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-backup-repositories-1-core-design.md` (workspace root).

## Global Constraints

- Work in the `tinycld` repo (`~/code/tinycld/tinycld`). Core Go module is `tinycld.org/core` at `core/server/`. Branch name: `backup-repositories` (the hosting plan uses the same name).
- **Prerequisite:** the gopbs fork (`~/code/vendor/gopbs`, `github.com/nathanstitt/gopbs`) implements `~/code/vendor/gopbs/HANDOFF-tinycld-reader.md`: `BackupSession.UploadStream`, `UploadStats.NewBytes`, `Client.ListSnapshots`, `Client.StartReader`, `ReaderSession.{Manifest,DownloadBlob,OpenDynamicIndex,Close}`, `DecodeBlob`, `ErrAuth`/`ErrNotFound`/`ErrFingerprint`, and package `pbstest`. Task 9 stops if these are missing.
- Nothing in core names hosting, SaaS, tenants, or a router.
- Never log, audit, return in an error, or send to Sentry: a PBS token secret, a PBS key, a passphrase, or a full URL. Hostnames only.
- The `backups` migration is released (v0.6.0). Schema changes go in a NEW migration.
- Every `system_settings` key for this feature starts with `backup.repository.`.
- Client code: no `useEffect`/`useState` for data; pbtsdb for PocketBase data; `useMutation` from `@tinycld/core/lib/mutations`; no raw hex colors; no `console.*`; biome 4-space, single quotes.
- Go: log with `logging.ForPackage(...)` (the `backup` package already has `log`). PocketBase-free packages (`hold`, `snapshot`, `repo`, `arm`, `archive`, `pbs`) must not import `github.com/pocketbase/pocketbase` or `tinycld.org/core/logging`; they return errors and let the caller log.
- Hold constants: lease `1h`, renew every `20m`. Drain cron every minute.
- Default schedule: `0 3 * * *`.
- PocketBase fork changes follow `third_party/pocketbase/FORK.md`: new code in `*_tinycld.go`, a row in the "What the fork changes" table.
- Quality gates per task: `cd core/server && go test ./...` for Go tasks; `pnpm exec tinycld-pkg check` (from `tinycld/`) for TS tasks. Fix every failure at its source.

## Deviations from the spec (decided while planning)

- `snapshot.FromDataDir` takes an `Options` struct (DB copy function, file lister, holder, tmp dir) instead of `(pbData, holder)`, so the in-process engine keeps its ATTACH-safe `vacuumInto` and S3-aware file listing. `Snapshot.Release` also removes the DB copy and closes the file lister.
- `GET /api/org-backups/snapshots` returns `{ ref, created, bytes }`. Reading `core`/`packages` would need one manifest download per snapshot.
- "Back up now to repository" is a button on the Repository card, not a toggle on the URL form.
- `arm.MarkStaged` checks row counts only for repository restores. An old archive's counts were read from the live DB, not from its snapshot, so they need not match exactly; archives keep their checksum verification.
- A key generator endpoint (`POST /api/org-backups/repository/generate-key`) backs the Generate button, because PBS key files need gopbs.

## File Structure

```
third_party/pocketbase/core/filesystem_hooks_tinycld.go       (new)  exports the storage delete hook
third_party/pocketbase/core/filesystem_hooks_tinycld_test.go  (new)
third_party/pocketbase/FORK.md                                (mod)  table row

core/server/backup/hold/hold.go            (new) hold file, journal, drain — PB-free
core/server/backup/hold/hold_test.go       (new)
core/server/backup/snapshot/snapshot.go    (new) FromDataDir — PB-free
core/server/backup/snapshot/manifest.go    (new) manifest from the DB copy
core/server/backup/snapshot/snapshot_test.go (new)
core/server/backup/repo/repo.go            (new) Repository interface + registry
core/server/backup/repo/repo_test.go       (new)
core/server/backup/repo/repotest/repotest.go (new) contract suite
core/server/backup/arm/arm.go              (new) marker, pending dir, staging checks, tar extract
core/server/backup/arm/arm_test.go         (new)
core/server/backup/archive/archive.go      (new) archive Repository over format
core/server/backup/archive/stage.go        (new) stage() moved from restore.go
core/server/backup/archive/archive_test.go (new)
core/server/backup/pbs/pbs.go              (new) pbs Repository
core/server/backup/pbs/config.go           (new) config parse/validate, key generation
core/server/backup/pbs/pbs_test.go         (new)
core/server/backup/holdhook.go             (new) delete-hook handler + drain for the live app
core/server/backup/holdhook_test.go        (new)
core/server/backup/engine.go               (mod) run() via snapshot + repo
core/server/backup/restore.go              (mod) repository input; uses arm + archive.Stage
core/server/backup/paths.go                (mod) armed = arm.Marker
core/server/backup/ledger.go               (mod) repository/ref/uploaded_bytes; FailedRun
core/server/backup/testapp_test.go         (mod) new ledger fields
core/server/pb_migrations/2050000004_backups_repository_fields.js (new)
core/server/coreserver/backup_repository.go      (new) config → Repository, cron
core/server/coreserver/backup_repository_api.go  (new) snapshots, test, generate-key
core/server/coreserver/backup_repository_test.go (new)
core/server/coreserver/backup_api.go       (mod) repository backup, snapshot restore
core/server/coreserver/server.go           (mod) RegisterBackupRepository
core/server/go.mod                         (mod) gopbs + replace
server/go.mod                              (mod) gopbs replace (the app build)

core/components/settings/backups/useBackupRepository.ts   (new)
core/components/settings/backups/repository-logic.ts      (new) pure helpers
core/components/settings/backups/__tests__/repository-logic.test.ts (new)
core/components/settings/backups/RepositoryCard.tsx       (new)
core/components/settings/backups/SnapshotRestoreForm.tsx  (new)
core/components/settings/backups/BackupsSection.tsx       (mod)
core/components/settings/backups/BackupHistory.tsx        (mod)
core/components/settings/backups/useBackups.ts            (mod) snapshot restore mutation

cli/backup.go / backup_create.go / backup_restore.go / backup_list.go (mod)
cli/backup_snapshots.go                    (new)
cli/backup_test.go                         (mod)

core/help/backups.md                       (mod)
tests/e2e/settings-backups.spec.ts         (mod)
```

---

### Task 1: Export the PocketBase storage delete hook

**Files:**
- Create: `third_party/pocketbase/core/filesystem_hooks_tinycld.go`
- Create: `third_party/pocketbase/core/filesystem_hooks_tinycld_test.go`
- Modify: `third_party/pocketbase/FORK.md` (table "What the fork changes")

**Interfaces:**
- Produces: `func OnFilesystemDelete(app App) *hook.Hook[*FilesystemDeleteEvent]` in package `github.com/pocketbase/pocketbase/core`.

- [ ] **Step 1: Write the failing test**

```go
package core_test

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// A handler that does not call e.Next() must stop the delete. The backup
// delete hold depends on exactly that.
func TestOnFilesystemDeleteCanSkipTheDelete(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	var seen string
	core.OnFilesystemDelete(app).BindFunc(func(e *core.FilesystemDeleteEvent) error {
		seen = e.FileKey
		return nil
	})

	fs, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()
	if err := fs.Upload([]byte("x"), "held/a.txt"); err != nil {
		t.Fatal(err)
	}
	if err := fs.Delete("held/a.txt"); err != nil {
		t.Fatal(err)
	}
	if seen != "held/a.txt" {
		t.Fatalf("hook saw %q", seen)
	}
	if _, err := fs.Attributes("held/a.txt"); errors.Is(err, filesystem.ErrNotFound) {
		t.Fatal("the file was deleted although the handler skipped e.Next()")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd third_party/pocketbase && go test ./core -run TestOnFilesystemDeleteCanSkipTheDelete`
Expected: FAIL — `undefined: core.OnFilesystemDelete`.

- [ ] **Step 3: Implement**

```go
package core

import "github.com/pocketbase/pocketbase/tools/hook"

// OnFilesystemDelete exposes the internal hook that app.NewFilesystem() binds
// to every storage delete. A handler that returns without calling e.Next()
// skips the delete. tinycld's backup delete hold uses it to keep every file a
// database snapshot refers to until the snapshot's files are read.
//
// Bind it before the first app.NewFilesystem() call you want covered: the
// filesystem attaches the hook only when a handler exists at creation time.
func OnFilesystemDelete(app App) *hook.Hook[*FilesystemDeleteEvent] {
	return app.onFilesystemDelete()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd third_party/pocketbase && go test ./core -run TestOnFilesystemDeleteCanSkipTheDelete`
Expected: PASS.

- [ ] **Step 5: Add the FORK.md row**

Add to the "What the fork changes" table:

```
| `core.OnFilesystemDelete`: the storage delete hook, exported so a backup can hold deletes | `core/filesystem_hooks_tinycld.go` | — |
```

- [ ] **Step 6: Commit**

```bash
git add third_party/pocketbase/core/filesystem_hooks_tinycld*.go third_party/pocketbase/FORK.md
git commit -m "feat(pocketbase): export the storage delete hook"
```

---

### Task 2: The delete hold (`backup/hold`)

**Files:**
- Create: `core/server/backup/hold/hold.go`
- Test: `core/server/backup/hold/hold_test.go`

**Interfaces:**
- Produces (package `tinycld.org/core/backup/hold`):
  - `const FileName = "backup-hold"`, `JournalName = "backup-hold.journal"`, `Lease = time.Hour`, `RenewEvery = 20 * time.Minute`
  - `var ErrHeld error`
  - `type State struct { Holder string; Expires time.Time }` with `func (s State) Valid(now time.Time) bool`
  - `func Read(dataDir string) (State, bool, error)` — `false` when no hold file
  - `func Active(dataDir string, now time.Time) bool`
  - `func Acquire(dataDir, holder string, now func() time.Time) (*Hold, error)`
  - `func (h *Hold) Release() error`
  - `func Journal(dataDir, key string) error`
  - `func Drain(dataDir string, now time.Time, del func(key string) error) (int, error)`
  - `func RemoveStale(dataDir string, now time.Time) (State, bool, error)` — removes an expired hold file and returns it

- [ ] **Step 1: Write the failing tests**

```go
package hold

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func clock(t time.Time) func() time.Time { return func() time.Time { return t } }

func TestAcquireWritesAReadableHold(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	h, err := Acquire(dir, "engine", clock(now))
	if err != nil {
		t.Fatal(err)
	}
	defer h.Release()
	st, ok, err := Read(dir)
	if err != nil || !ok {
		t.Fatalf("read: %v %v", ok, err)
	}
	if st.Holder != "engine" || !st.Expires.Equal(now.Add(Lease)) {
		t.Fatalf("state = %+v", st)
	}
	// Another process must be able to read it: a hold written by one user is
	// read by the app running as another.
	fi, _ := os.Stat(filepath.Join(dir, FileName))
	if fi.Mode().Perm() != 0o644 {
		t.Fatalf("mode = %v", fi.Mode().Perm())
	}
}

func TestSecondHolderIsRefusedWhileValid(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	h, err := Acquire(dir, "engine", clock(now))
	if err != nil {
		t.Fatal(err)
	}
	defer h.Release()
	if _, err := Acquire(dir, "router", clock(now)); !errors.Is(err, ErrHeld) {
		t.Fatalf("err = %v, want ErrHeld", err)
	}
}

func TestExpiredHoldIsTakenOver(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	if _, err := Acquire(dir, "crashed", clock(now.Add(-2*Lease))); err != nil {
		t.Fatal(err)
	}
	h, err := Acquire(dir, "engine", clock(now))
	if err != nil {
		t.Fatalf("expired hold not taken over: %v", err)
	}
	defer h.Release()
	st, _, _ := Read(dir)
	if st.Holder != "engine" {
		t.Fatalf("holder = %q", st.Holder)
	}
}

func TestReleaseRemovesOnlyItsOwnHold(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	h, _ := Acquire(dir, "engine", clock(now))
	if err := h.Release(); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := Read(dir); ok {
		t.Fatal("hold still present")
	}
	// A release after another holder took over (ours expired) leaves theirs.
	h1, _ := Acquire(dir, "a", clock(now.Add(-2*Lease)))
	h2, _ := Acquire(dir, "b", clock(now))
	_ = h1.Release()
	st, ok, _ := Read(dir)
	if !ok || st.Holder != "b" {
		t.Fatalf("release removed another holder's hold: %+v %v", st, ok)
	}
	_ = h2.Release()
}

func TestDrainWaitsForTheHoldThenDeletesEveryKey(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	h, _ := Acquire(dir, "engine", clock(now))
	for _, k := range []string{"a/1.txt", "b/2.txt"} {
		if err := Journal(dir, k); err != nil {
			t.Fatal(err)
		}
	}
	var deleted []string
	del := func(k string) error { deleted = append(deleted, k); return nil }
	if n, err := Drain(dir, now, del); err != nil || n != 0 {
		t.Fatalf("drain under a valid hold: n=%d err=%v", n, err)
	}
	_ = h.Release()
	n, err := Drain(dir, now, del)
	if err != nil || n != 2 || len(deleted) != 2 {
		t.Fatalf("drain: n=%d err=%v deleted=%v", n, err, deleted)
	}
	if n, _ := Drain(dir, now, del); n != 0 {
		t.Fatalf("second drain deleted %d", n)
	}
}

func TestDrainKeepsTheRestAfterAnError(t *testing.T) {
	dir := t.TempDir()
	_ = Journal(dir, "a")
	_ = Journal(dir, "b")
	boom := errors.New("boom")
	calls := 0
	_, err := Drain(dir, time.Now(), func(k string) error {
		calls++
		if k == "b" {
			return boom
		}
		return nil
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	var again []string
	if _, err := Drain(dir, time.Now(), func(k string) error { again = append(again, k); return nil }); err != nil {
		t.Fatal(err)
	}
	// Idempotent: the retry may repeat "a"; it must not skip "b".
	if len(again) == 0 || again[len(again)-1] != "b" {
		t.Fatalf("retry = %v", again)
	}
}

func TestRemoveStaleReportsAnAbandonedHold(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	_, _ = Acquire(dir, "crashed", clock(now.Add(-2*Lease)))
	st, removed, err := RemoveStale(dir, now)
	if err != nil || !removed || st.Holder != "crashed" {
		t.Fatalf("st=%+v removed=%v err=%v", st, removed, err)
	}
	if _, ok, _ := Read(dir); ok {
		t.Fatal("stale hold still present")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd core/server && go test ./backup/hold/`
Expected: FAIL — package has no Go files / undefined names.

- [ ] **Step 3: Implement**

```go
// Package hold stops storage deletes while a backup reads the files its
// database snapshot refers to. The holder may be this process or another
// process on the same host, so the hold is a file in pb_data rather than
// memory.
//
// The hold is a lease: a crashed holder cannot block deletes for longer than
// Lease. A delete that arrives under a valid hold is journaled, and Drain
// runs the journal once no valid hold exists.
package hold

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	FileName    = "backup-hold"
	JournalName = "backup-hold.journal"
	drainName   = "backup-hold.journal.draining"
	Lease       = time.Hour
	RenewEvery  = 20 * time.Minute
)

var ErrHeld = errors.New("backup: another backup holds storage deletes")

type State struct {
	Holder  string    `json:"holder"`
	Expires time.Time `json:"expires"`
}

func (s State) Valid(now time.Time) bool { return now.Before(s.Expires) }

func Read(dataDir string) (State, bool, error) {
	raw, err := os.ReadFile(filepath.Join(dataDir, FileName))
	if errors.Is(err, os.ErrNotExist) {
		return State{}, false, nil
	}
	if err != nil {
		return State{}, false, err
	}
	var st State
	if err := json.Unmarshal(raw, &st); err != nil {
		// An unreadable hold holds nothing: treating it as valid would block
		// deletes forever with nothing to expire it.
		return State{}, false, nil
	}
	return st, true, nil
}

func Active(dataDir string, now time.Time) bool {
	st, ok, err := Read(dataDir)
	return err == nil && ok && st.Valid(now)
}

type Hold struct {
	dataDir, holder string
	now             func() time.Time
	stop            chan struct{}
	done            chan struct{}
	once            sync.Once
}

// Acquire takes the hold and renews it every RenewEvery until Release. An
// expired hold of another holder is taken over.
func Acquire(dataDir, holder string, now func() time.Time) (*Hold, error) {
	if now == nil {
		now = time.Now
	}
	path := filepath.Join(dataDir, FileName)
	for attempt := 0; attempt < 2; attempt++ {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			werr := writeState(f, State{Holder: holder, Expires: now().Add(Lease)})
			if werr != nil {
				_ = os.Remove(path)
				return nil, werr
			}
			h := &Hold{dataDir: dataDir, holder: holder, now: now, stop: make(chan struct{}), done: make(chan struct{})}
			go h.renew()
			return h, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		st, ok, rerr := Read(dataDir)
		if rerr != nil {
			return nil, rerr
		}
		if ok && st.Valid(now()) {
			return nil, fmt.Errorf("%w (holder %s)", ErrHeld, st.Holder)
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return nil, ErrHeld
}

func writeState(f *os.File, st State) error {
	raw, err := json.Marshal(st)
	if err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.Write(raw); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func (h *Hold) renew() {
	defer close(h.done)
	t := time.NewTicker(RenewEvery)
	defer t.Stop()
	for {
		select {
		case <-h.stop:
			return
		case <-t.C:
			// Replace atomically so a reader never sees a half-written file.
			tmp := filepath.Join(h.dataDir, FileName+".tmp")
			f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
			if err != nil {
				continue
			}
			if writeState(f, State{Holder: h.holder, Expires: h.now().Add(Lease)}) == nil {
				_ = os.Rename(tmp, filepath.Join(h.dataDir, FileName))
			}
		}
	}
}

// Release stops renewal and removes the hold if it is still this holder's.
func (h *Hold) Release() error {
	var err error
	h.once.Do(func() {
		close(h.stop)
		<-h.done
		st, ok, rerr := Read(h.dataDir)
		if rerr != nil {
			err = rerr
			return
		}
		if ok && st.Holder == h.holder {
			if rerr := os.Remove(filepath.Join(h.dataDir, FileName)); rerr != nil && !errors.Is(rerr, os.ErrNotExist) {
				err = rerr
			}
		}
	})
	return err
}

func Journal(dataDir, key string) error {
	if strings.ContainsAny(key, "\n\r") {
		return fmt.Errorf("backup: storage key contains a line break")
	}
	f, err := os.OpenFile(filepath.Join(dataDir, JournalName), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(key + "\n"); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// Drain deletes every journaled key when no valid hold exists. The journal is
// renamed before it is read, so deletes journaled under a hold that starts
// during the drain go to a new journal. A drain that stops on an error keeps
// the renamed file, and the next drain repeats it; del must treat a missing
// key as success.
func Drain(dataDir string, now time.Time, del func(key string) error) (int, error) {
	if Active(dataDir, now) {
		return 0, nil
	}
	draining := filepath.Join(dataDir, drainName)
	if _, err := os.Stat(draining); errors.Is(err, os.ErrNotExist) {
		if err := os.Rename(filepath.Join(dataDir, JournalName), draining); errors.Is(err, os.ErrNotExist) {
			return 0, nil
		} else if err != nil {
			return 0, err
		}
	}
	f, err := os.Open(draining)
	if err != nil {
		return 0, err
	}
	sc := bufio.NewScanner(f)
	n := 0
	for sc.Scan() {
		key := sc.Text()
		if key == "" {
			continue
		}
		if err := del(key); err != nil {
			_ = f.Close()
			return n, err
		}
		n++
	}
	if err := sc.Err(); err != nil {
		_ = f.Close()
		return n, err
	}
	if err := f.Close(); err != nil {
		return n, err
	}
	return n, os.Remove(draining)
}

func RemoveStale(dataDir string, now time.Time) (State, bool, error) {
	st, ok, err := Read(dataDir)
	if err != nil || !ok || st.Valid(now) {
		return st, false, err
	}
	if err := os.Remove(filepath.Join(dataDir, FileName)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return st, false, err
	}
	return st, true, nil
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd core/server && go test -race ./backup/hold/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/server/backup/hold
git commit -m "feat(backup): delete hold for storage files during a snapshot"
```

---

### Task 3: Hold deletes in the running app

**Files:**
- Create: `core/server/backup/holdhook.go`
- Test: `core/server/backup/holdhook_test.go`
- Modify: `core/server/coreserver/backup_api.go` (`RegisterBackupBoot`)

**Interfaces:**
- Consumes: `hold.Active`, `hold.Journal`, `hold.Drain`, `hold.RemoveStale` (Task 2); `core.OnFilesystemDelete` (Task 1).
- Produces (package `backup`):
  - `func BindDeleteHold(app core.App)` — binds the handler once.
  - `func DrainHeldDeletes(app core.App)` — logs a stale hold, then drains.
  - `const DrainJobID = "backup-hold-drain"`

- [ ] **Step 1: Write the failing test**

```go
package backup

import (
	"errors"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/filesystem"

	"tinycld.org/core/backup/hold"
)

func TestHeldDeleteIsJournaledThenDrained(t *testing.T) {
	app := newTestApp(t)
	BindDeleteHold(app)

	fs, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()

	h, err := hold.Acquire(app.DataDir(), "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := fs.Delete("col1/rec1/hello.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Attributes("col1/rec1/hello.txt"); err != nil {
		t.Fatalf("file gone under a hold: %v", err)
	}

	DrainHeldDeletes(app)
	if _, err := fs.Attributes("col1/rec1/hello.txt"); err != nil {
		t.Fatal("drained while the hold was valid")
	}

	if err := h.Release(); err != nil {
		t.Fatal(err)
	}
	DrainHeldDeletes(app)
	if _, err := fs.Attributes("col1/rec1/hello.txt"); !errors.Is(err, filesystem.ErrNotFound) {
		t.Fatalf("file not deleted after release: %v", err)
	}
}

func TestExpiredHoldDoesNotBlockDeletes(t *testing.T) {
	app := newTestApp(t)
	BindDeleteHold(app)
	past := func() time.Time { return time.Now().Add(-2 * hold.Lease) }
	if _, err := hold.Acquire(app.DataDir(), "crashed", past); err != nil {
		t.Fatal(err)
	}
	fs, _ := app.NewFilesystem()
	defer fs.Close()
	if err := fs.Delete("col1/rec1/hello.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Attributes("col1/rec1/hello.txt"); !errors.Is(err, filesystem.ErrNotFound) {
		t.Fatal("an expired hold still blocked the delete")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd core/server && go test ./backup -run 'TestHeldDelete|TestExpiredHold'`
Expected: FAIL — `undefined: BindDeleteHold`.

- [ ] **Step 3: Implement**

```go
package backup

import (
	"errors"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"tinycld.org/core/backup/hold"
)

const DrainJobID = "backup-hold-drain"

var bindOnce sync.Map // app → struct{}

// BindDeleteHold makes every storage delete honour a backup's delete hold. A
// delete under a valid hold is journaled instead of run; DrainHeldDeletes runs
// it later. Bound once per app, before any filesystem is created, because a
// filesystem attaches the hook only when a handler exists.
func BindDeleteHold(app core.App) {
	if _, loaded := bindOnce.LoadOrStore(app, struct{}{}); loaded {
		return
	}
	core.OnFilesystemDelete(app).BindFunc(func(e *core.FilesystemDeleteEvent) error {
		if !hold.Active(app.DataDir(), time.Now()) {
			return e.Next()
		}
		if err := hold.Journal(app.DataDir(), e.FileKey); err != nil {
			// A delete that cannot be journaled must not be lost: run it. The
			// backup may then miss this file, which is the lesser failure.
			log.Error("could not journal a held delete; deleting now", "err", err)
			return e.Next()
		}
		return nil
	})
}

// DrainHeldDeletes runs the journal once no valid hold exists. It is called by
// a cron job every minute and at boot.
func DrainHeldDeletes(app core.App) {
	now := time.Now()
	if st, removed, err := hold.RemoveStale(app.DataDir(), now); err != nil {
		log.Warn("could not read the backup delete hold", "err", err)
	} else if removed {
		log.Warn("a backup delete hold expired without being released", "holder", st.Holder, "expired", st.Expires)
	}
	fs, err := app.NewFilesystem()
	if err != nil {
		log.Error("could not open storage to drain held deletes", "err", err)
		return
	}
	defer fs.Close()
	n, err := hold.Drain(app.DataDir(), now, func(key string) error {
		if err := fs.Delete(key); err != nil && !errors.Is(err, filesystem.ErrNotFound) {
			return err
		}
		return nil
	})
	if err != nil {
		log.Error("could not drain held storage deletes", "done", n, "err", err)
	}
}
```

- [ ] **Step 4: Wire into boot**

In `coreserver/backup_api.go` `RegisterBackupBoot`, bind before `OnBootstrap` and add the drain after bootstrap and as a cron job:

```go
	backup.BindDeleteHold(app)
```

Inside the bootstrap handler, after `backup.MarkInterrupted(...)`:

```go
		backup.DrainHeldDeletes(app)
		app.Cron().MustAdd(backup.DrainJobID, "* * * * *", func() { backup.DrainHeldDeletes(app) })
```

(Not for a boot probe: the probe branch returns before this.)

- [ ] **Step 5: Run to verify**

Run: `cd core/server && go test ./backup ./coreserver`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/holdhook*.go core/server/coreserver/backup_api.go
git commit -m "feat(backup): journal storage deletes under a backup hold"
```

---

### Task 4: PocketBase-free snapshot (`backup/snapshot`)

**Files:**
- Create: `core/server/backup/snapshot/snapshot.go`
- Create: `core/server/backup/snapshot/manifest.go`
- Test: `core/server/backup/snapshot/snapshot_test.go`

**Interfaces:**
- Consumes: `hold.Acquire` (Task 2), `format.Manifest`.
- Produces (package `tinycld.org/core/backup/snapshot`):

```go
type StoredFile struct {
	Key  string
	Size int64
	Open func() (io.ReadCloser, error)
}

type Snapshot struct {
	Manifest format.Manifest
	DBPath   string
	Files    []StoredFile
	Release  func() error // removes the DB copy, closes the lister, releases the hold; idempotent
}

type Options struct {
	DataDir  string                                       // pb_data
	TmpDir   string                                       // DB copy goes here (created 0700)
	Holder   string                                       // hold owner
	Kind     string
	Source   string
	Instance string
	Vacuum   func(dest string) error                      // nil ⇒ own read-only connection
	Files    func() ([]StoredFile, func() error, error)   // nil ⇒ walk DataDir/storage
	Now      func() time.Time
}

var ErrS3Storage error

func FromDataDir(opts Options) (*Snapshot, error)
func VacuumReadOnly(src, dest string) error // the default Vacuum; exported for callers that wrap it
```

- [ ] **Step 1: Write the failing tests**

```go
package snapshot

import (
	"database/sql"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"tinycld.org/core/backup/hold"
)

// fixture builds a pb_data with a real SQLite DB carrying the two tables the
// manifest reads, one user collection with rows, and one stored file.
func fixture(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "pb_data")
	if err := os.MkdirAll(filepath.Join(dir, "storage", "c1", "r1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "storage", "c1", "r1", "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "data.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, q := range []string{
		"PRAGMA journal_mode=WAL",
		"CREATE TABLE _collections (id TEXT, name TEXT, system BOOLEAN)",
		"CREATE TABLE _params (id TEXT, value TEXT)",
		"INSERT INTO _collections VALUES ('1','notes',0),('2','_superusers',1),('3','pkg_registry',0)",
		"CREATE TABLE notes (id TEXT)",
		"INSERT INTO notes VALUES ('a'),('b'),('c')",
		"CREATE TABLE pkg_registry (slug TEXT, version TEXT, npm_package TEXT, status TEXT)",
		"INSERT INTO pkg_registry VALUES ('core','1.2.3','tinycld@1.2.3','bundled'),('widgets','1.0.0','@x/widgets@1.0.0','installed'),('gone','0.1.0','@x/gone@0.1.0','available')",
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	return dir
}

func TestFromDataDirBuildsManifestFromTheCopy(t *testing.T) {
	dir := fixture(t)
	s, err := FromDataDir(Options{DataDir: dir, TmpDir: t.TempDir(), Holder: "test", Kind: "scheduled", Source: "docker", Instance: "https://acme.example"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Release()
	m := s.Manifest
	if m.Core != "1.2.3" || m.Lockfile["tinycld"] != "tinycld@1.2.3" {
		t.Fatalf("core = %q lockfile = %v", m.Core, m.Lockfile)
	}
	if m.Packages["widgets"] != "1.0.0" || m.Packages["gone"] != "" {
		t.Fatalf("packages = %v", m.Packages)
	}
	if m.Counts.Collections["notes"] != 3 {
		t.Fatalf("counts = %v", m.Counts.Collections)
	}
	if _, ok := m.Counts.Collections["_superusers"]; ok {
		t.Fatal("system collection counted")
	}
	if m.Counts.Files != 1 || m.Counts.Bytes != 5 || len(s.Files) != 1 || s.Files[0].Key != "c1/r1/a.txt" {
		t.Fatalf("files = %+v counts = %+v", s.Files, m.Counts)
	}
	r, err := s.Files[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(r)
	r.Close()
	if string(body) != "hello" {
		t.Fatalf("body = %q", body)
	}
}

func TestFromDataDirHoldsDeletesUntilRelease(t *testing.T) {
	dir := fixture(t)
	s, err := FromDataDir(Options{DataDir: dir, TmpDir: t.TempDir(), Holder: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if st, ok, _ := hold.Read(dir); !ok || st.Holder != "test" {
		t.Fatal("no hold while the snapshot is open")
	}
	db := s.DBPath
	if err := s.Release(); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := hold.Read(dir); ok {
		t.Fatal("hold survived Release")
	}
	if _, err := os.Stat(db); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("DB copy survived Release")
	}
	if err := s.Release(); err != nil {
		t.Fatalf("second Release: %v", err)
	}
}

func TestFromDataDirRefusesWhileAnotherHolderHolds(t *testing.T) {
	dir := fixture(t)
	h, _ := hold.Acquire(dir, "other", nil)
	defer h.Release()
	if _, err := FromDataDir(Options{DataDir: dir, TmpDir: t.TempDir(), Holder: "test"}); !errors.Is(err, hold.ErrHeld) {
		t.Fatalf("err = %v", err)
	}
}

func TestFromDataDirRefusesS3StorageWithoutALister(t *testing.T) {
	dir := fixture(t)
	db, _ := sql.Open("sqlite", filepath.Join(dir, "data.db"))
	_, _ = db.Exec(`INSERT INTO _params VALUES ('settings','{"s3":{"enabled":true}}')`)
	db.Close()
	if _, err := FromDataDir(Options{DataDir: dir, TmpDir: t.TempDir(), Holder: "test"}); !errors.Is(err, ErrS3Storage) {
		t.Fatalf("err = %v", err)
	}
	if _, ok, _ := hold.Read(dir); ok {
		t.Fatal("a refused snapshot left its hold")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd core/server && go test ./backup/snapshot/`
Expected: FAIL — undefined names.

- [ ] **Step 3: Implement `manifest.go`**

```go
package snapshot

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"tinycld.org/core/backup/format"
)

var ErrS3Storage = errors.New("backup: storage is on S3; a snapshot from outside the app cannot read it")

// fillManifest reads the package set and row counts from the DB COPY, so they
// describe exactly the data the snapshot holds.
func fillManifest(db *sql.DB, m *format.Manifest) error {
	rows, err := db.Query("SELECT slug, version, npm_package FROM pkg_registry WHERE status IN ('installed','bundled') ORDER BY slug")
	if err != nil {
		return fmt.Errorf("backup: read the package registry: %w", err)
	}
	for rows.Next() {
		var slug, version, spec string
		if err := rows.Scan(&slug, &version, &spec); err != nil {
			rows.Close()
			return err
		}
		if slug == "core" {
			m.Core = version
			m.Lockfile["tinycld"] = spec
			continue
		}
		m.Lockfile[slug] = spec
		m.Packages[slug] = version
	}
	if err := rows.Close(); err != nil {
		return err
	}

	names, err := db.Query("SELECT name FROM _collections WHERE system = 0 ORDER BY name")
	if err != nil {
		return fmt.Errorf("backup: list collections: %w", err)
	}
	var cols []string
	for names.Next() {
		var n string
		if err := names.Scan(&n); err != nil {
			names.Close()
			return err
		}
		cols = append(cols, n)
	}
	if err := names.Close(); err != nil {
		return err
	}
	for _, name := range cols {
		if strings.Contains(name, "`") {
			continue
		}
		var n int
		// A collection name is an identifier, not a parameter, so it is quoted
		// rather than bound.
		if err := db.QueryRow("SELECT count(*) FROM `" + name + "`").Scan(&n); err != nil {
			continue // a view that fails to count is not a reason to fail a backup
		}
		m.Counts.Collections[name] = n
	}
	return nil
}

// usesS3 reports whether the app's settings enable S3 storage. Settings that
// are encrypted (PB_ENCRYPTION) cannot be read here and count as local.
func usesS3(db *sql.DB) bool {
	var raw string
	if err := db.QueryRow("SELECT value FROM _params WHERE id = 'settings'").Scan(&raw); err != nil {
		return false
	}
	var s struct {
		S3 struct {
			Enabled bool `json:"enabled"`
		} `json:"s3"`
	}
	if json.Unmarshal([]byte(raw), &s) != nil {
		return false
	}
	return s.S3.Enabled
}
```

- [ ] **Step 4: Implement `snapshot.go`**

```go
// Package snapshot takes a consistent copy of one pb_data directory: the
// database through VACUUM INTO, the list of stored files, and a manifest read
// from the copy. It has no PocketBase import, so a process that is not the
// app can back up an app's data directory.
//
// A delete hold is held from before the copy until Release, so every file the
// copy refers to still exists when a repository reads it.
package snapshot

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"tinycld.org/core/backup/format"
	"tinycld.org/core/backup/hold"
)

type StoredFile struct {
	Key  string
	Size int64
	Open func() (io.ReadCloser, error)
}

type Snapshot struct {
	Manifest format.Manifest
	DBPath   string
	Files    []StoredFile
	Release  func() error
}

type Options struct {
	DataDir  string
	TmpDir   string
	Holder   string
	Kind     string
	Source   string
	Instance string
	Vacuum   func(dest string) error
	Files    func() ([]StoredFile, func() error, error)
	Now      func() time.Time
}

func FromDataDir(opts Options) (snap *Snapshot, err error) {
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	h, err := hold.Acquire(opts.DataDir, opts.Holder, now)
	if err != nil {
		return nil, err
	}
	var cleanups []func() error
	release := func() error {
		var errs []error
		for i := len(cleanups) - 1; i >= 0; i-- {
			errs = append(errs, cleanups[i]())
		}
		errs = append(errs, h.Release())
		return errors.Join(errs...)
	}
	defer func() {
		if err != nil {
			_ = release()
		}
	}()

	if err = os.MkdirAll(opts.TmpDir, 0o700); err != nil {
		return nil, err
	}
	dest := filepath.Join(opts.TmpDir, randomName()+".db")
	cleanups = append(cleanups, func() error {
		if rerr := os.Remove(dest); rerr != nil && !errors.Is(rerr, os.ErrNotExist) {
			return rerr
		}
		return nil
	})
	vacuum := opts.Vacuum
	if vacuum == nil {
		vacuum = func(d string) error { return VacuumReadOnly(filepath.Join(opts.DataDir, "data.db"), d) }
	}
	if err = vacuum(dest); err != nil {
		return nil, err
	}

	m := format.Manifest{
		Format:   format.FormatV1,
		Created:  now().UTC(),
		Instance: opts.Instance,
		Source:   opts.Source,
		Kind:     opts.Kind,
		Lockfile: format.Lockfile{},
		Packages: map[string]string{},
		Counts:   format.Counts{Collections: map[string]int{}},
	}
	db, err := sql.Open("sqlite", "file:"+dest+"?mode=ro")
	if err != nil {
		return nil, err
	}
	s3 := usesS3(db)
	err = fillManifest(db, &m)
	if cerr := db.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return nil, err
	}

	lister := opts.Files
	if lister == nil {
		if s3 {
			return nil, ErrS3Storage
		}
		lister = func() ([]StoredFile, func() error, error) { return walkLocal(filepath.Join(opts.DataDir, "storage")) }
	}
	files, closeFiles, err := lister()
	if err != nil {
		return nil, err
	}
	if closeFiles != nil {
		cleanups = append(cleanups, closeFiles)
	}
	m.Counts.Files = len(files)
	for _, f := range files {
		m.Counts.Bytes += f.Size
	}

	var once sync.Once
	var releaseErr error
	return &Snapshot{
		Manifest: m,
		DBPath:   dest,
		Files:    files,
		Release: func() error {
			once.Do(func() { releaseErr = release() })
			return releaseErr
		},
	}, nil
}

// VacuumReadOnly copies a live database from another process through a
// read-only connection. SQLite may still create the -shm file when it is
// missing (the app is not running), owned by this process's user; a caller
// that runs as a different user than the app must stop the app from starting
// during the call and fix ownership before the app next starts.
func VacuumReadOnly(src, dest string) error {
	if strings.Contains(dest, "'") {
		return errors.New("backup: snapshot path must not contain a quote")
	}
	db, err := sql.Open("sqlite", "file:"+src+"?mode=ro&_pragma=busy_timeout(10000)")
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec("VACUUM INTO '" + dest + "'")
	return err
}

func walkLocal(root string) ([]StoredFile, func() error, error) {
	var out []StoredFile
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) && path == root {
			return filepath.SkipDir
		}
		if err != nil || d.IsDir() || !d.Type().IsRegular() {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		p := path
		out = append(out, StoredFile{
			Key:  filepath.ToSlash(rel),
			Size: info.Size(),
			Open: func() (io.ReadCloser, error) { return os.Open(p) },
		})
		return nil
	})
	return out, nil, err
}

func randomName() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd core/server && go test -race ./backup/snapshot/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/snapshot
git commit -m "feat(backup): PocketBase-free snapshot of a pb_data directory"
```

---

### Task 5: The `Repository` interface and its contract suite

**Files:**
- Create: `core/server/backup/repo/repo.go`
- Create: `core/server/backup/repo/repotest/repotest.go`
- Test: `core/server/backup/repo/repo_test.go`

**Interfaces:**
- Consumes: `snapshot.Snapshot`, `snapshot.StoredFile` (Task 4).
- Produces (package `tinycld.org/core/backup/repo`):

```go
type Ref string
type PutResult struct { Ref Ref; Bytes, UploadedBytes int64; Sha256 string }
type SnapshotInfo struct { Ref Ref; Created time.Time; Bytes int64 }
type Repository interface {
	Kind() string
	Put(ctx context.Context, s *snapshot.Snapshot, progress func(sent int64)) (PutResult, error)
	Manifest(ctx context.Context, ref Ref) (format.Manifest, error)
	Fetch(ctx context.Context, ref Ref, dir string) error // writes dir/data.db and dir/storage/<key>
	List(ctx context.Context) ([]SnapshotInfo, error)
}
type Opener func(cfg json.RawMessage) (Repository, error)
var ErrNotSupported, ErrUnknownKind error
func Register(kind string, open Opener)
func Open(kind string, cfg json.RawMessage) (Repository, error)
func Kinds() []string
func ResetForTesting()
```

- Produces (package `tinycld.org/core/backup/repo/repotest`):

```go
type Options struct{ Dedup bool } // Dedup: a second Put of the same data uploads less
func Run(t *testing.T, open func(t *testing.T) repo.Repository, opts Options)
func Fixture(t *testing.T) *snapshot.Snapshot // a snapshot with a fake data.db and two stored files
```

- [ ] **Step 1: Write the failing registry test**

```go
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"tinycld.org/core/backup/format"
	"tinycld.org/core/backup/snapshot"
)

type stub struct{}

func (stub) Kind() string { return "stub" }
func (stub) Put(context.Context, *snapshot.Snapshot, func(int64)) (PutResult, error) {
	return PutResult{}, nil
}
func (stub) Manifest(context.Context, Ref) (format.Manifest, error) { return format.Manifest{}, nil }
func (stub) Fetch(context.Context, Ref, string) error                { return nil }
func (stub) List(context.Context) ([]SnapshotInfo, error)            { return nil, ErrNotSupported }

func TestRegisterAndOpen(t *testing.T) {
	t.Cleanup(ResetForTesting)
	Register("stub", func(json.RawMessage) (Repository, error) { return stub{}, nil })
	r, err := Open("stub", nil)
	if err != nil || r.Kind() != "stub" {
		t.Fatalf("open: %v %v", r, err)
	}
	if _, err := Open("nope", nil); !errors.Is(err, ErrUnknownKind) {
		t.Fatalf("err = %v", err)
	}
	if got := Kinds(); len(got) != 1 || got[0] != "stub" {
		t.Fatalf("kinds = %v", got)
	}
}

func TestRegisterTwicePanics(t *testing.T) {
	t.Cleanup(ResetForTesting)
	Register("stub", func(json.RawMessage) (Repository, error) { return stub{}, nil })
	defer func() {
		if recover() == nil {
			t.Fatal("no panic on duplicate kind")
		}
	}()
	Register("stub", func(json.RawMessage) (Repository, error) { return stub{}, nil })
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd core/server && go test ./backup/repo/`
Expected: FAIL.

- [ ] **Step 3: Implement `repo.go`**

```go
// Package repo is where a backup goes. The engine produces a snapshot; a
// Repository stores it and reads it back. The tar/age archive is one
// Repository, and a deduplicating store (PBS) is another.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"tinycld.org/core/backup/format"
	"tinycld.org/core/backup/snapshot"
)

type Ref string

type PutResult struct {
	Ref           Ref
	Bytes         int64
	UploadedBytes int64
	Sha256        string
}

type SnapshotInfo struct {
	Ref     Ref       `json:"ref"`
	Created time.Time `json:"created"`
	Bytes   int64     `json:"bytes"`
}

type Repository interface {
	Kind() string
	Put(ctx context.Context, s *snapshot.Snapshot, progress func(sent int64)) (PutResult, error)
	Manifest(ctx context.Context, ref Ref) (format.Manifest, error)
	Fetch(ctx context.Context, ref Ref, dir string) error
	List(ctx context.Context) ([]SnapshotInfo, error)
}

type Opener func(cfg json.RawMessage) (Repository, error)

var (
	ErrNotSupported = errors.New("backup: this repository cannot do that")
	ErrUnknownKind  = errors.New("backup: unknown repository kind")
)

var (
	mu      sync.RWMutex
	openers = map[string]Opener{}
)

func Register(kind string, open Opener) {
	mu.Lock()
	defer mu.Unlock()
	if _, dup := openers[kind]; dup {
		panic("backup: repository kind registered twice: " + kind)
	}
	openers[kind] = open
}

func Open(kind string, cfg json.RawMessage) (Repository, error) {
	mu.RLock()
	open, ok := openers[kind]
	mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownKind, kind)
	}
	return open(cfg)
}

func Kinds() []string {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]string, 0, len(openers))
	for k := range openers {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func ResetForTesting() {
	mu.Lock()
	openers = map[string]Opener{}
	mu.Unlock()
}
```

- [ ] **Step 4: Implement `repotest/repotest.go`**

```go
// Package repotest is the contract every Repository must meet.
package repotest

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"tinycld.org/core/backup/format"
	"tinycld.org/core/backup/repo"
	"tinycld.org/core/backup/snapshot"
)

type Options struct{ Dedup bool }

var bulk = func() []byte {
	b := make([]byte, 3<<20)
	_, _ = rand.Read(b)
	return b
}()

// Fixture is a snapshot a repository treats as bytes: data.db need not be a
// real database at this layer.
func Fixture(t *testing.T) *snapshot.Snapshot {
	t.Helper()
	dir := t.TempDir()
	db := filepath.Join(dir, "data.db")
	if err := os.WriteFile(db, append([]byte("SQLite format 3\x00"), bulk[:4096]...), 0o600); err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{"c1/r1/a.txt": []byte("hello"), "c1/r2/bulk.bin": bulk}
	var stored []snapshot.StoredFile
	var total int64
	for _, key := range []string{"c1/r1/a.txt", "c1/r2/bulk.bin"} {
		body := files[key]
		stored = append(stored, snapshot.StoredFile{
			Key: key, Size: int64(len(body)),
			Open: func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil },
		})
		total += int64(len(body))
	}
	return &snapshot.Snapshot{
		Manifest: format.Manifest{
			Format: format.FormatV1, Created: time.Now().UTC().Truncate(time.Second),
			Instance: "https://acme.example", Source: "docker", Kind: "scheduled", Core: "1.2.3",
			Lockfile: format.Lockfile{"tinycld": "tinycld@1.2.3"}, Packages: map[string]string{},
			Counts: format.Counts{Collections: map[string]int{"notes": 3}, Files: 2, Bytes: total},
		},
		DBPath:  db,
		Files:   stored,
		Release: func() error { return nil },
	}
}

func Run(t *testing.T, open func(t *testing.T) repo.Repository, opts Options) {
	ctx := context.Background()

	t.Run("round trip", func(t *testing.T) {
		r := open(t)
		snap := Fixture(t)
		var sent int64
		res, err := r.Put(ctx, snap, func(n int64) { sent = n })
		if err != nil {
			t.Fatal(err)
		}
		if res.Ref == "" || res.Bytes <= 0 || sent <= 0 {
			t.Fatalf("result = %+v sent = %d", res, sent)
		}
		m, err := r.Manifest(ctx, res.Ref)
		if err != nil {
			t.Fatal(err)
		}
		if !m.Created.Equal(snap.Manifest.Created) || m.Core != "1.2.3" || m.Counts.Collections["notes"] != 3 {
			t.Fatalf("manifest = %+v", m)
		}
		dir := t.TempDir()
		if err := r.Fetch(ctx, res.Ref, dir); err != nil {
			t.Fatal(err)
		}
		wantDB, _ := os.ReadFile(snap.DBPath)
		gotDB, _ := os.ReadFile(filepath.Join(dir, "data.db"))
		if !bytes.Equal(wantDB, gotDB) {
			t.Fatal("data.db differs after fetch")
		}
		for _, f := range snap.Files {
			rc, _ := f.Open()
			want, _ := io.ReadAll(rc)
			rc.Close()
			got, err := os.ReadFile(filepath.Join(dir, "storage", filepath.FromSlash(f.Key)))
			if err != nil || !bytes.Equal(want, got) {
				t.Fatalf("%s differs after fetch: %v", f.Key, err)
			}
		}
	})

	t.Run("list", func(t *testing.T) {
		r := open(t)
		res, err := r.Put(ctx, Fixture(t), nil)
		if err != nil {
			t.Fatal(err)
		}
		list, err := r.List(ctx)
		if errors.Is(err, repo.ErrNotSupported) {
			t.Skip("repository does not list")
		}
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range list {
			if s.Ref == res.Ref {
				return
			}
		}
		t.Fatalf("ref %s not in %v", res.Ref, list)
	})

	t.Run("dedup", func(t *testing.T) {
		if !opts.Dedup {
			t.Skip("repository does not deduplicate")
		}
		r := open(t)
		first, err := r.Put(ctx, Fixture(t), nil)
		if err != nil {
			t.Fatal(err)
		}
		_ = first
		second := Fixture(t)
		// Two snapshots in one group need distinct second-precision times.
		second.Manifest.Created = time.Now().UTC().Truncate(time.Second).Add(2 * time.Second)
		res, err := r.Put(ctx, second, nil)
		if err != nil {
			t.Fatal(err)
		}
		if res.UploadedBytes >= res.Bytes/2 {
			t.Fatalf("second put uploaded %d of %d bytes", res.UploadedBytes, res.Bytes)
		}
	})
}
```

- [ ] **Step 5: Run to verify**

Run: `cd core/server && go test ./backup/repo/... && go vet ./backup/repo/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/repo
git commit -m "feat(backup): Repository interface, registry and contract suite"
```

---

### Task 6: The `arm` package (restore staging shared by every caller)

**Files:**
- Create: `core/server/backup/arm/arm.go`
- Test: `core/server/backup/arm/arm_test.go`
- Modify: `core/server/backup/paths.go` (`armed`, `stagedSentinel`)
- Modify: `core/server/backup/restore.go` (use `arm.IntegrityCheck`, `arm.WriteMember`; delete the moved functions)

**Interfaces:**
- Consumes: `format.Manifest`.
- Produces (package `tinycld.org/core/backup/arm`):

```go
const StagedSentinel = ".staged"
type Marker struct {
	ID       string          `json:"id"`
	Pending  string          `json:"pending"`
	Pre      string          `json:"pre"`
	Manifest format.Manifest `json:"manifest"`
}
func Dir(dataDir string) string                    // <parent of pb_data>/restore
func PendingDir(restoreDir, id string) string      // <restoreDir>/pending/<id>
func MarkerPath(restoreDir string) string          // <restoreDir>/armed
func WriteMarker(restoreDir string, m Marker) error
func IntegrityCheck(dbPath string) error
func CheckCounts(dbPath string, want format.Manifest) error
func MarkStaged(pending string, counts *format.Manifest) error
func Arm(restoreDir string, m Marker) error        // MarkStaged(m.Pending, &m.Manifest) then WriteMarker
func WriteMember(target string, body io.Reader) error
func ExtractTar(r io.Reader, dir string) error     // regular files only; refuses escapes
```

- [ ] **Step 1: Write the failing tests**

```go
package arm

import (
	"archive/tar"
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"tinycld.org/core/backup/format"
)

func stagedDB(t *testing.T, pending string, rows int) {
	t.Helper()
	if err := os.MkdirAll(pending, 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(pending, "data.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE notes (id TEXT)"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < rows; i++ {
		if _, err := db.Exec("INSERT INTO notes VALUES ('x')"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestArmWritesSentinelThenMarker(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "pb_data")
	rd := Dir(dataDir)
	pending := PendingDir(rd, "job1")
	stagedDB(t, pending, 2)
	m := Marker{ID: "job1", Pending: pending, Manifest: format.Manifest{Counts: format.Counts{Collections: map[string]int{"notes": 2}}}}
	if err := Arm(rd, m); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(pending, StagedSentinel)); err != nil {
		t.Fatal("no sentinel")
	}
	raw, err := os.ReadFile(MarkerPath(rd))
	if err != nil {
		t.Fatal(err)
	}
	var got Marker
	if err := json.Unmarshal(raw, &got); err != nil || got.ID != "job1" {
		t.Fatalf("marker = %s", raw)
	}
	if rd != filepath.Join(root, "restore") {
		t.Fatalf("Dir = %s", rd)
	}
}

func TestArmRefusesWrongCounts(t *testing.T) {
	rd := Dir(filepath.Join(t.TempDir(), "pb_data"))
	pending := PendingDir(rd, "job1")
	stagedDB(t, pending, 1)
	m := Marker{ID: "job1", Pending: pending, Manifest: format.Manifest{Counts: format.Counts{Collections: map[string]int{"notes": 2}}}}
	if err := Arm(rd, m); err == nil {
		t.Fatal("armed a DB whose counts disagree with its manifest")
	}
	if _, err := os.Stat(MarkerPath(rd)); !os.IsNotExist(err) {
		t.Fatal("marker written after a failed check")
	}
}

func TestExtractTarRefusesEscapesAndLinks(t *testing.T) {
	for name, hdr := range map[string]*tar.Header{
		"escape":  {Name: "../x", Mode: 0o644, Size: 1, Typeflag: tar.TypeReg},
		"symlink": {Name: "a", Linkname: "/etc/passwd", Typeflag: tar.TypeSymlink},
	} {
		var buf bytes.Buffer
		tw := tar.NewWriter(&buf)
		_ = tw.WriteHeader(hdr)
		if hdr.Size > 0 {
			_, _ = tw.Write([]byte("x"))
		}
		_ = tw.Close()
		if err := ExtractTar(&buf, t.TempDir()); err == nil {
			t.Fatalf("%s: extracted", name)
		}
	}
}

func TestExtractTarWritesFiles(t *testing.T) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	_ = tw.WriteHeader(&tar.Header{Name: "c1/r1/a.txt", Mode: 0o644, Size: 5, Typeflag: tar.TypeReg})
	_, _ = tw.Write([]byte("hello"))
	_ = tw.Close()
	dir := t.TempDir()
	if err := ExtractTar(&buf, dir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "c1", "r1", "a.txt"))
	if err != nil || string(got) != "hello" {
		t.Fatalf("%q %v", got, err)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd core/server && go test ./backup/arm/`
Expected: FAIL.

- [ ] **Step 3: Implement `arm.go`**

Move `integrityCheck` and `writeMember` from `restore.go` verbatim (renamed `IntegrityCheck`, `WriteMember`; replace `log.Warn` close errors with ignored `_ =` since this package does not log). Add:

```go
// Package arm stages a restore for the boot swap. Its files are the contract
// between whoever stages a restore (the app itself, or another process that
// stopped the app) and the boot swap that applies it.
package arm

import (
	"archive/tar"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"

	"tinycld.org/core/backup/format"
)

const StagedSentinel = ".staged"

type Marker struct {
	ID       string          `json:"id"`
	Pending  string          `json:"pending"`
	Pre      string          `json:"pre"`
	Manifest format.Manifest `json:"manifest"`
}

func Dir(dataDir string) string                { return filepath.Join(filepath.Dir(dataDir), "restore") }
func PendingDir(restoreDir, id string) string  { return filepath.Join(restoreDir, "pending", id) }
func MarkerPath(restoreDir string) string      { return filepath.Join(restoreDir, "armed") }

func WriteMarker(restoreDir string, m Marker) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(restoreDir, 0o700); err != nil {
		return err
	}
	tmp := MarkerPath(restoreDir) + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, MarkerPath(restoreDir))
}

// CheckCounts compares each collection's rows in the staged DB with the
// manifest. Only a manifest whose counts were read from the same DB copy may
// be checked this way.
func CheckCounts(dbPath string, want format.Manifest) error {
	db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	for name, n := range want.Counts.Collections {
		if strings.Contains(name, "`") {
			continue
		}
		var got int
		if err := db.QueryRow("SELECT count(*) FROM `" + name + "`").Scan(&got); err != nil {
			return fmt.Errorf("backup: count %s in the staged database: %w", name, err)
		}
		if got != n {
			return fmt.Errorf("backup: the staged database has %d rows in %s, the manifest says %d", got, name, n)
		}
	}
	return nil
}

// MarkStaged checks the staged DB and then writes the sentinel the boot swap
// trusts. counts is nil when the manifest's counts cannot be compared exactly.
func MarkStaged(pending string, counts *format.Manifest) error {
	db := filepath.Join(pending, format.MemberDB)
	if err := IntegrityCheck(db); err != nil {
		return err
	}
	if counts != nil {
		if err := CheckCounts(db, *counts); err != nil {
			return err
		}
	}
	return os.WriteFile(filepath.Join(pending, StagedSentinel), nil, 0o644)
}

func Arm(restoreDir string, m Marker) error {
	if err := MarkStaged(m.Pending, &m.Manifest); err != nil {
		return err
	}
	return WriteMarker(restoreDir, m)
}

// ExtractTar writes a tar stream of stored files into dir. Only regular files
// are accepted, and no name may leave dir.
func ExtractTar(r io.Reader, dir string) error {
	tr := tar.NewReader(r)
	clean := filepath.Clean(dir)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if hdr.Typeflag != tar.TypeReg {
			return fmt.Errorf("%w: member %q is not a regular file", format.ErrFormat, hdr.Name)
		}
		target := filepath.Join(clean, filepath.FromSlash(hdr.Name))
		if !strings.HasPrefix(target, clean+string(os.PathSeparator)) {
			return fmt.Errorf("%w: member %q escapes the staging directory", format.ErrFormat, hdr.Name)
		}
		if err := WriteMember(target, tr); err != nil {
			return err
		}
	}
}
```

- [ ] **Step 4: Point the engine at `arm`**

In `backup/paths.go` replace the `armed` struct and `stagedSentinel` const with:

```go
// armed is the on-disk marker; arm owns its format so a restore staged by
// another process is read the same way.
type armed = arm.Marker

const stagedSentinel = arm.StagedSentinel
```

In `restore.go`: delete `integrityCheck` and `writeMember`; call `arm.IntegrityCheck(...)` and `arm.WriteMember(...)`. Replace the marker write in phase 4 with `arm.WriteMarker(restoreDir(app), armed{...})`.

- [ ] **Step 5: Run to verify**

Run: `cd core/server && go test ./backup/...`
Expected: PASS (all existing restore and boot-swap tests still pass — the JSON field names did not change).

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/arm core/server/backup/paths.go core/server/backup/restore.go
git commit -m "refactor(backup): restore staging moves to the arm package"
```

---

### Task 7: The `archive` repository

**Files:**
- Create: `core/server/backup/archive/archive.go`
- Create: `core/server/backup/archive/stage.go` (moved `stage` from `restore.go`)
- Test: `core/server/backup/archive/archive_test.go`
- Modify: `core/server/backup/restore.go` (call `archive.Stage`)

**Interfaces:**
- Consumes: `repo.Repository`, `repotest.Run` (Task 5), `arm.WriteMember` (Task 6), `format.*`.
- Produces (package `tinycld.org/core/backup/archive`):

```go
const Kind = "archive"
type Repository struct {
	Recipient age.Recipient                                                    // Put
	Identity  age.Identity                                                     // Manifest, Fetch
	Target    func(ctx context.Context, created time.Time) (io.WriteCloser, repo.Ref, error) // Put
	Open      func(ctx context.Context, ref repo.Ref) (io.ReadCloser, error)   // Manifest, Fetch
	Level     zstd.EncoderLevel                                                // 0 ⇒ zstd.SpeedDefault
}
func (r *Repository) Kind() string
func (r *Repository) Put(ctx, *snapshot.Snapshot, func(int64)) (repo.PutResult, error)
func (r *Repository) Manifest(ctx, repo.Ref) (format.Manifest, error)
func (r *Repository) Fetch(ctx, repo.Ref, dir string) error
func (r *Repository) List(ctx) ([]repo.SnapshotInfo, error) // repo.ErrNotSupported
func ToSink(sink io.WriteCloser, ref repo.Ref) func(context.Context, time.Time) (io.WriteCloser, repo.Ref, error)
func Stage(r *format.Reader, dir string) error
var WriterClosedForTesting func()
```

- [ ] **Step 1: Write the failing contract test**

```go
package archive

import (
	"bytes"
	"context"
	"io"
	"sync"
	"testing"
	"time"

	"filippo.io/age"
	"github.com/klauspost/compress/zstd"

	"tinycld.org/core/backup/repo"
	"tinycld.org/core/backup/repo/repotest"
)

// memStore keeps each archive in memory by ref.
type memStore struct {
	mu   sync.Mutex
	objs map[repo.Ref]*bytes.Buffer
}

type bufCloser struct{ *bytes.Buffer }

func (bufCloser) Close() error { return nil }

func TestArchiveMeetsTheContract(t *testing.T) {
	repotest.Run(t, func(t *testing.T) repo.Repository {
		id, err := age.GenerateX25519Identity()
		if err != nil {
			t.Fatal(err)
		}
		st := &memStore{objs: map[repo.Ref]*bytes.Buffer{}}
		return &Repository{
			Recipient: id.Recipient(),
			Identity:  id,
			Level:     zstd.SpeedFastest,
			Target: func(_ context.Context, created time.Time) (io.WriteCloser, repo.Ref, error) {
				ref := repo.Ref(created.Format(time.RFC3339Nano))
				buf := &bytes.Buffer{}
				st.mu.Lock()
				st.objs[ref] = buf
				st.mu.Unlock()
				return bufCloser{buf}, ref, nil
			},
			Open: func(_ context.Context, ref repo.Ref) (io.ReadCloser, error) {
				st.mu.Lock()
				defer st.mu.Unlock()
				return io.NopCloser(bytes.NewReader(st.objs[ref].Bytes())), nil
			},
		}
	}, repotest.Options{})
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd core/server && go test ./backup/archive/`
Expected: FAIL.

- [ ] **Step 3: Move `stage` into `stage.go`**

Move `stage` from `restore.go` to `archive/stage.go` as exported `Stage`, unchanged except `writeMember` → `arm.WriteMember`. In `restore.go` phase 5 call `archive.Stage(reader, pending)`.

- [ ] **Step 4: Implement `archive.go`**

```go
// Package archive is the tinycld-backup-v1 archive as a Repository: one
// encrypted, full-copy file per backup, written to a sink and read from a
// stream.
package archive

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"filippo.io/age"
	"github.com/klauspost/compress/zstd"

	"tinycld.org/core/backup/format"
	"tinycld.org/core/backup/repo"
	"tinycld.org/core/backup/snapshot"
)

const Kind = "archive"

type Repository struct {
	Recipient age.Recipient
	Identity  age.Identity
	Target    func(ctx context.Context, created time.Time) (io.WriteCloser, repo.Ref, error)
	Open      func(ctx context.Context, ref repo.Ref) (io.ReadCloser, error)
	Level     zstd.EncoderLevel
}

// WriterClosedForTesting reports that the archive writer was closed.
var WriterClosedForTesting func()

func ToSink(sink io.WriteCloser, ref repo.Ref) func(context.Context, time.Time) (io.WriteCloser, repo.Ref, error) {
	return func(context.Context, time.Time) (io.WriteCloser, repo.Ref, error) { return sink, ref, nil }
}

func (r *Repository) Kind() string { return Kind }

func (r *Repository) Put(ctx context.Context, s *snapshot.Snapshot, progress func(int64)) (res repo.PutResult, err error) {
	sink, ref, err := r.Target(ctx, s.Manifest.Created)
	if err != nil {
		return res, err
	}
	sinkClosed := false
	defer func() {
		if !sinkClosed {
			if cerr := sink.Close(); cerr != nil && err == nil {
				err = cerr
			}
		}
	}()
	level := r.Level
	if level == 0 {
		level = zstd.SpeedDefault
	}
	counter := &countingWriter{w: sink, progress: progress}
	w, err := format.NewWriter(counter, r.Recipient, level)
	if err != nil {
		return res, err
	}
	// The zstd encoder owns goroutines until closed, so an early return still
	// closes the writer; Close is idempotent.
	defer func() {
		cerr := w.Close()
		if WriterClosedForTesting != nil {
			WriterClosedForTesting()
		}
		if cerr != nil && err == nil {
			err = cerr
		}
	}()
	if err = w.WriteManifest(s.Manifest); err != nil {
		return res, err
	}
	if err = writePath(w, format.MemberDB, s.DBPath); err != nil {
		return res, err
	}
	for _, f := range s.Files {
		if err = writeStored(w, f); err != nil {
			return res, err
		}
	}
	if err = w.Close(); err != nil {
		return res, err
	}
	sinkClosed = true
	if err = sink.Close(); err != nil {
		return res, err
	}
	n := counter.total()
	return repo.PutResult{Ref: ref, Bytes: n, UploadedBytes: n, Sha256: w.Sha256()}, nil
}

func writePath(w *format.Writer, name, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	return w.WriteFile(name, fi.Size(), f)
}

func writeStored(w *format.Writer, f snapshot.StoredFile) error {
	r, err := f.Open()
	if err != nil {
		return fmt.Errorf("read %s: %w", f.Key, err)
	}
	defer r.Close()
	return w.WriteFile(format.StoragePrefix+f.Key, f.Size, r)
}

func (r *Repository) Manifest(ctx context.Context, ref repo.Ref) (format.Manifest, error) {
	src, err := r.Open(ctx, ref)
	if err != nil {
		return format.Manifest{}, err
	}
	defer src.Close()
	rd, err := format.NewReader(src, r.Identity)
	if err != nil {
		return format.Manifest{}, err
	}
	defer rd.Close()
	return rd.ReadManifest()
}

func (r *Repository) Fetch(ctx context.Context, ref repo.Ref, dir string) error {
	src, err := r.Open(ctx, ref)
	if err != nil {
		return err
	}
	defer src.Close()
	rd, err := format.NewReader(src, r.Identity)
	if err != nil {
		return err
	}
	defer rd.Close()
	if _, err := rd.ReadManifest(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Clean(dir), 0o755); err != nil {
		return err
	}
	return Stage(rd, dir)
}

func (r *Repository) List(context.Context) ([]repo.SnapshotInfo, error) {
	return nil, repo.ErrNotSupported
}

type countingWriter struct {
	w        io.Writer
	progress func(int64)
	mu       sync.Mutex
	n        int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.mu.Lock()
	c.n += int64(n)
	total := c.n
	c.mu.Unlock()
	if c.progress != nil {
		c.progress(total)
	}
	return n, err
}

func (c *countingWriter) total() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}
```

Remove the `tinycld.org/core/backup/arm` import from `archive.go`; only `stage.go` uses it.

- [ ] **Step 5: Run to verify**

Run: `cd core/server && go test ./backup/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/archive core/server/backup/restore.go
git commit -m "feat(backup): the archive format as a Repository"
```

---

### Task 8: Engine runs through snapshot + repository; ledger fields

**Files:**
- Create: `core/server/pb_migrations/2050000004_backups_repository_fields.js`
- Modify: `core/server/backup/engine.go`, `core/server/backup/ledger.go`, `core/server/backup/testapp_test.go`, `core/server/backup/engine_test.go`

**Interfaces:**
- Consumes: `snapshot.FromDataDir`, `repo.Repository`, `archive.Repository`, `archive.ToSink`, `archive.WriterClosedForTesting`.
- Produces (package `backup`):
  - `Request` gains `Repo repo.Repository`. When `Repo` is nil the engine builds `&archive.Repository{Recipient: req.Recipient, Target: archive.ToSink(req.Sink, "")}`, so every current caller keeps working.
  - Ledger row fields `repository` (text), `ref` (text), `uploaded_bytes` (number).
  - `func FailedRun(app core.App, kind Kind, repository string, cause error) error` — writes a terminal `failed` row and announces it, for a scheduled run that could not open its repository.
  - `func snapshotOptions(app core.App, kind Kind) snapshot.Options`.

- [ ] **Step 1: Migration**

```js
/// <reference path="../pb_data/types.d.ts" />
// Backups can go to a repository (the archive, or a deduplicating store such
// as PBS). The row records which one, the repository's own reference to the
// snapshot, and how many bytes were actually sent — for a deduplicating
// repository that is far less than `bytes`.
migrate(
    app => {
        const col = app.findCollectionByNameOrId('backups')
        col.fields.addAt(col.fields.length, new Field({ id: 'bk_repository', name: 'repository', type: 'text', max: 40 }))
        col.fields.addAt(col.fields.length, new Field({ id: 'bk_ref', name: 'ref', type: 'text', max: 500 }))
        col.fields.addAt(col.fields.length, new Field({ id: 'bk_uploaded_bytes', name: 'uploaded_bytes', type: 'number', min: 0 }))
        app.save(col)
    },
    app => {
        const col = app.findCollectionByNameOrId('backups')
        for (const id of ['bk_repository', 'bk_ref', 'bk_uploaded_bytes']) col.fields.removeById(id)
        app.save(col)
    }
)
```

Add the same three fields to the `backups` collection in `testapp_test.go`:

```go
		&core.TextField{Name: "repository", Max: 40},
		&core.TextField{Name: "ref", Max: 500},
		&core.NumberField{Name: "uploaded_bytes"},
```

- [ ] **Step 2: Write the failing engine test**

Add to `engine_test.go`:

```go
// recordingRepo records the snapshot it was handed.
type recordingRepo struct {
	got  format.Manifest
	keys []string
}

func (r *recordingRepo) Kind() string { return "recording" }
func (r *recordingRepo) Put(_ context.Context, s *snapshot.Snapshot, progress func(int64)) (repo.PutResult, error) {
	r.got = s.Manifest
	for _, f := range s.Files {
		r.keys = append(r.keys, f.Key)
	}
	if progress != nil {
		progress(42)
	}
	return repo.PutResult{Ref: "rec/1", Bytes: 100, UploadedBytes: 7}, nil
}
func (r *recordingRepo) Manifest(context.Context, repo.Ref) (format.Manifest, error) { return r.got, nil }
func (r *recordingRepo) Fetch(context.Context, repo.Ref, string) error              { return nil }
func (r *recordingRepo) List(context.Context) ([]repo.SnapshotInfo, error)          { return nil, nil }

func TestRunHandsTheSnapshotToTheRepository(t *testing.T) {
	app := newTestApp(t)
	r := &recordingRepo{}
	id, err := Run(app, Request{Kind: KindScheduled, Repo: r})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := app.FindRecordById("backups", id)
	if row.GetString("status") != "succeeded" || row.GetString("repository") != "recording" ||
		row.GetString("ref") != "rec/1" || row.GetInt("bytes") != 100 || row.GetInt("uploaded_bytes") != 7 {
		t.Fatalf("row = %v", row.PublicExport())
	}
	if len(r.keys) != 1 || r.keys[0] != "col1/rec1/hello.txt" {
		t.Fatalf("keys = %v", r.keys)
	}
	if r.got.Core != "1.2.3" || r.got.Packages["widgets"] != "1.0.0" {
		t.Fatalf("manifest = %+v", r.got)
	}
}

func TestFailedRunRecordsAFailure(t *testing.T) {
	app := newTestApp(t)
	if err := FailedRun(app, KindScheduled, "pbs", errors.New("no route to host")); err != nil {
		t.Fatal(err)
	}
	rows, _ := app.FindRecordsByFilter("backups", "status = 'failed'", "", 0, 0)
	if len(rows) != 1 || rows[0].GetString("repository") != "pbs" {
		t.Fatalf("rows = %v", rows)
	}
}
```

Update every existing test that reads `writerClosedForTesting` to set `archive.WriterClosedForTesting` instead.

- [ ] **Step 3: Run to verify they fail**

Run: `cd core/server && go test ./backup -run 'TestRunHandsTheSnapshot|TestFailedRun'`
Expected: FAIL.

- [ ] **Step 4: Rewrite `run()`**

Replace `run` in `engine.go` with the version below. The terminal defer keeps its jobs (panic recovery, ledger row, announce, callback); what changed is where the bytes come from and that the repository owns its transport. The one sink the engine still closes is a caller's `Sink` that `Put` never reached — a PUT sink holds a pipe and a goroutine.

```go
func run(app core.App, req Request, row *core.Record, job *installjob.Job) (err error) {
	defer installjob.Release(job)

	r := req.Repo
	if r == nil {
		r = &archive.Repository{Recipient: req.Recipient, Target: archive.ToSink(req.Sink, "")}
	}
	var (
		result   repo.PutResult
		sent     atomic.Int64
		putRan   bool
		manifest *format.Manifest // nil until built: a zero manifest reads as a backup of nothing
	)
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("backup: panic: %v", p)
			log.Error("backup panicked", "id", row.Id, "kind", req.Kind, "panic", p,
				"stack", string(debug.Stack()))
		}
		if !putRan && req.Sink != nil {
			if cerr := req.Sink.Close(); cerr != nil && err == nil {
				err = cerr
			}
		}
		status, errMsg := "succeeded", ""
		if err != nil {
			status, errMsg = "failed", err.Error()
			result.Bytes = sent.Load()
			log.Error("backup failed", "id", row.Id, "kind", req.Kind, "err", err)
		}
		if ferr := finishRow(app, row, status, result, errMsg, manifest, r.Kind()); ferr != nil {
			log.Error("could not finalize backup row", "id", row.Id, "err", ferr)
		}
		announce(app, req, row, status, errMsg)
		postCallback(req.Callback, row)
	}()

	// Refused before the snapshot: a VACUUM INTO that runs out of space leaves
	// a truncated file and a SQLite error an operator cannot act on.
	if err = os.MkdirAll(tmpDir(app), 0o700); err != nil {
		return err
	}
	if err = requireFreeSpace(tmpDir(app), liveDatabaseBytes(app)); err != nil {
		return err
	}
	snap, err := snapshot.FromDataDir(snapshotOptions(app, req.Kind))
	if err != nil {
		return err
	}
	defer func() {
		if rerr := snap.Release(); rerr != nil {
			log.Warn("could not release a backup snapshot", "id", row.Id, "err", rerr)
		}
	}()
	manifest = &snap.Manifest

	progress := newProgress(app, row, sent.Load)
	// stop() runs before the terminal defer, so the ticker cannot save a stale
	// byte count over the final one.
	defer progress.stop()

	putRan = true
	result, err = r.Put(context.Background(), snap, func(n int64) { sent.Store(n) })
	return err
}
```

`newProgress` takes `total func() int64` instead of the counting writer; change its one read to `total()`.

Change `finishRow` in `ledger.go`:

```go
func finishRow(app core.App, r *core.Record, status string, res repo.PutResult, errMsg string, manifest *format.Manifest, repository string) error {
	r.Set("status", status)
	r.Set("finished", types.NowDateTime())
	r.Set("bytes", res.Bytes)
	r.Set("uploaded_bytes", res.UploadedBytes)
	r.Set("sha256", res.Sha256)
	r.Set("ref", string(res.Ref))
	r.Set("repository", repository)
	r.Set("error", truncate(errMsg, 2000))
	if manifest != nil {
		r.Set("manifest", *manifest)
	}
	return app.Save(r)
}
```

Update the restore's failure call to `finishRow(app, row, "failed", repo.PutResult{}, err.Error(), manifest, row.GetString("repository"))`.

Delete from `engine.go`: `countingWriter`, `writeSnapshot`, `writeStored`, `buildManifest`, `writerClosedForTesting` (they now live in `archive` and `snapshot`).

Add `snapshotOptions`:

```go
// snapshotOptions takes the live app's snapshot through its own writer
// connection (see vacuumInto) and its own filesystem, so S3 storage works
// in-process.
func snapshotOptions(app core.App, kind Kind) snapshot.Options {
	return snapshot.Options{
		DataDir:  app.DataDir(),
		TmpDir:   tmpDir(app),
		Holder:   "app",
		Kind:     string(kind),
		Source:   currentSource(),
		Instance: app.Settings().Meta.AppURL,
		Vacuum:   func(dest string) error { return vacuumInto(app, dest) },
		Files:    func() ([]snapshot.StoredFile, func() error, error) { return appFiles(app) },
	}
}

func appFiles(app core.App) ([]snapshot.StoredFile, func() error, error) {
	fs, err := app.NewFilesystem()
	if err != nil {
		return nil, nil, err
	}
	objs, err := fs.List("")
	if err != nil {
		_ = fs.Close()
		return nil, nil, err
	}
	out := make([]snapshot.StoredFile, 0, len(objs))
	for _, o := range objs {
		key := o.Key
		out = append(out, snapshot.StoredFile{
			Key: key, Size: o.Size,
			Open: func() (io.ReadCloser, error) { return fs.GetReader(key) },
		})
	}
	return out, fs.Close, nil
}
```

Add `FailedRun` to `ledger.go`:

```go
// FailedRun records a run that failed before it could start — a scheduled
// backup whose repository could not be opened. Without a row the panel would
// keep saying "last backed up" about an older run and nobody would be told.
func FailedRun(app core.App, kind Kind, repository string, cause error) error {
	row := newRow(app, kind, "", repository)
	row.Set("repository", repository)
	if err := finishRow(app, row, "failed", repo.PutResult{}, cause.Error(), nil, repository); err != nil {
		return err
	}
	announce(app, Request{Kind: kind}, row, "failed", cause.Error())
	return nil
}
```

- [ ] **Step 5: Run the whole backup suite**

Run: `cd core/server && go test -race ./backup/... ./coreserver/...`
Expected: PASS. Fix every existing test that asserted on removed internals by asserting on the ledger row or on `archive` output instead; do not delete a test's intent.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup core/server/pb_migrations/2050000004_backups_repository_fields.js
git commit -m "refactor(backup): runs go through a snapshot and a Repository"
```

---

### Task 9: The `pbs` repository

**Files:**
- Modify: `core/server/go.mod`, `server/go.mod` (and `go.sum`s)
- Create: `core/server/backup/pbs/config.go`
- Create: `core/server/backup/pbs/pbs.go`
- Test: `core/server/backup/pbs/pbs_test.go`

**Interfaces:**
- Consumes: gopbs fork API (see Global Constraints), `repo.*`, `repotest.Run`, `arm.ExtractTar`, `snapshot.Snapshot`.
- Produces (package `tinycld.org/core/backup/pbs`):

```go
const Kind = "pbs"
type Config struct {
	Server      string `json:"server"`      // "host", "host:port" or "https://host:port"
	Fingerprint string `json:"fingerprint"`
	Datastore   string `json:"datastore"`
	Namespace   string `json:"namespace"`
	AuthID      string `json:"auth_id"`
	Secret      string `json:"secret"`
	Key         string `json:"key"`       // PBS key file JSON; "" ⇒ no encryption
	BackupID    string `json:"backup_id"` // set by the caller
}
func ParseConfig(raw json.RawMessage) (Config, error)
func (c Config) Host() string
func Open(raw json.RawMessage) (repo.Repository, error)
func Register()                       // repo.Register(Kind, Open); safe to call more than once
func GenerateKey() (string, error)    // an unprotected PBS key file
```

- [ ] **Step 1: Check the prerequisite**

Run: `cd ~/code/vendor/gopbs && go doc ./pbs Client.StartReader && go doc ./pbstest NewServer && go doc ./pbs BackupSession.UploadStream`
Expected: all three print a signature. If any fails, STOP and report that the gopbs handoff is not done.

- [ ] **Step 2: Add the dependency**

```bash
cd core/server
go get github.com/osshield/gopbs@v0.0.0
go mod edit -replace github.com/osshield/gopbs=github.com/nathanstitt/gopbs@<fork tag, e.g. v0.1.0-tinycld.1>
go mod tidy
cd ../../server
go mod edit -replace github.com/osshield/gopbs=github.com/nathanstitt/gopbs@<same tag>
go mod tidy
```

(A replace in `core/server/go.mod` does not reach the app build, so `server/go.mod` needs its own.)

- [ ] **Step 3: Write the failing tests**

```go
package pbs

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	gopbs "github.com/osshield/gopbs/pbs"
	"github.com/osshield/gopbs/pbstest"

	"tinycld.org/core/backup/repo"
	"tinycld.org/core/backup/repo/repotest"
)

func configFor(t *testing.T, srv *pbstest.Server, key string) json.RawMessage {
	t.Helper()
	c := srv.Config()
	raw, _ := json.Marshal(Config{
		Server: c.BaseURL, Fingerprint: c.Fingerprint, Datastore: c.Datastore,
		AuthID: "test@pbs!test", Secret: "secret", Key: key, BackupID: "acme.example",
	})
	return raw
}

func TestPBSMeetsTheContract(t *testing.T) {
	repotest.Run(t, func(t *testing.T) repo.Repository {
		r, err := Open(configFor(t, pbstest.NewServer(t), ""))
		if err != nil {
			t.Fatal(err)
		}
		return r
	}, repotest.Options{Dedup: true})
}

func TestPBSMeetsTheContractEncrypted(t *testing.T) {
	key, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	repotest.Run(t, func(t *testing.T) repo.Repository {
		r, err := Open(configFor(t, pbstest.NewServer(t), key))
		if err != nil {
			t.Fatal(err)
		}
		return r
	}, repotest.Options{Dedup: true})
}

func TestInterruptedPutLeavesNoSnapshot(t *testing.T) {
	srv := pbstest.NewServer(t)
	r, _ := Open(configFor(t, srv, ""))
	srv.DropAfterBytes(1024)
	if _, err := r.Put(context.Background(), repotest.Fixture(t), nil); err == nil {
		t.Fatal("put succeeded through a dropped connection")
	}
	if n := len(srv.Snapshots()); n != 0 {
		t.Fatalf("%d snapshots kept", n)
	}
}

func TestBadTokenErrorHidesTheSecret(t *testing.T) {
	srv := pbstest.NewServer(t)
	srv.RejectAuth(true)
	r, _ := Open(configFor(t, srv, ""))
	_, err := r.List(context.Background())
	if !errors.Is(err, gopbs.ErrAuth) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("err = %v", err)
	}
}

func TestParseConfigRequiresFields(t *testing.T) {
	for _, raw := range []string{`{}`, `{"server":"pbs.example"}`, `{"server":"pbs.example","datastore":"s","auth_id":"a@pbs!t"}`} {
		if _, err := ParseConfig(json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	c, err := ParseConfig(json.RawMessage(`{"server":"pbs.example","datastore":"s","auth_id":"a@pbs!t","secret":"x","backup_id":"acme"}`))
	if err != nil || c.baseURL() != "https://pbs.example:8007" || c.Host() != "pbs.example" {
		t.Fatalf("%+v %v", c, err)
	}
}
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd core/server && go test ./backup/pbs/`
Expected: FAIL.

- [ ] **Step 5: Implement `config.go`**

```go
package pbs

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"

	gopbs "github.com/osshield/gopbs/pbs"
)

type Config struct {
	Server      string `json:"server"`
	Fingerprint string `json:"fingerprint"`
	Datastore   string `json:"datastore"`
	Namespace   string `json:"namespace"`
	AuthID      string `json:"auth_id"`
	Secret      string `json:"secret"`
	Key         string `json:"key"`
	BackupID    string `json:"backup_id"`
}

func ParseConfig(raw json.RawMessage) (Config, error) {
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, errors.New("backup: the PBS settings are not valid JSON")
	}
	for name, v := range map[string]string{"server": c.Server, "datastore": c.Datastore, "auth_id": c.AuthID, "secret": c.Secret, "backup_id": c.BackupID} {
		if strings.TrimSpace(v) == "" {
			return c, fmt.Errorf("backup: the PBS setting %q is required", name)
		}
	}
	if !strings.Contains(c.AuthID, "!") {
		return c, errors.New("backup: the PBS auth ID must be an API token (user@realm!name)")
	}
	return c, nil
}

// baseURL accepts "host", "host:port" or a full https URL.
func (c Config) baseURL() string {
	s := strings.TrimSuffix(strings.TrimSpace(c.Server), "/")
	if !strings.HasPrefix(s, "https://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return s
	}
	if u.Port() == "" {
		u.Host = net.JoinHostPort(u.Hostname(), "8007")
	}
	return u.Scheme + "://" + u.Host
}

// Host is the only part of the config that may be logged or stored in a row.
func (c Config) Host() string {
	u, err := url.Parse(c.baseURL())
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func (c Config) crypt() (*gopbs.CryptConfig, error) {
	if strings.TrimSpace(c.Key) == "" {
		return nil, nil
	}
	info, err := gopbs.LoadKeyFile([]byte(c.Key), nil)
	if err != nil {
		// The key is never quoted.
		return nil, errors.New("backup: the PBS encryption key could not be read")
	}
	return info.CryptConfig(gopbs.CryptModeEncrypt), nil
}

// GenerateKey returns a new unprotected PBS key file. The admin must keep a
// copy: without it the backups cannot be read.
func GenerateKey() (string, error) {
	key, err := gopbs.GenerateEncryptionKey()
	if err != nil {
		return "", err
	}
	raw, err := gopbs.CreateKeyFile(key, nil, gopbs.KDFNone, "tinycld")
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
```

- [ ] **Step 6: Implement `pbs.go`**

```go
// Package pbs stores backups in a Proxmox Backup Server datastore. Every run
// is a full snapshot; PBS keeps only the chunks it does not already have, so a
// daily backup costs about the size of what changed.
package pbs

import (
	"archive/tar"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gopbs "github.com/osshield/gopbs/pbs"

	"tinycld.org/core/backup/arm"
	"tinycld.org/core/backup/format"
	"tinycld.org/core/backup/repo"
	"tinycld.org/core/backup/snapshot"
)

const (
	Kind         = "pbs"
	backupType   = "host"
	fileManifest = "manifest.blob"
	fileDB       = "data.db"
	fileStorage  = "storage.tar"
)

// Register adds the pbs kind unless it is already there. It checks the
// registry rather than using sync.Once, so a test that resets the registry
// can register it again.
func Register() {
	if !slices.Contains(repo.Kinds(), Kind) {
		repo.Register(Kind, Open)
	}
}

type Repository struct {
	cfg      Config
	client   *gopbs.Client
	progress atomic.Pointer[func(int64)]
	sizes    sync.Map // archive name → uint64 bytes indexed so far
}

func Open(raw json.RawMessage) (repo.Repository, error) {
	cfg, err := ParseConfig(raw)
	if err != nil {
		return nil, err
	}
	crypt, err := cfg.crypt()
	if err != nil {
		return nil, err
	}
	r := &Repository{cfg: cfg}
	client, err := gopbs.NewClient(gopbs.Config{
		BaseURL:     cfg.baseURL(),
		Auth:        gopbs.TokenAuth{AuthID: cfg.AuthID, Secret: cfg.Secret},
		Fingerprint: cfg.Fingerprint,
		Datastore:   cfg.Datastore,
		Namespace:   cfg.Namespace,
		Crypt:       crypt,
		OnUploadProgress: func(name string, st gopbs.UploadStats, _ bool) {
			r.sizes.Store(name, st.Size)
			if fn := r.progress.Load(); fn != nil {
				var total uint64
				r.sizes.Range(func(_, v any) bool { total += v.(uint64); return true })
				(*fn)(int64(total))
			}
		},
	})
	if err != nil {
		return nil, err
	}
	r.client = client
	return r, nil
}

func (r *Repository) Kind() string { return Kind }

func refFor(id string, t time.Time) repo.Ref {
	return repo.Ref(backupType + "/" + id + "/" + t.UTC().Format(time.RFC3339))
}

func parseRef(ref repo.Ref) (gopbs.SnapshotRef, error) {
	parts := strings.SplitN(string(ref), "/", 3)
	if len(parts) != 3 {
		return gopbs.SnapshotRef{}, fmt.Errorf("backup: %q is not a PBS snapshot reference", ref)
	}
	t, err := time.Parse(time.RFC3339, parts[2])
	if err != nil {
		return gopbs.SnapshotRef{}, fmt.Errorf("backup: %q is not a PBS snapshot reference", ref)
	}
	return gopbs.SnapshotRef{Type: parts[0], ID: parts[1], Time: t}, nil
}

func (r *Repository) Put(ctx context.Context, s *snapshot.Snapshot, progress func(int64)) (res repo.PutResult, err error) {
	r.sizes = sync.Map{}
	if progress != nil {
		r.progress.Store(&progress)
		defer r.progress.Store(nil)
	}
	ref := gopbs.SnapshotRef{Type: backupType, ID: r.cfg.BackupID, Time: s.Manifest.Created}
	sess, err := r.client.StartBackup(ctx, ref)
	if err != nil {
		return res, err
	}
	finished := false
	defer func() {
		if !finished {
			_ = sess.Abort()
		}
	}()

	manifest, err := json.Marshal(s.Manifest)
	if err != nil {
		return res, err
	}
	if err = sess.UploadBlob(ctx, gopbs.NewBlobEncoder(), fileManifest, manifest, true); err != nil {
		return res, err
	}

	db, err := os.Open(s.DBPath)
	if err != nil {
		return res, err
	}
	dbStats, err := sess.UploadStream(ctx, fileDB, db)
	_ = db.Close()
	if err != nil {
		return res, err
	}

	pr, pw := io.Pipe()
	go func() { _ = pw.CloseWithError(writeTar(pw, s.Files)) }()
	stStats, err := sess.UploadStream(ctx, fileStorage, pr)
	_ = pr.Close()
	if err != nil {
		return res, err
	}

	if err = sess.Finish(ctx); err != nil {
		return res, err
	}
	finished = true
	return repo.PutResult{
		Ref:           refFor(r.cfg.BackupID, s.Manifest.Created),
		Bytes:         int64(dbStats.Size + stStats.Size),
		UploadedBytes: int64(dbStats.NewBytes + stStats.NewBytes),
	}, nil
}

// writeTar streams the stored files as a plain tar. Names are storage keys, so
// ExtractTar puts them back under storage/.
func writeTar(w io.Writer, files []snapshot.StoredFile) error {
	tw := tar.NewWriter(w)
	for _, f := range files {
		hdr := &tar.Header{Name: f.Key, Mode: 0o644, Size: f.Size, Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("read %s: %w", f.Key, err)
		}
		n, err := io.Copy(tw, rc)
		_ = rc.Close()
		if err != nil {
			return err
		}
		if n != f.Size {
			return fmt.Errorf("backup: %s: read %d bytes, expected %d", f.Key, n, f.Size)
		}
	}
	return tw.Close()
}

func (r *Repository) reader(ctx context.Context, ref repo.Ref) (*gopbs.ReaderSession, error) {
	sref, err := parseRef(ref)
	if err != nil {
		return nil, err
	}
	return r.client.StartReader(ctx, sref)
}

func (r *Repository) Manifest(ctx context.Context, ref repo.Ref) (format.Manifest, error) {
	rs, err := r.reader(ctx, ref)
	if err != nil {
		return format.Manifest{}, err
	}
	defer rs.Close()
	raw, err := rs.DownloadBlob(ctx, fileManifest)
	if err != nil {
		return format.Manifest{}, err
	}
	var m format.Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, fmt.Errorf("%w: manifest: %v", format.ErrFormat, err)
	}
	if m.Format != format.FormatV1 {
		return m, fmt.Errorf("%w: format %q", format.ErrFormat, m.Format)
	}
	return m, nil
}

func (r *Repository) Fetch(ctx context.Context, ref repo.Ref, dir string) error {
	rs, err := r.reader(ctx, ref)
	if err != nil {
		return err
	}
	defer rs.Close()
	if err := os.MkdirAll(filepath.Join(dir, "storage"), 0o755); err != nil {
		return err
	}
	db, err := rs.OpenDynamicIndex(ctx, fileDB+".didx")
	if err != nil {
		return err
	}
	err = arm.WriteMember(filepath.Join(dir, format.MemberDB), db)
	_ = db.Close()
	if err != nil {
		return err
	}
	st, err := rs.OpenDynamicIndex(ctx, fileStorage+".didx")
	if err != nil {
		return err
	}
	defer st.Close()
	return arm.ExtractTar(st, filepath.Join(dir, "storage"))
}

func (r *Repository) List(ctx context.Context) ([]repo.SnapshotInfo, error) {
	snaps, err := r.client.ListSnapshots(ctx, backupType, r.cfg.BackupID)
	if err != nil {
		return nil, err
	}
	out := make([]repo.SnapshotInfo, 0, len(snaps))
	for _, s := range snaps {
		out = append(out, repo.SnapshotInfo{Ref: refFor(s.Ref.ID, s.Ref.Time), Created: s.Ref.Time.UTC(), Bytes: int64(s.Size)})
	}
	return out, nil
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `cd core/server && go test -race ./backup/pbs/`
Expected: PASS.

- [ ] **Step 8: Opt-in real-PBS test**

Add to `pbs_test.go`:

```go
// TestAgainstARealServer runs the contract against a real PBS when
// TINYCLD_TEST_PBS holds a Config JSON (without backup_id). It is for a
// manual check before a release; CI runs the pbstest suite above.
func TestAgainstARealServer(t *testing.T) {
	raw := os.Getenv("TINYCLD_TEST_PBS")
	if raw == "" {
		t.Skip("TINYCLD_TEST_PBS is not set")
	}
	var c Config
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatal(err)
	}
	c.BackupID = "tinycld-test-" + strconv.FormatInt(time.Now().Unix(), 10)
	cfg, _ := json.Marshal(c)
	repotest.Run(t, func(t *testing.T) repo.Repository {
		r, err := Open(cfg)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}, repotest.Options{Dedup: true})
}
```

- [ ] **Step 9: Commit**

```bash
git add core/server/go.mod core/server/go.sum server/go.mod server/go.sum core/server/backup/pbs
git commit -m "feat(backup): Proxmox Backup Server repository"
```

---

### Task 10: Restore from a repository

**Files:**
- Modify: `core/server/backup/restore.go`
- Test: `core/server/backup/restore_test.go`

**Interfaces:**
- Consumes: `repo.Repository`, `arm.MarkStaged`.
- Produces: `RestoreRequest` gains `Repo repo.Repository` and `Ref repo.Ref`. When `Repo` is set, `Source`/`Identity` are unused and may be nil.

- [ ] **Step 1: Write the failing test**

Build a real snapshot through the engine into an in-memory repository, then restore it:

```go
// memRepo is an archive repository kept in memory, so a restore test reads
// back exactly what a backup wrote.
func memRepo(t *testing.T) repo.Repository {
	id, _ := age.GenerateX25519Identity()
	objs := map[repo.Ref][]byte{}
	var mu sync.Mutex
	return &archive.Repository{
		Recipient: id.Recipient(), Identity: id, Level: zstd.SpeedFastest,
		Target: func(_ context.Context, created time.Time) (io.WriteCloser, repo.Ref, error) {
			ref := repo.Ref(created.Format(time.RFC3339Nano))
			return &memObj{ref: ref, store: objs, mu: &mu}, ref, nil
		},
		Open: func(_ context.Context, ref repo.Ref) (io.ReadCloser, error) {
			mu.Lock()
			defer mu.Unlock()
			return io.NopCloser(bytes.NewReader(objs[ref])), nil
		},
	}
}

type memObj struct {
	bytes.Buffer
	ref   repo.Ref
	store map[repo.Ref][]byte
	mu    *sync.Mutex
}

func (o *memObj) Close() error {
	o.mu.Lock()
	o.store[o.ref] = o.Bytes()
	o.mu.Unlock()
	return nil
}

func TestRestoreFromARepositoryStagesAndArms(t *testing.T) {
	app := newTestApp(t)
	t.Cleanup(ResetForTesting)
	SetRestart(func() bool { return true })
	r := memRepo(t)
	id, err := Run(app, Request{Kind: KindScheduled, Repo: r})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := app.FindRecordById("backups", id)
	if _, err := Restore(app, RestoreRequest{Repo: r, Ref: repo.Ref(row.GetString("ref"))}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(armedPath(app))
	if err != nil {
		t.Fatal("not armed")
	}
	var a armed
	_ = json.Unmarshal(raw, &a)
	if _, err := os.Stat(filepath.Join(a.Pending, stagedSentinel)); err != nil {
		t.Fatal("no sentinel")
	}
	if _, err := os.Stat(filepath.Join(a.Pending, "storage", "col1", "rec1", "hello.txt")); err != nil {
		t.Fatal("stored file not staged")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd core/server && go test ./backup -run TestRestoreFromARepository`
Expected: FAIL (`RestoreRequest` has no field `Repo`).

- [ ] **Step 3: Implement**

In `RestoreRequest` add:

```go
	// Repo and Ref restore a snapshot from a repository instead of reading an
	// archive stream. Source, Ranged and Identity are then unused.
	Repo repo.Repository
	Ref  repo.Ref
```

In `beginRestore`, when `req.Repo != nil` and `req.SourceHost == ""`, set the row's `target_host` to `req.Repo.Kind()` and `repository` to the same.

In `runRestore`:
- `closeSource` returns early when `req.Source == nil`.
- Phase 1: when `req.Repo != nil`, `read, err := req.Repo.Manifest(ctx, req.Ref)` instead of `format.NewReader` + `ReadManifest`. Keep the rest of phase 1 (row manifest save).
- Phase 5: when `req.Repo != nil`:

```go
		if err = req.Repo.Fetch(context.Background(), req.Ref, pending); err != nil {
			return err
		}
		if err = arm.MarkStaged(pending, &read); err != nil {
			return err
		}
```

  otherwise the existing `archive.Stage` + `arm.IntegrityCheck` + sentinel write, replaced by `arm.MarkStaged(pending, nil)` after `archive.Stage`.
- Space check: unchanged (`read.Counts.Bytes`).

- [ ] **Step 4: Run to verify**

Run: `cd core/server && go test -race ./backup/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/server/backup/restore.go core/server/backup/restore_test.go
git commit -m "feat(backup): restore a snapshot from a repository"
```

---

### Task 11: Repository config and the schedule

**Files:**
- Create: `core/server/coreserver/backup_repository.go`
- Test: `core/server/coreserver/backup_repository_test.go`
- Modify: `core/server/coreserver/server.go` (call `RegisterBackupRepository(app)` right after `RegisterBackupEndpoints(app)`)

**Interfaces:**
- Consumes: `syscfg.Get`, `syscfg.IsManaged`, `SystemSettings().OnChange`, `repo.Open`, `pbs.Register`, `backup.Start`, `backup.FailedRun`, `checkBackupTarget`.
- Produces (package `coreserver`):

```go
const (
	repoKeyKind     = "backup.repository.kind"
	repoKeyConfig   = "backup.repository.config"
	repoKeySchedule = "backup.repository.schedule"
	repoKeyEnabled  = "backup.repository.enabled"
	repoJobID       = "backup-repository"
	defaultRepoSchedule = "0 3 * * *"
)
var errNoRepository error
func RegisterBackupRepository(app core.App)
func openRepository(app core.App) (repo.Repository, error)
func openRepositoryWith(app core.App, kind string, cfg json.RawMessage) (repo.Repository, error)
func scheduleRepositoryBackup(app core.App)
```

- [ ] **Step 1: Write the failing tests**

```go
package coreserver

import (
	"encoding/json"
	"testing"

	"tinycld.org/core/syscfg"
)

type mapProvider struct {
	values  map[string]string
	managed []string
}

func (m mapProvider) Get(k string) string        { return m.values[k] }
func (m mapProvider) ManagedPrefixes() []string { return m.managed }

func TestScheduleFollowsTheConfig(t *testing.T) {
	app := newBackupTestApp(t) // the helper backup_api_test.go already uses
	t.Cleanup(syscfg.ResetForTesting)

	syscfg.SetResolver(mapProvider{values: map[string]string{}}.Get)
	scheduleRepositoryBackup(app)
	if app.Cron().HasJob(repoJobID) {
		t.Fatal("scheduled with nothing configured")
	}

	syscfg.SetResolver(mapProvider{values: map[string]string{
		repoKeyKind: "pbs", repoKeyEnabled: "true", repoKeySchedule: "15 2 * * *",
	}}.Get)
	scheduleRepositoryBackup(app)
	if !app.Cron().HasJob(repoJobID) {
		t.Fatal("not scheduled")
	}

	syscfg.SetResolver(mapProvider{values: map[string]string{repoKeyKind: "pbs", repoKeyEnabled: "false"}}.Get)
	scheduleRepositoryBackup(app)
	if app.Cron().HasJob(repoJobID) {
		t.Fatal("still scheduled after disable")
	}
}

func TestManagedPrefixTurnsTheScheduleOff(t *testing.T) {
	app := newBackupTestApp(t)
	t.Cleanup(syscfg.ResetForTesting)
	syscfg.SetProvider(mapProvider{
		values:  map[string]string{repoKeyKind: "pbs", repoKeyEnabled: "true"},
		managed: []string{"backup.repository."},
	})
	scheduleRepositoryBackup(app)
	if app.Cron().HasJob(repoJobID) {
		t.Fatal("scheduled under a managed prefix")
	}
}

func TestOpenRepositoryFillsTheBackupID(t *testing.T) {
	app := newBackupTestApp(t)
	app.Settings().Meta.AppURL = "https://acme.example"
	var seen json.RawMessage
	repo.ResetForTesting()
	t.Cleanup(repo.ResetForTesting)
	repo.Register("capture", func(cfg json.RawMessage) (repo.Repository, error) { seen = cfg; return nil, nil })
	if _, err := openRepositoryWith(app, "capture", json.RawMessage(`{"server":"10.0.0.5"}`)); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(seen, &got)
	if got["backup_id"] != "acme.example" {
		t.Fatalf("cfg = %s", seen)
	}
}
```

Check `HasJob`: PocketBase's `cron.Cron` exposes `Jobs()`; if there is no `HasJob`, add a tiny helper in the test:

```go
func hasJob(app core.App, id string) bool {
	for _, j := range app.Cron().Jobs() {
		if j.Id() == id {
			return true
		}
	}
	return false
}
```

and use it in place of `app.Cron().HasJob`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd core/server && go test ./coreserver -run 'TestSchedule|TestManagedPrefix|TestOpenRepository'`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
package coreserver

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/backup"
	"tinycld.org/core/backup/pbs"
	"tinycld.org/core/backup/repo"
	"tinycld.org/core/syscfg"
)

const (
	repoKeyPrefix       = "backup.repository."
	repoKeyKind         = "backup.repository.kind"
	repoKeyConfig       = "backup.repository.config"
	repoKeySchedule     = "backup.repository.schedule"
	repoKeyEnabled      = "backup.repository.enabled"
	repoJobID           = "backup-repository"
	defaultRepoSchedule = "0 3 * * *"
)

var errNoRepository = errors.New("No backup repository is configured.")

// RegisterBackupRepository registers the repository kinds core ships and keeps
// the scheduled backup in step with the settings. Called after
// RegisterSystemConfig, whose OnServe loads the values this reads.
func RegisterBackupRepository(app core.App) {
	pbs.Register()
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		scheduleRepositoryBackup(app)
		return e.Next()
	})
	SystemSettings().OnChange(func(key, _ string) {
		if strings.HasPrefix(key, repoKeyPrefix) {
			scheduleRepositoryBackup(app)
		}
	})
}

func scheduleRepositoryBackup(app core.App) {
	app.Cron().Remove(repoJobID)
	// A composition that owns these keys backs the deployment up itself.
	if syscfg.IsManaged(repoKeyKind) {
		return
	}
	if syscfg.Get(repoKeyKind) == "" || syscfg.Get(repoKeyEnabled) != "true" {
		return
	}
	schedule := strings.TrimSpace(syscfg.Get(repoKeySchedule))
	if schedule == "" {
		schedule = defaultRepoSchedule
	}
	if err := app.Cron().Add(repoJobID, schedule, func() { runScheduledRepositoryBackup(app) }); err != nil {
		srvLog.Error("the backup schedule is not a valid cron expression", "schedule", schedule, "err", err)
	}
}

func runScheduledRepositoryBackup(app core.App) {
	r, err := openRepository(app)
	if err != nil {
		if ferr := backup.FailedRun(app, backup.KindScheduled, syscfg.Get(repoKeyKind), err); ferr != nil {
			srvLog.Error("could not record a failed scheduled backup", "err", ferr)
		}
		return
	}
	if _, err := backup.Start(app, backup.Request{Kind: backup.KindScheduled, Repo: r, TargetHost: r.Kind()}); err != nil {
		if errors.Is(err, backup.ErrBusy) {
			srvLog.Warn("scheduled backup skipped: another job is running")
			return
		}
		srvLog.Error("could not start the scheduled backup", "err", err)
	}
}

func openRepository(app core.App) (repo.Repository, error) {
	kind := syscfg.Get(repoKeyKind)
	if kind == "" {
		return nil, errNoRepository
	}
	return openRepositoryWith(app, kind, json.RawMessage(syscfg.Get(repoKeyConfig)))
}

// openRepositoryWith fills the backup ID from this deployment's hostname and
// refuses a server address only this machine can reach, as for a URL target.
func openRepositoryWith(app core.App, kind string, cfg json.RawMessage) (repo.Repository, error) {
	var m map[string]any
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	if err := json.Unmarshal(cfg, &m); err != nil {
		return nil, errors.New("The repository settings are not valid.")
	}
	if id, _ := m["backup_id"].(string); id == "" {
		m["backup_id"] = backup.HostOnly(app.Settings().Meta.AppURL)
	}
	if server, _ := m["server"].(string); server != "" {
		if err := checkBackupTarget(serverURL(server)); err != nil {
			return nil, err
		}
	}
	filled, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return repo.Open(kind, filled)
}

func serverURL(server string) string {
	if strings.HasPrefix(server, "https://") || strings.HasPrefix(server, "http://") {
		return server
	}
	return "https://" + server
}
```

- [ ] **Step 4: Run to verify**

Run: `cd core/server && go test ./coreserver/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/server/coreserver/backup_repository*.go core/server/coreserver/server.go
git commit -m "feat(backup): scheduled backups to a configured repository"
```

---

### Task 12: HTTP API for repositories

**Files:**
- Create: `core/server/coreserver/backup_repository_api.go`
- Modify: `core/server/coreserver/backup_api.go` (`backupBody`, `restoreBody`, route list, `handleBackupCreate`, `readRemoteArchive`)
- Test: `core/server/coreserver/backup_api_test.go`

**Interfaces:**
- Consumes: `openRepository`, `openRepositoryWith` (Task 11), `pbs.GenerateKey`.
- Produces (routes under `/api/org-backups`):
  - `POST ""` with `{ "repository": true }` → 202 `{ id }` (owner|admin; no passphrase)
  - `GET "/snapshots"` → 200 `[{ ref, created, bytes }]` (owner|admin)
  - `POST "/restore"` with `{ "snapshot": "<ref>" }` → 202 `{ jobId }` (owner)
  - `POST "/repository/test"` with `{ kind, config }` → 200 `{ snapshots: n }` or 422 `{ message }` (owner|admin)
  - `POST "/repository/generate-key"` with `{ kind: "pbs" }` → 200 `{ key }` (owner|admin)

- [ ] **Step 1: Write the failing tests**

Follow the pattern in `backup_api_test.go` (its test app, `requireAdmin` users, and request helpers). Register a fake kind so no network is used:

```go
type fakeRepo struct{ snaps []repo.SnapshotInfo }

func (fakeRepo) Kind() string { return "fake" }
func (fakeRepo) Put(context.Context, *snapshot.Snapshot, func(int64)) (repo.PutResult, error) {
	return repo.PutResult{Ref: "fake/1", Bytes: 10, UploadedBytes: 1}, nil
}
func (fakeRepo) Manifest(context.Context, repo.Ref) (format.Manifest, error) {
	return format.Manifest{}, errors.New("not used")
}
func (fakeRepo) Fetch(context.Context, repo.Ref, string) error        { return errors.New("not used") }
func (f fakeRepo) List(context.Context) ([]repo.SnapshotInfo, error) { return f.snaps, nil }
```

Tests:
- `POST /api/org-backups {repository:true}` as admin with `backup.repository.kind=fake` → 202; the row finishes `succeeded` with `repository=fake`, `ref=fake/1`.
- same with no kind configured → 400 with "No backup repository is configured."
- `GET /api/org-backups/snapshots` as admin → 200 and the list; as member → 403.
- `POST /api/org-backups/repository/test {kind:"pbs", config:{server:"127.0.0.1",…}}` without `TINYCLD_BACKUP_ALLOW_LOOPBACK` → 422 naming loopback; the response never contains the secret value.
- `POST /api/org-backups/repository/generate-key {kind:"pbs"}` → 200, `key` parses as JSON with a `data` field.
- `POST /api/org-backups/restore {snapshot:"fake/1"}` as admin (not owner) → 403.

- [ ] **Step 2: Run to verify they fail**

Run: `cd core/server && go test ./coreserver -run 'Repository|Snapshots|GenerateKey'`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `backup_api.go`:

```go
type backupBody struct {
	Target     string `json:"target"`
	Stream     bool   `json:"stream"`
	Repository bool   `json:"repository"`
	Passphrase string `json:"passphrase"`
}
```

At the top of `handleBackupCreate`, after decoding:

```go
	if body.Repository {
		r, err := openRepository(app)
		if err != nil {
			return re.BadRequestError(err.Error(), nil)
		}
		id, err := backup.Start(app, backup.Request{
			Kind: backup.KindManual, Repo: r, Initiator: initiatorOf(re),
			TargetHost: r.Kind(), Request: re,
		})
		return backupStartError(re, id, err)
	}
```

`restoreBody` gains `Snapshot string \`json:"snapshot"\``. In `readRemoteArchive`, before the passphrase check:

```go
	if body.Snapshot != "" {
		r, err := openRepository(app)
		if err != nil {
			return re.BadRequestError(err.Error(), nil)
		}
		req.Repo, req.Ref, req.Force = r, repo.Ref(body.Snapshot), body.Force
		req.SourceHost = r.Kind()
		return nil
	}
```

(`readRemoteArchive` needs `app` — add it as its first parameter and update its one caller. `handleRestore` must not return "No archive was supplied." when `req.Repo != nil`; change that check to `req.Source == nil && req.Repo == nil`.)

Register the routes in `RegisterBackupEndpoints`:

```go
		g.GET("/snapshots", func(re *core.RequestEvent) error { return handleSnapshots(app, re) }).BindFunc(requireAdmin)
		g.POST("/repository/test", func(re *core.RequestEvent) error { return handleRepositoryTest(app, re) }).BindFunc(requireAdmin)
		g.POST("/repository/generate-key", handleGenerateKey).BindFunc(requireAdmin)
```

`backup_repository_api.go`:

```go
package coreserver

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/backup/pbs"
)

const repositoryCallTimeout = 20 * time.Second

func handleSnapshots(app core.App, re *core.RequestEvent) error {
	r, err := openRepository(app)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}
	ctx, cancel := context.WithTimeout(re.Request.Context(), repositoryCallTimeout)
	defer cancel()
	list, err := r.List(ctx)
	if err != nil {
		return re.JSON(http.StatusBadGateway, map[string]string{"message": repositoryError(err)})
	}
	return re.JSON(http.StatusOK, list)
}

type repositoryTestBody struct {
	Kind   string          `json:"kind"`
	Config json.RawMessage `json:"config"`
}

// handleRepositoryTest tries settings before they are saved. It lists the
// snapshots and writes nothing.
func handleRepositoryTest(app core.App, re *core.RequestEvent) error {
	var body repositoryTestBody
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid JSON body", err)
	}
	r, err := openRepositoryWith(app, body.Kind, body.Config)
	if err != nil {
		return re.JSON(http.StatusUnprocessableEntity, map[string]string{"message": err.Error()})
	}
	ctx, cancel := context.WithTimeout(re.Request.Context(), repositoryCallTimeout)
	defer cancel()
	list, err := r.List(ctx)
	if err != nil {
		return re.JSON(http.StatusUnprocessableEntity, map[string]string{"message": repositoryError(err)})
	}
	return re.JSON(http.StatusOK, map[string]int{"snapshots": len(list)})
}

func handleGenerateKey(re *core.RequestEvent) error {
	var body struct {
		Kind string `json:"kind"`
	}
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil || body.Kind != pbs.Kind {
		return re.BadRequestError("Only PBS keys can be generated.", err)
	}
	key, err := pbs.GenerateKey()
	if err != nil {
		return re.InternalServerError("could not generate a key", err)
	}
	re.Response.Header().Set("Cache-Control", "no-store")
	return re.JSON(http.StatusOK, map[string]string{"key": key})
}
```

`repositoryError` maps gopbs sentinels to plain messages (never the raw error, which may name a host path):

```go
func repositoryError(err error) string {
	switch {
	case errors.Is(err, gopbs.ErrAuth):
		return "The repository refused the credentials."
	case errors.Is(err, gopbs.ErrFingerprint):
		return "The server's certificate does not match the fingerprint."
	case errors.Is(err, gopbs.ErrNotFound):
		return "The datastore or namespace does not exist."
	case errors.Is(err, context.DeadlineExceeded):
		return "The repository did not answer in time."
	default:
		return "Could not reach the repository."
	}
}
```

(import `gopbs "github.com/osshield/gopbs/pbs"` and `errors`.)

- [ ] **Step 4: Run to verify**

Run: `cd core/server && go test -race ./coreserver/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/server/coreserver
git commit -m "feat(backup): API to back up to, list and restore from a repository"
```

---

### Task 13: Settings panel — repository card, snapshot restore, history

**Files:**
- Create: `core/components/settings/backups/repository-logic.ts`
- Create: `core/components/settings/backups/__tests__/repository-logic.test.ts`
- Create: `core/components/settings/backups/useBackupRepository.ts`
- Create: `core/components/settings/backups/RepositoryCard.tsx`
- Create: `core/components/settings/backups/SnapshotRestoreForm.tsx`
- Modify: `core/components/settings/backups/BackupsSection.tsx`, `BackupHistory.tsx`, `useBackups.ts`

**Interfaces:**
- Consumes: `useSystemSettings('backup.repository')` (`core/components/setup/system-settings-store.ts`), `pb.send`, `useMutation`, API from Task 12.
- Produces:
  - `repository-logic.ts`: `pbsSchema` (zod), `type PbsForm`, `parseStoredConfig(raw: string | undefined): PbsForm`, `toStoredConfig(form: PbsForm): string`, `formatDedup(bytes: number, uploaded: number): string`.
  - `useBackupRepository()` → `{ form, save, test, generateKey, backupNow, isConfigured, isManaged }`.
  - `useSnapshots(isEnabled: boolean)` → react-query result of `GET /api/org-backups/snapshots`.
  - `useSnapshotRestore()` → `{ form, start }`.

- [ ] **Step 1: Write the failing logic tests**

```ts
import { describe, expect, it } from 'vitest'
import { formatDedup, parseStoredConfig, pbsSchema, toStoredConfig } from '../repository-logic'

describe('repository config', () => {
    const form = {
        server: 'pbs.example:8007',
        fingerprint: 'aa:bb',
        datastore: 'store',
        namespace: '',
        authId: 'tinycld@pbs!backup',
        secret: 's3cret',
        key: '',
        schedule: '0 3 * * *',
        enabled: true,
    }

    it('round-trips through the stored JSON', () => {
        expect(parseStoredConfig(toStoredConfig(form), '0 3 * * *', 'true')).toEqual(form)
    })

    it('maps camelCase fields to the server names', () => {
        expect(JSON.parse(toStoredConfig(form))).toMatchObject({ auth_id: 'tinycld@pbs!backup' })
    })

    it('rejects an auth id that is not an API token', () => {
        expect(pbsSchema.safeParse({ ...form, authId: 'root@pam' }).success).toBe(false)
    })

    it('returns empty fields for nothing stored', () => {
        expect(parseStoredConfig(undefined, undefined, undefined).server).toBe('')
    })

    it('describes what deduplication saved', () => {
        expect(formatDedup(1000, 100)).toBe('90% deduplicated')
        expect(formatDedup(0, 0)).toBe('')
    })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tinycld && pnpm exec vitest run core/components/settings/backups/__tests__/repository-logic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `repository-logic.ts`**

```ts
import { z } from '@tinycld/core/ui/form'

// Pure helpers behind the Repository card, testable without rendering.

export const pbsSchema = z.object({
    server: z.string().min(1, 'Enter the PBS server'),
    fingerprint: z.string(),
    datastore: z.string().min(1, 'Enter the datastore'),
    namespace: z.string(),
    authId: z.string().regex(/^[^@\s]+@[^!\s]+![^\s]+$/, 'Use an API token: user@realm!name'),
    secret: z.string().min(1, 'Enter the token secret'),
    key: z.string(),
    schedule: z.string().min(1, 'Enter a cron schedule'),
    enabled: z.boolean(),
})

export type PbsForm = z.infer<typeof pbsSchema>

export const DEFAULT_SCHEDULE = '0 3 * * *'

export function parseStoredConfig(
    raw: string | undefined,
    schedule: string | undefined,
    enabled: string | undefined
): PbsForm {
    let stored: Record<string, string> = {}
    try {
        stored = raw ? JSON.parse(raw) : {}
    } catch {
        stored = {}
    }
    return {
        server: stored.server ?? '',
        fingerprint: stored.fingerprint ?? '',
        datastore: stored.datastore ?? '',
        namespace: stored.namespace ?? '',
        authId: stored.auth_id ?? '',
        secret: stored.secret ?? '',
        key: stored.key ?? '',
        schedule: schedule || DEFAULT_SCHEDULE,
        enabled: enabled === 'true',
    }
}

export function toStoredConfig(form: PbsForm): string {
    return JSON.stringify({
        server: form.server.trim(),
        fingerprint: form.fingerprint.trim(),
        datastore: form.datastore.trim(),
        namespace: form.namespace.trim(),
        auth_id: form.authId.trim(),
        secret: form.secret,
        key: form.key,
    })
}

export function formatDedup(bytes: number, uploaded: number): string {
    if (!bytes) return ''
    const saved = Math.round((1 - uploaded / bytes) * 100)
    return `${saved}% deduplicated`
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd tinycld && pnpm exec vitest run core/components/settings/backups/__tests__/repository-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `useBackupRepository.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useSystemSettings } from '../../setup/system-settings-store'
import { type PbsForm, parseStoredConfig, pbsSchema, toStoredConfig } from './repository-logic'

const KIND_KEY = 'backup.repository.kind'
const CONFIG_KEY = 'backup.repository.config'
const SCHEDULE_KEY = 'backup.repository.schedule'
const ENABLED_KEY = 'backup.repository.enabled'

export function useBackupRepository() {
    const queryClient = useQueryClient()
    const { byKey, upsert, isReady } = useSystemSettings('backup.repository')
    const stored = parseStoredConfig(
        byKey.get(CONFIG_KEY)?.value,
        byKey.get(SCHEDULE_KEY)?.value,
        byKey.get(ENABLED_KEY)?.value
    )
    const isConfigured = byKey.get(KIND_KEY)?.value === 'pbs'

    const form = useForm({
        mode: 'onChange',
        resolver: zodResolver(pbsSchema),
        // `values` re-syncs when the stored settings load or change.
        values: stored,
    })
    const { setError, getValues } = form

    const save = useMutation({
        mutationFn: async (data: PbsForm) => {
            await upsert.mutateAsync({ key: KIND_KEY, value: 'pbs', isSecret: false })
            await upsert.mutateAsync({ key: CONFIG_KEY, value: toStoredConfig(data), isSecret: true })
            await upsert.mutateAsync({ key: SCHEDULE_KEY, value: data.schedule, isSecret: false })
            await upsert.mutateAsync({ key: ENABLED_KEY, value: String(data.enabled), isSecret: false })
        },
        onError: handleMutationErrorsWithForm({ setError, getValues, operation: 'backup.repository.save' }),
    })

    const test = useMutation({
        mutationFn: (data: PbsForm) =>
            pb.send<{ snapshots: number }>('/api/org-backups/repository/test', {
                method: 'POST',
                body: { kind: 'pbs', config: JSON.parse(toStoredConfig(data)) },
            }),
    })

    const generateKey = useMutation({
        mutationFn: () =>
            pb.send<{ key: string }>('/api/org-backups/repository/generate-key', {
                method: 'POST',
                body: { kind: 'pbs' },
            }),
        onSuccess: ({ key }) => form.setValue('key', key, { shouldDirty: true }),
    })

    const backupNow = useMutation({
        mutationFn: () =>
            pb.send<{ id: string }>('/api/org-backups', { method: 'POST', body: { repository: true } }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
    })

    return { form, save, test, generateKey, backupNow, isConfigured, isReady }
}

export type RepositorySnapshot = { ref: string; created: string; bytes: number }

export function useSnapshots(isEnabled: boolean) {
    return useQuery({
        queryKey: ['backup-snapshots'],
        queryFn: () => pb.send<RepositorySnapshot[]>('/api/org-backups/snapshots', { method: 'GET' }),
        enabled: isEnabled,
    })
}

const snapshotRestoreSchema = z.object({
    snapshot: z.string().min(1, 'Choose a snapshot'),
    acknowledged: z.boolean().refine(value => value, 'Confirm that current data will be replaced'),
})

export function useSnapshotRestore() {
    const form = useForm({
        mode: 'onChange',
        resolver: zodResolver(snapshotRestoreSchema),
        defaultValues: { snapshot: '', acknowledged: false },
    })
    const { setError, getValues } = form
    const start = useMutation({
        mutationFn: (data: z.infer<typeof snapshotRestoreSchema>) =>
            pb.send<{ jobId: string }>('/api/org-backups/restore', {
                method: 'POST',
                body: { snapshot: data.snapshot },
            }),
        onError: handleMutationErrorsWithForm({ setError, getValues, operation: 'backup.restore.snapshot' }),
    })
    return { form, start }
}
```

Managed state: a managed prefix hides the card. Read it the way the system settings screen does (grep `ManagedPrefixes`/`managed` in `core/components/settings/system/SystemSettingsScreen.tsx` and `core/lib/setup/`) and pass `isManaged` into `RepositoryCard`; use the same helper, do not add a new endpoint.

- [ ] **Step 6: Implement `RepositoryCard.tsx`**

```tsx
import { FormErrorSummary, TextInput, Toggle } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import { useBackupRepository } from './useBackupRepository'

type Props = { isVisible: boolean; isBusy: boolean }

export function RepositoryCard({ isVisible, isBusy }: Props) {
    const { form, save, test, generateKey, backupNow, isConfigured } = useBackupRepository()
    const { control, handleSubmit, formState } = form
    const onSave = handleSubmit(data => save.mutate(data))
    const onTest = handleSubmit(data => test.mutate(data))
    const testMessage = describeTest(test.data?.snapshots, test.error)
    const isBackupDisabled = isBusy || backupNow.isPending || !isConfigured

    if (!isVisible) return null

    return (
        <View className="rounded-xl border border-border bg-surface-secondary p-4 gap-3" testID="repository-card">
            <Text className="text-foreground font-semibold">Proxmox Backup Server</Text>
            <Text className="text-xs text-muted-foreground">
                Scheduled backups go to a PBS datastore. Each run is a full snapshot, but PBS stores only
                what changed. Set retention with a prune job on PBS. If you use an encryption key, keep a
                copy somewhere else: without it the backups cannot be read.
            </Text>
            <FormErrorSummary errors={formState.errors} isEnabled={formState.isSubmitted} />
            <TextInput control={control} name="server" label="Server (host:port)" autoCapitalize="none" autoCorrect={false} />
            <TextInput control={control} name="fingerprint" label="Certificate fingerprint" autoCapitalize="none" autoCorrect={false} />
            <TextInput control={control} name="datastore" label="Datastore" autoCapitalize="none" autoCorrect={false} />
            <TextInput control={control} name="namespace" label="Namespace (optional)" autoCapitalize="none" autoCorrect={false} />
            <TextInput control={control} name="authId" label="API token ID" autoCapitalize="none" autoCorrect={false} />
            <TextInput control={control} name="secret" label="API token secret" secureTextEntry />
            <TextInput control={control} name="key" label="Encryption key file (optional)" multiline autoCapitalize="none" autoCorrect={false} />
            <Pressable onPress={() => generateKey.mutate()} testID="repository-generate-key">
                <Text className="text-primary font-medium">Generate a key</Text>
            </Pressable>
            <TextInput control={control} name="schedule" label="Schedule (cron)" autoCapitalize="none" autoCorrect={false} />
            <Toggle control={control} name="enabled" label="Back up on this schedule" />
            <View className="flex-row gap-4">
                <Pressable onPress={onTest} testID="repository-test">
                    <Text className="text-primary font-medium">Test connection</Text>
                </Pressable>
                <Pressable onPress={onSave} testID="repository-save">
                    <Text className="text-primary font-medium">Save</Text>
                </Pressable>
                <Pressable
                    onPress={() => backupNow.mutate()}
                    disabled={isBackupDisabled}
                    className={isBackupDisabled ? 'opacity-50' : ''}
                    testID="repository-backup-now"
                >
                    <Text className="text-primary font-medium">Back up now</Text>
                </Pressable>
            </View>
            <TestResult message={testMessage} />
        </View>
    )
}

function describeTest(snapshots: number | undefined, error: unknown) {
    if (error instanceof Error) return { text: error.message, isError: true }
    if (snapshots === undefined) return undefined
    return { text: `Connected. ${snapshots} snapshot(s) found.`, isError: false }
}

function TestResult({ message }: { message: ReturnType<typeof describeTest> }) {
    if (!message) return null
    const tone = message.isError ? 'text-danger' : 'text-muted-foreground'
    return (
        <Text className={`text-xs ${tone}`} testID="repository-test-result">
            {message.text}
        </Text>
    )
}
```

- [ ] **Step 7: Implement `SnapshotRestoreForm.tsx`**

```tsx
import { formatBytes, formatTimeAgo } from '@tinycld/core/lib/format-utils'
import { FormErrorSummary, RadioInput, Toggle } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import { useSnapshotRestore, useSnapshots } from './useBackupRepository'

type Props = { isVisible: boolean; isBusy: boolean }

export function SnapshotRestoreForm({ isVisible, isBusy }: Props) {
    const { data: snapshots, error } = useSnapshots(isVisible)
    const { form, start } = useSnapshotRestore()
    const { control, handleSubmit, formState } = form
    const onSubmit = handleSubmit(data => start.mutate(data))
    const isDisabled = isBusy || start.isPending || !formState.isValid
    const options = (snapshots ?? []).map(s => ({
        value: s.ref,
        label: `${formatTimeAgo(s.created)} · ${formatBytes(s.bytes)}`,
    }))

    if (!isVisible) return null

    return (
        <View className="rounded-xl border border-danger p-4 gap-3" testID="snapshot-restore-form">
            <Text className="text-foreground font-semibold">Restore from the repository</Text>
            <ListError error={error} />
            <FormErrorSummary errors={formState.errors} isEnabled={formState.isSubmitted} />
            <RadioInput control={control} name="snapshot" label="Snapshot" options={options} />
            <Toggle control={control} name="acknowledged" label="I understand that all current data is replaced" />
            <Pressable
                onPress={onSubmit}
                disabled={isDisabled}
                testID="snapshot-restore-start"
                className={isDisabled ? 'opacity-50' : ''}
            >
                <Text className="text-danger font-medium">{isBusy ? 'A job is running…' : 'Restore'}</Text>
            </Pressable>
        </View>
    )
}

function ListError({ error }: { error: unknown }) {
    if (!(error instanceof Error)) return null
    return <Text className="text-xs text-danger">{error.message}</Text>
}
```

Check `RadioInput`'s real prop names in `core/ui/form` (added in commit `ade5ec28`) and match them; move the `options` mapping into `useSnapshots` via `select` if the component's JSX rule flags the `.map()` above it (it is above the return, which the style guide allows).

- [ ] **Step 8: Wire into `BackupsSection.tsx` and `BackupHistory.tsx`**

`BackupsSection`: render after `BackupNowForm`:

```tsx
            <RepositoryCard isVisible={!isRepositoryManaged} isBusy={isBusy === true} />
            <SnapshotRestoreForm isVisible={isOwner && isRepositoryConfigured} isBusy={isBusy === true} />
```

(`isRepositoryConfigured` and `isRepositoryManaged` come from a small hook `useRepositoryState()` exported from `useBackupRepository.ts` that returns `{ isConfigured, isManaged }` without building the form.)

`BackupHistory`'s `HistoryRow`: show the repository and the dedup figure:

```tsx
    const where = row.repository === 'pbs' ? 'PBS' : row.target_host || '—'
    const dedup = formatDedup(row.bytes, row.uploaded_bytes)
```

and render `{formatTimeAgo(row.started)} · {who} · {size} · {where}` plus a `<DedupLine text={dedup} />` that returns `null` for an empty string.

- [ ] **Step 9: Regenerate types and check**

Run: `cd ~/code/tinycld && pnpm install` (regenerates `pbSchema.ts` from the new migration), then `cd tinycld && pnpm exec tinycld-pkg check`
Expected: biome, tsc and vitest pass.

- [ ] **Step 10: Commit**

```bash
git add core/components/settings/backups
git commit -m "feat(backup): repository settings, snapshot restore and dedup in history"
```

---

### Task 14: CLI — repository backup, snapshots, snapshot restore

**Files:**
- Create: `cli/backup_snapshots.go`
- Modify: `cli/backup.go` (register command; `ledgerRow` fields), `cli/backup_create.go` (`--repository`), `cli/backup_restore.go` (`--snapshot`), `cli/backup_list.go` (REPO column)
- Test: `cli/backup_test.go`

**Interfaces:**
- Consumes: API from Task 12; `pollRow`, `finishExit`, `d.out.Write`, `client.Client.GetJSON` (use whatever GET helper `client` has — check `cli/client`).
- Produces: `tinycld backup create --repository`, `tinycld backup snapshots [--output …]`, `tinycld backup restore --snapshot <ref>`.

- [ ] **Step 1: Write the failing tests**

Follow the `deps`-injected `httptest` pattern already in `backup_test.go`:

- `create --repository`: server receives `POST /api/org-backups` with `{"repository":true}` and no passphrase; the poll sees `succeeded`; exit 0. No passphrase prompt is made (fail the test if `readPassword` is called).
- `create --repository --out x`: usage error, exit 2 ("pass exactly one of --out, --to or --repository").
- `snapshots`: server returns two snapshots; table output has REF, CREATED, SIZE; `--output json` prints the array.
- `restore --snapshot host/acme/2026-09-29T03:00:00Z --yes`: server receives `{"snapshot":"…"}`; no passphrase read; poll follows the swap as for `--from`.
- `restore --snapshot x --from y`: usage error.

- [ ] **Step 2: Run to verify they fail**

Run: `cd cli && go test ./... -run 'Repository|Snapshots|Snapshot'`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ledgerRow` gains:

```go
	Repository    string `json:"repository"`
	Ref           string `json:"ref"`
	UploadedBytes int64  `json:"uploaded_bytes"`
```

`backup_create.go`: add `var toRepo bool`, flag `--repository` ("back up to the repository configured in Settings → Backups"), change the exclusivity check to count exactly one of `out`, `to`, `toRepo`, and add before the passphrase read:

```go
			if toRepo {
				c, _, err := d.apiClient()
				if err != nil {
					return err
				}
				var res struct {
					ID string `json:"id"`
				}
				if err := c.PostJSON(cmd.Context(), backupsPath, map[string]any{"repository": true}, &res); err != nil {
					return Failed(err)
				}
				d.out.Info(d.stderr, "backup %s started", res.ID)
				row, err := pollRow(cmd.Context(), d, c, res.ID, d.out, pollOptions{restartTimeout: restartTimeout})
				if err != nil {
					return err
				}
				return finishExit(row, d.out, d.stderr)
			}
```

`backup_restore.go`: add `--snapshot`; exactly one of `--from`/`--snapshot`; with `--snapshot` skip the passphrase and the local verify, confirm as now, then `c.PostJSON(ctx, backupsPath+"/restore", map[string]any{"snapshot": snapshot, "force": force}, &res)` and follow with the same `pollRow(..., followSwap: true, ...)`.

`backup_snapshots.go`:

```go
package main

import (
	"github.com/spf13/cobra"

	"tinycld.org/cli/output"
)

type snapshotRow struct {
	Ref     string `json:"ref"`
	Created string `json:"created"`
	Bytes   int64  `json:"bytes"`
}

func newBackupSnapshotsCmd(d *deps) *cobra.Command {
	return &cobra.Command{
		Use:   "snapshots",
		Short: "List the snapshots in the configured backup repository",
		Args:  usageArgs(cobra.NoArgs),
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, _, err := d.apiClient()
			if err != nil {
				return err
			}
			var rows []snapshotRow
			if err := c.GetJSON(cmd.Context(), backupsPath+"/snapshots", &rows); err != nil {
				return Failed(err)
			}
			table := make([][]string, 0, len(rows))
			for _, r := range rows {
				table = append(table, []string{r.Ref, r.Created, output.FormatBytes(r.Bytes)})
			}
			return d.out.Write(d.stdout, []string{"REF", "CREATED", "SIZE"}, table, rows)
		},
	}
}
```

Register it in `newBackupCmd`. `backup_list.go`: add a `REPO` column (`r.Repository`) after `SIZE`.

- [ ] **Step 4: Run to verify**

Run: `cd cli && go test ./... && go vet ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli
git commit -m "feat(cli): back up to, list and restore from the backup repository"
```

---

### Task 15: Help topic and e2e

**Files:**
- Modify: `core/help/backups.md`
- Modify: `tests/e2e/settings-backups.spec.ts`

- [ ] **Step 1: Update the help topic**

Add a section after "Back up from Settings" (keep the frontmatter; add `pbs` and `proxmox` to `tags`):

```markdown
## Back up to Proxmox Backup Server

A repository backs the organization up on a schedule. Each run is a full
snapshot, but Proxmox Backup Server (PBS) stores only the parts that changed,
so a daily backup is small.

1. On PBS, make an API token (for example `tinycld@pbs!backup`) and give it
   the **DatastoreBackup** and **DatastoreReader** roles on the datastore.
2. Copy the server's certificate fingerprint from the PBS dashboard.
3. Open **Settings → Backups** and fill in the **Proxmox Backup Server** card:
   server, fingerprint, datastore, token ID and secret.
4. Optional: choose **Generate a key** to encrypt the backups. Save a copy of
   the key somewhere other than this server and PBS. If you lose it, nobody
   can read the backups.
5. Choose **Test connection**, then **Save**. Turn on **Back up on this
   schedule** to run it every day at 03:00 (server time), or enter your own
   cron schedule.

tinycld never deletes a snapshot. Set how long PBS keeps them with a prune
job on the datastore.

To restore, owners choose a snapshot under **Restore from the repository**,
or run `tinycld backup restore --snapshot <ref>`. `tinycld backup snapshots`
lists them.

You can also read a snapshot without tinycld:
`proxmox-backup-client restore <snapshot> data.db -` and
`proxmox-backup-client restore <snapshot> storage.tar -` (a normal tar file of
the uploaded files).
```

- [ ] **Step 2: Add the e2e case**

In `settings-backups.spec.ts`, add a test that uses only the UI and asserts the refusal path (no PBS in CI):

```ts
    test('refuses a PBS server on the loopback interface', async ({ page }) => {
        const card = page.getByTestId('repository-card')
        await card.getByTestId('server').fill('127.0.0.1:8007')
        await card.getByTestId('datastore').fill('store')
        await card.getByTestId('authId').fill('tinycld@pbs!backup')
        await card.getByTestId('secret').fill('not-a-real-secret')
        await card.getByTestId('repository-test').click()
        await expect(card.getByTestId('repository-test-result')).toContainText(/loopback/i)
    })
```

The e2e server runs with `TINYCLD_BACKUP_ALLOW_LOOPBACK=1` for the PUT-sink test. If that makes this assertion unreachable, use `0.0.0.0:8007` instead (the unspecified address is refused even when loopback is allowed — confirm in `backup_target.go`; if it is not refused either, assert on the "Could not reach the repository." message against `192.0.2.1:8007` (TEST-NET-1, never routable) instead).

- [ ] **Step 3: Run**

Run: `cd tinycld && pnpm run packages:generate && pnpm exec tinycld-pkg test:e2e -- --grep "Settings · Backups"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add core/help/backups.md tests/e2e/settings-backups.spec.ts
git commit -m "docs(backup): help for Proxmox Backup Server; e2e for the repository card"
```

---

### Task 16: Full checks

- [ ] **Step 1:** `cd core/server && go test -race ./... && go vet ./...` — PASS.
- [ ] **Step 2:** `cd third_party/pocketbase && go test ./core/...` — PASS.
- [ ] **Step 3:** `cd server && go build ./...` — builds (the app picks up the gopbs replace).
- [ ] **Step 4:** `cd cli && go test ./...` — PASS.
- [ ] **Step 5:** `cd tinycld && pnpm exec tinycld-pkg check && pnpm run checks` — PASS (includes `check:core-isolation`: no package or hosting names in core).
- [ ] **Step 6:** Fix any failure at its root cause, then commit the fixes.
