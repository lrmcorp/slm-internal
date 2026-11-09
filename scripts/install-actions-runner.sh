#!/usr/bin/env bash
# Pasang GitHub Actions self-hosted runner untuk deploy (sekali saja, sebagai root, di VPS).
# Runner menghubungi GitHub dari dalam VPS; tidak ada port/SSH yang perlu dibuka.
#
#   APP=slm APP_DIR=/root/slm-internal REPO=lrmcorp/slm-internal RUNNER_TOKEN=xxxx bash install-actions-runner.sh
#
# RUNNER_TOKEN: GitHub > repo > Settings > Actions > Runners > New self-hosted runner (berlaku 1 jam).
set -euo pipefail
: "${APP:?APP=slm atau mj}" "${APP_DIR:?folder aplikasi}" "${REPO:?owner/repo}" "${RUNNER_TOKEN:?token pendaftaran runner}"
[ "$(id -u)" = 0 ] || { echo "Jalankan sebagai root." >&2; exit 1; }
[ -f "$APP_DIR/.env.local" ] || { echo "$APP_DIR/.env.local tidak ditemukan; APP_DIR salah?" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker tidak ada." >&2; exit 1; }

RUNNER_DIR="/opt/actions-runner-$APP"
mkdir -p "$RUNNER_DIR" /etc/lrm-deploy
echo "APP_DIR=$APP_DIR" > "/etc/lrm-deploy/$APP.env"

cd "$RUNNER_DIR"
if [ ! -x ./config.sh ]; then
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')"
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Arsitektur tidak didukung" >&2; exit 1 ;; esac
  curl -fsSL -o runner.tgz "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-${ARCH}-${VERSION}.tar.gz"
  tar xzf runner.tgz && rm runner.tgz
  ./bin/installdependencies.sh >/dev/null 2>&1 || true
fi

export RUNNER_ALLOW_RUNASROOT=1
./config.sh --unattended --replace --url "https://github.com/$REPO" --token "$RUNNER_TOKEN" \
  --name "$APP-vps-$(hostname -s)" --labels "$APP-vps" --work _work
./svc.sh install root >/dev/null
./svc.sh start >/dev/null
echo "✅ Runner $APP-vps aktif. Cek di GitHub: $REPO > Settings > Actions > Runners (status Idle)."
