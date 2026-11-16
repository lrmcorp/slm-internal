#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env && test -f backend/.env || { echo 'Jalankan bash scripts/setup.sh dahulu.' >&2; exit 1; }

python3 scripts/docker_with_proxy.py docker compose up -d web queue scheduler
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/up >/dev/null; then
    docker compose ps
    echo 'Backend siap pada loopback server.'
    exit 0
  fi
  sleep 1
done
docker compose logs --tail=30 web
echo 'Backend belum siap setelah 30 detik.' >&2
exit 1
