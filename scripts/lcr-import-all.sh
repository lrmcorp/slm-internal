#!/usr/bin/env bash
# Semua langkah impor simulasi penjualan v12 ke instance lcr, dijalankan sekali di VPS dari folder repo SLM:
#   bash scripts/lcr-import-all.sh
# 1) matikan notifikasi & DO di env lcr, 2) jalankan ulang container lcr, 3) pastikan lcr sudah versi
# terbaru, 4) cek data, 5) setelah Anda setuju, simpan. Username & password owner lcr ditanyakan di layar.
# Tujuan selalu https://lcr.lrmint.xyz. Semua nota dibayar Cash. Opsional: LCR_CONTAINER, TIPE=<kode tipe>.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="https://lcr.lrmint.xyz"
say() { printf '\n== %s\n' "$*"; }
die() { printf '\nBERHENTI: %s\n' "$*" >&2; exit 1; }

say "1/5 Mencari container aplikasi lcr"
C="${LCR_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -i lcr | grep -viE 'postgres|db|redis' | head -1 || true)}"
[ -n "$C" ] || die "Container lcr tidak ditemukan. Jalankan: docker ps --format '{{.Names}}' lalu ulangi dengan LCR_CONTAINER=<nama> bash scripts/lcr-import-all.sh"
WD=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$C")
PROJECT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$C")
SERVICE=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$C")
FILES=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$C")
[ -n "$WD" ] && [ -n "$SERVICE" ] || die "Container $C tidak dijalankan lewat docker compose; ubah env-nya manual."
echo "Container: $C (project $PROJECT, service $SERVICE, folder $WD)"

ENV_FILE=""
for f in "$WD/.env.local" "$WD/.env.production" "$WD/.env"; do
  if [ -f "$f" ]; then ENV_FILE="$f"; break; fi
done
[ -n "$ENV_FILE" ] || die "File env lcr tidak ditemukan di $WD."
echo "File env: $ENV_FILE"

say "2/5 Mematikan notifikasi dan DO di lcr"
cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
set_env() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '\n%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
set_env PUSH_ENABLED false
set_env DELIVERY_ORDERS_ENABLED false
echo "PUSH_ENABLED=false dan DELIVERY_ORDERS_ENABLED=false tersimpan (cadangan: $ENV_FILE.bak-*)"

COMPOSE_ARGS=(-p "$PROJECT")
IFS=',' read -ra CF <<< "$FILES"
for f in "${CF[@]}"; do [ -n "$f" ] && COMPOSE_ARGS+=(-f "$f"); done
(cd "$WD" && docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate "$SERVICE")

say "3/5 Menunggu lcr hidup dan memeriksa versinya"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/login" || true)
  [ "$code" = "200" ] && break
  sleep 3
done
[ "${code:-}" = "200" ] || die "lcr belum bisa dibuka di $URL setelah dijalankan ulang."
C=$(docker ps --format '{{.Names}}' --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SERVICE" | head -1)
[ "$(docker exec "$C" printenv DELIVERY_ORDERS_ENABLED || true)" = "false" ] || die "DELIVERY_ORDERS_ENABLED belum terbaca di container. Cek env_file di compose lcr."
docker exec "$C" sh -c 'grep -rlsq DELIVERY_ORDERS_ENABLED /app/.next/server 2>/dev/null || grep -rlsq DELIVERY_ORDERS_ENABLED .next/server 2>/dev/null' \
  || die "lcr masih memakai versi lama (belum ada saklar DO/notifikasi). Perbarui image lcr ke versi terbaru dulu, lalu jalankan skrip ini lagi."
echo "lcr versi terbaru, notifikasi dan DO mati."

say "4/5 Cek data impor (belum menyimpan)"
read -rp "Username owner lcr: " IMPORT_USER
read -rsp "Password: " IMPORT_PASSWORD; echo
export IMPORT_USER IMPORT_PASSWORD
EXTRA=()
[ -n "${TIPE:-}" ] && EXTRA+=(--tipe "$TIPE")
run_import() {
  if command -v node >/dev/null 2>&1; then
    node scripts/import-sales-simulation.mjs --url "$URL" "${EXTRA[@]}" "$@"
  else
    docker run --rm -v "$PWD":/w -w /w -e IMPORT_USER -e IMPORT_PASSWORD node:20-alpine node scripts/import-sales-simulation.mjs --url "$URL" "${EXTRA[@]}" "$@"
  fi
}
if ! run_import; then
  echo
  echo "Cek belum lolos. Kalau ada barang tidak ditemukan: upload scripts/data/Master_Barang_lcr_simulasi_v12.xlsx lewat"
  echo "Inventory > Import Opname Excel di lcr."
  exit 1
fi

say "5/5 Simpan 1.464 nota ke lcr"
read -rp "Ketik SIMPAN untuk lanjut: " ok
[ "$ok" = "SIMPAN" ] || die "Dibatalkan, tidak ada yang disimpan."
run_import --commit
say "Selesai. Buka $URL/penjualan untuk melihat hasilnya."
