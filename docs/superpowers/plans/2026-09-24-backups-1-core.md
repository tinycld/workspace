# Backups 1 — Core Engine, Ledger, Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner/admin can stream an encrypted, complete backup of the org (DB, files, lockfile) to a presigned PUT URL or to the CLI, and an owner can restore one; every run is in a `backups` ledger shown in Settings → Backups.

**Architecture:** A new Go package `core/server/backup` with a PocketBase-free `format` subpackage (tar → zstd → age writer/reader, resumable GET source, PUT sink) and a PocketBase-aware engine (ledger-row-first runs, `installjob` interlock, restore phases, boot-time `pb_data` swap). `coreserver` binds the HTTP routes, the OAuth scope, the boot hook and — when it can self-rebuild — the rebuilder. The TS side registers the `backups` collection and adds a settings screen.

**Tech Stack:** Go 1.26 (`tinycld.org/core`, PocketBase fork v0.39.8), `filippo.io/age`, `github.com/klauspost/compress/zstd`, `archive/tar`; TS: Expo Router, pbtsdb `useStore`/`useLiveQuery`, `@tinycld/core/ui/form`, vitest, Playwright.

Spec: `docs/superpowers/specs/2026-09-24-backups-1-core-design.md`.

## Global Constraints

- Core must not name a package or hosting. No `hosting`, `tenant`, `router`, `saas` words in core. (`pnpm run check:core-isolation` enforces it.)
- Every run writes its `backups` row **before** any work and always ends in a terminal status.
- Archive member order is fixed: `manifest.json`, `data.db`, `storage/…`, `checksums.txt`.
- Passphrase minimum 12 characters. Never persisted, logged, audited, or sent to Sentry. URLs are stored as hostname only.
- Redirects are never followed on PUT or GET.
- No `console.*` in TS runtime code; no `any`; no biome-ignore; 4-space indent, single quotes.
- Keep JSX minimal: data and handlers in hooks/helpers; `isVisible` props instead of `cond && <X/>`.
- All Go work is in `/Users/nas/code/tinycld/tinycld` (repo `tinycld`), branch `backups-core`. Run Go tests from `core/server`: `go test ./backup/... ./coreserver/... ./audit/...`.
- TS checks: `cd /Users/nas/code/tinycld/tinycld/core && pnpm run check`; app typecheck `cd /Users/nas/code/tinycld/tinycld && pnpm run checks`.
- Commit after every task. No mention of Claude in commits.

## File Structure

```
core/server/backup/format/
    manifest.go        Manifest, Lockfile types; JSON (de)serialization
    writer.go          Writer: tar → zstd → age; AddManifest/AddDB/AddFile/Close writes checksums
    reader.go          Reader: age → zstd → tar; Next() members; ReadManifest stops early; verifies checksums
    inspect.go         Inspect(r, identity) (Manifest, Report, error)
    source.go          RangeSource: resumable HTTP GET (Range/If-Range), SwapURL, no redirects
    sink.go            PutSink: streaming HTTP PUT, no redirects
    *_test.go
core/server/backup/
    ledger.go          backups collection helpers: newRow, finish, markInterrupted, hostOnly
    engine.go          Run(app, Request): snapshot, walk, stream; interlock; callback; notify; audit
    snapshot.go        vacuumInto(app, path) via the DB connection
    limit.go           SetDailyLimit seam + counter
    restore.go         Restore(app, RestoreRequest): phases 1–6; RegisterRebuilder; SwapSource
    manifestcheck.go   compareEmbedded(manifest, installed) Diff
    bootswap.go        ApplyPendingRestore(dataDir); FinalizeRestore(app); paths under Dir(dataDir)/restore
    maintenance.go     503 middleware while restoring
    verify.go          Verify(app) Report
    *_test.go
core/server/audit/log.go                       audit.Log export
core/server/coreserver/backup_api.go           routes, guards, scope, boot hook, rebuilder registration
core/server/coreserver/backup_api_test.go
core/server/oauth/oauth.go                     ScopeBackups const; registry.go adds it to core scopes
core/server/pb_migrations/2050000000_create_backups.js
core/lib/pocketbase.ts                         backups collection
core/lib/format-utils.ts                       formatTimeAgo
core/components/settings/backups/
    BackupsSection.tsx     header + composition
    useBackups.ts          queries, mutations, derived "last backed up"
    BackupNowForm.tsx
    RestoreForm.tsx
    BackupHistory.tsx
    CliCard.tsx
app/a/(app)/settings/backups.tsx
app/a/(app)/settings/index.tsx                 Organization row
core/help/backups.md
docs/single-binary.md                          Backups section
tests/e2e/settings-backups.spec.ts
```

---

### Task 1: Bring in `notify.Administrators`

**Files:**
- Create (by cherry-pick): `core/server/notify/administrators.go`

**Interfaces:**
- Produces: `func Administrators(app core.App, params NotifyParams) (int, error)` — delivers to every non-disabled owner/admin.

- [ ] **Step 1: Create the branch and cherry-pick**

```bash
cd /Users/nas/code/tinycld/tinycld
git checkout -b backups-core
git cherry-pick 353bdd0c
```

Expected: one new file `core/server/notify/administrators.go`. If the pick conflicts, keep the incoming file verbatim.

- [ ] **Step 2: Verify it compiles and its test passes**

Run: `cd core/server && go test ./notify/...`
Expected: PASS.

- [ ] **Step 3: Commit** (the cherry-pick already committed; nothing else to do)

---

### Task 2: `audit.Log` — non-collection audit writes

**Files:**
- Create: `core/server/audit/log.go`
- Test: `core/server/audit/log_test.go`
- Read first: `core/server/audit/audit.go:143-175` (`newAuditRecord`, `setRequestInfo`)

**Interfaces:**
- Produces: `func Log(app core.App, action, resourceType, resourceID, label string, re *core.RequestEvent, metadata map[string]any) error`

- [ ] **Step 1: Write the failing test**

`core/server/audit/log_test.go`:
```go
package audit

import (
    "testing"

    "github.com/pocketbase/pocketbase/core"
    "github.com/pocketbase/pocketbase/tests"
)

func TestLogWritesSystemRowWithoutRequest(t *testing.T) {
    app, err := tests.NewTestApp()
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(app.Cleanup)
    createAuditLogsCollection(t, app) // helper already used by audit_test.go; reuse its name

    if err := Log(app, "backup.created", "backup", "bk_1", "manual backup", nil, map[string]any{"bytes": 42}); err != nil {
        t.Fatal(err)
    }
    rows, err := app.FindRecordsByFilter("audit_logs", "action = 'backup.created'", "", 0, 0)
    if err != nil || len(rows) != 1 {
        t.Fatalf("want 1 row, got %d (%v)", len(rows), err)
    }
    meta := rows[0].Get("metadata").(map[string]any)
    if meta["source"] != "system" || meta["bytes"] != float64(42) {
        t.Fatalf("unexpected metadata %v", meta)
    }
}
```
If `audit_test.go` has no `createAuditLogsCollection` helper, add one in `log_test.go` that builds the `audit_logs` collection with fields `action` (text), `resource_type` (text), `resource_id` (text), `resource_label` (text), `actor` (relation → users), `ip_address` (text), `user_agent` (text), `metadata` (json) — mirror `pb_migrations/1780000000_create_audit_logs.js`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd core/server && go test ./audit/ -run TestLogWritesSystemRow`
Expected: FAIL — `undefined: Log`.

- [ ] **Step 3: Implement**

`core/server/audit/log.go`:
```go
package audit

import (
    "github.com/pocketbase/pocketbase/core"
)

// Log writes one audit row for an action that is not a collection write —
// a job that ran, a file that was exported. re may be nil for a system
// actor; metadata is merged over the request info.
func Log(app core.App, action, resourceType, resourceID, label string, re *core.RequestEvent, metadata map[string]any) error {
    rec := newAuditRecord(app, action, resourceType, resourceID, label)
    setRequestInfo(rec, re)
    if len(metadata) > 0 {
        merged := map[string]any{}
        if existing, ok := rec.Get("metadata").(map[string]any); ok {
            for k, v := range existing {
                merged[k] = v
            }
        }
        for k, v := range metadata {
            merged[k] = v
        }
        rec.Set("metadata", merged)
    }
    return app.Save(rec)
}
```
Check how `setRequestInfo` stores metadata (a `map[string]any` vs a `types.JSONMap`) and adapt the type assertion so the existing `{"source":"system"}` survives.

- [ ] **Step 4: Run tests**

Run: `cd core/server && go test ./audit/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/server/audit/log.go core/server/audit/log_test.go
git commit -m "feat(audit): export Log for non-collection events"
```

---

### Task 3: `backups` collection migration + generated types

**Files:**
- Create: `core/server/pb_migrations/2050000000_create_backups.js`, `core/server/pb_migrations/2050000001_audit_logs_backup_actions.js`
- Modify: `app/a/(app)/settings/audit-log.tsx` (filter options + badge colours)
- Regenerates: `core/types/pbSchema.ts`, `core/types/pbZodSchema.ts` (gitignored, do not commit)

**Interfaces:**
- Produces: collection `backups` with fields `kind`, `status`, `initiated_by`, `started`, `finished`, `bytes`, `sha256`, `manifest`, `target_host`, `error`, `metadata`, `created`, `updated`.

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />
// The backup ledger. Every backup or restore run inserts its row before doing
// any work and always ends in a terminal status, so "last backed up" and the
// history list never need to guess. Server-only writes: clients read.
const ADMIN =
    '@request.auth.id != "" && @request.auth.disabled != true && ' +
    '(@request.auth.role = "owner" || @request.auth.role = "admin")'

migrate(
    app => {
        const col = new Collection({
            id: 'pbc_backups',
            name: 'backups',
            type: 'base',
            system: false,
            listRule: ADMIN,
            viewRule: ADMIN,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                { id: 'bk_kind', name: 'kind', type: 'select', required: true, maxSelect: 1,
                  values: ['manual', 'scheduled', 'pre_restore', 'restore'] },
                { id: 'bk_status', name: 'status', type: 'select', required: true, maxSelect: 1,
                  values: ['running', 'waiting_for_source', 'succeeded', 'failed', 'interrupted'] },
                { id: 'bk_initiated_by', name: 'initiated_by', type: 'relation', required: false,
                  collectionId: '_pb_users_auth_', cascadeDelete: false, maxSelect: 1 },
                { id: 'bk_started', name: 'started', type: 'date', required: true },
                { id: 'bk_finished', name: 'finished', type: 'date' },
                { id: 'bk_bytes', name: 'bytes', type: 'number', min: 0 },
                { id: 'bk_sha256', name: 'sha256', type: 'text', max: 64 },
                { id: 'bk_manifest', name: 'manifest', type: 'json', maxSize: 200000 },
                { id: 'bk_target_host', name: 'target_host', type: 'text', max: 253 },
                { id: 'bk_error', name: 'error', type: 'text', max: 2000 },
                { id: 'bk_metadata', name: 'metadata', type: 'json', maxSize: 20000 },
                { id: 'bk_created', name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
                { id: 'bk_updated', name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            ],
            indexes: ['CREATE INDEX `idx_backups_started` ON `backups` (`started`)'],
        })
        app.save(col)
    },
    app => {
        try {
            app.delete(app.findCollectionByNameOrId('backups'))
        } catch (e) {
            // may not exist
        }
    }
)
```

- [ ] **Step 2: Extend `audit_logs.action` for the backup events**

The released `1780000000_create_audit_logs.js` makes `action` a select of `created|updated|deleted`; `audit.Log` (Task 2) is called with `backup.created`, `backup.failed`, `restore.started`, `restore.succeeded`, `restore.failed` and PocketBase rejects unknown select values on save. Released migrations are frozen, so append `core/server/pb_migrations/2050000001_audit_logs_backup_actions.js` (same shape as `1910000003_pkg_install_log_add_version_change_action.js`):

```js
/// <reference path="../pb_data/types.d.ts" />
// Backups and restores are audited as events, not as collection writes, so
// they need their own action values beside created/updated/deleted.
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('audit_logs')
        const field = collection.fields.getById('al_action')
        field.values = [
            'created', 'updated', 'deleted',
            'backup.created', 'backup.failed',
            'restore.started', 'restore.succeeded', 'restore.failed',
        ]
        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('audit_logs')
        const field = collection.fields.getById('al_action')
        field.values = ['created', 'updated', 'deleted']
        app.save(collection)
    }
)
```

- [ ] **Step 3: Regenerate types and confirm the interfaces**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate && grep -n "interface Backups" core/types/pbSchema.ts && grep -n "backup.created" core/types/pbSchema.ts`
Expected: one match each.

- [ ] **Step 4: Teach the audit-log screen the new actions**

`app/a/(app)/settings/audit-log.tsx` keys its filter options (`ACTION_OPTIONS`, ~line 15) and its badge colour maps (~lines 43-50) on the `action` union; after the regeneration `tsc` fails until every value is covered. Add filter options `Backup created`, `Backup failed`, `Restore started`, `Restore succeeded`, `Restore failed`, and map `backup.created`/`restore.succeeded` to the `created` (success) classes, `backup.failed`/`restore.failed` to the `deleted` (danger) classes, `restore.started` to the `updated` (accent) classes. Run `cd /Users/nas/code/tinycld/tinycld && pnpm run checks` — must pass.

- [ ] **Step 5: Commit**

```bash
git add core/server/pb_migrations/2050000000_create_backups.js core/server/pb_migrations/2050000001_audit_logs_backup_actions.js "app/a/(app)/settings/audit-log.tsx"
git commit -m "feat(core): backups ledger collection and backup audit actions"
```

---

### Task 4: Dependencies

**Files:**
- Modify: `core/server/go.mod`, `core/server/go.sum`, `server/go.mod`, `server/go.sum` (the app's module), `cli/go.mod` is Plan 2's job.

- [ ] **Step 1: Add the modules**

```bash
cd /Users/nas/code/tinycld/tinycld/core/server
go get filippo.io/age@latest github.com/klauspost/compress@latest
go mod tidy
cd ../../server && go mod tidy
```

- [ ] **Step 2: Build everything**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go build ./... && cd ../../server && go build ./...`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add core/server/go.mod core/server/go.sum server/go.mod server/go.sum
git commit -m "build: add age and zstd for backups"
```

---

### Task 5: `format` — manifest, writer, reader, inspect

**Files:**
- Create: `core/server/backup/format/manifest.go`, `writer.go`, `reader.go`, `inspect.go`
- Test: `core/server/backup/format/format_test.go`

**Interfaces:**
- Produces:
```go
const FormatV1 = "tinycld-backup-v1"
type Lockfile map[string]string // slug → spec; "tinycld" is core
type Counts struct { Collections map[string]int `json:"collections"`; Files int `json:"files"`; Bytes int64 `json:"bytes"` }
type Manifest struct {
    Format   string            `json:"format"`
    Created  time.Time         `json:"created"`
    Instance string            `json:"instance"`
    Source   string            `json:"source"`   // hosted | docker | standalone
    Kind     string            `json:"kind"`     // manual | scheduled | pre_restore
    Core     string            `json:"core"`
    Lockfile Lockfile          `json:"lockfile"`
    Packages map[string]string `json:"packages"` // slug → version
    Counts   Counts            `json:"counts"`
}
func NewWriter(w io.Writer, recipient age.Recipient, level zstd.EncoderLevel) (*Writer, error)
func (w *Writer) WriteManifest(m Manifest) error
func (w *Writer) WriteFile(name string, size int64, r io.Reader) error   // name "data.db" or "storage/<key>"
func (w *Writer) Close() error                                            // writes checksums.txt, closes age+zstd
func (w *Writer) Sha256() string                                          // hex of the encrypted stream, valid after Close
func NewReader(r io.Reader, identity age.Identity) (*Reader, error)
func (r *Reader) ReadManifest() (Manifest, error)                         // must be first call
func (r *Reader) Next() (*tar.Header, io.Reader, error)                   // io.EOF at end (before checksums.txt is consumed)
func (r *Reader) Verify() error                                           // after io.EOF: compares sha256 of every member read vs checksums.txt
var ErrChecksum = errors.New("backup: checksum mismatch")
var ErrFormat   = errors.New("backup: not a tinycld backup")
func Inspect(r io.Reader, identity age.Identity) (Manifest, Report, error)
type Report struct { Members []MemberReport; OK bool }
type MemberReport struct { Name string; Size int64; OK bool }
```

- [ ] **Step 1: Write the failing tests**

`core/server/backup/format/format_test.go`:
```go
package format

import (
    "bytes"
    "io"
    "strings"
    "testing"
    "time"

    "filippo.io/age"
    "github.com/klauspost/compress/zstd"
)

func testRecipient(t *testing.T) (age.Recipient, age.Identity) {
    t.Helper()
    id, err := age.GenerateX25519Identity()
    if err != nil {
        t.Fatal(err)
    }
    return id.Recipient(), id
}

func sampleManifest() Manifest {
    return Manifest{
        Format: FormatV1, Created: time.Unix(1_700_000_000, 0).UTC(), Instance: "inst", Source: "docker",
        Kind: "manual", Core: "1.2.3", Lockfile: Lockfile{"tinycld": "1.2.3", "mail": "github:tinycld/mail#v1.0.0"},
        Packages: map[string]string{"mail": "1.0.0"},
        Counts:   Counts{Collections: map[string]int{"users": 2}, Files: 1, Bytes: 5},
    }
}

func buildArchive(t *testing.T, rcpt age.Recipient) []byte {
    t.Helper()
    var buf bytes.Buffer
    w, err := NewWriter(&buf, rcpt, zstd.SpeedDefault)
    if err != nil {
        t.Fatal(err)
    }
    if err := w.WriteManifest(sampleManifest()); err != nil {
        t.Fatal(err)
    }
    if err := w.WriteFile("data.db", 5, strings.NewReader("hello")); err != nil {
        t.Fatal(err)
    }
    if err := w.WriteFile("storage/col/rec/file.txt", 3, strings.NewReader("abc")); err != nil {
        t.Fatal(err)
    }
    if err := w.Close(); err != nil {
        t.Fatal(err)
    }
    return buf.Bytes()
}

func TestRoundTrip(t *testing.T) {
    rcpt, id := testRecipient(t)
    data := buildArchive(t, rcpt)

    r, err := NewReader(bytes.NewReader(data), id)
    if err != nil {
        t.Fatal(err)
    }
    m, err := r.ReadManifest()
    if err != nil || m.Core != "1.2.3" || m.Lockfile["mail"] == "" {
        t.Fatalf("manifest: %+v %v", m, err)
    }
    var names []string
    for {
        hdr, body, err := r.Next()
        if err == io.EOF {
            break
        }
        if err != nil {
            t.Fatal(err)
        }
        b, _ := io.ReadAll(body)
        names = append(names, hdr.Name+":"+string(b))
    }
    if strings.Join(names, ",") != "data.db:hello,storage/col/rec/file.txt:abc" {
        t.Fatalf("members %v", names)
    }
    if err := r.Verify(); err != nil {
        t.Fatal(err)
    }
}

func TestReadManifestStopsEarly(t *testing.T) {
    rcpt, id := testRecipient(t)
    data := buildArchive(t, rcpt)
    counting := &countingReader{r: bytes.NewReader(data)}
    r, err := NewReader(counting, id)
    if err != nil {
        t.Fatal(err)
    }
    if _, err := r.ReadManifest(); err != nil {
        t.Fatal(err)
    }
    if counting.n >= len(data) {
        t.Fatalf("read whole stream (%d of %d) just for the manifest", counting.n, len(data))
    }
}

func TestTamperedMemberFailsVerify(t *testing.T) {
    rcpt, id := testRecipient(t)
    var buf bytes.Buffer
    w, _ := NewWriter(&buf, rcpt, zstd.SpeedDefault)
    _ = w.WriteManifest(sampleManifest())
    _ = w.WriteFile("data.db", 5, strings.NewReader("hello"))
    w.tamperChecksum("data.db") // test hook: corrupt the recorded hash before Close
    _ = w.Close()

    r, _ := NewReader(bytes.NewReader(buf.Bytes()), id)
    _, _ = r.ReadManifest()
    for {
        _, body, err := r.Next()
        if err == io.EOF {
            break
        }
        _, _ = io.Copy(io.Discard, body)
    }
    if err := r.Verify(); err == nil || !errorsIs(err, ErrChecksum) {
        t.Fatalf("want ErrChecksum, got %v", err)
    }
}

