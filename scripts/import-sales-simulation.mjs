#!/usr/bin/env node
/**
 * Impor penjualan simulasi Aneka Jaya (Jul–Des 2026) ke satu instance lewat API Input Penjualan,
 * jadi nomor nota, potong stok, jurnal, dan DO dibuat sama seperti input dari kasir.
 *
 * Data: scripts/data/simulasi-penjualan-aj-v12-jul-des-2026.json.gz (file v12, 1.464 nota,
 * tanpa hari Minggu). Jam diacak 09:00–15:35. Harga jual dari file; semua nota dibayar Cash.
 *
 * Pakai (default hanya cek, tidak menyimpan apa pun):
 *   IMPORT_USER=owner IMPORT_PASSWORD=... node scripts/import-sales-simulation.mjs --url https://lcr.lrmint.xyz
 *   ... --commit            simpan sungguhan
 *   ... --tipe <id|kode>    tipe pembukuan (bawaan: tipe pertama yang bukan AJ)
 *   ... --limit 5           hanya N nota pertama (uji coba)
 *
 * Aman diulang: tiap nota memakai clientRequestId SIM12-<no nota>, jadi nota yang sudah masuk dilewati.
 * Nama customer selalu "Walk In"; kode pelanggan di file ditaruh di catatan nota.
 * Barang dicocokkan ke Master Barang instance tujuan lewat SKU = ID barang di file (J-01, S-001, ...).
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (opt("url", process.env.IMPORT_URL) || "https://lcr.lrmint.xyz").replace(/\/+$/, "");
const FILE = opt("file", path.join(here, "data", "simulasi-penjualan-aj-v12-jul-des-2026.json.gz"));
const COMMIT = flag("commit");
const LIMIT = Number(opt("limit", "0")) || 0;
const TIPE = opt("tipe", "");
const USER = process.env.IMPORT_USER || "";
const PASSWORD = process.env.IMPORT_PASSWORD || "";

// Data simulasi ini hanya untuk lcr.lrmint.xyz; domain lain ditolak supaya SLM/MJ/ANKJY tidak ikut terisi.
const ALLOWED_HOST = "lcr.lrmint.xyz";
const targetHost = (() => { try { return new URL(BASE).hostname.toLowerCase(); } catch { return ""; } })();
if (BASE && targetHost !== ALLOWED_HOST && !(flag("test-host") && targetHost === "localhost")) {
  console.error(`Skrip ini hanya untuk https://${ALLOWED_HOST} (diminta: ${BASE}).`);
  process.exit(2);
}

if (!BASE || !USER || !PASSWORD) {
  console.error("Isi --url https://<domain> dan env IMPORT_USER / IMPORT_PASSWORD (akun Super Admin).");
  process.exit(2);
}

const rupiah = (n) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = "";
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: USER, password: PASSWORD })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(`Login gagal: ${json.message || res.status}`);
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : String(res.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z0-9_]+=)/);
  cookie = setCookies.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  if (!cookie) throw new Error("Login berhasil tetapi sesi tidak diterima.");
}

async function api(method, pathname, body, attempt = 1) {
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual"
    });
  } catch (error) {
    if (attempt < 4) { await sleep(2000 * attempt); return api(method, pathname, body, attempt + 1); }
    throw error;
  }
  if ((res.status === 401 || res.status === 307 || res.status === 302) && attempt < 3) {
    await login();
    return api(method, pathname, body, attempt + 1);
  }
  if (res.status >= 502 && res.status <= 504 && attempt < 4) { await sleep(3000 * attempt); return api(method, pathname, body, attempt + 1); }
  const json = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }));
  return { status: res.status, json };
}

async function loadProducts() {
  const all = [];
  for (let page = 1; ; page++) {
    const { json } = await api("GET", `/api/inventory/products?page=${page}&pageSize=200`);
    if (!json.success) throw new Error(`Gagal membaca Master Barang: ${json.message}`);
    all.push(...json.data);
    if (page >= (json.meta?.totalPages ?? 1)) break;
  }
  return all;
}

/** Cocokkan barang di file ke Master Barang: SKU = ID barang (J-01), lalu SKU = kode, lalu nama (+ satuan) yang unik. */
function buildMatcher(products) {
  const bySku = new Map(products.map((p) => [norm(p.sku), p]));
  const group = (keyFn) => {
    const m = new Map();
    for (const p of products) { const k = keyFn(p); m.set(k, [...(m.get(k) ?? []), p]); }
    return m;
  };
  const byName = group((p) => norm(p.name));
  const byNameUnit = group((p) => `${norm(p.name)}|${norm(p.unit)}`);
  return (item) => {
    const direct = bySku.get(norm(item.itemId));
    if (direct) return { product: direct, via: "SKU = ID barang" };
    const code = bySku.get(norm(item.code));
    if (code) return { product: code, via: "SKU = kode" };
    const nameUnit = byNameUnit.get(`${norm(item.name)}|${norm(item.unitSource)}`);
    if (nameUnit?.length === 1) return { product: nameUnit[0], via: "nama + satuan" };
    const name = byName.get(norm(item.name));
    if (name?.length === 1) return { product: name[0], via: "nama" };
    return { product: null, candidates: (name ?? []).map((p) => p.sku) };
  };
}

const isLusin = (unit) => /^(lusin|dz|dozen|lsn)$/i.test(String(unit).trim());
/** Jumlah mengikuti satuan di Master Barang; nilai baris tetap sama dengan Omzet di file. */
function quantityFor(item, product) {
  if (isLusin(product.unit)) return { qty: item.qtyLusin, unitWarn: false };
  if (norm(product.unit) === norm(item.unitSource)) return { qty: item.qtyUnit, unitWarn: false };
  return { qty: item.qtyLusin, unitWarn: true };
}

