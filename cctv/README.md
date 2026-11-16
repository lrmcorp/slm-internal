# AI CCTV Checker · SLM Aneka Jaya

Prototipe pemantauan CCTV berbasis Laravel, pemroses video Python, dan aplikasi Flutter Android. Setiap dugaan anomali harus diperiksa manusia. Satu rekaman Camera 13 sepanjang 5,28 detik sudah diperiksa; sistem belum dikalibrasi atau diuji untuk pemakaian 24 jam di toko.

Untuk menayangkan dashboard di internet, ikuti [daftar kebutuhan dan urutan pemasangan](docs/panduan-online.md). Untuk menghubungkan DVR toko ke VPS Ubuntu 24.04, ikuti [panduan VPN DVR–VPS](docs/koneksi-dvr-vps.md). Menerbitkan lingkungan pengembangan Codex tidak menayangkan dashboard kepada pengguna toko.

Pemasangan produksi pada domain **cctv.lrmslm.com** tersedia dalam [panduan VPS](docs/pemasangan-vps.md). Pemilik sudah berhasil mengambil gambar A14 dari VPS melalui Tailscale. A14 dipakai untuk label; A12 dan A13 untuk pemeriksaan dugaan anomali. Label cetak 8 × 15 cm dan QR 8 × 8 cm telah dipilih. QR hanya berisi nomor invoice, tanpa URL. Dukungan QR sudah diuji dengan gambar buatan pada empat orientasi; QR cetak nyata, pemasangan produksi, API SLM, dan pengiriman notifikasi nyata belum diuji.

## Yang sudah tersedia

- Pembacaan video RTSP berkelanjutan, pemeriksaan tanda hidup kamera, dan peringatan jika kamera atau proses pemantauan berhenti lebih dari 60 detik.
- OCR label pada empat orientasi. Nomor invoice seperti `061026-23` disimpan sebagai teks sehingga nol di depan tidak hilang; bidang kedua adalah nama customer seperti `TK HANSEL ASK`. Bacaan ragu diberi status `pending`, waktu pertama terlihat dan gambar bukti disimpan privat. Pemeriksa dapat mengoreksi/menolak bacaan melalui dashboard sebelum pencocokan SLM.
- Editor zona per kamera untuk batas toko, area asal barang, dan jalur pengemasan. Deteksi anomali **tidak diaktifkan** sebelum admin menyetujui ketiga zona.
- Aturan dugaan 1–3 objek yang terlacak dari area asal barang ke luar batas toko dekat seseorang tanpa melewati jalur pengemasan. Aturan memerlukan model deteksi barang yang dilatih pada rekaman toko; tanpa model itu proses pemantauan tetap membaca label dan memeriksa kamera, tetapi tidak mengeluarkan dugaan anomali.
- Foto dan cuplikan sekitar tiga detik saat dugaan anomali (sekitar 1,5 detik sebelum dan 1,5 detik sesudah), keputusan pemeriksa, API dengan token akses untuk Flutter, serta antrean notifikasi yang mencegah pengiriman ganda dan mencoba ulang jika gagal sementara.
- Jalur push Firebase Cloud Messaging (FCM HTTP v1) dan opsi WhatsApp Cloud API memakai template resmi. Keduanya memerlukan akun dan kredensial server milik Anda.

## Sebelum menyalakan kamera nyata

1. Kamera yang dilaporkan: `DS-2CE78DOT` dan `DS-2CE76DOT`; DVR: **Hikvision `DS-7216HGHI-M1/T (NEW)`**. Keluarga `DS-2CE` umumnya kamera analog Hikvision Turbo HD yang masuk ke DVR; server mengambil stream dari **perekam yang mendukung RTSP**, bukan langsung dari kamera analog atau akun Hik-Connect. Mohon versi firmware, nomor kanal fisik Camera 13, dan uji RTSP pada unit yang terpasang. Format Hikvision sering memakai `/Streaming/Channels/<kanal>01` untuk stream utama, tetapi dukungan dan jalurnya belum diverifikasi pada DVR ini. Akun Hik-Connect biasa **belum membuktikan** bahwa server dapat mengambil stream secara resmi. Berikan rekaman asli 5–10 menit siang dan malam yang memperlihatkan label dan perpindahan barang.
2. Arti bidang pertama `061026-23` sudah dikonfirmasi sebagai **nomor invoice** dari `mkr.lrmslm.com`; bidang kedua `TK HANSEL ASK` adalah **nama customer**. Tulisan `SIP` pada sketsa diganti menjadi `Aneka Jaya` atau `MJ` pada label cetak. Mohon berikan ukuran cetak lebar × tinggi. Untuk `MJ`, adaptor SLM mengirim penanda `MJ INtegration`; format endpoint dan respons masih harus disesuaikan dengan dokumentasi SLM.
3. Tunjukkan lokasi asal barang dan jalur yang sah menuju pengemasan. Admin menempatkan zona pada gambar kamera melalui dashboard, lalu **Anda memeriksa dan menyetujui** hasilnya. Dus yang tampak pada video Camera 13 diabaikan sebagai penentu zona asal.
4. Berikan dokumentasi API dan akses uji `mkr.lrmslm.com`, termasuk aturan pencarian invoice, customer, dan `MJ INtegration`. Sampai kontrak API dikonfirmasi, hasil pencocokan ditampilkan `unavailable`; sistem tidak menebak kecocokan.
5. Periksa ukuran label dalam piksel pada rekaman **hasil DVR**, bukan hanya foto kamera, saat dus bergerak; nilai sudut pandang, blur, pantulan, pencahayaan, dan apakah 1–3 pcs terlihat sebagai objek terpisah. Spesifikasi resolusi/lensa dua kamera belum dapat dipastikan tanpa sufiks lengkap. Bila huruf atau barang kecil tidak cukup jelas, geser kamera/dekatkan fokus, tambah cahaya, atau gunakan kamera khusus label/area keluar. Pengujian wajib memakai stream utama DVR pada resolusi dan bitrate operasional.