func TestTruncatedStreamFails(t *testing.T) {
    rcpt, id := testRecipient(t)
    data := buildArchive(t, rcpt)
    r, err := NewReader(bytes.NewReader(data[:len(data)/2]), id)
    if err != nil {
        return // failing at open is acceptable
    }
    _, _ = r.ReadManifest()
    for {
        _, body, err := r.Next()
        if err != nil {
            if err == io.EOF {
                t.Fatal("truncated stream reported clean EOF")
            }
            return
        }
        if _, err := io.Copy(io.Discard, body); err != nil {
            return
        }
    }
}

func TestWrongIdentityFails(t *testing.T) {
    rcpt, _ := testRecipient(t)
    _, other := testRecipient(t)
    data := buildArchive(t, rcpt)
    if _, err := NewReader(bytes.NewReader(data), other); err == nil {
        t.Fatal("wrong identity opened the archive")
    }
}

func TestNotABackup(t *testing.T) {
    _, id := testRecipient(t)
    if _, err := NewReader(strings.NewReader("garbage"), id); err == nil {
        t.Fatal("garbage opened")
    }
}

func TestInspect(t *testing.T) {
    rcpt, id := testRecipient(t)
    m, rep, err := Inspect(bytes.NewReader(buildArchive(t, rcpt)), id)
    if err != nil || !rep.OK || m.Kind != "manual" || len(rep.Members) != 2 {
        t.Fatalf("%+v %+v %v", m, rep, err)
    }
}

type countingReader struct {
    r io.Reader
    n int
}

func (c *countingReader) Read(p []byte) (int, error) {
    n, err := c.r.Read(p)
    c.n += n
    return n, err
}
```
Add `func errorsIs(err, target error) bool { return errors.Is(err, target) }` with the `errors` import, or call `errors.Is` directly.

- [ ] **Step 2: Run to see failures**

Run: `cd core/server && go test ./backup/format/`
Expected: FAIL — undefined symbols.

- [ ] **Step 3: Implement `manifest.go`**

```go
// Package format is the tinycld-backup-v1 container: a tar stream, zstd
// compressed, age encrypted. It has no PocketBase dependency so the CLI can
// read archives without a server.
package format

import "time"

const FormatV1 = "tinycld-backup-v1"

const (
    MemberManifest  = "manifest.json"
    MemberDB        = "data.db"
    MemberChecksums = "checksums.txt"
    StoragePrefix   = "storage/"
)

// Lockfile is slug → spec. "tinycld" is the core entry.
type Lockfile map[string]string

type Counts struct {
    Collections map[string]int `json:"collections"`
    Files       int            `json:"files"`
    Bytes       int64          `json:"bytes"`
}

type Manifest struct {
    Format   string            `json:"format"`
    Created  time.Time         `json:"created"`
    Instance string            `json:"instance"`
    Source   string            `json:"source"`
    Kind     string            `json:"kind"`
    Core     string            `json:"core"`
    Lockfile Lockfile          `json:"lockfile"`
    Packages map[string]string `json:"packages"`
    Counts   Counts            `json:"counts"`
}
```

- [ ] **Step 4: Implement `writer.go`**

```go
package format

import (
    "archive/tar"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "hash"
    "io"
    "sort"
    "strings"
    "time"

    "filippo.io/age"
    "github.com/klauspost/compress/zstd"
)

// Writer streams one archive. Members must be written in the fixed order:
// WriteManifest, then data.db and storage files via WriteFile, then Close.
type Writer struct {
    outerHash hash.Hash // sha256 of the encrypted bytes, reported to the ledger
    ageW      io.WriteCloser
    zstdW     *zstd.Encoder
    tarW      *tar.Writer
    sums      map[string]string
    order     []string
    started   bool
    closed    bool
}

func NewWriter(w io.Writer, recipient age.Recipient, level zstd.EncoderLevel) (*Writer, error) {
    h := sha256.New()
    ageW, err := age.Encrypt(io.MultiWriter(w, h), recipient)
    if err != nil {
        return nil, fmt.Errorf("backup: encrypt: %w", err)
    }
    zw, err := zstd.NewWriter(ageW, zstd.WithEncoderLevel(level))
    if err != nil {
        return nil, fmt.Errorf("backup: compress: %w", err)
    }
    return &Writer{outerHash: h, ageW: ageW, zstdW: zw, tarW: tar.NewWriter(zw), sums: map[string]string{}}, nil
}

func (w *Writer) WriteManifest(m Manifest) error {
    if w.started {
        return fmt.Errorf("backup: manifest must be the first member")
    }
    w.started = true
    m.Format = FormatV1
    body, err := json.MarshalIndent(m, "", "  ")
    if err != nil {
        return err
    }
    return w.WriteFile(MemberManifest, int64(len(body)), strings.NewReader(string(body)))
}

func (w *Writer) WriteFile(name string, size int64, r io.Reader) error {
    if !w.started {
        return fmt.Errorf("backup: write the manifest first")
    }
    hdr := &tar.Header{Name: name, Mode: 0o600, Size: size, ModTime: time.Now().UTC(), Typeflag: tar.TypeReg}
    if err := w.tarW.WriteHeader(hdr); err != nil {
        return err
    }
    h := sha256.New()
    n, err := io.Copy(io.MultiWriter(w.tarW, h), r)
    if err != nil {
        return err
    }
    if n != size {
        return fmt.Errorf("backup: %s: wrote %d bytes, header said %d", name, n, size)
    }
    w.sums[name] = hex.EncodeToString(h.Sum(nil))
    w.order = append(w.order, name)
    return nil
}

func (w *Writer) Close() error {
    if w.closed {
        return nil
    }
    w.closed = true
    var b strings.Builder
    for _, name := range w.order {
        fmt.Fprintf(&b, "%s  %s\n", w.sums[name], name)
    }
    body := b.String()
    hdr := &tar.Header{Name: MemberChecksums, Mode: 0o600, Size: int64(len(body)), ModTime: time.Now().UTC(), Typeflag: tar.TypeReg}
    if err := w.tarW.WriteHeader(hdr); err != nil {
        return err
    }
    if _, err := io.WriteString(w.tarW, body); err != nil {
        return err
    }
    if err := w.tarW.Close(); err != nil {
        return err
    }
    if err := w.zstdW.Close(); err != nil {
        return err
    }
    return w.ageW.Close()
}

func (w *Writer) Sha256() string { return hex.EncodeToString(w.outerHash.Sum(nil)) }

// tamperChecksum corrupts a recorded hash. Test-only; keeps the tamper test
// honest without a second code path for writing archives.
func (w *Writer) tamperChecksum(name string) { w.sums[name] = strings.Repeat("0", 64) }

var _ = sort.Strings
```
Remove the `sort` import and the `var _` line if unused.

- [ ] **Step 5: Implement `reader.go`**

```go
package format

import (
    "archive/tar"
    "bufio"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "fmt"
    "hash"
    "io"
    "strings"

    "filippo.io/age"
    "github.com/klauspost/compress/zstd"
)

var (
    ErrChecksum = errors.New("backup: checksum mismatch")
    ErrFormat   = errors.New("backup: not a tinycld backup")
)

type Reader struct {
    zstdR   *zstd.Decoder
    tarR    *tar.Reader
    sums    map[string]string // computed as members are read
    current *memberReader
    done    bool
    recorded map[string]string // parsed from checksums.txt
}

type memberReader struct {
    name string
    r    io.Reader
    h    hash.Hash
}

func (m *memberReader) Read(p []byte) (int, error) { return m.r.Read(p) }

func NewReader(r io.Reader, identity age.Identity) (*Reader, error) {
    ageR, err := age.Decrypt(r, identity)
    if err != nil {
        return nil, fmt.Errorf("%w: %v", ErrFormat, err)
    }
    zr, err := zstd.NewReader(ageR)
    if err != nil {
        return nil, fmt.Errorf("%w: %v", ErrFormat, err)
    }
    return &Reader{zstdR: zr, tarR: tar.NewReader(zr), sums: map[string]string{}}, nil
}

// ReadManifest reads only the first member. Calling it consumes nothing past
// the manifest, so a caller can inspect and stop.
func (r *Reader) ReadManifest() (Manifest, error) {
    hdr, body, err := r.Next()
    if err != nil {
        return Manifest{}, fmt.Errorf("%w: %v", ErrFormat, err)
    }
    if hdr.Name != MemberManifest {
        return Manifest{}, fmt.Errorf("%w: first member is %q", ErrFormat, hdr.Name)
    }
    var m Manifest
    if err := json.NewDecoder(body).Decode(&m); err != nil {
        return Manifest{}, fmt.Errorf("%w: manifest: %v", ErrFormat, err)
    }
    if m.Format != FormatV1 {
        return Manifest{}, fmt.Errorf("%w: format %q", ErrFormat, m.Format)
    }
    return m, nil
}

// Next advances to the next data member. checksums.txt is consumed
// internally and reported as io.EOF.
func (r *Reader) Next() (*tar.Header, io.Reader, error) {
    if r.done {
        return nil, nil, io.EOF
    }
    r.finishCurrent()
    hdr, err := r.tarR.Next()
    if err != nil {
        if err == io.EOF {
            return nil, nil, fmt.Errorf("%w: stream ended before checksums", ErrFormat)
        }
        return nil, nil, err
    }
    if hdr.Name == MemberChecksums {
        if err := r.parseChecksums(); err != nil {
            return nil, nil, err
        }
        r.done = true
        return nil, nil, io.EOF
    }
    h := sha256.New()
    r.current = &memberReader{name: hdr.Name, r: io.TeeReader(r.tarR, h), h: h}
    return hdr, r.current, nil
}

// finishCurrent drains an unread remainder so the hash covers the whole member.
func (r *Reader) finishCurrent() {
    if r.current == nil {
        return
    }
    _, _ = io.Copy(io.Discard, r.current)
    r.sums[r.current.name] = hex.EncodeToString(r.current.h.Sum(nil))
    r.current = nil
}

func (r *Reader) parseChecksums() error {
    r.recorded = map[string]string{}
    sc := bufio.NewScanner(r.tarR)
    for sc.Scan() {
        sum, name, ok := strings.Cut(sc.Text(), "  ")
        if !ok {
            return fmt.Errorf("%w: bad checksum line", ErrFormat)
        }
        r.recorded[name] = sum
    }
    return sc.Err()
}

// Verify compares every member read against checksums.txt. Valid only after
// Next returned io.EOF.
func (r *Reader) Verify() error {
    if !r.done {
        return fmt.Errorf("backup: verify called before end of stream")
    }
    for name, want := range r.recorded {
        got, ok := r.sums[name]
        if !ok {
            return fmt.Errorf("%w: %s not read", ErrChecksum, name)
        }
        if got != want {
            return fmt.Errorf("%w: %s", ErrChecksum, name)
        }
    }
    return nil
}

func (r *Reader) Close() { r.zstdR.Close() }
```

- [ ] **Step 6: Implement `inspect.go`**

```go
package format

import (
    "io"

    "filippo.io/age"
)

type MemberReport struct {
    Name string `json:"name"`
    Size int64  `json:"size"`
    OK   bool   `json:"ok"`
}

type Report struct {
    Members []MemberReport `json:"members"`
    OK      bool           `json:"ok"`
}

// Inspect reads a whole archive, verifying every member, without writing
// anything. It is what `tinycld backup inspect` runs.
func Inspect(r io.Reader, identity age.Identity) (Manifest, Report, error) {
    rd, err := NewReader(r, identity)
    if err != nil {
        return Manifest{}, Report{}, err
    }
    defer rd.Close()
    m, err := rd.ReadManifest()
    if err != nil {
        return Manifest{}, Report{}, err
    }
    var rep Report
    for {
        hdr, body, err := rd.Next()
        if err == io.EOF {
            break
        }
        if err != nil {
            return m, rep, err
        }
        if _, err := io.Copy(io.Discard, body); err != nil {
            return m, rep, err
        }
        rep.Members = append(rep.Members, MemberReport{Name: hdr.Name, Size: hdr.Size})
    }
    verr := rd.Verify()
    rep.OK = verr == nil
    for i := range rep.Members {
        rep.Members[i].OK = rd.sums[rep.Members[i].Name] == rd.recorded[rep.Members[i].Name]
    }
    return m, rep, verr
}
```
Note: `Inspect` returns the manifest and the report even on a checksum error, so the CLI prints what it can. `TestInspect` expects `len(rep.Members) == 2` — manifest.json is read via `ReadManifest`, not counted; `data.db` and the storage file are.

- [ ] **Step 7: Run tests**

Run: `cd core/server && go test ./backup/format/ -v`
Expected: all PASS. If `TestReadManifestStopsEarly` fails because zstd/age read-ahead buffers pull the whole small archive, enlarge the test archive: write a 4 MiB `data.db` member (`bytes.Repeat`) so read-ahead cannot cover it, and keep the assertion.

- [ ] **Step 8: Commit**

```bash
git add core/server/backup/format/
git commit -m "feat(backup): tinycld-backup-v1 container reader and writer"
```

---

### Task 6: `format` — resumable source and PUT sink

**Files:**
- Create: `core/server/backup/format/source.go`, `sink.go`
- Test: `core/server/backup/format/transport_test.go`

**Interfaces:**
- Produces:
```go
var ErrSourceExpired = errors.New("backup: source URL expired")     // 401/403 on a retry
var ErrNoResume      = errors.New("backup: source does not support resume")
type RangeSource struct{ … }
func NewRangeSource(ctx context.Context, url string) *RangeSource     // implements io.ReadCloser
func (s *RangeSource) SwapURL(url string)                             // unblocks a Read waiting on ErrSourceExpired
func (s *RangeSource) Offset() int64                                  // bytes delivered so far
func (s *RangeSource) SetExpiryWait(d time.Duration)                  // how long Read blocks for SwapURL (default 15m)
func NewPutSink(ctx context.Context, url string) io.WriteCloser       // Close waits for the 2xx
func NoRedirectClient() *http.Client
```

- [ ] **Step 1: Write the failing tests**

`core/server/backup/format/transport_test.go`:
```go
package format

import (
    "bytes"
    "context"
    "errors"
    "io"
    "net/http"
    "net/http/httptest"
    "strconv"
    "strings"
    "sync/atomic"
    "testing"
    "time"
)

var payload = bytes.Repeat([]byte("0123456789abcdef"), 4096) // 64 KiB

// rangeServer serves payload with Range support and drops the connection
// after dropAfter bytes on the first request only.
func rangeServer(t *testing.T, dropAfter int, supportRange bool) (*httptest.Server, *int32) {
    t.Helper()
    var calls int32
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := atomic.AddInt32(&calls, 1)
        w.Header().Set("ETag", `"v1"`)
        start := 0
        if rh := r.Header.Get("Range"); rh != "" && supportRange {
            start, _ = strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(rh, "bytes="), "-"))
            w.Header().Set("Content-Range", "bytes "+strconv.Itoa(start)+"-"+strconv.Itoa(len(payload)-1)+"/"+strconv.Itoa(len(payload)))
            w.WriteHeader(http.StatusPartialContent)
        }
        body := payload[start:]
        if n == 1 && dropAfter > 0 && dropAfter < len(body) {
            _, _ = w.Write(body[:dropAfter])
            if f, ok := w.(http.Flusher); ok {
                f.Flush()
            }
            hj, ok := w.(http.Hijacker)
            if ok {
                conn, _, _ := hj.Hijack()
                _ = conn.Close()
            }
            return
        }
        _, _ = w.Write(body)
    }))
    t.Cleanup(srv.Close)
    return srv, &calls
}

func TestRangeSourceResumesAfterDrop(t *testing.T) {
    srv, calls := rangeServer(t, 10_000, true)
    src := NewRangeSource(context.Background(), srv.URL)
    got, err := io.ReadAll(src)
    if err != nil {
        t.Fatal(err)
    }
    if !bytes.Equal(got, payload) {
        t.Fatalf("payload mismatch: %d vs %d bytes", len(got), len(payload))
    }
    if atomic.LoadInt32(calls) < 2 {
        t.Fatal("expected a resume request")
    }
}

func TestRangeSourceRejectsNoRange(t *testing.T) {
    srv, _ := rangeServer(t, 10_000, false)
    src := NewRangeSource(context.Background(), srv.URL)
    _, err := io.ReadAll(src)
    if !errors.Is(err, ErrNoResume) {
        t.Fatalf("want ErrNoResume, got %v", err)
    }
}

func TestRangeSourceSwapURLOnExpiry(t *testing.T) {
    var calls int32
    good, _ := rangeServer(t, 0, true)
    expired := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := atomic.AddInt32(&calls, 1)
        if n == 1 {
            w.Header().Set("ETag", `"v1"`)
            _, _ = w.Write(payload[:5000])
            if hj, ok := w.(http.Hijacker); ok {
                c, _, _ := hj.Hijack()
                _ = c.Close()
            }
            return
        }
        w.WriteHeader(http.StatusForbidden)
    }))
    t.Cleanup(expired.Close)

    src := NewRangeSource(context.Background(), expired.URL)
    src.SetExpiryWait(2 * time.Second)
    go func() {
        time.Sleep(300 * time.Millisecond)
        src.SwapURL(good.URL)
    }()
    got, err := io.ReadAll(src)
    if err != nil {
        t.Fatal(err)
    }
    if !bytes.Equal(got, payload) {
        t.Fatal("payload mismatch after swap")
    }
}

func TestRangeSourceExpiryTimeout(t *testing.T) {
    var calls int32
    expired := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if atomic.AddInt32(&calls, 1) == 1 {
            w.Header().Set("ETag", `"v1"`)
            _, _ = w.Write(payload[:5000])
            if hj, ok := w.(http.Hijacker); ok {
                c, _, _ := hj.Hijack()
                _ = c.Close()
            }
            return
        }
        w.WriteHeader(http.StatusForbidden)
    }))
    t.Cleanup(expired.Close)
    src := NewRangeSource(context.Background(), expired.URL)
    src.SetExpiryWait(200 * time.Millisecond)
    _, err := io.ReadAll(src)
    if !errors.Is(err, ErrSourceExpired) {
        t.Fatalf("want ErrSourceExpired, got %v", err)
    }
}

func TestNoRedirects(t *testing.T) {
    target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(payload) }))
    t.Cleanup(target.Close)
    redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        http.Redirect(w, r, target.URL, http.StatusFound)
    }))
    t.Cleanup(redir.Close)
    src := NewRangeSource(context.Background(), redir.URL)
    if _, err := io.ReadAll(src); err == nil {
        t.Fatal("redirect was followed")
    }
}

func TestPutSinkStreams(t *testing.T) {
    var received bytes.Buffer
    var method string
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        method = r.Method
        _, _ = io.Copy(&received, r.Body)
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(srv.Close)
    sink := NewPutSink(context.Background(), srv.URL)
    if _, err := sink.Write(payload); err != nil {
        t.Fatal(err)
    }
    if err := sink.Close(); err != nil {
        t.Fatal(err)
    }
    if method != http.MethodPut || !bytes.Equal(received.Bytes(), payload) {
        t.Fatalf("method %s, %d bytes", method, received.Len())
    }
}

func TestPutSinkReportsNon2xx(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        _, _ = io.Copy(io.Discard, r.Body)
        w.WriteHeader(http.StatusForbidden)
    }))
    t.Cleanup(srv.Close)
    sink := NewPutSink(context.Background(), srv.URL)
    _, _ = sink.Write(payload)
    if err := sink.Close(); err == nil {
        t.Fatal("403 not reported")
    }
}
```

- [ ] **Step 2: Run to see failures**

Run: `cd core/server && go test ./backup/format/ -run 'RangeSource|Redirect|PutSink'`
Expected: FAIL — undefined.

- [ ] **Step 3: Implement `source.go`**

```go
package format

import (
    "context"
    "errors"
    "fmt"
    "io"
    "net/http"
    "strconv"
    "sync"
    "time"
)

var (
    ErrSourceExpired = errors.New("backup: source URL expired")
    ErrNoResume      = errors.New("backup: source does not support resume")
)

// NoRedirectClient never follows a redirect: a presigned URL that redirects
// would leak its signature to the next host.
func NoRedirectClient() *http.Client {
    return &http.Client{
        CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
    }
}

// RangeSource reads a URL as one continuous stream and transparently resumes
// with Range requests after a dropped connection. When the URL has expired
// (401/403 on a retry) Read blocks until SwapURL provides a fresh one or the
// expiry wait elapses.
type RangeSource struct {
    ctx        context.Context
    client     *http.Client
    mu         sync.Mutex
    url        string
    swapped    chan struct{}
    body       io.ReadCloser
    offset     int64
    etag       string
    retries    int
    expiryWait time.Duration
}

