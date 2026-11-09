#!/usr/bin/env bash
# Dijalankan GitHub Actions di VPS (self-hosted runner): image sudah dibangun di GitHub, di sini hanya
# tarik image, sinkronkan folder aplikasi, migrasi, restart, dan cek kesehatan. Gagal sehat = kembali ke image lama.
#
# Variabel: APP_DIR, IMAGE_REF (ghcr.io/...:<sha>), LOCAL_TAG (mis. slm-app:local), SERVICES (mis. "slm-app slm-gateway"),
#           HEALTH_CONTAINER (mis. slm-app), DEPLOY_SHA (commit yang di-deploy).
set -euo pipefail
: "${APP_DIR:?}" "${IMAGE_REF:?}" "${LOCAL_TAG:?}" "${SERVICES:?}" "${HEALTH_CONTAINER:?}" "${DEPLOY_SHA:?}"
cd "$APP_DIR"
[ -f .env.local ] || { echo "❌ $APP_DIR/.env.local tidak ada." >&2; exit 1; }

echo "📥 [1/5] Sinkron folder aplikasi ke $DEPLOY_SHA (docker-compose, skrip)..."
git fetch --quiet origin main
if ! git merge --ff-only --quiet "$DEPLOY_SHA" 2>/dev/null; then
  if git merge-base --is-ancestor "$DEPLOY_SHA" HEAD; then
    echo "   Folder sudah di commit yang lebih baru; dilanjutkan."
  else
    echo "❌ Folder $APP_DIR punya perubahan lokal yang tidak ada di GitHub. Bereskan dulu (git status) lalu jalankan ulang deploy." >&2
    git status --short >&2
    exit 1
  fi
fi

echo "🐳 [2/5] Tarik image $IMAGE_REF..."
docker pull --quiet "$IMAGE_REF"
PREV_IMAGE="$(docker image inspect -f '{{.Id}}' "$LOCAL_TAG" 2>/dev/null || true)"
docker tag "$IMAGE_REF" "$LOCAL_TAG"

rollback() {
  if [ -n "$PREV_IMAGE" ]; then
    echo "↩️  Kembali ke image sebelumnya..." >&2
    docker tag "$PREV_IMAGE" "$LOCAL_TAG"
    # shellcheck disable=SC2086
    docker compose up -d --no-build $SERVICES >&2 || true
  fi
}

echo "🗄️ [3/5] Migrasi database..."
if ! docker compose run --rm db-migrate; then
  echo "❌ Migrasi gagal; aplikasi lama tetap berjalan." >&2
  [ -n "$PREV_IMAGE" ] && docker tag "$PREV_IMAGE" "$LOCAL_TAG"
  exit 1
fi

echo "🚀 [4/5] Restart: $SERVICES"
# shellcheck disable=SC2086
docker compose up -d --no-build $SERVICES

echo "🩺 [5/5] Cek /api/health..."
for _ in $(seq 1 40); do
  if docker exec "$HEALTH_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✅ Live: $(git log -1 --format='%h %s' "$DEPLOY_SHA")"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done
echo "❌ Aplikasi tidak sehat setelah 2 menit. Log terakhir:" >&2
docker logs --tail 80 "$HEALTH_CONTAINER" >&2 || true
rollback
exit 1
