# Kontrak integrasi ERP SLM

Dokumen ini untuk pengembang `slm.playgo.id`. Endpoint berikut perlu dibuat atau dipetakan pada ERP; keberadaannya belum diverifikasi. CCTV memanggil ERP melalui HTTPS dengan Bearer token khusus integrasi yang disimpan hanya pada server.

## 1. Lookup invoice

Konfigurasi CCTV: `SLM_BASE_URL=https://slm.playgo.id`, `SLM_LOOKUP_PATH=/api/cctv/labels/lookup`, dan `SLM_API_TOKEN`.

Permintaan POST JSON:

```json
{"invoice_number":"061026-23","customer_name":"TK HANSEL ASK","source_label":"MJ","integration_marker":"MJ INtegration"}
```

Nomor invoice selalu string agar nol di depan tetap tersimpan. Cocokkan invoice, customer, dan sumber. Untuk sumber `Aneka Jaya`, marker bernilai null; untuk `MJ`, gunakan `MJ INtegration`.

Respons HTTP 200:

```json
{"matched":true,"reference":"erp-invoice-id"}
```

Tidak cocok: `{"matched":false,"reference":null}`. `matched` wajib boolean. Kegagalan otorisasi/layanan memakai status HTTP yang sesuai, bukan respons cocok palsu.

## 2. Penyimpanan catatan dan foto

Konfigurasi CCTV: `SLM_SYNC_PATH=/api/cctv/labels/sync` (contoh jalur), `SLM_SYNC_UPLOAD_PHOTO=true` untuk menyimpan foto di ERP.

POST memakai `Authorization: Bearer ...` dan `Idempotency-Key: cctv-label-<id>-<fingerprint>`. JSON jika unggah foto dimatikan; multipart jika dinyalakan.

| Bidang | Arti |
|---|---|
| `cctv_label_id` | ID catatan CCTV; gunakan untuk upsert bersama identitas instalasi CCTV |
| `invoice_number` | Nomor invoice berupa string |
| `customer_name` | Nama customer yang sudah diperiksa |
| `source_label` | Aneka Jaya atau MJ |
| `slm_reference` | Referensi dari respons lookup ERP |
| `first_seen_at` | Waktu pengamatan pertama, ISO 8601 dengan zona waktu |
| `event_type` | `invoice_captured` atau `packing_completed` |
| `packing_completed_at` | ISO 8601 atau null; pada multipart, kosong berarti belum dikonfirmasi |
| `evidence_url` | Halaman detail CCTV yang memerlukan login, bukan foto publik |
| `screenshot` | Berkas foto pada mode multipart; tidak dikirim pada JSON |

ERP wajib menyimpan catatan, foto bila dikirim, dan idempotency key secara konsisten sebelum menjawab HTTP 200/201:

```json
{"saved":true}
```

Respons HTTP 202 belum dianggap tersinkron oleh CCTV. Permintaan berulang dengan kunci sama harus menghasilkan pengakuan sukses tanpa membuat catatan baru. Event packing memiliki fingerprint berbeda dari event invoice awal. Event invoice yang terlambat tidak boleh menghapus waktu packing yang sudah tercatat. Tidak ada transaksi atomik lintas server; idempotensi ERP diperlukan untuk menangani respons yang hilang setelah data tersimpan.

## 3. Uji penerimaan bersama

Uji invoice Aneka Jaya dan MJ, nol di depan, customer tidak cocok, invoice tidak ditemukan, token salah, serta gangguan sementara. Uji foto multipart tersimpan dan dapat dibuka dari ERP. Kirim permintaan yang sama dua kali: tetap satu catatan. Kirim packing setelah invoice awal, kemudian ulangi event invoice awal: waktu packing harus tetap ada.

QR berisi invoice saja tetap menunggu pemeriksaan nama customer dan sumber; QR terlihat tidak otomatis berarti packing selesai. Saat ini packing selesai dikonfirmasi oleh pengguna. Sistem belum menyediakan pengiriman bukti anomali ke ERP melalui kontrak ini; bukti anomali tersedia melalui API CCTV yang membutuhkan token pengguna.
