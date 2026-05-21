# Build pipeline assumes the build context contains:
#   - tinycld/ repo at root
#   - packages/@tinycld/core/ — full core source tree (real directory)
#   - packages/@tinycld/<other>/ — one entry per linked feature package
#
# A fresh `git clone` of the tinycld app shell already satisfies this layout
# (packages/@tinycld/core/ is committed; feature packages can be cloned at
# build time via the LINKED_PACKAGES build arg below). Run `docker build .`
# from the repo root and it just works.

# Node stage: generate package wiring and build the web app
FROM node:22-bookworm-slim AS web-builder

WORKDIR /app

# Install dependencies first (layer caching). --ignore-scripts skips the
# project's `postinstall` (`npm run packages:generate`); the generator needs
# scripts/, lib/, and packages/, none of which are staged yet. We run it
# explicitly below once those are in place.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

# Copy app sources needed for package generation + web build.
COPY scripts/ ./scripts/
COPY server/ ./server/
COPY tinycld.packages.ts ./
COPY app.json tsconfig.json ./
COPY app/ ./app/
COPY lib/ ./lib/
COPY public/ ./public/
COPY global.css ./
COPY react-native.config.cjs metro.config.cjs babel.config.cjs ./

# Copy every bundled sibling package — including @tinycld/core itself.
# The build context (assembled by utils/deploy.sh) contains real directories
# under packages/, one per linked sibling: packages/@scope/name or
# packages/name. Core ships as packages/@tinycld/core/ here.
COPY packages/ ./packages/

