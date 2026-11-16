# Panduan Tahapan Kerja & Rencana Implementasi Sistem CCTV SLM

Dokumen ini memuat rencana kerja terstruktur, berurutan, dan detail untuk menyelesaikan seluruh integrasi sistem **AI CCTV Checker · SLM Aneka Jaya** dari tahap persiapan infrastruktur hingga operasional penuh di toko.

---

## Ringkasan Alur Kerja (Roadmap Overview)

```
[Fase 1: Koneksi DVR & RTSP] ──> [Fase 2: VPS & Domain SSL] ──> [Fase 3: Kamera A14 & Label QR]
                                                                        │
[Fase 6: Zona Kamera A12/A13] <── [Fase 5: Model AI Barang] <── [Fase 4: Integrasi ERP SLM]
       │
       ▼
[Fase 7: Notifikasi WA/FCM] ──> [Fase 8: Rilis Aplikasi Mobile] ──> [Fase 9: Retensi & Hardening]
```

---

## FASE 1: Konektivitas DVR Toko & Aliran Stream RTSP (Edge Network)

*Tujuan: Memastikan VPS dapat membaca aliran stream video RTSP dari DVR Hikvision secara stabil dan aman melalui jalur privat VPN tanpa port forwarding publik.*

### Langkah-Langkah Kerja:
1. **Reservasi IP Statis DVR di Jaringan Toko:**
   - Akses antarmuka modem/router toko (ZTE ZXHN F672Y).
   - Buat *DHCP Reservation* untuk MAC Address DVR Hikvision `DS-7216HGHI-M1/T` agar IP lokalnya tidak berubah saat modem restart.
2. **Konfigurasi Jalur Penghubung (Bridge) Tailscale di Toko:**
   - Di komputer Windows toko, pastikan layanan Tailscale berjalan dengan opsi **Run unattended** aktif.
   - Jalankan penerusan port lokal ke DVR melalui PowerShell (Administrator):
     ```powershell
     & "C:\Program Files\Tailscale\tailscale.exe" serve --bg --tcp=8554 tcp://<IP-DVR-LOKAL>:554
     ```
   - Pastikan komputer Windows diatur agar tidak pernah masuk mode *Sleep/Hibernate*.
3. **Penguncian Keamanan Jaringan (Tailscale ACL):**
   - Pada Tailscale Admin Console, buat aturan ACL agar port `8554` pada komputer toko **hanya dapat diakses oleh IP Tailscale milik VPS**, menutup akses dari perangkat lain di tailnet.
4. **Pemeriksaan Akun Pengguna DVR:**
   - Pastikan akun khusus `dvr` pada DVR Hikvision memiliki izin *Remote Live View* untuk kanal **A14, A13, dan A12**.
5. **Uji Coba Autentikasi RTSP dari VPS:**
   - Di terminal VPS, jalankan skrip diagnostik untuk menguji respon RTSP DESCRIBE:
     ```bash
     python3 /opt/cctvslm/scripts/probe-dvr-rtsp.py <IP-TAILSCALE-WINDOWS> <IP-DVR-LOKAL> --channel 14
     ```
   - Masukkan pengguna `dvr` dan sandinya saat diminta interaktif.
   - Pastikan respon menghasilkan status `RTSP/1.0 200 OK`.

### Kriteria Keberhasilan (Definition of Done):
* Skrip probe mengembalikan HTTP 200 (autentikasi Digest MD5/MD5-sess berhasil).
* Satu frame JPEG berhasil diambil dari kanal A14 dan A13 langsung dari VPS.

---

## FASE 2: Penerbitan Server Produksi, Domain & SSL (cctvslm.playgo.id)

*Tujuan: Menayangkan dashboard web secara online melalui HTTPS resmi dengan enkripsi SSL Let's Encrypt.*

