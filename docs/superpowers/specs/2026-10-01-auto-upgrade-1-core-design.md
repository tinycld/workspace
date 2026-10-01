# Auto-upgrade 1: core flag, window, and local scheduler

Part 1 of 4. Order: **1 core (this) → 2 hosted rollout → 3 deploy command → 4 zero-downtime restarts.**

## Goal

An org owner can set "Automatically upgrade packages when new versions are available" on Settings → Packages. A single-tenant install then upgrades itself in a maintenance window. A composing server (a supervisor) can replace the scheduler and control the cadence. Core does not know what the supervisor is.

## Non-goals

- The hosted rollout (part 2).
- Zero-downtime restarts (part 4). Until part 4, an upgrade restarts the process as the manual version change does today.
- Auto-upgrade for a single-binary build. It cannot rebuild itself (`Options.supportsSelfRebuild()` is false).

## Storage

`system_settings` keys:

| Key | Value | Owner |
|---|---|---|
| `autoupgrade.enabled` | `true` / `false` (default `false`) | org owner |
| `autoupgrade.window` | `HH:MM-HH:MM` in server time (default `02:00-05:00`) | org owner, unless managed |

A supervisor claims the prefix `autoupgrade.window.` through `syscfg.ManagedPrefixes`. Core then refuses writes to the window key and hides its editor. The `enabled` key is never managed: the owner always decides.

New collection `autoupgrade_state` (owner-only rules). It holds at most one `pause` row, and one `blocked` row for each blocked set:

| Field | Type | Meaning |
|---|---|---|
| `kind` | select `pause` / `blocked` | a conflict pause, or a set that was rolled back |
| `fingerprint` | text | hash of the target set plus the conflict reasons |
| `target` | json | `{slug: version}` |
| `reason` | text | human-readable detail (conflicting packages and their `peerVersions` ranges, or the rollback reason) |
| `first_seen` | date | |
| `last_notified` | date | |
| `cleared` | bool | set by the owner's "Clear" on a blocked set |

## Seam: `autoupgrade.Delegate`

New core package `core/server/autoupgrade` (no import of `coreserver`, same reason as `syscfg`):

```go
type Delegate interface {
    // Called when the owner changes the flag, and once at boot.
    PolicyChanged(ctx context.Context, enabled bool) error
    // Feeds the Packages page.
    Status(ctx context.Context) (Status, error)
}

type Status struct {
    Available  bool      // false => the switch is disabled
    Reason     string    // why it is not available
    LastRun    time.Time
    LastResult string    // "upgraded", "no updates", "paused: conflict", "rolled back"
    NextCheck  time.Time
    Pause      *Pause    // current conflict pause, if any
    Blocked    []Blocked // version sets that will not be tried again
}

func SetDelegate(d Delegate)
```

- `coreserver.Register` installs the **local scheduler** as the delegate when `supportsSelfRebuild()` is true. This goes in the "Host-only registrations" tail of `server.go`, with an entry in the `hostOnlyHookDiff` allowlist.
- With no delegate, `Status` returns `Available: false` with a reason ("This build cannot upgrade itself").
- A composing server calls `SetDelegate` with its own implementation. Part 2 does this in `tenantboot`.

## Local scheduler

The scheduler ticks every hour. It acts only when `autoupgrade.enabled` is true, the current time is inside `autoupgrade.window`, and no install job runs.

1. **Discover.** Call `versionInfosForRows` over `pkg_registry`. The target is the newest version of each package that has `hasUpdate`, majors included.
2. **Solve.** Run the compat solver (`pkg_compat.go`) on the full target set.
   - If the set does not resolve, remove the major upgrades and solve again.
   - If it still does not resolve: skip the run and record a `pause` row. See "Notifications".
   - If a later run resolves, delete the `pause` row.
3. **Filter.** Remove any set whose fingerprint matches a `blocked` row that is not `cleared`. If nothing is left, stop.
4. **Apply.** Use the existing version-change path: claim the install job, `runVersionChangeRebuild`, then `requestRestart` (exit 75). The entrypoint health probe commits the change or rolls it back. The job is tagged `trigger: auto` so that Build History shows it.
5. **Result.** At the next boot, read the result of the job. If it was rolled back, write a `blocked` row and notify.

## Notifications

Recipients: the users with role `owner` or `admin`. Email goes through `coremailer.RenderTransactionalEmail` and `app.NewMailClient()`.

The gate, for both `pause` and `blocked`:

- Send when a row is created, or when its fingerprint changes.
- Send one reminder when `last_notified` is 7 days old and the row still applies.
- Never send more than this. An hourly tick that finds the same state sends nothing.

The pause email lists each conflicting package, its target version, and the `peerVersions` range that rejects it. The blocked email names the set and the rollback reason.

## API

Owner-only (`RequireOwner`), under `/api/admin/packages/auto-upgrade`:

| Method | Path | |
|---|---|---|
| `GET` | `` | `{enabled, window, windowManaged, status}` |
| `PUT` | `` | `{enabled, window?}`. Writes `system_settings` and calls `PolicyChanged`. A `window` while managed is a 400. |
| `POST` | `/blocked/{id}/clear` | sets `cleared` so the set can be tried again |

## UI

`PackageManager.tsx` gets an `AutoUpgradeSection` above the package list:

- The switch "Automatically upgrade packages when new versions are available". Disabled with `status.reason` when `available` is false.
- The window editor, hidden when `windowManaged`.
- The status line: last result, next check.
- The pause, with its conflict detail.
- The blocked sets, each with a "Clear" button.

Data comes from the endpoint above through `useMutation` / a query hook in the same style as `use-package-versions.ts`.

## Help

Update `core/help/package-versions.md` with a section on auto-upgrade: what the switch does, the window, what a pause and a blocked set mean, and how to clear one. The text must not mention a supervisor or hosting.

## Testing

- Unit: target selection (newest, majors included), the remove-majors retry, the block filter, and the notification gate (create, fingerprint change, 7-day reminder, no repeat). Fake clock and fake discovery.
- Go integration: the local scheduler on a fixture workspace, up to the `requestRestart` call. A rolled-back job writes `blocked` and sends one email (mailer capture).
- Endpoint: owner-only, managed window refused.
- Playwright: the section on the Packages page with the local delegate and with a fake delegate that reports `windowManaged` and `available: false`.