const maxRetries = 8

func NewRangeSource(ctx context.Context, url string) *RangeSource {
    return &RangeSource{ctx: ctx, client: NoRedirectClient(), url: url, swapped: make(chan struct{}, 1), expiryWait: 15 * time.Minute}
}

func (s *RangeSource) SetExpiryWait(d time.Duration) { s.expiryWait = d }

func (s *RangeSource) Offset() int64 {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.offset
}

func (s *RangeSource) SwapURL(url string) {
    s.mu.Lock()
    s.url = url
    s.mu.Unlock()
    select {
    case s.swapped <- struct{}{}:
    default:
    }
}

func (s *RangeSource) Read(p []byte) (int, error) {
    for {
        if s.body == nil {
            if err := s.open(); err != nil {
                return 0, err
            }
        }
        n, err := s.body.Read(p)
        s.mu.Lock()
        s.offset += int64(n)
        s.mu.Unlock()
        if err == nil || err == io.EOF {
            return n, err
        }
        // Connection dropped mid-body: close and let the next loop reopen.
        _ = s.body.Close()
        s.body = nil
        s.retries++
        if s.retries > maxRetries {
            return n, fmt.Errorf("backup: source gave up after %d retries: %w", maxRetries, err)
        }
        if n > 0 {
            return n, nil
        }
        time.Sleep(backoff(s.retries))
    }
}

func backoff(attempt int) time.Duration {
    d := time.Duration(1<<uint(attempt-1)) * 250 * time.Millisecond
    if d > 10*time.Second {
        d = 10 * time.Second
    }
    return d
}

func (s *RangeSource) open() error {
    for {
        s.mu.Lock()
        url, offset, etag := s.url, s.offset, s.etag
        s.mu.Unlock()
        req, err := http.NewRequestWithContext(s.ctx, http.MethodGet, url, nil)
        if err != nil {
            return err
        }
        if offset > 0 {
            req.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
            if etag != "" {
                req.Header.Set("If-Range", etag)
            }
        }
        res, err := s.client.Do(req)
        if err != nil {
            return err
        }
        switch {
        case offset == 0 && res.StatusCode == http.StatusOK:
            s.mu.Lock()
            s.etag = res.Header.Get("ETag")
            s.mu.Unlock()
            s.body = res.Body
            return nil
        case offset > 0 && res.StatusCode == http.StatusPartialContent:
            s.body = res.Body
            return nil
        case offset > 0 && res.StatusCode == http.StatusOK:
            _ = res.Body.Close()
            return ErrNoResume
        case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
            _ = res.Body.Close()
            if err := s.waitForSwap(); err != nil {
                return err
            }
            continue
        case res.StatusCode >= 300 && res.StatusCode < 400:
            _ = res.Body.Close()
            return fmt.Errorf("backup: source redirected (%d); redirects are not followed", res.StatusCode)
        default:
            _ = res.Body.Close()
            return fmt.Errorf("backup: source returned %d", res.StatusCode)
        }
    }
}

func (s *RangeSource) waitForSwap() error {
    select {
    case <-s.swapped:
        return nil
    case <-time.After(s.expiryWait):
        return ErrSourceExpired
    case <-s.ctx.Done():
        return s.ctx.Err()
    }
}

func (s *RangeSource) Close() error {
    if s.body != nil {
        return s.body.Close()
    }
    return nil
}
```
Note: on the very first request a 401/403 also waits for a swap — consistent, and the engine reports it as `waiting_for_source` either way.

- [ ] **Step 4: Implement `sink.go`**

```go
package format

import (
    "context"
    "fmt"
    "io"
    "net/http"
)

type putSink struct {
    pw   *io.PipeWriter
    done chan error
}

// NewPutSink streams everything written to it as the body of one HTTP PUT.
// Close waits for the response and reports a non-2xx as an error.
func NewPutSink(ctx context.Context, url string) io.WriteCloser {
    pr, pw := io.Pipe()
    done := make(chan error, 1)
    go func() {
        req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, pr)
        if err != nil {
            _ = pr.CloseWithError(err)
            done <- err
            return
        }
        req.Header.Set("Content-Type", "application/octet-stream")
        res, err := NoRedirectClient().Do(req)
        if err != nil {
            _ = pr.CloseWithError(err)
            done <- err
            return
        }
        _, _ = io.Copy(io.Discard, res.Body)
        _ = res.Body.Close()
        if res.StatusCode < 200 || res.StatusCode >= 300 {
            err = fmt.Errorf("backup: target returned %d", res.StatusCode)
            _ = pr.CloseWithError(err)
            done <- err
            return
        }
        done <- nil
    }()
    return &putSink{pw: pw, done: done}
}

func (s *putSink) Write(p []byte) (int, error) { return s.pw.Write(p) }

func (s *putSink) Close() error {
    if err := s.pw.Close(); err != nil {
        return err
    }
    return <-s.done
}
```
A presigned S3 PUT needs `Content-Length` when the URL was signed with it; most presigners do not sign it, and chunked PUT is accepted by S3-compatible stores. Document in the help topic that the URL must be presigned without a content-length condition.

- [ ] **Step 5: Run tests**

Run: `cd core/server && go test ./backup/format/ -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/format/source.go core/server/backup/format/sink.go core/server/backup/format/transport_test.go
git commit -m "feat(backup): resumable GET source and streaming PUT sink"
```

---

### Task 7: Engine — ledger, snapshot, daily limit, `Run`

**Files:**
- Create: `core/server/backup/ledger.go`, `snapshot.go`, `limit.go`, `engine.go`, `testapp_test.go`
- Test: `core/server/backup/engine_test.go`

**Interfaces:**
- Consumes: `format.NewWriter`, `format.Manifest`, `notify.Administrators`, `audit.Log`, `installjob.New/Claim/Release`.
- Produces:
```go
package backup

type Kind string
const (
    KindManual     Kind = "manual"
    KindScheduled  Kind = "scheduled"
    KindPreRestore Kind = "pre_restore"
    KindRestore    Kind = "restore"
)
type Request struct {
    Kind      Kind
    Recipient age.Recipient
    Sink      io.WriteCloser
    Initiator string          // users id or ""
    Callback  string          // optional URL; finished row POSTed as JSON
    TargetHost string         // hostname for the ledger; "" for a stream
    Request   *core.RequestEvent // optional; audit request info
}
var ErrBusy      = errors.New("backup: another job is running")
var ErrRateLimit = errors.New("backup: daily manual backup limit reached")
func Run(app core.App, req Request) (id string, err error)           // synchronous; returns when the sink is closed
func Start(app core.App, req Request) (id string, err error)         // async: row inserted, goroutine runs Run
func SetSource(s string)                                              // "docker" | "standalone" | anything an embedder chooses; default "docker"
func SetDailyLimit(fn func(app core.App) int)                         // claim-once; default 10
func MarkInterrupted(app core.App, bootedAt time.Time) error          // rows still running from before bootedAt → interrupted
func LedgerPath(app core.App) string                                   // Dir(app.DataDir())
```

- [ ] **Step 1: Shared test app helper**

`core/server/backup/testapp_test.go`:
```go
package backup

import (
    "os"
    "path/filepath"
    "testing"

    "github.com/pocketbase/pocketbase/core"
    "github.com/pocketbase/pocketbase/tests"
)

// newTestApp boots the PB fixture and adds the tinycld collections the engine
// touches. Collections mirror the migrations in core/server/pb_migrations.
func newTestApp(t *testing.T) *tests.TestApp {
    t.Helper()
    app, err := tests.NewTestApp()
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(app.Cleanup)
    users, err := app.FindCollectionByNameOrId("users")
    if err != nil {
        t.Fatal(err)
    }
    if users.Fields.GetByName("role") == nil {
        users.Fields.Add(&core.SelectField{Name: "role", Values: []string{"owner", "admin", "member", "guest"}, MaxSelect: 1})
        users.Fields.Add(&core.BoolField{Name: "disabled"})
        if err := app.Save(users); err != nil {
            t.Fatal(err)
        }
    }
    mustCreate := func(c *core.Collection) {
        if err := app.Save(c); err != nil {
            t.Fatalf("create %s: %v", c.Name, err)
        }
    }
    backups := core.NewBaseCollection("backups")
    backups.Fields.Add(
        &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"manual", "scheduled", "pre_restore", "restore"}},
        &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"running", "waiting_for_source", "succeeded", "failed", "interrupted"}},
        &core.RelationField{Name: "initiated_by", CollectionId: users.Id, MaxSelect: 1},
        &core.DateField{Name: "started", Required: true},
        &core.DateField{Name: "finished"},
        &core.NumberField{Name: "bytes"},
        &core.TextField{Name: "sha256"},
        &core.JSONField{Name: "manifest", MaxSize: 200000},
        &core.TextField{Name: "target_host"},
        &core.TextField{Name: "error"},
        &core.JSONField{Name: "metadata", MaxSize: 20000},
        &core.AutodateField{Name: "created", OnCreate: true},
        &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
    )
    mustCreate(backups)

    reg := core.NewBaseCollection("pkg_registry")
    reg.Fields.Add(
        &core.TextField{Name: "name"}, &core.TextField{Name: "slug", Required: true},
        &core.TextField{Name: "npm_package"}, &core.TextField{Name: "version"},
        &core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"bundled", "available", "installed", "disabled"}},
    )
    mustCreate(reg)
    addRegistry := func(slug, version, spec, status string) {
        r := core.NewRecord(reg)
        r.Set("name", slug)
        r.Set("slug", slug)
        r.Set("version", version)
        r.Set("npm_package", spec)
        r.Set("status", status)
        if err := app.Save(r); err != nil {
            t.Fatal(err)
        }
    }
    addRegistry("core", "1.2.3", "tinycld@1.2.3", "bundled")
    addRegistry("mail", "1.0.0", "@tinycld/mail@1.0.0", "installed")

    notifs := core.NewBaseCollection("notifications")
    notifs.Fields.Add(
        &core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1},
        &core.TextField{Name: "type"}, &core.TextField{Name: "package"}, &core.TextField{Name: "title"},
        &core.TextField{Name: "body"}, &core.TextField{Name: "url"}, &core.JSONField{Name: "metadata", MaxSize: 20000},
        &core.BoolField{Name: "read"}, &core.BoolField{Name: "dismissed"},
    )
    mustCreate(notifs)

    audit := core.NewBaseCollection("audit_logs")
    audit.Fields.Add(
        &core.TextField{Name: "action"}, &core.TextField{Name: "resource_type"}, &core.TextField{Name: "resource_id"},
        &core.TextField{Name: "resource_label"}, &core.RelationField{Name: "actor", CollectionId: users.Id, MaxSelect: 1},
        &core.TextField{Name: "ip_address"}, &core.TextField{Name: "user_agent"}, &core.JSONField{Name: "metadata", MaxSize: 20000},
    )
    mustCreate(audit)

    // A file in local storage so the walk has something to copy.
    storageDir := filepath.Join(app.DataDir(), "storage", "col1", "rec1")
    if err := os.MkdirAll(storageDir, 0o755); err != nil {
        t.Fatal(err)
    }
    if err := os.WriteFile(filepath.Join(storageDir, "hello.txt"), []byte("hello file"), 0o644); err != nil {
        t.Fatal(err)
    }
    return app
}

func makeUser(t *testing.T, app core.App, email, role string) *core.Record {
    t.Helper()
    users, _ := app.FindCollectionByNameOrId("users")
    u := core.NewRecord(users)
    u.SetEmail(email)
    u.SetPassword("password12345")
    u.Set("role", role)
    u.Set("username", email[:len(email)-len("@example.com")])
    if err := app.Save(u); err != nil {
        t.Fatal(err)
    }
    return u
}
```
If the PB fixture's `users` already has `role`, keep the guard. If `notify.Administrators` requires other fields on `users`, add them here.

- [ ] **Step 2: Write the failing engine tests**

`core/server/backup/engine_test.go`:
```go
package backup

import (
    "bytes"
    "errors"
    "io"
    "testing"
    "time"

    "filippo.io/age"
    "tinycld.org/core/backup/format"
    "tinycld.org/core/installjob"
)

type closeBuffer struct {
    bytes.Buffer
    closed bool
}

func (c *closeBuffer) Close() error { c.closed = true; return nil }

func TestRunWritesRowFirstThenArchive(t *testing.T) {
    app := newTestApp(t)
    owner := makeUser(t, app, "owner@example.com", "owner")
    id, err := age.GenerateX25519Identity()
    if err != nil {
        t.Fatal(err)
    }
    sink := &closeBuffer{}

    rowID, err := Run(app, Request{Kind: KindManual, Recipient: id.Recipient(), Sink: sink, Initiator: owner.Id, TargetHost: "example.com"})
    if err != nil {
        t.Fatal(err)
    }
    row, err := app.FindRecordById("backups", rowID)
    if err != nil {
        t.Fatal(err)
    }
    if row.GetString("status") != "succeeded" || row.GetString("kind") != "manual" || row.GetString("initiated_by") != owner.Id {
        t.Fatalf("row %v", row.PublicExport())
    }
    if row.GetInt("bytes") != sink.Len() || row.GetString("sha256") == "" || !sink.closed {
        t.Fatalf("bytes %d vs %d, sha %q, closed %v", row.GetInt("bytes"), sink.Len(), row.GetString("sha256"), sink.closed)
    }
    if row.GetString("target_host") != "example.com" {
        t.Fatalf("target_host %q", row.GetString("target_host"))
    }

    m, rep, err := format.Inspect(bytes.NewReader(sink.Bytes()), id)
    if err != nil || !rep.OK {
        t.Fatalf("inspect: %v %+v", err, rep)
    }
    if m.Lockfile["tinycld"] != "tinycld@1.2.3" || m.Lockfile["mail"] != "@tinycld/mail@1.0.0" || m.Packages["mail"] != "1.0.0" || m.Core != "1.2.3" {
        t.Fatalf("manifest %+v", m)
    }
    if m.Counts.Files != 1 || m.Counts.Collections["users"] != 1 {
        t.Fatalf("counts %+v", m.Counts)
    }
    var names []string
    for _, mem := range rep.Members {
        names = append(names, mem.Name)
    }
    if names[0] != "data.db" || names[1] != "storage/col1/rec1/hello.txt" {
        t.Fatalf("members %v", names)
    }

    notifs, _ := app.FindRecordsByFilter("notifications", "type = 'core.backup.succeeded'", "", 0, 0)
    if len(notifs) != 1 {
        t.Fatalf("want 1 notification, got %d", len(notifs))
    }
    audits, _ := app.FindRecordsByFilter("audit_logs", "action = 'backup.created'", "", 0, 0)
    if len(audits) != 1 {
        t.Fatalf("want 1 audit row, got %d", len(audits))
    }
}

type failingSink struct{ n int }

func (f *failingSink) Write(p []byte) (int, error) {
    f.n += len(p)
    if f.n > 1024 {
        return 0, errors.New("disk full")
    }
    return len(p), nil
}
func (f *failingSink) Close() error { return nil }

func TestRunRecordsFailure(t *testing.T) {
    app := newTestApp(t)
    makeUser(t, app, "owner@example.com", "owner")
    id, _ := age.GenerateX25519Identity()
    rowID, err := Run(app, Request{Kind: KindManual, Recipient: id.Recipient(), Sink: &failingSink{}})
    if err == nil {
        t.Fatal("expected error")
    }
    row, _ := app.FindRecordById("backups", rowID)
    if row.GetString("status") != "failed" || row.GetString("error") == "" {
        t.Fatalf("row %v", row.PublicExport())
    }
    notifs, _ := app.FindRecordsByFilter("notifications", "type = 'core.backup.failed'", "", 0, 0)
    if len(notifs) != 1 {
        t.Fatalf("want failure notification, got %d", len(notifs))
    }
    if entries, _ := os.ReadDir(tmpDir(app)); len(entries) != 0 {
        t.Fatalf("temp dir not clean: %v", entries)
    }
}

func TestRunRefusesWhileJobRunning(t *testing.T) {
    app := newTestApp(t)
    other := installjob.New("install", "x", "x")
    if _, ok := installjob.Claim(other); !ok {
        t.Fatal("claim")
    }
    t.Cleanup(func() { installjob.Release(other) })
    id, _ := age.GenerateX25519Identity()
    _, err := Run(app, Request{Kind: KindManual, Recipient: id.Recipient(), Sink: &closeBuffer{}})
    if !errors.Is(err, ErrBusy) {
        t.Fatalf("want ErrBusy, got %v", err)
    }
}

func TestDailyLimitAppliesToManualOnly(t *testing.T) {
    app := newTestApp(t)
    resetDailyLimitForTesting()
    SetDailyLimit(func(core.App) int { return 1 })
    id, _ := age.GenerateX25519Identity()
    if _, err := Run(app, Request{Kind: KindManual, Recipient: id.Recipient(), Sink: &closeBuffer{}, Initiator: "u1"}); err != nil {
        t.Fatal(err)
    }
    _, err := Run(app, Request{Kind: KindManual, Recipient: id.Recipient(), Sink: &closeBuffer{}, Initiator: "u1"})
    if !errors.Is(err, ErrRateLimit) {
        t.Fatalf("want ErrRateLimit, got %v", err)
    }
    if _, err := Run(app, Request{Kind: KindScheduled, Recipient: id.Recipient(), Sink: &closeBuffer{}}); err != nil {
        t.Fatalf("scheduled must be exempt: %v", err)
    }
}

func TestMarkInterrupted(t *testing.T) {
    app := newTestApp(t)
    row := newRow(app, KindManual, "", "")
    if err := app.Save(row); err != nil {
        t.Fatal(err)
    }
    if err := MarkInterrupted(app, time.Now().Add(time.Second)); err != nil {
        t.Fatal(err)
    }
    got, _ := app.FindRecordById("backups", row.Id)
    if got.GetString("status") != "interrupted" {
        t.Fatalf("status %q", got.GetString("status"))
    }
}

func TestCallbackReceivesRow(t *testing.T) {
    app := newTestApp(t)
    var body []byte
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        body, _ = io.ReadAll(r.Body)
        w.WriteHeader(204)
    }))
    t.Cleanup(srv.Close)
    id, _ := age.GenerateX25519Identity()
    rowID, err := Run(app, Request{Kind: KindScheduled, Recipient: id.Recipient(), Sink: &closeBuffer{}, Callback: srv.URL})
    if err != nil {
        t.Fatal(err)
    }
    if !bytes.Contains(body, []byte(rowID)) || !bytes.Contains(body, []byte(`"status":"succeeded"`)) {
        t.Fatalf("callback body %s", body)
    }
}
```
Add imports `net/http`, `net/http/httptest`, `os`, and `github.com/pocketbase/pocketbase/core` as needed.

- [ ] **Step 3: Run to see failures**

Run: `cd core/server && go test ./backup/ 2>&1 | head`
Expected: compile errors — undefined `Run`, `newRow`, etc.

- [ ] **Step 4: Implement `ledger.go`**

```go
package backup

import (
    "net/url"
    "path/filepath"
    "time"

    "github.com/pocketbase/pocketbase/core"
    "github.com/pocketbase/pocketbase/tools/types"
)

const collection = "backups"

// LedgerPath is the directory the engine keeps its working state under —
// the parent of pb_data in every deployment shape (a Docker state dir, a
// single-binary data dir, an org directory).
func LedgerPath(app core.App) string { return filepath.Dir(app.DataDir()) }

func tmpDir(app core.App) string { return filepath.Join(LedgerPath(app), "backup-tmp") }

func newRow(app core.App, kind Kind, initiator, targetHost string) *core.Record {
    col, err := app.FindCollectionByNameOrId(collection)
    if err != nil {
        panic("backups collection missing: " + err.Error())
    }
    r := core.NewRecord(col)
    r.Set("kind", string(kind))
    r.Set("status", "running")
    r.Set("started", types.NowDateTime())
    if initiator != "" {
        r.Set("initiated_by", initiator)
    }
    r.Set("target_host", targetHost)
    return r
}

func finishRow(app core.App, r *core.Record, status string, bytes int64, sha, errMsg string, manifest any) error {
    r.Set("status", status)
    r.Set("finished", types.NowDateTime())
    r.Set("bytes", bytes)
    r.Set("sha256", sha)
    r.Set("error", truncate(errMsg, 2000))
    if manifest != nil {
        r.Set("manifest", manifest)
    }
    return app.Save(r)
}