async function main() {
  const notas = JSON.parse(gunzipSync(readFileSync(FILE)).toString("utf8"));
  const selected = LIMIT ? notas.slice(0, LIMIT) : notas;
  console.log(`${COMMIT ? "SIMPAN" : "CEK SAJA (tambahkan --commit untuk menyimpan)"} ke ${BASE}`);
  console.log(`File: ${selected.length} nota, ${selected[0]?.date} s/d ${selected.at(-1)?.date}`);

  await login();

  const tipeRes = await api("GET", "/api/tipe");
  if (!tipeRes.json.success) throw new Error(`Gagal membaca Tipe: ${tipeRes.json.message}`);
  const types = tipeRes.json.data.filter((t) => t.isActive !== false);
  const tipe = TIPE
    ? types.find((t) => norm(t.id) === norm(TIPE) || norm(t.code) === norm(TIPE))
    : types.find((t) => norm(t.code) !== "aj");
  console.log(`Tipe tersedia: ${types.map((t) => `${t.code} (${t.id})`).join(", ") || "-"}`);
  if (!tipe) throw new Error(TIPE ? `Tipe ${TIPE} tidak ditemukan.` : "Tidak ada tipe selain AJ. Pilih dengan --tipe.");
  if (norm(tipe.code) === "aj") throw new Error("Tipe AJ dikirim ke ERP Aneka Jaya. Pilih tipe lain dengan --tipe.");
  console.log(`Dipakai: tipe ${tipe.code} (${tipe.name}), pembayaran Cash`);


  const products = await loadProducts();
  console.log(`Master Barang: ${products.length} barang aktif`);
  const match = buildMatcher(products);

  const unmatched = new Map();
  const unitWarn = new Map();
  const via = new Map();
  const payloads = [];
  let total = 0;
  for (const n of selected) {
    const lines = new Map();
    for (const item of n.items) {
      const m = match(item);
      if (!m.product) { unmatched.set(item.itemId, `${item.itemId} ${item.name} (${item.unitSource})${m.candidates?.length ? ` · kandidat: ${m.candidates.join(", ")}` : ""}`); continue; }
      via.set(m.via, (via.get(m.via) ?? 0) + 1);
      const p = m.product;
      const { qty, unitWarn: warn } = quantityFor(item, p);
      if (warn) unitWarn.set(p.sku, `${p.sku} ${p.name}: satuan ${p.unit}, di file ${item.unitSource}; dipakai jumlah lusin`);
      const prev = lines.get(p.id);
      const quantity = (prev?.quantity ?? 0) + qty;
      const amount = (prev?.amount ?? 0) + item.amount;
      lines.set(p.id, { productRef: p.sku, productId: p.id, productInputMode: "erp", unitSnapshot: p.unit, quantity, amount });
    }
    // Harga satuan = Omzet / jumlah, jadi total nota sama persis dengan file.
    const items = [...lines.values()].map(({ amount, ...line }) => {
      const unitPrice = Math.round((amount / line.quantity) * 100) / 100;
      return { ...line, unitPrice, discount: Math.max(0, Math.round((unitPrice * line.quantity - amount) * 100) / 100) };
    });
    total += items.reduce((s, i) => s + i.quantity * i.unitPrice - i.discount, 0);
    payloads.push({
      nota: n.nota,
      body: {
        saleDate: n.date,
        transactionAt: `${n.date}T${n.time}`,
        tipeId: tipe.id,
        tipeCodeSnapshot: tipe.code,
        tipeNameSnapshot: tipe.name,
        customerName: "Walk In",
        customerLocation: n.area,
        shippingMethod: "di Tempat",
        paymentMethod: "Cash",
        notes: `Impor simulasi ${n.nota} · ${n.customer}`,
        clientRequestId: `SIM12-${n.nota}`,
        allowDuplicate: true,
        items
      }
    });
  }

  console.log(`Barang cocok lewat: ${[...via].map(([k, v]) => `${k} ${v} baris`).join(", ") || "-"}`);
  const fileTotal = selected.reduce((s, n) => s + n.items.reduce((t, i) => t + i.amount, 0), 0);
  console.log(`Total penjualan: ${rupiah(total)} (di file ${rupiah(fileTotal)}) · semua Cash`);
  const report = (title, map) => { if (map.size) { console.log(`\n${title} (${map.size}):`); for (const v of map.values()) console.log(`  - ${v}`); } };
  report("Barang di file yang TIDAK ditemukan di Master Barang", unmatched);
  report("Satuan berbeda (cek)", unitWarn);

  if (unmatched.size) {
    console.log("\nBelum bisa disimpan: tambahkan barang di atas ke Master Barang dengan SKU = ID barang di file (mis. J-01), lalu jalankan lagi.");
    process.exit(1);
  }
  if (!COMMIT) { console.log("\nCek selesai, tidak ada yang disimpan. Jalankan lagi dengan --commit."); return; }

  let created = 0, skipped = 0;
  for (let i = 0; i < payloads.length; i++) {
    const { nota, body } = payloads[i];
    const { status, json } = await api("POST", "/api/sales", body);
    if (!json.success) {
      console.error(`\nGagal di nota ${nota} (${i + 1}/${payloads.length}, HTTP ${status}): ${json.message}`);
      console.error("Perbaiki lalu jalankan perintah yang sama lagi; nota yang sudah masuk akan dilewati.");
      process.exit(1);
    }
    if (json.data?.idempotentReplay) skipped++; else created++;
    if ((i + 1) % 50 === 0 || i + 1 === payloads.length) console.log(`${i + 1}/${payloads.length} · baru ${created} · sudah ada ${skipped} · ${body.saleDate}`);
  }
  console.log(`\nSelesai: ${created} nota baru, ${skipped} sudah ada sebelumnya.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
