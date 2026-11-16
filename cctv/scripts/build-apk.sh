#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${API_BASE_URL:?Set API_BASE_URL to your HTTPS server URL}"
test -f /etc/ssl/certs/java/cacerts || { echo 'Java CA trust store missing' >&2; exit 1; }
mkdir -p .pub-cache .gradle-cache

python3 scripts/docker_with_proxy.py docker run --rm \
  -e API_BASE_URL -e HTTPS_PROXY -e HTTP_PROXY -e NO_PROXY \
  -e FIREBASE_API_KEY -e FIREBASE_APP_ID -e FIREBASE_PROJECT_ID -e FIREBASE_SENDER_ID \
  -e HOME=/tmp -e PUB_CACHE=/app/.pub-cache -e GRADLE_USER_HOME=/app/.gradle-cache \
  -e SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt -e FLUTTER_SUPPRESS_ANALYTICS=true \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/sdks/flutter \
  -v "$PWD:/app" \
  -v /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates.crt:ro \
  -v /etc/ssl/certs/java/cacerts:/tmp/host-cacerts:ro \
  -w /app/mobile ghcr.io/cirruslabs/flutter:stable \
  python3 /app/scripts/run_flutter_build.py

echo "APK uji: $PWD/mobile/build/app/outputs/flutter-apk/app-debug.apk"