func truncate(s string, n int) string {
    if len(s) <= n {
        return s
    }
    return s[:n]
}

// HostOnly reduces a signed URL to the part safe to keep.
func HostOnly(raw string) string {
    u, err := url.Parse(raw)
    if err != nil {
        return ""
    }
    return u.Hostname()
}

// MarkInterrupted closes every row a previous process left running. Called
// once per boot with the process start time.
func MarkInterrupted(app core.App, bootedAt time.Time) error {
    rows, err := app.FindRecordsByFilter(collection, "status = 'running' || status = 'waiting_for_source'", "", 0, 0)
    if err != nil {
        return err
    }
    for _, r := range rows {
        if r.GetDateTime("started").Time().After(bootedAt) {
            continue
        }
        r.Set("status", "interrupted")
        r.Set("finished", types.NowDateTime())
        r.Set("error", "the server restarted before this run finished")
        if err := app.Save(r); err != nil {
            return err
        }
    }
    return nil
}
```

- [ ] **Step 5: Implement `snapshot.go`**

```go
package backup

import (
    "fmt"
    "os"
    "strings"

    "github.com/pocketbase/pocketbase/core"
)

// vacuumInto writes a consistent copy of the live database through the open
// connection. It does not shell out: the sqlite3 CLI is absent from a single
// binary and from a confined process whose PATH is /usr/bin:/bin.
func vacuumInto(app core.App, dest string) error {
    if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
        return err
    }
    if strings.ContainsAny(dest, "'") {
        return fmt.Errorf("backup: snapshot path must not contain a quote")
    }
    if _, err := app.NonconcurrentDB().NewQuery("VACUUM INTO '" + dest + "'").Execute(); err != nil {
        return fmt.Errorf("backup: snapshot: %w", err)
    }
    return nil
}
```
`VACUUM INTO` cannot run inside a transaction; `NonconcurrentDB` runs it on the writer connection outside any `RunInTransaction`. If PocketBase's `dbx` wraps `Execute` in a transaction, use `app.NonconcurrentDB().(*dbx.DB).DB().Exec(...)` instead.

- [ ] **Step 6: Implement `limit.go`**

```go
package backup

import (
    "sync"
    "time"

    "github.com/pocketbase/pocketbase/core"
)

// The manual-run ceiling is a seam an embedder claims once; a deployment
// nobody claims uses the default. Scheduled runs never count.
var (
    limitMu     sync.Mutex
    limitFn     func(core.App) int
    limitClaimed bool
    manualRuns  []time.Time
)

const defaultDailyLimit = 10

func SetDailyLimit(fn func(app core.App) int) {
    limitMu.Lock()
    defer limitMu.Unlock()
    if limitClaimed || fn == nil {
        return
    }
    limitFn, limitClaimed = fn, true
}

func resetDailyLimitForTesting() {
    limitMu.Lock()
    defer limitMu.Unlock()
    limitFn, limitClaimed, manualRuns = nil, false, nil
}

func dailyLimit(app core.App) int {
    limitMu.Lock()
    fn := limitFn
    limitMu.Unlock()
    if fn == nil {
        return defaultDailyLimit
    }
    return fn(app)
}

// allowManual records the run when under the ceiling.
func allowManual(app core.App) bool {
    limit := dailyLimit(app)
    limitMu.Lock()
    defer limitMu.Unlock()
    cutoff := time.Now().Add(-24 * time.Hour)
    kept := manualRuns[:0]
    for _, t := range manualRuns {
        if t.After(cutoff) {
            kept = append(kept, t)
        }
    }
    manualRuns = kept
    if limit > 0 && len(manualRuns) >= limit {
        return false
    }
    manualRuns = append(manualRuns, time.Now())
    return true
}
```

- [ ] **Step 7: Implement `engine.go`**

```go
package backup

import (
    "bytes"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "net/http"
    "os"
    "path/filepath"
    "sync"
    "time"

    "filippo.io/age"
    "github.com/klauspost/compress/zstd"
    "github.com/pocketbase/pocketbase/core"
    "github.com/pocketbase/pocketbase/tools/filesystem"

    "tinycld.org/core/audit"
    "tinycld.org/core/backup/format"
    "tinycld.org/core/installjob"
    "tinycld.org/core/logging"
    "tinycld.org/core/notify"
)

var log = logging.ForPackage("backup")

type Kind string

const (
    KindManual     Kind = "manual"
    KindScheduled  Kind = "scheduled"
    KindPreRestore Kind = "pre_restore"
    KindRestore    Kind = "restore"
)

var (
    ErrBusy      = errors.New("backup: another job is running")
    ErrRateLimit = errors.New("backup: daily manual backup limit reached")
)

type Request struct {
    Kind       Kind
    Recipient  age.Recipient
    Sink       io.WriteCloser
    Initiator  string
    Callback   string
    TargetHost string
    Request    *core.RequestEvent
}

var (
    sourceMu sync.RWMutex
    source   = "docker"
)

// SetSource names the deployment shape recorded in every manifest.
func SetSource(s string) {
    sourceMu.Lock()
    defer sourceMu.Unlock()
    source = s
}

func currentSource() string {
    sourceMu.RLock()
    defer sourceMu.RUnlock()
    return source
}

// Start inserts the ledger row and runs the backup on a goroutine. It fails
// fast on the interlock and the ceiling so a caller gets 409/429 instead of
// a row that fails a moment later.
func Start(app core.App, req Request) (string, error) {
    row, job, err := begin(app, req)
    if err != nil {
        return "", err
    }
    go func() { _ = run(app, req, row, job) }()
    return row.Id, nil
}

// Run is Start without the goroutine: it returns when the sink is closed.
func Run(app core.App, req Request) (string, error) {
    row, job, err := begin(app, req)
    if err != nil {
        return "", err
    }
    return row.Id, run(app, req, row, job)
}

func begin(app core.App, req Request) (*core.Record, *installjob.Job, error) {
    if req.Kind == KindManual && !allowManual(app) {
        return nil, nil, ErrRateLimit
    }
    job := installjob.New("backup", "", "")
    if _, ok := installjob.Claim(job); !ok {
        return nil, nil, ErrBusy
    }
    row := newRow(app, req.Kind, req.Initiator, req.TargetHost)
    if err := app.Save(row); err != nil {
        installjob.Release(job)
        return nil, nil, err
    }
    job.ID = row.Id
    return row, job, nil
}

func run(app core.App, req Request, row *core.Record, job *installjob.Job) (err error) {
    defer installjob.Release(job)
    var written int64
    var sha string
    var manifest format.Manifest
    defer func() {
        status, errMsg := "succeeded", ""
        if err != nil {
            status, errMsg = "failed", err.Error()
            log.Error("backup failed", "id", row.Id, "kind", req.Kind, "err", err)
        }
        if ferr := finishRow(app, row, status, written, sha, errMsg, manifest); ferr != nil {
            log.Error("could not finalize backup row", "id", row.Id, "err", ferr)
        }
        announce(app, req, row, status, errMsg)
        postCallback(req.Callback, row)
    }()

    manifest, err = buildManifest(app, req.Kind)
    if err != nil {
        return err
    }

    if err = os.MkdirAll(tmpDir(app), 0o700); err != nil {
        return err
    }
    snap := filepath.Join(tmpDir(app), row.Id+".db")
    if err = vacuumInto(app, snap); err != nil {
        return err
    }
    defer os.Remove(snap)

    counter := &countingWriter{w: req.Sink}
    w, err := format.NewWriter(counter, req.Recipient, zstd.SpeedDefault)
    if err != nil {
        return err
    }
    progress := newProgress(app, row, counter)
    defer progress.stop()

    fs, err := app.NewFilesystem()
    if err != nil {
        return err
    }
    defer fs.Close()
    files, err := fs.List("")
    if err != nil {
        return err
    }
    manifest.Counts.Files = len(files)
    for _, f := range files {
        manifest.Counts.Bytes += f.Size
    }
    if err = w.WriteManifest(manifest); err != nil {
        return err
    }
    if err = writeSnapshot(w, snap); err != nil {
        return err
    }
    for _, f := range files {
        if err = writeStored(w, fs, f.Key, f.Size); err != nil {
            return err
        }
    }
    if err = w.Close(); err != nil {
        return err
    }
    if err = req.Sink.Close(); err != nil {
        return err
    }
    written, sha = counter.n, w.Sha256()
    return nil
}

func writeSnapshot(w *format.Writer, path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    fi, err := f.Stat()
    if err != nil {
        return err
    }
    return w.WriteFile(format.MemberDB, fi.Size(), f)
}

func writeStored(w *format.Writer, fs *filesystem.System, key string, size int64) error {
    r, err := fs.GetReader(key)
    if err != nil {
        return fmt.Errorf("read %s: %w", key, err)
    }
    defer r.Close()
    return w.WriteFile(format.StoragePrefix+key, size, r)
}

func buildManifest(app core.App, kind Kind) (format.Manifest, error) {
    m := format.Manifest{
        Created:  time.Now().UTC(),
        Instance: app.Settings().Meta.AppURL,
        Source:   currentSource(),
        Kind:     string(kind),
        Lockfile: format.Lockfile{},
        Packages: map[string]string{},
        Counts:   format.Counts{Collections: map[string]int{}},
    }
    regs, err := app.FindRecordsByFilter("pkg_registry", "status = 'installed' || status = 'bundled'", "slug", 0, 0)
    if err != nil {
        return m, err
    }
    for _, r := range regs {
        slug := r.GetString("slug")
        if slug == "core" {
            m.Core = r.GetString("version")
            m.Lockfile["tinycld"] = r.GetString("npm_package")
            continue
        }
        m.Lockfile[slug] = r.GetString("npm_package")
        m.Packages[slug] = r.GetString("version")
    }
    cols, err := app.FindAllCollections()
    if err != nil {
        return m, err
    }
    for _, c := range cols {
        if c.System {
            continue
        }
        var n int
        if err := app.DB().Select("count(*)").From(c.Name).Row(&n); err == nil {
            m.Counts.Collections[c.Name] = n
        }
    }
    return m, nil
}

func announce(app core.App, req Request, row *core.Record, status, errMsg string) {
    if req.Kind == KindPreRestore {
        return // part of a restore; the restore announces itself
    }
    title, body, typ := "Backup completed", "A backup of this organization finished successfully.", "core.backup.succeeded"
    if status != "succeeded" {
        title, body, typ = "Backup failed", "A backup of this organization failed: "+errMsg, "core.backup.failed"
    }
    if _, err := notify.Administrators(app, notify.NotifyParams{Type: typ, Package: "core", Title: title, Body: body, URL: "/settings/backups"}); err != nil {
        log.Warn("could not notify administrators about a backup", "err", err)
    }
    action := "backup.created"
    if status != "succeeded" {
        action = "backup.failed"
    }
    if err := audit.Log(app, action, "backup", row.Id, string(req.Kind), req.Request, map[string]any{"bytes": row.GetInt("bytes"), "target_host": row.GetString("target_host")}); err != nil {
        log.Warn("could not audit a backup", "err", err)
    }
}

func postCallback(url string, row *core.Record) {
    if url == "" {
        return
    }
    body, _ := json.Marshal(row.PublicExport())
    res, err := format.NoRedirectClient().Post(url, "application/json", bytes.NewReader(body))
    if err != nil {
        log.Warn("backup callback failed", "err", err)
        return
    }
    _, _ = io.Copy(io.Discard, res.Body)
    _ = res.Body.Close()
    if res.StatusCode >= 300 {
        log.Warn("backup callback rejected", "status", res.StatusCode)
    }
}

type countingWriter struct {
    w io.Writer
    n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
    n, err := c.w.Write(p)
    c.n += int64(n)
    return n, err
}

// progress updates the row's bytes at most every 2 s so the panel can show
// movement without a write per chunk.
type progress struct {
    stopCh chan struct{}
    done   chan struct{}
}

func newProgress(app core.App, row *core.Record, c *countingWriter) *progress {
    p := &progress{stopCh: make(chan struct{}), done: make(chan struct{})}
    go func() {
        defer close(p.done)
        t := time.NewTicker(2 * time.Second)
        defer t.Stop()
        for {
            select {
            case <-p.stopCh:
                return
            case <-t.C:
                row.Set("bytes", c.n)
                _ = app.Save(row)
            }
        }
    }()
    return p
}

func (p *progress) stop() {
    close(p.stopCh)
    <-p.done
}

var _ = http.StatusOK
```
Remove the trailing `var _ = http.StatusOK` and the `net/http` import if unused. `row.PublicExport()` includes only public fields — fine for the callback (the manifest and sha are what a receiver wants).

- [ ] **Step 8: Run tests**

Run: `cd core/server && go test ./backup/ -v`
Expected: all PASS. Likely fixes: `app.NonconcurrentDB()` type on `tests.TestApp`; `app.Settings().Meta.AppURL` empty in tests (fine); count query on a collection with a hyphen (quote the name with backticks: `` "`"+c.Name+"`" ``).

- [ ] **Step 9: Commit**

```bash
git add core/server/backup/
git commit -m "feat(backup): engine with ledger-first runs, interlock and daily ceiling"
```

---

### Task 8: Restore — phases 1–6, rebuilder registry, source swap

**Files:**
- Create: `core/server/backup/manifestcheck.go`, `restore.go`, `paths.go`
- Test: `core/server/backup/restore_test.go`, `manifestcheck_test.go`

**Interfaces:**
- Consumes: `format.Reader`, `format.RangeSource`, `Run` (pre-restore), `installjob`.
- Produces:
```go
type Rebuilder func(ctx context.Context, lockfile format.Lockfile) error
func RegisterRebuilder(fn Rebuilder)         // nil-safe; last registration wins
func HasRebuilder() bool
type Source interface { io.Reader; Close() error }   // *format.RangeSource or a request body
type RestoreRequest struct {
    Source    Source
    Ranged    *format.RangeSource // same object as Source when the source is a URL; enables SwapSource
    Identity  age.Identity
    Force     bool
    Initiator string
    Request   *core.RequestEvent
    SourceHost string
}
type Diff struct { Missing []string; Extra []string; VersionDelta map[string][2]string }
var ErrManifestMismatch = errors.New("backup: archive does not match this binary's package set")
type MismatchError struct { Diff Diff }     // Error() lists the diff; errors.Is(err, ErrManifestMismatch)
func Restore(app core.App, req RestoreRequest) (jobID string, err error)   // synchronous through phase 6; the rebuilder restarts the process
func StartRestore(app core.App, req RestoreRequest) (jobID string, err error) // async; row inserted first
func SwapSource(jobID, url string) error     // ErrNotWaiting when no restore is waiting
func compareEmbedded(m format.Manifest, installed map[string]string) Diff
// paths.go
func restoreDir(app core.App) string          // LedgerPath/restore
func pendingDir(app core.App, id string) string
func preBackupPath(app core.App, id string) string
func armedPath(app core.App) string           // restore/armed
type armed struct { ID string `json:"id"`; Pending string `json:"pending"`; Pre string `json:"pre"` }
```

- [ ] **Step 1: Failing tests for the manifest check**

`core/server/backup/manifestcheck_test.go`:
```go
package backup

import (
    "testing"

    "tinycld.org/core/backup/format"
)

func TestCompareEmbedded(t *testing.T) {
    m := format.Manifest{Packages: map[string]string{"mail": "1.0.0", "drive": "2.0.0"}}
    cases := []struct {
        name      string
        installed map[string]string
        wantEmpty bool
        missing   int
        extra     int
        deltas    int
    }{
        {"equal", map[string]string{"mail": "1.0.0", "drive": "2.0.0"}, true, 0, 0, 0},
        {"missing package", map[string]string{"mail": "1.0.0"}, false, 1, 0, 0},
        {"extra package", map[string]string{"mail": "1.0.0", "drive": "2.0.0", "calc": "1.0.0"}, false, 0, 1, 0},
        {"version delta", map[string]string{"mail": "1.1.0", "drive": "2.0.0"}, false, 0, 0, 1},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            d := compareEmbedded(m, c.installed)
            if d.Empty() != c.wantEmpty || len(d.Missing) != c.missing || len(d.Extra) != c.extra || len(d.VersionDelta) != c.deltas {
                t.Fatalf("%+v", d)
            }
        })
    }
}
```

- [ ] **Step 2: Implement `manifestcheck.go`**

```go
package backup

import (
    "errors"
    "fmt"
    "sort"
    "strings"

    "tinycld.org/core/backup/format"
)

var ErrManifestMismatch = errors.New("backup: archive does not match this binary's package set")

type Diff struct {
    Missing      []string             `json:"missing"`      // in the archive, not in this binary
    Extra        []string             `json:"extra"`        // in this binary, not in the archive
    VersionDelta map[string][2]string `json:"versionDelta"` // slug → [archive, binary]
}

func (d Diff) Empty() bool { return len(d.Missing) == 0 && len(d.Extra) == 0 && len(d.VersionDelta) == 0 }

type MismatchError struct{ Diff Diff }

func (e *MismatchError) Error() string {
    var parts []string
    if len(e.Diff.Missing) > 0 {
        parts = append(parts, "missing: "+strings.Join(e.Diff.Missing, ", "))
    }
    if len(e.Diff.Extra) > 0 {
        parts = append(parts, "extra: "+strings.Join(e.Diff.Extra, ", "))
    }
    for slug, v := range e.Diff.VersionDelta {
        parts = append(parts, fmt.Sprintf("%s: archive %s, binary %s", slug, v[0], v[1]))
    }
    sort.Strings(parts)
    return ErrManifestMismatch.Error() + " (" + strings.Join(parts, "; ") + ")"
}

func (e *MismatchError) Is(target error) bool { return target == ErrManifestMismatch }

func compareEmbedded(m format.Manifest, installed map[string]string) Diff {
    d := Diff{VersionDelta: map[string][2]string{}}
    for slug, v := range m.Packages {
        got, ok := installed[slug]
        if !ok {
            d.Missing = append(d.Missing, slug)
            continue
        }
        if got != v {
            d.VersionDelta[slug] = [2]string{v, got}
        }
    }
    for slug := range installed {
        if _, ok := m.Packages[slug]; !ok {
            d.Extra = append(d.Extra, slug)
        }
    }
    sort.Strings(d.Missing)
    sort.Strings(d.Extra)
    return d
}

func installedPackages(app interface {
    FindRecordsByFilter(string, string, string, int, int, ...any) ([]*core.Record, error)
}) (map[string]string, error) {
    regs, err := app.FindRecordsByFilter("pkg_registry", "status = 'installed' || status = 'bundled'", "", 0, 0)
    if err != nil {
        return nil, err
    }
    out := map[string]string{}
    for _, r := range regs {
        if slug := r.GetString("slug"); slug != "core" {
            out[slug] = r.GetString("version")
        }
    }
    return out, nil
}
```
Use `core.App` for the parameter type instead of the inline interface (add the import); the inline form is only there to show the one method used.

- [ ] **Step 3: Run the check test**

Run: `cd core/server && go test ./backup/ -run TestCompareEmbedded -v`
Expected: PASS.

- [ ] **Step 4: Failing restore tests**

`core/server/backup/restore_test.go`:
```go
package backup

import (
    "bytes"
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "testing"
    "time"

    "filippo.io/age"
    "tinycld.org/core/backup/format"
)

// archiveFor builds a real archive from a source test app so the restore
// tests run against genuine output of Run.
func archiveFor(t *testing.T) ([]byte, age.Identity) {
    t.Helper()
    src := newTestApp(t)
    makeUser(t, src, "owner@example.com", "owner")
    id, _ := age.GenerateX25519Identity()
    sink := &closeBuffer{}
    if _, err := Run(src, Request{Kind: KindManual, Recipient: id.Recipient(), Sink: sink}); err != nil {
        t.Fatal(err)
    }
    return sink.Bytes(), id
}

type readCloser struct{ *bytes.Reader }

func (readCloser) Close() error { return nil }

