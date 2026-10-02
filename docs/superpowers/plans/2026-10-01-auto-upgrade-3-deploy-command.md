# Auto-upgrade 3 (`deploy.sh upgrade`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command on the operator's machine upgrades the hosting router and the tinycld.com site, shows which ref each repo resolves to before anything changes, and confirms both services are healthy afterwards.

**Architecture:** `install.sh` gets a read-only `RESOLVE_ONLY=1` mode that prints the repo/ref/commit table and exits before it touches the host. `deploy.sh` gets an `upgrade` target that reads `DOMAIN`/`SUPERUSER_EMAIL` from the host's `hosting.env`, shows the resolve table, asks to confirm, runs the existing `com-hosting` install, runs the existing `com-web` deploy, restarts `tinycld-com`, and runs health checks. All remote calls go through `$SSH`/`$SCP` (default `ssh`/`scp`) so bash tests can stub them.

**Tech Stack:** bash, git, curl, jq (on the host), ssh/scp.

**Spec:** `docs/superpowers/specs/2026-10-01-auto-upgrade-3-deploy-command-design.md`

## Global Constraints

- Repo: `utils` (`~/code/tinycld/utils`). Branch `feat/deploy-upgrade`, created from `feat/auto-upgrade-core` (PR tinycld/utils#30 is not merged yet and also edits `install.sh`).
- Command: `./deploy.sh upgrade [--ref <ref>] [--pins scaffold] [--no-web] [--yes]`. Defaults: `--ref :latest-tag`, release pins, web deployed, prompt shown.
- `--ref` is passed as `GIT_REF`; `--pins scaffold` as `PINS_SOURCE=scaffold`; `--yes` skips the confirm (same as `DEPLOY_YES=1`).
- The host's `DOMAIN` and `SUPERUSER_EMAIL` come from `/etc/tinycld/hosting.env` (`MT_BASE_DOMAIN`, `MT_SUPERUSER_EMAIL`). A missing file is an error that says to run `deploy.sh com-hosting` for a first install.
- `RESOLVE_ONLY=1 ./install.sh` changes nothing on the host: no apt, no clone, no fetch into the clones, no checkout, no file writes. It must not need root and must not need `SUPERUSER_EMAIL`. It prints one line per repo: `    <slug> <ref> <short-sha>` in the same format as step 4 of the installer.
- Health checks (all must pass, else exit non-zero and print the last 50 `journalctl` lines of the failed service): `systemctl is-active tinycld-hosting tinycld-com` on the host; `https://admin.$DOMAIN/api/health` → 200; `https://$DOMAIN/` → 200; one active org's `https://<slug>.$DOMAIN/api/health` → 200 (first `active` org from the control plane's `orgs` records, read on the host with the superuser credentials from `hosting.env`; retry for up to 90 s because the org may cold-start). With `--no-web`, skip the `tinycld-com` and apex checks.
- Never print `MT_SUPERUSER_PASSWORD` or any other secret. Never write credentials to a file. Never touch the stash in this repo (`stash@{0}`).
- Before every commit: `git branch --show-current` must print `feat/deploy-upgrade`; stage explicit paths.
- Run `bash -n deploy.sh hosting-install/install.sh` and the new bash tests before each commit.

## File map

| File | Responsibility |
|---|---|
| `hosting-install/install.sh` | `RESOLVE_ONLY=1` mode |
| `hosting-install/tests/resolve_only_test.sh` | bash test for resolve-only against local git repos |
| `deploy.sh` | `upgrade` target, `$SSH`/`$SCP` indirection, health checks |
| `tests/deploy_upgrade_test.sh` | bash test with stub `ssh`/`scp`/`curl` |
| `hosting-install/README.md` | "Upgrading" section |

---

### Task 1: `RESOLVE_ONLY=1` in install.sh

**Files:**
- Modify: `hosting-install/install.sh` (the env block near the top, before `set -euo pipefail` checks run; the ref helpers `latest_tag`/`resolve_ref` ~330-355)
- Create: `hosting-install/tests/resolve_only_test.sh`

