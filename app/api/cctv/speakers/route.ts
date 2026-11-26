import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { listSpeakers, saveSpeakers } from "@/lib/cctv/speakers";

async function owner() {
  const user = await getCurrentUser();
  if (user.id === "unauthenticated") return { error: NextResponse.json({ success: false, message: "Silakan login." }, { status: 401 }) };
  if (user.role !== "OWNER") return { error: NextResponse.json({ success: false, message: "Hanya untuk Owner." }, { status: 403 }) };
  return { user };
}

/** Daftar speaker CCTV (kanal two-way audio) beserta namanya. */
export async function GET() {
  const check = await owner();
  if (check.error) return check.error;
  return NextResponse.json({ success: true, data: await listSpeakers() });
}

/** Owner mengubah nama speaker. */
export async function PUT(request: Request) {
  const check = await owner();
  if (check.error) return check.error;
  const body = await request.json().catch(() => null) as { speakers?: unknown } | null;
  try {
    const data = await saveSpeakers((body?.speakers ?? []) as never, { id: check.user.id, name: check.user.name });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Nama speaker gagal disimpan." }, { status: 400 });
  }
}
