# Backups 2 of 3 — CLI commands

Depends on `2026-09-24-backups-1-core-design.md` (the `backups` OAuth scope,
the HTTP API, and the `core/server/backup/format` reader).

## Goal

`tinycld backup …` streams a backup to a file, inspects one locally, restores
one from a file or URL, and lists the ledger. A self-hoster with only the
single binary and the CLI can back up without any object storage.

## Commands (`tinycld/cli/backup.go`)

```
tinycld backup create  --out <file|->        [--passphrase-file <f>]
tinycld backup create  --to <PUT-url>        [--passphrase-file <f>]
tinycld backup inspect <file|url>            [--passphrase-file <f>]
tinycld backup restore --from <file|GET-url> [--passphrase-file <f>] [--force] [--yes]
tinycld backup list                          [--output table|json|csv]
```

- `create --out` streams `POST /api/backups { stream: true }` to disk;
  `-` writes to stdout for piping (`| aws s3 cp - s3://…`). Progress on
  stderr from bytes received.
- `create --to` asks the server to push; the CLI polls the ledger row and
  prints `bytes` progress until a terminal status.
- `inspect` on a file decrypts and reads `manifest.json`, then verifies every
  checksum, entirely client-side through `format.Inspect`. On a URL it uses
  `format.NewRangeSource`. Prints format version, created, source, core and
  package versions, counts, total bytes, and OK/FAIL per member.
- `restore --from <file>` uploads the file as the multipart body of
  `POST /api/backups/restore`; `--from <url>` sends the URL. Before sending,
  the CLI runs `inspect` on a file source and prints the manifest summary; it
  then requires `--yes` or an interactive confirmation. After 202 it polls the
  job status and prints each phase. A `waiting_for_source` status prompts for
  a fresh URL (interactive) or fails (with `--yes`), and `PATCH`es it.
- `list` renders the `backups` collection with the existing `output/`
  helpers.

## Passphrase

Sources in order: `--passphrase-file`, `$TINYCLD_BACKUP_PASSPHRASE`, an
interactive prompt (twice for `create`). There is no `--passphrase` flag:
it would show in `ps`. Minimum 12 characters, checked before the request.

## Authorization

The CLI already requests every scope the server advertises, so adding
`backups` to core's discovery document is enough. A 403 on restore (not an
owner) is relayed as-is.

## Exit codes

0 on `succeeded`; 1 on `failed`, `interrupted`, or a refused manifest check
(the diff is printed); 2 on usage errors. `--quiet` suppresses progress.

## Module wiring

`tinycld/cli/go.mod` gains `tinycld.org/core/backup/format` through the
existing `go.work` replace, and `filippo.io/age`. The format package has no
PocketBase import, so the CLI binary stays small.

## Testing

`deps`-injected `httptest` server: `create --out` streams a fixture archive
and the file matches; `create --to` polls a row that flips to `succeeded`;
`inspect` on a fixture (good, tampered, truncated); `restore --from file`
with `--yes` sends multipart and follows the phases; `waiting_for_source`
with a scripted URL; passphrase precedence; exit codes.