**Interfaces:**
- Produces: `RESOLVE_ONLY=1 DOMAIN=… [GIT_REF=…] [FALLBACK_REF=…] [REPO_BASE=…] [MT_HOME=…] [FEATURES=…] ./install.sh` prints a header line `    repo                     ref                                commit` then one line per repo in the order `tinycld hosting $FEATURES`, and exits 0. Exit 1 with a message if any repo's remote cannot be listed.

- [ ] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
# Exercises install.sh RESOLVE_ONLY=1 against local bare repos: the ref table
# must be right, and nothing on "the host" (MT_HOME) may change.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
installer="$here/../install.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkrepo() { # name tags...
    local name="$1"; shift
    git init -q --bare "$tmp/remotes/$name.git"
    git clone -q "$tmp/remotes/$name.git" "$tmp/work-$name" 2>/dev/null
    git -C "$tmp/work-$name" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m init
    git -C "$tmp/work-$name" push -q origin HEAD:main
    for t in "$@"; do
        git -C "$tmp/work-$name" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m "$t"
        git -C "$tmp/work-$name" tag "$t"
        git -C "$tmp/work-$name" push -q origin "$t"
    done
}
mkrepo tinycld v0.5.0 v0.6.1 v0.6.10-rc.1
mkrepo hosting v0.1.2
mkrepo mail                      # no release tag

mkdir -p "$tmp/mt"
# An existing clone on "the host": resolve-only must not move it.
git clone -q "$tmp/remotes/tinycld.git" "$tmp/mt/tinycld"
before="$(git -C "$tmp/mt/tinycld" rev-parse HEAD) $(git -C "$tmp/mt/tinycld" tag | wc -l)"

out="$(RESOLVE_ONLY=1 DOMAIN=example.test GIT_REF=:latest-tag FALLBACK_REF=main \
    REPO_BASE="file://$tmp/remotes" MT_HOME="$tmp/mt" FEATURES=mail \
    bash "$installer")"
echo "$out"

grep -Eq '^ +tinycld +v0\.6\.1 +[0-9a-f]{7,}$' <<<"$out" || { echo "FAIL: tinycld should resolve to v0.6.1"; exit 1; }
grep -Eq '^ +hosting +v0\.1\.2 +[0-9a-f]{7,}$' <<<"$out" || { echo "FAIL: hosting should resolve to v0.1.2"; exit 1; }
grep -Eq '^ +mail +main +[0-9a-f]{7,}$' <<<"$out"       || { echo "FAIL: mail should fall back to main"; exit 1; }

after="$(git -C "$tmp/mt/tinycld" rev-parse HEAD) $(git -C "$tmp/mt/tinycld" tag | wc -l)"
[ "$before" = "$after" ] || { echo "FAIL: the existing clone changed ($before -> $after)"; exit 1; }
[ ! -e "$tmp/mt/hosting" ] || { echo "FAIL: resolve-only cloned a repo"; exit 1; }

# A branch ref that exists in one repo only.
git -C "$tmp/work-hosting" push -q origin HEAD:refs/heads/feat/x
out="$(RESOLVE_ONLY=1 DOMAIN=example.test GIT_REF=feat/x FALLBACK_REF=main \
    REPO_BASE="file://$tmp/remotes" MT_HOME="$tmp/mt" FEATURES=mail bash "$installer")"
grep -Eq '^ +hosting +feat/x ' <<<"$out" || { echo "FAIL: hosting should resolve to feat/x"; exit 1; }
grep -Eq '^ +tinycld +main ' <<<"$out"   || { echo "FAIL: tinycld should fall back to main"; exit 1; }

