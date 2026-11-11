#!/usr/bin/env node
/**
 * Buat token integrasi MJ -> SLM yang permanen (tanpa masa berlaku).
 *   node scripts/generate-mj-token.mjs              (environment production)
 *   node scripts/generate-mj-token.mjs sandbox
 * Hasil:
 *   - .env MJ  : SLM_API_TOKEN=<token asli>   (hapus SLM_API_TOKEN_EXPIRES_AT)
 *   - .env SLM : MJ_INTEGRATION_TOKEN_BCRYPT='<hash bcrypt>'   (tanda kutip tunggal wajib: hash berisi $)
 * Token asli hanya tampil sekali dan tidak disimpan di SLM. Untuk mengganti token, jalankan lagi lalu perbarui
 * kedua .env; token lama otomatis tidak berlaku. Untuk memblokir MJ, kosongkan MJ_INTEGRATION_TOKEN_BCRYPT.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const environment = (process.argv[2] || "production").trim().toLowerCase();
if (!["production", "sandbox"].includes(environment)) {
  console.error("Pakai: node scripts/generate-mj-token.mjs [production|sandbox]");
  process.exit(1);
}
const token = `slm_${environment}_${randomBytes(4).toString("hex")}_${randomBytes(32).toString("base64url")}`;
const hash = bcrypt.hashSync(token, 12);

console.log("Simpan sekarang; token tidak bisa ditampilkan ulang.\n");
console.log("1) .env aplikasi MJ (ganti nilai lama, hapus baris SLM_API_TOKEN_EXPIRES_AT):");
console.log(`SLM_API_TOKEN=${token}\n`);
console.log("2) .env aplikasi SLM (tanda kutip tunggal wajib):");
console.log(`MJ_INTEGRATION_TOKEN_BCRYPT='${hash}'\n`);
console.log("3) Jalankan ulang container kedua aplikasi supaya .env baru terbaca.");
