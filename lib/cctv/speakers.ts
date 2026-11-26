import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Speaker yang bisa dipakai untuk pengumuman: kanal two-way audio DVR beserta nama yang diberi Owner.
 * Bawaan = kanal yang menerima sesi bicara saat diuji 25 Nov 2026 (1, 2, 5, 6, 12, 13, 15).
 */
export type CctvSpeaker = { channel: number; name: string };

const KEY = "cctv.speakers";
export const DEFAULT_SPEAKERS: CctvSpeaker[] = [1, 2, 5, 6, 12, 13, 15].map((channel) => ({
  channel,
  name: channel === 13 ? "Kanal 13 (pengumuman pesanan)" : `Kanal ${channel}`
}));

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