echo PASS
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/code/tinycld/utils && bash hosting-install/tests/resolve_only_test.sh`
Expected: FAIL (the installer dies on `SUPERUSER_EMAIL` or "run as root").

- [ ] **Step 3: Implement**

In `install.sh`:
1. Read `RESOLVE_ONLY="${RESOLVE_ONLY:-}"` with the other env, and make `SUPERUSER_EMAIL` required only when `RESOLVE_ONLY` is not `1` (`DOMAIN` stays required — it is cheap and keeps one code path).
2. Move `FALLBACK_REF`, `latest_tag` and `resolve_ref` above the root check (`[ "$(id -u)" -eq 0 ] || die …`), unchanged in behavior, and make them take a git REMOTE instead of a clone dir: `latest_tag <remote>` runs `git ls-remote --tags --refs "$remote"`; `resolve_ref <remote>` runs `git ls-remote --quiet --exit-code --heads --tags "$remote" "$GIT_REF"`. In `clone_or_update`, pass `origin`-equivalent: the clone's `$dir` with `-C` is replaced by the remote URL `$REPO_BASE/$slug.git` — confirm the existing behavior for an already-cloned repo is identical (its origin is that URL).
3. Add, right after those helpers and before the root check:

```bash
# RESOLVE_ONLY=1: print what each repo's ref resolves to and stop. Read-only —
# ls-remote only, no clone, fetch or checkout — so an operator can check the
# mix before an upgrade changes anything.
if [ "$RESOLVE_ONLY" = "1" ]; then
    printf '    %-24s %-34s %s\n' repo ref commit
    for slug in tinycld hosting $FEATURES; do
        remote="$REPO_BASE/$slug.git"
        ref="$(resolve_ref "$remote")"
        sha="$(git ls-remote "$remote" "refs/heads/$ref" "refs/tags/$ref" | awk 'NR==1{print substr($1,1,8)}')"
        [ -n "$sha" ] || die "cannot resolve $ref in $remote"
        printf '    %-24s %-34s %s\n' "$slug" "$ref" "$sha"
    done
    exit 0
fi
```

(For an annotated tag, `ls-remote` lists the tag object first and `^{}` the commit second; use the commit when present — `git ls-remote "$remote" "refs/tags/$ref^{}"` first, then the plain ref.)

- [ ] **Step 4: Run the test and the syntax check**

Run: `bash hosting-install/tests/resolve_only_test.sh && bash -n hosting-install/install.sh`
Expected: `PASS`, no syntax errors.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add hosting-install/install.sh hosting-install/tests/resolve_only_test.sh
git commit -m "feat(hosting-install): RESOLVE_ONLY prints the ref table without touching the host"
```

---

### Task 2: `deploy.sh upgrade`

**Files:**
- Modify: `deploy.sh` (argument parsing at the top; a new `upgrade` section before the `com-hosting` section; `ssh`/`scp` calls in the `com-hosting` and `com-web` sections go through `$SSH`/`$SCP`)
- Create: `tests/deploy_upgrade_test.sh`

**Interfaces:**
- Consumes: Task 1's `RESOLVE_ONLY=1`.
- Produces:
  - `SSH="${SSH:-ssh}"`, `SCP="${SCP:-scp}"` used for every remote call in `com-hosting`, `com-web` and `upgrade`.
  - `deploy.sh upgrade [--ref R] [--pins scaffold] [--no-web] [--yes]`.
  - Flow: (1) read host config with `$SSH $HOSTING_SSH_TARGET "grep -E '^(MT_BASE_DOMAIN|MT_SUPERUSER_EMAIL)=' /etc/tinycld/hosting.env"`; missing → exit 1 "no /etc/tinycld/hosting.env on <host>: run deploy.sh com-hosting for a first install"; (2) copy the installer (same scp as com-hosting) and run `RESOLVE_ONLY=1 GIT_REF=… REPO_BASE=… MT_HOME=… DOMAIN=… ./install.sh` remotely and show its table; (3) confirm unless `--yes`/`DEPLOY_YES=1`/no TTY; (4) run the existing com-hosting install with `HOSTING_GIT_REF`, `HOSTING_PINS_SOURCE` (`release` unless `--pins scaffold`), `HOSTING_DOMAIN`, `HOSTING_SUPERUSER_EMAIL` taken from step 1; (5) unless `--no-web`, run the existing com-web deploy and `$SSH host systemctl restart tinycld-com`; (6) Task 3's health checks.
  - Refactor `com-hosting` and `com-web` bodies into functions `deploy_com_hosting` and `deploy_web` (behavior unchanged) so `upgrade` calls them instead of re-implementing them. `org-web` keeps working.

- [ ] **Step 1: Write the failing test**

`tests/deploy_upgrade_test.sh` builds a fake bin dir that shadows `ssh`, `scp`, `rsync`, `pnpm` and `curl` with scripts that log their arguments to `$tmp/calls.log` and answer canned output:

