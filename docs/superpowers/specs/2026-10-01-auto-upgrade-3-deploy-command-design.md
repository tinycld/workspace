# Auto-upgrade 3: `deploy.sh upgrade` for the router and serve-com

Part 3 of 4. Repo: `utils`. It does not depend on parts 1 or 2.

## Goal

One command on the operator's machine upgrades the hosting router and the tinycld.com site, and confirms they are healthy.

## Command

```sh
./deploy.sh upgrade [--ref <ref>] [--pins scaffold] [--no-web] [--yes]
```

| Option | Default | |
|---|---|---|
| `--ref` | `:latest-tag` | passed as `GIT_REF` to `install.sh` |
| `--pins scaffold` | release pins | passed as `PINS_SOURCE=scaffold`. Use it with a branch ref. |
| `--no-web` | build and deploy the site | skip step 4 |
| `--yes` | prompt | skip the confirm in step 2 |

## Steps

1. **Read the host config.** Over `ssh -A $HOSTING_SSH_TARGET`, read `DOMAIN` and `SUPERUSER_EMAIL` from `/etc/tinycld/hosting.env`. The operator does not type them again. A missing file is an error: run `deploy.sh com-hosting` for a first install.
2. **Show the refs and confirm.** Run the ref resolution only (a new `install.sh --resolve-only` mode that prints the repo, ref and commit table and exits). Show the table and ask `y/N`. A wrong ref falls back to `main` without an error, so the operator must see the table first.
3. **Upgrade the router.** Copy the installer and run `install.sh` with the same options, as `com-hosting` does today.
4. **Deploy the site.** Run the existing `com-web` step (build + rsync), then `systemctl restart tinycld-com`.
5. **Health checks.**
   - `systemctl is-active tinycld-hosting tinycld-com`
   - `https://admin.$DOMAIN/api/health` returns 200
   - `https://$DOMAIN/` returns 200
   - one resident org (the first `active` org from `GET /api/orgs`) returns 200

   If a check fails: print the last 50 lines of `journalctl` for the service that failed, and exit with a non-zero code.

Before part 4, step 3 restarts the router with `systemctl restart`, so every tenant does a cold start. After part 4, `install.sh` uses the zero-downtime handoff instead.

## Changes

- `utils/deploy.sh`: the `upgrade` target, which reuses the `com-hosting` and `com-web` functions.
- `utils/hosting-install/install.sh`: `--resolve-only`.
- `utils/hosting-install/README.md`: replace "re-running is also the upgrade path" with a short "Upgrading" section that leads with `deploy.sh upgrade`.

## Testing

- `deploy.sh upgrade --yes` against a test host completes, and all health checks pass.
- A host with a stopped `tinycld-com` makes the command exit non-zero with the journal lines.
- `install.sh --resolve-only` prints the table and changes nothing on the host (`git status` and service state unchanged).
