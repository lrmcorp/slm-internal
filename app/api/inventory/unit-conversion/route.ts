import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { convertGrossProductsToLusin } from "@/lib/inventory/unitConversion";

const schema = z.object({ skus: z.array(z.string().min(1)).optional(), apply: z.boolean().optional() });

/** Ubah satuan barang Gross menjadi Lusin (khusus Owner). Tanpa apply: true hanya pratinjau. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "OWNER") return NextResponse.json({ success: false, message: "Khusus Owner." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Data tidak valid." }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await convertGrossProductsToLusin(parsed.data, { id: user.id, name: user.name, role: user.role }) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Konversi gagal." }, { status: 400 });
  }
}
