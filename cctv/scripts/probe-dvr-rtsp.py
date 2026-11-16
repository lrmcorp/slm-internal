#!/usr/bin/env python3
"""Probe one private DVR stream with RTSP DESCRIBE and optional interactive auth.

No password is accepted on the command line or printed in the result. This
checks stream metadata only; it does not decode or record video.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import ipaddress
import re
import secrets
import socket


LAN_RANGES = tuple(map(ipaddress.ip_network, (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
)))
TAILSCALE_RANGE = ipaddress.ip_network("100.64.0.0/10")
AUTH_PARAMS = re.compile(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))')


def md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()


def describe(connection: socket.socket, uri: str, cseq: int, auth: str = "") -> str:
    headers = [
        f"DESCRIBE {uri} RTSP/1.0",
        f"CSeq: {cseq}",
        "Accept: application/sdp",
    ]
    if auth:
        headers.append(f"Authorization: {auth}")
    payload = ("\r\n".join(headers) + "\r\n\r\n").encode("utf-8")
    connection.sendall(payload)
    response = b""
    while b"\r\n\r\n" not in response:
        chunk = connection.recv(4096)
        if not chunk:
            raise ConnectionError("DVR menutup koneksi sebelum header lengkap")
        response += chunk
        if len(response) > 65536:
            raise ValueError("Respons RTSP terlalu besar")
    header, _, body = response.partition(b"\r\n\r\n")
    length = re.search(rb"(?im)^Content-Length:\s*(\d+)\s*$", header)
    body_length = int(length.group(1)) if length else 0
    if body_length > 65536:
        raise ValueError("Isi respons RTSP terlalu besar")
    while len(body) < body_length:
        chunk = connection.recv(min(4096, body_length - len(body)))
        if not chunk:
            raise ConnectionError("DVR menutup koneksi sebelum isi lengkap")
        body += chunk
    response = header + b"\r\n\r\n" + body
    return response.decode("utf-8", "replace")


def status(response: str) -> str:
    return response.splitlines()[0] if response else "DVR menutup koneksi tanpa respons RTSP"


def auth_headers(response: str) -> list[str]:
    return [line.split(":", 1)[1].strip() for line in response.splitlines()
            if line.lower().startswith("www-authenticate:")]


def make_auth(challenges: list[str], username: str, password: str, uri: str) -> str | None:
    digest = next((value[7:].strip() for value in challenges
                   if value.lower().startswith("digest ")), None)
    if digest is not None:
        params = {match.group(1).lower(): match.group(2) if match.group(2) is not None else match.group(3)
                  for match in AUTH_PARAMS.finditer(digest)}
        realm, nonce = params.get("realm"), params.get("nonce")
        if not realm or not nonce:
            return None
        algorithm = params.get("algorithm", "MD5").upper()
        if algorithm not in ("MD5", "MD5-SESS"):
            return None
        cnonce = secrets.token_hex(8)
        ha1 = md5(f"{username}:{realm}:{password}")
        if algorithm == "MD5-SESS":
            ha1 = md5(f"{ha1}:{nonce}:{cnonce}")
        ha2 = md5(f"DESCRIBE:{uri}")
        fields = [f'username="{username}"', f'realm="{realm}"', f'nonce="{nonce}"',
                  f'uri="{uri}"', "algorithm=MD5" if algorithm == "MD5" else "algorithm=MD5-sess"]
        qops = [item.strip().lower() for item in params.get("qop", "").split(",") if item.strip()]
        if qops:
            if "auth" not in qops:
                return None
            response = md5(f"{ha1}:{nonce}:00000001:{cnonce}:auth:{ha2}")
            fields.extend(["qop=auth", "nc=00000001", f'cnonce="{cnonce}"'])
        else:
            response = md5(f"{ha1}:{nonce}:{ha2}")
            if algorithm == "MD5-SESS":
                fields.append(f'cnonce="{cnonce}"')
        fields.append(f'response="{response}"')
        if "opaque" in params:
            fields.append(f'opaque="{params["opaque"]}"')
        return "Digest " + ", ".join(fields)
    if any(value.lower().startswith("basic ") for value in challenges):
        encoded = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        return f"Basic {encoded}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Uji RTSP DESCRIBE DVR melalui Tailscale Serve.")
    parser.add_argument("bridge_ip", help="IP Tailscale komputer toko")
    parser.add_argument("dvr_ip", help="IP LAN DVR")
    parser.add_argument("--bridge-port", type=int, default=8554)
    parser.add_argument("--dvr-port", type=int, default=554)
    parser.add_argument("--channel", type=int, default=13)
    parser.add_argument("--show-password", action="store_true",
                        help="Tampilkan sandi saat diketik; jangan bagikan foto terminal.")
    args = parser.parse_args()

    try:
        bridge = ipaddress.IPv4Address(args.bridge_ip)
        dvr = ipaddress.IPv4Address(args.dvr_ip)
    except ipaddress.AddressValueError:
        parser.error("Masukkan alamat IPv4 yang valid.")
    if bridge not in TAILSCALE_RANGE:
        parser.error("IP penghubung harus berada di rentang Tailscale 100.64.0.0/10.")
    if not any(dvr in network for network in LAN_RANGES):
        parser.error("IP DVR harus berada di LAN privat.")
    if not 1 <= args.bridge_port <= 65535 or not 1 <= args.dvr_port <= 65535:
        parser.error("Port harus antara 1 dan 65535.")
    if not 1 <= args.channel <= 64:
        parser.error("Nomor kanal harus antara 1 dan 64.")

    uri = f"rtsp://{dvr}:{args.dvr_port}/Streaming/Channels/{args.channel}01"
    try:
        with socket.create_connection((str(bridge), args.bridge_port), timeout=10) as connection:
            first = describe(connection, uri, 1)
        print(status(first))
        if not first.startswith("RTSP/1.0 401"):
            return 0 if first.startswith("RTSP/1.0 200") else 1
        challenges = auth_headers(first)
        if not challenges:
            print("DVR meminta login tanpa menyebut metode autentikasi.")
            return 1
        username = input("Nama pengguna DVR: ").strip()
        if not username or '"' in username or "\r" in username or "\n" in username:
            print("Nama pengguna DVR tidak valid.")
            return 1
        password = (input("Kata sandi DVR (terlihat di layar): ") if args.show_password
                    else getpass.getpass("Kata sandi DVR (tidak terlihat): "))
        # Ask for a fresh challenge after the human has finished typing. Retry
        # on that same TCP connection; some DVRs bind the nonce to a connection.
        with socket.create_connection((str(bridge), args.bridge_port), timeout=10) as connection:
            fresh = describe(connection, uri, 1)
            if not fresh.startswith("RTSP/1.0 401"):
                del password
                print(status(fresh))
                return 0 if fresh.startswith("RTSP/1.0 200") else 1
            auth = make_auth(auth_headers(fresh), username, password, uri)
            del password
            if auth is None:
                print("Metode autentikasi DVR tidak didukung oleh alat uji ini.")
                return 1
            second = describe(connection, uri, 2, auth)
        print(status(second))
        return 0 if second.startswith("RTSP/1.0 200") else 1
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"Uji RTSP gagal: {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
