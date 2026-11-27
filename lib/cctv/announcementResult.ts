import crypto from "node:crypto";
import { CCTV_TOKEN, matchesToken } from "@/lib/cctv/client";
import type { CctvSpeaker } from "@/lib/cctv/speakers";

/** Hasil pemutaran pengumuman yang dikirim balik server CCTV (tanpa isi pengumuman). */
export type AnnouncementResult = { report: string; played: number[]; failed: number[]; error: string | null };

/** Token CCTV yang sama dengan /api/cctv/events: X-CCTV-Token, Bearer, atau tanda tangan HMAC. */
export function verifyCctvRequest(request: Request, rawBody: string, token = CCTV_TOKEN): boolean {
  if (matchesToken(request.headers.get("x-cctv-token"), token)) return true;
  const bearer = (request.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (bearer && matchesToken(bearer[1], token)) return true;
  const signature = request.headers.get("x-cctv-signature");
  if (!signature || !token) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", token).update(rawBody).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const channelList = (value: unknown) =>
  Array.isArray(value) ? Array.from(new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 64))) : [];

export function parseAnnouncementResult(body: unknown): AnnouncementResult | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const report = typeof raw.report === "string" && /^[a-z0-9-]{1,40}$/.test(raw.report) ? raw.report : null;
  if (!report) return null;
  const error = typeof raw.error === "string" ? raw.error.slice(0, 80) : null;
  return { report, played: channelList(raw.played_channels), failed: channelList(raw.failed_channels), error };
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`;
}

/** Isi push notification untuk Owner, mis. "Laporan pesanan sudah diumumkan" di speaker kanal 12 dan 15. */
export function announcementResultMessage(result: AnnouncementResult, speakers: CctvSpeaker[], slot: string) {
  const name = (channel: number) => speakers.find((s) => s.channel === channel)?.name || `kanal ${channel}`;
  const label = result.report === "do-backlog" ? "Laporan pesanan" : "Pengumuman";
  const played = joinNames(result.played.map(name));
  const failed = joinNames(result.failed.map(name));
  if (!result.played.length) {
    return { title: `${label} ${slot} gagal diumumkan`, body: `Speaker tidak bisa memutar di ${failed || "semua kanal"}. Cek sambungan PC hype dan DVR.` };
  }
  return {
    title: `${label} ${slot} sudah diumumkan`,
    body: failed ? `Diputar di ${played}. Gagal di ${failed}.` : `Diputar di speaker ${played}.`
  };
}
