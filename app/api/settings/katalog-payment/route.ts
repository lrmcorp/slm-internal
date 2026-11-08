import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { getKatalogPaymentSetting, updateKatalogPaymentSetting } from "@/lib/settings/katalogPayment";

const schema = z.object({ rekeningId: z.string().max(100), accountHolder: z.string().max(100) });

export async function GET() {
  if (!can(await getCurrentRole(), "settings.rekening.manage")) return NextResponse.json({ success: false, message: "Tidak punya akses." }, { status: 403 });
  return NextResponse.json({ success: true, data: await getKatalogPaymentSetting() });
}

export async function PUT(request: Request) {
  if (!can(await getCurrentRole(), "settings.rekening.manage")) return NextResponse.json({ success: false, message: "Tidak punya akses kelola rekening." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Data rekening katalog tidak valid." }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await updateKatalogPaymentSetting(parsed.data) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Gagal menyimpan." }, { status: 400 });
  }
}
