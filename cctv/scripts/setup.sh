#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

test -f /etc/ssl/certs/ca-certificates.crt || { echo 'System CA bundle missing' >&2; exit 1; }
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
fi
if grep -q '^CCTV_INGEST_TOKEN=$' .env; then
  token="$(openssl rand -hex 32)"
  sed -i "s/^CCTV_INGEST_TOKEN=$/CCTV_INGEST_TOKEN=$token/" .env
  unset token
fi
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  chmod 600 backend/.env
fi
mkdir -p secrets
chmod 700 secrets
mkdir -p vision/spool
chmod 700 vision/spool
export DOCKER_CONFIG="$PWD/.docker-config"
mkdir -p "$DOCKER_CONFIG"

python3 scripts/docker_with_proxy.py docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD/backend:/app" \
  -v /etc/ssl/certs/ca-certificates.crt:/tmp/host-ca.crt:ro \
  -e HTTP_PROXY -e HTTPS_PROXY -e NO_PROXY \
  -e COMPOSER_CAFILE=/tmp/host-ca.crt \
  -e GIT_SSL_CAINFO=/tmp/host-ca.crt \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/app \
  -e COMPOSER_HOME=/app/.composer-cache \
  -w /app composer:2 install --prefer-dist --no-interaction --no-progress

if grep -q '^APP_KEY=$' backend/.env; then
  python3 scripts/docker_with_proxy.py docker compose run --rm --no-deps web php artisan key:generate --force
fi
python3 scripts/docker_with_proxy.py docker compose run --rm --no-deps web php artisan migrate --force
python3 scripts/docker_with_proxy.py docker compose build vision
echo 'Setup selesai. Buat pengguna: docker compose run --rm --no-deps web php artisan cctv:create-admin email@contoh.com'
