import { NextResponse } from "next/server";
import { can } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { processRequestSchema, processWarehouseRequest } from "@/lib/inventory/warehouseRequests";
import { warehouseRequestError } from "@/lib/inventory/warehouseRequestHttp";

/** Petugas Gudang menyelesaikan permintaan: qty yang benar-benar dikirim per barang. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "gudang.request.process")) return NextResponse.json({ success: false, message: "Tidak punya akses memproses permintaan barang." }, { status: 403 });
  const { id } = await params;
  try {
    const input = processRequestSchema.parse(await request.json().catch(() => null));
    const result = await processWarehouseRequest(id, input, { id: user.id, name: user.name });
    if (!result.complete) void import("@/lib/push/notify").then(({ notifyWarehouseShortage }) => notifyWarehouseShortage(id)).catch(() => undefined);
    return NextResponse.json({ success: true, data: { status: result.request.status, complete: result.complete, transferNumber: result.transferNumber } });
  } catch (error) {
    return warehouseRequestError(error);
  }
}
