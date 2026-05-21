#!/usr/bin/env bash
# Clone the feature packages that aren't bundled into this repo, as siblings of
# the app shell, so the npm workspace install picks them up as members. Runs
# during EAS builds (via `eas-build-post-install` in package.json) so the
# production iOS/Android bundle includes their routes, settings panels, etc.
#
# Workspace model: the app shell and every feature package are npm workspace
# members under a shared workspace root (one level up from this repo). We clone
# each feature next to the shell, ensure a workspace-root package.json exists,
# then a root `npm install` (run by the EAS install step) links them all.
#
# Local dev does not need this — devs clone siblings next to the shell and run
# `npm install` at the workspace root.

set -euo pipefail

REPO_BASE="${TINYCLD_PACKAGES_REPO_BASE:-https://github.com/tinycld}"

# Standalone members cloned as siblings of the app shell. core is a member too
# (it is no longer bundled inside the shell); feature packages follow.
PACKAGES=(
    core
    mail
    contacts
    calendar
    drive
    calc
    text
    google-takeout-import
)

# The app shell is at <workspace>/app; siblings live at <workspace>/<pkg>.
SHELL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${SHELL_DIR}/.." && pwd)"

for pkg in "${PACKAGES[@]}"; do
    dest="${WORKSPACE_ROOT}/${pkg}"
    if [ -d "${dest}/.git" ]; then
        echo "==> ${pkg} already present at ${dest}"
    else
        echo "==> Cloning @tinycld/${pkg} -> ${dest}"
        git clone --depth=1 --single-branch "${REPO_BASE}/${pkg}.git" "${dest}"
    fi
done

# Ensure a workspace-root package.json exists listing the shell + members.
# (In CI/EAS the workspace root may be a bare checkout dir without one.)
if [ ! -f "${WORKSPACE_ROOT}/package.json" ]; then
    echo "==> Writing workspace-root package.json at ${WORKSPACE_ROOT}"
    cat > "${WORKSPACE_ROOT}/package.json" <<'JSON'
{
    "name": "tinycld-workspace",
    "version": "0.0.0",
    "private": true,
    "workspaces": [
        "app",
        "core",
        "contacts",
        "mail",
        "calendar",
        "drive",
        "calc",
        "text",
        "google-takeout-import"
    ]
}
JSON
    echo 'legacy-peer-deps=true' > "${WORKSPACE_ROOT}/.npmrc"
fi

# Verify each package landed as a sibling dir. Feature packages carry a
# manifest.ts; core does not (it is the shared lib, not a feature) — check its
# package.json instead. Without this guard a failed clone could let the build
# ship without feature routes.
missing=()
for pkg in "${PACKAGES[@]}"; do
    marker="manifest.ts"
    [ "${pkg}" = "core" ] && marker="package.json"
    if [ ! -f "${WORKSPACE_ROOT}/${pkg}/${marker}" ]; then
        missing+=("@tinycld/${pkg}")
    fi
done
if [ "${#missing[@]}" -gt 0 ]; then
    echo "FATAL: feature packages did not clone: ${missing[*]}" >&2
    ls -la "${WORKSPACE_ROOT}" >&2 || true
    exit 1
fi

# Install at the workspace root so members link, then generate.
echo "==> Installing workspace from ${WORKSPACE_ROOT}"
(cd "${WORKSPACE_ROOT}" && npm install)