func TestRestoreStagesAndCallsRebuilder(t *testing.T) {
    data, id := archiveFor(t)
    app := newTestApp(t)
    owner := makeUser(t, app, "owner2@example.com", "owner")

    var gotLock format.Lockfile
    RegisterRebuilder(func(_ context.Context, lf format.Lockfile) error { gotLock = lf; return nil })
    t.Cleanup(func() { RegisterRebuilder(nil) })

    jobID, err := Restore(app, RestoreRequest{Source: readCloser{bytes.NewReader(data)}, Identity: id, Initiator: owner.Id})
    if err != nil {
        t.Fatal(err)
    }
    if gotLock["mail"] != "@tinycld/mail@1.0.0" {
        t.Fatalf("rebuilder got %v", gotLock)
    }
    // staged
    if _, err := os.Stat(filepath.Join(pendingDir(app, jobID), "data.db")); err != nil {
        t.Fatal("data.db not staged")
    }
    if _, err := os.Stat(filepath.Join(pendingDir(app, jobID), "storage", "col1", "rec1", "hello.txt")); err != nil {
        t.Fatal("file not staged")
    }
    // armed
    raw, err := os.ReadFile(armedPath(app))
    if err != nil {
        t.Fatal("not armed")
    }
    var a armed
    _ = json.Unmarshal(raw, &a)
    if a.ID != jobID || a.Pending != pendingDir(app, jobID) {
        t.Fatalf("armed %+v", a)
    }
    // pre-restore backup exists and is readable with the identity stored on the row
    row, _ := app.FindRecordById("backups", jobID)
    meta := row.Get("metadata").(map[string]any)
    preID, err := age.ParseX25519Identity(meta["pre_restore_identity"].(string))
    if err != nil {
        t.Fatal(err)
    }
    f, err := os.Open(preBackupPath(app, jobID))
    if err != nil {
        t.Fatal(err)
    }
    defer f.Close()
    if _, rep, err := format.Inspect(f, preID); err != nil || !rep.OK {
        t.Fatalf("pre-restore backup unreadable: %v", err)
    }
    if row.GetString("status") != "running" || row.GetString("kind") != "restore" {
        t.Fatalf("row %v", row.PublicExport())
    }
    // the live pb_data was not touched
    if _, err := os.Stat(filepath.Join(app.DataDir(), "data.db")); err != nil {
        t.Fatal("live db missing")
    }
}

func TestRestoreRefusesMismatchWithoutRebuilder(t *testing.T) {
    data, id := archiveFor(t)
    app := newTestApp(t)
    RegisterRebuilder(nil)
    // make the target's package set differ: drop mail
    regs, _ := app.FindRecordsByFilter("pkg_registry", "slug = 'mail'", "", 0, 0)
    _ = app.Delete(regs[0])

    _, err := Restore(app, RestoreRequest{Source: readCloser{bytes.NewReader(data)}, Identity: id})
    if !errors.Is(err, ErrManifestMismatch) {
        t.Fatalf("want mismatch, got %v", err)
    }
    if _, err := os.Stat(restoreDir(app)); !os.IsNotExist(err) {
        t.Fatal("refusal wrote to disk")
    }
}

func TestRestoreForceSkipsCheckAndRebuild(t *testing.T) {
    data, id := archiveFor(t)
    app := newTestApp(t)
    RegisterRebuilder(nil)
    regs, _ := app.FindRecordsByFilter("pkg_registry", "slug = 'mail'", "", 0, 0)
    _ = app.Delete(regs[0])

    jobID, err := Restore(app, RestoreRequest{Source: readCloser{bytes.NewReader(data)}, Identity: id, Force: true})
    if err != nil {
        t.Fatal(err)
    }
    if _, err := os.Stat(filepath.Join(pendingDir(app, jobID), "data.db")); err != nil {
        t.Fatal("force did not stage")
    }
    if !restartRequested() {
        t.Fatal("force path must request a restart when no rebuilder exists")
    }
}

func TestRestoreEqualSetWithoutRebuilderProceeds(t *testing.T) {
    data, id := archiveFor(t)
    app := newTestApp(t)
    RegisterRebuilder(nil)
    if _, err := Restore(app, RestoreRequest{Source: readCloser{bytes.NewReader(data)}, Identity: id}); err != nil {
        t.Fatal(err)
    }
}

func TestRestoreTamperedArchiveFailsClean(t *testing.T) {
    data, id := archiveFor(t)
    data[len(data)-10] ^= 0xff
    app := newTestApp(t)
    RegisterRebuilder(func(context.Context, format.Lockfile) error { t.Fatal("rebuilder must not run"); return nil })
    t.Cleanup(func() { RegisterRebuilder(nil) })
    jobID, err := Restore(app, RestoreRequest{Source: readCloser{bytes.NewReader(data)}, Identity: id})
    if err == nil {
        t.Fatal("expected failure")
    }
    row, _ := app.FindRecordById("backups", jobID)
    if row.GetString("status") != "failed" {
        t.Fatalf("status %q", row.GetString("status"))
    }
    if _, err := os.Stat(pendingDir(app, jobID)); !os.IsNotExist(err) {
        t.Fatal("pending dir left behind")
    }
    if _, err := os.Stat(armedPath(app)); !os.IsNotExist(err) {
        t.Fatal("still armed")
    }
    if _, err := os.Stat(preBackupPath(app, jobID)); err != nil {
        t.Fatal("pre-restore backup must be kept after a failed restore")
    }
}

func TestRestoreWaitsForSourceAndSwaps(t *testing.T) {
    data, id := archiveFor(t)
    app := newTestApp(t)
    RegisterRebuilder(func(context.Context, format.Lockfile) error { return nil })
    t.Cleanup(func() { RegisterRebuilder(nil) })

    var calls int
    expiring := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        calls++
        if calls == 1 {
            w.Header().Set("ETag", `"v1"`)
            _, _ = w.Write(data[:len(data)/2])
            if hj, ok := w.(http.Hijacker); ok {
                c, _, _ := hj.Hijack()
                _ = c.Close()
            }
            return
        }
        w.WriteHeader(http.StatusForbidden)
    }))
    t.Cleanup(expiring.Close)
    good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        http.ServeContent(w, r, "b.age", time.Time{}, bytes.NewReader(data))
    }))
    t.Cleanup(good.Close)

    src := format.NewRangeSource(context.Background(), expiring.URL)
    src.SetExpiryWait(5 * time.Second)
    jobID, err := StartRestore(app, RestoreRequest{Source: src, Ranged: src, Identity: id, SourceHost: "x"})
    if err != nil {
        t.Fatal(err)
    }
    deadline := time.Now().Add(5 * time.Second)
    for time.Now().Before(deadline) {
        row, _ := app.FindRecordById("backups", jobID)
        if row.GetString("status") == "waiting_for_source" {
            break
        }
        time.Sleep(50 * time.Millisecond)
    }
    if err := SwapSource(jobID, good.URL); err != nil {
        t.Fatal(err)
    }
    for time.Now().Before(deadline.Add(5 * time.Second)) {
        if _, err := os.Stat(armedPath(app)); err == nil {
            return
        }
        time.Sleep(50 * time.Millisecond)
    }
    t.Fatal("restore did not complete after swap")
}
```
`http.ServeContent` supports Range, which is what the swap needs. `restartRequested()` is a test hook defined in restore.go (see below).

- [ ] **Step 5: Implement `paths.go`**

```go
package backup

import (
    "path/filepath"

    "github.com/pocketbase/pocketbase/core"
)

func restoreDir(app core.App) string                 { return filepath.Join(LedgerPath(app), "restore") }
func pendingDir(app core.App, id string) string      { return filepath.Join(restoreDir(app), "pending", id) }
func preBackupPath(app core.App, id string) string   { return filepath.Join(restoreDir(app), "pre", id+".age") }
func previousDir(app core.App, id string) string     { return filepath.Join(restoreDir(app), "previous", id) }
func armedPath(app core.App) string                  { return filepath.Join(restoreDir(app), "armed") }
func swappedPath(app core.App) string                { return filepath.Join(restoreDir(app), "swapped") }

// Path variants that take a data dir, for the boot swap that runs before an
// app exists.
func restoreDirOf(dataDir string) string { return filepath.Join(filepath.Dir(dataDir), "restore") }
func armedPathOf(dataDir string) string  { return filepath.Join(restoreDirOf(dataDir), "armed") }
func swappedPathOf(dataDir string) string { return filepath.Join(restoreDirOf(dataDir), "swapped") }

type armed struct {
    ID      string `json:"id"`
    Pending string `json:"pending"`
    Pre     string `json:"pre"`
}
```

- [ ] **Step 6: Implement `restore.go`**

```go
package backup

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "os"
    "path/filepath"
    "strings"
    "sync"
    "time"

    "filippo.io/age"
    "github.com/pocketbase/pocketbase/core"

    "tinycld.org/core/audit"
    "tinycld.org/core/backup/format"
    "tinycld.org/core/installjob"
    "tinycld.org/core/notify"
)

type Rebuilder func(ctx context.Context, lockfile format.Lockfile) error

var (
    rebuilderMu sync.RWMutex
    rebuilder   Rebuilder
    // restartFn is what a rebuilder-less restore calls to end the process;
    // coreserver sets it. Tests observe it instead.
    restartFn = func() {}
    restarted bool
)

func RegisterRebuilder(fn Rebuilder) {
    rebuilderMu.Lock()
    defer rebuilderMu.Unlock()
    rebuilder = fn
}

func HasRebuilder() bool {
    rebuilderMu.RLock()
    defer rebuilderMu.RUnlock()
    return rebuilder != nil
}

// SetRestart names the function that ends the process so the supervisor
// relaunches it (exit 75 in every tinycld deployment).
func SetRestart(fn func()) { restartFn = fn }

func restartRequested() bool { return restarted }

type Source interface {
    io.Reader
    Close() error
}

type RestoreRequest struct {
    Source     Source
    Ranged     *format.RangeSource
    Identity   age.Identity
    Force      bool
    Initiator  string
    Request    *core.RequestEvent
    SourceHost string
}

var ErrNotWaiting = errors.New("backup: no restore is waiting for a source")

var (
    waitingMu sync.Mutex
    waiting   = map[string]*format.RangeSource{}
)

// SwapSource gives a waiting restore a fresh URL for the same object.
func SwapSource(jobID, url string) error {
    waitingMu.Lock()
    src, ok := waiting[jobID]
    waitingMu.Unlock()
    if !ok {
        return ErrNotWaiting
    }
    src.SwapURL(url)
    return nil
}

func StartRestore(app core.App, req RestoreRequest) (string, error) {
    row, job, err := beginRestore(app, req)
    if err != nil {
        return "", err
    }
    go func() { _ = runRestore(app, req, row, job) }()
    return row.Id, nil
}

func Restore(app core.App, req RestoreRequest) (string, error) {
    row, job, err := beginRestore(app, req)
    if err != nil {
        return "", err
    }
    return row.Id, runRestore(app, req, row, job)
}

func beginRestore(app core.App, req RestoreRequest) (*core.Record, *installjob.Job, error) {
    job := installjob.New("restore", "", "")
    if _, ok := installjob.Claim(job); !ok {
        return nil, nil, ErrBusy
    }
    row := newRow(app, KindRestore, req.Initiator, req.SourceHost)
    if err := app.Save(row); err != nil {
        installjob.Release(job)
        return nil, nil, err
    }
    job.ID = row.Id
    return row, job, nil
}

func runRestore(app core.App, req RestoreRequest, row *core.Record, job *installjob.Job) (err error) {
    id := row.Id
    released := false
    release := func() {
        if !released {
            installjob.Release(job)
            released = true
        }
    }
    defer release()
    defer req.Source.Close()

    var manifest format.Manifest
    defer func() {
        if err == nil {
            return // the row stays "running" until the restored process boots
        }
        log.Error("restore failed", "id", id, "err", err)
        _ = os.RemoveAll(pendingDir(app, id))
        _ = os.Remove(armedPath(app))
        if ferr := finishRow(app, row, "failed", 0, "", err.Error(), manifest); ferr != nil {
            log.Error("could not finalize restore row", "id", id, "err", ferr)
        }
        announceRestore(app, req, row, false, err.Error())
    }()

    // Phase 1: the manifest only.
    reader, err := format.NewReader(req.Source, req.Identity)
    if err != nil {
        return err
    }
    defer reader.Close()
    manifest, err = reader.ReadManifest()
    if err != nil {
        return err
    }
    row.Set("manifest", manifest)
    _ = app.Save(row)

    // Phase 2: can this deployment run that package set?
    if !HasRebuilder() && !req.Force {
        installed, ierr := installedPackages(app)
        if ierr != nil {
            return ierr
        }
        if d := compareEmbedded(manifest, installed); !d.Empty() {
            return &MismatchError{Diff: d}
        }
    }

    // Phase 3: pre-restore safety copy, keyed to a throwaway identity the
    // owner can read off the row until the restore succeeds.
    preID, err := age.GenerateX25519Identity()
    if err != nil {
        return err
    }
    if err = os.MkdirAll(filepath.Dir(preBackupPath(app, id)), 0o700); err != nil {
        return err
    }
    preFile, err := os.Create(preBackupPath(app, id))
    if err != nil {
        return err
    }
    release() // Run claims the interlock itself
    if _, err = Run(app, Request{Kind: KindPreRestore, Recipient: preID.Recipient(), Sink: preFile}); err != nil {
        return fmt.Errorf("pre-restore backup: %w", err)
    }
    if _, ok := installjob.Claim(job); !ok {
        return ErrBusy
    }
    released = false
    row.Set("metadata", map[string]any{"pre_restore_identity": preID.String(), "pre_restore_path": preBackupPath(app, id)})
    _ = app.Save(row)

    // Phase 4: arm.
    if err = os.MkdirAll(pendingDir(app, id), 0o700); err != nil {
        return err
    }
    a := armed{ID: id, Pending: pendingDir(app, id), Pre: preBackupPath(app, id)}
    raw, _ := json.Marshal(a)
    if err = os.WriteFile(armedPath(app), raw, 0o600); err != nil {
        return err
    }

    // Phase 5: the rest of the stream, verified.
    if req.Ranged != nil {
        waitingMu.Lock()
        waiting[id] = req.Ranged
        waitingMu.Unlock()
        defer func() {
            waitingMu.Lock()
            delete(waiting, id)
            waitingMu.Unlock()
        }()
        go watchForExpiry(app, row, req.Ranged)
    }
    if err = stage(reader, pendingDir(app, id)); err != nil {
        return err
    }
    if err = integrityCheck(filepath.Join(pendingDir(app, id), format.MemberDB)); err != nil {
        return err
    }
    row.Set("status", "running")
    _ = app.Save(row)

    // Phase 6: rebuild (the rebuilder restarts the process) or restart.
    rebuilderMu.RLock()
    fn := rebuilder
    rebuilderMu.RUnlock()
    if fn != nil && !req.Force {
        release()
        return fn(context.Background(), manifest.Lockfile)
    }
    restarted = true
    restartFn()
    return nil
}

// watchForExpiry flips the row to waiting_for_source while the source is
// blocked on an expired URL, and back when it resumes.
func watchForExpiry(app core.App, row *core.Record, src *format.RangeSource) {
    last := src.Offset()
    stalled := 0
    for {
        time.Sleep(500 * time.Millisecond)
        cur := src.Offset()
        if cur == last {
            stalled++
        } else {
            stalled = 0
            if row.GetString("status") == "waiting_for_source" {
                row.Set("status", "running")
                _ = app.Save(row)
            }
        }
        last = cur
        if stalled == 4 && src.Blocked() {
            row.Set("status", "waiting_for_source")
            row.Set("metadata", mergeMeta(row, map[string]any{"resume_offset": cur}))
            _ = app.Save(row)
        }
        if row.GetString("status") != "running" && row.GetString("status") != "waiting_for_source" {
            return
        }
    }
}

func mergeMeta(row *core.Record, extra map[string]any) map[string]any {
    out := map[string]any{}
    if existing, ok := row.Get("metadata").(map[string]any); ok {
        for k, v := range existing {
            out[k] = v
        }
    }
    for k, v := range extra {
        out[k] = v
    }
    return out
}

func stage(r *format.Reader, dir string) error {
    for {
        hdr, body, err := r.Next()
        if err == io.EOF {
            break
        }
        if err != nil {
            return err
        }
        if hdr.Name != format.MemberDB && !strings.HasPrefix(hdr.Name, format.StoragePrefix) {
            return fmt.Errorf("%w: unexpected member %q", format.ErrFormat, hdr.Name)
        }
        target := filepath.Join(dir, filepath.FromSlash(hdr.Name))
        if !strings.HasPrefix(target, dir+string(os.PathSeparator)) {
            return fmt.Errorf("%w: member escapes the staging dir", format.ErrFormat)
        }
        if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
            return err
        }
        f, err := os.Create(target)
        if err != nil {
            return err
        }
        if _, err := io.Copy(f, body); err != nil {
            f.Close()
            return err
        }
        if err := f.Close(); err != nil {
            return err
        }
    }
    return r.Verify()
}

func announceRestore(app core.App, req RestoreRequest, row *core.Record, ok bool, errMsg string) {
    typ, title, body, action := "core.restore.succeeded", "Restore completed", "This organization was restored from a backup.", "restore.succeeded"
    if !ok {
        typ, title, body, action = "core.restore.failed", "Restore failed", "Restoring from a backup failed: "+errMsg, "restore.failed"
    }
    if _, err := notify.Administrators(app, notify.NotifyParams{Type: typ, Package: "core", Title: title, Body: body, URL: "/settings/backups"}); err != nil {
        log.Warn("could not notify administrators about a restore", "err", err)
    }
    if err := audit.Log(app, action, "backup", row.Id, "restore", req.Request, map[string]any{"source_host": row.GetString("target_host")}); err != nil {
        log.Warn("could not audit a restore", "err", err)
    }
}
```
Add to `format/source.go`:
```go
// Blocked reports whether Read is waiting for SwapURL.
func (s *RangeSource) Blocked() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.blocked
}
```
and set `s.blocked = true/false` around `waitForSwap` (under `s.mu`). Also add the `restore.started` audit row at the top of `runRestore` (after the row is saved): `_ = audit.Log(app, "restore.started", "backup", id, "restore", req.Request, nil)`.

`integrityCheck(path)` opens the staged file read-only with `database/sql` + the `modernc.org/sqlite` driver already in `go.mod` (`sql.Open("sqlite", "file:"+path+"?mode=ro")`), runs `PRAGMA integrity_check`, and returns an error unless the single result row is `ok`.

- [ ] **Step 7: Run restore tests**

Run: `cd core/server && go test ./backup/ -run 'Restore|Compare' -v`
Expected: all PASS. Watch for: `Run` inside a restore re-claiming the interlock (the release/reclaim dance above handles it); `row.Get("metadata")` type (`types.JSONMap` vs `map[string]any` — unmarshal via `row.UnmarshalJSONField("metadata", &m)` if needed and adapt the test).

- [ ] **Step 8: Commit**

```bash
git add core/server/backup/
git commit -m "feat(backup): restore phases, rebuilder registry and source swap"
```

---

### Task 9: Boot swap, finalize, maintenance mode, verify

**Files:**
- Create: `core/server/backup/bootswap.go`, `maintenance.go`, `verify.go`
- Test: `core/server/backup/bootswap_test.go`, `verify_test.go`

**Interfaces:**
- Produces:
```go
func ApplyPendingRestore(dataDir string) error   // pre-DB-open: swap pb_data ↔ pending; recover a half-swap
func FinalizeRestore(app core.App) error         // post-boot: mark the restore row succeeded, delete previous/ and pre/, notify, audit
func Restoring() bool                            // true from arm until the restored process finalizes
func MaintenanceMiddleware() func(*core.RequestEvent) error   // 503 JSON while Restoring()
type VerifyReport struct { IntegrityOK bool; Collections map[string][2]int; Files [2]int; OK bool }
func Verify(app core.App) (VerifyReport, error)  // counts vs the latest restore row's manifest
```

- [ ] **Step 1: Failing boot-swap tests**

`core/server/backup/bootswap_test.go`:
```go
package backup

import (
    "encoding/json"
    "os"
    "path/filepath"
    "testing"
)

func layout(t *testing.T) (dataDir string) {
    t.Helper()
    root := t.TempDir()
    dataDir = filepath.Join(root, "pb_data")
    mk := func(p, content string) {
        if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
            t.Fatal(err)
        }
        if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
            t.Fatal(err)
        }
    }
    mk(filepath.Join(dataDir, "data.db"), "old")
    mk(filepath.Join(dataDir, "storage", "a", "b", "old.txt"), "old")
    mk(filepath.Join(dataDir, "auxiliary.db"), "aux")
    pending := filepath.Join(root, "restore", "pending", "r1")
    mk(filepath.Join(pending, "data.db"), "new")
    mk(filepath.Join(pending, "storage", "c", "d", "new.txt"), "new")
    raw, _ := json.Marshal(armed{ID: "r1", Pending: pending, Pre: filepath.Join(root, "restore", "pre", "r1.age")})
    mk(armedPathOf(dataDir), string(raw))
    return dataDir
}

