# Backups 2 — CLI Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tinycld backup create|inspect|restore|list` — stream a backup to a file, inspect an archive locally, restore from a file or URL, list the ledger — against the `/api/org-backups` API shipped by Plan 1.

**Architecture:** The archive reader (`core/server/backup/format`) becomes its own Go module so the CLI imports it without the PocketBase fork. The CLI gains a streaming POST helper, a fields-then-file multipart helper, a passphrase prompt, and a `backup` command group that polls the ledger row for outcomes. A migration adds the `backups` scope to the seeded `tinycld-cli` OAuth client.

**Tech Stack:** Go 1.26 (`tinycld.org/cli`, cobra), `filippo.io/age`, `github.com/klauspost/compress/zstd`, `golang.org/x/term`; PocketBase JS migration.

Spec: `docs/superpowers/specs/2026-09-24-backups-2-cli-design.md`. Server contract: `tinycld/core/server/coreserver/backup_api.go` (branch/PR `backups-core`, #288).

## Global Constraints

- All work in `/Users/nas/code/tinycld/tinycld`, branch `backups-cli` created from `backups-core` (this plan depends on PR #288's code; open the PR against `backups-core` if #288 has not merged, else against `main`).
- The CLI module must not import the PocketBase fork or `tinycld.org/core` proper — only `tinycld.org/core/backup/format`.
- Passphrase: sources in order `--passphrase-file`, `$TINYCLD_BACKUP_PASSPHRASE`, interactive prompt (twice for `create`); no `--passphrase` flag; minimum 12 characters checked before any request; never printed or logged.
- Exit codes: 0 `succeeded`; 1 `failed`/`interrupted`/refused manifest; 2 usage errors. `--quiet` suppresses progress only.
- Results go to stdout via `output.Options.Write`; chatter/progress to stderr via `Info`/`ui.Progress`.
- Server routes: `POST /api/org-backups` (`{target,passphrase}` → 202 `{id}`; `{stream:true,passphrase}` → 200 octet-stream), `POST /api/org-backups/restore` (JSON `{source,passphrase,force}` → 202 `{jobId}`; multipart parts in order `passphrase`, `force`, `archive` → 202 `{jobId}`; 409 `{message,diff,jobId}` on mismatch; 409 busy; 422 other), `PATCH /api/org-backups/restore/{id}` `{source}` → 204/404, `GET /api/org-backups/{id}` → ledger row, `GET /api/org-backups/verify`.
- Ledger row fields: `id, kind, status (running|waiting_for_source|succeeded|failed|interrupted), started, finished, bytes, sha256, manifest, target_host, error, metadata`.
- Generated files (`cli/go.work`, `server/go.work`, `cli/cli_extensions.go`, `cli/search_slugs.go`) are gitignored — never commit them; change their generators in `scripts/`.
- Released migrations are frozen; new one is `2050000002`.
- No mention of Claude in commits; commit per task.

## File Structure

```
core/server/backup/format/go.mod        NEW nested module tinycld.org/core/backup/format
core/server/go.mod                       require + replace ./backup/format
server/go.mod                            replace ../core/server/backup/format
scripts/gen-server.ts                    buildGoWork/buildMemberGoWork: format module use/replace
scripts/gen-cli.ts                       buildCliGoWork/buildMemberCliGoWork: format module use/replace
cli/go.mod                               require format v0.0.0 + relative replace; age dep
core/server/pb_migrations/2050000002_cli_client_backups_scope.js
cli/client/stream.go                     PostStream (JSON body → streamed response)
cli/client/multipart.go                  PostMultipartFields (ordered fields, then files)
cli/ui/passphrase.go                     Passphrase / PassphraseTwice
cli/exit.go                              ExitError{Code}; main.go honours it
cli/backup.go                            newBackupCmd group + shared helpers (client, poll)
cli/backup_create.go                     create --out | --to
cli/backup_inspect.go                    inspect <file|url>
cli/backup_restore.go                    restore --from <file|url> [--force] [--yes]
cli/backup_list.go                       list
cli/backup_test.go                       fake server + command tests
core/help/backups.md, core/help/command-line.md   docs
```

---

### Task 1: `format` becomes its own module

**Files:**
- Create: `core/server/backup/format/go.mod`
- Modify: `core/server/go.mod`, `server/go.mod`, `scripts/gen-server.ts:53-90` (`buildGoWork`, `buildMemberGoWork`), `scripts/gen-cli.ts:86-118` (`buildCliGoWork`, `buildMemberCliGoWork`), `cli/go.mod`
- Test: existing Go suites + generator unit tests if `scripts/*.test.ts` cover these builders (check `scripts/__tests__` or `*.test.ts` next to them)

**Interfaces:**
- Produces: importable module `tinycld.org/core/backup/format` from `cli/` (`format.Inspect`, `format.Manifest`, `format.Report`, `format.NewRangeSource`, `format.RedactURLError`).

- [ ] **Step 1: Create the branch**

```bash
cd /Users/nas/code/tinycld/tinycld && git checkout backups-core && git pull && git checkout -b backups-cli
```

- [ ] **Step 2: Nested module**

`core/server/backup/format/go.mod`:
```
module tinycld.org/core/backup/format

go 1.26.3

require (
	filippo.io/age v1.3.2
	github.com/klauspost/compress v1.20.0
)
```
Then `cd core/server/backup/format && go mod tidy` (creates `go.sum`; the module's tests must pass standalone: `go test ./...`).

- [ ] **Step 3: Core requires it**

`core/server/go.mod`: add `tinycld.org/core/backup/format v0.0.0` to the `require` block and, next to the existing pocketbase replace:
```
replace tinycld.org/core/backup/format => ./backup/format
```
Run `cd core/server && go mod tidy && go build ./... && go test ./backup/... -count=1`. `age`/`compress` stay in core's `go.mod` only if something outside `format` imports them (`engine.go` imports `age` and `zstd` — yes, they stay).

- [ ] **Step 4: App server and workspaces**

`server/go.mod`: add `replace tinycld.org/core/backup/format => ../core/server/backup/format` beside the core replace.
`scripts/gen-server.ts`:
- `buildGoWork(coreRelPath, pkgs)`: add `    ${coreRelPath}/backup/format` after the core `use` line.
- `buildMemberGoWork(coreRelPath, forkRelPath)`: add a versioned replace line `replace tinycld.org/core/backup/format v0.0.0 => ${coreRelPath}/backup/format` (same mechanism the comment documents for core) so a member server builds standalone.
`scripts/gen-cli.ts`:
- `buildCliGoWork(pkgs)`: add `    ../core/server/backup/format` to the `use` list.
- `buildMemberCliGoWork(cliRelPath)`: add `replace tinycld.org/core/backup/format v0.0.0 => ${cliRelPath}/../core/server/backup/format`.
`cli/go.mod`: add `require tinycld.org/core/backup/format v0.0.0` and `replace tinycld.org/core/backup/format => ../core/server/backup/format`; `cd cli && go mod tidy`.

- [ ] **Step 5: Regenerate and build everything**

```bash
cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate
cd server && go build ./... && cd ../cli && go build ./... && go test ./... -count=1
cd ../../drive/server && go build ./... && cd ../cli && go build ./...     # member standalone builds
cd /Users/nas/code/tinycld/tinycld/core/server && go test ./backup/... ./coreserver/ -run 'Backup|Restore' -count=1
```
Expected: all green. If a member standalone build fails to resolve the format module, the generator replace line is wrong — fix the generator, not the member.

- [ ] **Step 6: Commit**

```bash
git add core/server/backup/format/go.mod core/server/backup/format/go.sum core/server/go.mod core/server/go.sum server/go.mod scripts/gen-server.ts scripts/gen-cli.ts cli/go.mod cli/go.sum
git commit -m "build: backup format is its own module so the CLI can read archives"
```

---

### Task 2: `backups` scope on the seeded CLI client

**Files:**
- Create: `core/server/pb_migrations/2050000002_cli_client_backups_scope.js`

- [ ] **Step 1: Write the migration** (same shape as `2000000002_cli_client_text_calc_scopes.js`; read `2000000001`/`2000000002` first and copy the CURRENT full scope string from the newest one into `CLI_SCOPES_BEFORE`)

```js
/// <reference path="../pb_data/types.d.ts" />
// Add the backups scope to the seeded tinycld-cli client. The client row is a
// hard ceiling (ValidateClientScopes rejects any scope it does not name), so
// without this `tinycld auth login` fails once the server advertises backups.
// Appended, not folded into the seed: PocketBase never re-runs an applied
// migration. Rewrites the whole string so an already-widened row converges.
const CLI_SCOPES_BEFORE =
    'profile mail:read mail:send drive:read drive:write ' +
    'contacts:read contacts:write calendar:read calendar:write ' +
    'boards:read boards:write text:read text:write calc:read calc:write'

const CLI_SCOPES = CLI_SCOPES_BEFORE + ' backups'

migrate(
    app => {
        let cli
        try {
            cli = app.findFirstRecordByFilter('oauth_clients', 'client_id = {:id}', { id: 'tinycld-cli' })
        } catch {
            return
        }
        cli.set('scopes', CLI_SCOPES)
        app.save(cli)
    },
    app => {
        try {
            const cli = app.findFirstRecordByFilter('oauth_clients', 'client_id = {:id}', { id: 'tinycld-cli' })
            cli.set('scopes', CLI_SCOPES_BEFORE)
            app.save(cli)
        } catch {
            // already gone
        }
    }
)
```
Check whether any migration after `2000000002` changed the CLI scope string (grep `tinycld-cli` in `pb_migrations/`); `CLI_SCOPES_BEFORE` must equal the latest.

- [ ] **Step 2: Prove it applies**

`cd /Users/nas/code/tinycld/tinycld && pnpm run packages:generate` (replays migrations into a temp DB; a syntax error fails here). Then a Go test in `core/server/oauth` or `coreserver` that boots an app with the real migrations dir (pattern: `hosting/tenantmain/tenantmain_test.go` symlinks `pb_migrations`; or `core/server/coreserver/export_types_test.go` if it replays migrations) and asserts the `tinycld-cli` row's `scopes` contains `backups`. If no such harness exists in core, document the manual check: `pnpm run dev`, then `sqlite3 server/pb_data/data.db "select scopes from oauth_clients where client_id='tinycld-cli'"`.

- [ ] **Step 3: Commit**

```bash
git add core/server/pb_migrations/2050000002_cli_client_backups_scope.js
git commit -m "feat(core): grant the CLI client the backups scope"
```

---

### Task 3: Client helpers — streamed POST and ordered multipart

**Files:**
- Create: `cli/client/stream.go`
- Modify: `cli/client/multipart.go`
- Test: `cli/client/stream_test.go`, `cli/client/multipart_test.go` (extend if present)

**Interfaces:**
- Produces:
```go
// stream.go
func (c *Client) PostStream(ctx context.Context, path string, body any) (io.ReadCloser, *http.Response, error)
// multipart.go
func PostMultipartFields[T any](ctx context.Context, c *Client, path string, fields []Field, files []FilePart, progress ProgressFunc) (T, error)
type Field struct{ Name, Value string }   // written in the given order, before the files
```

- [ ] **Step 1: Failing tests**

`cli/client/stream_test.go`:
```go
package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPostStreamReturnsBodyAndSendsJSON(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("auth header %q", r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("chunk-1"))
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte("chunk-2"))
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL, &staticStore{tok: TokenSet{AccessToken: "tok", ExpiresAt: time.Now().Add(time.Hour)}}, srv.Client())
	body, res, err := c.PostStream(context.Background(), "/api/x", map[string]any{"stream": true})
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	b, _ := io.ReadAll(body)
	if string(b) != "chunk-1chunk-2" || res.StatusCode != 200 || got["stream"] != true {
		t.Fatalf("body %q status %d sent %v", b, res.StatusCode, got)
	}
}

func TestPostStreamNon2xxIsAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"message":"The daily limit for manual backups has been reached."}`))
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL, &staticStore{tok: TokenSet{AccessToken: "tok", ExpiresAt: time.Now().Add(time.Hour)}}, srv.Client())
	_, _, err := c.PostStream(context.Background(), "/api/x", map[string]any{})
	if err == nil || !contains(err.Error(), "HTTP 429") || !contains(err.Error(), "daily limit") {
		t.Fatalf("err %v", err)
	}
}
```
Add a `staticStore` (as in `drive/cli/testserver_test.go`) and a `contains` = `strings.Contains` helper in a shared `client/helpers_test.go` if the package has none.

`cli/client/multipart_test.go` addition:
```go
func TestPostMultipartFieldsWritesFieldsInOrderThenFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.age")
	_ = os.WriteFile(path, []byte("ARCHIVE"), 0o600)
	var order []string
	var fileBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mr, err := r.MultipartReader()
		if err != nil {
			t.Error(err)
			return
		}
		for {
			p, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			order = append(order, p.FormName())
			if p.FormName() == "archive" {
				b, _ := io.ReadAll(p)
				fileBody = string(b)
			}
		}
		w.WriteHeader(202)
		_, _ = w.Write([]byte(`{"jobId":"j1"}`))
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL, &staticStore{tok: TokenSet{AccessToken: "tok", ExpiresAt: time.Now().Add(time.Hour)}}, srv.Client())
	type resp struct{ JobID string `json:"jobId"` }
	out, err := PostMultipartFields[resp](context.Background(), c, "/api/org-backups/restore",
		[]Field{{"passphrase", "correct horse battery"}, {"force", "true"}},
		[]FilePart{{Field: "archive", Name: "a.age", Path: path}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out.JobID != "j1" || strings.Join(order, ",") != "passphrase,force,archive" || fileBody != "ARCHIVE" {
		t.Fatalf("out %+v order %v body %q", out, order, fileBody)
	}
}
```

- [ ] **Step 2: Run to see failures**

`cd cli && go test ./client/ -run 'PostStream|PostMultipartFields' -v` → undefined symbols.

- [ ] **Step 3: Implement `stream.go`**

```go
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
)

