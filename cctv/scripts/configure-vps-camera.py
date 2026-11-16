"""Configure the real DVR interactively, with no passwords in shell history."""
import argparse
import getpass
import ipaddress
import os
from pathlib import Path
import subprocess
from urllib.parse import quote

if os.geteuid() != 0 or Path.cwd() != Path('/opt/cctvslm'):
    raise SystemExit('Jalankan dari /opt/cctvslm sebagai root.')
parser = argparse.ArgumentParser(description='Konfigurasi kamera DVR SLM')
parser.add_argument('--channels', help='Daftar kanal 1–16, dipisahkan koma; contoh: 12,13,14')
args = parser.parse_args()
channels = (14, 13, 12)
if args.channels:
    try:
        channels = tuple(dict.fromkeys(int(value.strip()) for value in args.channels.split(',')))
    except ValueError:
        raise SystemExit('Daftar kanal harus berupa angka dipisahkan koma.')
    if not channels or any(channel < 1 or channel > 16 for channel in channels):
        raise SystemExit('Pilih kanal DVR dari 1 sampai 16.')
bridge = input('IP Tailscale komputer penerus DVR: ').strip()
if ipaddress.ip_address(bridge) not in ipaddress.ip_network('100.64.0.0/10'):
    raise SystemExit('Alamat harus IPv4 Tailscale.')
username = input('Nama pengguna DVR [dvr]: ').strip() or 'dvr'
visible = input('Tampilkan sandi saat diketik? [y/N]: ').lower() == 'y'
password = input('Sandi DVR (terlihat): ') if visible else getpass.getpass('Sandi DVR: ')
model = input('Path model deteksi yang sudah diuji (Enter jika belum ada): ').strip()
if model:
    allowed = Path('/opt/cctvslm/vision/models').resolve()
    model_path = Path(model).resolve()
    if not model_path.is_file() or not model_path.is_relative_to(allowed):
        raise SystemExit('Model harus berupa file di /opt/cctvslm/vision/models.')
    if any(character.isspace() for character in str(model_path)):
        raise SystemExit('Path model tidak boleh mengandung spasi.')
    subprocess.run(['/opt/cctvslm/.venv/bin/pip', 'install', '-r', 'vision/requirements-model.txt'], check=True)
    model = str(model_path)
folder = Path('/etc/slm-cctv')
folder.mkdir(mode=0o700, exist_ok=True)
for channel in channels:
    if not args.channels and channel != 14 and input(f'Aktifkan pemantauan Camera {channel}? [y/N]: ').lower() != 'y':
        continue
    camera_id = subprocess.check_output(
        ['php', 'backend/artisan', 'cctv:register-camera', str(channel)], text=True).strip()
    if not camera_id.isdigit():
        raise SystemExit('ID kamera tidak valid.')
    stream = '01' if channel in (12, 13, 14) else '02'
    url = (f'rtsp://{quote(username, safe="")}:{quote(password, safe="")}@'
           f'{bridge}:8554/Streaming/Channels/{channel}{stream}')
    target = folder / f'camera-{channel}.env'
    target.write_text(f'CCTV_CAMERA_ID={camera_id}\nCCTV_CAMERA_{channel}_URL={url}\n'
                      f'CCTV_LABEL_ENABLED={"true" if channel == 14 else "false"}\n'
                      f'CCTV_LABEL_MODE=qr\nCCTV_PROCESS_FPS={3 if channel in (12, 13, 14) else 2}\n' +
                      (f'CCTV_MODEL_PATH={model}\n' if model and channel in (12, 13) else ''))
    target.chmod(0o600)
    subprocess.run(['systemctl', 'enable', '--now', f'slm-camera@{channel}'], check=True)
    subprocess.run(['systemctl', 'restart', f'slm-camera@{channel}'], check=True)
print('Pekerja kamera dijalankan. Periksa status kamera di dashboard.')
print('QR berisi invoice saja memerlukan pemeriksaan customer dan Aneka Jaya/MJ.')
print('Deteksi dugaan anomali menunggu persetujuan zona dan model yang telah diuji.')
