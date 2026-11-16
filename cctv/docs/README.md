# Dokumentasi Sistem CCTV SLM · Aneka Jaya

Katalog dan indeks dokumentasi teknis, integrasi API ERP, dan panduan operasional sistem **AI CCTV Checker · SLM Aneka Jaya**.

---

## 1. Tautan Penting & Dashboard

| Item | Tautan / Nilai | Keterangan |
|---|---|---|
| **Dashboard Operasional** | [https://cctv.lrmslm.com](https://cctv.lrmslm.com) | Antarmuka web produksi pemantauan kamera, review anomali, & persetujuan label |
| **Repositori Utama** | [ridho15/cctvslm (branch: ai-cctv-checker)](https://github.com/ridho15/cctvslm/tree/ai-cctv-checker) | Repositori aktif kode sumber sistem |
| **Referensi Upstream** | [lrmcorp/SLM (branch: ai-cctv-checker)](https://github.com/lrmcorp/SLM/tree/ai-cctv-checker) | Penamaan repositori pada naskah serah terima awal |

---

## 2. Berkas Serah Terima Pengembang ERP SLM

Empat berkas utama berikut disediakan khusus untuk pengembang ERP (`mkr.lrmslm.com`):

1. **[Dokumentasi API Lengkap](api.md)** (`docs/api.md`)  
   Memuat panduan autentikasi Bearer token, endpoint daftar kamera, snapshot frame, penarikan cuplikan video bukti MP4, pelaporan track orang anonim, review invoice, dan aturan notifikasi.
2. **[Kontrak Integrasi ERP SLM](integrasi-erp-slm.md)** (`docs/integrasi-erp-slm.md`)  
   Spesifikasi kontrak payload JSON pencarian invoice (`/api/cctv/labels/lookup`), format `MJ INtegration`, header `Idempotency-Key`, serta konfirmasi penyimpanan event `invoice_captured` dan `packing_completed`.
3. **[Spesifikasi OpenAPI](openapi.json)** (`docs/openapi.json`)  
   Definisi skema OpenAPI 3.0 lengkap. Dapat langsung diimpor ke Swagger UI, Swagger Editor, Insomnia, atau Postman.
4. **[Koleksi Postman Siap Pakai](postman-cctv-slm.json)** (`docs/postman-cctv-slm.json`)  
   Koleksi request Postman terstruktur dengan pre-request scripts yang otomatis menyimpan `api_token` saat login.

---

## 3. Indeks Panduan Teknis & Operasional Toko

| Berkas | Isi & Tujuan |
|---|---|
| **[tahapan-implementasi.md](tahapan-implementasi.md)** | Panduan tahapan kerja dan rencana implementasi berurutan (Fase 1 sampai 9) |
| **[panduan-online.md](panduan-online.md)** | Syarat dan tahapan agar dashboard dapat diakses publik di internet |
| **[pemasangan-vps.md](pemasangan-vps.md)** | Panduan instalasi Ubuntu 24.04, Nginx, PHP 8.3-FPM, systemd service, dan SSL Let's Encrypt |
| **[koneksi-dvr-vps.md](koneksi-dvr-vps.md)** | Konfigurasi jalur privat Tailscale dari komputer toko (bridge port 8554 ke DVR port 554) menuju VPS |
| **[video-live.md](video-live.md)** | Arsitektur streaming video live HLS independen via FFmpeg dari sub-stream Hikvision |
| **[notifikasi-dan-aplikasi.md](notifikasi-dan-aplikasi.md)** | Konfigurasi push notification Android (FCM), WhatsApp Cloud API Meta, Email SMTP, dan panduan iOS |
| **[deployment-github.md](deployment-github.md)** | Konfigurasi GitHub Actions CI/CD untuk otomatisasi rilis APK Android dan TestFlight iOS |
| **[camera-13-review.md](camera-13-review.md)** | Hasil review rekaman video & konfirmasi draf zona Camera 13 (A13) |
| **[camera-13-zones.json](camera-13-zones.json)** | Data koordinat titik poligon ternormalisasi (0..1) untuk Camera 13 |
