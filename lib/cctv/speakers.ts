import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Speaker yang bisa dipakai untuk pengumuman: kanal two-way audio DVR beserta nama yang diberi Owner.
 * Bawaan = kanal yang menerima sesi bicara saat diuji 25 Nov 2026, tanpa kanal 13 (titik itu tidak dipakai,
 * keputusan pemilik 26 Nov 2026). Laporan pesanan 12.30/15.00 diputar di kanal 12 dan 15.
 */
export type CctvSpeaker = { channel: number; name: string };

const KEY = "cctv.speakers";
export const BACKLOG_SPEAKER_CHANNELS = [12, 15];
export const DEFAULT_SPEAKERS: CctvSpeaker[] = [1, 2, 5, 6, 12, 15].map((channel) => ({
  channel,
  name: BACKLOG_SPEAKER_CHANNELS.includes(channel) ? `Kanal ${channel} (laporan pesanan)` : `Kanal ${channel}`
}));

/** Kanal laporan pesanan: CCTV_ANNOUNCE_CHANNELS (mis. "12,15") atau bawaan 12 dan 15. */
export function backlogSpeakerChannels(env: Record<string, string | undefined> = process.env): number[] {
  const parsed = String(env.CCTV_ANNOUNCE_CHANNELS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((channel) => Number.isInteger(channel) && channel >= 1 && channel <= 64);
  return parsed.length ? Array.from(new Set(parsed)) : BACKLOG_SPEAKER_CHANNELS;
}

export function normalizeSpeakers(input: unknown): CctvSpeaker[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const result: CctvSpeaker[] = [];
  for (const row of input) {
    const channel = Number((row as { channel?: unknown })?.channel);
    const name = String((row as { name?: unknown })?.name ?? "").trim().slice(0, 60);
    if (!Number.isInteger(channel) || channel < 1 || channel > 64 || seen.has(channel)) continue;
    seen.add(channel);
    result.push({ channel, name: name || `Kanal ${channel}` });
  }
  return result.sort((a, b) => a.channel - b.channel);
}

export async function listSpeakers(): Promise<CctvSpeaker[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (!row) return DEFAULT_SPEAKERS;
  try {
    const saved = normalizeSpeakers(JSON.parse(row.value));
    return saved.length ? saved : DEFAULT_SPEAKERS;
  } catch {
    return DEFAULT_SPEAKERS;
  }
}

export async function saveSpeakers(speakers: CctvSpeaker[], actor: { id?: string; name?: string }): Promise<CctvSpeaker[]> {
  const clean = normalizeSpeakers(speakers);
  if (!clean.length) throw new Error("Minimal satu speaker.");
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(clean), description: "Nama speaker CCTV (kanal two-way audio DVR) untuk pengumuman", updatedByUserId: actor.id, updatedByNameSnapshot: actor.name },
    update: { value: JSON.stringify(clean), updatedByUserId: actor.id, updatedByNameSnapshot: actor.name }
  });
  return clean;
}
