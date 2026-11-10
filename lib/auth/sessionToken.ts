import { createHmac, timingSafeEqual } from "node:crypto";
import { ROLES, type Role } from "./roles";

/**
 * Token sesi login lokal (ditandatangani HMAC). Tanpa next/headers supaya bisa dipakai di proxy.
 * Super Admin (OWNER): sesi bergeser, diperpanjang setiap buka aplikasi / pindah menu, dan habis setelah
 * 24 jam tanpa aktivitas. Role lain: 12 jam sejak login.
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
  const body: SessionPayload = { externalId, exp: Math.floor(now / 1000) + sessionTtlFor(role) };
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
