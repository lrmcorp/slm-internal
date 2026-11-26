import { NextResponse } from "next/server";
import { rejectIfInvalidCron } from "@/lib/jobs/cronAuth";
import { notifyDeliveryOrderBacklog } from "@/lib/push/notify";

/** Dipanggil timer VPS slm-do-backlog (Senin-Sabtu 12.30 dan 15.00 WIB). */
export async function POST(request: Request) {
  const rejected = rejectIfInvalidCron(request);
  if (rejected) return rejected;
  const data = await notifyDeliveryOrderBacklog();
  return NextResponse.json({ success: true, data });
}
