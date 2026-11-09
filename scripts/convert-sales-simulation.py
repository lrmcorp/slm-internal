#!/usr/bin/env python3
"""Ubah file Excel simulasi penjualan Aneka Jaya (v12 ke atas) menjadi data impor untuk lcr.

Pakai:  python3 scripts/convert-sales-simulation.py <file.xlsx> <versi, mis. 13>
Hasil:  scripts/data/simulasi-penjualan-aj-v<versi>-jul-des-2026.json.gz
        scripts/data/Master_Barang_lcr_simulasi_v<versi>.xlsx
Butuh:  pip install openpyxl

Aturan: jam tiap nota diacak 09:00-15:35 (urutan dalam sehari dipertahankan), nota hari Minggu
dipindah acak ke Sabtu/Senin, harga dan cara bayar dari kolom "Harga jual per lusin Rp", "Omzet Rp",
"Cara bayar" (impor tetap mencatat semua nota sebagai Cash). Setelah itu ubah nama file data dan awalan clientRequestId di import-sales-simulation.mjs.
"""
import collections
import datetime
import gzip
import json
import random
import sys

import openpyxl

src, version = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
sheet = wb["Transaksi"]
header = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True))
col = {name: i for i, name in enumerate(header)}
need = ["Tanggal", "Jam", "No. nota simulasi", "Kode pelanggan", "Segmen", "Kota/area", "Batch", "ID barang",
        "SKU / kode", "Barang", "Unit sumber", "Qty (lusin)", "Qty unit sumber", "Harga jual per lusin Rp", "Omzet Rp", "Cara bayar"]
missing = [n for n in need if n not in col]
if missing:
    sys.exit(f"Kolom tidak ada di sheet Transaksi: {', '.join(missing)}")

notas = collections.OrderedDict()
for r in sheet.iter_rows(min_row=2, values_only=True):
    if not r[col["Tanggal"]]:
        continue
    g = lambda name: r[col[name]]
    n = notas.setdefault(g("No. nota simulasi"), {
        "nota": g("No. nota simulasi"), "date": g("Tanggal").date(), "origTime": str(g("Jam")),
        "customer": g("Kode pelanggan"), "segment": g("Segmen"), "area": g("Kota/area"), "payment": g("Cara bayar"), "items": []})
    n["items"].append({"itemId": g("ID barang"), "code": g("SKU / kode"), "name": g("Barang"), "batch": g("Batch"),
                       "unitSource": g("Unit sumber"), "qtyLusin": g("Qty (lusin)"), "qtyUnit": g("Qty unit sumber"),
                       "pricePerLusin": g("Harga jual per lusin Rp"), "amount": g("Omzet Rp")})

rng = random.Random(int(version) * 1000 + 1)
day = datetime.timedelta(days=1)
for n in notas.values():
    if n["date"].weekday() == 6:
        n["date"] = n["date"] - day if rng.random() < 0.5 else n["date"] + day
by_day = collections.defaultdict(list)
for n in notas.values():
    by_day[n["date"]].append(n)
for lst in by_day.values():
    lst.sort(key=lambda n: (n["origTime"], n["nota"]))
    minutes = sorted(rng.randint(9 * 60, 15 * 60 + 35) for _ in lst)
    for n, m in zip(lst, minutes):
        n["time"] = f"{m // 60:02d}:{m % 60:02d}"

out = [{k: v for k, v in n.items() if k != "origTime"} | {"date": n["date"].isoformat()}
       for n in sorted(notas.values(), key=lambda n: (n["date"], n["time"], n["nota"]))]
data_path = f"scripts/data/simulasi-penjualan-aj-v{version}-jul-des-2026.json.gz"
with gzip.open(data_path, "wt") as f:
    json.dump(out, f, separators=(",", ":"))

master = [r for r in wb["Master Barang"].iter_rows(min_row=2, values_only=True) if r[0] and str(r[0])[:2] in ("J-", "S-")]
mb_header = next(wb["Master Barang"].iter_rows(min_row=1, max_row=1, values_only=True))
m = {name: i for i, name in enumerate(mb_header)}
x = openpyxl.Workbook()
ws = x.active
ws.title = "Opname"
ws.append(["Kode", "Nama Produk", "Kategori", "Satuan", "Modal per Satuan (Rp)", "Harga Jual", "Qty Gudang"])
for r in master:
    ws.append([r[m["ID barang"]], f"{r[m['Deskripsi']]} ({r[m['Unit sumber']]}, {r[m['Batch']]})", r[m["Kelompok"]], "Lusin",
               round(r[m["HPP per lusin Rp"]]), r[m["Harga jual per lusin Rp"]], r[m["Lusin bisa dijual"]]])
master_path = f"scripts/data/Master_Barang_lcr_simulasi_v{version}.xlsx"
x.save(master_path)

total = sum(i["amount"] for o in out for i in o["items"])
rupiah = f"{total:,.0f}".replace(",", ".")
print(f"{len(out)} nota, {sum(len(o['items']) for o in out)} baris, omzet Rp{rupiah}")
print(f"Cara bayar: {dict(collections.Counter(o['payment'] for o in out))}")
print(f"Ditulis: {data_path} dan {master_path} ({len(master)} barang)")