// PostStream sends a JSON body and hands back the response body unread, for
// endpoints that answer with a long stream. The caller closes the body. A
// non-2xx status is turned into the same apiError the JSON helpers return.
func (c *Client) PostStream(ctx context.Context, path string, body any) (io.ReadCloser, *http.Response, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Origin()+path, bytes.NewReader(raw))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(raw)), nil }
	res, err := c.DoStream(req)
	if err != nil {
		return nil, nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		_ = res.Body.Close()
		return nil, res, apiError(res.StatusCode, b)
	}
	return res.Body, res, nil
}
```
Match `apiError`'s real signature in `client.go` (it may take `(int, []byte)` or a response) — adapt.

- [ ] **Step 4: Implement `PostMultipartFields`** in `multipart.go`, reusing the existing pipe/boundary/`GetBody` machinery (`writeFileParts` etc.):

```go
// Field is a plain multipart form field. Fields are written in the order
// given, before any file part — the restore endpoint reads the passphrase
// before it will accept the archive.
type Field struct {
	Name  string
	Value string
}

func PostMultipartFields[T any](ctx context.Context, c *Client, path string, fields []Field, files []FilePart, progress ProgressFunc) (T, error) {
	var zero T
	build := func() (io.ReadCloser, string, error) {
		pr, pw := io.Pipe()
		boundary := newBoundary()
		go func() {
			mw := multipart.NewWriter(pw)
			_ = mw.SetBoundary(boundary)
			for _, f := range fields {
				if err := mw.WriteField(f.Name, f.Value); err != nil {
					_ = pw.CloseWithError(err)
					return
				}
			}
			if err := writeFileParts(mw, files, progress); err != nil {
				_ = pw.CloseWithError(err)
				return
			}
			_ = pw.CloseWithError(mw.Close())
		}()
		return pr, "multipart/form-data; boundary=" + boundary, nil
	}
	// … then the same request/GetBody/DoStream/decode sequence PostMultipart uses.
	// Refactor PostMultipart and PostMultipartFields to share one private
	// sendMultipart(ctx, c, path, build) helper rather than duplicating it.
	return sendMultipart[T](ctx, c, path, build)
}
```
Read the existing `PostMultipart` and extract `sendMultipart` so both call it; keep `PostMultipart`'s behaviour byte-for-byte (its tests must still pass).

- [ ] **Step 5: Run tests**

`cd cli && go test ./client/ -count=1 -v` → PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/client/
git commit -m "feat(cli): streamed POST and ordered multipart helpers"
```

