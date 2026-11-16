# Aplikasi Android dan iPhone CCTV SLM

Flutter menampilkan status kamera, gambar terbaru, laporan track anonim, riwayat invoice beserta foto, detail dugaan anomali, cuplikan, dan keputusan pemeriksa. Video live memakai HLS dengan jeda beberapa detik; gambar terbaru diperbarui sekitar dua detik sebagai cadangan. Halaman laporan dan invoice menampilkan halaman pertama API pada MVP ini.

Alamat server diberikan saat build:

```bash
flutter pub get
flutter analyze
flutter build apk --debug --dart-define=API_BASE_URL=https://cctv.lrmslm.com
```

Untuk pengguna yang tidak memasang Flutter, GitHub Actions **Build Android APK** membangun APK uji setiap push pada branch `ai-cctv-checker`. Unduh artifact `ai-cctv-checker-debug-apk` setelah workflow berhasil. APK debug untuk pengujian; versi distribusi memerlukan signing release tersendiri. Jangan menaruh keystore atau sandinya di Git.

Push Android membutuhkan konfigurasi Firebase Android melalui `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID` saat build. Service account pengirim hanya berada di backend, bukan dalam APK. Tanpa Firebase, login dan pembacaan data tetap tersedia, tetapi push belum aktif. Token API disimpan dengan Flutter Secure Storage; sesi berlaku 30 hari.

Sebelum digunakan, pastikan domain sudah HTTPS, akun sudah dibuat, dan kamera mengirim gambar. Bukti memakai Authorization Bearer pada request, bukan URL publik. Lihat [dokumen API](../docs/api.md) dan [pemasangan VPS](../docs/pemasangan-vps.md).

Track anonim tidak mencocokkan foto wajah, tidak menentukan identitas, dan dapat berubah ketika orang tertutup atau kamera tersambung ulang. Dugaan anomali memerlukan pemeriksaan manusia.

Petunjuk iPhone, email, WhatsApp, dan konfigurasi push: [notifikasi dan aplikasi](../docs/notifikasi-dan-aplikasi.md).
