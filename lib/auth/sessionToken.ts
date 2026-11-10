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

/**
 * Jam kerja (WIB) untuk semua role selain Super Admin. Diatur per instance lewat ACCESS_HOURS,
 * mis. "08:00-18:00" (bawaan) atau "off" untuk tanpa batas jam.
 */
export function accessHours(env: Record<string, string | undefined> = process.env) {
  const raw = (env.ACCESS_HOURS ?? "08:00-18:00").trim().toLowerCase();
  if (raw === "off" || raw === "") return null;
  const m = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})$/.exec(raw);
  if (!m) return { start: 8 * 60, end: 18 * 60 };
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

const label = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}.${String(minutes % 60).padStart(2, "0")}`;
export function accessHoursLabel(env: Record<string, string | undefined> = process.env) {
  const h = accessHours(env);
  return h ? `${label(h.start)}–${label(h.end)} WIB` : null;
}

/** Menit sejak tengah malam WIB. */
function jakartaMinutes(now: number) {
  const d = new Date(now + 7 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function withinAccessHours(role: Role | undefined, now = Date.now(), env: Record<string, string | undefined> = process.env) {
  if (role === "OWNER") return true;
  const h = accessHours(env);
  if (!h) return true;
  const m = jakartaMinutes(now);
  return m >= h.start && m < h.end;
}

/** Detik (epoch) saat jam kerja hari ini berakhir, untuk membatasi umur sesi role selain Super Admin. */
function accessEndEpoch(now: number, env: Record<string, string | undefined> = process.env) {
  const h = accessHours(env);
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
  const body: SessionPayload = { externalId, exp: role === "OWNER" ? ttlExp : Math.min(ttlExp, accessEndEpoch(now)) };
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
