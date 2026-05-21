#!/usr/bin/env sh
set -eu

CERT=assets/localhost.pem
KEY=assets/localhost-key.pem
ROOT_PEM="$(mkcert -CAROOT)/rootCA.pem"

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "ssl: $CERT and $KEY already exist, skipping mkcert"
else
    mkcert -cert-file "$CERT" -key-file "$KEY" localhost 127.0.0.1 ::1
fi

echo Installing $ROOT_PEM into booted sim

xcrun simctl keychain booted add-root-cert $ROOT_PEM
