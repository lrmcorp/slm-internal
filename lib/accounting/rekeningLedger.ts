import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Setiap rekening (kas laci, BCA, Mandiri, ...) punya akun COA sendiri di bawah kelompok Kas & Bank,
 * supaya saldo tiap rekening terlihat di Buku Besar dan Neraca. Akun dibuat otomatis dengan kode 1-11xx
 * saat rekening pertama kali dipakai. Transaksi lama yang sudah dijurnal ke Kas & Bank (1-1001) tetap di sana.
 */
export const GENERAL_CASH_CODE = "1-1001";
const CODE_PREFIX = "1-11";

function ledgerName(rek: { name: string; bankName: string | null }) {
  const bank = rek.bankName?.trim();
  if (!bank || rek.name.toLowerCase().includes(bank.toLowerCase())) return rek.name.trim();
  return `${bank} ${rek.name}`.trim();
}

async function nextCode() {
  const rows = await prisma.account.findMany({ where: { code: { startsWith: CODE_PREFIX } }, select: { code: true } });
  const used = rows.map((r) => Number(r.code.slice(CODE_PREFIX.length))).filter((n) => Number.isInteger(n));
  return `${CODE_PREFIX}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, "0")}`;
}

/** Akun COA milik rekening; dibuat dan ditautkan bila belum ada. */
export async function ensureRekeningLedgerAccount(rekeningId: string) {
  const rek = await prisma.rekeningAccount.findUnique({ where: { id: rekeningId }, include: { account: true } });
  if (!rek) return null;
  if (rek.account) return rek.account;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const account = await prisma.account.create({
        data: {
          code: await nextCode(),
          name: ledgerName(rek),
          category: "ASSET",
          normalBalance: "DEBIT",
          reportGroup: "CURRENT_ASSET",
          description: `Rekening ${rek.name}${rek.accountNumber ? ` (${rek.accountNumber})` : ""}. Dibuat otomatis dari Pengaturan > Rekening.`,
          isSystem: true,
          isActive: true,
          sortOrder: 11
        }
      });
      // Bila proses lain menautkan lebih dulu, akun yang baru dibuat dibiarkan tak terpakai dan yang tertaut dipakai.
      const linked = await prisma.rekeningAccount.updateMany({ where: { id: rek.id, accountId: null }, data: { accountId: account.id } });
      if (linked.count === 1) return account;
      await prisma.account.delete({ where: { id: account.id } }).catch(() => undefined);
      return (await prisma.rekeningAccount.findUnique({ where: { id: rek.id }, include: { account: true } }))?.account ?? null;
    } catch (error) {
      // Kode bentrok dengan pembuatan bersamaan: hitung ulang kode.
      if ((error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }
  throw new Error(`Gagal membuat akun COA untuk rekening ${rek.name}.`);
}

/** Tautkan semua rekening aktif yang belum punya akun COA. Murah bila semuanya sudah tertaut. */
export async function ensureAllRekeningLedgerAccounts() {
  if (!prisma?.rekeningAccount?.findMany) return;
  const pending = await prisma.rekeningAccount.findMany({ where: { accountId: null, isActive: true }, select: { id: true } });
  for (const rek of pending) await ensureRekeningLedgerAccount(rek.id);
}

/** Akun kas/bank untuk sebuah transaksi: akun rekening bila ada, selain itu Kas & Bank umum (1-1001). */
export async function cashAccountForRekening(rekeningId?: string | null) {
  if (rekeningId) {
    const account = await ensureRekeningLedgerAccount(rekeningId);
    if (account) return account;
  }
  const general = await prisma.account.findUnique({ where: { code: GENERAL_CASH_CODE } });
  if (!general) throw new Error("Akun perkiraan Kas & Bank (1-1001) tidak ditemukan.");
  return general;
}
