# Deployment otomatis CCTV dari GitHub

Workflow `Deploy CCTV to VPS` menguji backend sebelum mengirim commit ke server. Pengiriman memakai Git bundle melalui SSH; VPS tidak perlu mengunduh kode dari GitHub. Jika Composer lockfile berubah, pemasangan dependensi masih memerlukan koneksi internet VPS. Perubahan dependensi Python dihentikan untuk pemasangan dan pengujian terpisah.

## Persiapan satu kali di VPS

Jalankan dari terminal VPS sebagai root setelah kode terbaru tersedia:

```bash
cd /opt/cctvslm
git pull --ff-only origin ai-cctv-checker
ss -ltnp | awk '/sshd/'
bash scripts/setup-actions-deploy.sh
```

Masukkan port SSH yang terlihat pada panel VPS atau keluaran `ss`. Jangan memakai port dashboard 443 atau 8095. Jika DNS GitHub belum terbaca, perbaiki resolver sebelum pengambilan kode pertama. Skrip membuat kunci khusus yang hanya diizinkan menjalankan receiver CCTV. Login admin biasa tidak diubah.

## Isi GitHub Secrets

Buka repository **lrmcorp/SLM → Settings → Secrets and variables → Actions → Secrets → New repository secret**. Tambahkan:

| Nama | Isi |
|---|---|
| `CCTV_VPS_HOST` | `31.97.51.194` |
| `CCTV_VPS_PORT` | Port SSH yang tadi dimasukkan |
| `CCTV_VPS_USER` | `root` |
| `CCTV_VPS_SSH_KEY` | Seluruh isi `/root/.ssh/slm_cctv_actions`, termasuk baris BEGIN dan END |
| `CCTV_VPS_KNOWN_HOSTS` | Isi `/root/.ssh/slm_cctv_known_hosts` |

Untuk menyalin kunci ke kotak Secret GitHub, lihat langsung di terminal pribadi:

```bash
cat /root/.ssh/slm_cctv_actions
```

Jangan kirim isinya ke chat, email, issue, atau repository. Kunci hanya disimpan melalui kotak Secret GitHub. Untuk nilai known hosts gunakan `cat /root/.ssh/slm_cctv_known_hosts`; ini merupakan identitas publik server, bukan sandi. Host key harus cocok dengan server yang Anda kelola. Workflow menolak koneksi jika identitas server berubah.

Pada tab **Variables**, buat repository variable `CCTV_AUTO_DEPLOY` dengan nilai `true`. Workflow memakai environment `cctv-production`; Anda dapat membatasi branch environment tersebut ke `ai-cctv-checker`. Jika memasang approval wajib pada environment, deployment menunggu approval itu.

## Jalankan dan periksa

Buka **Actions → Deploy CCTV to VPS → Run workflow**, pilih `ai-cctv-checker`. Setelah deployment pertama berhasil, push yang mengubah backend, vision, atau skrip memicu deployment berikutnya secara otomatis. Push yang hanya mengubah Flutter tetap memakai workflow APK.

Receiver menolak perubahan lokal pada file terlacak dan riwayat yang bukan fast-forward. Sebelum perubahan, receiver membuat backup SQLite serta mencatat commit lama di `/opt/cctvslm-backups`. Kamera aktif dan antrean dihentikan sebentar saat aplikasi berada dalam maintenance. Setelah migrasi dan cache selesai, layanan itu dimulai kembali dan `/up` diperiksa. Ada jeda pemantauan selama deployment; waktu dan ID track dapat berubah saat pekerja kamera dimulai ulang.

Jika deployment gagal setelah maintenance dimulai, aplikasi tetap dalam maintenance dan workflow berstatus gagal. Periksa langkah gagal dan backup sebelum pemulihan; jangan menganggap kode atau skema sudah otomatis dikembalikan. Setelah penyebab diperbaiki dan migrasi/cache selesai, jalankan `runuser -u www-data -- php backend/artisan up`, lalu mulai ulang layanan CCTV yang diperlukan. Retensi backup otomatis belum tersedia; pantau kapasitas disk.

Konfigurasi awal Secrets, keterjangkauan SSH dari GitHub, receiver, serta deployment pertama harus berhasil sebelum fitur deployment otomatis dianggap aktif. Menyimpan workflow di GitHub tidak memasang aplikasi ke VPS.
