import { NextResponse } from "next/server";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { getInventoryAiForecast } from "@/lib/ai/inventoryForecast";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "stock.view") && !can(access, "reports.view")) {
    return NextResponse.json({ success: false, message: "Akses ditolak: izin tidak mencukupi." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("force") === "true";

  try {
    const data = await getInventoryAiForecast({ forceRefresh });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: error.message || "Gagal memproses prediksi inventaris AI."
      },
      { status: 500 }
    );
  }
}
