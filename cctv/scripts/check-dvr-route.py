#!/usr/bin/env python3
"""Check TCP reachability to a DVR over a private network, without credentials."""

import argparse
import ipaddress
import socket


PRIVATE_LANS = tuple(ipaddress.ip_network(cidr) for cidr in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10",
))


def main() -> int:
    parser = argparse.ArgumentParser(description="Periksa jalur privat VPS ke port RTSP DVR.")
    parser.add_argument("dvr_ip", help="IP lokal DVR di toko (atau IP Tailscale komputer toko)")
    parser.add_argument("--port", type=int, default=554, help="Port RTSP DVR (bawaan: 554)")
    args = parser.parse_args()

    try:
        address = ipaddress.IPv4Address(args.dvr_ip)
    except ipaddress.AddressValueError:
        parser.error("Masukkan alamat IPv4 lokal DVR yang valid.")
    if not any(address in network for network in PRIVATE_LANS):
        parser.error("Hanya IP LAN privat DVR yang boleh diperiksa; jangan pakai IP publik.")
    if not 1 <= args.port <= 65535:
        parser.error("Port harus antara 1 dan 65535.")

    try:
        with socket.create_connection((str(address), args.port), timeout=5):
            print(f"TCP {address}:{args.port} terjangkau dari VPS. Video dan login RTSP belum diuji.")
            return 0
    except ConnectionRefusedError:
        print("DVR/jalur merespons, tetapi port menolak koneksi. Periksa port dan pengaturan RTSP DVR.")
    except TimeoutError:
        print("Koneksi habis waktu. Periksa VPN, rute ke IP DVR, dan firewall toko.")
    except OSError as exc:
        print(f"Koneksi gagal: {type(exc).__name__}. Periksa VPN, IP DVR, dan port.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
