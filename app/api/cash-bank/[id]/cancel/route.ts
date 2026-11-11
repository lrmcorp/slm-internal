import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { cancelCashBankMutation } from "@/lib/accounting/cashBank";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "cashbank.manage")) return NextResponse.json({ success: false, message: "Tidak punya akses Mutasi Kas & Bank." }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  try {
    const reversal = await cancelCashBankMutation(id, String(body.reason ?? "").trim().slice(0, 300), { id: user.id, name: user.name, role: user.role });
    return NextResponse.json({ success: true, data: { id: reversal.id, journalNumber: reversal.journalNumber } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Gagal membatalkan mutasi." }, { status: 400 });
  }
}
