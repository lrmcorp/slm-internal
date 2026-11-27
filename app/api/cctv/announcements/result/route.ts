import { NextResponse } from "next/server";
import { parseAnnouncementResult, verifyCctvRequest } from "@/lib/cctv/announcementResult";
import { notifyAnnouncementResult } from "@/lib/push/notify";

/** Server CCTV melaporkan hasil pemutaran pengumuman (mis. laporan pesanan 12.30/15.00); Owner diberi push notification. */
export async function POST(request: Request) {
  const rawBody = await request.text().catch(() => "");
  if (!verifyCctvRequest(request, rawBody)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* ditolak di bawah */ }
  const result = parseAnnouncementResult(body);
  if (!result) return NextResponse.json({ success: false, message: "report wajib diisi" }, { status: 422 });
  const sent = await notifyAnnouncementResult(result);
  return NextResponse.json({ success: true, data: { sent } });
}
