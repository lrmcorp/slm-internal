# API CCTV SLM untuk pengembang ERP dan Flutter

Base URL: `https://cctv.lrmslm.com`. Deployment aplikasi sudah berhasil; koneksi ERP dan pengiriman notifikasi tetap perlu konfigurasi serta pengujian layanan nyata. Definisi endpoint tersedia dalam [OpenAPI](openapi.json).

## Autentikasi

`POST /api/login` menerima JSON `email` dan `password`. Respons berisi `token`, `expires_at`, dan `user` (`id`, `name`, `email`). Token berlaku 30 hari, disimpan sebagai hash pada server, dan hanya dikirim sekali saat login. Flutter menyimpan token di penyimpanan aman. Setiap permintaan berikutnya memakai `Authorization: Bearer <token>` dan `Accept: application/json`. Login dibatasi lima permintaan per menit. `POST /api/logout` menghapus token dan menghasilkan 204. Jangan menaruh token di URL.

Contoh payload login:

```json
{"email":"admin@perusahaan.id","password":"diisi-di-aplikasi"}
```

Backend tidak memiliki akun atau sandi bawaan. Admin dibuat dengan perintah interaktif di VPS. API bukti juga memerlukan token, sementara tautan halaman web memerlukan sesi login web.

## Kamera, gambar, dan zona

| Metode | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/cameras` | Daftar kamera dan status, termasuk `last_seen_at`, `frame_at`, `detector_ready`, `absence_seconds` |
| POST | `/api/cameras` | Admin membuat kamera: `name`, `location`, `stream_env_key` |
| GET | `/api/cameras/{camera}/live-frame` | JPEG terbaru; header `X-Frame-Time` memuat waktu gambar |
| POST | `/api/cameras/{camera}/reference` | Admin mengunggah multipart `image` untuk kalibrasi |
| PUT | `/api/cameras/{camera}/zones` | Admin menyimpan array `zones` |
| POST | `/api/cameras/{camera}/zones/approve` | Admin menyetujui zona setelah memeriksa tampilan |
| PUT | `/api/cameras/{camera}/presence-settings` | Admin mengatur `absence_seconds` (60–86400) dan `presence_alerts_enabled` |

Gambar cadangan diperbarui sekitar dua detik. Video live HLS tersedia pada `/api/cameras/{camera}/live/stream.m3u8`; segmen relatif `segment000001.ts` memakai jalur dan Bearer token yang sama. Klien harus meneruskan Authorization pada playlist serta segmen. Endpoint menolak stream dengan HTTP 503 jika frame kamera atau pembaruan playlist sudah lebih dari 20 detik. Parameter `file` hanya menerima `stream.m3u8` atau `segment<angka>.ts`. Video RTSP kini memakai jalur FFmpeg terpisah dari QR/AI: H.264 diteruskan pada frame rate DVR, sedangkan H.265 dikonversi ke H.264 dengan target 15 fps. Sub-stream diprioritaskan untuk tampilan; main-stream tetap dipakai pekerja QR/AI. HLS menambah jeda beberapa detik dan beban CPU, sehingga perlu uji VPS nyata. Tidak ada URL RTSP berisi sandi yang dikirim ke klien. Klien harus menandai gambar lama ketika `X-Frame-Time` lebih dari 20 detik; keberhasilan HTTP 200 tidak membuktikan kamera masih hidup. Jangan menampilkan gambar lama sebagai live tanpa waktu. Frame belum tersedia menghasilkan 404.

Koordinat zona relatif pada 0–1. Jenis: `store_boundary`, `box_area`, `packing_route`, `danger_zone`, `packing_area`. Setiap jenis hanya boleh satu poligon, dengan 3–30 titik `[x,y]`. Unggahan frame atau perubahan zona menghapus persetujuan lama. Persetujuan membutuhkan frame, batas toko, area asal barang, dan jalur packing.

A14 dipakai untuk invoice; A12/A13 untuk pemeriksaan dugaan anomali. ID basis data berbeda dari nomor kanal DVR; gunakan ID hasil `/api/cameras`.

## Laporan track anonim

`GET /api/reports/presence` menerima filter `camera_id`, `classification`, `from`, `to`. Tanggal API gunakan ISO 8601 beserta zona waktu, misalnya `2026-10-08T00:00:00+07:00`. Hasil dipaginasi 30 baris dalam `data`, dengan `next_page_url`.

Kolom track: `id`, `camera_id`, `session_id`, `track_id`, `classification`, `first_seen_at`, `last_seen_at`, `absence_alerted_at`, `box`, serta `camera`. Klasifikasi: `unclassified`, `customer`, `staff`, `visitor`. Admin mengubahnya dengan `POST /api/presence/{track}/classification` dan JSON `classification`.

Orang yang belum diperiksa tidak otomatis dianggap customer. Track tidak mengenali wajah, tidak menyambung identitas antarkamera, dan tidak boleh dihitung sebagai jumlah customer unik. ID dapat berubah ketika orang tertutup atau kamera tersambung ulang. `person_absent` berarti track tidak terlihat selama batas waktu, bukan bukti orang tertentu meninggalkan toko. Pemeriksaan berjalan setiap menit; waktu antrean dan layanan pengiriman menambah keterlambatan. Kejadian belum otomatis dibuat jika kamera, frame, atau sesi pelacakan tidak sehat.

## Invoice dan bukti

| Metode | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/labels` | Riwayat label, 30 per halaman |
| GET | `/api/labels/{label}` | Detail label dan kamera |
| POST | `/api/labels/{label}/review` | `status` confirmed/rejected, koreksi `field_one`, `field_two`, `field_three`, opsional `note` |
| GET | `/api/evidence/label-snapshot/{label}` | Gambar label privat |

