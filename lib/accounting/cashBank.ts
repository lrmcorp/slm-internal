import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/lib/auth/roles";
import { ensureStandardAccounts, getAccountByCode } from "@/lib/accounting/accountStore";
import { postJournalEntry, reverseJournalEntry } from "@/lib/accounting/journalStore";
import { GENERAL_CASH_CODE, cashAccountForRekening } from "@/lib/accounting/rekeningLedger";

/**
 * Mutasi Kas & Bank: transaksi uang yang bukan penjualan atau pengeluaran biasa. Pengguna memilih jenis,
 * rekening, dan nominal; jurnal dibuat otomatis (sourceType CASH_BANK).
 *   from = rekening yang uangnya berkurang (kredit), to = rekening yang uangnya bertambah (debit).
 *   counter = akun lawan untuk jenis yang hanya melibatkan satu rekening.
 */
export const CASH_BANK_TYPES = {
  SETOR_TUNAI: { label: "Setor tunai ke bank", from: true, to: true, fromHint: "Dari kas", toHint: "Ke rekening bank" },
  TARIK_TUNAI: { label: "Tarik tunai dari bank", from: true, to: true, fromHint: "Dari rekening bank", toHint: "Ke kas" },
  TRANSFER: { label: "Pindah dana antar rekening", from: true, to: true, fromHint: "Dari rekening", toHint: "Ke rekening" },
  BIAYA_ADMIN: { label: "Biaya admin bank", from: true, to: false, fromHint: "Dipotong dari rekening", counterCode: "6-1009", counterSide: "debit" },
  BUNGA: { label: "Bunga / jasa giro bank", from: false, to: true, toHint: "Masuk ke rekening", counterCode: "4-2001", counterSide: "credit" },
  MODAL_MASUK: { label: "Setoran modal pemilik", from: false, to: true, toHint: "Masuk ke rekening", counterCode: "3-1001", counterSide: "credit" },
  PRIVE: { label: "Pengambilan pribadi pemilik (prive)", from: true, to: false, fromHint: "Diambil dari rekening", counterCode: "3-1003", counterSide: "debit" }
} as const;

export type CashBankType = keyof typeof CASH_BANK_TYPES;
type TypeDef = { label: string; from: boolean; to: boolean; fromHint?: string; toHint?: string; counterCode?: string; counterSide?: "debit" | "credit" };
const def = (type: CashBankType) => CASH_BANK_TYPES[type] as TypeDef;

/** Pilihan rekening khusus untuk saldo lama yang masih tercatat di Kas & Bank umum (1-1001). */
export const GENERAL_REKENING = "GENERAL";

