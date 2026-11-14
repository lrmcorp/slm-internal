import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { resetDeliveryOrderToUnprocessed } from "@/lib/deliveryOrders/store";

/** Kembalikan DO ke Belum Diproses. Khusus Super Admin, alasan wajib, tercatat di Audit Trail. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "OWNER") {
    return NextResponse.json({ success: false, message: "Hanya Super Admin yang dapat mengembalikan DO ke Belum Diproses." }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : "";
  try {
    const updated = await resetDeliveryOrderToUnprocessed(id, reason, user);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Gagal mengembalikan status DO." }, { status: 400 });
  }
}