QR hanya berisi nomor invoice, misalnya `061026-23`, tanpa URL. Nilai selalu string. Format yang dikenali saat ini enam angka, tanda hubung, dua angka. `field_one` = invoice; `field_two` = nama customer; `field_three` = `Aneka Jaya` atau `MJ`. QR tidak mengisi customer atau unit usaha secara tebakan. Catatan QR invoice saja berstatus `pending` sampai bidang lain diperiksa. `first_seen_at` tetap waktu pengamatan pertama dan `last_seen_at` diperbarui saat terlihat lagi.

Status pencocokan: `unavailable`, `incomplete`, `matched`, `not_found`, `error`. Status pengiriman SLM: `not_ready`, `pending_configuration`, `queued`, `synced`, `missing_photo`, `error`. Foto disimpan sejak pembacaan pertama; sinkronisasi baru berjalan setelah cocok dan konfigurasi API lengkap.

## Kontrak yang perlu disediakan ERP SLM

Ini **endpoint yang perlu dibuat atau dipetakan oleh pengembang ERP**, bukan klaim endpoint tersebut sudah ada di `mkr.lrmslm.com`.

Atur `SLM_BASE_URL`, `SLM_LOOKUP_PATH`, `SLM_API_TOKEN`. Adaptor mengirim POST HTTPS dengan Bearer token:

```json
{
  "invoice_number": "061026-23",
  "customer_name": "TK HANSEL ASK",
  "source_label": "MJ",
  "integration_marker": "MJ INtegration"
}
```

ERP harus mencocokkan invoice, customer, dan unit usaha. Untuk Aneka Jaya, `integration_marker` null. Respons JSON yang diharapkan:

```json
{"matched":true,"reference":"erp-invoice-id"}
```

Gunakan boolean asli pada `matched`; jangan string `"false"`. Tidak cocok: `{"matched":false,"reference":null}`. Otorisasi atau kegagalan layanan harus memakai status HTTP yang sesuai. Keberhasilan kosong bukan respons cocok.

Untuk menerima catatan yang sudah cocok, tetapkan `SLM_SYNC_PATH`. Backend mengirim POST dengan header `Idempotency-Key: cctv-label-<id>-<fingerprint>` dan payload:

```json
{
  "cctv_label_id":17,
  "invoice_number":"061026-23",
  "customer_name":"TK HANSEL ASK",
  "source_label":"MJ",
  "slm_reference":"erp-invoice-id",
  "first_seen_at":"2026-10-08T06:00:00+00:00",
  "event_type":"invoice_captured",
  "packing_completed_at":null,
  "evidence_url":"https://cctv.lrmslm.com/labels/17"
}
```

