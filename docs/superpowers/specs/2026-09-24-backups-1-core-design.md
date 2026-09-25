# Backups 1 of 3 — core engine, ledger, settings panel

Companion specs: `2026-09-24-backups-2-cli-design.md` (CLI),
`hosting/docs/superpowers/specs/2026-09-24-backups-3-hosting-dr-design.md` (DR).
Build order: this spec, then CLI, then hosting DR. All three ship for the
tinycld.com launch.

## Problem

An org has no way to take its data out of an instance, and an instance has no
way to be rebuilt from that data somewhere else. Both are needed at launch:
tenants must be able to back up and restore on their own, and the operator
must be able to recover a tenant after a host loss.

## Goals

- An owner or admin can back up the whole org (database, files, package set)
  from the settings panel or the CLI.
- An owner can restore a backup into a hosted instance or a Docker self-host.
- The single binary can create backups, and can restore only when the package
  set matches (or with an explicit data-only override).
- Every run is recorded in a ledger and shown as "last backed up X ago".
- Nothing in core names hosting. An embedder plugs in through generic seams.

## Non-goals

- Partial backups (no "without files" option). A backup is always complete.
- Merge/import. Restore replaces the org's data.
- Resumable uploads. A presigned PUT is single-shot.
- Storing backups on the instance. The only on-disk artifact is the
  pre-restore safety copy, and it is deleted when the restore succeeds.

## Decisions already made

| Question | Decision |
|---|---|
| "Builds" in the archive | The lockfile only (slug → spec + core version). Restore rebuilds. |
| Where a manual backup goes | A presigned PUT URL the user supplies, or the CLI streams it to a file. No browser download. |
| Who may run it | Backup: owner or admin. Restore: owner. |
| Restore semantics | Full replace after an automatic pre-restore backup. |
| Encryption | `age`. Manual: passphrase (scrypt). Non-user callers: an X25519 recipient they supply. |
| Compression | zstd, level 3, before encryption. |
| Notifications | `notify.Administrators` on success and failure. |

## Archive format `tinycld-backup-v1`

A `tar` stream → zstd → age. Streamed end to end. Members in this order:

```
manifest.json    {
                   "format": "tinycld-backup-v1",
                   "created": RFC3339, "instance": <instance id>,
                   "source": "hosted" | "docker" | "standalone",
                   "kind": "manual" | "scheduled" | "pre_restore",
                   "core": "<version>",
                   "lockfile": { "tinycld": "<spec>", "<slug>": "<spec>", … },
                   "packages": { "<slug>": "<version>", … },
                   "counts": { "collections": { "<name>": <rows> }, "files": n, "bytes": n }
                 }
data.db          `VACUUM INTO` snapshot of pb_data/data.db. auxiliary.db (PB's log DB) is excluded.
storage/…        every file reachable through app.NewFilesystem() — local or S3-backed.
checksums.txt    sha256 per member, written last.
```

`manifest.json` is first so a reader can stop after a few KB. `checksums.txt`
is last so a reader can verify a whole stream without seeking.

Not included: `releases/`, `builds/`, `_logs`, fleet-managed settings that
live outside tenant data (`mail.*`, `vapid.*`, `sentry.*` on a hosted org).
A hosted backup restored into a self-host lacks those and the owner re-enters
them. Documented in the help topic.

## Package `core/server/backup`

Split in two halves so the CLI can import the reader without PocketBase:

- `backup/format` — tar/zstd/age writer and reader, manifest type, checksum
  verification, `Inspect(r io.Reader, identity) (Manifest, error)`.
- `backup` — the engine (PocketBase-aware): run, restore, boot swap, ledger.

### Create

```go
type Kind string // manual | scheduled | pre_restore

type Request struct {
    Kind      Kind
    Recipient age.Recipient   // scrypt (passphrase) or X25519
    Sink      io.WriteCloser  // HTTP response, or NewPutSink(url)
    Initiator string          // users id, or "" for a non-user caller
    Callback  string          // optional URL; the finished ledger row is POSTed to it
}

func Run(app core.App, req Request) (id string, err error)
func NewPutSink(url string) io.WriteCloser
```

Pipeline, one goroutine per run:

1. Insert the `backups` row with `status: running` **before** any work.
2. Claim `installjob` with `Action: "backup"`. Busy ⇒ 409 with the running job.
3. `VACUUM INTO <state>/backup-tmp/<id>.db`. Removed in a `defer`.
4. tar writer: manifest → data.db → `NewFilesystem().List("")` walk → checksums.
   Files are copied after the DB snapshot; a file uploaded in that window may
   be missing its row. Accepted and documented.
5. zstd → age → sink. Backpressure from a slow sink slows the walk.
6. Update `bytes` on the row at most every 2 s (progress display).
7. Finish: `succeeded` (+ `sha256`, `manifest`, `finished`) or `failed`
   (+ `error`). POST the row to `Callback` if set. `notify.Administrators`.
   Audit row.