**Camera 13:** satu video singkat dan foto pembatas sudah diterima. [Draf penempatan zona](docs/camera-13-review.md) menandai jalan di kiri sebagai danger zone dan bagian ubin di kanan tembok sebagai area packing; pemilik telah mengonfirmasi kedua area pada pratinjau. Dus yang tampak tidak digunakan sebagai acuan. Draf ini belum disetujui untuk deteksi karena batas toko, lokasi asal barang, dan jalur yang sah belum lengkap.

## Pemasangan di server Linux

VPS sudah dipilih sebagai lokasi server: **Ubuntu 24.04, 2 vCPU, RAM 8 GB, NVMe 100 GB, transfer 8 TB**, satu snapshot dan cadangan mingguan. Periode kuota transfer perlu dipastikan. Mulai dengan **satu kamera** untuk mengukur beban; OCR empat arah dan model barang mungkin membutuhkan lebih banyak CPU atau GPU bila beberapa kamera diproses bersamaan. VPS membutuhkan Docker dan Docker Compose, serta VPN atau jalur privat ke DVR di toko. Disk 100 GB dipakai untuk aplikasi dan bukti kejadian, bukan rekaman penuh 24 jam. Perintah di bawah menjalankan aplikasi hanya pada `127.0.0.1:8000` di VPS. Akses melalui internet memerlukan domain, HTTPS, dan reverse proxy. Port RTSP DVR dan port 8000 tetap tertutup dari internet. Rincian kebutuhan yang masih terbuka ada di [panduan online](docs/panduan-online.md).

```bash
cd /workspace/SLM
bash scripts/setup.sh
docker compose run --rm --no-deps web php artisan cctv:create-admin anda@contoh.com
bash scripts/start.sh
docker compose ps
curl -fsS http://127.0.0.1:8000/up
```

`scripts/setup.sh` menyalin contoh konfigurasi ke `.env` yang diabaikan Git, membuat token ingest acak dan `APP_KEY`, memasang dependensi dari lockfile, menjalankan migrasi, dan membangun image pemroses video. CA bundle mesin dipakai untuk TLS Composer/Python tanpa menonaktifkan verifikasi. Perintah dapat diulang. Kata sandi admin diminta interaktif dan tidak ditulis pada riwayat shell.

Susunan Docker Compose ini dipakai untuk pengembangan dan uji. Sebelum akses umum dibuka, pasang server web produksi dengan HTTPS, atur `backend/.env` (`APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://nama-domain-anda`), dan aktifkan cookie aman. Cadangkan basis data SQLite (`backend/database/database.sqlite`) serta bukti privat (`backend/storage/app/private/cctv`). Untuk banyak kamera, rencanakan PostgreSQL. Tentukan lama penyimpanan bukti dan ruang disk yang diperlukan.

### Menambah kamera dan zona

Masuk ke dashboard melalui domain HTTPS, tambah kamera dengan nama variabel seperti `CCTV_CAMERA_1_URL`, lalu unggah satu gambar dari stream DVR yang akan digunakan. Gambar batas toko, area asal barang, dan jalur pengemasan yang sah; simpan, periksa posisinya, lalu setujui. Dus yang tampak pada contoh Camera 13 tidak dijadikan area asal barang. Simpan URL stream DVR hanya pada `.env` server, misalnya `CCTV_CAMERA_1_URL=rtsp://...`; simpan kata sandi perekam di server, bukan di Git. Pakai akun baca-saja pada DVR. Jalur RTSP, nomor kanal, dan izin akun harus dikonfirmasi pada model perekam yang sebenarnya.

