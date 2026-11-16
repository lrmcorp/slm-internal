#!/usr/bin/env bash
# Salin satu kali ke /usr/local/sbin/slm-cctv-deploy, pemilik root, mode 700.
set -euo pipefail
umask 022
[ "$(id -u)" = 0 ] || { echo 'Receiver memerlukan root.'; exit 1; }
[ "${SSH_ORIGINAL_COMMAND:-}" = deploy-cctv ] || { echo 'Hanya perintah deploy-cctv yang diizinkan.'; exit 1; }
exec 9>/run/slm-cctv-deploy.lock
flock -n 9 || { echo 'Deployment lain masih berjalan.'; exit 1; }
cd /opt/cctvslm
[ -f backend/.env ] && [ -f backend/vendor/autoload.php ] || { echo 'Selesaikan pemasangan awal dahulu.'; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo 'Ada perubahan lokal terlacak; deployment dihentikan.'; exit 1; }
cctv_temp=$(mktemp -d /tmp/slm-deploy.XXXXXXXX)
cctv_paused=0
cctv_cameras=()
cleanup() {
    cctv_result=$?
    if [ "$cctv_paused" = 1 ] && [ "$cctv_result" = 0 ]; then
        runuser -u www-data -- php backend/artisan up || true
        systemctl start slm-queue slm-scheduler || true
        for unit in "${cctv_cameras[@]}"; do systemctl start "$unit" || true; done
    fi
    if [ "$cctv_paused" = 1 ] && [ "$cctv_result" != 0 ]; then
        runuser -u www-data -- php backend/artisan down --retry=15 || true
        systemctl stop slm-queue slm-scheduler || true
        for unit in "${cctv_cameras[@]}"; do systemctl stop "$unit" || true; done
        echo "Deployment gagal; periksa aplikasi dalam maintenance. Periksa log dan backup /opt/cctvslm-backups." >&2
    fi
    rm -rf "$cctv_temp"
    exit "$cctv_result"
}
trap cleanup EXIT
# Maksimum 128 MiB; bundle tidak berisi file .env, bukti, atau konfigurasi Git.
head -c 134217729 > "$cctv_temp/release.bundle"
[ "$(stat -c %s "$cctv_temp/release.bundle")" -le 134217728 ] || { echo 'Bundle terlalu besar.'; exit 1; }
git bundle verify "$cctv_temp/release.bundle"
git fetch --no-tags "$cctv_temp/release.bundle" HEAD
cctv_commit=$(git rev-parse FETCH_HEAD)
while IFS= read -r cctv_path; do
    case "$cctv_path" in
        .env|backend/.env|backend/storage/*|backend/database/*.sqlite*|secrets/*|vision/models/*)
            echo "File konfigurasi/bukti tidak boleh ditimpa deployment: $cctv_path"; exit 1;;
    esac
done < <(git diff --name-only HEAD "$cctv_commit")
git merge-base --is-ancestor HEAD "$cctv_commit" || { echo 'Riwayat bukan fast-forward.'; exit 1; }
# Perubahan dependensi Python memerlukan pemasangan terpisah yang sudah diuji.
if ! git diff --quiet HEAD "$cctv_commit" -- vision/requirements.txt vision/requirements-model.txt; then
    echo 'Dependensi Python berubah. Pasang dan uji secara terpisah dahulu.'; exit 1
fi
cctv_composer_changed=0
git diff --quiet HEAD "$cctv_commit" -- backend/composer.lock || cctv_composer_changed=1
install -d -m 700 /opt/cctvslm-backups
cctv_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sqlite3 backend/database/database.sqlite ".backup '/opt/cctvslm-backups/$cctv_stamp.sqlite'"
chmod 600 "/opt/cctvslm-backups/$cctv_stamp.sqlite"
git rev-parse HEAD > "/opt/cctvslm-backups/$cctv_stamp.commit"
mapfile -t cctv_cameras < <(systemctl list-units 'slm-camera@*.service' --state=active --no-legend --plain | awk '{print $1}')
runuser -u www-data -- php backend/artisan down --retry=15
cctv_paused=1
systemctl stop slm-queue slm-scheduler
for unit in "${cctv_cameras[@]}"; do systemctl stop "$unit"; done
git merge --ff-only "$cctv_commit"
if [ "$cctv_composer_changed" = 1 ]; then
    runuser -u www-data -- env COMPOSER_HOME=/var/cache/slm-composer composer --working-dir=/opt/cctvslm/backend install --no-dev --prefer-dist --no-scripts --no-interaction --no-progress
fi
runuser -u www-data -- php backend/artisan package:discover
runuser -u www-data -- php backend/artisan migrate --force
runuser -u www-data -- php backend/artisan config:cache
runuser -u www-data -- php backend/artisan view:cache
# Peringatan memakai antrean `alerts`; unit lama hanya mendengarkan `default`.
if ! grep -q -- '--queue=alerts,default' /etc/systemd/system/slm-queue.service; then
    sed -i 's|queue:work --sleep=1|queue:work --queue=alerts,default --sleep=1|' /etc/systemd/system/slm-queue.service
    systemctl daemon-reload
fi
runuser -u www-data -- php backend/artisan up
systemctl start slm-queue slm-scheduler
for unit in "${cctv_cameras[@]}"; do systemctl start "$unit"; done
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 --max-time 10 http://127.0.0.1:8088/up >/dev/null
cctv_paused=0
printf 'Deployment CCTV berhasil: %s\n' "$cctv_commit"
