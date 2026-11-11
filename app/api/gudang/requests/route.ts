import { NextResponse } from "next/server";
import { can } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { createWarehouseRequest, warehouseRequestSchema } from "@/lib/inventory/warehouseRequests";
import { warehouseRequestError } from "@/lib/inventory/warehouseRequestHttp";

/** Sales membuat permintaan barang ke gudang. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!can(user.role, "gudang.request.create")) return NextResponse.json({ success: false, message: "Tidak punya akses membuat permintaan barang." }, { status: 403 });
  try {
    const input = warehouseRequestSchema.parse(await request.json().catch(() => null));
    const created = await createWarehouseRequest(input, { id: user.id, name: user.name });
    void import("@/lib/push/notify").then(({ notifyWarehouseRequest }) => notifyWarehouseRequest(created.id)).catch(() => undefined);
    return NextResponse.json({ success: true, data: { id: created.id, requestNumber: created.requestNumber } }, { status: 201 });
  } catch (error) {
    return warehouseRequestError(error);
  }
}