### Langkah-Langkah Kerja:
1. **Konfigurasi DNS Domain:**
   - Buka panel DNS pengelola domain `playgo.id`.
   - Buat record **A** baru:
     - Host: `cctvslm`
     - Target IP: `<IP Publik VPS Ubuntu 24.04>`
     - TTL: Otomatis / 300 detik (pastikan mode DNS-only jika menggunakan Cloudflare).
2. **Buka Port Firewall Server:**
   - Di VPS, pastikan port TCP `80` (HTTP) dan `443` (HTTPS) diizinkan pada firewall UFW / security group cloud provider.
3. **Eksekusi Pemasangan VPS:**
   - Jalankan skrip instalasi produksi:
     ```bash
     cd /opt/cctvslm
     bash scripts/deploy-vps.sh
     ```
   - Masukkan nama domain `cctvslm.playgo.id` dan email admin saat diminta.
   - Masukkan kata sandi admin dashboard (minimal 12 karakter).
4. **Verifikasi Web Service & SSL:**
   - Periksa status layanan systemd:
     ```bash
     systemctl status slm-web slm-queue slm-scheduler --no-pager
     curl -fsS https://cctvslm.playgo.id/up
     ```
   - Buka `https://cctvslm.playgo.id` di browser, pastikan sertifikat SSL valid dan lakukan login menggunakan akun admin yang baru dibuat.

### Kriteria Keberhasilan (Definition of Done):
* Endpoint `/up` merespons HTTP 200.
* Halaman login web tampil sempurna dan login berhasil dengan cookie sesi berflag `Secure`.

---

## FASE 3: Operasional Kamera A14 & Uji Pembacaan Label QR Nyata

*Tujuan: Mengaktifkan pemantauan Kamera A14 khusus pembacaan label fisik dus dengan QR Code 8×8 cm di area penyiapan toko.*

### Langkah-Langkah Kerja:
1. **Konfigurasi Worker Kamera 14:**
   - Di VPS, jalankan konfigurasi interaktif:
     ```bash
     cd /opt/cctvslm
     python3 scripts/configure-vps-camera.py --channels 14
     ```
   - Masukkan IP Tailscale komputer toko dan kredensial akun `dvr`.
   - Skrip akan mendaftarkan Kamera 14 dan membuat file `/etc/slm-cctv/camera-14.env` dengan parameter:
     - `CCTV_LABEL_ENABLED=true`
     - `CCTV_LABEL_MODE=qr`
     - `CCTV_PROCESS_FPS=3`
2. **Mulai Layanan Kamera 14:**
   - Aktifkan worker via systemd:
     ```bash
     systemctl enable --now slm-camera@14
     journalctl -u slm-camera@14 -f
     ```
3. **Pencetakan Label Uji di Toko:**
   - Cetak label fisik ukuran 8 × 15 cm dengan QR Code ukuran 8 × 8 cm.
   - Isi payload QR hanya nomor invoice murni, contoh: `061026-23` (tanpa URL atau prefix tambahan).
4. **Uji Coba Lapangan (Real Test):**
   - Letakkan dus berlabel di depan Kamera A14 pada pencahayaan dan jarak operasional toko.
   - Buka menu **Label & Invoice** pada dashboard web `https://cctvslm.playgo.id`.
   - Pastikan invoice tertangkap otomatis:
     - Nomor invoice terbaca utuh (nol di depan tidak hilang).
     - Foto bukti (*snapshot*) tersimpan di storage privat dan muncul di dashboard.
     - Status review tercatat `pending` (karena nama customer dan brand unit usaha perlu dikonfirmasi manusia).
5. **Uji Verifikasi Manusia (Human Review):**
   - Admin melengkapi nama customer (`TK HANSEL ASK`) dan unit usaha (`ANEKA JAYA` atau `MJ`), lalu klik **"Konfirmasi bacaan"**.

### Kriteria Keberhasilan (Definition of Done):
* 10 dari 10 sampel dus berlabel QR terbaca dengan benar oleh sistem tanpa salah karakter.
* Foto bukti label tersimpan privat di server dan dapat dibuka oleh admin yang login.