Masukkan ID kamera dari dashboard ke `CCTV_CAMERA_ID` di `.env`. Jalankan satu pekerja untuk kamera tersebut:

```bash
docker compose --profile camera up -d vision
docker compose logs -f vision
```

Untuk kamera tambahan, jalankan container pekerja terpisah dengan `CCTV_CAMERA_ID` berbeda dan URL stream sesuai nama variabel kamera pada `.env`. Contoh: `docker compose --profile camera run -d -e CCTV_CAMERA_ID=2 vision`. Jangan gunakan `--scale vision` tanpa memberikan ID berbeda untuk tiap container.

### SLM, model, dan notifikasi

- `SLM_BASE_URL`, `SLM_LOOKUP_PATH`, dan `SLM_API_TOKEN` mengaktifkan pemeriksaan kecocokan invoice setelah kontrak API SLM diuji. ERP yang disebut adalah `mkr.lrmslm.com`, tetapi URL API dan otorisasinya belum diberikan. Endpoint **contoh sementara** menerima `invoice_number`, `customer_name`, `source_label`, dan `integration_marker`; respons contoh adalah `{ "matched": true, "reference": "..." }`. Ketiga bidang label harus lengkap sebelum permintaan cocok SLM.
- Foto label disimpan di penyimpanan privat aplikasi sejak pertama kali terbaca. Setelah invoice cocok, status pengiriman ke ERP ditampilkan di dashboard. `SLM_SYNC_PATH` sengaja kosong sampai endpoint ERP disepakati. Jika SLM cukup menerima data dan tautan aman ke foto, gunakan `SLM_SYNC_UPLOAD_PHOTO=false`; jika API SLM meminta berkas gambar, gunakan `true`. Tautan foto tetap memerlukan login dashboard. Setelah konfigurasi selesai, `docker compose exec -T web php artisan cctv:sync-matched-labels` dapat mengantrekan ulang catatan yang sudah cocok. Tidak ada pengiriman nyata ke SLM sebelum API dan akses uji tersedia.
- Opsional: `CCTV_AI_API_KEY` adalah kunci **OpenAI API server** tersendiri, dan `CCTV_AI_MODEL` memilih model. Hanya label OCR yang ragu yang dikirim ke Responses API untuk saran kedua; gambar kamera dikirim ke penyedia jika opsi ini diaktifkan. Saran tidak mengganti bacaan atau mencocokkan SLM tanpa keputusan manusia. Periksa izin data, biaya API, dan akses HTTPS ke `api.openai.com` dahulu. Langganan Codex/chat tidak dipakai sebagai kunci API.
- Model deteksi paket/pcs yang sesuai diletakkan di server, misalnya `vision/models/barang.pt`, dengan `CCTV_MODEL_PATH=/app/models/barang.pt`, `CCTV_ITEM_CLASS_NAMES=item`, dan `CCTV_WITH_MODEL=1`. Bangun ulang `docker compose build vision`; sebelum model dilatih dan diuji, dugaan anomali tidak boleh diaktifkan pada operasi nyata. Periksa juga lisensi model/runtime sebelum integrasi ERP.
- FCM: sediakan proyek Firebase Android, `FCM_PROJECT_ID`, dan file service account terbatas di `secrets/firebase.json` (tidak dikomit); atur `FCM_SERVICE_ACCOUNT_FILE=/run/secrets/firebase.json`. Aplikasi mendaftarkan token perangkat setelah pengguna masuk. Backend mengirim melalui OAuth service account dan FCM HTTP v1. Token Codex/langganan chat tidak digunakan sebagai kredensial server.
- WhatsApp: gunakan WhatsApp Cloud API resmi Meta, template bahasa `id` yang disetujui dengan tiga variabel teks (judul, ringkasan/waktu/kamera, tautan HTTPS login), dan isi `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_TEMPLATE_NAME`. Pilih penerima/jenis kejadian di dashboard. Biaya pesan mengikuti tarif Meta/penyedia.

Notifikasi memakai antrean Laravel dengan lima percobaan dan jeda meningkat saat layanan sementara gagal. Foto anomali dicatat segera agar notifikasi dapat masuk antrean; cuplikan sekitar tiga detik diunggah setelah bagian sesudah kejadian terkumpul. Peristiwa yang sama memakai `source_event_id` dan kunci unik agar tidak dikirim berulang. Tautan menuju detail membutuhkan login; gambar bukti dan video disimpan secara privat.

