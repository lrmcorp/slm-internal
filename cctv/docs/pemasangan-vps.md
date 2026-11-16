# Memasang dashboard pada VPS

Domain yang dipilih adalah **cctv.lrmslm.com**. Panduan ini untuk Ubuntu 24.04. Kode pemasangan sudah disiapkan; menjalankannya di lingkungan pengembangan tidak memasang aplikasi pada VPS toko.

## CCTV di repo SLM (mulai November 2026)

Kode CCTV sekarang ada di repo `lrmcorp/slm-internal`, folder `cctv/`. Di VPS, kodenya ikut clone SLM di `/opt/slm`, tetapi berjalan sebagai stack Docker terpisah (project compose `cctvslm`): deploy atau restart SLM tidak menyentuh CCTV, dan sebaliknya.

| Container | Isi | Batas bawaan |
|---|---|---|
| `cctvslm-web-1` | Dashboard dan API Laravel (`artisan serve`, 4 pekerja), port `127.0.0.1:8095` | 256 MB, 0,5 CPU |
| `cctvslm-worker-1` | Antrian (`queue:work`) dan penjadwal (`schedule:work`) dalam satu container | 256 MB, 0,5 CPU |
| `cctvslm-vision-1` | Satu proses untuk ketiga kamera (satu thread per kamera) | 448 MB, 1 CPU |

### Prasyarat

- Kamera hanya bisa dijangkau lewat **Tailscale**: komputer toko "hype" (`100.118.114.23`) meneruskan port `8554` ke DVR. Tailscale di VPS harus login (`tailscale status`); bila `Logged out`, jalankan `tailscale up`.
- Selama kamera belum terjangkau, worker vision tetap berjalan normal: mencoba lagi dengan jeda bertahap (5 detik sampai paling lama 60 detik), satu baris log per 5 menit, tanpa crash loop dan tanpa mencetak password.
- Nginx host meneruskan `cctv.lrmslm.com` ke `127.0.0.1:8095`. CCTV memanggil SLM lewat `https://mkr.lrmslm.com` (Cloudflare); jangan memakai trik `extra_hosts`, karena nginx mkr menolak koneksi yang tidak datang dari Cloudflare.

### Migrasi satu kali dari `/opt/cctv`

Jalankan sebagai root. Langkah ini tidak menyentuh container SLM, MJ, ANKJY, SLMJ, maupun katalog.

1. Ambil kode terbaru SLM (berisi folder `cctv/`), lalu pindahkan rahasia CCTV. File ini tidak pernah di-commit:

   ```bash
   cd /opt/slm && git pull --ff-only
   ```

   ```bash
   cp -a /opt/cctv/.env /opt/slm/cctv/.env; [ -f /opt/cctv/stack.env ] && cp -a /opt/cctv/stack.env /opt/slm/cctv/; [ -d /opt/cctv/secrets ] && cp -a /opt/cctv/secrets /opt/slm/cctv/; chmod 600 /opt/slm/cctv/.env
   ```

   Pastikan `CCTV_WEB_PORT=8095` ada di `/opt/slm/cctv/.env` (atau biarkan kosong; bawaannya 8095).

2. Bangun image baru:

   ```bash
   cd /opt/slm/cctv && docker compose build
   ```

3. Jalankan. `--remove-orphans` menghapus container lama `queue`, `scheduler`, dan `vision-cam12/13/14` milik project `cctvslm` saja; volume data lama (`cctvslm_cctv_*`) tetap dipakai:

   ```bash
   cd /opt/slm/cctv && docker compose up -d --remove-orphans
   ```

4. Periksa:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8095/login
   ```

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://cctv.lrmslm.com/login
   ```

   Keduanya harus `200`. Lalu lihat log vision dan RAM:

   ```bash
   docker logs --since 5m --tail 30 cctvslm-vision-1; docker stats --no-stream $(docker ps --format '{{.Names}}' | grep '^cctvslm-')
   ```