---

### Task 4: Passphrase prompt and exit codes

**Files:**
- Create: `cli/ui/passphrase.go`, `cli/exit.go`
- Modify: `cli/root.go` (`deps` gains `readPassword func(fd int) ([]byte, error)`), `cli/main.go`
- Test: `cli/ui/passphrase_test.go`, `cli/exit_test.go`

**Interfaces:**
- Produces:
```go
// ui
const PassphraseEnv = "TINYCLD_BACKUP_PASSPHRASE"
const MinPassphrase = 12
type PassphraseSource struct {
	File        string                          // --passphrase-file
	Env         func(string) string             // os.Getenv in production
	Interactive bool                            // o.Interactive
	ReadPassword func(fd int) ([]byte, error)   // term.ReadPassword in production
	Stdin       *os.File                        // for the fd; nil in tests when ReadPassword is stubbed
	Stderr      io.Writer
}
func (s PassphraseSource) Read(confirm bool) (string, error)   // file → env → prompt (twice when confirm); trims one trailing newline; enforces MinPassphrase
var ErrNoPassphrase = errors.New("no passphrase: pass --passphrase-file, set TINYCLD_BACKUP_PASSPHRASE, or run interactively")
// exit
type ExitError struct { Code int; Err error }
func (e *ExitError) Error() string; func (e *ExitError) Unwrap() error
func Usage(err error) error   // wraps with Code 2
func Failed(err error) error  // wraps with Code 1
```
`main.go`: `if errors.As(err, &ee) { os.Exit(ee.Code) }` after printing.

- [ ] **Step 1: Failing tests**

