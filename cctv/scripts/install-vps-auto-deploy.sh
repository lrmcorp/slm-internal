#!/usr/bin/env bash
# Pasang sekali di VPS (root): timer systemd yang menjalankan vps-auto-deploy.sh tiap 2 menit.
# Lihat status: systemctl list-timers cctv-auto-deploy.timer ; log: journalctl -t cctv-auto-deploy -n 30
set -euo pipefail
REPO="${SLM_DIR:-/opt/slm}"
SCRIPT="$REPO/cctv/scripts/vps-auto-deploy.sh"
[ -f "$SCRIPT" ] || { echo "Tidak ditemukan: $SCRIPT"; exit 1; }
cat > /etc/systemd/system/cctv-auto-deploy.service <<UNIT
[Unit]
Description=Deploy otomatis CCTV dari main (hanya bila cctv/ berubah)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=SLM_DIR=$REPO
ExecStart=/bin/bash $SCRIPT
TimeoutStartSec=1800
UNIT
cat > /etc/systemd/system/cctv-auto-deploy.timer <<UNIT
[Unit]
Description=Cek pembaruan CCTV tiap 2 menit

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now cctv-auto-deploy.timer
systemctl list-timers cctv-auto-deploy.timer --no-pager
