import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getCurrentRole, getCurrentUser } from "@/lib/auth/session";
import { cancelSalesRecord, getSalesRecord } from "@/lib/sales/store";
import { cancelMjInvoiceFromSlm } from "@/lib/integrations/mj/service";

const cancelSchema = z.object({ reason: z.string().trim().min(3, "Alasan cancel wajib diisi.") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!can(await getCurrentRole(), "penjualan.manage")) {
    return NextResponse.json({ success: false, message: "Tidak punya akses cancel Penjualan." }, { status: 403 });
  }
  const parsed = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Alasan cancel wajib diisi.", code: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const { id } = await params;
  try {
    // Transaksi dari MJ: dibatalkan lewat jalur integrasi (stok, invoice, tempo, jurnal); MJ ikut membatalkan saat sinkron.
    const sale = await getSalesRecord(id);
    if (sale?.source === "MJ") {
      const user = await getCurrentUser();
      await cancelMjInvoiceFromSlm(id, parsed.data.reason, { id: user.id, name: user.name, role: user.role });
      return NextResponse.json({ success: true, data: await getSalesRecord(id) });
    }
    const data = await cancelSalesRecord(id, parsed.data.reason);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Transaksi penjualan gagal dibatalkan." }, { status: 400 });
  }
}