`cli/ui/passphrase_test.go`:
```go
package ui

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPassphraseFromFileTrimsOneNewline(t *testing.T) {
	p := filepath.Join(t.TempDir(), "pp")
	_ = os.WriteFile(p, []byte("correct horse battery\n"), 0o600)
	got, err := PassphraseSource{File: p, Env: func(string) string { return "" }}.Read(false)
	if err != nil || got != "correct horse battery" {
		t.Fatalf("%q %v", got, err)
	}
}

func TestPassphraseFromEnv(t *testing.T) {
	got, err := PassphraseSource{Env: func(k string) string { if k == PassphraseEnv { return "correct horse battery" }; return "" }}.Read(false)
	if err != nil || got != "correct horse battery" {
		t.Fatalf("%q %v", got, err)
	}
}

func TestPassphraseTooShortIsRejectedBeforeAnyRequest(t *testing.T) {
	_, err := PassphraseSource{Env: func(string) string { return "short" }}.Read(false)
	if err == nil || !errors.Is(err, ErrPassphraseTooShort) {
		t.Fatalf("err %v", err)
	}
}

func TestPassphrasePromptTwiceMustMatch(t *testing.T) {
	answers := [][]byte{[]byte("correct horse battery"), []byte("different one here")}
	var stderr bytes.Buffer
	src := PassphraseSource{
		Env: func(string) string { return "" }, Interactive: true, Stderr: &stderr,
		ReadPassword: func(int) ([]byte, error) { a := answers[0]; answers = answers[1:]; return a, nil },
	}
	if _, err := src.Read(true); err == nil || !errors.Is(err, ErrPassphraseMismatch) {
		t.Fatalf("err %v", err)
	}
	if !bytes.Contains(stderr.Bytes(), []byte("Passphrase:")) {
		t.Fatalf("no prompt written: %q", stderr.String())
	}
}

func TestPassphraseNonInteractiveWithoutSourceFails(t *testing.T) {
	_, err := PassphraseSource{Env: func(string) string { return "" }, Interactive: false}.Read(false)
	if !errors.Is(err, ErrNoPassphrase) {
		t.Fatalf("err %v", err)
	}
}
```
Add `ErrPassphraseTooShort`, `ErrPassphraseMismatch` sentinels.

`cli/exit_test.go`: `Usage(errors.New("x"))` → `*ExitError` with Code 2, `Failed` → 1, `Unwrap` returns the inner error.

- [ ] **Step 2: Run to see failures** — `cd cli && go test ./ui/ ./ -run 'Passphrase|Exit' -v`.

- [ ] **Step 3: Implement `ui/passphrase.go`**

```go
package ui

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	PassphraseEnv = "TINYCLD_BACKUP_PASSPHRASE"
	MinPassphrase = 12
)

var (
	ErrNoPassphrase       = errors.New("no passphrase: pass --passphrase-file, set " + PassphraseEnv + ", or run interactively")
	ErrPassphraseTooShort = fmt.Errorf("the passphrase must be at least %d characters", MinPassphrase)
	ErrPassphraseMismatch = errors.New("the passphrases do not match")
)

// PassphraseSource resolves a passphrase without ever taking it as a flag
// (flags show in `ps`). Order: file, environment, interactive prompt.
type PassphraseSource struct {
	File         string
	Env          func(string) string
	Interactive  bool
	ReadPassword func(fd int) ([]byte, error)
	Stdin        *os.File
	Stderr       io.Writer
}

func (s PassphraseSource) Read(confirm bool) (string, error) {
	if s.File != "" {
		b, err := os.ReadFile(s.File)
		if err != nil {
			return "", fmt.Errorf("read passphrase file: %w", err)
		}
		return check(strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r"))
	}
	if s.Env != nil {
		if v := s.Env(PassphraseEnv); v != "" {
			return check(v)
		}
	}
	if !s.Interactive || s.ReadPassword == nil {
		return "", ErrNoPassphrase
	}
	first, err := s.prompt("Passphrase: ")
	if err != nil {
		return "", err
	}
	if _, err := check(first); err != nil {
		return "", err
	}
	if confirm {
		second, err := s.prompt("Confirm passphrase: ")
		if err != nil {
			return "", err
		}
		if !bytes.Equal([]byte(first), []byte(second)) {
			return "", ErrPassphraseMismatch
		}
	}
	return first, nil
}

func (s PassphraseSource) prompt(label string) (string, error) {
	fmt.Fprint(s.Stderr, label)
	fd := 0
	if s.Stdin != nil {
		fd = int(s.Stdin.Fd())
	}
	b, err := s.ReadPassword(fd)
	fmt.Fprintln(s.Stderr)
	if err != nil {
		return "", fmt.Errorf("read passphrase: %w", err)
	}
	return string(b), nil
}

func check(p string) (string, error) {
	if len([]rune(p)) < MinPassphrase {
		return "", ErrPassphraseTooShort
	}
	return p, nil
}
```

`cli/exit.go`:
```go
package main

import "errors"

// ExitError carries the process exit code for main. Usage errors are 2,
// a run that ended badly is 1; anything unwrapped is 1 as before.
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }
func (e *ExitError) Unwrap() error { return e.Err }

func Usage(err error) error  { return &ExitError{Code: 2, Err: err} }
func Failed(err error) error { return &ExitError{Code: 1, Err: err} }

func exitCode(err error) int {
	var ee *ExitError
	if errors.As(err, &ee) {
		return ee.Code
	}
	return 1
}
```
`main.go`: replace `os.Exit(1)` with `os.Exit(exitCode(err))`. `root.go` `deps`: add `readPassword func(fd int) ([]byte, error)` (set to `term.ReadPassword` in `defaultDeps()`), `getenv func(string) string` (`os.Getenv`), and `stdinFile *os.File` (`os.Stdin`); tests set the first two and leave `stdinFile` nil.

- [ ] **Step 4: Run tests** — `cd cli && go test ./... -count=1`.

- [ ] **Step 5: Commit**

```bash
git add cli/ui/passphrase.go cli/ui/passphrase_test.go cli/exit.go cli/exit_test.go cli/root.go cli/main.go
git commit -m "feat(cli): passphrase sources and exit codes"
```

