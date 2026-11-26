import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/store";
import { listSpeakers } from "@/lib/cctv/speakers";
import { announceOnCctv } from "@/lib/push/notify";

const bodySchema = z.object({
  text: z.string().trim().min(3, "Tulis pengumuman minimal 3 huruf.").max(300, "Pengumuman maksimal 300 huruf."),
  channels: z.array(z.number().int().min(1).max(64)).min(1, "Pilih minimal satu speaker.").max(16)
});

/** Owner mengumumkan teks bebas lewat speaker CCTV yang dipilih (diputar bergantian di tiap speaker). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user.id === "unauthenticated") return NextResponse.json({ success: false, message: "Silakan login." }, { status: 401 });
  if (user.role !== "OWNER") return NextResponse.json({ success: false, message: "Pengumuman speaker hanya untuk Owner." }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: parsed.error.issues[0]?.message || "Data tidak valid." }, { status: 400 });
  const known = new Set((await listSpeakers()).map((speaker) => speaker.channel));
  const channels = Array.from(new Set(parsed.data.channels)).filter((channel) => known.has(channel));
  if (!channels.length) return NextResponse.json({ success: false, message: "Speaker yang dipilih tidak dikenal." }, { status: 400 });
  const result = await announceOnCctv(parsed.data.text, channels);
  const ok = result === "diantrekan di speaker CCTV";
  await recordAudit({ entityType: "app_setting", entityId: "cctv.announcement", action: "create", afterValue: { text: parsed.data.text, channels, result }, reason: `Pengumuman speaker CCTV (kanal ${channels.join(", ")})` }).catch(() => undefined);
  return NextResponse.json(
    ok ? { success: true, data: { channels } } : { success: false, message: `Pengumuman belum terkirim: ${result}.` },
    { status: ok ? 202 : 502 }
  );
}