# Optional: clone additional feature packages at build time.
#
# LINKED_PACKAGES is a space-separated list of `<git-url>[@<ref>]` entries.
# For each entry the build clones the repo into a temp dir, reads the
# package's name from package.json, and moves the working tree into
# packages/<scoped-name>/ as a real directory (no symlink, no node_modules).
# generate-packages.ts then picks up every linked package alongside core.
#
# Default is empty → lean shell (works as a fallback for `docker build .`
# from a fresh clone). The CI workflow passes a default set of feature
# packages so the public image ships with mail/calendar/contacts/drive/etc.
ARG LINKED_PACKAGES=""
RUN if [ -n "$LINKED_PACKAGES" ]; then \
        apt-get update && apt-get install -y --no-install-recommends git ca-certificates jq && rm -rf /var/lib/apt/lists/* ; \
        set -eu ; \
        for entry in $LINKED_PACKAGES; do \
            url="${entry%@*}" ; \
            ref="" ; \
            case "$entry" in *@*) ref="${entry#*@}" ;; esac ; \
            tmp=$(mktemp -d) ; \
            echo "[build] cloning $url${ref:+ @ $ref}" ; \
            git clone --depth 1 ${ref:+--branch "$ref"} "$url" "$tmp/repo" ; \
            name=$(jq -r '.name' "$tmp/repo/package.json") ; \
            [ -n "$name" ] && [ "$name" != "null" ] || { echo "no .name in $url package.json" >&2; exit 1; } ; \
            target="packages/$name" ; \
            mkdir -p "$(dirname "$target")" ; \
            rm -rf "$target" ; \
            mv "$tmp/repo" "$target" ; \
            rm -rf "$target/.git" "$target/node_modules" "$target/pnpm-lock.yaml" "$target/package-lock.json" ; \
            echo "[build] linked $name → $target" ; \
        done ; \
    fi

# Generate package wiring (produces server/package_extensions.go,
# lib/generated/, app/a/[orgSlug]/<slug>/ routes, public route re-exports,
# server/pb_migrations/ symlinks, and updates server/go.mod replace
# directives).
RUN npx tsx scripts/generate-packages.ts

# Resolve any migration/hook symlinks into real files. generate-packages.ts
# symlinks package migrations into server/pb_migrations/, which is fine
# here (packages/ is real files in this build), but later COPY steps need
# real content, so materialize them in place.
RUN find server/pb_migrations server/pb_hooks -type l -exec sh -c 'target=$(readlink "$1") && rm "$1" && cp "$target" "$1"' _ {} \; 2>/dev/null || true

# Stage a tree containing only Go module manifests (go.mod / go.sum / go.work),
# with directory structure preserved. The go-builder stage copies just this
# tree to warm its module cache, so `go mod download` only re-runs when one
# of these files changes — independent of any Go source edits. go.work is
# generator output (gitignored locally, but real in the build context); it
# wires linked sibling Go modules into the app server's workspace and must
# travel with the manifests. tar with --files-from preserves relative paths.
RUN mkdir -p /app/go-mod-staging \
    && cd /app \
    && find server packages \( -name go.mod -o -name go.sum -o -name go.work -o -name go.work.sum \) -print0 \
        | tar --null --files-from=- -cf - \
        | tar -xf - -C /app/go-mod-staging

# Build web app. EXPO_PUBLIC_* vars are inlined at bundle time, so they
# must be present in the environment when `expo export` runs. Pass them in
# via `docker build --build-arg`.
ARG EXPO_PUBLIC_SENTRY_DSN=
ARG EXPO_PUBLIC_GIT_COMMIT=
ENV EXPO_PUBLIC_ENV=web
ENV EXPO_PUBLIC_SENTRY_DSN=$EXPO_PUBLIC_SENTRY_DSN
ENV EXPO_PUBLIC_GIT_COMMIT=$EXPO_PUBLIC_GIT_COMMIT
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Bring in .release-id, which utils/deploy.sh writes into the deploy tree
# right before pushing to Dokku. Format: YYYY-MM-DD-HHMMSS-<short-sha>.
# When the file is absent (someone running `docker build` by hand without
# deploy.sh), the RUN below falls back to deriving an id internally.
COPY .release-id* ./

# Resolve effective release id and stage the dist tree under
# release-staging/<id>/. Done in one shell so the resolved id is consistent
# across all steps. The entrypoint promotes this directory to the
# persistent volume on container start, and renames the SPA shell from
# index.html to app.html. EXPO_PUBLIC_RELEASE_ID is inlined into the
# bundle so /api/version polling can detect when a deploy lands.
RUN set -eu \
    && if [ -s .release-id ]; then \
        rid=$(tr -d '[:space:]' < .release-id); \
    else \
        sha="${EXPO_PUBLIC_GIT_COMMIT:-deadbeef}"; \
        sha=$(printf '%s' "$sha" | cut -c1-7); \
        case "$sha" in *[!a-f0-9]*) sha=deadbeef;; esac; \
        rid="$(date -u +%Y-%m-%d-%H%M%S)-$sha"; \
    fi \
    && rm -f .release-id \
    && export EXPO_PUBLIC_RELEASE_ID="$rid" \
    && npx expo export --platform web \
    && mkdir -p /app/release-staging \
    && mv /app/dist "/app/release-staging/$rid" \
    && printf '%s' "$rid" > "/app/release-staging/$rid/release-id.txt" \
    && mv "/app/release-staging/$rid/index.html" "/app/release-staging/$rid/app.html"


# Build stage for Go server.
FROM golang:1.25-trixie AS go-builder

# Install CGo dependencies for mupdf (thumbnail generation via go-fitz).
RUN apt-get update \
    && apt-get install -y libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Stage only go.mod / go.sum / go.work files first so the module-download
# layer caches until those files change. Without this, every source edit
# busts the cache and re-downloads ~hundreds of MB of Go modules. The app
# server's go.mod stays lean (just the bundled core); linked sibling Go
# modules are wired in through a generator-written go.work file at
# server/go.work, with each sibling's own go.mod under packages/<name>/server/.
# The web-builder stage assembled all of those under /app/go-mod-staging/
# with their original directory structure preserved.
COPY --from=web-builder /app/go-mod-staging/ ./

WORKDIR /app/server
# Warm the module cache. This layer is reused on every rebuild as long as
# none of the go.mod/go.sum/go.work files copied above changed.
RUN go mod download

# Now bring in the full server source. Changes here invalidate everything
# below but leave the (much larger) module-download layer above intact.
WORKDIR /app
COPY --from=web-builder /app/server/ ./server/
COPY --from=web-builder /app/packages ./packages

WORKDIR /app/server
# Reconcile go.sum across the workspace after the full source lands. The
# web-builder stage generated package_extensions.go and go.work but had no
# Go toolchain to populate go.sum entries; `go work sync` does that now,
# offline (module cache is warm from `go mod download` above) and only
# costs cycles when go.work or any sibling go.mod changed.
RUN if [ -f go.work ]; then go work sync; fi

# Build the server binary.
RUN CGO_ENABLED=1 GOOS=linux go build -o tinycld .


# Final runtime stage
FROM debian:trixie-slim AS runtime

ENV SENTRY_DSN=""
ENV SERVE_ON_DOMAINS=""
ENV FZ_VERSION="1.25.1"

# Install runtime dependencies + Node for runtime package installation.
# Runtime invokes `npx tsx scripts/<x>.ts` for tasks like reset-demo and
# seed-db (called from cron jobs in bin/), so Node must be on PATH.
# libcap2-bin (setcap) is only needed at image build time below; we keep it
# available so operators on autocert who use the in-app package installer
# can manually re-apply the cap to the freshly-rebuilt binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libffi8 libmupdf-dev libcap2-bin curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy Go toolchain from build stage (needed for runtime Go-package builds).
COPY --from=go-builder /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"

# Non-root runtime user. UID/GID 1000 matches the typical first non-root
# host user on Linux distros, so host-side `pb_data/` files on a bind-mount
# are owned by the host user instead of root. Override at build time with
# --build-arg TINYCLD_UID=... if your host user has a different uid.
ARG TINYCLD_UID=1000
ARG TINYCLD_GID=1000
RUN groupadd --system --gid "$TINYCLD_GID" tinycld \
    && useradd --system --uid "$TINYCLD_UID" --gid "$TINYCLD_GID" \
        --home-dir /app --no-create-home --shell /usr/sbin/nologin tinycld

WORKDIR /app

# Compiled server binary.
COPY --from=go-builder /app/server/tinycld ./tinycld

# Per-release web bundle, staged by the web-builder. The entrypoint promotes
# this on container start to /app/releases/ (typically the container's
# writable layer for compose deploys; a persistent volume for Dokku).
# The /app/public/ directory is reserved for the marketing website (populated
# by utils/Dockerfile.tail in tinycld.org's deploy pipeline).
COPY --from=web-builder /app/release-staging /app/release-staging
RUN mkdir -p /app/public /app/releases

# Migrations with symlinks already resolved in web-builder.
COPY --from=web-builder /app/server/pb_migrations ./pb_migrations

# Files needed for runtime package-install pipeline.
COPY --from=web-builder /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=web-builder /app/node_modules ./node_modules
COPY --from=web-builder /app/scripts ./scripts
COPY --from=web-builder /app/tinycld.packages.ts ./
# scripts/seed-db.ts imports lib/generated/package-seeds.ts (generated by
# scripts/generate-packages.ts in the web-builder stage). Cron jobs that
# reset the demo DB run seed-db at runtime, so the generated tree must
# ship in the runtime image.
COPY --from=web-builder /app/lib/generated ./lib/generated

# Full server tree (for runtime Go-package builds) + already-bundled packages.
COPY --from=go-builder /app/server/ ./server/
COPY --from=web-builder /app/packages ./packages

# bundled-packages.json so pkg_seed can find it at startup.
COPY --from=web-builder /app/server/bundled-packages.json ./bundled-packages.json

# Data + types mount points.
RUN mkdir -p pb_data types

# Runtime-only bin scripts. The full bin/ directory in the repo includes
# dev helpers (debug-ios-boot, server) we deliberately don't ship.
COPY bin/prune-releases.sh ./bin/prune-releases.sh
RUN chmod +x ./bin/*.sh

COPY config/dokku.app.json ./app.json
COPY config/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Hand the entire app tree to the tinycld user. pb_data/ and types/ are
# bind-mount targets whose mount-time ownership is the host's responsibility;
# the operator needs to ensure the bind-mount source on the host is writable
# by uid 1000 (or use --build-arg TINYCLD_UID=$(id -u) when building locally).
#
# Must run BEFORE setcap below — chown strips file capabilities (it resets
# the security.capability xattr along with ownership), so setcap'ing first
# then chown'ing would silently wipe the cap.
RUN chown -R tinycld:tinycld /app

# Grant cap_net_bind_service so the non-root user can bind :80/:443 when
# autocert is on (SERVE_ON_DOMAINS set). The plain-HTTP path defaults to
# the unprivileged :7090 and needs no special permissions.
#
# Caveat: the in-app package installer rebuilds the binary with `go build`
# and `os.Rename`s it into place. The new binary has no caps. On autocert
# hosts that use the installer, the operator needs to re-apply the cap
# manually (the image ships `setcap` for this) or restart the container
# from the original image. The plain-HTTP path is unaffected.
RUN setcap 'cap_net_bind_service=+ep' ./tinycld

# 7090: plain HTTP (default, when SERVE_ON_DOMAINS is unset)
# 80:   autocert HTTP-01 challenge + plain-HTTP redirect (when SERVE_ON_DOMAINS is set)
# 443:  autocert HTTPS (when SERVE_ON_DOMAINS is set)
# 993:  IMAPS (implicit TLS)
# 465:  SMTPS (implicit TLS)
EXPOSE 7090 80 443 993 465

USER tinycld

# Container runs entirely as uid 1000 (tinycld). The binary's
# cap_net_bind_service file capability lets it bind :80/:443 when autocert
# is enabled; the plain-HTTP default of :7090 is unprivileged.
#
# When SERVE_ON_DOMAINS is set (space-separated), serve with autocert on
# those domains (binds :80 + :443 directly, terminates TLS in-process).
#   dokku config:set myapp SERVE_ON_DOMAINS="tinycld.com tinycld.org www.tinycld.org"
# Otherwise serve plain HTTP on :7090 (override with HTTP_ADDR), expecting
# an upstream reverse proxy or compose port mapping to route to it.
ENTRYPOINT ["./entrypoint.sh"]
