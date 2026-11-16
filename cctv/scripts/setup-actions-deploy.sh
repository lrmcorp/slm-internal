#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] && [ "$PWD" = /opt/cctvslm ] || { echo 'Jalankan sebagai root dari /opt/cctvslm.'; exit 1; }
install -o root -g root -m 700 scripts/receive-vps-deploy.sh /usr/local/sbin/slm-cctv-deploy
install -d -m 700 /root/.ssh
cctv_key=/root/.ssh/slm_cctv_actions
if [ ! -f "$cctv_key" ]; then ssh-keygen -t ed25519 -N '' -C slm-cctv-actions -f "$cctv_key"; fi
chmod 600 "$cctv_key"
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
cctv_authorization=$(printf 'restrict,command="/usr/local/sbin/slm-cctv-deploy" %s' "$(cat "$cctv_key.pub")")
if ! grep -qxF "$cctv_authorization" /root/.ssh/authorized_keys; then
    if grep -qF "$(cat "$cctv_key.pub")" /root/.ssh/authorized_keys; then
        echo 'Kunci ini sudah ada dengan izin berbeda. Periksa authorized_keys sebelum melanjutkan.'; exit 1
    fi
    printf '%s\n' "$cctv_authorization" >> /root/.ssh/authorized_keys
fi
read -r -p 'Port SSH VPS yang benar (lihat panel penyedia): ' cctv_port
[[ "$cctv_port" =~ ^[0-9]+$ ]] && (( cctv_port >= 1 && cctv_port <= 65535 )) || exit 1
cctv_host=31.97.51.194
[ "$cctv_port" = 22 ] || cctv_host="[$cctv_host]:$cctv_port"
printf '%s %s\n' "$cctv_host" "$(cat /etc/ssh/ssh_host_ed25519_key.pub)" > /root/.ssh/slm_cctv_known_hosts
chmod 600 /root/.ssh/slm_cctv_known_hosts
printf 'Kunci deploy siap. Port SSH: %s\n' "$cctv_port"
echo 'Isi Secrets sesuai docs/deployment-github.md. Jangan bagikan private key lewat chat.'