func read(t *testing.T, p string) string {
    b, err := os.ReadFile(p)
    if err != nil {
        return "<missing>"
    }
    return string(b)
}

func TestApplyPendingRestoreSwaps(t *testing.T) {
    dataDir := layout(t)
    if err := ApplyPendingRestore(dataDir); err != nil {
        t.Fatal(err)
    }
    if read(t, filepath.Join(dataDir, "data.db")) != "new" {
        t.Fatal("db not swapped")
    }
    if read(t, filepath.Join(dataDir, "storage", "c", "d", "new.txt")) != "new" {
        t.Fatal("files not swapped")
    }
    if read(t, filepath.Join(dataDir, "storage", "a", "b", "old.txt")) != "<missing>" {
        t.Fatal("old files still present")
    }
    if _, err := os.Stat(armedPathOf(dataDir)); !os.IsNotExist(err) {
        t.Fatal("armed marker not cleared")
    }
    prev := filepath.Join(filepath.Dir(dataDir), "restore", "previous", "r1")
    if read(t, filepath.Join(prev, "data.db")) != "old" {
        t.Fatal("previous not kept")
    }
    if read(t, swappedPathOf(dataDir)) == "<missing>" {
        t.Fatal("swapped marker missing")
    }
    if !Restoring() {
        t.Fatal("Restoring() must be true until finalize")
    }
}

func TestApplyPendingRestoreNoop(t *testing.T) {
    dataDir := filepath.Join(t.TempDir(), "pb_data")
    _ = os.MkdirAll(dataDir, 0o755)
    if err := ApplyPendingRestore(dataDir); err != nil {
        t.Fatal(err)
    }
}

func TestApplyPendingRestoreRecoversFromHalfSwap(t *testing.T) {
    dataDir := layout(t)
    // Simulate a crash after pb_data was moved aside but before pending moved in.
    prev := filepath.Join(filepath.Dir(dataDir), "restore", "previous", "r1")
    _ = os.MkdirAll(filepath.Dir(prev), 0o755)
    if err := os.Rename(dataDir, prev); err != nil {
        t.Fatal(err)
    }
    if err := ApplyPendingRestore(dataDir); err != nil {
        t.Fatal(err)
    }
    if read(t, filepath.Join(dataDir, "data.db")) != "new" {
        t.Fatal("did not complete the swap")
    }
}

func TestApplyPendingRestoreRollsBackAfterFailedBoot(t *testing.T) {
    dataDir := layout(t)
    if err := ApplyPendingRestore(dataDir); err != nil {
        t.Fatal(err)
    }
    // The process boots, fails before FinalizeRestore, and is relaunched:
    // the swapped marker is still there, so the next boot must swap back.
    if err := ApplyPendingRestore(dataDir); err != nil {
        t.Fatal(err)
    }
    if read(t, filepath.Join(dataDir, "data.db")) != "old" {
        t.Fatal("did not roll back")
    }
    if _, err := os.Stat(swappedPathOf(dataDir)); !os.IsNotExist(err) {
        t.Fatal("swapped marker not cleared after rollback")
    }
    if read(t, filepath.Join(filepath.Dir(dataDir), "restore", "failed", "r1", "data.db")) != "new" {
        t.Fatal("failed restore data not kept for inspection")
    }
}
```

- [ ] **Step 2: Implement `bootswap.go`**

```go
package backup

import (
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "path/filepath"
    "sync/atomic"

    "github.com/pocketbase/pocketbase/core"
    "github.com/pocketbase/pocketbase/tools/types"
)

var restoring atomic.Bool

func Restoring() bool { return restoring.Load() }

// ApplyPendingRestore runs before the database is opened. Three states:
//
//   - armed present, swapped absent: first boot after a restore staged its
//     data — move pb_data aside, move pending in, write swapped.
//   - swapped present: the previous boot swapped but never finalized (it
//     failed) — move the restored data to restore/failed/<id>, move previous
//     back, clear swapped.
//   - neither: nothing to do.
//
// Every step is a rename, so a crash between two of them is recognisable
// on the next boot.
func ApplyPendingRestore(dataDir string) error {
    if raw, err := os.ReadFile(swappedPathOf(dataDir)); err == nil {
        var a armed
        if err := json.Unmarshal(raw, &a); err != nil {
            return fmt.Errorf("backup: swapped marker unreadable: %w", err)
        }
        return rollBack(dataDir, a)
    }
    raw, err := os.ReadFile(armedPathOf(dataDir))
    if errors.Is(err, os.ErrNotExist) {
        return nil
    }
    if err != nil {
        return err
    }
    var a armed
    if err := json.Unmarshal(raw, &a); err != nil {
        return fmt.Errorf("backup: armed marker unreadable: %w", err)
    }
    if _, err := os.Stat(filepath.Join(a.Pending, "data.db")); err != nil {
        // Armed but never fully staged: the restore failed before phase 5
        // finished and the process died before it could disarm.
        _ = os.RemoveAll(a.Pending)
        return os.Remove(armedPathOf(dataDir))
    }
    return swapIn(dataDir, a)
}

func swapIn(dataDir string, a armed) error {
    prev := filepath.Join(restoreDirOf(dataDir), "previous", a.ID)
    if err := os.MkdirAll(filepath.Dir(prev), 0o700); err != nil {
        return err
    }
    if _, err := os.Stat(dataDir); err == nil {
        if err := os.Rename(dataDir, prev); err != nil {
            return fmt.Errorf("backup: move pb_data aside: %w", err)
        }
    }
    // pb_data is gone (or was already moved by a crashed earlier attempt).
    if err := os.MkdirAll(dataDir, 0o755); err != nil {
        return err
    }
    for _, name := range []string{"data.db", "storage"} {
        src := filepath.Join(a.Pending, name)
        if _, err := os.Stat(src); err != nil {
            continue
        }
        if err := os.Rename(src, filepath.Join(dataDir, name)); err != nil {
            return fmt.Errorf("backup: move %s in: %w", name, err)
        }
    }
    raw, _ := json.Marshal(a)
    if err := os.WriteFile(swappedPathOf(dataDir), raw, 0o600); err != nil {
        return err
    }
    _ = os.RemoveAll(a.Pending)
    if err := os.Remove(armedPathOf(dataDir)); err != nil && !errors.Is(err, os.ErrNotExist) {
        return err
    }
    restoring.Store(true)
    return nil
}

func rollBack(dataDir string, a armed) error {
    failed := filepath.Join(restoreDirOf(dataDir), "failed", a.ID)
    if err := os.MkdirAll(filepath.Dir(failed), 0o700); err != nil {
        return err
    }
    _ = os.RemoveAll(failed)
    if err := os.Rename(dataDir, failed); err != nil {
        return fmt.Errorf("backup: set the failed restore aside: %w", err)
    }
    prev := filepath.Join(restoreDirOf(dataDir), "previous", a.ID)
    if err := os.Rename(prev, dataDir); err != nil {
        return fmt.Errorf("backup: move previous data back: %w", err)
    }
    _ = os.Remove(armedPathOf(dataDir))
    return os.Remove(swappedPathOf(dataDir))
}

// FinalizeRestore runs after a successful boot of the restored data: the
// restore row (carried inside the restored DB, where it does not exist) is
// inserted as succeeded, the safety copies are dropped, everyone is told.
func FinalizeRestore(app core.App) error {
    raw, err := os.ReadFile(swappedPath(app))
    if errors.Is(err, os.ErrNotExist) {
        return nil
    }
    if err != nil {
        return err
    }
    var a armed
    if err := json.Unmarshal(raw, &a); err != nil {
        return err
    }
    row := newRow(app, KindRestore, "", "")
    row.Set("status", "succeeded")
    row.Set("finished", types.NowDateTime())
    row.Set("metadata", map[string]any{"restored_from_job": a.ID, "note": "history before this row is from the restored backup"})
    if err := app.Save(row); err != nil {
        return err
    }
    _ = os.RemoveAll(filepath.Join(restoreDir(app), "previous", a.ID))
    _ = os.Remove(a.Pre)
    if err := os.Remove(swappedPath(app)); err != nil {
        return err
    }
    restoring.Store(false)
    announceRestore(app, RestoreRequest{}, row, true, "")
    return nil
}
```
The restore row inside the *restored* DB has no initiator (the initiating user may not exist there); the initiating instance's own row stays `running` in the discarded DB, which is fine — that DB is gone.

- [ ] **Step 3: Implement `maintenance.go`**

```go
package backup

import (
    "net/http"

    "github.com/pocketbase/pocketbase/core"
)

// MaintenanceMiddleware answers 503 while a restore has swapped data in but
// the process has not finalized, and while a restore job is staging. Health
// stays reachable so a supervisor can probe.
func MaintenanceMiddleware() func(*core.RequestEvent) error {
    return func(re *core.RequestEvent) error {
        if !Restoring() || re.Request.URL.Path == "/api/health" {
            return re.Next()
        }
        return re.JSON(http.StatusServiceUnavailable, map[string]any{"status": "restoring", "message": "Restoring from a backup. Try again in a minute."})
    }
}
```
Also set `restoring.Store(true)` in `runRestore` right after phase 4 (arm) and `restoring.Store(false)` in its failure path.

- [ ] **Step 4: Implement `verify.go` + test**

```go
package backup

import (
    "database/sql"
    "fmt"

    "github.com/pocketbase/pocketbase/core"

    "tinycld.org/core/backup/format"
)

type VerifyReport struct {
    IntegrityOK bool                `json:"integrityOk"`
    Collections map[string][2]int   `json:"collections"` // name → [expected, actual]
    Files       [2]int              `json:"files"`
    OK          bool                `json:"ok"`
}

// Verify compares the live data with the manifest of the most recent
// succeeded restore. With no restore on record it only runs the integrity
// check.
func Verify(app core.App) (VerifyReport, error) {
    rep := VerifyReport{Collections: map[string][2]int{}}
    var ok string
    if err := app.DB().NewQuery("PRAGMA integrity_check").Row(&ok); err != nil {
        return rep, err
    }
    rep.IntegrityOK = ok == "ok"
    rows, err := app.FindRecordsByFilter(collection, "kind = 'restore' && status = 'succeeded'", "-created", 1, 0)
    if err != nil {
        return rep, err
    }
    rep.OK = rep.IntegrityOK
    if len(rows) == 0 {
        return rep, nil
    }
    var m format.Manifest
    if err := rows[0].UnmarshalJSONField("manifest", &m); err != nil {
        return rep, err
    }
    for name, want := range m.Counts.Collections {
        var n int
        if err := app.DB().NewQuery(fmt.Sprintf("SELECT count(*) FROM `%s`", name)).Row(&n); err != nil {
            n = -1
        }
        rep.Collections[name] = [2]int{want, n}
        if n != want {
            rep.OK = false
        }
    }
    fs, err := app.NewFilesystem()
    if err != nil {
        return rep, err
    }
    defer fs.Close()
    files, err := fs.List("")
    if err != nil {
        return rep, err
    }
    rep.Files = [2]int{m.Counts.Files, len(files)}
    if rep.Files[0] != rep.Files[1] {
        rep.OK = false
    }
    return rep, nil
}

var _ = sql.ErrNoRows
```
`FinalizeRestore` must copy the manifest onto the succeeded row for `Verify` to work: read it from the staged `armed` record — extend `armed` with `Manifest format.Manifest \`json:"manifest"\`` and set it in phase 4 of `runRestore`; then `row.Set("manifest", a.Manifest)` in `FinalizeRestore`. Update the boot-swap test's `armed{}` literal accordingly (an empty manifest is fine there).

`verify_test.go`: create a test app, call `Verify` → `IntegrityOK && OK` with no restore row; insert a `restore`/`succeeded` row with `manifest.counts.collections.users = 5` → `OK == false` and `Collections["users"] == [5, actual]`.

- [ ] **Step 5: Run all backup tests**

Run: `cd core/server && go test ./backup/... -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/
git commit -m "feat(backup): boot-time data swap, finalize, maintenance mode and verify"
```

---

### Task 10: `coreserver` wiring — routes, scope, boot hook, self-rebuild rebuilder

**Files:**
- Create: `core/server/coreserver/backup_api.go`, `core/server/coreserver/backup_rebuild.go`
- Modify: `core/server/oauth/oauth.go` (add `ScopeBackups`), `core/server/oauth/registry.go:299` (add the scope to core's list), `core/server/coreserver/server.go` (`RegisterSharedEarly` boot hook; `RegisterSharedCore` routes; `Register` self-rebuild registration + `SetSource`), `core/server/coreserver/composition_parity_test.go` if the parity test flags a host-only hook
- Test: `core/server/coreserver/backup_api_test.go`

**Interfaces:**
- Consumes: everything in `backup`, `requireAdmin`/`requireOwner`, `rebuild`, `newBuildID`, `productionRebuildDeps`, `requestRestart`, `checkpointWAL`.
- Produces:
```go
// oauth
const ScopeBackups = "backups"
const BackupsScopeLabel = "Create and restore backups"
// coreserver
func RegisterBackupEndpoints(app *pocketbase.PocketBase)   // in RegisterSharedCore
func RegisterBackupBoot(app *pocketbase.PocketBase)        // in RegisterSharedEarly
func RegisterBackupSelfRebuild(app *pocketbase.PocketBase) // in Register when supportsSelfRebuild()
```
Routes:
```
POST  /api/org-backups                  requireAdmin   {target, passphrase} → 202 {id} | {stream:true, passphrase} → 200 octet-stream
GET   /api/org-backups/{id}             requireAdmin   → the ledger row
POST  /api/org-backups/restore          requireOwner   JSON {source, passphrase, force} | multipart (archive, passphrase, force) → 202 {jobId}
PATCH /api/org-backups/restore/{id}     requireOwner   {source} → 204
GET   /api/org-backups/verify           requireAdmin   → VerifyReport
```

- [ ] **Step 1: OAuth scope**

`core/server/oauth/oauth.go` next to `ScopeProfile`:
```go
// ScopeBackups lets a token create backups and start restores; the role
// gate on the routes still applies (admin for backup, owner for restore).
const ScopeBackups = "backups"
const BackupsScopeLabel = "Create and restore backups"
```
`core/server/oauth/registry.go`, in `rebuild()`:
```go
scopes: []Scope{{ID: ScopeProfile, Label: ProfileScopeLabel}, {ID: ScopeBackups, Label: BackupsScopeLabel}},
```
and in `endpoints`:
```go
"POST /api/org-backups":          {ScopeBackups},
"POST /api/org-backups/restore":  {ScopeBackups},
"GET /api/org-backups/verify":    {ScopeBackups},
```
`GET /api/org-backups/{id}` and `PATCH …/{id}` have path parameters; register them with `RegisterSharedEndpoint` semantics if the endpoint table is exact-match only — read `ScopeForRoute` (`middleware.go`) and use whichever mechanism (`EndpointPrefixes` on a core entry, or a prefix rule) matches a wildcard; the test below asserts a token with `backups` can call `GET /api/org-backups/{id}`.

Run `cd core/server && go test ./oauth/...` — the discovery test that snapshots `scopes_supported` needs `"backups"` added.

- [ ] **Step 2: Failing route tests**

`core/server/coreserver/backup_api_test.go`:
```go
package coreserver

import (
    "bytes"
    "io"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"

    "filippo.io/age"
    "github.com/pocketbase/pocketbase/tests"

    "tinycld.org/core/backup/format"
)

func backupTestApp(t *testing.T) *tests.TestApp {
    t.Helper()
    app := setupBackupCollections(t) // copy newTestApp from backup/testapp_test.go into a helper here (test packages cannot import each other's _test files)
    RegisterBackupEndpoints(app)
    return app
}

func TestBackupStreamAsAdmin(t *testing.T) {
    app := backupTestApp(t)
    admin := mustCreateUser(t, app, "admin@example.com", "admin")
    token, _ := tokenForUser(app, admin)
    scenario := &tests.ApiScenario{
        Name:   "stream",
        Method: http.MethodPost,
        URL:    "/api/org-backups",
        Body:   strings.NewReader(`{"stream":true,"passphrase":"correct horse battery"}`),
        Headers: map[string]string{"Authorization": token, "Content-Type": "application/json"},
        ExpectedStatus: http.StatusOK,
        TestAppFactory: func(testing.TB) *tests.TestApp { return app },
        DisableTestAppCleanup: true,
        AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
            body, _ := io.ReadAll(res.Body)
            id, err := age.NewScryptIdentity("correct horse battery")
            if err != nil {
                t.Fatal(err)
            }
            if _, rep, err := format.Inspect(bytes.NewReader(body), id); err != nil || !rep.OK {
                t.Fatalf("streamed archive unreadable: %v", err)
            }
            if res.Header.Get("Content-Type") != "application/octet-stream" {
                t.Fatalf("content-type %q", res.Header.Get("Content-Type"))
            }
        },
    }
    scenario.Test(t)
}

func TestBackupToTargetReturns202(t *testing.T) {
    app := backupTestApp(t)
    admin := mustCreateUser(t, app, "admin@example.com", "admin")
    token, _ := tokenForUser(app, admin)
    var got int
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        b, _ := io.ReadAll(r.Body)
        got = len(b)
        w.WriteHeader(200)
    }))
    t.Cleanup(srv.Close)
    scenario := &tests.ApiScenario{
        Method: http.MethodPost, URL: "/api/org-backups",
        Body:    strings.NewReader(`{"target":"` + srv.URL + `/x.age","passphrase":"correct horse battery"}`),
        Headers: map[string]string{"Authorization": token, "Content-Type": "application/json"},
        ExpectedStatus: http.StatusAccepted, ExpectedContent: []string{`"id":`},
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
        AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
            waitFor(t, func() bool { return got > 0 })
            rows, _ := app.FindRecordsByFilter("backups", "status = 'succeeded'", "", 0, 0)
            if len(rows) != 1 || rows[0].GetString("target_host") != "127.0.0.1" {
                t.Fatalf("rows %v", rows)
            }
        },
    }
    scenario.Test(t)
}

func TestBackupRejectsShortPassphrase(t *testing.T) {
    app := backupTestApp(t)
    admin := mustCreateUser(t, app, "admin@example.com", "admin")
    token, _ := tokenForUser(app, admin)
    (&tests.ApiScenario{
        Method: http.MethodPost, URL: "/api/org-backups",
        Body:    strings.NewReader(`{"stream":true,"passphrase":"short"}`),
        Headers: map[string]string{"Authorization": token, "Content-Type": "application/json"},
        ExpectedStatus: http.StatusBadRequest, ExpectedContent: []string{"12 characters"},
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
    }).Test(t)
}

func TestBackupForbiddenForMember(t *testing.T) {
    app := backupTestApp(t)
    member := mustCreateUser(t, app, "m@example.com", "member")
    token, _ := tokenForUser(app, member)
    (&tests.ApiScenario{
        Method: http.MethodPost, URL: "/api/org-backups",
        Body:    strings.NewReader(`{"stream":true,"passphrase":"correct horse battery"}`),
        Headers: map[string]string{"Authorization": token, "Content-Type": "application/json"},
        ExpectedStatus: http.StatusForbidden,
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
    }).Test(t)
}

func TestRestoreOwnerOnlyAndMultipart(t *testing.T) {
    app := backupTestApp(t)
    admin := mustCreateUser(t, app, "admin@example.com", "admin")
    owner := mustCreateUser(t, app, "owner@example.com", "owner")
    adminTok, _ := tokenForUser(app, admin)
    ownerTok, _ := tokenForUser(app, owner)

    // Build an archive from this same app with a passphrase.
    rcpt, _ := age.NewScryptRecipient("correct horse battery")
    var archive bytes.Buffer
    streamBackupForTest(t, app, rcpt, &archive) // helper: backup.Run with a closeBuffer

    body, contentType := multipartArchive(t, archive.Bytes(), map[string]string{"passphrase": "correct horse battery"})
    (&tests.ApiScenario{
        Method: http.MethodPost, URL: "/api/org-backups/restore", Body: bytes.NewReader(body),
        Headers: map[string]string{"Authorization": adminTok, "Content-Type": contentType},
        ExpectedStatus: http.StatusForbidden,
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
    }).Test(t)

    body, contentType = multipartArchive(t, archive.Bytes(), map[string]string{"passphrase": "correct horse battery"})
    (&tests.ApiScenario{
        Method: http.MethodPost, URL: "/api/org-backups/restore", Body: bytes.NewReader(body),
        Headers: map[string]string{"Authorization": ownerTok, "Content-Type": contentType},
        ExpectedStatus: http.StatusAccepted, ExpectedContent: []string{`"jobId":`},
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
    }).Test(t)
}

func TestRestoreMismatchReturns409WithDiff(t *testing.T) {
    app := backupTestApp(t)
    owner := mustCreateUser(t, app, "owner@example.com", "owner")
    tok, _ := tokenForUser(app, owner)
    rcpt, _ := age.NewScryptRecipient("correct horse battery")
    var archive bytes.Buffer
    streamBackupForTest(t, app, rcpt, &archive)
    regs, _ := app.FindRecordsByFilter("pkg_registry", "slug = 'mail'", "", 0, 0)
    _ = app.Delete(regs[0])

    body, contentType := multipartArchive(t, archive.Bytes(), map[string]string{"passphrase": "correct horse battery", "sync": "1"})
    (&tests.ApiScenario{
        Method: http.MethodPost, URL: "/api/org-backups/restore", Body: bytes.NewReader(body),
        Headers: map[string]string{"Authorization": tok, "Content-Type": contentType},
        ExpectedStatus: http.StatusConflict, ExpectedContent: []string{`"missing":["mail"]`},
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
    }).Test(t)
}

func TestVerifyEndpoint(t *testing.T) {
    app := backupTestApp(t)
    admin := mustCreateUser(t, app, "admin@example.com", "admin")
    tok, _ := tokenForUser(app, admin)
    (&tests.ApiScenario{
        Method: http.MethodGet, URL: "/api/org-backups/verify",
        Headers: map[string]string{"Authorization": tok},
        ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"integrityOk":true`},
        TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
    }).Test(t)
}
```
Helpers to add in the same file: `setupBackupCollections` (the collection setup from `backup/testapp_test.go`, including the `pkg_registry` rows), `mustCreateUser` (exists in `helpers_test.go`? if not, add), `waitFor(t, cond)` polling 5 s, `streamBackupForTest`, and `multipartArchive(t, data, fields) ([]byte, string)` using `mime/multipart` with a file part named `archive`. The `sync=1` form field makes the handler run `backup.Restore` synchronously so the mismatch surfaces as the HTTP status; without it the handler uses `StartRestore` and the mismatch lands on the row. Both branches exist in the handler below.

- [ ] **Step 3: Implement `backup_api.go`**

```go
package coreserver

