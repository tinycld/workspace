# Auto-upgrade 2: hosted staggered rollout

Part 2 of 4. Depends on part 1 (`autoupgrade.Delegate`). Repos: `hosting`, `utils` (installer SMTP settings).

## Goal

The router upgrades every org that has auto-upgrade on. It does this in rings, starting with a few sentinel orgs. It watches each upgraded org for errors and halts the rollout when one occurs. It reverts automatically only when the new build does not boot. For every other error, it halts and sends email to the hosting operators.

## Tenant side (`tenantboot`)

`tenantboot` installs its own `autoupgrade.Delegate`:

- `PolicyChanged(enabled)` sends `POST /api/v1/auto-upgrade {enabled}` over `ctl.sock`. The router stores it in `orgs.auto_upgrade`. The tenant sends it again at each boot, so the tenant DB is authoritative.
- `Status()` reads `GET /api/v1/auto-upgrade` over `ctl.sock`: last and next upgrade for this org, its rollout state, and the blocked sets that apply to it.
- The tenant syscfg provider claims `autoupgrade.window.`. The operator owns the window.

`tenantboot` also sets the Sentry scope tags `org=<slug>` and `release=<recipe_hash>` on every event. This is hosting code. Core does not change.

## Router data

New fields on `orgs`:

| Field | Type | |
|---|---|---|
| `auto_upgrade` | bool | from the tenant |
| `rollout_ring` | select `sentinel` / empty | set by the operator |

New collections (superuser only):

**`rollouts`**: one row per target. A target is the set of `slug@version` that is new in a release, for example `{mail@0.6.0, tinycld@0.5.4}`.

| Field | |
|---|---|
| `packages` | json `{slug: version}` |
| `major` | bool: any package changes major version |
| `state` | `active` / `halted` / `done` / `abandoned` / `superseded` |
| `ring` | 0–3 |
| `ring_started` | date |
| `halt_reason` | text |

**`rollout_orgs`**

| Field | |
|---|---|
| `rollout`, `org` | relations |
| `ring` | 0–3 |
| `from_lockfile`, `to_lockfile` | json |
| `state` | `pending` / `deploying` / `soaking` / `passed` / `reverted` / `flagged` |
| `deployed_at` | date |
| `baseline` | json: 7-day 5xx ratio and Sentry event rate before the deploy |
| `snapshot_dir` | text |

**`rollout_blocks`**: target fingerprints that no rollout may use until the operator deletes the row.

**`operator_alerts`**: `kind`, `fingerprint`, `subject`, `detail`, `first_seen`, `last_notified`, `resolved`.

**`org_traffic`**: hourly totals for each org: `org`, `hour`, `requests`, `status_5xx`. Rows older than 30 days are deleted by the hourly sweep.

## Discovery (hourly)

The loop uses the same `go` + ticker + `ctx.Done()` pattern as `sweepBuilds` in `cmd/serve-router/main.go`.

1. Run `git fetch --tags` (confined, as the builder runs git) on each `git+file` clone under `$MT_HOME`. npm specs need no fetch.
2. For each `active` org with `auto_upgrade`:
   - Find the newest versions for its lockfile with `builder.VersionsForSpec`, majors included.
   - Run the compat solver. If the set does not resolve, remove the majors and solve again.
   - If it still does not resolve: write an `operator_alerts` row with `kind = pause` (gated, see "Alerts"). The org gets no email.
   - Pin each spec with `SpecForVersion` (`#vX.Y.Z` for git).
3. Group the orgs by the set of new `slug@version`. If no `rollouts` row for that target exists and its fingerprint is not in `rollout_blocks`, create one with `ring = 0` and add a `rollout_orgs` row for each org.

**Supersede.** A new target that has a newer version of a package in an `active` rollout supersedes it. The old rollout's `pending` orgs move to the new rollout. The old rollout ends `superseded`. Orgs that already deployed stay where they are, and the new rollout includes them for the newer version. The new rollout starts at ring 0.

## Rings

| Ring | Orgs | Soak (minor/patch) | Soak (major) |
|---|---|---|---|
| 0 | `rollout_ring = sentinel` | 3 days | 7 days |
| 1 | random sample of the rest: 5%, min 1, max 5 | 2 days | 5 days |
| 2 | 25% of the rest | 1 day | 3 days |
| 3 | all remaining orgs | — | — |

- Each soak can be set with `MT_ROLLOUT_SOAK_R{0,1,2}_{MINOR,MAJOR}` (Go durations).
- A ring with no orgs is skipped.
- A ring starts deploying only inside `MT_UPGRADE_WINDOW` (default `02:00-05:00`, server time). Deploys that do not fit in one window continue in the next one. Build concurrency is still limited by `MT_BUILDER_MAX_CONCURRENT`.
- The soak runs all day, so daytime traffic counts.
- The next ring starts when every org in the current ring is `passed` and the soak has ended.