---

### Task 5: `tinycld backup` commands

**Files:**
- Create: `cli/backup.go`, `cli/backup_create.go`, `cli/backup_inspect.go`, `cli/backup_restore.go`, `cli/backup_list.go`
- Modify: `cli/root.go:122-127` (add `newBackupCmd(d)`)
- Test: `cli/backup_test.go`

**Interfaces:**
- Consumes: `d.apiClient()`, `client.PostStream`, `client.PostMultipartFields`, `client.GetJSON/PostJSON/PatchJSON`, `ui.PassphraseSource`, `ui.NewProgress`, `ui.Confirm`, `output.Options.Write/Info`, `output.FormatBytes`, `format.Inspect`, `format.NewRangeSource`, `format.RedactURLError`, `age.NewScryptIdentity`, `Usage`/`Failed`.
- Produces:
```go
func newBackupCmd(d *deps) *cobra.Command           // Use: "backup", Short: "Back up and restore this organization"
type ledgerRow struct {                             // mirrors the server's PublicExport of a backups record
	ID string `json:"id"`; Kind string `json:"kind"`; Status string `json:"status"`
	Started string `json:"started"`; Finished string `json:"finished"`
	Bytes int64 `json:"bytes"`; Sha256 string `json:"sha256"`; TargetHost string `json:"target_host"`
	Error string `json:"error"`; Manifest json.RawMessage `json:"manifest"`; Metadata map[string]any `json:"metadata"`
}
func pollRow(ctx context.Context, c *client.Client, id string, o output.Options, stderr io.Writer, onWaiting func(row ledgerRow) (string, error)) (ledgerRow, error)
```
`pollRow` GETs `/api/org-backups/{id}` every 2 s (interval injectable via `d.sleep`), prints `bytes` progress via `o.Info`, tolerates connection errors for up to 5 minutes (the server restarts after a restore), calls `onWaiting` when `status == waiting_for_source` (returns a fresh URL to PATCH, or an error), and returns on a terminal status.

- [ ] **Step 1: Failing tests** — `cli/backup_test.go` with a fake server (pattern: `search_test.go`): routes `POST /api/org-backups` (records the body; `stream:true` → writes a real archive built with `format.NewWriter` + `age.NewScryptRecipient("correct horse battery")`; else 202 `{"id":"b1"}`), `GET /api/org-backups/b1` (a scripted sequence of rows: running bytes 10 → running bytes 20 → succeeded), `POST /api/org-backups/restore` (multipart: asserts part order and returns 202 `{"jobId":"r1"}`; JSON: 202; when the fixture flag `mismatch` is set → 409 `{"message":"…","diff":{"missing":["widgets"],"extra":[],"versionDelta":{}},"jobId":"r1"}`), `GET /api/org-backups/r1` (running → succeeded), `PATCH /api/org-backups/restore/r1` (records source → 204), `GET /api/collections/backups/records` (list via `client.ListRecords` — or if the CLI reads the ledger through `GET /api/org-backups/{id}` only, list uses the PB records API with the admin session: check how `search.go` or a package CLI lists a collection and use `client.ListRecords[ledgerRow](ctx, c, "backups", ListOptions{Sort: "-started"})`).

Tests (each uses `testDeps` + config + token as `search_test.go` does, plus `d.getenv`/`d.readPassword` stubs, `d.isInteractive`):
```go
func TestBackupCreateOutStreamsAValidArchive(t *testing.T)      // --out file; archive inspects OK with the passphrase; stderr has progress; exit nil
func TestBackupCreateOutDashWritesStdout(t *testing.T)           // --out -; stdout bytes == archive; nothing else on stdout
func TestBackupCreateToPollsTheLedger(t *testing.T)              // --to URL; body target==URL; stderr shows "20 B" then "succeeded"; exit nil
func TestBackupCreateRefusesShortPassphraseWithoutARequest(t *testing.T) // env short → ErrPassphraseTooShort, exit code 2, server saw no request
func TestBackupCreateRateLimitedExitsOne(t *testing.T)           // 429 → error mentions "daily limit"; exit code 1
func TestBackupInspectFile(t *testing.T)                         // prints format, created, source, core, packages, counts, members OK; --json emits the manifest+report
func TestBackupInspectTamperedFileFails(t *testing.T)            // flip a byte → non-nil error, exit 1, still prints the manifest
func TestBackupRestoreFromFileUploadsInOrder(t *testing.T)       // --from file --yes; server saw passphrase, force? absent, archive; polls r1 → succeeded; exit nil
func TestBackupRestoreForceSendsField(t *testing.T)              // --force → "force"="true" part present
func TestBackupRestoreMismatchPrintsDiffExitsOne(t *testing.T)   // 409 diff → stderr lists "missing: widgets"; exit 1
func TestBackupRestoreRequiresYesWhenNotInteractive(t *testing.T) // no --yes, !interactive → error from ui.Confirm; no request
func TestBackupRestoreFromURLHandlesWaitingForSource(t *testing.T) // JSON restore; poll sees waiting_for_source; with --yes → exits 1 "waiting for a fresh source URL"; interactive stub answers a URL → PATCH seen → succeeded
func TestBackupRestoreSurvivesServerRestart(t *testing.T)        // fake server closes its listener for 2 polls (use a proxy that refuses connections), then answers succeeded; exit nil
func TestBackupListRendersLedger(t *testing.T)                   // table has KIND STATUS STARTED SIZE TARGET; --output json emits rows
```
For "server restart" use an `httptest.Server` behind a small TCP proxy you can pause, or make the fake handler return `hijack+close` for two requests — pick the simplest that yields a connection error from the client.

- [ ] **Step 2: Run to see failures** — `cd cli && go test . -run Backup -v`.

- [ ] **Step 3: Implement `backup.go`** (group + shared helpers)

