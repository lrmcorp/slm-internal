# Android, iPhone, dan notifikasi

Aplikasi terhubung ke `https://cctvslm.playgo.id`. Gunakan akun dashboard untuk masuk. Data kamera dan bukti memerlukan autentikasi.

## Android

Workflow **Build Android APK** membangun APK uji dan menerbitkannya pada GitHub Releases dengan nama `SLM-CCTV-Android.apk`. Unduh APK dari rilis terbaru, buka pada Android, lalu izinkan pemasangan dari sumber tersebut. Beri izin notifikasi ketika diminta. APK debug ini untuk pengujian internal, bukan rilis Play Store. Karena repositori publik, APK dapat diunduh siapa pun; akses CCTV tetap memerlukan akun.

Push membutuhkan empat Repository Variables GitHub: `FIREBASE_API_KEY`, `FIREBASE_APP_ID` (aplikasi Android), `FIREBASE_PROJECT_ID`, dan `FIREBASE_SENDER_ID`. Daftarkan Android dengan package `id.anekajaya.ai_cctv_checker`. Nilai ini konfigurasi klien, bukan kunci pengirim. Setelah mengisinya, jalankan ulang build APK dan pasang hasilnya. Tanpa konfigurasi tersebut, aplikasi dapat masuk dan melihat CCTV tetapi belum menerima push.

Pada VPS, atur `FCM_PROJECT_ID` dan `FCM_SERVICE_ACCOUNT_FILE` sesuai `.env.example`. Simpan berkas service account di luar direktori publik dengan izin terbatas. Jangan masukkan berkas itu ke GitHub atau APK. Aktifkan aturan jalur **Push** untuk penerima pada dashboard. Login aplikasi mendaftarkan perangkat. Saat aplikasi Android terbuka, pesan tampil sebagai banner dengan tombol **Lihat**; ketika di latar belakang, pesan ditampilkan oleh sistem Android.

APK debug yang dibangun di runner baru dapat memakai kunci debug berbeda. Jika Android menolak pembaruan karena tanda tangan berbeda, hapus aplikasi uji lama dan pasang ulang, lalu login. Untuk penggunaan tetap, siapkan keystore release yang disimpan sebagai secret; jangan mengganti kunci antar-rilis.

## iPhone

Proyek `mobile/ios` dan workflow **Check iPhone build** memeriksa kompilasi pada macOS. Hasil workflow belum ditandatangani dan **tidak dapat dipasang langsung**. iPhone tidak memakai APK.

Untuk distribusi internal melalui TestFlight, pemilik akun Apple Developer perlu mendaftarkan bundle `id.anekajaya.aiCctvChecker`, membuat aplikasi di App Store Connect, dan mengundang penguji internal. Di Xcode, buka `mobile/ios/Runner.xcworkspace`, pilih Team yang benar, aktifkan Push Notifications serta Background Modes → Remote notifications, dan buat Archive untuk TestFlight. Sertifikat dan provisioning profile harus mengizinkan push dan akses Keychain.

Daftarkan aplikasi iOS pada proyek Firebase yang sama, isi `FIREBASE_IOS_APP_ID`, dan unggah kunci APNs di Firebase Console. Nilai Firebase lainnya sama seperti Android. Build distribusi memakai `--dart-define=FIREBASE_IOS_APP_ID=...` beserta empat parameter Firebase/API lainnya. Entitlement APNs saat ini memakai `production` untuk distribusi; untuk pengujian development gunakan `APS_ENVIRONMENT=development` pada konfigurasi Debug Xcode. Penandatanganan dan pengujian perangkat nyata belum bisa diselesaikan tanpa akun Apple tersebut.

## Email

Atur SMTP pada `/opt/cctvslm/backend/.env`: `MAIL_MAILER=smtp`, `MAIL_SCHEME=smtps` untuk TLS langsung pada port 465 atau sesuai petunjuk penyedia, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, dan `MAIL_FROM_NAME`. Pengirim harus diizinkan oleh penyedia email. Jangan kirim kata sandi melalui chat.

Pada dashboard, pilih penerima, jenis kejadian, dan jalur **Email**. Email dikirim ke alamat akun penerima, berisi ringkasan, waktu WIB, kamera, tautan detail yang memerlukan login, serta foto bukti jika tersedia dan berukuran maksimal 5 MB. Mode `log`/`array` tidak dianggap pengiriman berhasil.

## WhatsApp

Gunakan WhatsApp Business Platform resmi Meta. Atur `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_TEMPLATE_NAME`, serta nomor penerima sesuai `.env.example`. Penerima harus menyetujui pesan. Template perlu disetujui Meta. Template gambar terpisah diperlukan untuk mengirim foto; atur `WA_IMAGE_TEMPLATE_NAME`. Jangan membuka bukti CCTV sebagai URL publik untuk mengirim gambar: backend mengunggah foto langsung ke Meta.

Pilih jalur **WhatsApp** dan jenis kejadian pada aturan dashboard. Tanpa akun Meta dan template yang aktif, pengiriman belum bisa berjalan.

## Pemeriksaan setelah konfigurasi

Setelah mengubah `.env`, jalankan `php artisan config:cache` sebagai pengguna aplikasi dan restart `slm-queue`. Uji satu kejadian dengan akun penerima yang benar. Periksa apakah push masuk di ponsel, email masuk di kotak masuk, dan WhatsApp diterima. Catat waktu kejadian dan waktu penerimaan. Uji juga kegagalan sementara penyedia.

Antrean mencoba pengiriman maksimal lima kali. Status `sent` berarti layanan menerima permintaan, bukan bukti penerima sudah membaca pesan. Pengiriman ulang setelah kegagalan sebagian masih dapat menghasilkan pesan ganda pada perangkat yang sudah menerima; jangan menganggap penyedia menjamin pengiriman tepat satu kali. Pengujian kode memakai layanan tiruan; pengiriman nyata perlu dibuktikan setelah akun layanan diatur.

### Distribusi iPhone dari GitHub

Workflow manual **Distribute iPhone with TestFlight** menandatangani IPA dan mengunggahnya ke App Store Connect. Setelah Apple selesai memproses build, undang pengguna dari tab TestFlight. Penguji internal harus menjadi pengguna App Store Connect; staf yang tidak diberi akses tersebut dapat memakai grup penguji eksternal setelah persetujuan beta Apple. Workflow ini belum diuji dengan akun Apple nyata.

Isi Secrets pada environment GitHub `cctv-ios`: `IOS_CERTIFICATE_P12_BASE64` (sertifikat Apple Distribution beserta private key dalam P12, dikodekan base64), `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64` (profile App Store untuk bundle aplikasi dengan push aktif), `IOS_TEAM_ID`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, dan `APPSTORE_API_PRIVATE_KEY` (isi berkas P8 dari App Store Connect dengan hak upload yang diperlukan). Isi pula Repository Variables Firebase termasuk `FIREBASE_IOS_APP_ID`. Jangan menaruh berkas penandatanganan atau kunci API dalam repositori.

Pembuatan akun Apple, sertifikat, profile, dan kunci APNs memerlukan akses pemilik akun. Jika akun tersebut belum tersedia, versi iPhone belum dapat dipasang meskipun pemeriksaan kompilasi berhasil.