```bash
#!/usr/bin/env bash
# deploy.sh upgrade with ssh/scp/rsync/pnpm/curl stubbed: checks the order of
# remote steps, the env forwarded to install.sh, and the flags.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
deploy="$here/../deploy.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/web/com/dist/client"
echo '<html>' > "$tmp/web/com/dist/client/_shell.html"

cat >"$tmp/bin/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >>"$CALLS"
case "$*" in
  *"/etc/tinycld/hosting.env"*) [ "${NO_ENV:-}" = 1 ] && exit 2
     printf 'MT_BASE_DOMAIN=example.test\nMT_SUPERUSER_EMAIL=ops@example.test\n' ;;
  *RESOLVE_ONLY=1*) printf '    repo  ref  commit\n    tinycld  v0.6.1  abcdef12\n' ;;
  *"systemctl is-active"*) [ "${DOWN:-}" = 1 ] && { echo failed; exit 3; }; echo active ;;
  *"journalctl"*) echo "journal line" ;;
  *"org-health"*) echo 200 ;;
esac
exit 0
EOF
for c in scp rsync; do printf '#!/usr/bin/env bash\necho "%s $*" >>"$CALLS"\n' "$c" >"$tmp/bin/$c"; done
printf '#!/usr/bin/env bash\necho "pnpm $*" >>"$CALLS"\n' >"$tmp/bin/pnpm"
printf '#!/usr/bin/env bash\necho "curl $*" >>"$CALLS"\necho 200\n' >"$tmp/bin/curl"
chmod +x "$tmp/bin/"*

run() { CALLS="$tmp/calls.log" PATH="$tmp/bin:$PATH" SITE_REPO="$tmp/web" DEPLOY_YES=1 bash "$deploy" "$@" </dev/null; }

: >"$tmp/calls.log"; run upgrade --yes
grep -q 'RESOLVE_ONLY=1' "$tmp/calls.log"            || { echo "FAIL: no resolve table"; exit 1; }
grep -q "GIT_REF=':latest-tag'" "$tmp/calls.log"     || { echo "FAIL: default ref not :latest-tag"; exit 1; }
grep -q "PINS_SOURCE='release'" "$tmp/calls.log"     || { echo "FAIL: default pins not release"; exit 1; }
grep -q "DOMAIN='example.test'" "$tmp/calls.log"     || { echo "FAIL: domain not read from host"; exit 1; }
grep -q "SUPERUSER_EMAIL='ops@example.test'" "$tmp/calls.log" || { echo "FAIL: email not read from host"; exit 1; }
grep -q '^rsync ' "$tmp/calls.log"                   || { echo "FAIL: web not deployed"; exit 1; }
grep -q 'systemctl restart tinycld-com' "$tmp/calls.log" || { echo "FAIL: tinycld-com not restarted"; exit 1; }
[ "$(grep -n 'RESOLVE_ONLY=1' "$tmp/calls.log" | cut -d: -f1)" -lt "$(grep -n './install.sh' "$tmp/calls.log" | grep -v RESOLVE | head -1 | cut -d: -f1)" ] \
  || { echo "FAIL: resolve must run before the install"; exit 1; }

: >"$tmp/calls.log"; run upgrade --yes --no-web --ref feat/x --pins scaffold
grep -q "GIT_REF='feat/x'" "$tmp/calls.log"          || { echo "FAIL: --ref"; exit 1; }
grep -q "PINS_SOURCE='scaffold'" "$tmp/calls.log"    || { echo "FAIL: --pins"; exit 1; }
! grep -q '^rsync ' "$tmp/calls.log"                 || { echo "FAIL: --no-web still deployed web"; exit 1; }

: >"$tmp/calls.log"
if NO_ENV=1 run upgrade --yes 2>"$tmp/err"; then echo "FAIL: missing hosting.env must fail"; exit 1; fi
grep -q 'deploy.sh com-hosting' "$tmp/err"           || { echo "FAIL: missing env message"; exit 1; }
! grep -q './install.sh' "$tmp/calls.log"            || { echo "FAIL: installed without host config"; exit 1; }

echo PASS
```

(Health-check assertions are added in Task 3; for this task the health-check step may be a stub that returns 0, but the call must exist as `upgrade_health_checks`.)