```go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

const backupsPath = "/api/org-backups"

func newBackupCmd(d *deps) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "backup",
		Short: "Back up and restore this organization",
		Long:  "Create an encrypted backup of the whole organization, inspect one, restore one, or list past runs.",
	}
	cmd.AddCommand(newBackupCreateCmd(d), newBackupInspectCmd(d), newBackupRestoreCmd(d), newBackupListCmd(d))
	return cmd
}

type ledgerRow struct {
	ID         string          `json:"id"`
	Kind       string          `json:"kind"`
	Status     string          `json:"status"`
	Started    string          `json:"started"`
	Finished   string          `json:"finished"`
	Bytes      int64           `json:"bytes"`
	Sha256     string          `json:"sha256"`
	TargetHost string          `json:"target_host"`
	Error      string          `json:"error"`
	Manifest   json.RawMessage `json:"manifest"`
	Metadata   map[string]any  `json:"metadata"`
}

func (r ledgerRow) terminal() bool {
	switch r.Status {
	case "succeeded", "failed", "interrupted":
		return true
	}
	return false
}

// passphraseSource wires the deps' stubs into ui.PassphraseSource.
func passphraseSource(d *deps, file string) ui.PassphraseSource {
	return ui.PassphraseSource{
		File: file, Env: d.getenv, Interactive: d.isInteractive,
		ReadPassword: d.readPassword, Stdin: d.stdinFile, Stderr: d.stderr,
	}
}

const (
	pollInterval    = 2 * time.Second
	reconnectWindow = 5 * time.Minute
)

// pollRow follows a ledger row to its end. A restore ends by restarting the
// server, so connection errors are tolerated for a while; the row is the
// only record that survives the restart.
func pollRow(ctx context.Context, d *deps, c *client.Client, id string, o output.Options, onWaiting func(ledgerRow) (string, error)) (ledgerRow, error) {
	var last ledgerRow
	var lastBytes int64 = -1
	var downSince time.Time
	sleep := d.sleep
	if sleep == nil {
		sleep = time.Sleep
	}
	for {
		var row ledgerRow
		err := c.GetJSON(ctx, backupsPath+"/"+id, &row)
		switch {
		case err == nil:
			downSince = time.Time{}
			if row.Bytes != lastBytes && row.Status == "running" {
				o.Info(d.stderr, "%s transferred", output.FormatBytes(row.Bytes))
				lastBytes = row.Bytes
			}
			if row.Status == "waiting_for_source" && last.Status != "waiting_for_source" {
				if onWaiting == nil {
					return row, Failed(errors.New("the restore is waiting for a fresh source URL"))
				}
				fresh, werr := onWaiting(row)
				if werr != nil {
					return row, werr
				}
				if perr := c.PatchJSON(ctx, backupsPath+"/restore/"+id, map[string]string{"source": fresh}, nil); perr != nil {
					return row, perr
				}
			}
			last = row
			if row.terminal() {
				return row, nil
			}
		case isConnectionError(err):
			if downSince.IsZero() {
				downSince = time.Now()
				o.Info(d.stderr, "server unreachable — waiting for it to come back")
			} else if time.Since(downSince) > reconnectWindow {
				return last, fmt.Errorf("server did not come back within %s: %w", reconnectWindow, err)
			}
		case errors.Is(err, client.ErrAuthExpired):
			return last, err
		default:
			// A 404 right after a restore means the row lived in the replaced
			// database; report what we last saw.
			if strings.Contains(err.Error(), "HTTP 404") && last.ID != "" {
				return last, nil
			}
			return last, err
		}
		select {
		case <-ctx.Done():
			return last, ctx.Err()
		default:
		}
		sleep(pollInterval)
	}
}

func isConnectionError(err error) bool {
	var ne interface{ Timeout() bool }
	if errors.As(err, &ne) {
		return true
	}
	s := err.Error()
	return strings.Contains(s, "connection refused") || strings.Contains(s, "EOF") || strings.Contains(s, "connection reset") || strings.Contains(s, "no such host")
}

func finishExit(row ledgerRow, o output.Options, stderr io.Writer) error {
	switch row.Status {
	case "succeeded":
		o.Info(stderr, "%s: succeeded (%s)", row.Kind, output.FormatBytes(row.Bytes))
		return nil
	default:
		msg := row.Error
		if msg == "" {
			msg = row.Status
		}
		return Failed(fmt.Errorf("%s %s: %s", row.Kind, row.Status, msg))
	}
}

var _ = http.StatusOK
```
Remove unused imports at the end. `d.stdinFile *os.File` is `os.Stdin` in `defaultDeps()`, nil in tests.

- [ ] **Step 4: Implement `backup_create.go`**

```go
func newBackupCreateCmd(d *deps) *cobra.Command {
	var out, to, ppFile string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a backup and stream it to a file, or have the server upload it to a URL",
		Example: "  tinycld backup create --out ./backup.age\n  tinycld backup create --out - | aws s3 cp - s3://bucket/backup.age\n  tinycld backup create --to 'https://…presigned PUT…'",
		RunE: func(cmd *cobra.Command, args []string) error {
			if (out == "") == (to == "") {
				return Usage(errors.New("pass exactly one of --out or --to"))
			}
			o := d.out
			pp, err := passphraseSource(d, ppFile).Read(true)
			if err != nil {
				return Usage(err)
			}
			c, _, err := d.apiClient()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			if to != "" {
				var res struct{ ID string `json:"id"` }
				if err := c.PostJSON(ctx, backupsPath, map[string]any{"target": to, "passphrase": pp}, &res); err != nil {
					return Failed(err)
				}
				o.Info(d.stderr, "backup %s started", res.ID)
				row, err := pollRow(ctx, d, c, res.ID, o, nil)
				if err != nil {
					return err
				}
				return finishExit(row, o, d.stderr)
			}
			body, _, err := c.PostStream(ctx, backupsPath, map[string]any{"stream": true, "passphrase": pp})
			if err != nil {
				return Failed(err)
			}
			defer body.Close()
			var w io.Writer
			var f *os.File
			if out == "-" {
				w = d.stdout
			} else {
				if err := ui.ConfirmOverwrite(o, d.yes, cmd.InOrStdin(), d.stderr, out); err != nil {
					return err
				}
				f, err = os.OpenFile(out, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
				if err != nil {
					return err
				}
				w = f
			}
			prog := ui.NewProgress(o, d.stderr, "downloading")
			n, err := io.Copy(io.MultiWriter(w, progressWriter{prog}), body)
			prog.Done()
			if f != nil {
				if cerr := f.Close(); err == nil {
					err = cerr
				}
			}
			if err != nil {
				return Failed(fmt.Errorf("the stream ended early after %s: %w — the server's backup ledger has the reason", output.FormatBytes(n), err))
			}
			o.Info(d.stderr, "wrote %s (%s)", out, output.FormatBytes(n))
			return nil
		},
	}
	cmd.Flags().StringVar(&out, "out", "", "write the archive to this file ('-' for stdout)")
	cmd.Flags().StringVar(&to, "to", "", "have the server upload the archive to this presigned PUT URL")
	cmd.Flags().StringVar(&ppFile, "passphrase-file", "", "read the passphrase from this file")
	return cmd
}

type progressWriter struct{ p *ui.Progress }

func (w progressWriter) Write(b []byte) (int, error) { w.p.Update(int64(len(b)), 0); return len(b), nil }
```
`ui.Progress.Update(written, total)` is cumulative in the existing helper — check its semantics and keep a running total in `progressWriter` if it expects the cumulative count.