Jika unggahan bukti gagal sementara, pekerja menyimpan foto dan video di `vision/spool/<id-kamera>/` dan mencoba lagi kira-kira setiap menit, termasuk sesudah container dimulai ulang. Pantau ruang disk folder tersebut; cadangkan bersama bukti privat. Peringatan baru masuk antrean setelah server berhasil menerima foto kejadian.

## Flutter dan APK

Sumber Android ada di `mobile/`. APK uji dapat dibangun dengan image Flutter yang sudah memiliki SDK Android:

```bash
API_BASE_URL=https://nama-domain-anda bash scripts/build-apk.sh
```

Hasilnya `mobile/build/app/outputs/flutter-apk/app-debug.apk`. APK debug hanya untuk uji; sebelum distribusi umum, siapkan keystore Android pribadi, tanda tangani APK/AAB release, serta pasang domain HTTPS dan identitas Firebase (`FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`) melalui `--dart-define`. Tanpa Firebase, aplikasi tetap dapat masuk dan membuka daftar/detail kejadian, namun push tidak aktif.

Jika komputer/server tidak cukup ruang untuk SDK Android, gunakan GitHub: buka tab **Actions → Build Android APK → Run workflow**, pilih branch `ai-cctv-checker`, masukkan alamat HTTPS server, tunggu sampai pekerjaan selesai, lalu unduh artefak `ai-cctv-checker-debug-apk`. Saat branch didorong, workflow membangun APK uji dengan alamat `https://cctv.lrmslm.com`. APK baru dapat dipakai setelah server dan HTTPS bekerja. Untuk push, isi konfigurasi Firebase Android pada repository variables sebelum build ulang.

## Pengujian dan perkiraan

Uji lokal: `docker compose exec -T web php artisan test --filter=CctvWorkflowTest` dan `docker compose run --rm --no-deps vision python -m unittest discover -s tests`. Uji label sintetis berhasil untuk teks menyamping; alur video sintetis berhasil mengirim satu label ke backend. Cuplikan sintetis berdurasi **3,000 detik** saat diperiksa dengan `ffprobe`. Pada lima gambar dari rekaman Camera 13, OCR tidak menemukan kandidat nomor invoice. Rekaman itu tidak menunjukkan label yang dapat dibaca atau barang melintasi pembatas. **Belum tersedia** rekaman kejadian yang cukup, model barang, akses uji SLM, serta kredensial push/WhatsApp. Jumlah kejadian terlewat, peringatan keliru, dan waktu pengiriman notifikasi nyata belum dapat dihitung. Akurasi 100% tidak dijanjikan.

Perkiraan setelah data tersedia: 6–10 minggu untuk survei kamera, integrasi SLM, pelabelan data, pelatihan/kalibrasi model, uji lapangan, dan penyempurnaan (1–2 kamera awal). Anggaran pengembangan kasar Rp45–120 juta bergantung pada jumlah kamera, perubahan ERP, dan kebutuhan data; infrastruktur sekitar Rp2–6 juta/bulan untuk CPU atau Rp6–20 juta/bulan bila perlu GPU, ditambah penyimpanan, konektivitas, kamera tambahan, dan pesan WhatsApp. Angka ini **perkiraan awal**, bukan penawaran tetap; akurasi dan kebutuhan GPU hanya dapat diputuskan dari rekaman nyata.


## API, laporan, dan pemasangan VPS

[Dokumentasi API untuk pengembang ERP](docs/api.md) dan [OpenAPI JSON](docs/openapi.json) memuat autentikasi, invoice, sinkronisasi foto, laporan track anonim, aturan penerima, dan bukti privat. Pemasangan produksi menggunakan folder terpisah `/opt/cctvslm` serta domain `cctv.lrmslm.com`; lihat [perintah pemasangan](docs/pemasangan-vps.md).

Track tidak mengenali wajah dan tidak menyimpulkan identitas. Pemeriksa menandai customer/staf/pengunjung; orang yang belum diperiksa berstatus `unclassified`. Batas tidak terlihat awal 300 detik dapat diubah dan diaktifkan per kamera. Peringatan ditahan ketika kamera atau gambar terbaru terhenti dan ketika sesi pelacakan berubah. ID track dapat berubah karena tertutup; jumlah track bukan jumlah orang unik. Model deteksi orang tetap harus disediakan dan diuji.

Web dan Flutter menampilkan gambar terbaru sekitar setiap dua detik dengan kotak track saat model tersedia. Video live HLS tersedia pada pemasangan VPS dengan FFmpeg; gambar terbaru menjadi cadangan saat video belum siap. WhatsApp mendukung template teks dan template header gambar melalui API resmi Meta; akun, template, dan penerima perlu dikonfigurasi. Fraud tetap ditampilkan sebagai dugaan anomali yang perlu diperiksa, dengan model barang dan zona yang sudah diuji.