- [ ] **Step 2: Run to verify it fails**

Run: `bash tests/deploy_upgrade_test.sh`
Expected: FAIL ("Unknown argument: upgrade").

- [ ] **Step 3: Implement**

- Parse `upgrade` as a target, and `--ref <v>`, `--pins <v>` (only `scaffold` or `release` accepted), `--no-web`, `--yes` (sets `DEPLOY_YES=1`) as flags valid only with `upgrade` (error otherwise). Update the usage comment block and the `--help` line range.
- Introduce `SSH`/`SCP` and route every `ssh`/`scp` in the hosting and web sections through them (keep `-A` for the install call).
- Extract `deploy_com_hosting` and `deploy_web <target>` functions from the existing sections without behavior change; the old targets call them.
- Implement the `upgrade` flow from Interfaces. Use `HOSTING_SSH_TARGET` (default `root@tinycld.com`) for every host call, and the same `MT_HOME`/`HOSTING_MT_HOME` forwarding as com-hosting. Print each step as `[deploy] upgrade: <step>`.
- `upgrade_health_checks` is a function stub that returns 0 (Task 3 fills it in).

- [ ] **Step 4: Run tests**

Run: `bash tests/deploy_upgrade_test.sh && bash -n deploy.sh`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add deploy.sh tests/deploy_upgrade_test.sh
git commit -m "feat(deploy): upgrade target for the hosting router and tinycld.com"
```

---

### Task 3: Health checks and docs

**Files:**
- Modify: `deploy.sh` (`upgrade_health_checks`)
- Modify: `tests/deploy_upgrade_test.sh` (health assertions)
- Modify: `hosting-install/README.md` ("Upgrading" section; replace "re-running is also the upgrade path" with a pointer to it)

**Interfaces:**
- Produces: `upgrade_health_checks <domain> <with_web>` returns 0 when all checks pass; otherwise prints `[deploy] upgrade: health check failed: <what>`, the last 50 journal lines of the relevant service (`$SSH host "journalctl -u <unit> -n 50 --no-pager"`), and returns 1 (the upgrade exits non-zero).

- [ ] **Step 1: Add failing assertions to the test**

Append to `tests/deploy_upgrade_test.sh` before `echo PASS`:

```bash
: >"$tmp/calls.log"; run upgrade --yes
grep -q 'systemctl is-active tinycld-hosting' "$tmp/calls.log"   || { echo "FAIL: no is-active check"; exit 1; }
grep -q 'https://admin.example.test/api/health' "$tmp/calls.log" || { echo "FAIL: no admin health check"; exit 1; }
grep -q 'https://example.test/' "$tmp/calls.log"                 || { echo "FAIL: no apex check"; exit 1; }
grep -q 'org-health' "$tmp/calls.log"                            || { echo "FAIL: no org health check"; exit 1; }

: >"$tmp/calls.log"
if DOWN=1 run upgrade --yes >"$tmp/out" 2>&1; then echo "FAIL: a down service must fail the upgrade"; exit 1; fi
grep -q 'journal line' "$tmp/out"                                || { echo "FAIL: journal not printed"; exit 1; }

