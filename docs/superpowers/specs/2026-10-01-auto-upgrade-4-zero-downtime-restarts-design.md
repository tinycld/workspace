# Auto-upgrade 4: zero-downtime restarts

Part 4 of 4. Repos: `hosting` (D1, D2), `tinycld` (D3 and the core read-only mode). It makes the restarts in parts 1–3 invisible to users.

## Goal

- **D1:** restart the router onto a new binary without dropping a connection or restarting a tenant.
- **D2:** move a hosted tenant onto a new build without refused requests.
- **D3:** the same for a single-tenant install.

## Shared rule: the write pause

For a short time, two processes use the same SQLite database. The new one runs its up migrations while the old one still serves. To stop the old code from writing against a schema it does not know:

1. The old process enters **read-only mode**.
2. The new process starts, migrates, and passes readiness.
3. Traffic moves to the new process.
4. The old process drains in-flight requests and exits.

Read-only mode is a core feature with no host knowledge:

- `coreserver` adds middleware: while the mode is on, every non-`GET`/`HEAD`/`OPTIONS` request to `/api/` gets `503` with `Retry-After: 2` and a JSON body `{"code": "read_only"}`. Realtime subscriptions stay open.
- Two triggers turn it on: `SIGUSR2`, and an internal call that the D3 supervisor and the D2 router use.
- The client retries a `503 read_only` request after `Retry-After`, up to 3 times, before it shows an error. The retry is in the fetch layer, not in `useMutation`: a refused request never reached a handler, so it is safe to send again, but a multi-step mutation is not safe to run again from the start. Every direct call to the server uses `serverFetch` (`@tinycld/core/lib/server-fetch`). The SDK and pbtsdb get it through `pb.beforeSend`, and the XHR upload helper retries the same way. A biome rule flags a raw `fetch` in runtime code. pbtsdb already reconnects realtime when the old process closes its SSE streams.
- `POST /api/realtime` is let through. It only sets the topics of an open SSE stream, and a client that reconnects during the pause needs it to subscribe again.
- `SIGUSR2` only enters the mode. Only the internal call leaves it, so a stray or repeated signal cannot open writes during a migration.

**Known limits.**

- During step 2 the old process serves reads against a schema that may have changed. A read that touches a renamed or removed column can fail until step 3. The window is the migration time, usually under a few seconds.
- The mode covers HTTP requests to `/api/` only. Writes that do not come from such a request continue during the pause: cron jobs, background workers, notifications, mail sync and delivery, and DAV (CalDAV, CardDAV, WebDAV). This is accepted for now.

If the new process does not pass readiness, the old one leaves read-only mode and keeps serving. If the migrations already ran, the revert path from part 2 (restore the snapshot, then start the old build) still applies.

## D1: router handoff

- The unit changes to `Type=notify`, `KillMode=process`, `NotifyAccess=all`.
- `systemctl reload tinycld-hosting` (`ExecReload` sends `SIGHUP`) starts the handoff. `install.sh` uses reload instead of restart when the unit is already active.
- The old router starts the new binary with:
  - the listener FDs (`:443`, `:80`, `:25`, `:465`, `:993`) through `ExtraFiles`, with their names in `LISTEN_FDNAMES`
  - a handoff file `$MT_ROOT/run/handoff.json`: for each resident tenant, the slug, pid, socket path, recipe hash, cgroup and crash state.
- The new router:
  - builds its listeners from the FDs, not by binding
  - adopts each tenant: `pidfd_open(pid)`, checks that the pid is still in the org's cgroup and its socket answers, then puts it in the `OrgManager` map. Supervision uses the pidfd instead of `cmd.Wait`.
  - a tenant that fails adoption is stopped and spawned again, cold
  - sends `READY=1` and `MAINPID=<own pid>` to systemd.
- The old router stops accepting, drains in-flight HTTP and mail sessions (limit 30 s), closes its pidfds without signals, and exits 0.
- If the new router does not send `READY=1` in 60 s, the old router stops it and keeps serving. `systemctl reload` then fails, and `deploy.sh upgrade` reports it.

Tenants are spawned with no `Pdeathsig`, so they survive the old router.

## D2: hosted tenant swap

`Deployer.finish` changes from "evict, then respawn" to:

1. Put the old tenant in read-only mode (`SIGUSR2`).
2. Spawn the new build beside it on a new socket, `run/<slug>/<slug>.<generation>.sock`.
3. Wait for readiness.
4. Move the `OrgManager` entry to the new process and socket. New requests go to it.
5. Drain and stop the old process.

The org's uid, cgroup and data dir are the same for both processes. The cgroup memory and pids limits must allow two processes for a short time. The implementation plan must measure the peak and raise the limits during the swap if needed.

On a readiness failure: stop the new process, take the old one out of read-only mode, and use the revert path from part 2.

## D3: single-tenant supervisor

The Docker and bare-metal installs restart today through `exit 75` and `config/entrypoint.sh`, which also does the health probe and the rollback. For a handoff, one process must hold the listener while the server processes change. A shell script cannot hold it.

- Add a `supervise` command to the app binary. It becomes the entrypoint (`config/entrypoint.sh` calls `exec tinycld supervise …`; the bare-metal unit runs it directly).
- `supervise` binds the port once, and runs the server as a child with the listener FD.
- When the child signals a restart (an upgrade or a package change), the supervisor:
  1. starts the new child with the same FD. The old child is already read-only: it entered the mode before it signalled the restart, and it stays alive until told to stop.
  2. runs the health probe that `entrypoint.sh` runs today
  3. on success, tells the old child to drain and exit, and commits the backup as today
  4. on failure, stops the new child, restores the backup as today, and takes the old child out of read-only mode.
- `requestRestart` changes: under a supervisor it enters read-only mode and signals the supervisor over an inherited pipe, then waits to be told to drain or to leave read-only mode. A process without a supervisor keeps the old behavior (exit 75 at once).

The rollback logic moves from `entrypoint.sh` into Go, with the same steps and the same files. The entrypoint keeps only the environment setup.

## Testing

- **D1:** a load loop against two orgs during `systemctl reload` sees 0 failed requests and 0 refused connections, and the tenant PIDs do not change. A new binary that never sends `READY=1` leaves the old router serving.
- **D2:** during a swap, a write gets `503 read_only` with `Retry-After`, reads continue, and an open realtime subscription reconnects and gets the next event. A new build that fails readiness leaves the old process serving and writable.
- **D3:** in the bare-metal entrypoint test, a package change under a request loop has 0 refused connections, and a broken build is rolled back with the old child serving throughout.
- **Read-only mode:** unit tests for the middleware (methods, paths, realtime untouched) and for the client retry. Done in plan 4a.