`SLM_SYNC_UPLOAD_PHOTO=false`: JSON dan tautan halaman privat. `true`: multipart dengan bidang di atas dan file `screenshot`. Tautan memerlukan login; bukan URL gambar publik. Jika ERP memerlukan foto di penyimpanannya sendiri, gunakan unggahan multipart. ERP harus menyimpan idempotency key agar antrean ulang tidak membuat catatan ganda. ERP wajib mengembalikan HTTP 200/201 dengan JSON `{"saved":true}` setelah catatan benar-benar disimpan. HTTP 202 atau respons tanpa boolean `saved: true` belum dianggap tersinkron. Respons gagal masuk mekanisme percobaan ulang hingga batas antrean. Dokumentasi dan akses uji ERP diperlukan sebelum mengaktifkan konfigurasi produksi.

## Kejadian dan keputusan pemeriksa

`GET /api/incidents?status=needs_review`: daftar dipaginasi. `GET /api/incidents/{incident}`: detail termasuk kamera, alasan, waktu, dan metadata. Jenis: `anomaly`, `person_absent`, `camera_offline`, `worker_offline`.

`POST /api/incidents/{incident}/review`: JSON `status` confirmed/dismissed dan opsional `note`. Confirmed berarti pemeriksa menandai perlu tindak lanjut, bukan putusan bahwa seseorang melakukan fraud. Deteksi dugaan anomali memerlukan model barang dan zona yang diuji.

Bukti privat: `GET /api/evidence/incident-snapshot/{incident}`, `GET /api/evidence/incident-clip/{incident}`. Cuplikan anomali sekitar tiga detik, dengan bagian sebelum/sesudah kejadian. Peringatan track tidak terlihat menyimpan foto pengamatan terakhir; tidak mengarang video ketika orang tidak ada.

## Push, email, dan WhatsApp resmi

`POST /api/devices`: JSON `token`, `platform` android/ios setelah login. Token yang dikirim adalah token perangkat Firebase, bukan token akun API. Backend FCM memerlukan service account server. Kunci server tidak dimasukkan ke APK.

`GET /api/notification-rules`: aturan pengguna saat ini. `PUT /api/notification-rules` menerima `incident_type`, `channel` push/email/whatsapp, `enabled`, `whatsapp_number` format internasional `+62...` untuk WhatsApp, serta opsional `user_id` bagi admin. Aturan menyebut penerima dan jenis kejadian; `person_absent` harus dipilih jika diinginkan.

WhatsApp memakai Cloud API Meta. Siapkan nomor bisnis, access token server, dan template bahasa `id` dengan tiga parameter body: judul, ringkasan/waktu/kamera, tautan HTTPS. `WA_TEMPLATE_NAME` untuk teks; `WA_IMAGE_TEMPLATE_NAME` untuk template header gambar. Gambar diunggah privat ke endpoint media Meta lalu dikirim dengan media ID. Tidak perlu membuat bukti menjadi publik. Tidak ada pengiriman nyata sampai akun, template, dan penerima selesai dikonfigurasi.

Status antrean: `pending`, `sending`, `retrying`, `sent`, `failed`. Ada lima percobaan dan jeda bertahap. `sent` berarti API penyedia menerima permintaan, **bukan bukti dibaca atau diterima di perangkat**; webhook status WhatsApp belum dibuat. Deduplikasi lokal mencegah pembuatan pengiriman berulang untuk incident/penerima/channel yang sama. Bila penyedia menerima permintaan tetapi respons hilang, antrean ulang masih dapat menghasilkan pesan ganda; jangan menyebut jaminan exactly-once.

## API ingest untuk pekerja video

Jalur `/api/ingest/*` menggunakan `X-CCTV-Ingest-Token` server, berbeda dari token pengguna. Jangan berikan token ingest kepada aplikasi Flutter atau ERP. Semua waktu observasi ISO 8601 dengan zona waktu. Endpoint kamera: GET `config`, POST `heartbeat`, POST `observations`, POST `labels`, POST `incidents`, dan POST `incidents/{sourceEventId}/clip`.

`observations` memakai multipart: `session_id`, `detector_ready` 0/1, `tracks` berupa string JSON array `[{"id":"42","box":[0.1,0.1,0.4,0.8]}]`, `snapshot` file JPEG. Box `[x1,y1,x2,y2]` relatif 0–1. Maksimum 50 track. Saat reconnect, pekerja membuat sesi baru.

