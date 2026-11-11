import { NextResponse } from "next/server";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { retryExpenseErpSync } from "@/lib/erpSync/expenseRetry";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "erp_sync.retry")) return NextResponse.json({ success: false, message: "Tidak punya akses ERP Sync." }, { status: 403 });
  const { id } = await params;
  const result = await retryExpenseErpSync(id);
  return NextResponse.json(result, { status: result.success ? 200 : 502 });
}
