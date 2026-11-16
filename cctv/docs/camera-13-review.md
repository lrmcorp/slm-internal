# Draf zona Camera 13

Sumber: video `20261007073924555.mp4` (5,28 detik; 960 × 1080 piksel) dan foto bertanda `IMG_8647.heic` dari pemilik. Coretan hitam pada foto menunjukkan lokasi tembok pembatas. Koordinat di `camera-13-zones.json` memakai gambar dari video dan dinormalisasi ke rentang 0–1.

Foto bertanda berukuran 1206 × 649 piksel, berbeda rasionya dari video. Karena itu koordinat draf **tidak boleh langsung diterapkan ke RTSP DVR** sebelum satu frame dari stream operasional dibandingkan dengan video dan batasnya digambar ulang bila ada crop atau perubahan rasio.

Pada 7 Oktober 2026, pemilik memeriksa pratinjau dan **mengonfirmasi bahwa area merah dan hijau sudah benar**. Konfirmasi ini berlaku untuk frame video yang ditampilkan, bukan persetujuan deteksi operasional atau bukti bahwa koordinatnya cocok dengan stream RTSP DVR.

Foto menu Playback DVR kemudian menunjukkan gambar yang sama pada `[A13] Camera 13`. Kanal analog sudah diketahui, tetapi frame dari stream RTSP operasional belum diperoleh. Respons `404` dari uji `curl -X DESCRIBE` sebelumnya tidak menentukan validitas URL kanal karena permintaan yang terkirim ternyata `OPTIONS *`.

Menu parameter DVR menunjukkan stream utama A13 memakai H.265, 960×1080 (1080P Lite), 15 fps, dan batas bitrate 1024 kbps. Keterbacaan label serta barang kecil pada resolusi dan sudut ini belum dapat dipastikan tanpa uji label pada jarak pemasangan nyata. Jika teks tidak cukup besar pada frame asli, perlu kamera dengan sudut lebih dekat ke label; menaikkan resolusi keluaran DVR saja tidak memulihkan detail yang tidak ditangkap kamera.

| Tanda pada pratinjau | Tafsir sementara | Status |
| --- | --- | --- |
| Merah, di jalan abu-abu sebelah kiri tembok rendah | `danger_zone` | Dikonfirmasi pemilik pada pratinjau; menunggu frame RTSP |
| Hijau, lantai ubin di kanan tembok rendah dan di bawah tembok belakang | `packing_area` | Dikonfirmasi pemilik pada pratinjau; menunggu frame RTSP |
| Kuning, sepanjang sisi tembok kiri dan tembok belakang | Lokasi pembatas yang diwarnai hitam pada foto pemilik | Garis bantu visual; bukan zona deteksi |

Dus yang tampak pada rekaman diabaikan sesuai arahan pemilik. Draf ini baru memuat zona merah dan hijau. Batas toko (`store_boundary`), lokasi asal barang (`box_area` pada kode), dan jalur pengemasan yang sah (`packing_route`) belum ditetapkan. Area packing yang terlihat tidak dengan sendirinya menunjukkan bahwa suatu barang telah melalui proses pengemasan. Sistem menolak persetujuan zona yang belum lengkap; deteksi anomali Camera 13 tetap tidak aktif.

Rekaman hanya beberapa detik dan tidak menunjukkan label invoice yang dapat dibaca atau perpindahan 1–3 pcs melintasi pembatas. OCR pada lima frame yang diambil tiap detik menghasilkan **0 kandidat invoice**; itu bukan bukti kejadian terlewat karena label yang dapat dibaca memang tidak tampak. Jarak/sudut pandang pada sampel ini belum cukup untuk membuktikan pembacaan label kecil atau pemisahan tiap pcs. Tidak ada dasar untuk menghitung peringatan keliru atau latensi notifikasi dari sampel ini.

Pratinjau berisi gambar orang. Berkasnya disimpan di penyimpanan privat aplikasi (`backend/storage/app/private/cctv/reviews/camera13-zones-draft.png`) pada lingkungan ini; Git hanya menyimpan koordinat dan catatan. Dua area telah dikonfirmasi pemilik. Tiga zona wajib dan kecocokan gambar RTSP masih perlu diperiksa sebelum deteksi dapat diaktifkan.