---

## FASE 4: Integrasi API ERP SLM (`slm.playgo.id`)

*Tujuan: Menghubungkan sistem CCTV dengan ERP SLM agar invoice yang tertangkap otomatis dicocokkan dan status packing tersinkronisasi.*

### Langkah-Langkah Kerja:
1. **Serah Terima Dokumentasi ke Pengembang ERP:**
   - Serahkan paket dokumentasi yang ada di folder `docs/`:
     - [docs/api.md](api.md) (Spesifikasi API)
     - [docs/integrasi-erp-slm.md](integrasi-erp-slm.md) (Kontrak integrasi ERP)
     - [docs/openapi.json](openapi.json) (Skema OpenAPI 3.0)
     - [docs/postman-cctv-slm.json](postman-cctv-slm.json) (Koleksi Postman)
2. **Penyediaan Endpoint oleh Tim ERP:**
   - Tim ERP SLM menyediakan dua endpoint resmi:
     1. `POST /api/cctv/labels/lookup`: Menerima JSON `{ invoice_number, customer_name, source_label, integration_marker }`, membalas `{ "matched": true, "reference": "..." }`.
     2. `POST /api/cctv/labels/sync`: Menerima data label, event type (`invoice_captured` atau `packing_completed`), idempotency key, dan opsional foto bukti.
   - Tim ERP menerbitkan `Bearer Token` otorisasi integrasi.
3. **Pembaruan Konfigurasi di VPS:**
   - Buka `/opt/cctvslm/backend/.env`, isi variabel integrasi:
     ```env
     SLM_BASE_URL=https://slm.playgo.id
     SLM_LOOKUP_PATH=/api/cctv/labels/lookup
     SLM_SYNC_PATH=/api/cctv/labels/sync
     SLM_SYNC_UPLOAD_PHOTO=true
     SLM_API_TOKEN=<token-resmi-dari-erp>
     SLM_AUTO_SYNC=true
     ```
   - Refresh konfigurasi aplikasi:
     ```bash
     runuser -u www-data -- php /opt/cctvslm/backend/artisan config:cache
     systemctl restart slm-queue slm-scheduler
     ```
4. **Uji Coba Alur Sinkronisasi Penuh:**
   - Tangkap 1 invoice uji -> Konfirmasi bacaan di dashboard -> Sistem otomatis memanggil lookup ERP -> Status berubah menjadi `matched`.
   - Petugas packing mengklik tombol **"Konfirmasi packing selesai"** di dashboard -> Job `SyncMatchedLabelToSlm` berjalan -> Mengirim payload `packing_completed` ke ERP -> ERP membalas `{"saved": true}` -> Status berubah menjadi `synced`.

### Kriteria Keberhasilan (Definition of Done):
* Data invoice, foto bukti, dan waktu packing berhasil masuk ke database ERP `slm.playgo.id`.
* Pengiriman berulang dengan idempotency key yang sama tidak membuat data ganda di ERP.

---

## FASE 5: Dataset & Pelatihan Model AI Deteksi Barang (YOLO)

*Tujuan: Membangun model computer vision yang mampu mendeteksi objek barang toko (1–3 pcs) dan orang secara akurat pada kondisi toko nyata.*

### Langkah-Langkah Kerja:
1. **Pengambilan Sampel Rekaman Toko:**
   - Ambil rekaman asli dari DVR kanal A12 dan A13 berdurasi 10–15 menit pada kondisi siang hari (terang) dan malam hari (lampu toko).
   - Pastikan rekaman memperlihatkan orang memindahkan barang, membawa dus, dan berjalan di sekitar batas toko.
2. **Anotasi Data (Labeling):**
   - Ekstrak frame video menjadi gambar (sekitar 500–1.000 frame).
   - Beri label bounding box untuk 2 kelas utama:
     - `person` (orang/staf/customer)
     - `item` (barang/dus/paket yang dipantau)