import (
    "encoding/json"
    "errors"
    "net/http"
    "strings"

    "filippo.io/age"
    "github.com/pocketbase/pocketbase"
    "github.com/pocketbase/pocketbase/core"

    "tinycld.org/core/backup"
    "tinycld.org/core/backup/format"
)

const minPassphrase = 12

type backupBody struct {
    Target     string `json:"target"`
    Stream     bool   `json:"stream"`
    Passphrase string `json:"passphrase"`
}

// RegisterBackupEndpoints binds the org backup API. Same routes in every
// composition; an embedder that wants to trigger backups from outside calls
// the backup package directly.
func RegisterBackupEndpoints(app *pocketbase.PocketBase) {
    app.OnServe().BindFunc(func(e *core.ServeEvent) error {
        g := e.Router.Group("/api/org-backups")
        g.POST("", func(re *core.RequestEvent) error { return handleBackupCreate(app, re) }).BindFunc(requireAdmin)
        g.GET("/verify", func(re *core.RequestEvent) error { return handleBackupVerify(app, re) }).BindFunc(requireAdmin)
        g.POST("/restore", func(re *core.RequestEvent) error { return handleRestore(app, re) }).BindFunc(requireOwner)
        g.PATCH("/restore/{id}", handleRestoreSwap).BindFunc(requireOwner)
        g.GET("/{id}", func(re *core.RequestEvent) error { return handleBackupGet(app, re) }).BindFunc(requireAdmin)
        return e.Next()
    })
}

func passphraseRecipient(p string) (age.Recipient, error) {
    if len(p) < minPassphrase {
        return nil, errors.New("passphrase must be at least 12 characters")
    }
    return age.NewScryptRecipient(p)
}

func handleBackupCreate(app *pocketbase.PocketBase, re *core.RequestEvent) error {
    var body backupBody
    if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
        return re.BadRequestError("invalid JSON body", err)
    }
    rcpt, err := passphraseRecipient(body.Passphrase)
    if err != nil {
        return re.BadRequestError(err.Error(), nil)
    }
    initiator := ""
    if re.Auth != nil && re.Auth.Collection().Name == "users" {
        initiator = re.Auth.Id
    }
    if body.Stream {
        re.Response.Header().Set("Content-Type", "application/octet-stream")
        re.Response.Header().Set("Content-Disposition", `attachment; filename="tinycld-backup.age"`)
        re.Response.Header().Set("Cache-Control", "no-store")
        re.Response.WriteHeader(http.StatusOK)
        sink := flushingSink{w: re.Response}
        _, err := backup.Run(app, backup.Request{Kind: backup.KindManual, Recipient: rcpt, Sink: sink, Initiator: initiator, Request: re})
        if err != nil {
            // Headers are gone; the client sees a truncated body and the ledger says why.
            return nil
        }
        return nil
    }
    if !strings.HasPrefix(body.Target, "https://") && !strings.HasPrefix(body.Target, "http://") {
        return re.BadRequestError("target must be an http(s) URL", nil)
    }
    id, err := backup.Start(app, backup.Request{
        Kind: backup.KindManual, Recipient: rcpt,
        Sink: format.NewPutSink(re.Request.Context(), body.Target),
        Initiator: initiator, TargetHost: backup.HostOnly(body.Target), Request: re,
    })
    return backupStartError(re, id, err)
}

func backupStartError(re *core.RequestEvent, id string, err error) error {
    switch {
    case err == nil:
        return re.JSON(http.StatusAccepted, map[string]string{"id": id})
    case errors.Is(err, backup.ErrBusy):
        return re.JSON(http.StatusConflict, map[string]string{"message": "Another backup, restore or package job is running."})
    case errors.Is(err, backup.ErrRateLimit):
        return re.JSON(http.StatusTooManyRequests, map[string]string{"message": "The daily limit for manual backups has been reached."})
    default:
        return re.InternalServerError("could not start the backup", err)
    }
}

// flushingSink pushes each chunk to the client so a slow walk still streams.
type flushingSink struct{ w http.ResponseWriter }

func (f flushingSink) Write(p []byte) (int, error) {
    n, err := f.w.Write(p)
    if fl, ok := f.w.(http.Flusher); ok {
        fl.Flush()
    }
    return n, err
}
func (f flushingSink) Close() error { return nil }

func handleBackupGet(app *pocketbase.PocketBase, re *core.RequestEvent) error {
    row, err := app.FindRecordById("backups", re.Request.PathValue("id"))
    if err != nil {
        return re.NotFoundError("backup not found", nil)
    }
    return re.JSON(http.StatusOK, row.PublicExport())
}

func handleBackupVerify(app *pocketbase.PocketBase, re *core.RequestEvent) error {
    rep, err := backup.Verify(app)
    if err != nil {
        return re.InternalServerError("verify failed", err)
    }
    return re.JSON(http.StatusOK, rep)
}

type restoreBody struct {
    Source     string `json:"source"`
    Passphrase string `json:"passphrase"`
    Force      bool   `json:"force"`
}

func handleRestore(app *pocketbase.PocketBase, re *core.RequestEvent) error {
    initiator := ""
    if re.Auth != nil && re.Auth.Collection().Name == "users" {
        initiator = re.Auth.Id
    }
    req := backup.RestoreRequest{Initiator: initiator, Request: re}
    sync := false
    ct := re.Request.Header.Get("Content-Type")
    if strings.HasPrefix(ct, "multipart/") {
        mr, err := re.Request.MultipartReader()
        if err != nil {
            return re.BadRequestError("invalid multipart body", err)
        }
        // Fields come before the file part; the CLI writes them in that order
        // so the archive can be streamed rather than buffered.
        var passphrase string
        for {
            part, err := mr.NextPart()
            if err != nil {
                return re.BadRequestError("archive part missing", err)
            }
            switch part.FormName() {
            case "passphrase":
                b := make([]byte, 1024)
                n, _ := part.Read(b)
                passphrase = string(b[:n])
                continue
            case "force":
                req.Force = true
                continue
            case "sync":
                sync = true
                continue
            case "archive":
                id, err := age.NewScryptIdentity(passphrase)
                if err != nil || len(passphrase) < minPassphrase {
                    return re.BadRequestError("passphrase must be at least 12 characters", nil)
                }
                req.Identity = id
                req.Source = part
                req.SourceHost = "upload"
            }
            break
        }
    } else {
        var body restoreBody
        if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
            return re.BadRequestError("invalid JSON body", err)
        }
        if len(body.Passphrase) < minPassphrase {
            return re.BadRequestError("passphrase must be at least 12 characters", nil)
        }
        id, err := age.NewScryptIdentity(body.Passphrase)
        if err != nil {
            return re.BadRequestError("invalid passphrase", err)
        }
        if !strings.HasPrefix(body.Source, "https://") && !strings.HasPrefix(body.Source, "http://") {
            return re.BadRequestError("source must be an http(s) URL", nil)
        }
        src := format.NewRangeSource(re.Request.Context(), body.Source)
        req.Identity, req.Source, req.Ranged, req.Force, req.SourceHost = id, src, src, body.Force, backup.HostOnly(body.Source)
    }
    if req.Source == nil {
        return re.BadRequestError("no archive supplied", nil)
    }
    var jobID string
    var err error
    if sync || strings.HasPrefix(ct, "multipart/") {
        // A request body cannot outlive the request, so an upload restores synchronously.
        jobID, err = backup.Restore(app, req)
    } else {
        jobID, err = backup.StartRestore(app, req)
    }
    var mismatch *backup.MismatchError
    switch {
    case err == nil:
        return re.JSON(http.StatusAccepted, map[string]string{"jobId": jobID})
    case errors.As(err, &mismatch):
        return re.JSON(http.StatusConflict, map[string]any{"message": err.Error(), "diff": mismatch.Diff, "jobId": jobID})
    case errors.Is(err, backup.ErrBusy):
        return re.JSON(http.StatusConflict, map[string]string{"message": "Another backup, restore or package job is running."})
    default:
        return re.JSON(http.StatusUnprocessableEntity, map[string]string{"message": err.Error(), "jobId": jobID})
    }
}

func handleRestoreSwap(re *core.RequestEvent) error {
    var body struct {
        Source string `json:"source"`
    }
    if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil || body.Source == "" {
        return re.BadRequestError("source required", err)
    }
    if err := backup.SwapSource(re.Request.PathValue("id"), body.Source); err != nil {
        return re.NotFoundError("no restore is waiting for a source", nil)
    }
    return re.NoContent(http.StatusNoContent)
}
```
Note: the multipart-upload restore holds the request open through phase 6; the rebuilder ends the process, so the client sees the connection drop after the 202 — the CLI (Plan 2) treats that as expected and polls `GET /api/org-backups/{id}` after reconnecting. Send the 202 *before* calling `backup.Restore` in the multipart branch is not possible (the mismatch needs to be reported); instead the CLI relies on the row. Keep the code as written; document it in the handler comment.

- [ ] **Step 4: Implement `backup_rebuild.go`**

```go
package coreserver

import (
    "context"
    "fmt"

    "github.com/pocketbase/pocketbase"

    "tinycld.org/core/backup"
    "tinycld.org/core/backup/format"
    "tinycld.org/core/installjob"
)

// RegisterBackupSelfRebuild plugs the self-host rebuild pipeline in as the
// restore's rebuilder: build the archive's lockfile from scratch, skip the
// migration sync (the live DB is about to be replaced), activate, restart.
func RegisterBackupSelfRebuild(app *pocketbase.PocketBase) {
    backup.RegisterRebuilder(func(_ context.Context, lf format.Lockfile) error {
        job := installjob.New("restore", "", "")
        if _, ok := installjob.Claim(job); !ok {
            return backup.ErrBusy
        }
        defer finishJob(job)
        m := RebuildManifest{BuildID: newBuildID()}
        for slug, spec := range lf {
            member := slug
            if slug == "tinycld" {
                member = BaseMemberSlug
            }
            m.Members = append(m.Members, MemberSpec{Slug: member, Spec: spec})
        }
        logRecord := createInstallLog(app, job, "install")
        deps := productionRebuildDeps(app, job, m, logRecord)
        deps.syncMig = func(string) (SyncResult, error) { return SyncResult{}, nil }
        if err := rebuildWith(job, m, deps); err != nil {
            return fmt.Errorf("rebuild for restore: %w", err)
        }
        return nil
    })
    backup.SetRestart(func() {
        checkpointWAL(app)
        requestRestart("")
    })
}
```
`MemberSpec.Version` is discovered from the fetched bytes by `assembleBuild`; leave it empty. If `assembleBuild` requires `Version`, read it from the manifest's `Packages` map (pass `format.Manifest` instead of just the lockfile — change the `Rebuilder` signature to `func(ctx, format.Manifest) error` in Task 8 and here). Confirm the `createInstallLog` action value `install` is accepted (it is in the select list), and that `BaseMemberSlug` is the exported alias in `pkgbuild_glue.go`.

- [ ] **Step 5: Wire into `server.go`**

In `RegisterSharedEarly`, before the logging `OnBootstrap` hook:
```go
    // A restore that staged data before the last restart swaps it in here,
    // before PocketBase opens the database. After bootstrap, rows a dead
    // process left running are closed and a swapped-in restore is finalized.
    RegisterBackupBoot(app)
```
`backup_api.go` gets (add imports `fmt`, `os`, `path/filepath`, `time`):
```go
func RegisterBackupBoot(app *pocketbase.PocketBase) {
    bootedAt := time.Now()
    app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
        if err := backup.ApplyPendingRestore(app.DataDir()); err != nil {
            return fmt.Errorf("apply pending restore: %w", err)
        }
        if err := e.Next(); err != nil {
            return err
        }
        _ = os.RemoveAll(filepath.Join(backup.LedgerPath(app), "backup-tmp"))
        if err := backup.MarkInterrupted(app, bootedAt); err != nil {
            srvLog.Warn("could not close interrupted backup rows", "err", err)
        }
        return nil
    })
    app.OnServe().BindFunc(func(e *core.ServeEvent) error {
        e.Router.BindFunc(backup.MaintenanceMiddleware())
        if err := backup.FinalizeRestore(app); err != nil {
            srvLog.Error("could not finalize a restore", "err", err)
        }
        return e.Next()
    })
}
```
In `RegisterSharedCore`, near the other route registrations: `RegisterBackupEndpoints(app)`.
In `Register`, inside the `if opts.supportsSelfRebuild()` block: `RegisterBackupSelfRebuild(app)`; and before it, `backup.SetSource(map[bool]string{true: "docker", false: "standalone"}[opts.supportsSelfRebuild()])` — write it as an if/else for clarity.

Check `composition_parity_test.go`: `RegisterBackupBoot`/`RegisterBackupEndpoints` are in the shared functions so the parity test passes without an allowlist change; `RegisterBackupSelfRebuild` binds no hooks (only a registry call), so it needs no entry. If the test reports a diff, add the entry with the reason "self-rebuild only exists where a toolchain does".

- [ ] **Step 6: Run coreserver, oauth, backup tests**

Run: `cd core/server && go test ./backup/... ./coreserver/... ./oauth/... 2>&1 | tail -30`
Expected: PASS. Then `go vet ./...`.

- [ ] **Step 7: Core isolation check**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run check:core-isolation`
Expected: no new findings (no package slug or hosting word in the new files).

- [ ] **Step 8: Commit**

```bash
git add core/server/coreserver/backup_api.go core/server/coreserver/backup_rebuild.go core/server/coreserver/backup_api_test.go core/server/coreserver/server.go core/server/oauth/
git commit -m "feat(core): backup and restore API, boot hook and self-rebuild rebuilder"
```

---

### Task 11: TS — collection registration and `formatTimeAgo`

**Files:**
- Modify: `core/lib/pocketbase.ts` (~line 320 declarations, ~line 376 `coreStores`), `core/lib/format-utils.ts`
- Test: `core/tests/unit/format-time-ago.test.ts`

**Interfaces:**
- Produces: `useStore('backups')`; `formatTimeAgo(iso: string, now?: Date): string` → `'just now' | '5m ago' | '3h ago' | '2d ago' | <locale date>`.

- [ ] **Step 1: Failing test**

`core/tests/unit/format-time-ago.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatTimeAgo } from '../../lib/format-utils'

const now = new Date('2026-09-24T12:00:00Z')

describe('formatTimeAgo', () => {
    it('handles PocketBase space-separated timestamps', () => {
        expect(formatTimeAgo('2026-09-24 11:59:40.000Z', now)).toBe('just now')
    })
    it('minutes, hours, days', () => {
        expect(formatTimeAgo('2026-09-24T11:55:00Z', now)).toBe('5m ago')
        expect(formatTimeAgo('2026-09-24T09:00:00Z', now)).toBe('3h ago')
        expect(formatTimeAgo('2026-09-22T12:00:00Z', now)).toBe('2d ago')
    })
    it('falls back to a date beyond a week', () => {
        expect(formatTimeAgo('2026-09-01T12:00:00Z', now)).toBe(new Date('2026-09-01T12:00:00Z').toLocaleDateString())
    })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /Users/nas/code/tinycld/tinycld/core && pnpm run test -- format-time-ago`
Expected: FAIL — `formatTimeAgo` is not exported.

- [ ] **Step 3: Implement**

Append to `core/lib/format-utils.ts`:
```ts
export function formatTimeAgo(iso: string, now: Date = new Date()): string {
    const then = new Date(iso.replace(' ', 'T'))
    const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return then.toLocaleDateString()
}
```
Then replace the local `formatRelativeTime` in `core/components/NotificationDrawer.tsx` with an import of `formatTimeAgo` (same ladder; delete the local copy and its export, and update any test that imported it).

- [ ] **Step 4: Register the collection**

In `core/lib/pocketbase.ts`, after `audit_logs`:
```ts
// The backup ledger. Read-only from the client: the server writes every row.
const backups = newCollection('backups', {
    relations: { initiated_by: users },
    ...indexing,
})
```
and add `backups,` to the `coreStores` object.

- [ ] **Step 5: Run checks**

Run: `cd /Users/nas/code/tinycld/tinycld/core && pnpm run check`
Expected: biome, tsc, vitest all pass. (`pbSchema.ts` must already contain `Backups` from Task 3; if not, rerun `pnpm run packages:generate` from `tinycld/`.)

- [ ] **Step 6: Commit**

```bash
git add core/lib/pocketbase.ts core/lib/format-utils.ts core/components/NotificationDrawer.tsx core/tests/unit/format-time-ago.test.ts
git commit -m "feat(core): register backups collection; shared formatTimeAgo"
```

---

### Task 12: TS — Settings → Backups screen

**Files:**
- Create: `core/components/settings/backups/useBackups.ts`, `BackupsSection.tsx`, `BackupNowForm.tsx`, `RestoreForm.tsx`, `BackupHistory.tsx`, `CliCard.tsx`, `app/a/(app)/settings/backups.tsx`
- Modify: `app/a/(app)/settings/index.tsx` (Organization group, after the Audit Log row; lucide import `DatabaseBackup`)
- Test: `core/tests/unit/backups-section.test.tsx`

**Interfaces:**
- Consumes: `useStore('backups','users')`, `pb.send`, `useMutation`/`mutation`, `handleMutationErrorsWithForm`, `formatTimeAgo`, `formatBytes`, `useCurrentRole`, `HelpIcon`.
- Produces:
```ts
// useBackups.ts
export type BackupRow = NonNullable<ReturnType<typeof useBackupRows>['data']>[number]
export function useBackupRows()                    // live query, newest first, with initiatorName
export function lastBackedUp(rows): { label: string; isStale: boolean }      // pure; 'Last backed up 3h ago' | 'Never backed up'; stale when > 7 days or never
export function useBackupNow()                     // form + mutation → POST /api/org-backups {target, passphrase}
export function useRestore()                       // form + mutation → POST /api/org-backups/restore {source, passphrase}
export function useSwapSource(jobId)               // form + mutation → PATCH
export function useDismissPreRestoreKey(row)       // no server call: pre-restore identity is shown from row.metadata; dismiss hides it locally (useState)
```

