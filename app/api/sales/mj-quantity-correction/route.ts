import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { correctMjInvoiceQuantities } from "@/lib/integrations/mj/quantityCorrection";

const schema = z.object({
  reference: z.string().trim().min(1),
  items: z.array(z.object({ sku: z.string().trim().min(1), quantity: z.number().positive() })).min(1),
  apply: z.boolean().optional(),
  reason: z.string().trim().max(500).optional()
});

/** Koreksi jumlah barang invoice MJ (khusus Owner). Tanpa apply: true hanya pratinjau, tidak mengubah apa pun. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "OWNER") return NextResponse.json({ success: false, message: "Khusus Owner." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: parsed.error.issues[0]?.message || "Data tidak valid." }, { status: 400 });
  try {
    const data = await correctMjInvoiceQuantities(parsed.data, { id: user.id, name: user.name, role: user.role });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Koreksi gagal." }, { status: 400 });
  }
}