On boot, `backup-tmp/` is wiped and rows still `running` from before the
process start are set to `interrupted`.

### Rate limit

Manual runs (user-initiated) are capped per day. The ceiling comes from
core's existing ceilings mechanism (`server.go`, the values an embedder sets
and standalone leaves unset); default 10. Over the cap ⇒ 429 with the reset
time. Non-user callers are exempt.

### Restore

```go
type RestoreRequest struct {
    Source    Source          // NewRangeSource(url) or an io.Reader (CLI upload)
    Identity  age.Identity    // scrypt (passphrase) or X25519
    Force     bool            // single binary only: skip the manifest check
    Initiator string
}
func Restore(app core.App, req RestoreRequest) (jobID string, err error)

// A rebuilder makes the running package set equal to the lockfile and ends by
// restarting the process. Core's self-rebuild path registers one when
// supportsSelfRebuild(). An embedder registers its own. None ⇒ single binary.
// The restore hands its claimed installjob to the rebuilder so no other job
// can slip in between staging and the rebuild; the rebuilder owns the job
// from then on and ends by restarting the process.
func RegisterRebuilder(fn func(ctx context.Context, job *installjob.Job, lockfile Lockfile) error)
```

Phases, one `installjob.Job{Action: "restore"}`, progress through the existing
job-status endpoint, ledger row `kind: restore`:

1. **Read the manifest.** Open the source, decrypt, read `manifest.json`, stop.
2. **Manifest check.**
   - Rebuilder registered ⇒ proceed.
   - None ⇒ compare `manifest.packages` to the embedded set. Equal ⇒ proceed.
     Different ⇒ refuse with the diff (missing packages, version deltas)
     unless `Force`. With `Force`: data-only restore — DB and files only; the
     binary applies pending migrations on boot; migrations belonging to a
     package the binary lacks stay recorded and unused.
   - A refusal here has written nothing to disk.
3. **Pre-restore backup.** `Run(kind: pre_restore)` to
   `<state>/restore/pre/<id>.age`, recipient = a fresh X25519 key. The
   identity is stored in the restore row's `metadata` and shown to the owner
   in the panel until the restore succeeds or the owner dismisses it.
4. **Arm.** Write `<state>/restore/armed` = `{ id, pending, pre }`.
5. **Fetch and verify.** Continue the same stream into
   `<state>/restore/pending/<id>/`: `data.db`, `storage/`, then verify
   `checksums.txt` and `PRAGMA integrity_check`. Failure ⇒ delete `pending/`,
   disarm, `failed`; the pre-restore backup is kept.
6. **Rebuild.** Call the rebuilder with the lockfile. It restarts the process.
   Single binary: restart in place.
7. **Boot swap.** Before `app.Bootstrap()`: if `restore/armed` exists, rename
   `pb_data` → `restore/previous/<id>/`, move `pending/<id>/{data.db,storage}`
   → `pb_data`, delete the marker, boot. After boot: insert the `restore` row
   as `succeeded` into the restored DB, delete `previous/` and `pre/`, notify,
   audit. A crash between the renames is detected on the next boot (marker
   present + `previous/` present ⇒ swap back, `failed`). A boot failure after
   the swap is handled by the embedder's existing revert path (hosting:
   repoint the previous build + respawn; the entrypoint: rollback).

From phase 3 until boot the instance answers 503 with a "Restoring…" page.

The restored ledger is the source's ledger plus one `restore` row. The panel
labels older rows "from the restored backup".

### Resumable source

`NewRangeSource(url)`: on a dropped connection, re-GET with
`Range: bytes=<consumed>-` and `If-Range: <ETag>`; bounded retries with
backoff. A 200 where 206 is expected ⇒ "source does not support resume",
job fails. A 403 (expired presigned URL) ⇒ job status `waiting_for_source`
for up to 15 minutes; `PATCH /api/org-backups/restore/{jobId} { source }` swaps
the URL and the reader resumes at the same offset with the same `If-Range`.
Timeout ⇒ `failed`, `pending/` deleted, pre-restore backup kept.

Redirects are never followed on PUT or GET (following one would leak the
signature).

## HTTP API (bound by core)

The prefix is `/api/org-backups` because PocketBase's own superuser backup API already owns `/api/backups`.

```
POST  /api/org-backups                    owner|admin; OAuth scope `backups`
      { target: "<PUT url>", passphrase }        → 202 { id }
      { stream: true, passphrase }               → 200 chunked archive
POST  /api/org-backups/restore            owner
      { source: "<GET url>", passphrase, force? } → 202 { jobId }
      multipart body `archive` + fields           → 202 { jobId }   (CLI --from file)
PATCH /api/org-backups/restore/{jobId}    owner   { source }            → 204
GET   /api/org-backups/verify             owner|admin  → row/file counts vs manifest, integrity_check
      (also exposed as backup.Verify(app) for an embedder)
```

Passphrase minimum 12 characters, enforced in the form and the API. Never
persisted, logged, audited, or sent to Sentry. URLs are stored as hostname
only.

