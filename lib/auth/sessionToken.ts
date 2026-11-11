import { createHmac, timingSafeEqual } from "node:crypto";
import { ROLES, type Role } from "./roles";

/**
 * Token sesi login lokal (ditandatangani HMAC). Tanpa next/headers supaya bisa dipakai di proxy.
 * Super Admin (OWNER): sesi bergeser, diperpanjang setiap buka aplikasi / pindah menu, dan habis setelah
 * 24 jam tanpa aktivitas. Role lain: 12 jam sejak login, dan hanya di jam kerja (lihat accessHours).
 */
export const LOCAL_SESSION_COOKIE = "aneka_jaya_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const OWNER_IDLE_TTL_SECONDS = 60 * 60 * 24;
/** Perpanjangan paling sering tiap 5 menit, supaya tidak menulis cookie di setiap request. */
const REFRESH_AFTER_SECONDS = 60 * 5;

export type SessionPayload = { externalId: string; name?: string; role?: Role; exp: number };

export function sessionTtlFor(role?: Role) {
  return role === "OWNER" ? OWNER_IDLE_TTL_SECONDS : SESSION_TTL_SECONDS;
}

type Env = Record<string, string | undefined>;
type Hours = { start: number; end: number };

/** Admin (kasir), Petugas DO (packing), dan Gudang selesai lebih awal dari role lain. */
const ROLE_END_DEFAULT: Partial<Record<Role, number>> = { ADMIN: 17 * 60, DELIVERY_DRIVER: 17 * 60, GUDANG: 17 * 60 };

function parseHours(raw: string): Hours | null | undefined {
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "") return null;
  const m = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})$/.exec(value);
  return m ? { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) } : undefined;
}

/**
 * Jam kerja (WIB) role selain Super Admin. Diatur per instance:
 *   ACCESS_HOURS            semua role (bawaan "08:00-18:00", "off" = tanpa batas)
 *   ACCESS_HOURS_<ROLE>     khusus satu role, mis. ACCESS_HOURS_ADMIN=08:00-17:00
 * Bawaan Admin dan Petugas DO selesai jam 17.00.
 */
export function accessHours(env: Env = process.env, role?: Role): Hours | null {
  if (role === "OWNER") return null;
  const own = role ? env[`ACCESS_HOURS_${role}`] : undefined;
  if (own !== undefined) {
    const parsed = parseHours(own);
    if (parsed !== undefined) return parsed;
  }
  const general = parseHours(env.ACCESS_HOURS ?? "08:00-18:00");
  if (general === null) return null;
  const base = general ?? { start: 8 * 60, end: 18 * 60 };
  const roleEnd = role ? ROLE_END_DEFAULT[role] : undefined;
  return roleEnd !== undefined ? { start: base.start, end: Math.min(base.end, roleEnd) } : base;
}

const label = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}.${String(minutes % 60).padStart(2, "0")}`;
export function accessHoursLabel(env: Env = process.env, role?: Role) {
  const h = accessHours(env, role);
  return h ? `${label(h.start)}–${label(h.end)} WIB` : null;
}

/** Menit sejak tengah malam WIB. */
function jakartaMinutes(now: number) {
  const d = new Date(now + 7 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function withinAccessHours(role: Role | undefined, now = Date.now(), env: Env = process.env) {
  if (role === "OWNER") return true;
  const h = accessHours(env, role);
  if (!h) return true;
  const m = jakartaMinutes(now);
  return m >= h.start && m < h.end;
}

/** Detik (epoch) saat jam kerja hari ini berakhir, untuk membatasi umur sesi role selain Super Admin. */
function accessEndEpoch(now: number, role?: Role, env: Env = process.env) {
  const h = accessHours(env, role);
  if (!h) return Infinity;
  const nowSec = Math.floor(now / 1000);
  return nowSec - jakartaMinutes(now) * 60 - (nowSec % 60) + h.end * 60;
}

function sessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SESSION_SECRET wajib diisi untuk login internal.");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function decodePayload(value: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (!parsed.externalId || typeof parsed.externalId !== "string") return null;
    if (!parsed.exp || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    const role = ROLES.includes(parsed.role as Role) ? (parsed.role as Role) : undefined;
    return { externalId: parsed.externalId, name: typeof parsed.name === "string" ? parsed.name : undefined, role, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function createSessionToken(externalId: string, role?: Role, now = Date.now()) {
  const ttlExp = Math.floor(now / 1000) + sessionTtlFor(role);
  const body: SessionPayload = { externalId, exp: role === "OWNER" ? ttlExp : Math.min(ttlExp, accessEndEpoch(now, role)) };
  if (role) body.role = role;
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return decodePayload(payload);
}

/** Token baru bila sesi Super Admin masih berlaku dan sudah lebih dari 5 menit sejak diperpanjang; selain itu null. */
export function renewedOwnerToken(token?: string | null, now = Date.now()): string | null {
  let session: SessionPayload | null;
  try {
    session = readSessionToken(token);
  } catch {
    return null;
  }
  if (!session || session.role !== "OWNER") return null;
  const remaining = session.exp - Math.floor(now / 1000);
  if (remaining > OWNER_IDLE_TTL_SECONDS - REFRESH_AFTER_SECONDS) return null;
  return createSessionToken(session.externalId, "OWNER", now);
}
