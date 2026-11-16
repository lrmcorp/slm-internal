#!/usr/bin/env bash
# Deploy otomatis CCTV dari VPS. Dijalankan timer systemd (lihat install-vps-auto-deploy.sh).
# Menarik main ke /opt/slm (fast-forward saja). Hanya bila ada perubahan di cctv/, stack CCTV
# (project compose "cctvslm") dibangun ulang. Container SLM dan aplikasi lain tidak disentuh.
set -euo pipefail
REPO="${SLM_DIR:-/opt/slm}"
PORT_DEFAULT=8095
log() { logger -t cctv-auto-deploy "$*"; echo "$(date '+%F %T') $*"; }

exec 9>/run/cctv-auto-deploy.lock
flock -n 9 || exit 0

cd "$REPO"
git fetch --quiet origin main
local_rev=$(git rev-parse HEAD)
remote_rev=$(git rev-parse origin/main)
pending=$( [ -f "$REPO/.cctv-deploy-pending" ] && echo 1 || true )
[ "$local_rev" = "$remote_rev" ] && [ -z "$pending" ] && exit 0

if [ "$local_rev" != "$remote_rev" ]; then
  changed=$(git diff --name-only "$local_rev" "$remote_rev" -- cctv | wc -l)
  if ! git merge --ff-only --quiet origin/main; then
    log "BERHENTI: /opt/slm tidak bisa fast-forward (ada perubahan lokal). Cek: git -C $REPO status"
    exit 1
  fi
  log "Kode ditarik: ${local_rev:0:7} -> ${remote_rev:0:7} (${changed} file CCTV berubah)"
  [ "$changed" -gt 0 ] && touch "$REPO/.cctv-deploy-pending"
fi
[ -f "$REPO/.cctv-deploy-pending" ] || exit 0

cd "$REPO/cctv"
if [ ! -f .env ]; then
  log "BERHENTI: $REPO/cctv/.env belum ada. Jalankan migrasi satu kali (cctv/docs/pemasangan-vps.md)."
  exit 1
fi
log "Membangun ulang stack CCTV..."
docker compose up -d --build --remove-orphans
port=$(grep -E '^CCTV_WEB_PORT=' .env | tail -1 | cut -d= -f2 || true)
for _ in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port:-$PORT_DEFAULT}/login" || true)
  if [ "$code" = "200" ]; then
    rm -f "$REPO/.cctv-deploy-pending"
    log "Selesai: CCTV $(git -C "$REPO" rev-parse --short HEAD) jalan, web sehat."
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done
log "PERINGATAN: web CCTV belum sehat (HTTP $code); dicoba lagi pada putaran berikutnya. Log: docker compose -p cctvslm logs --tail=80 web"
exit 1
