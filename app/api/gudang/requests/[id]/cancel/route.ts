import { NextResponse } from "next/server";
import { can } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { cancelWarehouseRequest } from "@/lib/inventory/warehouseRequests";
import { warehouseRequestError } from "@/lib/inventory/warehouseRequestHttp";

/** Batalkan permintaan yang belum diproses gudang. Sales hanya miliknya sendiri; Super Admin/Supervisor semua. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user.role, "gudang.request.create")) return NextResponse.json({ success: false, message: "Tidak punya akses membatalkan permintaan barang." }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  try {
    await cancelWarehouseRequest(id, String(body.reason ?? "").trim().slice(0, 300), { id: user.id, name: user.name }, user.role === "OWNER" || user.role === "SUPERVISOR");
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    return warehouseRequestError(error);
  }
}