5. Setelah beberapa hari stabil, arsipkan folder lama:

   ```bash
   tar -czf /root/cctv-lama-$(date +%Y%m%d).tar.gz -C /opt cctv && mv /opt/cctv /opt/cctv.arsip
   ```

### Pembaruan rutin

Workflow GitHub **CCTV · Deploy ke VPS** jalan otomatis bila ada perubahan di `cctv/` pada `main` (variabel repo `CCTV_AUTO_DEPLOY=true` dan secret `CCTV_VPS_*`), atau manual. Secara manual di VPS:

```bash
cd /opt/slm && git pull --ff-only && cd cctv && docker compose up -d --build --remove-orphans
```

### Rollback

Bila versi baru bermasalah, kembalikan kode CCTV ke commit sebelumnya lalu bangun ulang. Data di volume tidak berubah:

```bash
cd /opt/slm && git log --oneline -5 -- cctv
```

```bash
cd /opt/slm/cctv && git checkout <commit-sebelumnya> -- . && docker compose up -d --build --remove-orphans
```

Bila perlu kembali ke susunan lama sepenuhnya (tiga container vision), folder `/opt/cctv` yang belum diarsipkan masih bisa dipakai:

```bash
cd /opt/slm/cctv && docker compose down && cd /opt/cctv && docker compose up -d
```

### Ukur RAM

```bash
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' $(docker ps --format '{{.Names}}' | grep '^cctvslm-')
```

---

Catatan pemasangan di bawah ini berlaku untuk susunan sebelum monorepo.

## Sebelum menjalankan perintah

Pada pengelola DNS `playgo.id`, buat record **A** dengan nama `cctvslm`, menuju **IP publik VPS**. IP Tailscale tidak dipakai untuk DNS publik. Jika terdapat record AAAA, pastikan alamat IPv6 itu benar menuju VPS atau hapus record yang keliru. Izinkan koneksi masuk TCP 80 dan 443 pada firewall VPS dan panel penyedia. Port DVR 554, penerus 8554, dan API lokal 8088 tidak dibuka ke internet.

Siapkan email admin. Skrip akan meminta email dan sandi dashboard di terminal. Kata sandi DVR diminta terpisah saat mengaktifkan kamera; jangan kirimkan keduanya ke chat. Kode tidak menyediakan sandi atau akun bawaan.

## Pemasangan pertama

Jalankan sebagai root di terminal VPS:

```bash
apt-get update
apt-get install -y git
git clone --branch ai-cctv-checker https://github.com/lrmcorp/SLM.git /opt/cctvslm
cd /opt/cctvslm
bash scripts/deploy-vps.sh
```

Jika `/opt/cctvslm` sudah ada, jangan menimpanya. Periksa `git -C /opt/cctvslm status` dan versi kode dahulu. Skrip memasang PHP-FPM 8.3, Nginx, Composer, Python, FFmpeg, serta Tesseract. Dependensi aplikasi mengikuti lockfile Composer dan versi Python yang dicatat. Sertifikat HTTPS diterbitkan melalui Certbot setelah DNS dan port 80 dapat dijangkau. Jika Certbot gagal, dashboard belum siap digunakan; perbaiki DNS/firewall dan jalankan ulang skrip. Skrip mengatur cookie aman sehingga login hanya berfungsi melalui HTTPS.

Antrean dan penjadwal dijalankan oleh systemd. Proses kembali berjalan setelah reboot dan dicoba ulang jika berhenti. Kode aplikasi berada di `/opt/cctvslm`; basis data di `backend/database/database.sqlite`; foto dan video privat di `backend/storage/app/private/cctv`. Jangan menjalankan Docker Compose pengembangan bersamaan dengan layanan produksi pada basis data yang sama.

## Menghubungkan kamera

```bash
cd /opt/cctvslm
python3 scripts/configure-vps-camera.py
```

Masukkan IP Tailscale komputer toko, nama pengguna DVR `dvr`, dan sandinya. Pilihan sandi terlihat disediakan agar mudah diketik. Jangan bagikan foto terminal yang memuat sandi. Penerus Tailscale Serve pada komputer toko harus mengarah ke IP DVR terbaru, port 554, melalui port privat 8554.

