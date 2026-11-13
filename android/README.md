# Aplikasi Android SLM dan ANKJY

Satu kode untuk beberapa instance. Pilih brand saat build dengan `-Pbrand=...`:

| Brand | applicationId | Nama | Alamat | APK |
|---|---|---|---|---|
| `slm` (bawaan) | `id.playgo.slm` | SLM | https://slm.lrmslm.com | `public/downloads/slm-android.apk` |
| `ankjy` | `id.playgo.ankjy` | ANKJY | https://ankjy.lrmslm.com (ankjy.net tetap dibuka di aplikasi) | `public/downloads/ankjy-android.apk` |

Nama dan ikon tiap brand ada di `app/src/brand/<brand>/res`; versi dan alamat di `app/build.gradle`.

APK ini membuka web SLM (`https://slm.lrmslm.com`) di dalam aplikasi, jadi semua fitur dan hak akses sama dengan versi web dan otomatis ikut setiap update server. Tidak perlu build ulang APK ketika web berubah.

Yang ditangani khusus di Android:
- Tombol **Cetak** (`window.print()`) → dialog print Android (printer Wi-Fi / PDF).
- **Cetak thermal** (link `rawbt:`) → aplikasi RawBT. Bila RawBT belum terpasang, Play Store dibuka.
- **Foto bukti DO / upload gambar** → kamera atau galeri; kamera langsung meminta izin kamera.
- **Unduhan** (Excel, gambar, file dari tombol unduh) → folder Download.
- Link WhatsApp, telepon, dan situs lain → dibuka di aplikasinya masing-masing.
- Login tetap tersimpan; tombol Kembali HP = kembali ke halaman sebelumnya.

## Pasang di HP
1. Buka `https://slm.lrmslm.com/downloads/slm-android.apk` di HP Android (atau tombol "Unduh aplikasi Android SLM" di halaman login).
2. Izinkan "Pasang dari sumber ini" bila diminta, lalu pasang.
3. Untuk cetak thermal, pasang juga aplikasi **RawBT** dari Play Store.

## Build ulang
Butuh JDK 17+ dan Android SDK (platform 35, build-tools 35).

1. Taruh kunci tanda tangan di `android/keystore/` (`slm-release.jks` dan `keystore.properties`). Kunci **tidak** disimpan di repo; minta salinannya ke pemilik.
2. Build:

```bash
cd android
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../public/downloads/slm-android.apk
```

ANKJY: `./gradlew assembleRelease -Pbrand=ankjy` lalu salin ke `../public/downloads/ankjy-android.apk`.
Alamat web lain: `./gradlew assembleRelease -PslmUrl=https://alamat-lain`.

**Kunci rilis ANKJY (sejak 10 Nov 2026, versi 1.0):** terpisah dari kunci SLM, letakkan di `android/keystore/ankjy/` (`ankjy-release.jks` dan `keystore.properties`). Simpan cadangannya di VPS `/root/android-keystore/ankjy/`. Tanpa kunci ini, update ANKJY berikutnya tidak bisa dipasang di atas versi 1.0.
Naikkan `versionCode`/`versionName` di `app/build.gradle` setiap rilis baru. Domain lama yang dialihkan ke domain baru ditulis di `oldHosts` per brand supaya tetap terbuka di dalam aplikasi.

Riwayat: ANKJY 1.1 (13 Nov 2026) membuka ankjy.lrmslm.com; SLM 2.1 (13 Nov 2026) membuka slm.lrmslm.com; SLM 2.2 (13 Nov 2026) ikon logo baru dan warna hijau zaitun.

**Kunci rilis SLM v3 (sejak 13 Nov 2026, versi 2.1):** kunci baru, terpisah dari kunci v2 di VPS. Letakkan di `android/keystore/slm/` (`slm-release.jks` dan `keystore.properties`) dan simpan cadangannya di VPS `/root/android-keystore/slm/`. HP yang memasang SLM 2.0 harus menghapus aplikasi lama dulu (sekali saja); rilis berikutnya wajib memakai kunci v3 ini supaya bisa dipasang sebagai update.

**Kunci rilis v2 (sejak 8 Nov 2026, versi 2.0):** disimpan di VPS `/root/android-keystore/` (hanya root). Build ulang di VPS: `/root/build-apk.sh` (container JDK 17 + Android SDK, Gradle dari mirror Tencent dengan checksum resmi). Versi 1.0 memakai kunci lama developer, jadi HP yang masih memasang versi 1.0 harus menghapus aplikasi lama dulu.

Kunci yang sama wajib dipakai untuk setiap rilis agar APK baru bisa dipasang sebagai update. Bila kunci hilang, aplikasi lama harus dihapus dulu sebelum memasang APK baru. Tanpa folder `keystore/`, build memakai kunci debug (hanya untuk uji).
