import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { getJournalEntry, updateManualJournalEntry } from "@/lib/accounting/journalStore";
import { manualJournalSchema } from "@/lib/validation/accountingSchema";
import { ZodError } from "zod";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "accounting.view")) {
    return NextResponse.json({ success: false, message: "Akses ditolak." }, { status: 403 });
  }

  const { id } = await params;
  try {
    const journal = await getJournalEntry(id);
    if (!journal) {
      return NextResponse.json({ success: false, message: "Jurnal tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: journal });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Gagal memuat detail jurnal." },
      { status: 500 }
    );
  }
}

/** Edit jurnal manual (permission accounting.journal.manage: Super Admin dan Finance). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "accounting.journal.manage")) {
    return NextResponse.json({ success: false, message: "Akses ditolak. Memerlukan hak akses kelola jurnal." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const input = manualJournalSchema.parse(await request.json().catch(() => null));
    const journal = await updateManualJournalEntry(id, input, { id: user.id, name: user.name, role: user.role });
    return NextResponse.json({ success: true, data: journal });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message || "Data jurnal tidak valid." : error instanceof Error ? error.message : "Gagal mengedit jurnal.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