Camera **14** membaca label. Camera **13** dan **12** dapat diaktifkan untuk status pemantauan; dugaan anomali belum aktif sampai model barang tersedia dan zona masing-masing kamera disetujui. Skrip tidak menyetujui zona secara otomatis. Setiap kamera memakai proses terpisah. Mulai dengan A14 dan ukur CPU serta penggunaan memori sebelum menambah kamera.

QR dicetak **8 × 8 cm**, termasuk ruang putih di sekelilingnya. Isinya hanya nomor invoice, misalnya `061026-23`, tanpa URL. Nilai disimpan sebagai teks; nol di depan tetap ada. Pola invoice yang didukung saat ini adalah enam angka, tanda hubung, dua angka. Bila format ERP berbeda, aturan perlu disesuaikan berdasarkan contoh nyata.

Mode awal adalah `CCTV_LABEL_MODE=qr`. Kamera membaca QR setiap sekitar dua detik saat proses tersedia. QR yang tidak terbaca tidak menghasilkan invoice tebakan. Bila dua invoice berbeda terbaca sekaligus, proses tidak memilih salah satunya. QR hanya berisi invoice, sehingga customer dan Aneka Jaya/MJ tetap perlu diisi atau diperiksa di dashboard. Catatan ini tidak otomatis dianggap cocok dengan SLM. Mode `auto` dapat dipilih untuk OCR tambahan setelah uji kejelasan dan beban CPU.

## Memeriksa hasil

Buka `https://cctv.lrmslm.com` dan masuk dengan akun yang dibuat. Periksa kamera A14, letakkan label QR, kemudian lihat catatan dan foto bukti. Waktu pertama terlihat ditampilkan dalam WIB. Keberhasilan membaca satu QR uji tidak membuktikan kemampuan 24 jam.

```bash
systemctl status slm-queue slm-scheduler slm-camera@14 --no-pager
journalctl -u slm-camera@14 -n 30 --no-pager
curl -fsS https://cctv.lrmslm.com/up
certbot renew --dry-run
```

Endpoint `/up` memeriksa aplikasi dapat merespons; periksa status kamera dan catatan QR secara terpisah. Jangan membagikan log yang menampilkan alamat RTSP beserta sandinya. Matikan kamera dengan `systemctl stop slm-camera@14`; nonaktifkan saat boot dengan `systemctl disable slm-camera@14`.

Komputer penerus di toko harus tetap menyala, tidak sleep, terhubung ke internet, dan menjalankan Tailscale. Batasi akses port 8554 melalui aturan tailnet hanya dari VPS. Beri DVR IP tetap atau reservasi DHCP agar penerus tidak mengarah ke alamat lama.

## Penyimpanan dan pembaruan

Cadangkan SQLite memakai perintah `.backup` dari `sqlite3`, bersama folder bukti privat. Simpan cadangan di tempat terpisah dan uji pemulihannya. Jangan menyalin basis data yang sedang ditulis sebagai satu-satunya cadangan. Retensi otomatis belum tersedia; tentukan lama simpan bukti dan pantau ruang 100 GB sebelum penggunaan rutin. Konfigurasi dan sandi berada di `backend/.env` serta `/etc/slm-cctv/camera-*.env`; simpan cadangannya secara terenkripsi.

Sebelum memperbarui kode, buat cadangan, periksa perubahan lokal, hentikan pekerja kamera, antrean, dan penjadwal. Ambil commit yang ingin digunakan, jalankan pemasangan kembali, lalu mulai ulang kamera yang sudah dikonfigurasi. Skrip tidak menghapus foto, basis data, atau zona yang sudah disimpan.

API SLM, sinkronisasi foto ke ERP, Firebase/WhatsApp, model barang, dan APK rilis tetap memerlukan konfigurasi serta pengujian terpisah. Tidak ada klaim deteksi anomali atau pengiriman notifikasi nyata sebelum rekaman dan layanan tersebut diuji.

## Laporan orang dan gambar terbaru

