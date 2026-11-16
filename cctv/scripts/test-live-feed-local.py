#!/usr/bin/env python3
"""Script untuk menarik frame live Kamera 14 (Packing/Label) dari server produksi cctv.lrmslm.com ke lingkungan lokal."""

import urllib.request
import urllib.parse
import http.cookiejar
import re
import os
import sys

BASE_URL = "https://cctv.lrmslm.com"
EMAIL = os.environ.get("CCTV_TEST_EMAIL", "ralamzah@gmail.com")
PASSWORD = os.environ.get("CCTV_TEST_PASSWORD", "ridho123")
OUTPUT_PATH = "/tmp/cctv_live_camera_14.jpg"

def main():
    print(f"1. Menghubungi {BASE_URL}/login...")
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

    req = urllib.request.Request(f"{BASE_URL}/login", headers={"User-Agent": "Mozilla/5.0"})
    with opener.open(req) as resp:
        html = resp.read().decode('utf-8')

    token_match = re.search(r'name="_token"\s+value="([^"]+)"', html)
    if not token_match:
        print("Gagal mengambil CSRF token dari halaman login.")
        return 1
    token = token_match.group(1)

    print(f"2. Mengautentikasi sebagai {EMAIL}...")
    login_data = urllib.parse.urlencode({
        "_token": token,
        "email": EMAIL,
        "password": PASSWORD
    }).encode('utf-8')
    req_login = urllib.request.Request(f"{BASE_URL}/login", data=login_data, headers={"User-Agent": "Mozilla/5.0"})
    with opener.open(req_login) as resp:
        if "login" in resp.geturl():
            print("Login gagal! Periksa kredensial.")
            return 1

    print("3. Berhasil login. Menarik live frame Kamera 1 (Kamera 14 - Packing/Label)...")
    req_frame = urllib.request.Request(f"{BASE_URL}/cameras/1/live-frame", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with opener.open(req_frame) as resp:
            data = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            print(f"   Status HTTP: {resp.status}")
            print(f"   Content-Type: {content_type}")
            print(f"   Ukuran frame: {len(data):,} bytes")

            if len(data) > 1000 and data.startswith(b'\xff\xd8'):
                with open(OUTPUT_PATH, "wb") as f:
                    f.write(data)
                print(f"   Frame berhasil disimpan secara lokal di: {OUTPUT_PATH}")
                print(">>> Live Frame Kamera 14 berhasil ditarik secara real-time dari server produksi! <<<")
                return 0
            else:
                print("   Data bukan frame JPEG yang valid.")
                return 1
    except urllib.error.HTTPError as e:
        print(f"Gagal menarik frame: HTTP {e.code} ({e.reason})")
        return 1

if __name__ == "__main__":
    sys.exit(main())