- [ ] **Step 5: Implement `backup_inspect.go`**

```go
func newBackupInspectCmd(d *deps) *cobra.Command {
	var ppFile string
	cmd := &cobra.Command{
		Use:   "inspect <file|url>",
		Short: "Read an archive's manifest and verify every member, without restoring",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o := d.out
			pp, err := passphraseSource(d, ppFile).Read(false)
			if err != nil {
				return Usage(err)
			}
			id, err := age.NewScryptIdentity(pp)
			if err != nil {
				return Usage(err)
			}
			var r io.ReadCloser
			if strings.HasPrefix(args[0], "http://") || strings.HasPrefix(args[0], "https://") {
				r = format.NewRangeSource(cmd.Context(), args[0])
			} else {
				f, err := os.Open(args[0])
				if err != nil {
					return Usage(err)
				}
				r = f
			}
			defer r.Close()
			m, rep, verr := format.Inspect(r, id)
			if verr != nil && m.Format == "" {
				return Failed(fmt.Errorf("not a readable backup (wrong passphrase, or not an archive): %w", format.RedactURLError(verr)))
			}
			if err := writeInspect(o, d.stdout, m, rep); err != nil {
				return err
			}
			if verr != nil {
				return Failed(fmt.Errorf("verification failed: %w", format.RedactURLError(verr)))
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&ppFile, "passphrase-file", "", "read the passphrase from this file")
	return cmd
}

func writeInspect(o output.Options, w io.Writer, m format.Manifest, rep format.Report) error {
	rows := [][]string{
		{"format", m.Format}, {"created", m.Created.UTC().Format(time.RFC3339)},
		{"source", m.Source}, {"kind", m.Kind}, {"core", m.Core},
	}
	slugs := make([]string, 0, len(m.Packages))
	for s := range m.Packages {
		slugs = append(slugs, s)
	}
	sort.Strings(slugs)
	for _, s := range slugs {
		rows = append(rows, []string{"package " + s, m.Packages[s] + "  (" + m.Lockfile[s] + ")"})
	}
	rows = append(rows, []string{"files", fmt.Sprintf("%d (%s)", m.Counts.Files, output.FormatBytes(m.Counts.Bytes))})
	var total int64
	for _, mem := range rep.Members {
		total += mem.Size
		state := "OK"
		if !mem.OK {
			state = "FAIL"
		}
		rows = append(rows, []string{"member " + mem.Name, fmt.Sprintf("%s  %s", output.FormatBytes(mem.Size), state)})
	}
	rows = append(rows, []string{"archive total", output.FormatBytes(total)}, []string{"verified", fmt.Sprint(rep.OK)})
	raw := map[string]any{"manifest": m, "report": rep}
	return o.Write(w, []string{"FIELD", "VALUE"}, rows, raw)
}
```

- [ ] **Step 6: Implement `backup_restore.go`**