Dashboard dan Flutter dapat menampilkan gambar terbaru sekitar setiap dua detik, dengan kotak track anonim jika model deteksi orang sudah dipasang. Video live HLS tersedia saat `CCTV_HLS_DIRECTORY` diarahkan ke penyimpanan privat aplikasi; skrip VPS mengaturnya secara otomatis. Tanpa model, gambar kamera masih bisa ditampilkan, tetapi track dan peringatan orang tidak aktif. Model deteksi harus menyediakan kelas `person` dan ID pelacakan; model barang untuk dugaan anomali tetap memerlukan kalibrasi tersendiri. Dependensi tambahan ada di `vision/requirements-model.txt`. Jangan mengaktifkan peringatan pada operasi nyata sebelum rekaman toko diuji.

Laporan `/reports` menampilkan waktu pertama/terakhir terlihat dan klasifikasi yang ditandai pemeriksa. Batas awal 300 detik dapat diubah pada halaman kamera. Peringatan harus diaktifkan secara sengaja, dan penerima `person_absent` dipilih pada aturan notifikasi. Sistem menahan peringatan ketika heartbeat atau gambar terbaru berhenti, serta ketika sesi pelacakan berubah. ID anonim dapat berubah karena tertutup, sehingga laporan tidak membuktikan orang tertentu pergi dari toko. Tidak ada pencocokan foto wajah atau identitas antarkamera.

Untuk WhatsApp gambar, siapkan template resmi dengan header gambar dan tiga variabel body. Atur `WA_IMAGE_TEMPLATE_NAME`; bila kosong, jalur teks memakai `WA_TEMPLATE_NAME`. Bukti diunggah secara privat ke API media Meta, tidak dipublikasikan sebagai gambar tanpa login. Pengiriman masih perlu diuji dengan akun resmi dan penerima yang bersedia menerima notifikasi. Rincian API tersedia di [dokumen API](api.md).


Video live memakai FFmpeg dan HLS pada direktori privat `backend/storage/app/private/cctv/live-video/<id-kamera>`. Hanya playlist dan beberapa segmen terkini dipertahankan; ini bukan arsip video penuh. Browser memakai hls.js 1.6.13 yang dibundel beserta lisensi, dan Flutter memakai video_player. Playlist serta segmen memerlukan login/token. Mulai satu kamera pada 3 fps dan ukur CPU; bila tertinggal, kurangi beban atau tambah kapasitas. Jeda HLS serta perbedaan laju inferensi perlu diukur pada rekaman nyata.

## VPS yang sudah memakai Nginx Proxy Manager

Jika container `nginx-proxy-manager` sudah mengelola port 80 dan 443, gunakan mode berikut dari checkout `/opt/cctvslm`:

```bash
cd /opt/cctvslm
git pull --ff-only origin ai-cctv-checker
bash scripts/deploy-vps.sh npm
```

Mode ini memasang dependensi, konfigurasi aplikasi, basis data, akun admin, antrean, dan penjadwal. Nginx CCTV berjalan sebagai `slm-web.service` dengan konfigurasi terpisah di `/etc/slm-cctv/nginx.conf`; tidak mengaktifkan layanan Nginx bawaan dan tidak memakai port 80/443. Pekerja kamera mengakses API melalui loopback port 8088. Listener untuk Proxy Manager berada pada alamat gateway jaringan Docker, port 8095. Skrip mencetak alamat gateway yang harus dipakai.

Di panel Proxy Manager, pilih **Hosts → Proxy Hosts → Add Proxy Host**. Isi domain `cctv.lrmslm.com`, scheme `http`, Forward Hostname/IP sesuai alamat gateway yang dicetak skrip, dan Forward Port `8095`. Pada tab SSL, minta sertifikat Let's Encrypt, isi email, setujui ketentuan, dan aktifkan **Force SSL**. Pastikan record Cloudflare masih **DNS only** selama penerbitan sertifikat. Setelah tersimpan, buka `https://cctv.lrmslm.com/up`, lalu login dashboard. Login memerlukan HTTPS karena cookie sesi diatur secure.

