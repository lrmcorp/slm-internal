import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { cashBankSchema, updateCashBankMutation } from "@/lib/accounting/cashBank";

/** Ubah mutasi kas & bank: jurnal yang sama disusun ulang dari isian baru (nomor jurnal tetap). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "cashbank.manage")) return NextResponse.json({ success: false, message: "Tidak punya akses Mutasi Kas & Bank." }, { status: 403 });
  const { id } = await params;
  try {
    const input = cashBankSchema.parse(await request.json().catch(() => null));
    const journal = await updateCashBankMutation(id, input, { id: user.id, name: user.name, role: user.role });
    return NextResponse.json({ success: true, data: { id: journal.id, journalNumber: journal.journalNumber } });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message || "Data mutasi tidak valid." : error instanceof Error ? error.message : "Gagal mengubah mutasi.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