Email dikirim ke alamat akun penerima melalui SMTP yang dikonfigurasi pada server. Pesan berisi ringkasan, tautan detail yang memerlukan login, dan foto jika tersedia (maksimal 5 MB). Mengaktifkan aturan tidak otomatis mengonfigurasi Firebase, SMTP, atau Meta. Tidak ada endpoint API untuk mengubah kredensial penyedia. Lihat [konfigurasi layanan](notifikasi-dan-aplikasi.md).

## Kesalahan dan batas pengujian

401: token tidak valid/kedaluwarsa; 403: perlu admin; 404: catatan atau bukti tidak ditemukan; 422: validasi; 429: pembatasan login; 5xx: gangguan server. Klien wajib menangani sesi kedaluwarsa dan tidak menampilkan data lama sebagai hasil terkini. Daftar API dipaginasi; Flutter MVP saat ini menampilkan halaman pertama saja.

Uji otomatis memakai layanan HTTP tiruan dan QR buatan. Pengujian nyata masih diperlukan untuk QR cetak, tracking pada rekaman toko, kejadian yang terlewat, peringatan keliru, sinkronisasi ERP, serta waktu dari kejadian sampai push/WhatsApp. Dashboard belum disebut online sebelum HTTPS, login, kamera, antrean, dan akses pengguna diuji di VPS.

## Packing selesai dan pembaruan dashboard

`POST /api/labels/{id}/packing-complete` memakai Bearer token pengguna. Request body kosong. Bacaan invoice harus sudah berstatus `confirmed`; bila belum, respons 422. Endpoint mencatat `packing_completed_at` dan `packing_completed_by` satu kali, lalu mengantrekan ulang versi catatan packing yang sudah cocok dengan SLM. Pengulangan request tidak mengubah waktu atau membuat event packing baru. Respons 200 berisi objek label terbaru. Nomor invoice dan customer tidak boleh diubah setelah konfirmasi packing selesai.

QR tertangkap bukan bukti packing selesai. Pemeriksa mengonfirmasi selesai dari dashboard atau aplikasi melalui endpoint di atas. Payload keluar ke ERP memiliki `cctv_label_id` sebagai ID catatan lokal dan `event_type` bernilai `invoice_captured` atau `packing_completed`, serta `packing_completed_at` (ISO 8601 atau null). Waktu packing masuk fingerprint idempotensi, sehingga pembaruan packing tidak tertahan oleh pengiriman catatan invoice sebelumnya. ERP harus memakai `Idempotency-Key` untuk deduplikasi dan melakukan upsert berdasarkan `cctv_label_id` pada catatan yang sama. Event `invoice_captured` yang datang terlambat tidak boleh menghapus waktu packing dari event `packing_completed` yang sudah tersimpan. Pada multipart, nilai waktu packing yang kosong berarti belum dikonfirmasi.

Sinkronisasi pertama diantrekan segera setelah label cocok. Antrean mencoba ulang dengan jeda 10, 30, 120, dan 300 detik. Scheduler `cctv:auto-sync` berjalan tiap menit untuk memulihkan catatan setelah konfigurasi tersedia; pengiriman yang telah gagal seluruh percobaannya dapat diantrekan kembali setelah jeda minimal 10 menit. Bacaan `pending` dan `rejected` tidak dikirim. QR yang hanya memuat invoice tetap perlu customer dan sumber yang diperiksa sebelum pencocokan; sistem tidak menebaknya. ERP belum tersambung sampai URL, token, endpoint, dan kontrak respons disiapkan serta diuji.

`GET /dashboard/state` hanya untuk sesi web yang sudah login, dengan cache privat `no-store`. Endpoint menyediakan status semua kamera, ringkasan jumlah invoice/packing/sinkronisasi, dan tabel invoice terbaru. Browser memperbaruinya setiap tiga detik. Video HLS pada setiap kamera memiliki jeda buffering; interval dashboard bukan jaminan waktu pengiriman ERP. Keterlambatan sebenarnya perlu diukur di VPS dan API ERP.

## Track objek pada pengamatan kamera

Endpoint `POST /api/ingest/cameras/{id}/observations` menerima bidang multipart opsional `objects`, berupa JSON array maksimal 50 track. Setiap entri memiliki `id` string dan `box` berisi empat koordinat relatif 0–1. Bidang `tracks` tetap hanya berisi orang. Objek tidak masuk laporan presence atau aturan orang tidak terlihat. Jika `detector_ready=false`, kedua array harus kosong. Dashboard state menyediakan `detector_ready`, `people_count`, dan `objects_count`; hitungan dihentikan untuk frame lama. Video dan foto terbaru menyertakan kotak overlay dari pekerja vision. Tidak ada identifikasi wajah atau penyambungan identitas lintas kamera.