Jika jaringan Docker milik Proxy Manager dibuat ulang dan gateway berubah, jalankan ulang pemasangan mode `npm` dan ubah alamat tujuan di Proxy Manager. Tidak ada penghapusan basis data atau bukti pada pemasangan ulang. Mode ini belum membuktikan kamera tersambung: jalankan `python3 scripts/configure-vps-camera.py` setelah web tersedia, lalu periksa status kamera dan bukti terbaru.

## Dependensi PHP saat pemasangan

VPS Ubuntu 24.04 memakai PHP 8.3. Resolusi Composer dikunci melalui `config.platform.php` pada 8.3.0 agar pembaruan dari lingkungan PHP yang lebih baru tidak memilih paket yang gagal dipasang di VPS. Gunakan `composer install` dengan lockfile dari repository. Jika checkout lama melaporkan paket Symfony memerlukan PHP 8.4.1, ambil pembaruan branch, lalu jalankan ulang skrip pemasangan. Jangan menjalankan `composer update` atau mengabaikan persyaratan PHP pada VPS untuk melewati kegagalan.

## Pembaruan tampilan TailAdmin

Dashboard web memakai tata letak dan palet TailAdmin yang diadaptasi ke Laravel Blade. Sidebar menyediakan ringkasan, kamera, label dan invoice, kejadian, laporan orang, serta pengaturan notifikasi. Tersedia tema gelap dan navigasi untuk layar ponsel. Gambar kamera, angka ringkasan, dan status berasal dari aplikasi; tidak ada statistik contoh pada dashboard produksi. Daftar label dan kejadian dapat dipindah halaman. Lisensi MIT TailAdmin disertakan di `backend/public/vendor/tailadmin.LICENSE`.

Pembaruan tampilan tidak memerlukan Node.js atau proses build Next.js di VPS. CSS dan JavaScript disimpan langsung dalam `backend/public`. Dari terminal VPS:

```bash
cd /opt/cctvslm
git pull --ff-only origin ai-cctv-checker
runuser -u www-data -- php backend/artisan view:cache
```

Buka kembali dashboard. Jika tampilan lama masih terlihat, tekan Ctrl+Shift+R. Akun dashboard tetap memakai email dan sandi yang sudah dibuat. Kamera serta antrean tidak perlu dihentikan untuk pembaruan ini. Flutter memakai palet, kartu, form login, dan navigasi yang diselaraskan dengan dashboard. Tema Flutter mengikuti pengaturan terang/gelap perangkat. Pembaruan antarmuka Android memerlukan pemasangan APK dari build GitHub terbaru; menarik kode di VPS tidak memperbarui APK yang sudah terpasang.

## Semua kamera dan sinkronisasi invoice packing

Halaman setelah login menampilkan semua kamera yang terdaftar. Setiap kamera memakai video HLS, dengan gambar terbaru sebagai cadangan. Kamera yang belum mengirim frame akan menampilkan status belum aktif. A12 dan A13 harus dikonfigurasi serta pekerjanya dinyalakan agar videonya muncul; pemasangan A14 saja tidak menyalakan kanal lainnya. Mulai dengan tiga kamera dan pantau beban CPU VPS sebelum menambah kanal.

Di bawah kamera terdapat invoice tertangkap, customer, waktu pertama terlihat, konfirmasi packing, hasil pencocokan SLM, dan status pengiriman. Data diperbarui setiap tiga detik. Packing selesai memerlukan konfirmasi pemeriksa setelah bacaan invoice disetujui.

Untuk memasang pembaruan ini, cadangkan SQLite dan bukti privat dahulu, lalu jalankan:

```bash
cd /opt/cctvslm
git pull --ff-only origin ai-cctv-checker
runuser -u www-data -- php backend/artisan migrate --force
runuser -u www-data -- php backend/artisan config:cache
runuser -u www-data -- php backend/artisan view:cache
systemctl restart slm-queue slm-scheduler
```