: >"$tmp/calls.log"; run upgrade --yes --no-web
! grep -q 'https://example.test/' "$tmp/calls.log"               || { echo "FAIL: --no-web still checked the apex"; exit 1; }
```

Run: `bash tests/deploy_upgrade_test.sh` → FAIL ("no is-active check").

- [ ] **Step 2: Implement `upgrade_health_checks`**

```bash
# upgrade_health_checks DOMAIN WITH_WEB — the router, the site and one org must
# all answer after an upgrade; anything else is a failed upgrade, reported with
# the failing service's recent journal.
upgrade_health_checks() {
    local domain="$1" with_web="$2" units="tinycld-hosting" code
    [ "$with_web" = 1 ] && units="tinycld-hosting tinycld-com"
    for u in $units; do
        if ! $SSH "$HOSTING_SSH_TARGET" "systemctl is-active $u" >/dev/null; then
            echo "[deploy] upgrade: health check failed: $u is not active" >&2
            $SSH "$HOSTING_SSH_TARGET" "journalctl -u $u -n 50 --no-pager" >&2 || true
            return 1
        fi
    done
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://admin.$domain/api/health")"
    if [ "$code" != 200 ]; then
        echo "[deploy] upgrade: health check failed: admin.$domain/api/health returned $code" >&2
        $SSH "$HOSTING_SSH_TARGET" "journalctl -u tinycld-hosting -n 50 --no-pager" >&2 || true
        return 1
    fi
    if [ "$with_web" = 1 ]; then
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$domain/")"
        if [ "$code" != 200 ]; then
            echo "[deploy] upgrade: health check failed: $domain returned $code" >&2
            $SSH "$HOSTING_SSH_TARGET" "journalctl -u tinycld-com -n 50 --no-pager" >&2 || true
            return 1
        fi
    fi
    # One org, checked ON the host: it needs the superuser credentials, which
    # never leave hosting.env. The marker word lets the test stub recognise it.
    code="$($SSH "$HOSTING_SSH_TARGET" 'bash -s' <<'REMOTE'
# org-health
set -a; . /etc/tinycld/hosting.env; set +a
tok=$(curl -fsS -X POST "https://admin.$MT_BASE_DOMAIN/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg i "$MT_SUPERUSER_EMAIL" --arg p "$MT_SUPERUSER_PASSWORD" '{identity:$i,password:$p}')" | jq -r .token)
slug=$(curl -fsS -H "Authorization: $tok" \
  "https://admin.$MT_BASE_DOMAIN/api/collections/orgs/records?filter=(status%3D'active')&perPage=1&fields=slug" | jq -r '.items[0].slug // empty')
[ -n "$slug" ] || { echo none; exit 0; }
for i in $(seq 1 18); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$slug.$MT_BASE_DOMAIN/api/health")
  [ "$c" = 200 ] && { echo 200; exit 0; }
  sleep 5
done
echo "$c"
REMOTE
)"
    case "$code" in
        200|none) ;;
        *) echo "[deploy] upgrade: health check failed: org health returned $code" >&2
           $SSH "$HOSTING_SSH_TARGET" "journalctl -u tinycld-hosting -n 50 --no-pager" >&2 || true
           return 1 ;;
    esac
    [ "$code" = none ] && echo "[deploy] upgrade: no active org to check; skipped the org check"
    echo "[deploy] upgrade: all health checks passed"
}
```

The stub `ssh` in the test sees the heredoc on stdin, not in `$*`; make the stub read stdin when its args are `bash -s` and answer `200` when the script contains `org-health` (adjust the stub accordingly — keep it a stub, never a real network call). The password is read and used only on the host; it is never echoed or logged.

- [ ] **Step 3: Docs**

In `hosting-install/README.md`, replace "`install.sh` is idempotent — re-running is also the upgrade path." with "`install.sh` is idempotent. To upgrade a running host, see [Upgrading](#upgrading)." and add:

```markdown
## Upgrading

From your machine, in a `utils` checkout:

    ./deploy.sh upgrade

It reads the domain and the superuser email from the host's
`/etc/tinycld/hosting.env`, prints the ref each repo resolves to, and asks
before it changes anything. Then it runs `install.sh` on the host, deploys the
tinycld.com site, restarts `tinycld-com`, and checks that the router, the site
and one org answer. A failed check exits non-zero and prints the service's
recent journal.

| Option | Default | |
|---|---|---|
| `--ref <ref>` | `:latest-tag` | each repo's newest `vX.Y.Z` tag; or a branch/tag name |
| `--pins scaffold` | release pins | use with a branch ref |
| `--no-web` | site deployed | skip the site, its restart and its checks |
| `--yes` | prompt | do not ask before installing |

`install.sh` restarts the router, so every org does a cold start on its next
request.

To see what an upgrade would deploy without changing the host:

    RESOLVE_ONLY=1 DOMAIN=… ./install.sh
```

- [ ] **Step 4: Run tests**

Run: `bash tests/deploy_upgrade_test.sh && bash hosting-install/tests/resolve_only_test.sh && bash -n deploy.sh hosting-install/install.sh`
Expected: `PASS`, `PASS`.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add deploy.sh tests/deploy_upgrade_test.sh hosting-install/README.md
git commit -m "feat(deploy): health checks after an upgrade; document deploy.sh upgrade"
```
