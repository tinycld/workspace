# Backup repositories 1 of 2 — core: repository abstraction, PBS, schedule

Builds on `2026-09-24-backups-1-core-design.md` and
`2026-09-24-backups-2-cli-design.md`. Companion:
`hosting/docs/superpowers/specs/2026-09-29-backup-repositories-2-hosting-design.md`.
Build order: this spec, then hosting.

## Problem

Every backup is a full `tinycld-backup-v1` archive. A daily backup of a large
org uploads the whole org every day. Operators who run Proxmox Backup Server
(PBS) want deduplicated, differential backups, and self-hosters may want other
deduplicating stores later.

## Goals

- One `Repository` interface. The current archive becomes one implementation;
  PBS is the second. Another store (for example Kopia) can be added later
  without engine changes.
- Differential backups through PBS deduplication: each run is a full snapshot,
  and PBS stores only the chunks that changed.
- A self-hosted org can configure one repository and back up to it on a cron
  schedule.
- Snapshot and repository code has no PocketBase import, so an embedder can
  back up a `pb_data` directory from another process.
- Files that the DB snapshot refers to cannot be deleted during a backup,
  whether the backup runs in-process or from another process.

## Non-goals

- Differential archives for the `archive` repository. It stays full-copy.
- Kopia or any other backend. The interface is ready; none ships.
- More than one scheduled repository per org.
- Retention or pruning. The repository owns retention (PBS prune jobs).
  tinycld never deletes a snapshot.

## Decisions

| Question | Decision |
|---|---|
| PBS client | `github.com/osshield/gopbs` (pure Go, AGPL-3.0, compatible with our AGPL-3.0-only). No cgo, no subprocess. |
| Scheduled repositories per org | One, stored in `system_config`. |
| Scheduler | `app.Cron()`. |
| PBS encryption key | Admin pastes a key file, or presses Generate. Stored `is_secret`. |
| Retention | The repository's own. |
| Snapshot race | A delete hold (below), not exported PocketBase hooks. |

## Packages

| Package | PocketBase | Purpose |
|---|---|---|
| `backup/snapshot` (new) | No | `FromDataDir(pbData, holder) (Snapshot, error)`: set the delete hold, `VACUUM INTO` through its own SQLite connection, build the manifest from `pkg_registry` and row counts, list `storage/`. |
| `backup/repo` (new) | No | `Repository` interface, `Ref`, `Register(kind, open)`, `Open(kind, cfg)`. |
| `backup/format` | No | Unchanged wire format. Adds the `archive` repository. |
| `backup/pbs` (new) | No | The `pbs` repository. |
| `backup/arm` (new) | No | `PendingDir(dataDir, id)` and `Arm(dataDir, id, manifest, pre)`. `Arm` runs `PRAGMA integrity_check` and the row-count check on the staged DB, writes the `.staged` sentinel, then writes `restore/armed` (sibling of `pb_data`). The marker format becomes a public API that core's boot swap reads; `restore.go` uses it too. |
| `backup/hold` (new) | No | The delete-hold file and journal. |
| `backup` | Yes | Engine uses `snapshot` + `repo`; binds the hold to the delete hook; cron; config; API. |

```go
type Snapshot struct {
    Manifest format.Manifest
    DBPath   string       // the VACUUM INTO file; caller removes it
    Files    []StoredFile // Key, Size, Open() (io.ReadCloser, error)
    Release  func() error // removes the delete hold
}

type Ref string // repository-specific; "host/<id>/<RFC3339>" for pbs

type PutResult struct {
    Ref           Ref
    Bytes         int64 // logical size
    UploadedBytes int64 // bytes actually sent (new chunks for pbs)
    Sha256        string // archive only; "" for pbs
}

type Repository interface {
    Put(ctx context.Context, s Snapshot, progress func(sent int64)) (PutResult, error)
    Manifest(ctx context.Context, ref Ref) (format.Manifest, error)
    Fetch(ctx context.Context, ref Ref, dir string) error // writes dir/data.db and dir/storage/
    List(ctx context.Context) ([]SnapshotInfo, error)
}

func Register(kind string, open func(cfg json.RawMessage) (Repository, error))
```

`archive` is a special case of the interface: its "ref" is a PUT/GET URL or a
stream, `List` returns `ErrNotSupported`, and `Put` wraps the current
tar/zstd/age writer. Its manual-backup and URL-restore behavior does not change.

The in-process engine uses `snapshot` with the live app's `pb_data`, so both
modes share one code path. Files stored on S3 through `app.NewFilesystem()`
are listed and opened through the filesystem, not the directory; `StoredFile`
hides the difference. `FromDataDir` from another process supports local
`storage/` only, and refuses a `pb_data` whose settings enable S3 storage.

## Delete hold

Stops a file that the DB snapshot refers to from being deleted before the walk
reads it, from the same process or from another process on the same host.

- `pb_data/backup-hold` = `{ holder, expires }`. Expiry is 1 hour; the holder
  renews it every 20 minutes and removes it when the walk ends.
- Core binds the PocketBase storage delete hook once at startup. While a valid
  (unexpired) hold exists, a delete appends its key to
  `pb_data/backup-hold.journal` and does not delete. An expired hold counts as
  no hold.
- Drain: a core cron job every minute, and boot, run the journal when no valid
  hold exists. A delete of a missing key succeeds, so a drain is idempotent and
  a crash mid-drain is safe.