- [ ] **Step 1: Failing component test**

`core/tests/unit/backups-section.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupsSection } from '../../components/settings/backups/BackupsSection'
import { lastBackedUp } from '../../components/settings/backups/useBackups'

const rowsMock = vi.fn<() => { data: unknown[] | undefined }>(() => ({ data: [] }))
vi.mock('../../components/settings/backups/useBackups', async importOriginal => {
    const actual = await importOriginal<typeof import('../../components/settings/backups/useBackups')>()
    return { ...actual, useBackupRows: () => rowsMock() }
})
vi.mock('@tinycld/core/lib/use-current-role', () => ({
    useCurrentRole: () => ({ isOwner: true, isAdmin: true, isReady: true }),
}))

afterEach(cleanup)

function renderSection() {
    return render(
        <QueryClientProvider client={new QueryClient()}>
            <BackupsSection />
        </QueryClientProvider>
    )
}

describe('BackupsSection', () => {
    it('says never backed up with an empty ledger', () => {
        renderSection()
        expect(screen.getByText('Never backed up')).toBeTruthy()
    })
    it('shows the newest succeeded run', () => {
        const recent = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
        rowsMock.mockReturnValueOnce({
            data: [{ id: 'b1', kind: 'manual', status: 'succeeded', started: recent, finished: recent, bytes: 2048, initiatorName: 'Ada' }],
        })
        renderSection()
        expect(screen.getByText('Last backed up 3h ago')).toBeTruthy()
    })
})

describe('lastBackedUp', () => {
    it('flags stale after 7 days', () => {
        const old = new Date(Date.now() - 8 * 86400 * 1000).toISOString()
        const r = lastBackedUp([{ status: 'succeeded', finished: old, kind: 'manual' } as never])
        expect(r.isStale).toBe(true)
    })
})
```
`lastBackedUp` is a pure function (no hooks inside) so the last test can call it directly.

- [ ] **Step 2: Run to see it fail**

Run: `cd /Users/nas/code/tinycld/tinycld/core && pnpm run test -- backups-section`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `useBackups.ts`**

```ts
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { formatTimeAgo } from '@tinycld/core/lib/format-utils'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useForm, z, zodResolver } from '@tinycld/core/ui/form'

const STALE_MS = 7 * 86400 * 1000

export function useBackupRows() {
    const [backupsCollection, usersCollection] = useStore('backups', 'users')
    return useLiveQuery(
        query =>
            query
                .from({ backup: backupsCollection })
                .join({ initiator: usersCollection }, ({ backup, initiator }) => eq(backup.initiated_by, initiator.id))
                .orderBy(({ backup }) => backup.started, 'desc')
                .select(({ backup, initiator }) => ({ ...backup, initiatorName: initiator?.name })),
        [backupsCollection, usersCollection]
    )
}

export type BackupRow = NonNullable<ReturnType<typeof useBackupRows>['data']>[number]

export function lastBackedUp(rows: ReadonlyArray<Pick<BackupRow, 'status' | 'finished' | 'kind'>> | undefined) {
    const last = rows?.find(r => r.status === 'succeeded' && r.kind !== 'restore')
    if (!last?.finished) return { label: 'Never backed up', isStale: true }
    const age = Date.now() - new Date(last.finished.replace(' ', 'T')).getTime()
    return { label: `Last backed up ${formatTimeAgo(last.finished)}`, isStale: age > STALE_MS }
}

const urlField = z.string().url('Enter a full https:// URL')
const passphraseField = z.string().min(12, 'At least 12 characters')

const backupSchema = z
    .object({ target: urlField, passphrase: passphraseField, confirm: z.string() })
    .refine(v => v.passphrase === v.confirm, { path: ['confirm'], message: 'Passphrases do not match' })

export function useBackupNow() {
    const form = useForm({
        mode: 'onChange',
        resolver: zodResolver(backupSchema),
        defaultValues: { target: '', passphrase: '', confirm: '' },
    })
    const { setError, getValues, reset } = form
    const start = useMutation({
        mutationFn: (data: z.infer<typeof backupSchema>) =>
            pb.send<{ id: string }>('/api/org-backups', {
                method: 'POST',
                body: { target: data.target, passphrase: data.passphrase },
            }),
        onSuccess: () => reset(),
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })
    return { form, start }
}

const restoreSchema = z.object({
    source: urlField,
    passphrase: passphraseField,
    acknowledged: z.literal(true, { errorMap: () => ({ message: 'Confirm that current data will be replaced' }) }),
})

export function useRestore() {
    const form = useForm({
        mode: 'onChange',
        resolver: zodResolver(restoreSchema),
        defaultValues: { source: '', passphrase: '', acknowledged: false as const },
    })
    const { setError, getValues } = form
    const start = useMutation({
        mutationFn: (data: z.infer<typeof restoreSchema>) =>
            pb.send<{ jobId: string }>('/api/org-backups/restore', {
                method: 'POST',
                body: { source: data.source, passphrase: data.passphrase },
            }),
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })
    return { form, start }
}

const swapSchema = z.object({ source: urlField })

export function useSwapSource(jobId: string) {
    const queryClient = useQueryClient()
    const form = useForm({ mode: 'onChange', resolver: zodResolver(swapSchema), defaultValues: { source: '' } })
    const { setError, getValues, reset } = form
    const swap = useMutation({
        mutationFn: (data: z.infer<typeof swapSchema>) =>
            pb.send(`/api/org-backups/restore/${jobId}`, { method: 'PATCH', body: { source: data.source } }),
        onSuccess: () => {
            reset()
            queryClient.invalidateQueries({ queryKey: ['backups'] })
        },
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })
    return { form, swap }
}
```
`useMutation` from `@tinycld/core/lib/mutations` accepts a plain async `mutationFn` (check its signature at `core/lib/mutations.ts:172`; if it only accepts generator functions, wrap with `mutation(function* (data) { return yield* … })` — read the file and follow what `InviteLinkPanel.tsx` does for `pb.send`).

- [ ] **Step 4: Implement the components**

`BackupsSection.tsx`:
```tsx
import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { Text, View } from 'react-native'
import { BackupHistory } from './BackupHistory'
import { BackupNowForm } from './BackupNowForm'
import { CliCard } from './CliCard'
import { RestoreForm } from './RestoreForm'
import { lastBackedUp, useBackupRows } from './useBackups'

export function BackupsSection() {
    const { isOwner } = useCurrentRole()
    const { data: rows } = useBackupRows()
    const status = lastBackedUp(rows)
    const running = rows?.find(r => r.status === 'running' || r.status === 'waiting_for_source')
    const toneClass = status.isStale ? 'text-warning' : 'text-muted-foreground'

    return (
        <View className="gap-6" testID="settings-section-backups">
            <View className="flex-row items-center gap-1.5">
                <Text className={`text-sm ${toneClass}`} testID="backups-last">
                    {status.label}
                </Text>
                <HelpIcon topic="core:backups" />
            </View>
            <BackupNowForm isBusy={running !== undefined} />
            <RestoreForm isVisible={isOwner} isBusy={running !== undefined} />
            <BackupHistory rows={rows ?? []} />
            <CliCard />
        </View>
    )
}
```
If the theme has no `text-warning` token, use `text-destructive` for stale — check `core/global.css` / tailwind config for the semantic token list and pick an existing one.

`BackupNowForm.tsx`:
```tsx
import { FormErrorSummary, TextInput } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import { useBackupNow } from './useBackups'

type Props = { isBusy: boolean }

export function BackupNowForm({ isBusy }: Props) {
    const { form, start } = useBackupNow()
    const { control, handleSubmit, formState } = form
    const onSubmit = handleSubmit(data => start.mutate(data))
    const disabled = isBusy || start.isPending || !formState.isValid

    return (
        <View className="rounded-xl border border-border bg-surface-secondary p-4 gap-3">
            <Text className="text-foreground font-semibold">Back up now</Text>
            <Text className="text-xs text-muted-foreground">
                The backup is streamed to a URL you provide (a presigned PUT to S3, R2, B2 or any compatible store). It is encrypted with your passphrase. Losing the passphrase makes the backup unreadable.
            </Text>
            <FormErrorSummary errors={formState.errors} isEnabled={formState.isSubmitted} />
            <TextInput control={control} name="target" label="Upload URL" autoCapitalize="none" autoCorrect={false} />
            <TextInput control={control} name="passphrase" label="Passphrase" secureTextEntry />
            <TextInput control={control} name="confirm" label="Confirm passphrase" secureTextEntry />
            <Pressable onPress={onSubmit} disabled={disabled} testID="backup-start" className={disabled ? 'opacity-50' : ''}>
                <Text className="text-primary font-medium">{isBusy ? 'A job is running…' : 'Start backup'}</Text>
            </Pressable>
        </View>
    )
}
```
`RestoreForm.tsx` — same shape with `isVisible` (return `null` when false), fields `source`, `passphrase`, a `Toggle` named `acknowledged` labelled "I understand that all current data is replaced", copy explaining the pre-restore safety copy and that the app is unavailable during the restore, button "Restore" with `testID="restore-start"`. A 409 response (mismatch) reaches `handleMutationErrorsWithForm` as a toast; append to the copy: "If the package set differs, use the CLI with --force."

`BackupHistory.tsx`:
```tsx
import { formatBytes } from '@tinycld/core/lib/format-utils'
import { formatTimeAgo } from '@tinycld/core/lib/format-utils'
import { Text, View } from 'react-native'
import { SwapSourceForm } from './SwapSourceForm'
import type { BackupRow } from './useBackups'

type Props = { rows: BackupRow[] }

const KIND_LABEL: Record<string, string> = {
    manual: 'Manual backup',
    scheduled: 'Scheduled backup',
    pre_restore: 'Pre-restore safety copy',
    restore: 'Restore',
}

export function BackupHistory({ rows }: Props) {
    if (rows.length === 0) return <Text className="text-sm text-muted-foreground">No backups yet.</Text>
    return (
        <View className="gap-2">
            <Text className="text-foreground font-semibold">History</Text>
            {rows.map(row => (
                <HistoryRow key={row.id} row={row} />
            ))}
        </View>
    )
}

function HistoryRow({ row }: { row: BackupRow }) {
    const size = row.bytes ? formatBytes(row.bytes) : '—'
    const who = row.initiatorName ?? 'System'
    return (
        <View className="rounded-lg border border-border p-3 gap-1" testID={`backup-row-${row.id}`}>
            <View className="flex-row justify-between">
                <Text className="text-foreground">{KIND_LABEL[row.kind] ?? row.kind}</Text>
                <StatusBadge status={row.status} />
            </View>
            <Text className="text-xs text-muted-foreground">
                {formatTimeAgo(row.started)} · {who} · {size}
            </Text>
            <ErrorLine message={row.error} />
            <SwapSourceForm isVisible={row.status === 'waiting_for_source'} jobId={row.id} />
            <PreRestoreKey row={row} />
        </View>
    )
}
```
Implement `StatusBadge` (text per status, muted/destructive tone), `ErrorLine` (returns `null` when empty), `PreRestoreKey` (shows `row.metadata.pre_restore_identity` for a `restore` row still `running`/`failed`, with a "Copy" via `expo-clipboard` like `InviteLinkPanel.tsx`, and a local `useState` dismiss), and `SwapSourceForm.tsx` (one `TextInput` "Fresh URL" + button, `useSwapSource(jobId)`). The `.map` in `BackupHistory` is the one allowed list render; every branch is a component with `isVisible`/early `null`.

`CliCard.tsx`: a `rounded-xl border` block with the text `tinycld backup create --out ./backup.age` in a monospace `Text` (`className="font-mono text-xs"`) and a copy affordance like `InviteLinkPanel.tsx`; a second line `tinycld backup restore --from ./backup.age`.

`app/a/(app)/settings/backups.tsx` — copy `builds.tsx` verbatim, replace the title with "Backups", gate on `isAdmin` (message "Only admins can manage backups."), render `<BackupsSection />`, `testID` stays inside the section.

`settings/index.tsx`: add `DatabaseBackup` to the lucide import and, after the Audit Log `SettingsLink`:
```tsx
                    <SettingsLink
                        label="Backups"
                        onPress={() => router.push(orgHref('settings/backups'))}
                        icon={<DatabaseBackup size={20} color={foregroundColor} />}
                    />
```

- [ ] **Step 5: Run tests and checks**

Run: `cd /Users/nas/code/tinycld/tinycld/core && pnpm run test -- backups-section && pnpm run check && cd .. && pnpm run checks`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add core/components/settings/backups/ "app/a/(app)/settings/backups.tsx" "app/a/(app)/settings/index.tsx" core/tests/unit/backups-section.test.tsx
git commit -m "feat(settings): Backups panel with backup, restore and history"
```

---

### Task 13: Help topic and single-binary docs

**Files:**
- Create: `core/help/backups.md`
- Modify: `docs/single-binary.md` (the `## Backups` section)

- [ ] **Step 1: Write `core/help/backups.md`**

```markdown
---
title: Backups & restore
summary: Back up the whole organization to your own storage, and restore it
tags: [backup, restore, export, disaster recovery, s3]
order: 56
---

## What a backup contains

A backup is one encrypted file. It holds the database, every uploaded file,
and the list of installed packages with their versions. It does not hold
build output — a restore rebuilds the packages from that list.

## Back up from Settings

1. Open **Settings → Backups**.
2. Enter an **upload URL**. The server streams the backup to this URL with an
   HTTP PUT, so use a presigned PUT URL from your storage provider (S3, R2,
   B2, GCS and MinIO all support these). Presign it **without** a
   content-length condition; the upload is chunked.
3. Enter a **passphrase** of at least 12 characters, twice. The backup is
   encrypted with it. If you lose the passphrase, the backup cannot be read
   by anyone, including us.
4. Choose **Start backup**. The row in **History** shows progress and the
   result. Owners and admins receive a notification when it finishes.

To make a presigned PUT URL with the AWS CLI:

```
aws s3 presign --expires-in 3600 s3://my-bucket/tinycld/backup.age --method PUT
```

## Back up with the command line

`tinycld backup create --out ./backup.age` streams the backup to a file on
your computer. See [Command line](help://core:command-line) to install and
sign in. The CLI prompts for the passphrase.

## Restore

Only an owner can restore. Restoring **replaces all current data** with the
backup. Before it does, the server makes a safety copy of the current data
and shows you its key in **History** until the restore succeeds.

1. Open **Settings → Backups → Restore**.
2. Enter a **download URL** for the backup (a presigned GET URL) and the
   passphrase.
3. Confirm that current data is replaced and choose **Restore**.

The app is unavailable while the restore runs: it rebuilds the packages the
backup lists, then restarts with the restored data. If the download URL
expires during a long restore, the History row asks for a fresh URL and
continues where it stopped.

From the command line: `tinycld backup restore --from ./backup.age`.

## Self-hosted servers

A Docker self-host restores exactly like a hosted organization. A single
binary cannot rebuild packages: it restores when the backup's package set
matches the binary's, and refuses otherwise. `tinycld backup restore --force`
restores the data anyway and lets the binary apply any pending migrations;
packages the binary lacks stay unavailable.

Settings managed outside the organization (error reporting, web push, mail
sending on a hosted instance) are not part of a backup. Enter them again
after restoring onto a different server.

## Limits

One backup or restore runs at a time, and never during a package install.
Manual backups are limited to a daily number per organization.
```

- [ ] **Step 2: Update `docs/single-binary.md`**

Replace its `## Backups` section body with:
```markdown
Use `tinycld backup create --out ./backup.age` from the CLI, or Settings →
Backups in the app. Restoring into the single binary works when the backup's
package set matches the binary's; otherwise `tinycld backup restore --force`
restores the data without reconciling packages. See the in-app topic
"Backups & restore".
```

- [ ] **Step 3: Regenerate and verify the topic is listed**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate && grep -c "core:backups\|backups" lib/generated/package-help.ts`
Expected: ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add core/help/backups.md docs/single-binary.md
git commit -m "docs: backups help topic"
```

---

### Task 14: Playwright spec

**Files:**
- Create: `tests/e2e/settings-backups.spec.ts`
- Modify: `scripts/e2e-serve.ts` only if a local PUT sink cannot be provided otherwise (see Step 1)

- [ ] **Step 1: Provide a PUT sink the browser can point the server at**

The e2e server runs on the same machine as the test. Start a tiny sink inside the spec with Node's `http` module (Playwright specs run in Node):
```ts
import { createServer, type Server } from 'node:http'

async function startSink(): Promise<{ url: string; received: () => number; close: () => Promise<void> }> {
    let bytes = 0
    const server: Server = createServer((req, res) => {
        req.on('data', chunk => {
            bytes += chunk.length
        })
        req.on('end', () => {
            res.statusCode = 200
            res.end()
        })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    return {
        url: `http://127.0.0.1:${port}/backup.age`,
        received: () => bytes,
        close: () => new Promise(resolve => server.close(() => resolve())),
    }
}
```

- [ ] **Step 2: Write the spec**

```ts
import { expect, test } from '@playwright/test'
import { clickSidebarItem, login, navigateToPackage } from './helpers'

// Drives a manual backup from Settings → Backups to a local PUT sink, then
// checks the ledger row through the UI. Restore is not exercised here: it
// restarts the server, which the shared e2e server cannot survive mid-suite.

test.describe('Settings · Backups', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'settings')
        await clickSidebarItem(page, 'Backups')
        await page.getByTestId('settings-section-backups').waitFor({ state: 'visible', timeout: 20_000 })
    })

    test('backs up to a PUT URL and records it', async ({ page }) => {
        const sink = await startSink()
        try {
            await page.getByLabel('Upload URL').fill(sink.url)
            await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple')
            await page.getByLabel('Confirm passphrase').fill('correct horse battery staple')
            await page.getByTestId('backup-start').click()

            const row = page.locator('[data-testid^="backup-row-"]').first()
            await expect(row).toContainText('Manual backup', { timeout: 20_000 })
            await expect(row).toContainText('Succeeded', { timeout: 60_000 })
            expect(sink.received()).toBeGreaterThan(0)
            await expect(page.getByTestId('backups-last')).toContainText('Last backed up')
        } finally {
            await sink.close()
        }
    })

    test('rejects a short passphrase', async ({ page }) => {
        await page.getByLabel('Upload URL').fill('https://example.com/x')
        await page.getByLabel('Passphrase', { exact: true }).fill('short')
        await page.getByLabel('Confirm passphrase').fill('short')
        await expect(page.getByText('At least 12 characters')).toBeVisible()
    })
})
```
`TextInput`'s `label` must render as an accessible label for `getByLabel` to work — check `core/ui/form/TextInput.tsx`; if it does not, add `accessibilityLabel={label}` there (or use `testID`s `backup-target`, `backup-passphrase`, `backup-confirm` on the inputs and `getByTestId` in the spec). The status badge text must be exactly "Succeeded".

- [ ] **Step 3: Run it**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run e2e:serve` (in one terminal), then `pnpm run test:e2e -- -g "Backups" --workers=1`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/settings-backups.spec.ts
git commit -m "test(e2e): settings backups panel"
```

---

### Task 15: Final verification

- [ ] **Step 1: Full Go suite**

Run: `cd /Users/nas/code/tinycld/tinycld/core/server && go vet ./... && go test ./...`
Expected: PASS.

- [ ] **Step 2: Full TS checks**

Run: `cd /Users/nas/code/tinycld/tinycld && pnpm run checks && pnpm run pkg:check`
Expected: PASS, including `check:core-isolation`.

- [ ] **Step 3: Manual smoke on the dev server**

`cd /Users/nas/code/tinycld/tinycld && pnpm run dev`; sign in as the owner; Settings → Backups; run a backup to a local sink (`python3 -m http.server` does not accept PUT — use the Node sink from the spec, or `nc -l 9999 > /dev/null`); confirm the History row and the notification bell. Then `curl -s -X POST -H "Authorization: <token>" -H 'Content-Type: application/json' -d '{"stream":true,"passphrase":"correct horse battery"}' http://localhost:8090/api/org-backups > /tmp/b.age` and `age -d -o /tmp/b.tar.zst /tmp/b.age` if `age` is installed locally.

- [ ] **Step 4: Open the PR**

Branch `backups-core` in the `tinycld` repo. Title: "Org backups: engine, ledger, settings panel". Body: three lines — what it adds, the new dependency, and that the CLI and hosting parts follow in their own PRs.