Isi `SLM_BASE_URL`, `SLM_LOOKUP_PATH`, `SLM_SYNC_PATH`, dan `SLM_API_TOKEN` secara privat di `backend/.env` setelah developer ERP menyediakan endpoint. Atur `SLM_SYNC_UPLOAD_PHOTO=true` jika foto harus disimpan juga di ERP; endpoint wajib menerima multipart `screenshot`. Setelah mengubah konfigurasi, jalankan `config:cache` dan mulai ulang antrean serta penjadwal. Kredensial jangan dikirim lewat chat. Rincian payload dan respons terdapat di `docs/api.md`.

Status terkirim hanya muncul setelah ERP mengembalikan `saved: true`. Tanpa konfigurasi atau konfirmasi ERP, dashboard menampilkan belum terkirim/menunggu integrasi. Pengiriman otomatis berjalan sesudah pencocokan, tanpa tombol kirim per invoice. Gangguan layanan memicu antrean ulang. `SLM_AUTO_SYNC=false` mematikan pemulihan berkala; sinkronisasi setelah pencocokan tetap berjalan.

Kamera tambahan dapat dipilih melalui `python3 scripts/configure-vps-camera.py --channels 1,2,3,12,13,14`. Pilih kanal yang benar-benar ada dan beri akun DVR izin Remote Live View pada kanal tersebut. Kanal 12–14 memakai main stream; kanal lainnya memakai sub-stream untuk mengurangi beban pemantauan. Decoder dan HLS tetap memakai CPU: VPS 2 vCPU belum diuji untuk 16 stream sekaligus. Mulai dari A12/A13/A14, ukur beban, lalu tambah bertahap. Menampilkan semua kamera tidak membuktikan model deteksi aktif di setiap kanal.

## Tampilan pemantauan AI

Dashboard menyediakan tata letak semua kamera, satu kolom, dua kolom, dan tombol layar penuh pada tiap kamera. Kotak kuning menandai track orang; kotak hijau menandai track objek yang dikenali model. Keduanya memakai ID anonim per kamera dan sesi. Jumlah objek disimpan terpisah dari laporan orang. Kamera tanpa model tidak diberi kotak AI atau hitungan buatan.

Tracking memerlukan `CCTV_MODEL_PATH` yang menunjuk file model yang telah diuji. Nama kelas barang pada model harus sesuai `CCTV_ITEM_CLASS_NAMES`; nilai awalnya `item`. Model umum belum tentu mengenali dus atau barang kecil toko. Uji rekaman, pencahayaan, occlusion, dan beban CPU sebelum operasi rutin. Stream HLS memiliki jeda beberapa detik; ini belum menjadi jaminan video tanpa delay atau ketepatan tracking.

Untuk deployment otomatis, ikuti [panduan GitHub Actions](deployment-github.md).

## Pembaruan beban server (November 2026)

- **Antrean `alerts`:** peringatan (push, WhatsApp, webhook ERP) memakai antrean `alerts` agar tidak menunggu job ERP yang lambat. Pekerja harus berjalan dengan `--queue=alerts,default`. `scripts/receive-vps-deploy.sh` memperbaiki unit `slm-queue` yang lama secara otomatis.
- **Video lewat Nginx:** pemasangan baru mengisi `CCTV_X_ACCEL_REDIRECT=true` dan blok `location /protected-live-video/ { internal; alias …/live-video/; }`. Server lama tetap berfungsi tanpa itu (PHP menyajikan file). Untuk mengaktifkannya di server lama, tambahkan blok `location` yang sama ke konfigurasi Nginx, lalu isi `CCTV_X_ACCEL_REDIRECT=true` di `backend/.env` dan jalankan `php artisan config:cache`.
- **PHP-FPM:** atur `pm.max_children` sekitar 10–15 pada pool `www.conf`; bawaan Ubuntu hanya 5.
- **Rahasia:** `docker compose` kini menolak berjalan bila `CCTV_INGEST_TOKEN` kosong, dan port 8000 hanya terbuka di `127.0.0.1`. Ganti token ingest, token SLM, dan kata sandi DVR yang pernah tercatat di Git.