3. **Pelatihan Model (Training):**
   - Latih model YOLOv8n / YOLO11n menggunakan library `ultralytics`.
   - Target performa: mAP@50 minimal 0.85 dengan latensi inferensi di bawah 100 ms per frame pada CPU VPS (atau menggunakan akselerasi GPU).
4. **Pemasangan Model di VPS:**
   - Simpan bobot model hasil pelatihan di: `/opt/cctvslm/vision/models/barang.pt`.
   - Pasang dependensi YOLO di virtualenv:
     ```bash
     /opt/cctvslm/.venv/bin/pip install -r /opt/cctvslm/vision/requirements-model.txt
     ```
   - Uji pemuatan model dengan Python CLI untuk memastikan tidak ada error library.

### Kriteria Keberhasilan (Definition of Done):
* Model `barang.pt` berhasil dimuat oleh script worker tanpa pesan warning `No parcel detector model configured`.
* Objek orang dan barang terdeteksi dengan kotak pembatas (*bounding box*) pada frame pengujian.

---

## FASE 6: Kalibrasi & Persetujuan Zona Anomali (Kamera 12 & 13)

*Tujuan: Mengatur batas toko, area barang, dan jalur sah agar logika deteksi anomali dapat aktif secara valid.*

### Langkah-Langkah Kerja:
1. **Pendaftaran Kamera 12 & 13 di VPS:**
   - Jalankan konfigurasi kamera:
     ```bash
     python3 /opt/cctvslm/scripts/configure-vps-camera.py --channels 12,13
     ```
   - Masukkan path model `/opt/cctvslm/vision/models/barang.pt` saat ditanya.
   - Mulai layanan: `systemctl enable --now slm-camera@12 slm-camera@13`.
2. **Unggah Frame Referensi Operasional:**
   - Buka dashboard `https://cctvslm.playgo.id/cameras/<id-kamera>`.
   - Unggah 1 frame gambar bersih yang diambil langsung dari stream RTSP kamera tersebut.
3. **Menggambar 4 Poligon Zona:**
   - Menggunakan canvas interaktif di dashboard, gambar 4 zona dengan teliti:
     1. `store_boundary`: Poligon batas area dalam toko.
     2. `box_area`: Poligon area tumpukan/asal barang diletakkan.
     3. `packing_route`: Poligon jalur jalan yang sah menuju meja packing.
     4. `danger_zone`: Poligon area luar / jalan abu-abu di sebelah kiri pembatas.
   - Klik **"Simpan semua zona"**.
4. **Pemeriksaan & Persetujuan Admin:**
   - Periksa kembali letak zona bersama pemilik toko.
   - Klik tombol **"Setujui penempatan zona"** di panel Status kamera (mengisi field `zones_approved_at`).
5. **Uji Simulasi Lapangan:**
   - **Skenario Normal:** Staf mengambil barang dari `box_area`, berjalan melalui `packing_route` menuju meja packing. -> Pastikan sistem **tidak** membunyikan anomali.
   - **Skenario Anomali:** Seseorang mengambil 1–3 barang dari `box_area` lalu langsung melangkah melintasi pembatas menuju `danger_zone` tanpa lewat `packing_route`. -> Pastikan sistem **segera** menerbitkan insiden dugaan anomali.

### Kriteria Keberhasilan (Definition of Done):
* Status zona di database terisi `zones_approved_at` dan `zones_approved_by`.
* Simulasi pelanggaran menghasilkan rekaman klip MP4 3 detik dan tercatat di menu **Kejadian**.

---

## FASE 7: Konfigurasi Notifikasi Multikanal (Push, WhatsApp, Email)

*Tujuan: Memastikan peringatan anomali atau kamera mati terkirim dalam hitungan detik ke ponsel penanggung jawab.*