## Deploy for each org

1. **Snapshot while the tenant serves.** Call `snapshot.VacuumReadOnly` for each `pb_data/*.db` into `<org>/.deploy/upgrade-snapshot/<rollout-id>/`.
2. **Deploy.** Call `Deployer.Deploy(slug, to_lockfile)`. It builds, repoints and respawns the tenant. The up migrations run at boot.
3. **Boot failure** (no readiness in `tenantVerifyTimeout`, or a crash before readiness):
   - restore the snapshot, repoint the previous build, respawn
   - set `rollout_orgs.state = reverted`
   - set the rollout to `halted`, add its fingerprint to `rollout_blocks`, and send an alert.
4. **Success:** set `state = soaking` and `deployed_at`.

Writes between the snapshot and the restart are lost if step 3 restores the snapshot. That window is seconds long. A restart for each deploy cannot be avoided until part 4.

Snapshots are deleted 7 days after their rollout is `done`, `abandoned` or `superseded`.

## Error signals during the soak

Each signal is compared with `rollout_orgs.baseline`, which is taken from the 7 days before the deploy.

| Signal | Source | Flag when |
|---|---|---|
| Crash | orgmanager `crashState` | any crash or restart during the soak |
| 5xx rate | `org_traffic`, counted in the front router proxy | soak ratio > `max(2 × baseline, baseline + 0.5%)` and ≥ 200 requests in the soak |
| Sentry | Sentry API, filtered by `org` and `release` tags | any new issue that first appears on the new release, or the event rate > 2 × baseline |

- An org with fewer than 200 requests in the soak uses only the crash and Sentry signals.
- The Sentry signal needs `MT_SENTRY_API_TOKEN`, `MT_SENTRY_ORG` and `MT_SENTRY_PROJECT`, all scrubbed from the environment once read. If they are not set, the router logs one warning at boot and skips this signal.
- The check runs every 15 minutes during a soak.

**If a signal fires:** set `state = flagged`, set the rollout to `halted` with the reason, and send an alert. The org stays on the new version. It is not rolled back automatically.

## Alerts

Each alert:

1. writes or updates an `operator_alerts` row,
2. sends email to every control-plane superuser through the control plane's PocketBase SMTP settings, with the `coremailer` templates,
3. logs with `logging.ForPackage("hosting")` at error level, which also reaches Sentry.

The gate is the same as in part 1: send on a new row or a changed fingerprint, one reminder after 7 days, never otherwise. A halt is a new fingerprint each time.

The installer writes the control-plane SMTP settings from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Without them, the router logs a boot warning that alerts are log-only.

Later, the DR staleness alarm can use the same path. That change is not part of this spec.

## Operator API

Superuser only, on the control plane:

| Method | Path | |
|---|---|---|
| `GET` | `/api/rollouts` | list, newest first |
| `GET` | `/api/rollouts/{id}` | rollout + its `rollout_orgs` |
| `POST` | `/api/rollouts/{id}/resume` | `halted` → `active`. Flagged orgs stay on the new version. |
| `POST` | `/api/rollouts/{id}/advance` | ends the current soak early |
| `POST` | `/api/rollouts/{id}/abandon` | ends the rollout and adds its fingerprint to `rollout_blocks` |
| `POST` | `/api/orgs/{slug}/rollback` | restores the upgrade snapshot and the previous build. The response warns that writes after the deploy are lost. |
| `DELETE` | `/api/rollout-blocks/{id}` | allows the target again |
| `PATCH` | `/api/orgs/{slug}/rollout-ring` | `{ring: "sentinel" \| ""}` |

## README

Add a "Automatic upgrades" section to `hosting/README.md`: the rings, the soak times, the signals, the alerts, the operator API, and the new `MT_*` variables. Add the variables to the env table.

## Testing

- Unit: ring selection (empty rings skipped, the sample bounds), supersede, the window gate, the baseline comparisons (with too few requests), and the alert gate.
- Integration, with real tenant processes from `internal/testsupport` and the soak times set to seconds:
  - a good upgrade passes all rings and ends `done`
  - a build that does not boot is reverted, the rollout halts, the target is blocked, and one email is sent (`testsupport` mailbox capture)
  - 5xx injected during the soak flags the org, halts the rollout, and the org stays on the new build
  - a crash during the soak flags the org
- The Sentry signal against a fake HTTP server.
- The `ctl.sock` auto-upgrade endpoints: the flag reaches `orgs.auto_upgrade`, and the tenant sends it again at boot.