export const cashBankSchema = z.object({
  type: z.enum(Object.keys(CASH_BANK_TYPES) as [CashBankType, ...CashBankType[]], { message: "Pilih jenis mutasi" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  fromRekeningId: z.string().trim().max(150).optional(),
  toRekeningId: z.string().trim().max(150).optional(),
  amount: z.coerce.number().finite().positive("Nominal harus lebih dari 0").max(1e13, "Nominal terlalu besar"),
  notes: z.string().trim().max(300).optional()
}).superRefine((data, ctx) => {
  const t = def(data.type);
  if (t.from && !data.fromRekeningId) ctx.addIssue({ code: "custom", message: `Pilih rekening: ${(t.fromHint ?? "asal").toLowerCase()}`, path: ["fromRekeningId"] });
  if (t.to && !data.toRekeningId) ctx.addIssue({ code: "custom", message: `Pilih rekening: ${(t.toHint ?? "tujuan").toLowerCase()}`, path: ["toRekeningId"] });
  if (t.from && t.to && data.fromRekeningId && data.fromRekeningId === data.toRekeningId) {
    ctx.addIssue({ code: "custom", message: "Rekening asal dan tujuan harus berbeda", path: ["toRekeningId"] });
  }
});
export type CashBankInput = z.infer<typeof cashBankSchema>;

type Actor = { id: string; name: string; role: Role };

async function rekeningSide(rekeningId: string) {
  if (rekeningId === GENERAL_REKENING) {
    const account = await getAccountByCode(GENERAL_CASH_CODE);
    if (!account) throw new Error("Akun Kas & Bank (1-1001) tidak ditemukan.");
    return { account, name: "Kas & Bank umum (saldo lama)" };
  }
  const rek = await prisma.rekeningAccount.findUnique({ where: { id: rekeningId } });
  if (!rek || !rek.isActive) throw new Error("Rekening tidak ditemukan atau tidak aktif.");
  return { account: await cashAccountForRekening(rek.id), name: rek.name };
}

export async function createCashBankMutation(input: CashBankInput, actor: Actor) {
  await ensureStandardAccounts();
  const t = def(input.type);
  const amount = Math.round(input.amount * 100) / 100;
  const from = t.from && input.fromRekeningId ? await rekeningSide(input.fromRekeningId) : null;
  const to = t.to && input.toRekeningId ? await rekeningSide(input.toRekeningId) : null;
  const counter = t.counterCode ? await getAccountByCode(t.counterCode) : null;
  if (t.counterCode && !counter) throw new Error(`Akun ${t.counterCode} tidak ditemukan di Bagan Akun.`);

  const route = [from?.name, to?.name].filter(Boolean).join(" → ");
  const description = [`${t.label}: ${route}`, input.notes].filter(Boolean).join(" · ").slice(0, 500);
  const line = (account: { id: string }, debit: number, credit: number, memo: string) => ({ accountId: account.id, debit, credit, memo });
  const lines = [];
  if (to) lines.push(line(to.account, amount, 0, `Masuk ke ${to.name}`));
  if (counter && t.counterSide === "debit") lines.push(line(counter, amount, 0, t.label));
  if (from) lines.push(line(from.account, 0, amount, `Keluar dari ${from.name}`));
  if (counter && t.counterSide === "credit") lines.push(line(counter, 0, amount, t.label));

  return postJournalEntry({
    entryDate: new Date(`${input.date}T12:00:00+07:00`),
    sourceType: "CASH_BANK",
    sourceId: `CB-${input.type}-${crypto.randomUUID()}`,
    postingType: "CASH_BANK",
    description,
    lines: lines.map((l, i) => ({ ...l, sortOrder: i }))
  }, actor);
}

export function cashBankTypeOf(sourceId: string | null): CashBankType | null {
  const match = /^CB-([A-Z_]+)-/.exec(sourceId ?? "");
  return match && match[1] in CASH_BANK_TYPES ? (match[1] as CashBankType) : null;
}

export async function listCashBankMutations(limit = 100) {
  const rows = await prisma.journalEntry.findMany({
    where: { sourceType: "CASH_BANK", isReversal: false },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: { lines: { orderBy: { sortOrder: "asc" } } }
  });
  return rows.map((j) => {
    const type = cashBankTypeOf(j.sourceId);
    const debitCash = j.lines.find((l) => Number(l.debit) > 0 && l.memo?.startsWith("Masuk ke "));
    const creditCash = j.lines.find((l) => Number(l.credit) > 0 && l.memo?.startsWith("Keluar dari "));
    return {
      id: j.id,
      journalNumber: j.journalNumber,
      date: j.entryDate.toISOString(),
      type,
      typeLabel: type ? CASH_BANK_TYPES[type].label : "Mutasi kas & bank",
      from: creditCash?.memo?.replace(/^Keluar dari /, "") ?? null,
      to: debitCash?.memo?.replace(/^Masuk ke /, "") ?? null,
      amount: Number(j.totalDebit),
      description: j.description,
      cancelled: j.status === "REVERSED" || Boolean(j.reversedByJournalId),
      createdBy: j.createdByNameSnapshot
    };
  });
}

/** Saldo buku tiap rekening (dari jurnal), ditambah Kas & Bank umum bila masih ada saldonya. */
export async function cashBankBalances() {
  await ensureStandardAccounts();
  const [rekenings, general] = await Promise.all([
    prisma.rekeningAccount.findMany({ where: { isActive: true }, include: { account: true }, orderBy: { name: "asc" } }),
    getAccountByCode(GENERAL_CASH_CODE)
  ]);
  const accountIds = [...rekenings.map((r) => r.accountId).filter((id): id is string => Boolean(id)), ...(general ? [general.id] : [])];
  const sums = accountIds.length
    ? await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds }, journalEntry: { status: { not: "DRAFT" } } }, _sum: { debit: true, credit: true } })
    : [];
  const balanceOf = (id?: string | null) => {
    const row = sums.find((s) => s.accountId === id);
    return row ? Number(row._sum.debit ?? 0) - Number(row._sum.credit ?? 0) : 0;
  };
  const rows = rekenings.map((r) => ({ id: r.id, name: r.name, bank: r.bankName, accountCode: r.account?.code ?? null, currency: r.currency, balance: balanceOf(r.accountId) }));
  const generalBalance = general ? balanceOf(general.id) : 0;
  return { rekenings: rows, general: { id: GENERAL_REKENING, name: "Kas & Bank umum (saldo lama)", accountCode: GENERAL_CASH_CODE, balance: generalBalance } };
}

export async function cancelCashBankMutation(journalId: string, reason: string, actor: Actor) {
  const journal = await prisma.journalEntry.findUnique({ where: { id: journalId } });
  if (!journal || journal.sourceType !== "CASH_BANK") throw new Error("Mutasi kas & bank tidak ditemukan.");
  return reverseJournalEntry(journalId, actor, reason || "Dibatalkan");
}
