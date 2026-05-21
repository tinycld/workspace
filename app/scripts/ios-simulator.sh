#!/usr/bin/env bash
# Wrapper for `expo run:ios` that targets a simulator UDID. By default reads
# the UDID from ../.env (IPHONE_SIMULATOR_UDID or IPAD_SIMULATOR_UDID); pass
# --ipad to switch to the iPad env var, or --udid <UDID> to skip the env file
# entirely and target an explicit simulator. Any other flags are forwarded to
# expo (e.g. --no-bundler).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/../.env"

DEVICE="iphone"
UDID_OVERRIDE=""
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --ipad) DEVICE="ipad"; shift ;;
        --iphone) DEVICE="iphone"; shift ;;
        --udid)
            if [ $# -lt 2 ]; then
                echo "ios-simulator: --udid requires a value" >&2
                exit 1
            fi
            UDID_OVERRIDE="$2"
            shift 2
            ;;
        --udid=*) UDID_OVERRIDE="${1#--udid=}"; shift ;;
        *) EXTRA_ARGS+=("$1"); shift ;;
    esac
done

if [ -n "$UDID_OVERRIDE" ]; then
    UDID="$UDID_OVERRIDE"
else
    if [ ! -f "$ENV_FILE" ]; then
        echo "ios-simulator: $ENV_FILE not found (pass --udid <UDID> to bypass)" >&2
        exit 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a

    if [ "$DEVICE" = "ipad" ]; then
        UDID="${IPAD_SIMULATOR_UDID:-}"
        UDID_VAR="IPAD_SIMULATOR_UDID"
    else
        UDID="${IPHONE_SIMULATOR_UDID:-}"
        UDID_VAR="IPHONE_SIMULATOR_UDID"
    fi

    if [ -z "$UDID" ]; then
        echo "ios-simulator: $UDID_VAR not set in $ENV_FILE (pass --udid <UDID> to override)" >&2
        exit 1
    fi
fi

cd "$ROOT"
# RCT_METRO_PORT is baked into the iOS binary at xcodebuild time (via
# RCTDefines.h), defaulting to 8081. We override it to 7100 — the dev.ts
# proxy port — so the simulator loads the bundle through the same proxy
# that routes /api and /_ to PocketBase. --port 7100 also tells the
# (skipped) bundler to use that port if --no-bundler is removed.
#
# Important: the simulator speaks plain HTTP. dev.ts runs the proxy with
# TLS by default when assets/localhost*.pem exist — run `npm start --
# --no-ssl` (or delete the certs) when using the simulator, otherwise
# the bundle fetch fails with a TLS handshake error.
export EXPO_PACKAGER_PROXY_URL=http://localhost:7102
npx expo run:ios --device "$UDID" --no-bundler "${EXTRA_ARGS[@]}"