- A hold request while another holder's valid hold exists is refused. This
  also stops two backups of one org from two processes.
- An expired hold that its holder never released is logged as a warning.
- Worst case after a holder crash: deletes wait up to about 1 hour.
- Files created after the snapshot are included. An orphan file does no harm.
- With the hold in place, a file that is missing during the walk is an error.

## The `pbs` repository

Config (JSON): `server` (host:port), `fingerprint` (TLS SHA-256 pin),
`datastore`, `namespace` (optional), `auth_id` (API token, e.g.
`tinycld@pbs!backup`), `secret`, `key` (optional PBS key-file JSON). `secret`
and `key` are secret.

Snapshot: backup type `host`, backup ID = the instance hostname (the embedder
passes its own ID). Files:

| File | Content |
|---|---|
| `manifest.blob` | `format.Manifest` JSON. `Manifest()` reads only this. |
| `data.db.didx` | The raw `VACUUM INTO` file, content-defined chunks. |
| `storage.pxar.didx` | A pxar archive of the stored files. Browsable and single-file restorable in the PBS UI. |

No age and no zstd: PBS compresses each chunk and, when a key is set, encrypts
each chunk. Each upload names the previous snapshot as its base so known chunks
are skipped.

- `Put`: upload the three files, then `finish`. A run that fails before
  `finish` leaves no snapshot on PBS.
- `Fetch`: restore `data.db`, extract `storage/`. PBS verifies chunk digests;
  the engine still runs `PRAGMA integrity_check` and compares row counts with
  the manifest.
- `List`: snapshots of this backup ID, newest first.

## Configuration and schedule

`system_config` keys:

| Key | Secret | Meaning |
|---|---|---|
| `backup.repository.kind` | no | `pbs` (only kind now) |
| `backup.repository.config` | yes | kind-specific JSON |
| `backup.repository.schedule` | no | cron expression, default `0 3 * * *` |
| `backup.repository.enabled` | no | `true` / `false` |

At boot and on a change to any of these keys, core adds or removes the
`backup-repository` cron job. A scheduled run is `kind: scheduled`: exempt
from the manual rate limit, and it uses the existing notifications and the
7-day staleness warning.

An embedder that claims the `backup.repository.` prefix through `syscfg`
turns this off for its deployment. The panel then shows the card as managed.

## Ledger

`backups` gains `repository` (`archive` | `pbs`), `ref` (text), and
`uploaded_bytes` (number). `bytes` stays the logical size. Unreleased
migration rules apply as usual.

## HTTP API additions

```
POST /api/org-backups                    { repository: true }   owner|admin → 202 { id }
GET  /api/org-backups/snapshots          owner|admin → [{ ref, created, bytes, core, packages }]
POST /api/org-backups/restore            { snapshot: "<ref>" }  owner → 202 { jobId }
POST /api/org-backups/repository/test    { kind, config }       owner|admin → 200 | 4xx { reason }
```

Config is written through the existing `system_config` admin path. `test`
calls `List` and writes nothing. Restore from a snapshot runs the existing
phases: `Manifest` → manifest check → pre-restore backup (local `archive`) →
`Fetch` into `arm.PendingDir` → `arm.Arm` → rebuild → boot swap.

## Settings panel

In `core/components/settings/backups/`:

- **Repository** card: PBS form (`useForm` + zod), Generate key button,
  Test connection, schedule, enabled. A future kind adds its own form
  component. Managed state when the prefix is claimed.
- **Back up now**: "To repository" or "To a URL".
- **Restore**: "From repository" (snapshot list) or "From URL".
- **History**: repository column; `uploaded_bytes` next to `bytes`.

## CLI

```
tinycld backup create    --repository
tinycld backup snapshots [--output table|json|csv]
tinycld backup restore   --snapshot <ref> [--force] [--yes]
```

`create --repository` polls the ledger row as `create --to` does now.

## Help

Update `tinycld/core/help/backups.md`: repositories vs. URL backups, PBS
setup (API token, datastore permissions `DatastoreBackup` + `DatastoreReader`,
fingerprint), the key file (keep a copy off-host; losing it loses the
backups), retention is set on PBS, and restoring outside tinycld with
`proxmox-backup-client`.

## New dependency

`github.com/osshield/gopbs` in `core/server/go.mod`.

## Error handling

- Ledger row before work, terminal status always, `backup-tmp/` wiped on boot
  — unchanged.
- The PBS `secret` and `key` never reach a log, an error, the audit log, or
  Sentry. Adapter errors go through the same redaction as `format`.
- Fingerprint mismatch, bad token, and missing datastore give a clear reason.
  `test` surfaces them before the first run.
- An unfinished PBS upload leaves no snapshot; the row is `failed`.

## Testing

- Repository contract suite (put, manifest, fetch, list, interrupted put),
  run against `archive` (`httptest` destination) and `pbs`.
- `pbs` in CI runs against an in-process fake PBS: gopbs's server-side
  protocol types if it has them, otherwise a minimal fake of the backup and
  reader protocols. A real-PBS test runs when `TINYCLD_TEST_PBS` is set.
- Delete hold: journal while held, expiry, drain by cron and at boot,
  second-holder refusal, idempotent drain, a snapshot taken from a second
  process while the app deletes files.
- Config → cron add/remove; a claimed prefix disables it.
- Panel: vitest for the forms. One Playwright spec for repository-form
  validation and the "To a URL" path (no PBS in CI).