### Langkah-Langkah Kerja:
1. **Konfigurasi Firebase Cloud Messaging (FCM HTTP v1):**
   - Buat proyek di Firebase Console.
   - Buka **Project Settings → Service Accounts**, generate private key JSON baru.
   - Simpan file tersebut di server: `/opt/cctvslm/secrets/firebase.json` (chmod 600).
   - Di `/opt/cctvslm/backend/.env`, set:
     ```env
     FCM_PROJECT_ID=<project-id-firebase>
     FCM_SERVICE_ACCOUNT_FILE=/opt/cctvslm/secrets/firebase.json
     ```
2. **Konfigurasi WhatsApp Cloud API (Meta):**
   - Di Meta for Developers, daftarkan akun WhatsApp Business API.
   - Daftarkan nomor pengirim bisnis dan dapatkan System User Access Token permanen.
   - Ajukan template pesan resmi bahasa Indonesia dengan 3 variabel teks (`{{1}}` Judul, `{{2}}` Ringkasan/Waktu/Kamera, `{{3}}` Tautan Detail HTTPS).
   - Opsi: Buat template dengan header gambar untuk mengirim foto snapshot kejadian.
   - Di `.env`, set:
     ```env
     WA_PHONE_NUMBER_ID=<id-nomor-telepon-meta>
     WA_ACCESS_TOKEN=<token-akses-meta>
     WA_TEMPLATE_NAME=<nama-template-teks-disetujui>
     WA_IMAGE_TEMPLATE_NAME=<nama-template-gambar-disetujui>
     ```
3. **Konfigurasi Email SMTP:**
   - Atur kredensial SMTP penyedia email di `.env` (`MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`).
4. **Pendaftaran Aturan Penerima di Dashboard:**
   - Buka menu **Pengaturan Notifikasi** di dashboard.
   - Tambahkan nomor WhatsApp admin format internasional (`+628...`).
   - Aktifkan notifikasi untuk jenis:
     - `anomaly` (dugaan anomali barang)
     - `camera_offline` (kamera DVR terputus)
     - `worker_offline` (proses pemantauan terhenti > 60 detik)
     - `person_absent` (track orang tidak terlihat > 300 detik)
5. **Uji Pengiriman Nyata:**
   - Lakukan uji pemicu insiden: pastikan pesan masuk ke WhatsApp, email masuk ke inbox, dan push notification muncul di HP.

### Kriteria Keberhasilan (Definition of Done):
* Notifikasi WhatsApp dan Push diterima di ponsel dalam waktu < 15 detik setelah kejadian terdeteksi.

---

## FASE 8: Rilis Aplikasi Mobile (Android & iOS)

*Tujuan: Memasang aplikasi native di smartphone pemilik dan staf toko untuk memantau kamera live dan memeriksa bukti kejadian.*

### Langkah-Langkah Kerja:
1. **Build APK Rilis Android:**
   - Buat Android Keystore resmi untuk penandatanganan rilis (`key.jks`).
   - Siapkan konfigurasi build dengan parameter environment:
     ```bash
     flutter build apk --release \
       --dart-define=API_BASE_URL=https://cctvslm.playgo.id \
       --dart-define=FIREBASE_API_KEY=<key> \
       --dart-define=FIREBASE_APP_ID=<app-id-android> \
       --dart-define=FIREBASE_PROJECT_ID=<project-id> \
       --dart-define=FIREBASE_SENDER_ID=<sender-id>
     ```
   - Pasang file `app-release.apk` ke smartphone Android penguji toko.
2. **Persiapan Apple iOS / TestFlight (Jika Diperlukan):**
   - Daftarkan akun Apple Developer Program.
   - Daftarkan Bundle ID `id.anekajaya.aiCctvChecker` di Apple Developer Portal.
   - Buat Distribution Certificate dan Provisioning Profile dengan entitlement Push Notifications & APNs.
   - Jalankan workflow GitHub Actions `Distribute iPhone with TestFlight` dengan memasukkan Secrets API Key App Store Connect.
   - Undang pemilik toko melalui aplikasi TestFlight di iPhone.