```go
func newBackupRestoreCmd(d *deps) *cobra.Command {
	var from, ppFile string
	var force bool
	cmd := &cobra.Command{
		Use:   "restore --from <file|url>",
		Short: "Replace this organization's data with a backup",
		Long:  "Restores a backup into the server you are signed in to. All current data is replaced; the server takes a safety copy first and restarts when the restore is staged.",
		RunE: func(cmd *cobra.Command, args []string) error {
			if from == "" {
				return Usage(errors.New("--from is required"))
			}
			o := d.out
			pp, err := passphraseSource(d, ppFile).Read(false)
			if err != nil {
				return Usage(err)
			}
			isURL := strings.HasPrefix(from, "http://") || strings.HasPrefix(from, "https://")
			if !isURL {
				id, _ := age.NewScryptIdentity(pp)
				f, err := os.Open(from)
				if err != nil {
					return Usage(err)
				}
				m, rep, verr := format.Inspect(f, id)
				_ = f.Close()
				if verr != nil {
					return Failed(fmt.Errorf("the archive does not verify; refusing to restore it: %w", verr))
				}
				if err := writeInspect(o, d.stderr, m, rep); err != nil {
					return err
				}
			}
			ok, err := ui.Confirm(o, d.yes, cmd.InOrStdin(), d.stderr, "Replace ALL current data on "+serverName(d)+" with this backup?")
			if err != nil {
				return Usage(err)
			}
			if !ok {
				return Usage(errors.New("restore cancelled"))
			}
			c, _, err := d.apiClient()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			var res struct {
				JobID string `json:"jobId"`
			}
			if isURL {
				err = c.PostJSON(ctx, backupsPath+"/restore", map[string]any{"source": from, "passphrase": pp, "force": force}, &res)
			} else {
				fields := []client.Field{{Name: "passphrase", Value: pp}}
				if force {
					fields = append(fields, client.Field{Name: "force", Value: "true"})
				}
				prog := ui.NewProgress(o, d.stderr, "uploading")
				res, err = client.PostMultipartFields[struct{ JobID string `json:"jobId"` }](ctx, c, backupsPath+"/restore", fields,
					[]client.FilePart{{Field: "archive", Name: filepath.Base(from), Path: from}}, prog.Func())
				prog.Done()
			}
			if err != nil {
				return restoreStartError(err, o, d.stderr)
			}
			o.Info(d.stderr, "restore %s started", res.JobID)
			row, err := pollRow(ctx, d, c, res.JobID, o, func(r ledgerRow) (string, error) {
				if d.yes || !d.isInteractive {
					return "", Failed(errors.New("the restore is waiting for a fresh source URL; rerun without --yes to supply one"))
				}
				fmt.Fprint(d.stderr, "The source URL expired. Fresh URL: ")
				var line string
				if _, err := fmt.Fscanln(cmd.InOrStdin(), &line); err != nil {
					return "", err
				}
				return strings.TrimSpace(line), nil
			})
			if err != nil {
				return err
			}
			if row.Status == "running" {
				if awaiting, _ := row.Metadata["awaiting_restart"].(bool); awaiting {
					o.Info(d.stderr, "restore staged; restart the server to apply it")
					return nil
				}
			}
			return finishExit(row, o, d.stderr)
		},
	}
	cmd.Flags().StringVar(&from, "from", "", "archive file, or a presigned GET URL the server fetches")
	cmd.Flags().StringVar(&ppFile, "passphrase-file", "", "read the passphrase from this file")
	cmd.Flags().BoolVar(&force, "force", false, "restore data even if the package set differs (single binary only)")
	return cmd
}

// restoreStartError turns the server's 409 mismatch body into a readable
// diff. The client's apiError keeps only `message`; the diff is parsed from
// the message text the server builds ("missing: a, b; extra: c; …").
func restoreStartError(err error, o output.Options, stderr io.Writer) error {
	msg := err.Error()
	if strings.Contains(msg, "does not match this binary's package set") {
		fmt.Fprintln(stderr, "The archive's package set does not match the server:")
		fmt.Fprintln(stderr, "  "+msg[strings.Index(msg, "(")+1:strings.LastIndex(msg, ")")])
		fmt.Fprintln(stderr, "Rerun with --force to restore the data anyway (single binary only).")
		return Failed(errors.New("package set mismatch"))
	}
	return Failed(err)
}

func serverName(d *deps) string {
	cfg, err := d.loadConfig()
	if err != nil {
		return "the server"
	}
	name, _, err := cfg.Resolve(d.ctxFlag)
	if err != nil {
		return "the server"
	}
	return name
}
```
If `apiError` discards the body, extend it (in `client.go`) to keep the raw body on the error type (`APIError{Status int; Message string; Body []byte}`) so `restoreStartError` can decode `diff` properly instead of parsing text — do that and decode `diff` (`missing`, `extra`, `versionDelta`) into three lines. Prefer the structured path; the text fallback is for older servers.

- [ ] **Step 7: Implement `backup_list.go`**

```go
func newBackupListCmd(d *deps) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List backup and restore runs",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := d.apiClient()
			if err != nil {
				return err
			}
			rows, err := client.ListAll[ledgerRow](cmd.Context(), c, "backups", client.ListOptions{Sort: "-started"})
			if err != nil {
				return Failed(err)
			}
			table := make([][]string, 0, len(rows))
			for _, r := range rows {
				table = append(table, []string{r.ID, r.Kind, r.Status, r.Started, output.FormatBytes(r.Bytes), r.TargetHost, r.Error})
			}
			return d.out.Write(d.stdout, []string{"ID", "KIND", "STATUS", "STARTED", "SIZE", "TARGET", "ERROR"}, table, rows)
		},
	}
}
```
`client.ListAll[T]` exists (`records.go`); confirm its signature and that the `backups` collection list rule (owner|admin) admits the CLI token — the OAuth grant middleware allows collection reads only for collections a scope registered. Check `oauth/registry.go` `collections` for `backups`; if absent, add `"backups": {read: ScopeRule{ScopeBackups}}` to core's `rebuild()` in this task (with a registry test) — the CLI otherwise 403s on `list`.

- [ ] **Step 8: Register** — `cli/root.go` `root.AddCommand(..., newBackupCmd(d))`.

- [ ] **Step 9: Run tests** — `cd cli && go test ./... -count=1 -race`; then `go vet ./... && gofmt -l .`.

- [ ] **Step 10: Commit**

```bash
git add cli/backup*.go cli/root.go core/server/oauth/registry.go core/server/oauth/registry_test.go
git commit -m "feat(cli): backup create, inspect, restore and list"
```

---

### Task 6: Docs

**Files:**
- Modify: `core/help/backups.md` (the two "With the command line" passages now state the commands exist, add `inspect` and `list`, the `--passphrase-file`/env sources, `--force`, `--out -` piping), `core/help/command-line.md` (add `backup` to the command overview if it lists commands), `docs/single-binary.md` (already mentions the commands — verify wording).

- [ ] **Step 1: Edit the topics**; keep sentences short; no deployment hostnames.
- [ ] **Step 2:** `pnpm run packages:generate && pnpm run checks`.
- [ ] **Step 3: Commit** — `git commit -am "docs: CLI backup commands"`.

---

### Task 7: Final verification and PR

- [ ] `cd cli && go test ./... -race -count=1 && go vet ./... && gofmt -l .`
- [ ] `cd ../core/server && go test ./backup/... ./oauth/... -count=1 && go build ./...`
- [ ] `cd ../../server && go build ./...`; `cd ../../drive/cli && go build ./...` (member standalone)
- [ ] `cd /Users/nas/code/tinycld/tinycld && pnpm run checks`
- [ ] Manual smoke against `pnpm run dev`: `tinycld auth login localhost:8090` (confirm the consent screen lists "Create and restore backups"), `tinycld backup create --out /tmp/b.age`, `tinycld backup inspect /tmp/b.age`, `tinycld backup list`.
- [ ] Open PR `backups-cli` → `backups-core` (or `main` once #288 merged): title "CLI: backup create, inspect, restore, list"; body three lines (what, the format module split, the scope migration).
