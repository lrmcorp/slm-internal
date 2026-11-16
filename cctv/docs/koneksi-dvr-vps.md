# Koneksi DVR toko ke VPS melalui komputer Windows

## Pembaruan pengujian

Kamera label adalah **A14**, sedangkan **A12 dan A13** dipakai untuk dugaan anomali yang perlu diperiksa. Akun `dvr` perlu mendapat Remote Live View hanya untuk ketiga kanal tersebut. Zona A12 masih perlu digambar dan diperiksa pemilik.

IP DVR sempat berubah, sehingga penerusan Tailscale harus diperbarui. Periksa alamat terbaru pada menu TCP/IP sebelum menguji. Siapkan reservasi DHCP agar alamat tetap; alamat toko tidak dicatat di Git.

Uji tanpa login mencapai `401 Unauthorized`. Uji login akun `dvr` dan admin belum berhasil. Skrip uji sekarang mengambil tantangan autentikasi baru setelah sandi diketik, lalu mengirim login pada koneksi TCP yang sama. Perbaikan ini lulus simulasi server dengan nonce berbeda per koneksi dan respons yang terfragmentasi; hasil pada DVR nyata masih harus diuji. Gunakan versi skrip terbaru sebelum menilai sandi atau izin akun.

Opsi `--show-password` menampilkan sandi saat diketik untuk pengguna yang kesulitan dengan prompt tersembunyi. Jangan bagikan foto terminal saat opsi ini dipakai. Opsi ini tidak menyimpan sandi sebagai argumen perintah.

## Keadaan yang sudah diperiksa

- DVR: Hikvision `DS-7216HGHI-M1/T (NEW)`. IP lokal dan gateway sudah diberikan pemilik; sengaja tidak dicatat di Git. Foto menu Playback DVR menunjukkan rekaman yang dimaksud bernama `[A13] Camera 13`, sehingga kanal analognya sudah diketahui. Pemilik mengonfirmasi port RTSP `554`. Menu `Record > Parameter` untuk A13 menunjukkan stream utama H.265, 960×1080 (1080P Lite), 15 fps, dengan batas bitrate 1024 kbps.
- Modem toko: ZTE ZXHN F672Y. Menu akun `user` tidak menampilkan klien VPN. Jangan mengubah DMZ, *port forwarding*, atau membuka port DVR ke internet.
- Komputer Windows di toko terhubung melalui Wi-Fi. `Test-NetConnection` ke port `554` DVR menghasilkan `TcpTestSucceeded : True`. Jalur TCP lokal tersedia; login dan gambar RTSP belum diuji.
- VPS: Ubuntu 24.04. Tailscale sudah terpasang di VPS dan komputer Windows. `tailscale ping` dari VPS ke komputer berhasil; koneksi sempat memakai relay DERP lalu beralih ke jalur langsung. Tailscale Serve pada Windows sudah melaporkan penerusan port privat `8554` ke port `554` DVR dan berjalan di latar belakang. Permintaan RTSP `DESCRIBE` yang benar untuk A13 menghasilkan `401 Unauthorized`: DVR meminta login. Video belum berhasil dibuka. Uji `curl -X DESCRIBE` sebelumnya ternyata mengirim `OPTIONS *`, sehingga respons `404` saat itu **tidak menilai URL kanal A13**. Dashboard belum terpasang di VPS.

## Jalur yang dipilih

```text
Kamera → DVR → Wi-Fi toko → Windows + Tailscale ═ jaringan privat ═ VPS + Tailscale → pemroses video
```

Komputer Windows meneruskan **satu port TCP** dari alamat Tailscale miliknya ke port RTSP DVR. Cara ini tidak memerlukan VPN pada modem. Pemroses video harus memakai RTSP lewat TCP (*interleaved*), karena jalur ini tidak meneruskan UDP/RTP terpisah. Pekerja video sudah meminta mode TCP dari FFmpeg/OpenCV, tetapi kecocokannya dengan stream DVR tetap perlu diuji.

Komputer harus tetap menyala, tersambung Wi-Fi, dan tidak masuk mode tidur. Jika komputer dimatikan atau internet toko putus, video dan notifikasi berhenti sampai sambungan pulih; dashboard harus menampilkan status kamera terhenti. Adaptor USB–Ethernet dapat ditambahkan nanti jika Wi-Fi tidak stabil.

## Langkah di komputer Windows toko

1. Pasang **Tailscale untuk Windows** dari `https://tailscale.com/download/windows`. Masuk dengan akun yang dikuasai perusahaan. Jangan kirim kata sandi atau tautan masuk ke chat.
2. Pada menu Tailscale Windows, aktifkan **Run unattended** agar layanan tetap berjalan setelah pengguna Windows keluar. Atur Windows agar tidak tidur saat terhubung ke listrik. Untuk laptop, periksa juga pengaturan saat tutup layar ditutup.
3. Buka PowerShell sebagai Administrator. Setelah masuk ke Tailscale, periksa status:

   ```powershell
   & "C:\Program Files\Tailscale\tailscale.exe" status
   & "C:\Program Files\Tailscale\tailscale.exe" ip -4
   ```

4. Untuk uji awal, teruskan port privat `8554` ke port DVR `554`. Pastikan hanya perangkat perusahaan yang tergabung di jaringan Tailscale; **sebelum penggunaan operasional**, batasi aturan akses agar hanya VPS yang dapat memakai port ini:

   ```powershell
   & "C:\Program Files\Tailscale\tailscale.exe" serve --bg --tcp=8554 tcp://<IP-DVR>:554
   & "C:\Program Files\Tailscale\tailscale.exe" serve status
   ```

   Ganti `<IP-DVR>` dengan IP pada menu `Network / TCP-IP` DVR. Perintah memakai Tailscale **Serve**, bukan **Funnel**. Jangan menyalakan Funnel untuk DVR. Jika perintah gagal, catat teks kesalahannya tanpa kata sandi.