3. **Verifikasi Aplikasi di Smartphone:**
   - Login menggunakan akun staf/admin.
   - Buka pemutar live video HLS (pastikan video mengalir lancar).
   - Buka notifikasi insiden: pastikan video MP4 3 detik dapat diputar dan tombol review ("Peringatan keliru" / "Perlu tindak lanjut") berfungsi.

### Kriteria Keberhasilan (Definition of Done):
* Aplikasi terpasang di smartphone Android dan/atau iPhone, login berhasil, push notification aktif, dan video bukti dapat diputar.

---

## FASE 9: Pemeliharaan Server, Retensi Data Otomatis & Hardening

*Tujuan: Menjamin keandalan sistem jangka panjang tanpa risiko kehabisan ruang disk 100 GB atau kebocoran memori.*

### Langkah-Langkah Kerja:
1. **Pembuatan Skrip Pembersihan Otomatis (Evidence Pruning):**
   - Buat perintah artisan baru (contoh: `php artisan cctv:prune-evidence --days=30`) untuk menghapus rekaman snapshot dan klip MP4 lama yang sudah berumur lebih dari 30 hari.
   - Daftarkan perintah tersebut ke cron scheduler harian di [backend/routes/console.php](file:///Users/lrmcorporation/Documents/Website/cctvslm/backend/routes/console.php).
2. **Pembersihan Folder Spool:**
   - Buat cron job mingguan untuk memeriksa folder spool `/var/lib/slm-cctv/spool/` dan menghapus berkas yang sudah berhasil disinkronkan ke server.
3. **Pencadangan Basis Data Otomatis:**
   - Buat cron job harian untuk mencadangkan database SQLite menggunakan perintah aman:
     ```bash
     sqlite3 /opt/cctvslm/backend/database/database.sqlite ".backup '/opt/cctvslm-backups/cctv_$(date +%F).sqlite'"
     ```
   - Sinkronkan cadangan ke penyimpanan cloud terpisah / Google Drive / S3.
4. **Monitoring Resource Server:**
   - Pantau utilisasi CPU dan RAM saat 3 kamera berjalan bersamaan dengan perintah `htop` dan `systemctl status`.
   - Pastikan CPU VPS 2 vCPU tidak mengalami beban lebih dari 85% secara berkelanjutan.

### Kriteria Keberhasilan (Definition of Done):
* Ruang disk terpantau stabil di bawah 60% pemakaian berkat rotasi otomatis 30 hari.
* Cadangan basis data harian tercipta secara rutin dan dapat dipulihkan (*restore verified*).

---

## Matriks Tanggung Jawab & Dependensi

| Fase | Deskripsi Pekerjaan | Penanggung Jawab Utama | Ketergantungan (Prasyarat) |
|---|---|---|---|
| **Fase 1** | Koneksi DVR & RTSP Stream | Teknisi Toko / DevOps | DVR menyala, Tailscale PC toko aktif |
| **Fase 2** | VPS, Domain & SSL | DevOps / Sysadmin | Akses DNS domain `playgo.id`, VPS siap |
| **Fase 3** | Kamera A14 & Label QR | Admin Toko & Engineer | Fase 1 & 2 selesai, label cetak siap |
| **Fase 4** | Integrasi API ERP SLM | Pengembang ERP SLM | Dokumentasi API diterima tim ERP |
| **Fase 5** | Dataset & Model AI YOLO | AI / CV Engineer | Rekaman video toko siang & malam |
| **Fase 6** | Zona Anomali Kamera 12/13 | Pemilik Toko & Admin | Fase 1 & 5 selesai |
| **Fase 7** | Notifikasi WA, Push, Email | DevOps / Backend | Akun Meta Developer, Proyek Firebase |
| **Fase 8** | Rilis Aplikasi Mobile | Mobile Developer | Fase 2 & 7 selesai |
| **Fase 9** | Retensi & Pemeliharaan | Backend & DevOps | Seluruh sistem sudah operasional |
