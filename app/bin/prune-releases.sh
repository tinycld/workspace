#!/bin/sh
# Delete release directories under /app/releases/ older than 7 days,
# never deleting the one /app/releases/current points at. Run by the
# Dokku cron declared in config/dokku.app.json.
#
# Only directories matching the release-id format (YYYY-MM-DD-HHMMSS-<sha>)
# are considered — siblings like _static/ (the cross-release asset pool)
# are left alone. The pool grows by content (hashed filenames dedupe across
# releases) so it grows slowly; if it ever becomes a problem, a separate
# cleanup pass keyed on file mtime can be added.
#
# Age is measured by directory ctime, which is set when the entrypoint
# `mv`s the staged dir into place on the volume. mtime would be wrong
# here: cp -a preserves source mtime (= image build time), so mtime
# tracks the build, not the promote.
set -eu

RELEASES_DIR=/app/releases
CURRENT=$(readlink "$RELEASES_DIR/current" 2>/dev/null || true)
RELEASE_ID_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[a-f0-9]+$'

if [ ! -d "$RELEASES_DIR" ]; then
    echo "[prune-releases] $RELEASES_DIR missing; nothing to prune"
    exit 0
fi

for dir in "$RELEASES_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    # Skip anything that isn't a release dir (e.g. _static/).
    if ! printf '%s' "$name" | grep -Eq "$RELEASE_ID_RE"; then
        continue
    fi
    if [ "$name" = "$CURRENT" ]; then
        echo "[prune-releases] skipping current release $name"
        continue
    fi
    # ctime + 7 days < now -> prune
    if [ "$(find "$dir" -maxdepth 0 -ctime +7 -print)" = "$dir" ]; then
        echo "[prune-releases] deleting $name"
        rm -rf "$dir"
    fi
done