Kata sandi DVR tidak dimasukkan pada perintah PowerShell. Kredensial baca saja untuk stream nanti disimpan di `.env` pada VPS, bukan di Git.

## Langkah di VPS Ubuntu 24.04

1. Tailscale telah dipasang di VPS dan didaftarkan pada jaringan yang sama dengan komputer Windows. `tailscale ping` dari VPS ke komputer berhasil. Tailscale membuat sambungan keluar; port DVR tidak perlu dibuka di firewall publik VPS.
2. Batasi kebijakan akses Tailscale agar **hanya VPS** dapat membuka port `8554` di komputer penghubung. Jika jaringan Tailscale dipakai perangkat lain, jangan biarkan aturan bawaan yang mengizinkan semua perangkat mengaksesnya. Pertahankan akses SSH VPS saat mengubah firewall.
3. Catat alamat Tailscale komputer Windows dari `tailscale ip -4`. Dari VPS, uji `nc -vz <IP-TAILSCALE-WINDOWS> 8554`. Ini hanya memeriksa sambungan TCP.
4. Camera 13 telah terlihat sebagai kanal analog `A13` dan port RTSP `554` sudah dikonfirmasi. Permintaan RTSP `DESCRIBE` yang benar ke `/Streaming/Channels/1301` mendapat `401 Unauthorized`. Pemilik kemudian menemukan sandi admin dan membuat akun terpisah bernama `dvr`. Pemilik mengonfirmasi bahwa akun ini tidak memiliki izin lokal maupun izin administrasi jarak jauh, dan `Remote Live View` dibatasi ke A13. Kata sandi tidak dicatat di Git atau chat. Langkah berikutnya adalah uji autentikasi RTSP dengan akun ini, lalu uji pengambilan frame video sebelum URL final disimpan pada VPS.
5. Setelah stream terbaca, simpan URL final di `.env` VPS dengan izin terbatas, lalu uji dari **kontainer pemroses video**. Keberhasilan dari host VPS belum menjamin kontainer Docker dapat memakai rute yang sama.

Sebelum mengaktifkan deteksi, ambil satu frame dari stream DVR untuk mengecek ulang letak zona Camera 13. Video unggahan dan gambar zona memiliki rasio berbeda. Setelah itu ukur beban CPU, kejadian terlewat, peringatan keliru, serta waktu kirim notifikasi dengan rekaman nyata.

### Uji `DESCRIBE` RTSP tanpa memasang aplikasi

Jalankan kode Python bawaan Ubuntu berikut **di VPS**. Ganti kedua alamat contoh dengan IP Tailscale komputer toko dan IP lokal DVR. Kode ini tidak memakai atau menampilkan kata sandi:

```bash
python3 - <<'PY'
import socket

bridge_ip = "100.101.102.103"
dvr_ip = "192.168.1.50"
request = (
    f"DESCRIBE rtsp://{dvr_ip}:554/Streaming/Channels/1301 RTSP/1.0\r\n"
    "CSeq: 1\r\nAccept: application/sdp\r\n\r\n"
).encode("ascii")
with socket.create_connection((bridge_ip, 8554), timeout=10) as stream:
    stream.sendall(request)
    reply = stream.recv(4096).decode("ascii", "replace")
    print(reply.splitlines()[0] if reply else "DVR menutup koneksi tanpa respons")
PY
```

Respons `401` berarti server meminta autentikasi; `200` berarti deskripsi stream tersedia. Keduanya belum membuktikan gambar dapat diputar. Jika `404`, periksa format URL dan pengaturan autentikasi pada DVR. `curl -X DESCRIBE` tidak dipakai untuk uji ini karena versi `curl` yang diperiksa justru mengirim `OPTIONS *`.

Setelah akun DVR khusus melihat tersedia, dari checkout di VPS jalankan `python3 scripts/probe-dvr-rtsp.py <IP-TAILSCALE-WINDOWS> <IP-DVR> --channel 13`. Alat ini meminta nama pengguna dan kata sandi secara interaktif, tidak menampilkannya dan tidak menerimanya sebagai argumen perintah. Hasil `200` setelah autentikasi membuktikan deskripsi stream dapat dibaca; pengambilan frame tetap harus diuji terpisah.

## Jika komputer Windows tidak dapat terus menyala

Perangkat Linux kecil dengan Ethernet dapat menggantikannya sebagai penghubung Tailscale. Perangkat itu dapat mengiklankan rute hanya ke IP DVR (`/32`) melalui fitur *subnet router*; memerlukan persetujuan rute dan pengaturan IP forwarding. Pilihan ini baru diperlukan jika komputer Windows atau Wi-Fi tidak stabil.

## Yang belum tersedia

Aturan akses Tailscale untuk port RTSP, hasil autentikasi akun `dvr`, dan pemutaran video A13 dari VPS. Kanal analog Camera 13 dan port RTSP sudah diketahui sebagai `A13` dan `554`; permintaan DESCRIBE telah mencapai tahap autentikasi. Dashboard publik juga memerlukan domain, HTTPS, dan pemasangan aplikasi produksi. Sambungan privat DVR sendiri tidak menerbitkan dashboard atau APK.