## Notifikasi email dan aplikasi iPhone

Aturan notifikasi menerima `channel: email` selain `push` dan `whatsapp`. Email memakai alamat akun penerima dan transport SMTP yang diatur di server. Token perangkat menerima `platform: ios` atau `android`. Pengiriman, konfigurasi Firebase/APNs, dan distribusi internal dijelaskan pada [notifikasi dan aplikasi](notifikasi-dan-aplikasi.md).

## Contoh permintaan untuk pengembang

Contoh berikut menggunakan ID basis data. Ganti `17` dan `13` dengan ID hasil API; angka tersebut bukan pemetaan kanal DVR.

```bash
curl --request POST 'https://cctv.lrmslm.com/api/login' \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --data '{"email":"pengguna@perusahaan.id","password":"SANDI_AKUN_ANDA"}'
```

Simpan token respons di penyimpanan aman aplikasi. Pada contoh berikut, `CCTV_TOKEN` adalah variabel lingkungan lokal berisi token tersebut; jangan mencetaknya dalam log.

```bash
curl 'https://cctv.lrmslm.com/api/cameras' \
  --header 'Accept: application/json' \
  --header "Authorization: Bearer $CCTV_TOKEN"

curl 'https://cctv.lrmslm.com/api/labels?page=1' \
  --header 'Accept: application/json' \
  --header "Authorization: Bearer $CCTV_TOKEN"

curl --request POST 'https://cctv.lrmslm.com/api/labels/17/review' \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $CCTV_TOKEN" \
  --data '{"status":"confirmed","field_one":"061026-23","field_two":"TK HANSEL ASK","field_three":"MJ"}'

curl --request POST 'https://cctv.lrmslm.com/api/labels/17/packing-complete' \
  --header 'Accept: application/json' \
  --header "Authorization: Bearer $CCTV_TOKEN"
```

Contoh aturan email untuk pengguna yang login:

```json
{"incident_type":"anomaly","channel":"email","enabled":true}
```

Kirim melalui `PUT /api/notification-rules`. Untuk WhatsApp, ubah channel menjadi `whatsapp` dan tambahkan `whatsapp_number` dalam format `+62...`. Untuk push, gunakan `push` dan daftarkan token perangkat melalui `/api/devices`. Satu permintaan menyimpan satu aturan; buat permintaan terpisah untuk setiap jenis kejadian dan channel.

Daftar label, kejadian, dan laporan presence memakai pagination Laravel:

```json
{"current_page":1,"data":[],"next_page_url":null,"per_page":30,"total":0}
```

Contoh di atas hanya menampilkan sebagian kolom pagination. Kamera dan aturan notifikasi menghasilkan array langsung, bukan objek `data`. Detail label/kejadian menghasilkan satu objek. Kolom tambahan mungkin tersedia; klien jangan gagal ketika menerima kolom yang belum dikenal.

Contoh kesalahan validasi HTTP 422:

```json
{"message":"...","errors":{"field_one":["..."]}}
```

Isi pesan mengikuti validasi server; klien sebaiknya memakai status HTTP dan nama bidang, bukan mencocokkan kalimat pesan.

## Berkas untuk diserahkan ke pengembang

- [OpenAPI JSON](openapi.json): impor ke Swagger Editor, Insomnia, atau Postman.
- [Koleksi Postman](postman-cctv-slm.json): contoh permintaan aplikasi; atur `base_url`, `email`, dan `password` pada environment pribadi. Permintaan login menyimpan `api_token` otomatis sebagai variabel environment. Jangan mengekspor environment yang berisi token atau sandi.
- [Kontrak ERP SLM](integrasi-erp-slm.md): endpoint yang perlu disediakan oleh ERP untuk lookup dan penyimpanan foto/packing.

API aplikasi tidak menyediakan endpoint unggah wajah, identifikasi wajah, pengiriman pesan bebas, atau webhook status pengiriman WhatsApp. Dokumentasi hanya mencantumkan fungsi yang sudah ada.
