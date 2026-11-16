#!/usr/bin/env bash
# Pemasangan khusus Ubuntu 24.04 pada /opt/cctvslm. Jalankan sebagai root.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Jalankan sebagai root.'; exit 1; }
cd "$(dirname "$0")/.."
[ "$PWD" = /opt/cctvslm ] || { echo 'Checkout harus berada di /opt/cctvslm.'; exit 1; }
. /etc/os-release
[ "$ID:$VERSION_ID" = ubuntu:24.04 ] || { echo 'Skrip ini khusus Ubuntu 24.04.'; exit 1; }
mode=${1:-direct}
[[ "$mode" = direct || "$mode" = npm ]] || { echo 'Mode yang tersedia: direct atau npm.'; exit 1; }
if [ "$mode" = direct ] && command -v docker >/dev/null && docker inspect nginx-proxy-manager >/dev/null 2>&1; then
  echo 'Nginx Proxy Manager ditemukan. Gunakan: bash scripts/deploy-vps.sh npm'
  exit 1
fi
if [ "$mode" = npm ]; then
  proxy_gateway=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .Gateway}}{{end}}' nginx-proxy-manager | head -n 1)
  [[ "$proxy_gateway" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Gateway Nginx Proxy Manager tidak ditemukan.'; exit 1; }
fi
read -r -p 'Domain dashboard [cctv.lrmslm.com]: ' domain
domain=${domain:-cctv.lrmslm.com}
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ ]] || exit 1
read -r -p 'Email admin dashboard dan sertifikat HTTPS: ' admin_email
[[ "$admin_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || exit 1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx php8.3-fpm php8.3-cli php8.3-sqlite3 php8.3-mbstring php8.3-xml php8.3-curl php8.3-zip composer python3-venv tesseract-ocr ffmpeg certbot python3-certbot-nginx sqlite3
install -d -o www-data -g www-data -m 700 /var/cache/slm-composer
install -d -o www-data -g www-data backend/vendor
chown -R www-data:www-data backend/vendor
# Jangan jalankan plugin Composer dengan hak root.
runuser -u www-data -- env COMPOSER_HOME=/var/cache/slm-composer composer --working-dir=/opt/cctvslm/backend install --no-dev --prefer-dist --no-interaction --no-progress --no-scripts
php backend/artisan package:discover
python3 -m venv /opt/cctvslm/.venv
/opt/cctvslm/.venv/bin/pip install -r vision/requirements.txt
python3 - "$domain" <<'PY'
import sys, secrets, os
from pathlib import Path
p = Path('backend/.env')
if not p.exists():
    p.write_text(Path('backend/.env.example').read_text() + '\n' + Path('.env.example').read_text())
s = p.read_text().splitlines()
updates = {'APP_ENV':'production', 'APP_DEBUG':'false', 'APP_URL':'https://' + sys.argv[1],
           'DB_DATABASE':'/opt/cctvslm/backend/database/database.sqlite',
           'SESSION_SECURE_COOKIE':'true',
           'CCTV_X_ACCEL_REDIRECT':'true',
           'CCTV_HLS_DIRECTORY':'/opt/cctvslm/backend/storage/app/private/cctv/live-video'}
if not any(x.startswith('CCTV_INGEST_TOKEN=') and x.split('=',1)[1] for x in s):
    updates['CCTV_INGEST_TOKEN'] = secrets.token_hex(32)
for key, value in updates.items():
    s = [x for x in s if not x.startswith(key + '=')]
    s.append(key + '=' + value)
p.write_text('\n'.join(s) + '\n')
os.chmod(p, 0o640)
PY
chown root:www-data backend/.env
chown -R www-data:www-data backend/storage backend/bootstrap/cache backend/database
chmod -R u+rwX,g+rwX,o-rwx backend/storage backend/bootstrap/cache backend/database
if ! rg_key=$(sed -n 's/^APP_KEY=//p' backend/.env) || [ -z "$rg_key" ]; then
  php backend/artisan key:generate --force
fi
unset rg_key
runuser -u www-data -- php backend/artisan migrate --force
# Meminta sandi tanpa menulisnya ke riwayat shell. Tidak ada akun bawaan.
read -r -p 'Tampilkan sandi dashboard saat diketik? [y/N]: ' show_password
if [ "$show_password" = y ] || [ "$show_password" = Y ]; then
  php backend/artisan cctv:create-admin "$admin_email" --show-password
else
  php backend/artisan cctv:create-admin "$admin_email"
fi
runuser -u www-data -- php backend/artisan config:cache
runuser -u www-data -- php backend/artisan view:cache
for task in queue scheduler; do
  if [ "$task" = queue ]; then action='queue:work --queue=alerts,default --sleep=1 --tries=5 --timeout=90 --max-time=3600'; else action='schedule:work'; fi
  cat > "/etc/systemd/system/slm-$task.service" <<EOF
[Unit]
Description=SLM CCTV $task
After=network-online.target
Wants=network-online.target
[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/cctvslm/backend
ExecStart=/usr/bin/php artisan $action
Restart=always
RestartSec=5
UMask=0027
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
done
cat > /etc/systemd/system/slm-camera@.service <<'EOF'
[Unit]
Description=SLM CCTV kamera %i
After=network-online.target nginx.service tailscaled.service
Wants=network-online.target
[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/cctvslm/vision
EnvironmentFile=/opt/cctvslm/backend/.env
EnvironmentFile=/etc/slm-cctv/camera-%i.env
Environment=CCTV_API_BASE=http://127.0.0.1:8088
Environment=CCTV_EVIDENCE_SPOOL=/var/lib/slm-cctv/spool
Environment=OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp
ExecStart=/opt/cctvslm/.venv/bin/python worker.py
Restart=always
RestartSec=5
UMask=0027
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
install -d -o www-data -g www-data -m 700 /var/lib/slm-cctv/spool
install -d -m 700 /etc/slm-cctv
if [ "$mode" = npm ]; then
  # Listener publik dikelola NPM; CCTV hanya menerima koneksi pada gateway Docker.
  install -d -m 755 /etc/slm-cctv
  cat > /etc/slm-cctv/nginx.conf <<EOF
user www-data;
worker_processes 1;
pid /run/slm-cctv-nginx.pid;
error_log /var/log/nginx/slm-cctv-error.log;
events { worker_connections 512; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/slm-cctv-access.log;
    server {
        listen $proxy_gateway:8095;
        listen 127.0.0.1:8088;
        server_name $domain localhost;
        root /opt/cctvslm/backend/public;
        index index.php;
        client_max_body_size 32m;
        location / { try_files \$uri \$uri/ /index.php?\$query_string; }
        location /protected-live-video/ {
            internal;
            alias /opt/cctvslm/backend/storage/app/private/cctv/live-video/;
        }
        location = /index.php {
            include /etc/nginx/fastcgi_params;
            fastcgi_param SCRIPT_FILENAME /opt/cctvslm/backend/public/index.php;
            # Domain pengguna selalu melalui HTTPS di NPM.
            fastcgi_param HTTPS on;
            fastcgi_param SERVER_PORT 443;
            fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        }
        location ~ \.php$ { return 404; }
        location ~ /\. { deny all; }
    }
}
EOF
  cat > /etc/systemd/system/slm-web.service <<'EOF'
[Unit]
Description=SLM CCTV web di belakang Nginx Proxy Manager
After=network-online.target docker.service php8.3-fpm.service
Wants=network-online.target
Requires=php8.3-fpm.service
[Service]
Type=simple
ExecStartPre=/usr/sbin/nginx -t -c /etc/slm-cctv/nginx.conf
ExecStart=/usr/sbin/nginx -c /etc/slm-cctv/nginx.conf -g "daemon off;"
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
  nginx -t -c /etc/slm-cctv/nginx.conf
  systemctl daemon-reload
  systemctl enable --now php8.3-fpm slm-web
  systemctl restart slm-web
  curl --fail --silent --show-error http://127.0.0.1:8088/up >/dev/null
else
# API pekerja hanya mendengarkan loopback. Domain publik selalu memakai login.
cat > /etc/nginx/sites-available/slm-cctv <<EOF
server {
    listen 80;
    server_name $domain;
    root /opt/cctvslm/backend/public;
    index index.php;
    client_max_body_size 32m;
    location / { try_files \$uri \$uri/ /index.php?\$query_string; }
    location /protected-live-video/ {
        internal;
        alias /opt/cctvslm/backend/storage/app/private/cctv/live-video/;
    }
    location = /index.php {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /opt/cctvslm/backend/public/index.php;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
    location ~ \.php$ { return 404; }
    location ~ /\. { deny all; }
}
server {
    listen 127.0.0.1:8088;
    server_name localhost;
    root /opt/cctvslm/backend/public;
    location / { try_files \$uri /index.php?\$query_string; }
    location = /index.php {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /opt/cctvslm/backend/public/index.php;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
    location ~ \.php$ { return 404; }
    location ~ /\. { deny all; }
    client_max_body_size 32m;
}
EOF
ln -sfn /etc/nginx/sites-available/slm-cctv /etc/nginx/sites-enabled/slm-cctv
nginx -t
systemctl daemon-reload
systemctl enable --now php8.3-fpm nginx
systemctl reload nginx
# Sertifikat baru dapat terbit setelah DNS A/AAAA menuju VPS dan port 80 dapat dijangkau.
certbot --nginx --non-interactive --agree-tos --email "$admin_email" -d "$domain" --redirect
fi
systemctl enable --now slm-queue slm-scheduler
systemctl restart slm-queue slm-scheduler
if [ "$mode" = npm ]; then
  printf 'Di NPM: domain %s, scheme http, forward hostname/IP %s, port 8095.\n' "$domain" "$proxy_gateway"
  echo 'Terbitkan sertifikat SSL di NPM dan aktifkan Force SSL sebelum login.'
else
  curl --fail --silent --show-error "https://$domain/up" >/dev/null
fi
printf 'Alamat dashboard (HTTPS perlu aktif): https://%s\n' "$domain"
echo 'Selanjutnya jalankan: python3 scripts/configure-vps-camera.py'
