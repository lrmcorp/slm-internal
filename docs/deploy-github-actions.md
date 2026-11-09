# Deploy SLM lewat GitHub Actions

- **Otomatis**: setiap push ke `main`, workflow **Deploy** (`.github/workflows/deploy.yml`) jalan.
- **Manual**: GitHub > Actions > Deploy > *Run workflow* (branch `main`).

Alurnya:
1. **build** (server GitHub): bangun image Docker, simpan di `ghcr.io/lrmcorp/slm-internal:<commit>` (privat). Gagal build = VPS tidak disentuh.
2. **deploy** (VPS, runner berlabel `slm-vps`): `scripts/deploy-from-image.sh` menyinkronkan folder aplikasi ke commit itu,
   menarik image, migrasi database, restart `slm-app slm-gateway`, lalu cek `/api/health`.
   Migrasi gagal atau aplikasi tidak sehat = kembali ke image sebelumnya.

Runner berjalan di dalam VPS dan menghubungi GitHub dari sana; tidak ada SSH atau port yang dibuka.

## Pasang runner (sekali, sebagai root di VPS)

1. GitHub: repo > Settings > Actions > Runners > **New self-hosted runner** > salin token dari baris `--token` (berlaku 1 jam, jangan dibagikan).
2. Di VPS (ganti path folder aplikasi dan token):
   ```bash
   cd <folder-slm> && git pull && APP=slm APP_DIR=$(pwd) REPO=lrmcorp/slm-internal RUNNER_TOKEN=<token> bash scripts/install-actions-runner.sh
   ```
3. Setelah deploy pertama lewat Actions hijau, matikan timer deploy lama agar tidak dobel.

## Masalah umum

- **Deploy menunggu terus ("Waiting for a runner")**: runner mati. Di VPS: `systemctl status 'actions.runner.*'`.
- **"Folder punya perubahan lokal"**: ada file yang diubah langsung di server. Cek `git status` di folder aplikasi.
- **Log**: tab Actions di GitHub, per langkah.
