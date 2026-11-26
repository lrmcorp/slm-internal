#!/bin/sh
# Relay RTSP di dalam stack CCTV. Satu sambungan ke DVR per stream dipakai bersama oleh pembaca QR (vision)
# dan live realtime di dashboard. Konfigurasi dibuat dari CCTV_CAMERA_<n>_URL setiap kali container mulai;
# alamat DVR (berisi password) hanya ada di file sementara di dalam container, tidak dicetak ke log.
set -eu
CONFIG=/tmp/go2rtc.yaml
umask 077

quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

{
  echo "log:"
  echo "  level: ${GO2RTC_LOG_LEVEL:-warn}"
  echo "api:"
  echo "  listen: ':1984'"
  echo "rtsp:"
  echo "  listen: ':8554'"
  # Hanya RTSP dan HTTP di jaringan internal stack; WebRTC dan yang lain tidak dipakai.
  echo "webrtc:"
  echo "  listen: ''"
  echo "srtp:"
  echo "  listen: ''"
  echo "streams:"
  env | grep -E '^CCTV_CAMERA_[0-9]+_URL=rtsp' | sort | while IFS= read -r line; do
    url=${line#*=}
    channel=$(printf '%s' "$url" | sed -nE 's#^.*/Streaming/Channels/([0-9]+)0[1-9]([?].*)?$#\1#p')
    [ -n "$channel" ] || continue
    for stream in 01 02; do
      source=$(printf '%s' "$url" | sed -E "s#(/Streaming/Channels/[0-9]+)0[1-9]([?].*)?\$#\\1${stream}\\2#")
      echo "  ch${channel}${stream}: $(quote "$source")"
    done
    # Sub-stream versi H.264 untuk browser yang tidak bisa memutar H.265 (mis. Chrome tanpa dukungan perangkat).
    # ffmpeg hanya berjalan selama ada yang menonton varian ini; stream asli tidak berubah.
    echo "  ch${channel}02h264: 'ffmpeg:ch${channel}02#video=h264#raw=-preset ultrafast -tune zerolatency -g 15 -threads 1'"
  done
} > "$CONFIG"

echo "go2rtc: $(grep -cE '^  ch[0-9]+:' "$CONFIG") stream disiapkan"
exec go2rtc -config "$CONFIG"
