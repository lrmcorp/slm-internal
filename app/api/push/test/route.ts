import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { pushConfig } from "@/lib/push/config";
import { sendPushToUser } from "@/lib/push/send";

/** Kirim notifikasi uji ke semua perangkat user yang sedang login, lalu laporkan hasilnya. */
export async function POST() {
  const user = await getCurrentUser();
  if (user.id === "unauthenticated") return NextResponse.json({ success: false, message: "Silakan login." }, { status: 401 });
  if (!pushConfig().enabled) return NextResponse.json({ success: false, message: "Notifikasi belum diaktifkan di server." }, { status: 503 });
  const result = await sendPushToUser(user.id, {
    title: "Notifikasi uji",
    body: "Notifikasi di perangkat ini sudah berjalan.",
    url: "/profile",
    tag: `test-${Date.now()}`,
  });
  return NextResponse.json({ success: true, data: result });
}
