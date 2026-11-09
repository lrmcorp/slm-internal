import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { pushConfig } from "@/lib/push/config";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
});

async function signedInUser() {
  const user = await getCurrentUser();
  return user.id === "unauthenticated" ? null : user;
}

/** Simpan langganan notifikasi perangkat ini untuk user yang sedang login. */
export async function POST(request: Request) {
  if (!pushConfig().enabled) return NextResponse.json({ success: false, message: "Notifikasi belum diaktifkan di server." }, { status: 503 });
  const user = await signedInUser();
  if (!user) return NextResponse.json({ success: false, message: "Silakan login." }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Data langganan tidak valid." }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  const data = { p256dh: keys.p256dh, auth: keys.auth, userId: user.id, role: user.role, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null, failureCount: 0 };
  await prisma.pushSubscription.upsert({ where: { endpoint }, create: { id: crypto.randomUUID(), endpoint, ...data }, update: data });
  return NextResponse.json({ success: true });
}

/** Berhenti menerima notifikasi di perangkat ini. */
export async function DELETE(request: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ success: false, message: "Silakan login." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return NextResponse.json({ success: false, message: "Endpoint wajib diisi." }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
  return NextResponse.json({ success: true });
}
