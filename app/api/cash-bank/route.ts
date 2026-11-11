import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { cashBankBalances, cashBankSchema, createCashBankMutation, listCashBankMutations } from "@/lib/accounting/cashBank";

const forbidden = () => NextResponse.json({ success: false, message: "Tidak punya akses Mutasi Kas & Bank." }, { status: 403 });

export async function GET() {
  const user = await getCurrentUser();
  if (!can(user, "cashbank.manage")) return forbidden();
  const [balances, mutations] = await Promise.all([cashBankBalances(), listCashBankMutations()]);
  return NextResponse.json({ success: true, data: { balances, mutations } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!can(user, "cashbank.manage")) return forbidden();
  try {
    const input = cashBankSchema.parse(await request.json().catch(() => null));
    const journal = await createCashBankMutation(input, { id: user.id, name: user.name, role: user.role });
    return NextResponse.json({ success: true, data: { id: journal.id, journalNumber: journal.journalNumber } }, { status: 201 });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message || "Data mutasi tidak valid." : error instanceof Error ? error.message : "Gagal menyimpan mutasi.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
