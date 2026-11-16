# Video live dan pemrosesan QR/AI

Tampilan video mengambil aliran langsung dari DVR melalui proses FFmpeg terpisah. Video tidak lagi menunggu frame hasil inferensi. Pekerja QR/AI tetap membaca sumber semula dan menyimpan foto serta cuplikan bukti seperti sebelumnya.

Untuk Hikvision, aliran `.../Streaming/Channels/1402` diprioritaskan bagi tampilan A14, sedangkan QR tetap memakai `1401`. Jika sub-stream tidak dapat dibaca, pemutar memakai main-stream. Mekanisme yang sama berlaku pada A12/A13. Tidak ada perubahan kata sandi atau pengaturan DVR.

Jika DVR mengirim H.264, server meneruskan paket video tanpa encoding ulang; frame rate mengikuti DVR. Jika aliran memakai H.265, server mengonversi ke H.264 untuk browser, dengan target 15 fps, lebar maksimal 640 piksel, dan satu thread encoder per kamera. Nilai ini membatasi beban pada VPS; kelancaran tetap bergantung pada kemampuan DVR, jaringan, dan CPU server.

Pengaturan opsional pada environment pekerja kamera:

| Nama | Default | Fungsi |
|---|---|---|
| `CCTV_LIVE_USE_SUBSTREAM` | `true` | Prioritaskan sub-stream Hikvision untuk tampilan |
| `CCTV_LIVE_SOURCE` | sumber otomatis | URL RTSP live khusus; simpan sebagai rahasia pada server |
| `CCTV_LIVE_FPS` | `15` | Target fps ketika encoding ulang; bukan perubahan fps inferensi |
| `CCTV_LIVE_MAX_WIDTH` | `640` | Lebar maksimum ketika encoding ulang |

Deployment otomatis memperbarui kode dan memulai kembali pekerja kamera yang sebelumnya aktif. Konfigurasi kamera dan bukti privat dipertahankan. Sesudah deployment, muat ulang dashboard agar JavaScript pemutar baru terpakai.

## Jeda dan tracking

Pemutar tetap memakai HLS yang terautentikasi. Target segmen satu detik; DVR H.264 dengan keyframe jarang bisa menghasilkan segmen lebih panjang. Buffer browser dikurangi, tetapi ini belum WebRTC dan belum dapat dijanjikan latensi di bawah satu detik.

Video langsung tidak memiliki kotak AI yang dibakar ke setiap frame. Ringkasan jumlah track diperbarui terpisah pada dashboard; gambar pengamatan dan bukti kejadian tetap memuat kotak hasil deteksi. Kotak pengamatan tidak boleh dianggap sinkron persis dengan frame video yang sedang diputar.

## Pemeriksaan setelah deployment

Buka A12/A13/A14 dan bandingkan gerakan dengan Hik-Connect. Catat selisih waktu tampilan terhadap kejadian nyata, kelancaran saat tiga kamera dibuka, serta beban CPU VPS. Pastikan QR A14 masih menghasilkan catatan dan foto; pastikan proses deteksi yang sudah dikonfigurasi tetap mengirim pengamatan. Jika aliran live terhenti, playlist yang tidak diperbarui lebih dari 20 detik ditolak, sehingga rekaman lama tidak terus dianggap live.

Uji lokal memastikan pipeline video menghasilkan H.264 15 fps tanpa pasokan frame dari proses AI, fallback sub-stream, serta restart proses video. Pengujian ini tidak membuktikan latensi jaringan toko atau kualitas deteksi pada kamera nyata.