## Ledger: collection `backups`

New core migration. Fields: `kind` (manual|scheduled|pre_restore|restore),
`status` (running|waiting_for_source|succeeded|failed|interrupted),
`initiated_by` → users (empty for non-user callers), `started`, `finished`,
`bytes`, `sha256`, `manifest` (json), `target_host`, `error`, `metadata`
(json). List/view rule: owner or admin. No client create/update/delete;
server-only writes. Rows are kept indefinitely (they are small).

## Mutex with package jobs

Backup and restore are `installjob` actions, so the existing single-job claim
already refuses an install during a backup and a backup during an install.

## Settings panel

`app/a/(app)/settings/backups.tsx` (admin-gated; restore section owner-only),
body in `core/components/settings/backups/`, `<SettingsRow>` in the
Organization group.

- Header: "Last backed up 3 hours ago" from the newest `succeeded` row of any
  kind, or "Never backed up". Amber warning when older than 7 days or never.
- **Back up now**: `useForm` + zod — PUT URL, passphrase, confirm. Submit →
  `POST /api/org-backups`. Progress from the running row's `bytes` via
  `useLiveQuery`.
- **Restore** (owner): GET URL, passphrase, an "I understand current data is
  replaced" checkbox. `force` is CLI-only; a mismatch shows the diff and points
  to the CLI.
- **History**: kind, when, who, size, status, error. A `waiting_for_source`
  row shows the fresh-URL form inline. A `restore` row that still holds a
  pre-restore identity shows it with a dismiss action.
- **CLI** card with a copyable `tinycld backup create --out ./backup.age`.

Native works as-is: text inputs only, no file pickers.

## Notifications and audit

`notify.Administrators` with `core.backup.succeeded` / `core.backup.failed` /
`core.restore.succeeded` / `core.restore.failed`, URL `/settings/backups`.
Depends on commit `353bdd0c` ("feat(notify): notify every administrator")
landing in core first.

Audit rows: `backup.created`, `backup.failed`, `restore.started`,
`restore.succeeded`, `restore.failed`; actor = initiator, or `system`.

## Help

`tinycld/core/help/backups.md`: what a backup contains, the PUT/GET URL model
with presign examples for S3, R2 and B2, passphrase loss means data loss,
what restore replaces, single-binary limits, the CLI commands.
`tinycld/docs/single-binary.md` "Backups" section points to it.

## New dependency

`filippo.io/age` in `core/server/go.mod` (and the CLI module).
`github.com/klauspost/compress/zstd` (new).

## Error handling

- Ledger row before work; terminal status always; `interrupted` on boot.
- No leftover temp files: `defer` removal, `backup-tmp/` wiped on boot.
- Live `pb_data` is untouched until the boot swap.
- Boot swap is ordered renames; every partial state is recognisable on the
  next boot.
- Secrets never leave memory except the pre-restore identity, which lives in
  the ledger row until the restore succeeds.
- Presigned URLs never reach an error message or a log line. `format`
  redacts `*url.Error` at every failure point, so an error that escapes the
  package carries the scheme and host and nothing else.

### Accepted residual risk: a caller-supplied URL

The server PUTs to, and GETs from, a URL the caller supplies — that IS the
feature, since an operator's own bucket is the only place a backup can go. It
also makes the server a fetcher for whoever can reach the endpoint, so the
residual risk is stated rather than claimed away. The endpoint is admin-only
(backup) or owner-only (restore); no response body is ever surfaced to the
caller (a backup discards the target's response, and a restore's body must
decrypt with the caller's own passphrase or the restore fails); and the ledger
records hostnames only. The API refuses the address classes that are reachable
only from the server and are never a legitimate target — loopback, link-local
(169.254.0.0/16 and fe80::/10, where instance-metadata services live), the
unspecified address and multicast — resolving the hostname rather than
pattern-matching it, and refusing a name any of whose addresses is in those
classes. RFC1918 private ranges stay allowed: a MinIO box on the operator's own
LAN is a normal target. `TINYCLD_BACKUP_ALLOW_LOOPBACK=1`, read once at
registration, relaxes the check for local development and the e2e harness. This
reduces the surface rather than closing it: a name can resolve differently
between the check and the transfer, and the remaining exposure is a blind
request from the server's network position made by someone who already
administers the deployment.

## Testing

`core/server/backup` against `tests.TestApp` with local files:
round-trip create → inspect → restore-stage; tampered checksum; truncated
stream; manifest-only read stops early (count bytes read); Range resume
against an `httptest` server that drops at byte N; a server that answers 200;
403 then URL swap; mutex with `installjob`; rate-limit ceiling; row-first and
`interrupted`; boot-swap crash between renames; manifest check table
(equal / missing package / version delta / force). Notification fan-out and
audit rows. Panel: vitest for the form and the "last backed up" derivation;
one Playwright spec that backs up to a harness-provided PUT sink and reads
the ledger row (read-only assertion).
