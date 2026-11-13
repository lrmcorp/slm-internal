#!/usr/bin/env bash
# Update manual instance yang tidak ikut auto-deploy. Jalankan di VPS dari folder repo SLM:
#   bash scripts/server/update-instance.sh ankjy     # ankjy.net (juga ankjy.lrmslm.com)
#   bash scripts/server/update-instance.sh lcr       # slmj.lrmslm.com
#   bash scripts/server/update-instance.sh katalog   # Katalog Online MJ
#
# ankjy dan lcr memakai image yang sama dengan SLM (dibangun auto-deploy SLM). Skrip ini:
#   1) mencari container instance dan file compose-nya, 2) backup database instance,
#   3) menjalankan migrasi database dengan image terbaru, 4) menjalankan ulang aplikasinya, 5) cek bisa dibuka.
# Katalog dibangun dari kodenya sendiri (repo MJ): skrip menarik kode MJ terbaru lalu build ulang katalog;
# migrasi katalog jalan otomatis lewat service katalog-migrate.
# Opsional: CONTAINER=<nama container aplikasi> bila pencarian otomatis salah pilih.
set -euo pipefail

NAME="${1:-}"
case "$NAME" in
  ankjy) URL="https://ankjy.net" ;;
  lcr) URL="https://slmj.lrmslm.com" ;;
  katalog) URL="" ;;
  *) echo "Pakai: bash scripts/server/update-instance.sh ankjy|lcr|katalog" >&2; exit 2 ;;
esac

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nBERHENTI: %s\n' "$*" >&2; exit 1; }
label() { docker inspect -f "{{index .Config.Labels \"$2\"}}" "$1"; }

say "1/5 Mencari container $NAME"
C="${CONTAINER:-$(docker ps --format '{{.Names}}' | grep -i "$NAME" | grep -viE 'postgres|[-_]db|redis|migrate|worker|gateway' | head -1 || true)}"
[ -n "$C" ] || die "Container $NAME tidak ditemukan. Lihat daftar dengan: docker ps --format '{{.Names}}' lalu ulangi dengan CONTAINER=<nama> bash scripts/server/update-instance.sh $NAME"
WD=$(label "$C" com.docker.compose.project.working_dir)
PROJECT=$(label "$C" com.docker.compose.project)
SERVICE=$(label "$C" com.docker.compose.service)
FILES=$(label "$C" com.docker.compose.project.config_files)
[ -n "$WD" ] && [ -n "$SERVICE" ] || die "Container $C tidak dijalankan lewat docker compose."
COMPOSE=(docker compose -p "$PROJECT")
IFS=',' read -ra CF <<< "$FILES"
for f in "${CF[@]}"; do [ -n "$f" ] && COMPOSE+=(-f "$f"); done
echo "Container: $C (project $PROJECT, service $SERVICE, folder $WD)"

say "2/5 Backup database $NAME"
PG=$(docker ps --format '{{.Names}}' --filter "label=com.docker.compose.project=$PROJECT" | grep -iE 'postgres|[-_]db' | head -1 || true)
if [ -n "$PG" ]; then
  PGUSER=$(docker exec "$PG" printenv POSTGRES_USER || echo postgres)
  PGDB=$(docker exec "$PG" printenv POSTGRES_DB || echo "$PGUSER")
  mkdir -p /var/backups/slm
  OUT="/var/backups/slm/$NAME-sebelum-update-$(date +%Y%m%d-%H%M%S).dump"
  docker exec "$PG" pg_dump -U "$PGUSER" -d "$PGDB" -Fc > "$OUT" || die "Backup gagal; tidak ada yang diubah."
  echo "Backup: $OUT ($(du -h "$OUT" | cut -f1))"
else
  echo "Container database untuk project $PROJECT tidak ketemu; backup dilewati. Tekan Ctrl+C dalam 10 detik untuk batal."
  sleep 10
fi

if [ "$NAME" = "katalog" ]; then
  say "3/5 Menarik kode MJ terbaru dan build ulang katalog"
  REPO=$(git -C "$WD" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$REPO" ] || die "Folder $WD bukan bagian dari repo git MJ."
  git -C "$REPO" pull --ff-only || die "git pull di $REPO gagal. Cek dengan: git -C $REPO status"
  echo "Kode MJ: $(git -C "$REPO" log -1 --format='%h %s')"
  say "4/5 Build dan jalankan katalog (migrasi ikut otomatis)"
  (cd "$WD" && "${COMPOSE[@]}" up -d --build)
  say "5/5 Status"
  (cd "$WD" && "${COMPOSE[@]}" ps)
  echo "Selesai. Buka katalog dan cek kartu etalase / kategori. Log: cd $WD && docker compose logs --tail=80"
  exit 0
fi

say "3/5 Memastikan image SLM sudah versi terbaru"
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$C")
echo "Image $NAME: $IMAGE, dibuat $(docker image inspect -f '{{.Created}}' "$IMAGE" | cut -c1-19) UTC"
if [ -d /opt/slm/.git ]; then
  echo "Kode SLM di /opt/slm: $(git -C /opt/slm log -1 --format='%h %s (%cr)')"
fi
echo "Image dibangun oleh auto-deploy SLM. Kalau slm.lrmslm.com sudah menampilkan fitur terbaru, image ini sudah baru."

say "4/5 Migrasi database lalu jalankan ulang $NAME"
(cd "$WD" && "${COMPOSE[@]}" run --rm --no-deps -T "$SERVICE" npm run db:migrate:deploy) || die "Migrasi gagal; aplikasi $NAME yang lama tetap berjalan. Backup ada di /var/backups/slm."
(cd "$WD" && "${COMPOSE[@]}" up -d --no-build --force-recreate "$SERVICE")

say "5/5 Menunggu $URL bisa dibuka"
code=""
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/login" || true)
  [ "$code" = "200" ] && break
  sleep 3
done
[ "$code" = "200" ] || die "$URL belum bisa dibuka (HTTP $code). Lihat log: cd $WD && docker compose -p $PROJECT logs --tail=80 $SERVICE"
NEWC=$(docker ps --format '{{.Names}}' --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SERVICE" | head -1)
echo "Selesai. $URL hidup, container $NEWC memakai image $(docker inspect -f '{{.Image}}' "$NEWC" | cut -c8-19)."
