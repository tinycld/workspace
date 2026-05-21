#!/bin/sh
set -e

HEALTH_PORT=19876

echo "[entrypoint] starting; pwd=$(pwd) user=$(id -un) uid=$(id -u)"

# Promote the staged release to /app/releases/. Runs on every container
# start; idempotent.
#
# /app/releases is typically the container's writable layer (compose-style
# deploys) and starts empty on every fresh container; Dokku-style deploys
# may back it with a persistent volume so old releases survive container
# replacement. Either way the promote logic below is the same: copy the
# staged tree off the image, swap the `current` symlink atomically.
#
# Layout produced under /app/releases/:
#   <id>/             per-release dir: app.html + release-id.txt
#   _static/          cross-release asset pool:
#     _expo/static/...    (content-hashed, immutable)
#     assets/...           (mostly hashed; a few stable names like
#                           app-icon.png get overwritten per deploy)
#   current → <id>    SPA fallback reads <current>/app.html
#
# Why a pool: asset filenames are content-hashed, so files from different
# releases coexist without collision. Stale tabs that dynamic-import a
# chunk see their hashed filename in the pool until a future prune wipes
# old entries. The Go server serves /_expo/static/ and /assets/ from
# _static/ directly — there is no per-request release lookup.
promote_release() {
    staging_dir=/app/release-staging
    releases_dir=/app/releases
    pool_dir="$releases_dir/_static"

    echo "[entrypoint] promote_release: staging=$staging_dir releases=$releases_dir"
    echo "[entrypoint] staging contents:"
    ls -la "$staging_dir" 2>&1 | sed 's/^/[entrypoint]   /' || true
    echo "[entrypoint] releases dir contents (before):"
    ls -la "$releases_dir" 2>&1 | sed 's/^/[entrypoint]   /' || true

    [ -d "$staging_dir" ] || {
        echo "[entrypoint] WARN: $staging_dir missing; skipping release promotion (SPA fallback will 404)"
        return 0
    }

    mkdir -p "$releases_dir" "$pool_dir/_expo/static" "$pool_dir/assets"

    release_id=""
    for d in "$staging_dir"/*/; do
        [ -d "$d" ] || continue
        if [ -f "$d/release-id.txt" ]; then
            release_id=$(cat "$d/release-id.txt")
            echo "[entrypoint] found release-id.txt in $d -> '$release_id'"
            break
        else
            echo "[entrypoint] WARN: $d has no release-id.txt"
        fi
    done

    if [ -z "$release_id" ]; then
        echo "[entrypoint] ERROR: no release-id.txt found under $staging_dir; aborting"
        exit 1
    fi

    src="$staging_dir/$release_id"
    dst="$releases_dir/$release_id"

    # Merge this release's asset trees into the cross-release pool.
    # cp -a (no -n) is used deliberately: same hashed filename = same
    # content, so re-copying is a no-op in effect; for the handful of
    # unhashed names under assets/ (app-icon.png, app-splash.png), the
    # current release's copy wins, which is the desired behavior. The
    # whole tree is a few MB so the redundant rewrites cost nothing.
    if [ -d "$src/_expo/static" ]; then
        echo "[entrypoint] merging _expo/static into pool"
        cp -a "$src/_expo/static/." "$pool_dir/_expo/static/"
    fi
    if [ -d "$src/assets" ]; then
        echo "[entrypoint] merging assets into pool"
        cp -a "$src/assets/." "$pool_dir/assets/"
    fi

    # Treat a previously-promoted dst as valid only if it has app.html.
    # If a prior boot left a half-promoted tree (interrupted copy, etc.),
    # the [ -d "$dst" ] check below would skip and reuse the corrupt
    # tree; this guard wipes it so the next attempt re-promotes cleanly.
    if [ -d "$dst" ] && [ ! -f "$dst/app.html" ]; then
        echo "[entrypoint] WARN: $dst exists but app.html is missing; clearing for re-promote"
        rm -rf "$dst"
    fi

    if [ ! -d "$dst" ]; then
        echo "[entrypoint] promoting release $release_id ($src -> $dst, app.html + release-id.txt only)"
        rm -rf "$dst.tmp"
        mkdir "$dst.tmp"
        cp -a "$src/app.html" "$dst.tmp/"
        cp -a "$src/release-id.txt" "$dst.tmp/"
        mv "$dst.tmp" "$dst"
        echo "[entrypoint] promotion complete; size=$(du -sh "$dst" 2>/dev/null | cut -f1)"
    else
        echo "[entrypoint] release $release_id already on volume; skipping per-release copy"
    fi

    # Atomic symlink swap: write to current.tmp, then mv -T over current.
    ln -sfn "$release_id" "$releases_dir/current.tmp"
    mv -T "$releases_dir/current.tmp" "$releases_dir/current"
    echo "[entrypoint] current -> $(readlink "$releases_dir/current")"

    if [ -f "$releases_dir/current/app.html" ]; then
        echo "[entrypoint] app.html present ($(wc -c < "$releases_dir/current/app.html") bytes)"
    else
        echo "[entrypoint] ERROR: $releases_dir/current/app.html missing — SPA fallback will 404"
        ls -la "$releases_dir/current/" 2>&1 | sed 's/^/[entrypoint]   /' || true
        exit 1
    fi

    pool_size=$(du -sh "$pool_dir" 2>/dev/null | cut -f1)
    echo "[entrypoint] pool size: $pool_size"
}

promote_release

# Build serve arguments.
#
# Mode 1 — Autocert HTTPS (when SERVE_ON_DOMAINS is set): PocketBase binds
#   :80 (HTTP-01 challenge + redirect) and :443 (HTTPS) directly. These are
#   privileged ports; the binary has `cap_net_bind_service` set at build
#   time so the unprivileged runtime user can still bind them.
#
# Mode 2 — Plain HTTP (when SERVE_ON_DOMAINS is unset): bind an unprivileged
#   port (:7090 by default) and let an upstream reverse proxy or Docker
#   port-mapping handle TLS termination and ingress routing. Override with
#   HTTP_ADDR for a custom bind (e.g. dev sidecar on a different port).
#
# Strip surrounding whitespace and treat the result as unset if empty —
# users frequently leave `SERVE_ON_DOMAINS:` set to "" or "   " in compose
# YAML to "disable" autocert, and a whitespace-only value would otherwise
# fall into the autocert branch and fail.
DOMAINS_TRIMMED=$(printf '%s' "${SERVE_ON_DOMAINS:-}" | awk '{$1=$1};1')
if [ -n "$DOMAINS_TRIMMED" ]; then
    # Sanity-check each token looks like a domain. Requires at least one
    # dot (rules out "yes", "true", "lolnope" and other shell-truthy-but-
    # bogus values), no leading/trailing dot or hyphen, and only domain-
    # legal characters. Catches misconfigurations before PocketBase
    # autocert fails them at a less-obvious layer.
    for dom in $DOMAINS_TRIMMED; do
        case "$dom" in
            *[!A-Za-z0-9.-]*|.*|*.|-*|*-)
                echo "[entrypoint] ERROR: SERVE_ON_DOMAINS contains invalid token: '$dom'" >&2
                echo "[entrypoint] Expected a space-separated list of domain names (e.g. 'tinycld.example.com www.tinycld.example.com')." >&2
                echo "[entrypoint] Leave SERVE_ON_DOMAINS empty/unset to serve plain HTTP on :7090." >&2
                exit 1
                ;;
        esac
        case "$dom" in
            *.*) ;;
            *)
                echo "[entrypoint] ERROR: SERVE_ON_DOMAINS token has no dot, doesn't look like a domain: '$dom'" >&2
                echo "[entrypoint] Expected a space-separated list of domain names (e.g. 'tinycld.example.com www.tinycld.example.com')." >&2
                echo "[entrypoint] Leave SERVE_ON_DOMAINS empty/unset to serve plain HTTP on :7090." >&2
                exit 1
                ;;
        esac
    done
    echo "[entrypoint] Running with autocert HTTPS on: $DOMAINS_TRIMMED"
    # shellcheck disable=SC2086 # intentional word-split on the domain list
    set -- $DOMAINS_TRIMMED --http --https
else
    HTTP_ADDR="${HTTP_ADDR:-0.0.0.0:7090}"
    echo "[entrypoint] No SERVE_ON_DOMAINS set; serving plain HTTP on $HTTP_ADDR (map a host port to this with -p / compose ports)"
    set -- "--http=$HTTP_ADDR"
fi

# Restart loop: exit code 75 signals a package install restart request.
# Serve args are in $@ (positional params) so a multi-word
# SERVE_ON_DOMAINS list survives without re-splitting.
while true; do
    ./tinycld serve "$@"
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 75 ]; then
        echo "[entrypoint] Restart requested (exit code 75)"

        # Health check: start new binary on a temp port, verify /api/health responds
        ./tinycld serve --http=127.0.0.1:${HEALTH_PORT} &
        HEALTH_PID=$!

        HEALTHY=false
        for i in 1 2 3 4 5 6 7 8 9 10; do
            if curl -sf http://127.0.0.1:${HEALTH_PORT}/api/health >/dev/null 2>&1; then
                HEALTHY=true
                break
            fi
            sleep 1
        done

        kill $HEALTH_PID 2>/dev/null
        wait $HEALTH_PID 2>/dev/null || true

        if [ "$HEALTHY" = "true" ]; then
            echo "[entrypoint] Health check passed, restarting server"
            continue
        else
            echo "[entrypoint] Health check failed, attempting rollback"
            if [ -f ./tinycld.prev ]; then
                mv ./tinycld ./tinycld.failed
                mv ./tinycld.prev ./tinycld
                echo "[entrypoint] Rolled back to previous binary"
            fi
            continue
        fi
    fi

    # Normal exit (not a restart request)
    echo "[entrypoint] Server exited with code $EXIT_CODE"
    exit $EXIT_CODE
done
